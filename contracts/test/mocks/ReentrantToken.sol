// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {SplitsRouter} from "../../src/SplitsRouter.sol";

/// @dev Hostile token that calls back into the router from inside transferFrom.
contract ReentrantToken is ERC20 {
    SplitsRouter public router;
    uint256 public targetSplit;
    bool public armed;

    constructor() ERC20("Hostile", "HST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(SplitsRouter router_, uint256 splitId) external {
        router = router_;
        targetSplit = splitId;
        armed = true;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (armed) {
            armed = false;
            router.send(targetSplit, 1, value, keccak256("reentry"));
        }
        return super.transferFrom(from, to, value);
    }
}
