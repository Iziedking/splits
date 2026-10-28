// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SplitsRouter} from "../src/SplitsRouter.sol";
import {SplitsCrossPay, IMessageTransmitterV2} from "../src/SplitsCrossPay.sol";
import {CctpMessage} from "./helpers/CctpMessage.sol";

/// @dev Runs the router against the real USDC interface on a fork of Arc. Needs arc-forge, since
///      stock forge does not model Arc's native USDC. Skipped unless ARC_FORK_RPC is set.
contract ArcForkTest is Test {
    IERC20 constant ARC_USDC = IERC20(0x3600000000000000000000000000000000000000);

    SplitsRouter router;
    address payer = makeAddr("payer");
    address landlord = makeAddr("landlord");
    address school = makeAddr("school");
    address sister = makeAddr("sister");

    function setUp() public {
        string memory rpc = vm.envOr("ARC_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        router = new SplitsRouter(ARC_USDC);
    }

    function test_Fork_UsdcInterfaceFacts() public view {
        assertEq(IERC20Metadata(address(ARC_USDC)).decimals(), 6);
    }

    function test_Fork_NativeBalanceShowsThroughErc20() public {
        // 50 USDC of native gas balance (18 decimals) is 50 USDC on the 6-decimal interface.
        vm.deal(payer, 50 ether);
        assertEq(ARC_USDC.balanceOf(payer), 50e6);
    }

    function test_Fork_SplitPaysRealUsdc() public {
        vm.deal(payer, 50 ether);

        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](3);
        legs[0] = SplitsRouter.Leg(landlord, 0, 4000, bytes32("rent"));
        legs[1] = SplitsRouter.Leg(school, 0, 3500, bytes32("school fees"));
        legs[2] = SplitsRouter.Leg(sister, 0, 2500, bytes32("upkeep"));

        vm.startPrank(payer);
        uint256 id = router.createSplit(legs);
        ARC_USDC.approve(address(router), 10e6);
        router.send(id, 1, 10e6, keccak256("fork-1"));
        vm.stopPrank();

        assertEq(ARC_USDC.balanceOf(landlord), 4e6);
        assertEq(ARC_USDC.balanceOf(school), 3_500_000);
        assertEq(ARC_USDC.balanceOf(sister), 2_500_000);
        assertEq(ARC_USDC.balanceOf(address(router)), 0);
        assertEq(ARC_USDC.allowance(payer, address(router)), 0);
        // The native view moves with the ERC-20 view: 40 USDC left, less nothing for gas in a prank.
        assertEq(payer.balance, 40 ether);
    }

    /// @dev Measures what one more recipient costs in a one-off `pay`, against real Arc USDC. The
    ///      app's recipient ceiling (MAX_RECIPIENTS_CEILING in web/src/server/domain/payouts.ts)
    ///      is derived from these numbers.
    function test_Fork_PayGasPerRecipient() public {
        vm.deal(payer, 1_000 ether);
        vm.prank(payer);
        ARC_USDC.approve(address(router), type(uint256).max);

        uint256[4] memory sizes = [uint256(1), 10, 50, 100];
        uint256[4] memory used;
        for (uint256 k; k < sizes.length; ++k) {
            SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](sizes[k]);
            for (uint256 i; i < sizes[k]; ++i) {
                legs[i] = SplitsRouter.Leg(address(uint160(0xA0000 + k * 1000 + i)), 10_000, 0, bytes32("gas"));
            }
            vm.prank(payer);
            uint256 g = gasleft();
            router.pay(legs, sizes[k] * 10_000, keccak256(abi.encode("gas", k)));
            used[k] = g - gasleft();
            emit log_named_uint(string.concat("pay gas, recipients=", vm.toString(sizes[k])), used[k]);
        }
        uint256 perLeg = (used[3] - used[1]) / 90;
        emit log_named_uint("GAS_PER_LEG", perLeg);
        emit log_named_uint("BLOCK_GAS_LIMIT", block.gaslimit);
        emit log_named_uint("SAFE_RECIPIENTS (half a block)", (block.gaslimit / 2) / perLeg);
        assertGt(perLeg, 0);
    }

    /// @dev What a visitor's own wallet does: approve the exact total, then pay. The app's verifier
    ///      needs SplitSent with this payer and ref, and one LegPaid per leg.
    function test_Fork_PlainWalletApprovesAndPays() public {
        vm.deal(payer, 10 ether);
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](2);
        legs[0] = SplitsRouter.Leg(landlord, 2e6, 0, bytes32("gift"));
        legs[1] = SplitsRouter.Leg(school, 3e6, 0, bytes32("gift"));
        bytes32 ref = keccak256("visitor-fork-1");

        vm.startPrank(payer);
        ARC_USDC.approve(address(router), 5e6);
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.SplitSent(0, payer, ref, 5e6, 0);
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.LegPaid(0, ref, landlord, 2e6, bytes32("gift"));
        vm.expectEmit(true, true, true, true, address(router));
        emit SplitsRouter.LegPaid(0, ref, school, 3e6, bytes32("gift"));
        router.pay(legs, 5e6, ref);
        vm.stopPrank();

        assertTrue(router.refUsed(payer, ref));
        assertEq(ARC_USDC.allowance(payer, address(router)), 0);
        assertEq(ARC_USDC.balanceOf(landlord), 2e6);
    }

    IMessageTransmitterV2 constant ARC_TRANSMITTER = IMessageTransmitterV2(0x81D40F21F12A8F0E3252Bccb954D722d4c464B64);
    address constant ARC_TOKEN_MESSENGER = 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d;

    function test_Fork_CrossPayRejectsAForgedAttestation() public {
        SplitsCrossPay cross = new SplitsCrossPay(ARC_USDC, ARC_TRANSMITTER, router, ARC_TOKEN_MESSENGER);
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](1);
        legs[0] = SplitsRouter.Leg(landlord, uint96(1e6), 0, bytes32("rent"));
        bytes memory m = CctpMessage.encodeTo(
            CctpMessage.Burn({
                sourceDomain: 6,
                nonce: keccak256("fork-forged"),
                destinationCaller: address(cross),
                mintRecipient: address(cross),
                amount: 1e6,
                messageSender: payer,
                maxFee: 0,
                feeExecuted: 0,
                hookData: abi.encode(uint8(1), address(0), legs, uint256(1e6), bytes32("fork"))
            }),
            ARC_TOKEN_MESSENGER
        );
        vm.expectRevert();
        cross.relay(m, new bytes(65));
        assertEq(ARC_USDC.balanceOf(landlord), 0);
    }

    function test_Fork_CrossPayPaysRealUsdcThroughTheRouter() public {
        // A stand-in transmitter holding real USDC plays Circle's mint; the router and USDC are real.
        ForkTransmitter t = new ForkTransmitter(ARC_USDC);
        vm.deal(address(t), 20 ether); // 20 USDC
        SplitsCrossPay cross =
            new SplitsCrossPay(ARC_USDC, IMessageTransmitterV2(address(t)), router, ARC_TOKEN_MESSENGER);
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](2);
        legs[0] = SplitsRouter.Leg(landlord, uint96(6e6), 0, bytes32("rent"));
        legs[1] = SplitsRouter.Leg(school, uint96(4e6), 0, bytes32("school"));
        bytes memory m = CctpMessage.encodeTo(
            CctpMessage.Burn({
                sourceDomain: 6,
                nonce: keccak256("fork-real"),
                destinationCaller: address(cross),
                mintRecipient: address(cross),
                amount: 10_002_000,
                messageSender: payer,
                maxFee: 2000,
                feeExecuted: 1000,
                hookData: abi.encode(uint8(1), address(0), legs, uint256(10e6), bytes32("fork-real"))
            }),
            ARC_TOKEN_MESSENGER
        );
        cross.relay(m, "ok");
        assertEq(ARC_USDC.balanceOf(landlord), 6e6);
        assertEq(ARC_USDC.balanceOf(school), 4e6);
        assertEq(ARC_USDC.balanceOf(payer), 1000);
        assertEq(ARC_USDC.balanceOf(address(cross)), 0);
    }

    /// Audit 2026-10-28: anyone may relay with any gas limit. Against real Arc USDC, no limit may turn
    /// a payable split into a refund: each try either pays or reverts (and can be relayed again).
    function test_Fork_NoGasLimitTurnsAPaymentIntoARefund() public {
        ForkTransmitter t = new ForkTransmitter(ARC_USDC);
        vm.deal(address(t), 20 ether); // 20 USDC
        SplitsCrossPay cross =
            new SplitsCrossPay(ARC_USDC, IMessageTransmitterV2(address(t)), router, ARC_TOKEN_MESSENGER);
        uint256 n = 20;
        SplitsRouter.Leg[] memory legs = new SplitsRouter.Leg[](n);
        for (uint256 i; i < n; ++i) {
            legs[i] = SplitsRouter.Leg(address(uint160(0xA000 + i)), uint96(500_000), 0, bytes32("w"));
        }
        bytes memory m = CctpMessage.encodeTo(
            CctpMessage.Burn({
                sourceDomain: 6,
                nonce: keccak256("fork-gas"),
                destinationCaller: address(cross),
                mintRecipient: address(cross),
                amount: n * 500_000,
                messageSender: payer,
                maxFee: 0,
                feeExecuted: 0,
                hookData: abi.encode(uint8(1), address(0), legs, n * 500_000, bytes32("fork-gas"))
            }),
            ARC_TOKEN_MESSENGER
        );

        uint256 snap = vm.snapshotState();
        uint256 before = gasleft();
        cross.relay(m, "ok");
        uint256 full = before - gasleft();
        vm.revertToState(snap);

        // Coarse, to find the least gas that still pays; then gas by gas (100 at a time) just below
        // it, where a relay runs out inside the payout and a refund could slip in.
        uint256 lowestPaid = type(uint256).max;
        uint256 refunds;
        for (uint256 g = full + full / 10; g > full / 2; g -= full / 100) {
            (bool ok, bool refunded) = _relayWith(cross, m, g, n * 500_000);
            if (refunded) refunds++;
            else if (ok) lowestPaid = g;
        }
        assertLt(lowestPaid, type(uint256).max);
        for (uint256 g = lowestPaid; g > lowestPaid - full / 50; g -= 100) {
            (, bool refunded) = _relayWith(cross, m, g, n * 500_000);
            if (refunded) refunds++;
        }
        assertEq(refunds, 0);
    }

    /// One relay with `gas`, undone afterwards: whether it went through, and whether it refunded.
    function _relayWith(SplitsCrossPay cross, bytes memory m, uint256 gas, uint256 minted)
        internal
        returns (bool ok, bool refunded)
    {
        uint256 snap = vm.snapshotState();
        try cross.relay{gas: gas}(m, "ok") {
            ok = true;
            refunded = ARC_USDC.balanceOf(payer) == minted;
        } catch {}
        vm.revertToState(snap);
    }
}

/// @dev Plays MessageTransmitterV2 on the fork: sends real USDC it holds to the message's recipient.
contract ForkTransmitter {
    IERC20 immutable usdc;

    constructor(IERC20 usdc_) {
        usdc = usdc_;
    }

    function receiveMessage(bytes calldata message, bytes calldata) external returns (bool) {
        address recipient = address(uint160(uint256(bytes32(message[184:216]))));
        uint256 amount = uint256(bytes32(message[216:248])) - uint256(bytes32(message[312:344]));
        return usdc.transfer(recipient, amount);
    }
}
