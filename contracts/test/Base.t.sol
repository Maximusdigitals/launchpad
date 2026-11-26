// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchCoin, LaunchParams} from "../src/LaunchCoin.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";
import {CoinDeployer} from "../src/CoinDeployer.sol";
import {MockWETH, MockV2Factory, MockPair} from "./Mocks.sol";

abstract contract Base is Test {
    LaunchFactory factory;
    MockWETH weth;
    MockV2Factory v2;
    address dev = makeAddr("dev");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    uint256 constant VETH0 = 0.02 ether;
    uint64 constant L = 1 hours;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        weth = new MockWETH();
        v2 = new MockV2Factory();
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        CoinDeployer d = new CoinDeployer(predicted);
        factory = new LaunchFactory(address(v2), address(weth), VETH0, d);
        assertEq(address(factory), predicted);
        address[6] memory who = [dev, alice, bob, carol, dave, address(this)];
        for (uint256 i; i < who.length; i++) vm.deal(who[i], 100 ether);
    }

    function params() internal pure returns (LaunchParams memory p) {
        p = LaunchParams({
            name: "Test Coin",
            symbol: "TEST",
            lockDuration: L,
            penaltyBps: 1000,
            steepness: 2,
            snipeWindow: 0,
            snipeMaxBuy: 1e13
        });
    }

    function launch(LaunchParams memory p, uint256 devBuy) internal returns (LaunchCoin c) {
        vm.prank(dev);
        c = LaunchCoin(payable(factory.createCoin{value: devBuy}(p, "ipfs://img", "hello")));
    }

    function buy(LaunchCoin c, address who, uint256 eth) internal returns (uint256) {
        vm.prank(who);
        return c.buy{value: eth}(0);
    }

    function sellAll(LaunchCoin c, address who) internal returns (uint256) {
        uint256 b = c.balanceOf(who);
        vm.prank(who);
        return c.sell(b, 0);
    }
}
