// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SplitsRouter} from "../src/SplitsRouter.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {ReentrantToken} from "./mocks/ReentrantToken.sol";

contract SplitsRouterTest is Test {
    uint256 constant USDC = 1e6;

    MockUSDC usdc;
    SplitsRouter router;

    address sender = makeAddr("sender");
    address landlord = makeAddr("landlord");
    address school = makeAddr("school");
    address sister = makeAddr("sister");
    address stranger = makeAddr("stranger");

    function setUp() public {
        usdc = new MockUSDC();
        router = new SplitsRouter(IERC20(address(usdc)));
        usdc.mint(sender, 100_000 * USDC);
        vm.prank(sender);
        usdc.approve(address(router), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers

    function _leg(address r, uint96 fixedAmount, uint16 bps, string memory purpose)
        internal
        pure
        returns (SplitsRouter.Leg memory)
    {
        return
            SplitsRouter.Leg({recipient: r, fixedAmount: fixedAmount, shareBps: bps, purpose: bytes32(bytes(purpose))});
    }

    function _familyLegs() internal view returns (SplitsRouter.Leg[] memory legs) {
        legs = new SplitsRouter.Leg[](3);
        legs[0] = _leg(landlord, 0, 4000, "rent");
        legs[1] = _leg(school, 0, 3500, "school fees");
        legs[2] = _leg(sister, 0, 2500, "upkeep");
    }

    function _create(address owner, SplitsRouter.Leg[] memory legs) internal returns (uint256 id) {
        vm.prank(owner);
        id = router.createSplit(legs);
    }

    function _send(address payer, uint256 id, uint32 version, uint256 amount, bytes32 ref)
        internal
        returns (uint256[] memory)
    {
        vm.prank(payer);
        return router.send(id, version, amount, ref);
    }

    function _pay(address payer, SplitsRouter.Leg[] memory legs, uint256 amount, bytes32 ref)
        internal
        returns (uint256[] memory)
    {
        vm.prank(payer);
        return router.pay(legs, amount, ref);
    }

    function _winners(uint256 n, uint96 each) internal pure returns (SplitsRouter.Leg[] memory legs) {
        legs = new SplitsRouter.Leg[](n);
        for (uint256 i; i < n; ++i) {
            legs[i] = _leg(address(uint160(0x10000 + i)), each, 0, "giveaway prize");
        }
    }

    // ------------------------------------------------------------------ create

    function test_CreateSplit_StoresOwnerVersionAndLegs() public {
        uint256 id = _create(sender, _familyLegs());
        assertEq(id, 1);
        assertEq(router.nextSplitId(), 2);

        (address owner, uint32 version, bool active, SplitsRouter.Leg[] memory legs) = router.getSplit(id);
        assertEq(owner, sender);
        assertEq(version, 1);
        assertTrue(active);
        assertEq(legs.length, 3);
        assertEq(legs[1].recipient, school);
        assertEq(legs[1].shareBps, 3500);
        assertEq(legs[1].purpose, bytes32("school fees"));
    }

    function test_CreateSplit_EmitsLegs() public {
        SplitsRouter.Leg[] memory legs = _familyLegs();
        vm.expectEmit(true, true, false, false, address(router));
        emit SplitsRouter.SplitCreated(1, sender);
        vm.expectEmit(true, false, false, true, address(router));
        emit SplitsRouter.SplitLegsSet(1, 1, legs);
        _create(sender, legs);
    }

    function test_RevertWhen_NoLegs() public {
        vm.expectRevert(SplitsRouter.NoLegs.selector);
        _create(sender, new SplitsRouter.Leg[](0));
    }

    function test_CreateSplit_HasNoRecipientLimit() public {
        SplitsRouter.Leg[] memory legs = _winners(30, uint96(1 * USDC));
        uint256 id = _create(sender, legs);
        _send(sender, id, 1, 30 * USDC, keccak256("thirty"));
        assertEq(usdc.balanceOf(legs[29].recipient), 1 * USDC);
    }

    function test_RevertWhen_RecipientIsZeroRouterOrToken() public {
        address[3] memory bad = [address(0), address(router), address(usdc)];
        for (uint256 i; i < bad.length; ++i) {
            SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
            legs[0] = _leg(bad[i], 0, 10_000, "x");
            vm.expectRevert(abi.encodeWithSelector(SplitsRouter.InvalidRecipient.selector, 0, bad[i]));
            _create(sender, legs);
        }
    }

    function test_RevertWhen_LegHasBothRules() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = _leg(sister, 5, 10_000, "x");
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.LegNeedsExactlyOneRule.selector, 0));
        _create(sender, legs);
    }

    function test_RevertWhen_LegHasNoRule() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](2);
        legs[0] = _leg(sister, 0, 10_000, "x");
        legs[1] = _leg(school, 0, 0, "x");
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.LegNeedsExactlyOneRule.selector, 1));
        _create(sender, legs);
    }

    function test_RevertWhen_SharesDoNotTotal10000() public {
        SplitsRouter.Leg[] memory legs = _familyLegs();
        legs[2].shareBps = 2499;
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.SharesMustTotal.selector, 9999));
        _create(sender, legs);

        legs[2].shareBps = 10_000;
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.SharesMustTotal.selector, 17_500));
        _create(sender, legs);
    }

    // ------------------------------------------------------------------ send: allocation

    function test_Send_PercentageSplit() public {
        uint256 id = _create(sender, _familyLegs());
        uint256[] memory amounts = _send(sender, id, 1, 500 * USDC, keccak256("t1"));

        assertEq(amounts[0], 200 * USDC);
        assertEq(amounts[1], 175 * USDC);
        assertEq(amounts[2], 125 * USDC);
        assertEq(usdc.balanceOf(landlord), 200 * USDC);
        assertEq(usdc.balanceOf(school), 175 * USDC);
        assertEq(usdc.balanceOf(sister), 125 * USDC);
        assertEq(usdc.balanceOf(sender), 99_500 * USDC);
        assertEq(usdc.balanceOf(address(router)), 0);
    }

    function test_Send_EmitsPurposeReceipts() public {
        uint256 id = _create(sender, _familyLegs());
        bytes32 ref = keccak256("t1");

        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.SplitSent(id, sender, ref, 100 * USDC, 1);
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.LegPaid(id, ref, landlord, 40 * USDC, bytes32("rent"));
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.LegPaid(id, ref, school, 35 * USDC, bytes32("school fees"));
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.LegPaid(id, ref, sister, 25 * USDC, bytes32("upkeep"));

        _send(sender, id, 1, 100 * USDC, ref);
    }

    function test_Send_SharesRoundDownToCents_LeftoverToLastShareLeg() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](3);
        legs[0] = _leg(landlord, 0, 3333, "a");
        legs[1] = _leg(school, 0, 3333, "b");
        legs[2] = _leg(sister, 0, 3334, "c");
        uint256 id = _create(sender, legs);

        // $1.00 three ways: 33.33 cents each would be fractional, so 33 + 33 + 34.
        uint256[] memory amounts = _send(sender, id, 1, 1_000_000, keccak256("cents"));
        assertEq(amounts[0], 330_000);
        assertEq(amounts[1], 330_000);
        assertEq(amounts[2], 340_000);
    }

    function test_Send_FamilyExampleIsAllCents() public {
        uint256 id = _create(sender, _familyLegs());
        // $12.70 at 40/35/25: 35% would be $4.445, so it pays $4.44 and the sister gets $3.18.
        uint256[] memory amounts = _send(sender, id, 1, 12_700_000, keccak256("family"));
        assertEq(amounts[0], 5_080_000);
        assertEq(amounts[1], 4_440_000);
        assertEq(amounts[2], 3_180_000);
    }

    function test_RevertWhen_AmountNotWholeCents() public {
        uint256 id = _create(sender, _familyLegs());
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.AmountNotCents.selector, 1_000_001));
        _send(sender, id, 1, 1_000_001, keccak256("x"));
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.AmountNotCents.selector, 5_555));
        router.previewSend(id, 5_555);
    }

    function test_RevertWhen_FixedAmountNotWholeCents() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](2);
        legs[0] = _leg(landlord, uint96(100 * USDC + 1), 0, "rent");
        legs[1] = _leg(sister, 0, 10_000, "upkeep");
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.FixedAmountNotCents.selector, 0, 100 * USDC + 1));
        _create(sender, legs);
    }

    function test_Send_FixedLegsFirstThenShare() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](3);
        legs[0] = _leg(landlord, uint96(300 * USDC), 0, "rent");
        legs[1] = _leg(school, uint96(150 * USDC), 0, "school fees");
        legs[2] = _leg(sister, 0, 10_000, "upkeep");
        uint256 id = _create(sender, legs);

        _send(sender, id, 1, 500 * USDC, keccak256("t"));
        assertEq(usdc.balanceOf(landlord), 300 * USDC);
        assertEq(usdc.balanceOf(school), 150 * USDC);
        assertEq(usdc.balanceOf(sister), 50 * USDC);
    }

    function test_Send_ShareLegSkippedWhenNothingLeft() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](2);
        legs[0] = _leg(landlord, uint96(100 * USDC), 0, "rent");
        legs[1] = _leg(sister, 0, 10_000, "upkeep");
        uint256 id = _create(sender, legs);

        vm.recordLogs();
        uint256[] memory amounts = _send(sender, id, 1, 100 * USDC, keccak256("t"));
        assertEq(amounts[1], 0);
        assertEq(usdc.balanceOf(sister), 0);

        // SplitSent + one LegPaid; no LegPaid for the empty leg.
        uint256 legPaid;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(router) && logs[i].topics[0] == SplitsRouter.LegPaid.selector) legPaid++;
        }
        assertEq(legPaid, 1);
    }

    function test_Send_FixedOnlyNeedsExactTotal() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](2);
        legs[0] = _leg(landlord, uint96(100 * USDC), 0, "rent");
        legs[1] = _leg(school, uint96(50 * USDC), 0, "school fees");
        uint256 id = _create(sender, legs);

        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.AmountMustEqualFixed.selector, 151 * USDC, 150 * USDC));
        _send(sender, id, 1, 151 * USDC, keccak256("a"));

        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.AmountBelowFixed.selector, 149 * USDC, 150 * USDC));
        _send(sender, id, 1, 149 * USDC, keccak256("b"));

        _send(sender, id, 1, 150 * USDC, keccak256("c"));
        assertEq(usdc.balanceOf(landlord), 100 * USDC);
        assertEq(usdc.balanceOf(school), 50 * USDC);
    }

    function test_PreviewMatchesSend() public {
        uint256 id = _create(sender, _familyLegs());
        uint256[] memory preview = router.previewSend(id, 123_450_000);
        uint256[] memory paid = _send(sender, id, 1, 123_450_000, keccak256("p"));
        assertEq(preview, paid);
    }

    // ------------------------------------------------------------------ send: refusals

    function test_RevertWhen_RefReused() public {
        uint256 id = _create(sender, _familyLegs());
        bytes32 ref = keccak256("transfer-42");
        _send(sender, id, 1, 100 * USDC, ref);

        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.RefAlreadyUsed.selector, sender, ref));
        _send(sender, id, 1, 100 * USDC, ref);
        assertEq(usdc.balanceOf(landlord), 40 * USDC);
    }

    function test_SameRef_DifferentPayers_BothPay() public {
        uint256 id = _create(sender, _familyLegs());
        usdc.mint(stranger, 100 * USDC);
        vm.prank(stranger);
        usdc.approve(address(router), 100 * USDC);

        bytes32 ref = keccak256("shared");
        _send(sender, id, 1, 100 * USDC, ref);
        _send(stranger, id, 1, 100 * USDC, ref);
        assertEq(usdc.balanceOf(landlord), 80 * USDC);
    }

    function test_RevertWhen_ZeroRefOrZeroAmount() public {
        uint256 id = _create(sender, _familyLegs());
        vm.expectRevert(SplitsRouter.ZeroRef.selector);
        _send(sender, id, 1, 100 * USDC, bytes32(0));
        vm.expectRevert(SplitsRouter.ZeroAmount.selector);
        _send(sender, id, 1, 0, keccak256("z"));
    }

    function test_RevertWhen_SplitMissing() public {
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.SplitNotFound.selector, 99));
        _send(sender, 99, 1, 100 * USDC, keccak256("m"));
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.SplitNotFound.selector, 99));
        router.getSplit(99);
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.SplitNotFound.selector, 99));
        router.previewSend(99, 1);
    }

    function test_RevertWhen_SplitInactive_ThenReactivated() public {
        uint256 id = _create(sender, _familyLegs());
        vm.prank(sender);
        router.setActive(id, false);

        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.SplitInactive.selector, id));
        _send(sender, id, 1, 100 * USDC, keccak256("i"));

        vm.prank(sender);
        router.setActive(id, true);
        _send(sender, id, 1, 100 * USDC, keccak256("i"));
        assertEq(usdc.balanceOf(sister), 25 * USDC);
    }

    function test_UpdateSplit_StaleQuoteReverts_NewVersionPaysNewLegs() public {
        uint256 id = _create(sender, _familyLegs());

        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = _leg(sister, 0, 10_000, "upkeep");
        vm.prank(sender);
        uint32 v = router.updateSplit(id, legs);
        assertEq(v, 2);

        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.VersionMismatch.selector, id, 1, 2));
        _send(sender, id, 1, 100 * USDC, keccak256("u"));

        _send(sender, id, 2, 100 * USDC, keccak256("u"));
        assertEq(usdc.balanceOf(sister), 100 * USDC);
        assertEq(usdc.balanceOf(landlord), 0);

        (,,, SplitsRouter.Leg[] memory stored) = router.getSplit(id);
        assertEq(stored.length, 1);
    }

    function test_RevertWhen_NonOwnerManagesSplit() public {
        uint256 id = _create(sender, _familyLegs());
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = _leg(stranger, 0, 10_000, "mine now");

        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.NotSplitOwner.selector, id, stranger));
        router.updateSplit(id, legs);
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.NotSplitOwner.selector, id, stranger));
        router.setActive(id, false);
        vm.stopPrank();
    }

    function test_RevertWhen_UpdateMissingSplit() public {
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.SplitNotFound.selector, 7));
        router.setActive(7, false);
    }

    // ------------------------------------------------------------------ pay (one-off)

    function test_Pay_FixedLegsPayEachWinnerExactly() public {
        SplitsRouter.Leg[] memory legs = _winners(20, uint96(5 * USDC));
        uint256 before = usdc.balanceOf(sender);
        _pay(sender, legs, 100 * USDC, keccak256("g1"));
        for (uint256 i; i < 20; ++i) {
            assertEq(usdc.balanceOf(legs[i].recipient), 5 * USDC);
        }
        assertEq(usdc.balanceOf(sender), before - 100 * USDC);
        assertEq(usdc.balanceOf(address(router)), 0);
        assertTrue(router.refUsed(sender, keccak256("g1")));
        assertEq(router.nextSplitId(), 1, "pay stores nothing");
    }

    function test_Pay_EmitsOneOffReceipts() public {
        SplitsRouter.Leg[] memory legs = _winners(2, uint96(1 * USDC));
        bytes32 ref = keccak256("g2");
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.SplitSent(0, sender, ref, 2 * USDC, 0);
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.LegPaid(0, ref, legs[0].recipient, 1 * USDC, bytes32("giveaway prize"));
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.LegPaid(0, ref, legs[1].recipient, 1 * USDC, bytes32("giveaway prize"));
        _pay(sender, legs, 2 * USDC, ref);
    }

    function test_Pay_SharesUseTheSameCentRules() public {
        uint256[] memory paid = _pay(sender, _familyLegs(), 12_700_000, keccak256("g3"));
        assertEq(paid[0], 5_080_000);
        assertEq(paid[1], 4_440_000);
        assertEq(paid[2], 3_180_000);
    }

    function test_Pay_RevertWhen_RefReusedAcrossSendAndPay() public {
        uint256 id = _create(sender, _familyLegs());
        bytes32 ref = keccak256("shared-ref");
        _send(sender, id, 1, 10 * USDC, ref);
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.RefAlreadyUsed.selector, sender, ref));
        _pay(sender, _winners(1, uint96(1 * USDC)), 1 * USDC, ref);

        bytes32 ref2 = keccak256("pay-first");
        _pay(sender, _winners(1, uint96(1 * USDC)), 1 * USDC, ref2);
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.RefAlreadyUsed.selector, sender, ref2));
        _pay(sender, _winners(1, uint96(1 * USDC)), 1 * USDC, ref2);
    }

    function test_Pay_RevertWhen_LegInvalid() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = _leg(address(router), uint96(1 * USDC), 0, "x");
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.InvalidRecipient.selector, 0, address(router)));
        _pay(sender, legs, 1 * USDC, keccak256("bad1"));

        legs[0] = _leg(landlord, uint96(1 * USDC + 1), 0, "x");
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.FixedAmountNotCents.selector, 0, 1 * USDC + 1));
        _pay(sender, legs, 1 * USDC + 1, keccak256("bad2"));

        vm.expectRevert(SplitsRouter.NoLegs.selector);
        _pay(sender, new SplitsRouter.Leg[](0), 1 * USDC, keccak256("bad3"));
    }

    function test_Pay_RevertWhen_AmountDoesNotMatchFixedTotal() public {
        SplitsRouter.Leg[] memory legs = _winners(3, uint96(1 * USDC));
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.AmountMustEqualFixed.selector, 4 * USDC, 3 * USDC));
        _pay(sender, legs, 4 * USDC, keccak256("over"));
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.AmountBelowFixed.selector, 2 * USDC, 3 * USDC));
        _pay(sender, legs, 2 * USDC, keccak256("under"));
    }

    function test_Pay_RevertWhen_ZeroAmountOrZeroRef() public {
        SplitsRouter.Leg[] memory legs = _winners(1, uint96(1 * USDC));
        vm.expectRevert(SplitsRouter.ZeroAmount.selector);
        _pay(sender, legs, 0, keccak256("z"));
        vm.expectRevert(SplitsRouter.ZeroRef.selector);
        _pay(sender, legs, 1 * USDC, bytes32(0));
    }

    function test_Pay_BlocklistedWinner_RevertsWholePayment() public {
        SplitsRouter.Leg[] memory legs = _winners(5, uint96(1 * USDC));
        usdc.setBlocked(legs[3].recipient, true);
        bytes32 ref = keccak256("blocked-winner");
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocklisted.selector, legs[3].recipient));
        _pay(sender, legs, 5 * USDC, ref);
        assertEq(usdc.balanceOf(legs[0].recipient), 0);
        assertEq(usdc.balanceOf(sender), 100_000 * USDC);
        assertFalse(router.refUsed(sender, ref));
    }

    function test_Pay_TwoHundredWinners() public {
        SplitsRouter.Leg[] memory legs = _winners(200, uint96(10_000)); // one cent each
        _pay(sender, legs, 200 * 10_000, keccak256("two-hundred"));
        assertEq(usdc.balanceOf(legs[199].recipient), 10_000);
    }

    function testFuzz_PreviewPayMatchesPay(uint8 n, uint32 centsEach) public {
        n = uint8(bound(n, 1, 60));
        uint96 each = uint96(bound(centsEach, 1, 10_000)) * 10_000;
        SplitsRouter.Leg[] memory legs = _winners(n, each);
        uint256 total = uint256(each) * n;
        uint256[] memory preview = router.previewPay(legs, total);
        uint256[] memory paid = _pay(sender, legs, total, keccak256(abi.encode(n, each)));
        assertEq(preview, paid);
        for (uint256 i; i < n; ++i) {
            assertEq(paid[i] % 10_000, 0);
        }
    }

    // ------------------------------------------------------------------ all-or-nothing

    function test_BlocklistedRecipient_RevertsWholePayment_RefStaysUsable() public {
        uint256 id = _create(sender, _familyLegs());
        usdc.setBlocked(school, true);
        bytes32 ref = keccak256("blocked");

        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocklisted.selector, school));
        _send(sender, id, 1, 100 * USDC, ref);

        // The landlord leg ran before the school leg failed, and it was rolled back too.
        assertEq(usdc.balanceOf(landlord), 0);
        assertEq(usdc.balanceOf(sender), 100_000 * USDC);
        assertFalse(router.refUsed(sender, ref));

        usdc.setBlocked(school, false);
        _send(sender, id, 1, 100 * USDC, ref);
        assertEq(usdc.balanceOf(school), 35 * USDC);
    }

    function test_ShortAllowance_RevertsWholePayment() public {
        uint256 id = _create(sender, _familyLegs());
        vm.prank(sender);
        usdc.approve(address(router), 50 * USDC); // covers the first leg (40) but not the second (35)

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 10 * USDC, 35 * USDC
            )
        );
        _send(sender, id, 1, 100 * USDC, keccak256("short"));
        assertEq(usdc.balanceOf(landlord), 0);
        assertEq(usdc.allowance(sender, address(router)), 50 * USDC);
    }

    function test_InsufficientBalance_RevertsWholePayment() public {
        uint256 id = _create(sender, _familyLegs());
        vm.prank(stranger);
        usdc.approve(address(router), type(uint256).max);
        usdc.mint(stranger, 60 * USDC);

        vm.expectRevert();
        _send(stranger, id, 1, 100 * USDC, keccak256("poor"));
        assertEq(usdc.balanceOf(stranger), 60 * USDC);
        assertEq(usdc.balanceOf(landlord), 0);
    }

    // ------------------------------------------------------------------ receiver-side splits

    function test_AnyoneCanPayIntoReceiversSplit() public {
        address freelancer = makeAddr("freelancer");
        address savings = makeAddr("freelancer-savings");
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](2);
        legs[0] = _leg(savings, 0, 2000, "savings");
        legs[1] = _leg(freelancer, 0, 8000, "spending");
        uint256 id = _create(freelancer, legs);

        _send(sender, id, 1, 250 * USDC, keccak256("invoice-7"));
        assertEq(usdc.balanceOf(savings), 50 * USDC);
        assertEq(usdc.balanceOf(freelancer), 200 * USDC);
    }

    function test_ReceiverRunsOwnSplitOnIncomingFunds() public {
        // Money lands in the sister's wallet, then her own rule moves 30% to a savings pocket.
        address pocket = makeAddr("sister-savings");
        SplitsRouter.Leg[] memory rule = new SplitsRouter.Leg[](2);
        rule[0] = _leg(pocket, 0, 3000, "savings");
        rule[1] = _leg(sister, 0, 7000, "spending");
        uint256 ruleId = _create(sister, rule);

        uint256 familyId = _create(sender, _familyLegs());
        _send(sender, familyId, 1, 400 * USDC, keccak256("family"));
        assertEq(usdc.balanceOf(sister), 100 * USDC);

        vm.prank(sister);
        usdc.approve(address(router), 100 * USDC);
        _send(sister, ruleId, 1, 100 * USDC, keccak256("auto-split:family"));
        assertEq(usdc.balanceOf(pocket), 30 * USDC);
        assertEq(usdc.balanceOf(sister), 70 * USDC);
    }

    // ------------------------------------------------------------------ hostile inputs

    function test_ReentryFromTokenIsBlocked() public {
        ReentrantToken hostile = new ReentrantToken();
        SplitsRouter hostileRouter = new SplitsRouter(IERC20(address(hostile)));

        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = _leg(sister, 0, 10_000, "x");
        vm.prank(sender);
        uint256 id = hostileRouter.createSplit(legs);

        hostile.mint(sender, 10_000);
        vm.prank(sender);
        hostile.approve(address(hostileRouter), type(uint256).max);
        hostile.arm(hostileRouter, id);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _sendOn(hostileRouter, sender, id, 10_000, keccak256("outer"));
        assertEq(hostile.balanceOf(sister), 0);
    }

    function _sendOn(SplitsRouter r, address payer, uint256 id, uint256 amount, bytes32 ref) internal {
        vm.prank(payer);
        r.send(id, 1, amount, ref);
    }

    function test_RouterRefusesNativeValue() public {
        vm.deal(sender, 1 ether);
        vm.prank(sender);
        (bool ok,) = address(router).call{value: 1}("");
        assertFalse(ok);
    }

    function test_RevertWhen_DeployedWithZeroToken() public {
        vm.expectRevert(SplitsRouter.ZeroAddress.selector);
        new SplitsRouter(IERC20(address(0)));
    }

    // ------------------------------------------------------------------ fuzz: conservation

    function testFuzz_SharesConserveAmount(uint256 amount, uint16 a, uint16 b) public {
        amount = bound(amount, 1, 5_000_000) * 10_000; // whole cents up to $50,000
        a = uint16(bound(a, 1, 9998));
        b = uint16(bound(b, 1, 9999 - a));
        uint16 c = uint16(10_000 - a - b);

        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](3);
        legs[0] = _leg(landlord, 0, a, "a");
        legs[1] = _leg(school, 0, b, "b");
        legs[2] = _leg(sister, 0, c, "c");
        uint256 id = _create(sender, legs);

        uint256 before = usdc.balanceOf(sender);
        _send(sender, id, 1, amount, keccak256(abi.encode(amount, a, b)));

        uint256 received = usdc.balanceOf(landlord) + usdc.balanceOf(school) + usdc.balanceOf(sister);
        assertEq(received, amount);
        assertEq(before - usdc.balanceOf(sender), amount);
        assertEq(usdc.balanceOf(address(router)), 0);
        // Shares before the last are rounded down, never up, and every payout is whole cents.
        assertLe(usdc.balanceOf(landlord), amount * a / 10_000);
        assertLe(usdc.balanceOf(school), amount * b / 10_000);
        assertEq(usdc.balanceOf(landlord) % 10_000, 0);
        assertEq(usdc.balanceOf(school) % 10_000, 0);
        assertEq(usdc.balanceOf(sister) % 10_000, 0);
    }

    function testFuzz_FixedPlusShareConserveAmount(uint96 rent, uint96 fees, uint256 extra, uint16 a) public {
        rent = uint96(bound(rent, 1, 1_000_000) * 10_000);
        fees = uint96(bound(fees, 1, 1_000_000) * 10_000);
        extra = bound(extra, 0, 1_000_000) * 10_000;
        a = uint16(bound(a, 1, 9999));

        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](4);
        legs[0] = _leg(landlord, rent, 0, "rent");
        legs[1] = _leg(stranger, 0, a, "savings");
        legs[2] = _leg(school, fees, 0, "school fees");
        legs[3] = _leg(sister, 0, uint16(10_000 - a), "upkeep");
        uint256 id = _create(sender, legs);

        uint256 amount = uint256(rent) + fees + extra;
        uint256[] memory preview = router.previewSend(id, amount);
        _send(sender, id, 1, amount, keccak256(abi.encode(rent, fees, extra, a)));

        assertEq(usdc.balanceOf(landlord), rent);
        assertEq(usdc.balanceOf(school), fees);
        assertEq(usdc.balanceOf(stranger) + usdc.balanceOf(sister), extra);
        assertEq(usdc.balanceOf(stranger) % 10_000, 0);
        assertEq(usdc.balanceOf(sister) % 10_000, 0);
        assertEq(preview[0] + preview[1] + preview[2] + preview[3], amount);
        assertEq(usdc.balanceOf(address(router)), 0);
    }
}
