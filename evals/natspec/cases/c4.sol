// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Accrual {
    /// @notice Growth per second, scaled by 1e18 (1e18 is 100%).
    uint256 public immutable speed;

    /// @notice Sets the growth per second once.
    /// @param speed_ Growth per second, scaled by 1e18.
    constructor(uint256 speed_) {
        speed = speed_;
    }

    function accrued(uint256 principal, uint64 since) external view returns (uint256) {
        return (principal * speed * (block.timestamp - since)) / 1e18;
    }
}
