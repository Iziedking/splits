// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SplitsRouter} from "../src/SplitsRouter.sol";

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
}
