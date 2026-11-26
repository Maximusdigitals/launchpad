// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchCoin, LaunchParams} from "./LaunchCoin.sol";

/// @notice Holds the coin creation code so the factory stays under the 24 KB limit.
/// Only the factory fixed at deployment (its address is precomputed) can use it. No admin.
contract CoinDeployer {
    address public immutable factory;

    error OnlyFactory();

    constructor(address factory_) {
        factory = factory_;
    }

    function deploy(LaunchParams calldata p, address creator, address v2Factory, address weth, uint256 virtualEth0)
        external
        payable
        returns (address)
    {
        if (msg.sender != factory) revert OnlyFactory();
        return address(new LaunchCoin{value: msg.value}(p, creator, v2Factory, weth, virtualEth0));
    }
}
