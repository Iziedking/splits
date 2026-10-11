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

    function test_RevertWhen_TooManyLegs() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](11);
        for (uint256 i; i < 11; ++i) {
            legs[i] = _leg(address(uint160(0x1000 + i)), 1, 0, "x");
        }
        vm.expectRevert(abi.encodeWithSelector(SplitsRouter.TooManyLegs.selector, 11, 10));
        _create(sender, legs);
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

    function test_Send_RoundingDustGoesToLastShareLeg() public {
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](3);
        legs[0] = _leg(landlord, 0, 3333, "a");
        legs[1] = _leg(school, 0, 3333, "b");
        legs[2] = _leg(sister, 0, 3334, "c");
        uint256 id = _create(sender, legs);

        uint256[] memory amounts = _send(sender, id, 1, 1_000_001, keccak256("dust"));
        assertEq(amounts[0], 333_300);
        assertEq(amounts[1], 333_300);
        assertEq(amounts[2], 333_401);
        assertEq(amounts[0] + amounts[1] + amounts[2], 1_000_001);
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
        uint256[] memory preview = router.previewSend(id, 123_456_789);
        uint256[] memory paid = _send(sender, id, 1, 123_456_789, keccak256("p"));
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

        hostile.mint(sender, 100);
        vm.prank(sender);
        hostile.approve(address(hostileRouter), type(uint256).max);
        hostile.arm(hostileRouter, id);

        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _sendOn(hostileRouter, sender, id, 100, keccak256("outer"));
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
        amount = bound(amount, 1, 50_000 * USDC);
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
        // No share leg is paid more than its exact pro-rata amount rounded up by the dust.
        assertLe(usdc.balanceOf(landlord), amount * a / 10_000);
        assertLe(usdc.balanceOf(school), amount * b / 10_000);
    }

    function testFuzz_FixedPlusShareConserveAmount(uint96 rent, uint96 fees, uint256 extra, uint16 a) public {
        rent = uint96(bound(rent, 1, 10_000 * USDC));
        fees = uint96(bound(fees, 1, 10_000 * USDC));
        extra = bound(extra, 0, 10_000 * USDC);
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
        assertEq(preview[0] + preview[1] + preview[2] + preview[3], amount);
        assertEq(usdc.balanceOf(address(router)), 0);
    }
}
