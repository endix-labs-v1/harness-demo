// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Prices a base token with 18 decimals in a quote token with 6 decimals.
contract Pricer {
    /// @notice Price of one whole base token in quote tokens, with 8 decimals.
    uint256 public price;

    function quote(uint256 amountIn) external view returns (uint256) {
        return (amountIn * price) / 1e20;
    }
}
