// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SplitsRouter} from "./SplitsRouter.sol";

interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/// @title SplitsCrossPay
/// @notice Pays a split on Arc with USDC burned on another chain through CCTP V2. The payer burns
///         with this contract as both mintRecipient and destinationCaller, and the split in the
///         hook data. `relay` mints, then pays through SplitsRouter.pay in the same transaction.
///         If the split can't be paid, everything minted goes back to the payer on Arc (the hook's
///         refund address, or the burner). If even that transfer fails, it is held for them to claim.
/// @dev No owner and no admin. Money only leaves through router.pay, a transfer to the payer, or
///      the payer's own claim. USDC that reaches this contract any other way (a direct transfer, or
///      a burn without this contract as destinationCaller) is not tracked and stays here.
///      Hook data: abi.encode(uint8 version, address refundTo, Leg[] legs, uint256 payAmount, bytes32 ref).
///      The payer is always the burner CCTP attests (the body's messageSender): it keys the router ref
///      and is the payer in CrossPaid. The hook's refundTo only says where refunds and change go, so a
///      stranger's burn can never spend, or speak for, another payer's ref.
contract SplitsCrossPay is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint8 public constant HOOK_VERSION = 1;
    /// @notice A hook with more legs is refunded: its payout could never fit in an Arc block, and a
    ///         message whose relay always runs out of gas could never be minted or refunded.
    uint256 public constant MAX_LEGS = 300;

    // CCTP V2 message layout: a 148-byte header, then the burn body.
    uint256 private constant SOURCE_DOMAIN = 4;
    uint256 private constant RECIPIENT = 76;
    uint256 private constant MINT_RECIPIENT = 148 + 36;
    uint256 private constant MESSAGE_SENDER = 148 + 100;
    uint256 private constant HOOK_DATA = 148 + 228;

    uint8 private constant PAY_FAILED = 1;
    uint8 private constant SHORT_MINT = 2;
    uint8 private constant BAD_HOOK = 3;

    IERC20 public immutable usdc;
    IMessageTransmitterV2 public immutable transmitter;
    SplitsRouter public immutable router;
    /// @notice Arc's TokenMessengerV2: only burn messages addressed to it are relayed.
    address public immutable tokenMessenger;

    /// @dev What a minted message brought: who burned, from where, and how much arrived here.
    struct Arrival {
        address burner;
        uint32 sourceDomain;
        uint256 minted;
    }

    /// @notice Refunds that could not be sent, by the payer they belong to.
    mapping(address payer => uint256) public owed;

    event CrossPaid(
        bytes32 indexed ref, address indexed payer, uint32 sourceDomain, uint256 payAmount, uint256 feeBack
    );
    /// @dev `payer` is where the refund went: the hook's refundTo, or the burner.
    event Refunded(bytes32 indexed ref, address indexed payer, uint256 amount, uint8 reason);
    event Owed(address indexed payer, uint256 amount);
    event Claimed(address indexed payer, uint256 amount);

    error ZeroAddress();
    error RouterUsdcMismatch();
    error MessageTooShort();
    error NotABurn();
    error NotForThisContract();
    error MintFailed();
    error NothingOwed();
    error OutOfGas();
    error OnlySelf();
    error UnknownHookVersion(uint8 version);
    error PaysItself();

    constructor(IERC20 usdc_, IMessageTransmitterV2 transmitter_, SplitsRouter router_, address tokenMessenger_) {
        if (
            address(usdc_) == address(0) || address(transmitter_) == address(0) || address(router_) == address(0)
                || tokenMessenger_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (address(router_.usdc()) != address(usdc_)) revert RouterUsdcMismatch();
        usdc = usdc_;
        transmitter = transmitter_;
        router = router_;
        tokenMessenger = tokenMessenger_;
    }

    /// @notice Mints a CCTP burn addressed to this contract and pays the split it carries.
    ///         Anyone may call it; the attestation and destinationCaller decide what can run.
    function relay(bytes calldata message, bytes calldata attestation) external nonReentrant {
        if (message.length < HOOK_DATA) revert MessageTooShort();
        // Only burns: any app can send a CCTP message naming this contract as its caller.
        if (address(uint160(uint256(bytes32(message[RECIPIENT:RECIPIENT + 32])))) != tokenMessenger) {
            revert NotABurn();
        }
        // A burn minted to someone else brings nothing here, yet its hook would still emit events
        // naming whatever ref and payer it chose.
        if (address(uint160(uint256(bytes32(message[MINT_RECIPIENT:MINT_RECIPIENT + 32])))) != address(this)) {
            revert NotForThisContract();
        }
        uint256 before = usdc.balanceOf(address(this));
        if (!transmitter.receiveMessage(message, attestation)) revert MintFailed();
        _settle(
            Arrival({
                burner: address(uint160(uint256(bytes32(message[MESSAGE_SENDER:MESSAGE_SENDER + 32])))),
                sourceDomain: uint32(bytes4(message[SOURCE_DOMAIN:SOURCE_DOMAIN + 4])),
                minted: usdc.balanceOf(address(this)) - before
            }),
            message[HOOK_DATA:]
        );
    }

    /// @notice The split a hook carries. External so `relay` can catch a hook that doesn't decode.
    function decodeHook(bytes calldata hook)
        external
        pure
        returns (address refundTo, SplitsRouter.Leg[] memory legs, uint256 payAmount, bytes32 ref)
    {
        uint8 version;
        (version, refundTo, legs, payAmount, ref) =
            abi.decode(hook, (uint8, address, SplitsRouter.Leg[], uint256, bytes32));
        if (version != HOOK_VERSION) revert UnknownHookVersion(version);
    }

    /// @notice The ref this contract pays the router with, keyed by the burner CCTP attests: each
    ///         payer's refs are their own, so nobody can spend another payer's (public) ref first.
    function routerRef(uint32 sourceDomain, address payer, bytes32 ref) public pure returns (bytes32) {
        return keccak256(abi.encode(sourceDomain, payer, ref));
    }

    /// @notice Approves the router and pays. External only so `relay` can catch any failure,
    ///         the approval included; nobody but this contract may call it.
    function payThrough(SplitsRouter.Leg[] calldata legs, uint256 payAmount, bytes32 ref) external {
        if (msg.sender != address(this)) revert OnlySelf();
        usdc.forceApprove(address(router), payAmount);
        router.pay(legs, payAmount, ref);
        usdc.forceApprove(address(router), 0);
    }

    /// @notice Sends the caller's held refund to the caller. A payer blocked by USDC stays held
    ///         until they're unblocked; the money can't be routed to another address.
    function claim() external nonReentrant {
        uint256 amount = owed[msg.sender];
        if (amount == 0) revert NothingOwed();
        owed[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    /// @dev Pays the split the hook carries, or refunds; a hook that doesn't decode refunds.
    function _settle(Arrival memory a, bytes calldata hook) private {
        uint256 gasBefore = gasleft();
        try this.decodeHook(hook) returns (
            address refundTo, SplitsRouter.Leg[] memory legs, uint256 payAmount, bytes32 ref
        ) {
            _pay(legs, payAmount, ref, _usable(refundTo, a.burner), a);
        } catch {
            _starved(gasBefore);
            _refund(bytes32(0), _refundAddress(hook, a.burner), a.minted, BAD_HOOK);
        }
    }

    function _pay(SplitsRouter.Leg[] memory legs, uint256 payAmount, bytes32 ref, address refundTo, Arrival memory a)
        private
    {
        uint256 minted = a.minted;
        if (minted < payAmount) {
            _refund(ref, refundTo, minted, SHORT_MINT);
            return;
        }
        if (legs.length > MAX_LEGS) {
            _refund(ref, refundTo, minted, PAY_FAILED);
            return;
        }
        for (uint256 i; i < legs.length; ++i) {
            // The router would "pay" this contract, leaving the money here with no owner.
            if (legs[i].recipient == address(this)) {
                _refund(ref, refundTo, minted, PAY_FAILED);
                return;
            }
        }
        uint256 gasBefore = gasleft();
        try this.payThrough(legs, payAmount, routerRef(a.sourceDomain, a.burner, ref)) {
            uint256 back = minted - payAmount;
            emit CrossPaid(ref, a.burner, a.sourceDomain, payAmount, back);
            if (back > 0) _send(refundTo, back);
        } catch {
            _starved(gasBefore);
            _refund(ref, refundTo, minted, PAY_FAILED);
        }
    }

    /// @dev Where refunds and change go: the hook's address, unless it is unset or would strand the
    ///      money (this contract, or the token itself), when they go back to the burner.
    function _usable(address refundTo, address burner) private view returns (address) {
        if (refundTo == address(0) || refundTo == address(this) || refundTo == address(usdc)) return burner;
        return refundTo;
    }

    /// @dev A failure that left little more than the 1/64 reserve (out of gas, possibly a few calls
    ///      deep, where each level keeps its own 1/64) means the relayer sent too little gas, not that
    ///      the split can't be paid: revert so the message stays unminted and can be relayed again.
    ///      A real failure (a blocked recipient) returns with far more; given enough gas it refunds.
    function _starved(uint256 gasBefore) private view {
        if (gasleft() < gasBefore / 16) revert OutOfGas();
    }

    /// @dev The refund address from a hook whose legs don't decode, when its first two words do.
    function _refundAddress(bytes calldata hook, address burner) private view returns (address) {
        if (hook.length < 64 || uint256(bytes32(hook[0:32])) != HOOK_VERSION) return burner;
        uint256 word = uint256(bytes32(hook[32:64]));
        if (word > type(uint160).max) return burner;
        // casting to 'uint160' is safe because word was checked to fit in 160 bits above
        // forge-lint: disable-next-line(unsafe-typecast)
        return _usable(address(uint160(word)), burner);
    }

    function _refund(bytes32 ref, address payer, uint256 amount, uint8 reason) private {
        emit Refunded(ref, payer, amount, reason);
        if (amount > 0) _send(payer, amount);
    }

    /// @dev A transfer that fails (the payer is blocked by USDC) is held as owed instead of reverting,
    ///      so the mint still lands and the money is never stuck without an owner.
    function _send(address payer, uint256 amount) private {
        (bool ok, bytes memory ret) = address(usdc).call(abi.encodeCall(IERC20.transfer, (payer, amount)));
        // casting to 'bytes32' is safe because ret is exactly 32 bytes when it is read
        // forge-lint: disable-next-line(unsafe-typecast)
        if (ok && (ret.length == 0 || (ret.length == 32 && uint256(bytes32(ret)) == 1))) return;
        owed[payer] += amount;
        emit Owed(payer, amount);
    }
}
