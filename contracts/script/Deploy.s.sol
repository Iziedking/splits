// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SplitsRouter} from "../src/SplitsRouter.sol";

/// @notice Deploys SplitsRouter against Arc's USDC interface, at the address deployments/*.json record.
/// @dev Through the CREATE2 factory 0x4e59b44847b379578588920cA78FbF26c0B4956C with the salt
///      web/scripts/deploy-router.mjs uses, so the same bytecode lands at the same address on Arc
///      mainnet and testnet whoever sends it. Sign with a Foundry keystore (`--account <name>`), never
///      a raw key flag. The router has no owner, so the deployer key holds no power over it.
contract Deploy is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    bytes32 constant SALT = keccak256("splits.router.v1");

    function run() external returns (SplitsRouter router) {
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        vm.startBroadcast();
        router = new SplitsRouter{salt: SALT}(IERC20(usdc));
        vm.stopBroadcast();
        console2.log("chainId", block.chainid);
        console2.log("SplitsRouter", address(router));
        console2.log("usdc", usdc);
    }
}
