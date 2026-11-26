// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchParams} from "./LaunchCoin.sol";
import {CoinDeployer} from "./CoinDeployer.sol";

/// @title Permissionless coin factory. No owner, no fees, no admin keys.
contract LaunchFactory {
    address public immutable v2Factory;
    address public immutable weth;
    uint256 public immutable virtualEth0;
    CoinDeployer public immutable deployer;

    address[] public coins;
    mapping(address => bool) public isCoin;

    event CoinCreated(
        address indexed coin,
        address indexed creator,
        string name,
        string symbol,
        string image,
        string description,
        uint64 lockDuration,
        uint16 penaltyBps,
        uint8 steepness,
        uint32 snipeWindow,
        uint128 snipeMaxBuy,
        uint256 devBuy
    );

    error ImageTooLarge();

    constructor(address v2Factory_, address weth_, uint256 virtualEth0_, CoinDeployer deployer_) {
        deployer = deployer_;
        v2Factory = v2Factory_;
        weth = weth_;
        virtualEth0 = virtualEth0_;
    }

    /// @param image a URL or a small data: URI (max 12 KB), stored in the event log only
    function createCoin(LaunchParams calldata p, string calldata image, string calldata description)
        external
        payable
        returns (address coin)
    {
        if (bytes(image).length > 12_000 || bytes(description).length > 280) revert ImageTooLarge();
        coin = deployer.deploy{value: msg.value}(p, msg.sender, v2Factory, weth, virtualEth0);
        coins.push(coin);
        isCoin[coin] = true;
        emit CoinCreated(
            coin,
            msg.sender,
            p.name,
            p.symbol,
            image,
            description,
            p.lockDuration,
            p.penaltyBps,
            p.steepness,
            p.snipeWindow,
            p.snipeMaxBuy,
            msg.value
        );
    }

    function coinsCount() external view returns (uint256) {
        return coins.length;
    }

    function coinsPage(uint256 start, uint256 n) external view returns (address[] memory out) {
        uint256 len = coins.length;
        if (start >= len) return out;
        uint256 end = start + n > len ? len : start + n;
        out = new address[](end - start);
        for (uint256 i = start; i < end; i++) out[i - start] = coins[i];
    }
}
