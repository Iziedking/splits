// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SplitsRouter} from "../src/SplitsRouter.sol";
import {SplitsCrossPay, IMessageTransmitterV2} from "../src/SplitsCrossPay.sol";

/// @notice Deploys SplitsCrossPay next to an existing SplitsRouter.
/// @dev Sign with a Foundry keystore (`--account <name>`), never a raw key flag. The contract has no
///      owner, so the deployer key holds no power over it after this transaction.
///      CCTP_TRANSMITTER: 0x81D40F21F12A8F0E3252Bccb954D722d4c464B64 (mainnet),
///      0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275 (testnet).
///      CCTP_TOKEN_MESSENGER: 0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d (mainnet),
///      0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA (testnet).
contract DeployCrossPay is Script {
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (SplitsCrossPay cross) {
        address usdc = vm.envOr("USDC_ADDRESS", ARC_USDC);
        SplitsRouter router = SplitsRouter(vm.envAddress("SPLITS_ROUTER_ADDRESS"));
        IMessageTransmitterV2 transmitter = IMessageTransmitterV2(vm.envAddress("CCTP_TRANSMITTER"));
        address tokenMessenger = vm.envAddress("CCTP_TOKEN_MESSENGER");
        vm.startBroadcast();
        cross = new SplitsCrossPay(IERC20(usdc), transmitter, router, tokenMessenger);
        vm.stopBroadcast();
        console2.log("chainId", block.chainid);
        console2.log("SplitsCrossPay", address(cross));
        console2.log("router", address(router));
        console2.log("transmitter", address(transmitter));
        console2.log("tokenMessenger", tokenMessenger);
    }
}
