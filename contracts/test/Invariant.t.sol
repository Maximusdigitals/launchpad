// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {Test} from "forge-std/Test.sol";
import {LaunchCoin} from "../src/LaunchCoin.sol";

contract Handler is Test {
    LaunchCoin public c;
    address[] public actors;
    uint256 public now_;

    constructor(LaunchCoin c_, address[] memory a) {
        c = c_;
        actors = a;
        now_ = vm.getBlockTimestamp();
    }

    function _a(uint256 i) internal view returns (address) {
        return actors[i % actors.length];
    }

    function buy(uint256 i, uint256 amt) external {
        if (c.completed()) return;
        amt = bound(amt, 1e12, 0.005 ether);
        vm.prank(_a(i));
        c.buy{value: amt}(0);
    }

    function sell(uint256 i, uint256 frac) external {
        address w = _a(i);
        uint256 b = c.balanceOf(w);
        if (b == 0 || c.graduated()) return;
        (, uint64 lockEnd,,,,,) = c.holderInfo(w);
        if (w == c.creator() && vm.getBlockTimestamp() < lockEnd) return;
        uint256 amt = bound(frac, 1, b);
        vm.prank(w);
        c.sell(amt, 0);
    }

    function claim(uint256 i) external {
        address w = _a(i);
        if (c.pendingRewards(w) == 0) return;
        vm.prank(w);
        c.claim();
    }

    function xfer(uint256 i, uint256 j, uint256 frac) external {
        address f = _a(i);
        address t = _a(j);
        uint256 b = c.balanceOf(f);
        (, uint64 lockEnd,,,,,) = c.holderInfo(f);
        if (b == 0 || vm.getBlockTimestamp() < lockEnd) return;
        vm.prank(f);
        c.transfer(t, bound(frac, 1, b));
    }

    function warp(uint256 s) external {
        now_ += bound(s, 1, 40 minutes);
        vm.warp(now_);
    }

    function count() external view returns (uint256) {
        return actors.length;
    }
}

contract InvariantTest is Base {
    LaunchCoin c;
    Handler h;
    address[] actors;

    function setUp() public override {
        super.setUp();
        c = launch(params(), 0.0005 ether);
        actors.push(alice);
        actors.push(bob);
        actors.push(carol);
        actors.push(dave);
        actors.push(dev);
        h = new Handler(c, actors);
        for (uint256 i; i < actors.length; i++) vm.deal(actors[i], 1000 ether);
        targetContract(address(h));
    }

    function invariant_solvent() public view {
        assertGe(address(c).balance, c.realEth() + c.rewardReserve());
    }

    function invariant_curveAccounting() public view {
        assertEq(c.realEth(), c.vEth() - VETH0);
        uint256 sum;
        for (uint256 i; i < actors.length; i++) sum += c.balanceOf(actors[i]);
        if (!c.graduated()) assertEq(sum, c.tokensSold());
    }

    function invariant_rewardsNeverOverpromised() public view {
        uint256 total;
        for (uint256 i; i < actors.length; i++) total += c.pendingRewards(actors[i]);
        assertLe(total, c.rewardReserve());
        assertLe(c.totalClaimed(), c.totalForfeited());
    }

    function invariant_weightsConsistent() public view {
        uint256 sum;
        for (uint256 i; i < actors.length; i++) sum += c.weightOf(actors[i]);
        assertEq(sum, c.totalWeight());
    }

    function invariant_devNeverHasRewards() public view {
        assertEq(c.pendingRewards(dev), 0);
    }
}
