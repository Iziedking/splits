// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MockUSDC} from "./MockUSDC.sol";

/// @dev MessageTransmitterV2 stand-in: checks the attestation ("ok"), the nonce and the
///      destination caller like the real one, then mints amount - feeExecuted to mintRecipient.
contract MockTransmitter {
    MockUSDC public immutable usdc;
    mapping(bytes32 => bool) public usedNonces;

    error BadAttestation();
    error NonceUsed();
    error WrongCaller(address caller, address expected);

    constructor(MockUSDC usdc_) {
        usdc = usdc_;
    }

    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool) {
        if (keccak256(attestation) != keccak256("ok")) revert BadAttestation();
        bytes32 nonce = bytes32(message[12:44]);
        if (usedNonces[nonce]) revert NonceUsed();
        address caller = address(uint160(uint256(bytes32(message[108:140]))));
        if (caller != address(0) && caller != msg.sender) revert WrongCaller(msg.sender, caller);
        usedNonces[nonce] = true;
        address recipient = address(uint160(uint256(bytes32(message[184:216]))));
        uint256 amount = uint256(bytes32(message[216:248]));
        uint256 feeExecuted = uint256(bytes32(message[312:344]));
        usdc.mint(recipient, amount - feeExecuted);
        return true;
    }
}
