// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract Vault {
    /// @notice Shares in circulation, with 18 decimals.
    uint256 public totalShares;

    /// @notice Assets the vault holds, in the asset token's smallest unit.
    uint256 public totalAssets;

    function convert(uint256 assets) public view returns (uint256) {
        return (assets * totalShares) / totalAssets;
    }
}
