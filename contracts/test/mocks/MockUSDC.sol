// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev 6-decimal USDC stand-in with a blocklist, mirroring Arc's runtime blocklist where a
///      transfer to or from a blocked account reverts.
contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;

    error Blocklisted(address account);

    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    /// @dev Approvals naming a blocked spender revert too, like a FiatToken-style blocklist.
    function _approve(address owner, address spender, uint256 value, bool emitEvent) internal override {
        if (blocked[spender]) revert Blocklisted(spender);
        super._approve(owner, spender, value, emitEvent);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[from]) revert Blocklisted(from);
        if (blocked[to]) revert Blocklisted(to);
        super._update(from, to, value);
    }
}
