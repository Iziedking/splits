// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SplitsRouter} from "../src/SplitsRouter.sol";

/// @notice Deploys SplitsRouter against Arc's USDC interface.
/// @dev Sign with a Foundry keystore (`--account <name>`), never a raw key flag. The router has
///      no owner, so the deployer key holds no power over it after this transaction.
contract Deploy is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (SplitsRouter router) {
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        vm.startBroadcast();
        router = new SplitsRouter(IERC20(usdc));
        vm.stopBroadcast();
        console2.log("chainId", block.chainid);
        console2.log("SplitsRouter", address(router));
        console2.log("usdc", usdc);
    }
}
