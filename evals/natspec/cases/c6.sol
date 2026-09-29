// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Cut {
    function afterCut(uint256 amount, uint256 cut) external pure returns (uint256) {
        require(cut <= amount, "cut too big");
        return amount - cut;
    }
}
