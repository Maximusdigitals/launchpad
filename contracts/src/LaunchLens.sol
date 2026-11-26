// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {LaunchCoin} from "./LaunchCoin.sol";
import {LaunchFactory} from "./LaunchFactory.sol";

/// @notice Read-only batch views for the frontend. Holds no funds, has no state.
contract LaunchLens {
    struct HolderRow {
        address holder;
        uint256 balance;
        uint64 lockEnd;
        uint64 holdSince;
        uint256 costBasis;
        uint256 pending;
        uint256 weight;
        bool eligible;
    }

    struct CoinRow {
        address coin;
        string name;
        string symbol;
        address creator;
        uint64 launchTime;
        uint64 launchBlock;
        uint64 lockDuration;
        uint16 penaltyBps;
        uint8 steepness;
        uint32 snipeWindow;
        uint128 snipeMaxBuy;
        uint256 price;
        LaunchCoin.State state;
    }

    function holders(LaunchCoin c, address[] calldata who) external view returns (HolderRow[] memory rows) {
        rows = new HolderRow[](who.length);
        for (uint256 i; i < who.length; i++) {
            HolderRow memory r = rows[i];
            r.holder = who[i];
            (r.balance, r.lockEnd, r.holdSince, r.costBasis, r.pending, r.weight, r.eligible) = c.holderInfo(who[i]);
        }
    }

    function coin(LaunchCoin c) public view returns (CoinRow memory r) {
        r.coin = address(c);
        r.name = c.name();
        r.symbol = c.symbol();
        r.creator = c.creator();
        r.launchTime = c.launchTime();
        r.launchBlock = c.launchBlock();
        r.lockDuration = c.lockDuration();
        r.penaltyBps = c.penaltyBps();
        r.steepness = c.steepness();
        r.snipeWindow = c.snipeWindow();
        r.snipeMaxBuy = c.snipeMaxBuy();
        r.price = c.price();
        r.state = c.state();
    }

    function coins(LaunchFactory f, uint256 start, uint256 n) external view returns (CoinRow[] memory rows) {
        address[] memory list = f.coinsPage(start, n);
        rows = new CoinRow[](list.length);
        for (uint256 i; i < list.length; i++) rows[i] = coin(LaunchCoin(payable(list[i])));
    }
}
