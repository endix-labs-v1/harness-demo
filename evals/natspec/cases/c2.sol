// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Splitter {
    function split(uint256 amount, uint256 rate) external pure returns (uint256, uint256) {
        uint256 part = (amount * rate + 9_999) / 10_000;
        return (amount - part, part);
    }
}
