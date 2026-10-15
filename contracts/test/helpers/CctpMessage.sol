// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev Builds CCTP V2 burn messages exactly as MessageTransmitterV2 emits them: a 148-byte header
///      (version, sourceDomain, destinationDomain, nonce, sender, recipient, destinationCaller,
///      minFinalityThreshold, finalityThresholdExecuted) then the burn body (version, burnToken,
///      mintRecipient, amount, messageSender, maxFee, feeExecuted, expirationBlock, hookData).
library CctpMessage {
    uint32 constant ARC = 26;

    struct Burn {
        uint32 sourceDomain;
        bytes32 nonce;
        address destinationCaller;
        address mintRecipient;
        uint256 amount;
        address messageSender;
        uint256 maxFee;
        uint256 feeExecuted;
        bytes hookData;
    }

    /// @dev The message as Arc's TokenMessengerV2 (the test stand-in at 0x7e6) receives it.
    function encode(Burn memory b) internal pure returns (bytes memory) {
        return encodeTo(b, address(0x7e6));
    }

    /// @dev The same message addressed to `recipient` on Arc (a real TokenMessengerV2, or anything else).
    function encodeTo(Burn memory b, address recipient) internal pure returns (bytes memory) {
        bytes memory header = abi.encodePacked(
            uint32(1),
            b.sourceDomain,
            ARC,
            b.nonce,
            bytes32(uint256(uint160(address(0x7e5)))), // source TokenMessenger
            bytes32(uint256(uint160(recipient))), // destination: TokenMessengerV2 on Arc
            bytes32(uint256(uint160(b.destinationCaller))),
            uint32(1000),
            uint32(1000)
        );
        bytes memory body = abi.encodePacked(
            uint32(1),
            bytes32(uint256(uint160(address(0xb0b)))), // burn token on the source chain
            bytes32(uint256(uint160(b.mintRecipient))),
            b.amount,
            bytes32(uint256(uint160(b.messageSender))),
            b.maxFee,
            b.feeExecuted,
            uint256(0),
            b.hookData
        );
        return bytes.concat(header, body);
    }
}
