// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {FeeModel} from "../src/FeeModel.sol";

contract FeeModelTest {
    FeeModel internal model = new FeeModel(30);

    function test_feeOf_roundsDown() public view {
        require(model.feeOf(10_000) == 30, "30 bps of 10000");
        require(model.feeOf(333) == 0, "rounds down below 1");
    }
}
