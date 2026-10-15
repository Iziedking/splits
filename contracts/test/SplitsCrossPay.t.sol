// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SplitsRouter} from "../src/SplitsRouter.sol";
import {SplitsCrossPay, IMessageTransmitterV2} from "../src/SplitsCrossPay.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockTransmitter} from "./mocks/MockTransmitter.sol";
import {CctpMessage} from "./helpers/CctpMessage.sol";

contract SplitsCrossPayTest is Test {
    uint256 constant USDC = 1e6;
    uint32 constant BASE = 6;
    /// The address CctpMessage.encode names as the message's recipient (TokenMessengerV2 on Arc).
    address constant TOKEN_MESSENGER = address(0x7e6);

    MockUSDC usdc;
    SplitsRouter router;
    MockTransmitter transmitter;
    SplitsCrossPay cross;

    address payer = makeAddr("payer");
    address landlord = makeAddr("landlord");
    address school = makeAddr("school");
    address feeWallet = makeAddr("fee");
    address relayer = makeAddr("relayer");
    uint256 nonceSeq;

    function setUp() public {
        usdc = new MockUSDC();
        router = new SplitsRouter(IERC20(address(usdc)));
        transmitter = new MockTransmitter(usdc);
        cross = new SplitsCrossPay(
            IERC20(address(usdc)), IMessageTransmitterV2(address(transmitter)), router, TOKEN_MESSENGER
        );
    }

    // ------------------------------------------------------------------ helpers

    function _legs() internal view returns (SplitsRouter.Leg[] memory legs) {
        legs = new SplitsRouter.Leg[](3);
        legs[0] = SplitsRouter.Leg(landlord, uint96(6 * USDC), 0, bytes32("rent"));
        legs[1] = SplitsRouter.Leg(school, uint96(4 * USDC), 0, bytes32("school"));
        legs[2] = SplitsRouter.Leg(feeWallet, uint96(15 * USDC / 100), 0, bytes32("splits fee"));
    }

    function _hook(SplitsRouter.Leg[] memory legs, uint256 payAmount, bytes32 ref)
        internal
        pure
        returns (bytes memory)
    {
        return _hookTo(address(0), legs, payAmount, ref);
    }

    function _hookTo(address refundTo, SplitsRouter.Leg[] memory legs, uint256 payAmount, bytes32 ref)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(uint8(1), refundTo, legs, payAmount, ref);
    }

    function _burn(uint256 amount, uint256 feeExecuted, address sender, bytes memory hook, address caller)
        internal
        returns (CctpMessage.Burn memory)
    {
        return CctpMessage.Burn({
            sourceDomain: BASE,
            nonce: keccak256(abi.encode(++nonceSeq)),
            destinationCaller: caller,
            mintRecipient: address(cross),
            amount: amount,
            messageSender: sender,
            maxFee: feeExecuted * 2,
            feeExecuted: feeExecuted,
            hookData: hook
        });
    }

    /// A burn of `amount` with `feeExecuted` taken, from `sender`, carrying `hook`, aimed at `caller`.
    function _message(uint256 amount, uint256 feeExecuted, address sender, bytes memory hook, address caller)
        internal
        returns (bytes memory)
    {
        return CctpMessage.encode(_burn(amount, feeExecuted, sender, hook, caller));
    }

    function _relay(bytes memory message) internal {
        vm.prank(relayer);
        cross.relay(message, "ok");
    }

    // ------------------------------------------------------------------ paying

    function test_RelayPaysTheSplitExactlyAndReturnsUnusedFee() public {
        uint256 payAmount = 1015 * USDC / 100; // 10.15
        bytes memory m = _message(payAmount + 3000, 1000, payer, _hook(_legs(), payAmount, "ref-1"), address(cross));
        vm.expectEmit(true, true, false, true, address(cross));
        emit SplitsCrossPay.CrossPaid("ref-1", payer, BASE, payAmount, 2000);
        _relay(m);
        assertEq(usdc.balanceOf(landlord), 6 * USDC);
        assertEq(usdc.balanceOf(school), 4 * USDC);
        assertEq(usdc.balanceOf(feeWallet), 15 * USDC / 100);
        assertEq(usdc.balanceOf(payer), 2000);
        assertEq(usdc.balanceOf(address(cross)), 0);
        assertEq(usdc.allowance(address(cross), address(router)), 0);
        assertTrue(router.refUsed(address(cross), cross.routerRef(BASE, payer, "ref-1")));
    }

    function test_ExtraBurnGoesBackToPayer() public {
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount + 50 * USDC, 0, payer, _hook(_legs(), payAmount, "ref-x"), address(cross)));
        assertEq(usdc.balanceOf(payer), 50 * USDC);
        assertEq(usdc.balanceOf(address(cross)), 0);
    }

    function test_SameRefFromDifferentPayersBothPay() public {
        // A stranger who copies a payer's public ref and relays first can't block that payer.
        address stranger = makeAddr("stranger");
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount, 0, stranger, _hook(_legs(), payAmount, "shared"), address(cross)));
        _relay(_message(payAmount, 0, payer, _hook(_legs(), payAmount, "shared"), address(cross)));
        assertEq(usdc.balanceOf(landlord), 12 * USDC);
        assertEq(usdc.balanceOf(payer), 0);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_FeeBackGoesToRefundTo() public {
        address wallet = makeAddr("arc wallet");
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount + 700, 0, payer, _hookTo(wallet, _legs(), payAmount, "ref-ft"), address(cross)));
        assertEq(usdc.balanceOf(wallet), 700);
        assertEq(usdc.balanceOf(payer), 0);
    }

    // ------------------------------------------------------------------ refunds

    function test_RevertingPayRefundsEverythingToTheBurner() public {
        usdc.setBlocked(school, true);
        uint256 payAmount = 1015 * USDC / 100;
        vm.expectEmit(true, true, false, true, address(cross));
        emit SplitsCrossPay.Refunded("ref-2", payer, payAmount + 2000, 1);
        _relay(_message(payAmount + 3000, 1000, payer, _hook(_legs(), payAmount, "ref-2"), address(cross)));
        assertEq(usdc.balanceOf(payer), payAmount + 2000);
        assertEq(usdc.balanceOf(landlord), 0);
        assertEq(usdc.balanceOf(address(cross)), 0);
        assertEq(usdc.allowance(address(cross), address(router)), 0);
    }

    function test_RefundGoesToRefundToWhenSet() public {
        usdc.setBlocked(school, true);
        address wallet = makeAddr("arc wallet");
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount, 0, payer, _hookTo(wallet, _legs(), payAmount, "ref-rt"), address(cross)));
        assertEq(usdc.balanceOf(wallet), payAmount);
        assertEq(usdc.balanceOf(payer), 0);
    }

    function test_BadLegsStillRefundToRefundTo() public {
        // The version and refund address decode; the rest of the hook is garbage.
        address wallet = makeAddr("arc wallet");
        bytes memory hook = bytes.concat(abi.encode(uint8(1), wallet), hex"deadbeef");
        _relay(_message(5 * USDC, 0, payer, hook, address(cross)));
        assertEq(usdc.balanceOf(wallet), 5 * USDC);
        assertEq(usdc.balanceOf(payer), 0);
    }

    function test_ShortMintRefunds() public {
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount, 1000, payer, _hook(_legs(), payAmount, "ref-3"), address(cross)));
        assertEq(usdc.balanceOf(payer), payAmount - 1000);
        assertEq(usdc.balanceOf(landlord), 0);
    }

    function test_BadHookRefunds() public {
        _relay(_message(5 * USDC, 0, payer, hex"deadbeef", address(cross)));
        assertEq(usdc.balanceOf(payer), 5 * USDC);
    }

    function test_EmptyHookRefunds() public {
        _relay(_message(5 * USDC, 0, payer, "", address(cross)));
        assertEq(usdc.balanceOf(payer), 5 * USDC);
    }

    function test_UnknownHookVersionRefunds() public {
        bytes memory hook = abi.encode(uint8(2), address(0), _legs(), 1015 * USDC / 100, bytes32("ref-v"));
        _relay(_message(11 * USDC, 0, payer, hook, address(cross)));
        assertEq(usdc.balanceOf(payer), 11 * USDC);
    }

    function test_RefundIgnoresAddressesInTheLegs() public {
        // A hook that names an attacker as a leg still pays only through the router; when it
        // can't pay, the money goes back to the burner, never to anyone the legs name.
        address attacker = makeAddr("attacker");
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = SplitsRouter.Leg(attacker, uint96(100 * USDC), 0, bytes32("x"));
        _relay(_message(5 * USDC, 0, payer, _hook(legs, 100 * USDC, "ref-f"), address(cross)));
        assertEq(usdc.balanceOf(attacker), 0);
        assertEq(usdc.balanceOf(payer), 5 * USDC);
    }

    function test_LegNamingTheContractRefunds() public {
        // The router would "pay" SplitsCrossPay itself, leaving the money here untracked.
        SplitsRouter.Leg[] memory legs = _legs();
        legs[0].recipient = address(cross);
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount, 0, payer, _hook(legs, payAmount, "ref-self"), address(cross)));
        assertEq(usdc.balanceOf(payer), payAmount);
        assertEq(usdc.balanceOf(address(cross)), 0);
    }

    function test_FailedApproveRefunds() public {
        // An approval the token refuses (the router blocklisted) must refund, not make the message undeliverable.
        usdc.setBlocked(address(router), true);
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount, 0, payer, _hook(_legs(), payAmount, "ref-ap"), address(cross)));
        assertEq(usdc.balanceOf(payer), payAmount);
        assertEq(usdc.balanceOf(address(cross)), 0);
    }

    function test_ReusedRefRefunds() public {
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount, 0, payer, _hook(_legs(), payAmount, "ref-same"), address(cross)));
        _relay(_message(payAmount, 0, payer, _hook(_legs(), payAmount, "ref-same"), address(cross)));
        assertEq(usdc.balanceOf(payer), payAmount);
        assertEq(usdc.balanceOf(landlord), 6 * USDC);
    }

    // ------------------------------------------------------------------ owed and claim

    function test_FailedRefundBecomesOwedAndPayerClaimsOnceUnblocked() public {
        usdc.setBlocked(school, true);
        usdc.setBlocked(payer, true);
        uint256 payAmount = 1015 * USDC / 100;
        _relay(_message(payAmount, 0, payer, _hook(_legs(), payAmount, "ref-4"), address(cross)));
        assertEq(cross.owed(payer), payAmount);
        assertEq(usdc.balanceOf(address(cross)), payAmount);

        // While blocked, the held refund stays put: it can't be routed to a clean address.
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(MockUSDC.Blocklisted.selector, payer));
        cross.claim();
        assertEq(cross.owed(payer), payAmount);

        usdc.setBlocked(payer, false);
        vm.prank(payer);
        cross.claim();
        assertEq(usdc.balanceOf(payer), payAmount);
        assertEq(cross.owed(payer), 0);
        assertEq(usdc.balanceOf(address(cross)), 0);
    }

    function test_ClaimWithNothingOwedReverts() public {
        vm.prank(payer);
        vm.expectRevert(SplitsCrossPay.NothingOwed.selector);
        cross.claim();
    }

    function test_OnlyThePayerCanClaimTheirRefund() public {
        usdc.setBlocked(school, true);
        usdc.setBlocked(payer, true);
        _relay(_message(11 * USDC, 0, payer, _hook(_legs(), 1015 * USDC / 100, "ref-5"), address(cross)));
        vm.prank(makeAddr("thief"));
        vm.expectRevert(SplitsCrossPay.NothingOwed.selector);
        cross.claim();
        assertEq(cross.owed(payer), 11 * USDC);
    }

    // ------------------------------------------------------------------ what can't be relayed

    function test_ReplayReverts() public {
        bytes memory m = _message(11 * USDC, 0, payer, _hook(_legs(), 1015 * USDC / 100, "ref-6"), address(cross));
        _relay(m);
        vm.prank(relayer);
        vm.expectRevert(MockTransmitter.NonceUsed.selector);
        cross.relay(m, "ok");
    }

    function test_ForgedAttestationReverts() public {
        bytes memory m = _message(11 * USDC, 0, payer, _hook(_legs(), 1015 * USDC / 100, "ref-7"), address(cross));
        vm.prank(relayer);
        vm.expectRevert(MockTransmitter.BadAttestation.selector);
        cross.relay(m, "forged");
    }

    function test_MessageForAnotherCallerCannotBeRelayedHere() public {
        bytes memory m = _message(11 * USDC, 0, payer, _hook(_legs(), 1015 * USDC / 100, "ref-8"), makeAddr("other"));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(MockTransmitter.WrongCaller.selector, address(cross), makeAddr("other")));
        cross.relay(m, "ok");
    }

    function test_NobodyCanMintAroundTheContract() public {
        bytes memory m = _message(11 * USDC, 0, payer, _hook(_legs(), 1015 * USDC / 100, "ref-9"), address(cross));
        vm.prank(relayer);
        vm.expectRevert(abi.encodeWithSelector(MockTransmitter.WrongCaller.selector, relayer, address(cross)));
        transmitter.receiveMessage(m, "ok");
    }

    function test_MessageNotForTokenMessengerReverts() public {
        // Any app can send a CCTP message with this contract as caller; only real burns count.
        bytes memory m = CctpMessage.encodeTo(
            _burn(11 * USDC, 0, payer, _hook(_legs(), 1015 * USDC / 100, "ref-n"), address(cross)), makeAddr("app")
        );
        vm.prank(relayer);
        vm.expectRevert(SplitsCrossPay.NotABurn.selector);
        cross.relay(m, "ok");
    }

    function test_ShortMessageReverts() public {
        vm.prank(relayer);
        vm.expectRevert(SplitsCrossPay.MessageTooShort.selector);
        cross.relay(hex"01", "ok");
    }

    function test_GasStarvedRelayRevertsInsteadOfRefunding() public {
        // A relayer that gives just enough gas for the refund path must not turn a payment into a refund.
        uint256 n = 150;
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](n);
        for (uint256 i; i < n; ++i) {
            legs[i] = SplitsRouter.Leg(address(uint160(0x5000 + i)), uint96(10_000), 0, bytes32("w"));
        }
        bytes memory m = _message(n * 10_000, 0, payer, _hook(legs, n * 10_000, "ref-gas"), address(cross));

        uint256 snap = vm.snapshotState();
        uint256 before = gasleft();
        cross.relay(m, "ok");
        uint256 full = before - gasleft();
        vm.revertToState(snap);

        uint256 refunds;
        for (uint256 g = full; g > full / 4; g -= full / 60) {
            snap = vm.snapshotState();
            try cross.relay{gas: g}(m, "ok") {
                if (usdc.balanceOf(payer) != 0) refunds++;
            } catch {}
            vm.revertToState(snap);
        }
        assertEq(refunds, 0);
    }

    // ------------------------------------------------------------------ setup and helpers

    function test_ConstructorRejectsMismatchedRouter() public {
        MockUSDC other = new MockUSDC();
        vm.expectRevert(SplitsCrossPay.RouterUsdcMismatch.selector);
        new SplitsCrossPay(IERC20(address(other)), IMessageTransmitterV2(address(transmitter)), router, TOKEN_MESSENGER);
    }

    function test_DecodeHookRoundTrips() public view {
        address wallet = address(0xa11ce);
        (address refundTo, SplitsRouter.Leg[] memory legs, uint256 amt, bytes32 ref) =
            cross.decodeHook(_hookTo(wallet, _legs(), 42, "r"));
        assertEq(refundTo, wallet);
        assertEq(legs.length, 3);
        assertEq(legs[1].recipient, school);
        assertEq(amt, 42);
        assertEq(ref, bytes32("r"));
    }

    function test_RouterRefIsPerSourceAndPayer() public view {
        assertTrue(cross.routerRef(BASE, payer, "r") != cross.routerRef(BASE, relayer, "r"));
        assertTrue(cross.routerRef(BASE, payer, "r") != cross.routerRef(3, payer, "r"));
        assertEq(cross.routerRef(BASE, payer, "r"), keccak256(abi.encode(BASE, payer, bytes32("r"))));
    }
}

contract SplitsCrossPayFuzzTest is SplitsCrossPayTest {
    /// Any burn amount, any fee, any number of fixed legs up to 40: the contract ends empty and
    /// every unit minted went either to the legs and the payer, or entirely to the payer.
    function testFuzz_RelayNeverKeepsMoney(uint96 burn, uint96 fee, uint8 legCount, uint96 legCents) public {
        legCount = uint8(bound(legCount, 1, 40));
        legCents = uint96(bound(legCents, 1, 1_000_000));
        burn = uint96(bound(burn, 1, 1_000_000_000 * USDC));
        fee = uint96(bound(fee, 0, burn));
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](legCount);
        uint256 payAmount;
        for (uint256 i; i < legCount; ++i) {
            legs[i] = SplitsRouter.Leg(address(uint160(0x1000 + i)), legCents * 10_000, 0, bytes32("p"));
            payAmount += uint256(legCents) * 10_000;
        }
        _relay(
            _message(
                burn, fee, payer, _hook(legs, payAmount, keccak256(abi.encode(burn, fee, legCount))), address(cross)
            )
        );
        uint256 minted = uint256(burn) - fee;
        assertEq(usdc.balanceOf(address(cross)), 0);
        if (minted >= payAmount) {
            assertEq(usdc.balanceOf(payer), minted - payAmount);
            assertEq(usdc.balanceOf(address(uint160(0x1000))), uint256(legCents) * 10_000);
        } else {
            assertEq(usdc.balanceOf(payer), minted);
        }
    }
}

contract CrossPayHandler is Test {
    SplitsCrossPay cross;
    MockUSDC usdc;
    address[3] payers;
    uint256 seq;
    uint256 public ghostOwed;

    constructor(SplitsCrossPay cross_, MockUSDC usdc_) {
        cross = cross_;
        usdc = usdc_;
        payers = [makeAddr("p0"), makeAddr("p1"), makeAddr("p2")];
    }

    function relay(uint96 amount, uint96 payAmount, uint8 who, bool blockPayer, bool blockLeg) external {
        amount = uint96(bound(amount, 1, 1e15));
        payAmount = uint96(bound(payAmount, 1, 1e15)) / 10_000 * 10_000 + 10_000;
        address payer = payers[who % 3];
        address leg = makeAddr("leg");
        usdc.setBlocked(payer, blockPayer);
        usdc.setBlocked(leg, blockLeg);
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = SplitsRouter.Leg(leg, uint96(payAmount), 0, bytes32("p"));
        bytes memory m = CctpMessage.encode(
            CctpMessage.Burn({
                sourceDomain: 6,
                nonce: keccak256(abi.encode("inv", ++seq)),
                destinationCaller: address(cross),
                mintRecipient: address(cross),
                amount: amount,
                messageSender: payer,
                maxFee: 0,
                feeExecuted: 0,
                hookData: abi.encode(uint8(1), address(0), legs, uint256(payAmount), keccak256(abi.encode(seq)))
            })
        );
        uint256 owedBefore = cross.owed(payer);
        cross.relay(m, "ok");
        ghostOwed += cross.owed(payer) - owedBefore;
        usdc.setBlocked(payer, false);
        usdc.setBlocked(leg, false);
    }

    function claim(uint8 who) external {
        address payer = payers[who % 3];
        uint256 amount = cross.owed(payer);
        if (amount == 0) return;
        vm.prank(payer);
        cross.claim();
        ghostOwed -= amount;
    }
}

contract SplitsCrossPayInvariantTest is Test {
    MockUSDC usdc;
    SplitsCrossPay cross;
    CrossPayHandler handler;

    function setUp() public {
        usdc = new MockUSDC();
        SplitsRouter router = new SplitsRouter(IERC20(address(usdc)));
        MockTransmitter transmitter = new MockTransmitter(usdc);
        cross = new SplitsCrossPay(
            IERC20(address(usdc)), IMessageTransmitterV2(address(transmitter)), router, address(0x7e6)
        );
        handler = new CrossPayHandler(cross, usdc);
        targetContract(address(handler));
    }

    /// The contract holds exactly what it owes: never less, and never anything of its own.
    function invariant_BalanceEqualsOwed() public view {
        assertEq(usdc.balanceOf(address(cross)), handler.ghostOwed());
    }
}
