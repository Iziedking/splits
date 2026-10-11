// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title SplitsRouter
/// @notice Pays one USDC amount to several recipients in a single transaction, following a split
///         its owner registered onchain. Every leg carries a purpose label ("rent", "school fees"),
///         so each payout leaves a public receipt of what the money was for.
///
/// @dev Fund paths. USDC moves in exactly one place: `send`, which calls
///      `usdc.safeTransferFrom(payer, leg.recipient, legAmount)` once per leg, where `payer` is
///      always `msg.sender`. The contract never holds USDC. It has no payable function, no receive
///      or fallback, no owner, no fee and no rescue function, so there is nothing to drain and no
///      key that can redirect a payment.
///
///      A split owner can only change where future payments against their own split go. A payer
///      who quoted version N passes `expectedVersion = N`, so an edit that lands in between makes
///      the payment revert instead of paying the new recipients.
///
///      Amounts use the 6-decimal ERC-20 interface of USDC (0x3600...0000 on Arc). Native
///      18-decimal value is never read or sent, so the two decimal systems cannot be mixed.
///
///      A send is all or nothing. If any leg reverts (for example an Arc-blocklisted recipient or a
///      short allowance), no recipient is paid and the payer's `ref` stays unused.
contract SplitsRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_LEGS = 10;

    // ------------------------------------------------------------------ types

    /// @dev A leg is either a fixed amount or a share of what is left after the fixed legs.
    ///      Exactly one of `fixedAmount` and `shareBps` is non-zero.
    struct Leg {
        address recipient;
        uint96 fixedAmount;
        uint16 shareBps;
        bytes32 purpose;
    }

    struct Split {
        address owner;
        uint32 version;
        bool active;
        Leg[] legs;
    }

    // ------------------------------------------------------------------ storage

    IERC20 public immutable usdc;

    uint256 public nextSplitId = 1;

    mapping(uint256 splitId => Split) private _splits;

    /// @notice Refs a payer has already used. The backend derives `ref` from its own transfer id,
    ///         so a retried request can never pay twice.
    mapping(address payer => mapping(bytes32 ref => bool)) public refUsed;

    // ------------------------------------------------------------------ events

    event SplitCreated(uint256 indexed splitId, address indexed owner);
    event SplitLegsSet(uint256 indexed splitId, uint32 version, Leg[] legs);
    event SplitActiveSet(uint256 indexed splitId, bool active);
    event SplitSent(
        uint256 indexed splitId, address indexed payer, bytes32 indexed ref, uint256 amount, uint32 version
    );
    event LegPaid(
        uint256 indexed splitId, bytes32 indexed ref, address indexed recipient, uint256 amount, bytes32 purpose
    );

    // ------------------------------------------------------------------ errors

    error ZeroAddress();
    error NoLegs();
    error TooManyLegs(uint256 count, uint256 max);
    error InvalidRecipient(uint256 index, address recipient);
    error LegNeedsExactlyOneRule(uint256 index);
    error SharesMustTotal(uint256 totalBps);
    error SplitNotFound(uint256 splitId);
    error NotSplitOwner(uint256 splitId, address caller);
    error SplitInactive(uint256 splitId);
    error VersionMismatch(uint256 splitId, uint32 expected, uint32 current);
    error ZeroAmount();
    error ZeroRef();
    error RefAlreadyUsed(address payer, bytes32 ref);
    error AmountBelowFixed(uint256 amount, uint256 fixedTotal);
    error AmountMustEqualFixed(uint256 amount, uint256 fixedTotal);

    // ------------------------------------------------------------------ setup

    constructor(IERC20 usdc_) {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    // ------------------------------------------------------------------ split management

    function createSplit(Leg[] calldata legs) external returns (uint256 splitId) {
        _validate(legs);
        splitId = nextSplitId++;
        Split storage s = _splits[splitId];
        s.owner = msg.sender;
        s.version = 1;
        s.active = true;
        _storeLegs(s, legs);
        emit SplitCreated(splitId, msg.sender);
        emit SplitLegsSet(splitId, 1, legs);
    }

    function updateSplit(uint256 splitId, Leg[] calldata legs) external returns (uint32 version) {
        Split storage s = _ownedSplit(splitId);
        _validate(legs);
        _storeLegs(s, legs);
        version = ++s.version;
        emit SplitLegsSet(splitId, version, legs);
    }

    function setActive(uint256 splitId, bool active) external {
        Split storage s = _ownedSplit(splitId);
        s.active = active;
        emit SplitActiveSet(splitId, active);
    }

    // ------------------------------------------------------------------ payment

    /// @notice Pull `amount` USDC from the caller and pay it out across the split's legs.
    /// @dev The caller must have approved this contract for at least `amount`. Anyone may pay into
    ///      an active split, which is how a receiver's own split applies to money sent to them.
    function send(uint256 splitId, uint32 expectedVersion, uint256 amount, bytes32 ref)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        Split storage s = _splits[splitId];
        if (s.owner == address(0)) revert SplitNotFound(splitId);
        if (!s.active) revert SplitInactive(splitId);
        if (s.version != expectedVersion) revert VersionMismatch(splitId, expectedVersion, s.version);
        if (amount == 0) revert ZeroAmount();
        if (ref == bytes32(0)) revert ZeroRef();
        if (refUsed[msg.sender][ref]) revert RefAlreadyUsed(msg.sender, ref);

        refUsed[msg.sender][ref] = true;
        amounts = _allocate(s.legs, amount);
        emit SplitSent(splitId, msg.sender, ref, amount, s.version);

        uint256 count = amounts.length;
        for (uint256 i; i < count; ++i) {
            if (amounts[i] == 0) continue;
            Leg storage leg = s.legs[i];
            usdc.safeTransferFrom(msg.sender, leg.recipient, amounts[i]);
            emit LegPaid(splitId, ref, leg.recipient, amounts[i], leg.purpose);
        }
    }

    // ------------------------------------------------------------------ views

    function getSplit(uint256 splitId)
        external
        view
        returns (address owner, uint32 version, bool active, Leg[] memory legs)
    {
        Split storage s = _splits[splitId];
        if (s.owner == address(0)) revert SplitNotFound(splitId);
        return (s.owner, s.version, s.active, s.legs);
    }

    /// @notice The exact per-leg amounts `send` would pay for `amount`. Reverts the same way.
    function previewSend(uint256 splitId, uint256 amount) external view returns (uint256[] memory) {
        Split storage s = _splits[splitId];
        if (s.owner == address(0)) revert SplitNotFound(splitId);
        if (amount == 0) revert ZeroAmount();
        return _allocate(s.legs, amount);
    }

    // ------------------------------------------------------------------ internals

    function _ownedSplit(uint256 splitId) private view returns (Split storage s) {
        s = _splits[splitId];
        if (s.owner == address(0)) revert SplitNotFound(splitId);
        if (s.owner != msg.sender) revert NotSplitOwner(splitId, msg.sender);
    }

    function _validate(Leg[] calldata legs) private view {
        uint256 count = legs.length;
        if (count == 0) revert NoLegs();
        if (count > MAX_LEGS) revert TooManyLegs(count, MAX_LEGS);

        uint256 totalBps;
        for (uint256 i; i < count; ++i) {
            address r = legs[i].recipient;
            if (r == address(0) || r == address(this) || r == address(usdc)) revert InvalidRecipient(i, r);
            bool hasFixed = legs[i].fixedAmount != 0;
            bool hasShare = legs[i].shareBps != 0;
            if (hasFixed == hasShare) revert LegNeedsExactlyOneRule(i);
            totalBps += legs[i].shareBps;
        }
        if (totalBps != 0 && totalBps != BPS_DENOMINATOR) revert SharesMustTotal(totalBps);
    }

    function _storeLegs(Split storage s, Leg[] calldata legs) private {
        delete s.legs;
        uint256 count = legs.length;
        for (uint256 i; i < count; ++i) {
            s.legs.push(legs[i]);
        }
    }

    /// @dev Fixed legs are paid first. The rest is shared by bps, and the last share leg takes the
    ///      rounding remainder, so the amounts always sum to exactly `amount`.
    function _allocate(Leg[] storage legs, uint256 amount) private view returns (uint256[] memory amounts) {
        uint256 count = legs.length;
        amounts = new uint256[](count);

        uint256 fixedTotal;
        uint256 lastShare = type(uint256).max;
        for (uint256 i; i < count; ++i) {
            if (legs[i].fixedAmount != 0) fixedTotal += legs[i].fixedAmount;
            else lastShare = i;
        }

        if (amount < fixedTotal) revert AmountBelowFixed(amount, fixedTotal);
        uint256 remainder = amount - fixedTotal;
        if (lastShare == type(uint256).max && remainder != 0) revert AmountMustEqualFixed(amount, fixedTotal);

        uint256 shared;
        for (uint256 i; i < count; ++i) {
            if (legs[i].fixedAmount != 0) {
                amounts[i] = legs[i].fixedAmount;
            } else if (i == lastShare) {
                amounts[i] = remainder - shared;
            } else {
                uint256 part = remainder * legs[i].shareBps / BPS_DENOMINATOR;
                amounts[i] = part;
                shared += part;
            }
        }
    }
}
