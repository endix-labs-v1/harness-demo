// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title FeeModel
/// @notice A tiny fee calculator for the harness demo. Every public and external
/// function carries NatSpec, and CI refuses a PR that adds one without it.
contract FeeModel {
    /// @notice The fee in basis points (1 bps = 0.01%).
    uint256 public immutable feeBps;

    /// @notice Sets the fee once, at deployment.
    /// @param feeBps_ The fee in basis points, at most 10_000.
    constructor(uint256 feeBps_) {
        require(feeBps_ <= 10_000, "fee too high");
        feeBps = feeBps_;
    }

    /// @notice Returns the fee charged on an amount, rounded down.
    /// @param amount The amount the fee is taken from.
    /// @return fee The fee, in the same unit as `amount`.
    function feeOf(uint256 amount) external view returns (uint256 fee) {
        fee = (amount * feeBps) / 10_000;
    }
}
