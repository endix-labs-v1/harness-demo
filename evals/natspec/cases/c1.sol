// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Portion {
    function portionOf(uint256 amount, uint256 rate) external pure returns (uint256) {
        return (amount * rate) / 100;
    }
}
