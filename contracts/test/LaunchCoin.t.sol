// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {LaunchCoin, LaunchParams} from "../src/LaunchCoin.sol";
import {CoinDeployer} from "../src/CoinDeployer.sol";
import {MockPair} from "./Mocks.sol";

contract Reenterer {
    LaunchCoin public c;
    uint8 public mode; // 1 re-enter sell, 2 re-enter claim, 3 re-enter buy
    bool public reentered;
    bool public reentryBlocked;

    constructor(LaunchCoin c_) {
        c = c_;
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function doBuy() external payable {
        c.buy{value: msg.value}(0);
    }

    function doSell(uint256 amt) external {
        c.sell(amt, 0);
    }

    function doClaim() external {
        c.claim();
    }

    receive() external payable {
        if (mode == 0 || reentered) return;
        reentered = true;
        if (mode == 1) {
            try c.sell(1e18, 0) {} catch { reentryBlocked = true; }
        } else if (mode == 2) {
            try c.claim() {} catch { reentryBlocked = true; }
        } else if (mode == 3) {
            try c.buy{value: 1}(0) {} catch { reentryBlocked = true; }
        }
    }
}

contract LaunchCoinTest is Base {
    // ------------------------------------------------------------ basics

    function test_launch_params_and_no_admin() public {
        LaunchCoin c = launch(params(), 0);
        assertEq(c.creator(), dev);
        assertEq(c.lockDuration(), L);
        assertEq(c.totalSupply(), 1_000_000_000e18);
        assertEq(c.balanceOf(address(c)), 1_000_000_000e18);
        assertEq(c.maxLockEnd(), vm.getBlockTimestamp() + 2 * L);
        assertTrue(c.pair() != address(0));
        assertEq(factory.coinsCount(), 1);
        assertTrue(factory.isCoin(address(c)));
    }

    function test_param_bounds() public {
        LaunchParams memory p = params();
        p.lockDuration = 59;
        vm.expectRevert(LaunchCoin.BadParams.selector);
        launch(p, 0);
        p = params();
        p.penaltyBps = 5001;
        vm.expectRevert(LaunchCoin.BadParams.selector);
        launch(p, 0);
        p = params();
        p.steepness = 4;
        vm.expectRevert(LaunchCoin.BadParams.selector);
        launch(p, 0);
        p = params();
        p.snipeWindow = 3601;
        vm.expectRevert(LaunchCoin.BadParams.selector);
        launch(p, 0);
        p = params();
        p.symbol = "WAYTOOLONGSYM";
        vm.expectRevert(LaunchCoin.BadParams.selector);
        launch(p, 0);
    }

    function test_deployer_only_factory() public {
        CoinDeployer d = factory.deployer();
        vm.expectRevert(CoinDeployer.OnlyFactory.selector);
        d.deploy(params(), alice, address(0), address(0), 1 ether);
    }

    function test_buy_and_late_sell_round_trip() public {
        LaunchCoin c = launch(params(), 0);
        (uint256 q,) = c.quoteBuy(0.001 ether);
        uint256 got = buy(c, alice, 0.001 ether);
        assertEq(got, q);
        assertEq(c.balanceOf(alice), got);
        (,,, uint256 basis,,,) = c.holderInfo(alice);
        assertEq(basis, 0.001 ether);
        skip(L);
        uint256 before = alice.balance;
        uint256 out = sellAll(c, alice);
        assertEq(alice.balance - before, out);
        assertLe(out, 0.001 ether);
        assertGe(out, 0.001 ether - 2); // only rounding lost
        assertEq(c.rewardReserve(), 0);
    }

    function test_slippage() public {
        LaunchCoin c = launch(params(), 0);
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.Slippage.selector);
        c.buy{value: 0.001 ether}(type(uint256).max);
    }

    // ------------------------------------------------------------ early sell penalty

    function test_early_sell_at_loss_pays_basis_minus_penalty_floor() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        // no price change: value ~= basis. early -> receive basis - 10%
        (uint256 value, uint256 toSeller, uint256 forfeit, bool early) = c.quoteSell(alice, c.balanceOf(alice));
        assertTrue(early);
        uint256 out = sellAll(c, alice);
        assertEq(out, toSeller);
        assertApproxEqAbs(out, (value < 0.002 ether ? value : 0.002 ether) - 0.0002 ether, 2);
        assertEq(c.rewardReserve(), forfeit);
        assertEq(c.streamRemaining(), forfeit);
    }

    function test_early_sell_in_profit_forfeits_all_profit_plus_penalty() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        buy(c, bob, 0.01 ether); // pumps price
        uint256 bal = c.balanceOf(alice);
        (uint256 value,,,) = c.quoteSell(alice, bal);
        assertGt(value, 0.002 ether, "in profit");
        uint256 out = sellAll(c, alice);
        assertEq(out, 0.002 ether - 0.0002 ether, "basis minus 10%");
        assertEq(c.totalForfeited(), value - out);
    }

    function test_partial_early_sell_uses_proportional_basis() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        buy(c, bob, 0.01 ether);
        uint256 half = c.balanceOf(alice) / 2;
        vm.prank(alice);
        uint256 out = c.sell(half, 0);
        assertApproxEqAbs(out, 0.0009 ether, 2);
        (,,, uint256 basis,,,) = c.holderInfo(alice);
        assertApproxEqAbs(basis, 0.001 ether, 2);
    }

    function test_custom_penalty() public {
        LaunchParams memory p = params();
        p.penaltyBps = 2500;
        LaunchCoin c = launch(p, 0);
        buy(c, alice, 0.002 ether);
        buy(c, bob, 0.01 ether);
        assertEq(sellAll(c, alice), 0.0015 ether);
    }

    function test_sell_exactly_at_lock_end_is_free() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        buy(c, bob, 0.01 ether);
        skip(L);
        (uint256 value, uint256 toSeller,, bool early) = c.quoteSell(alice, c.balanceOf(alice));
        assertFalse(early);
        assertEq(value, toSeller);
        assertGt(sellAll(c, alice), 0.002 ether, "keeps profit");
    }

    function test_topup_relocks_whole_bag() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.001 ether);
        skip(L - 10);
        buy(c, alice, 0.001 ether);
        skip(20);
        (,,, bool early) = c.quoteSell(alice, c.balanceOf(alice));
        assertTrue(early);
    }

    // ------------------------------------------------------------ dev lock

    function test_dev_cannot_sell_before_2L_at_all() public {
        LaunchCoin c = launch(params(), 0.001 ether);
        uint256 bal = c.balanceOf(dev);
        assertGt(bal, 0);
        (, uint64 lockEnd,,,,,) = c.holderInfo(dev);
        assertEq(lockEnd, vm.getBlockTimestamp() + 2 * L);
        skip(L + 1); // a normal holder would be free now
        vm.prank(dev);
        vm.expectRevert(LaunchCoin.DevLocked.selector);
        c.sell(bal, 0);
        skip(L);
        vm.prank(dev);
        uint256 out = c.sell(bal, 0);
        assertGt(out, 0);
    }

    function test_dev_later_buy_extends_2L() public {
        LaunchCoin c = launch(params(), 0.001 ether);
        skip(90 minutes);
        buy(c, dev, 0.001 ether);
        (, uint64 lockEnd,,,,,) = c.holderInfo(dev);
        assertEq(lockEnd, vm.getBlockTimestamp() + 2 * L);
        assertEq(c.maxLockEnd(), lockEnd);
        skip(2 * L - 1);
        vm.prank(dev);
        vm.expectRevert(LaunchCoin.DevLocked.selector);
        c.sell(1e18, 0);
    }

    function test_dev_cannot_transfer_out_during_lock() public {
        LaunchCoin c = launch(params(), 0.001 ether);
        vm.prank(dev);
        vm.expectRevert(LaunchCoin.TransferLocked.selector);
        c.transfer(alice, 1e18);
        vm.prank(dev);
        c.approve(alice, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.TransferLocked.selector);
        c.transferFrom(dev, alice, 1e18);
    }

    function test_dev_earns_no_rewards() public {
        LaunchCoin c = launch(params(), 0.001 ether);
        buy(c, alice, 0.001 ether);
        skip(60);
        buy(c, bob, 0.002 ether);
        sellAll(c, bob);
        skip(1 hours);
        assertEq(c.pendingRewards(dev), 0);
        assertGt(c.pendingRewards(alice), 0);
    }

    // ------------------------------------------------------------ transfer dodge

    function test_transfer_dodge_reverts_during_lock() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        address fresh = makeAddr("fresh");
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.TransferLocked.selector);
        c.transfer(fresh, 1);
        // approve + transferFrom by an accomplice also fails
        vm.prank(alice);
        c.approve(bob, type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(LaunchCoin.TransferLocked.selector);
        c.transferFrom(alice, fresh, 1);
    }

    function test_transfer_after_lock_moves_basis_and_resets_clock() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        skip(L);
        uint256 bal = c.balanceOf(alice);
        vm.prank(alice);
        c.transfer(carol, bal / 2);
        (,, uint64 hsA, uint256 bA,,,) = c.holderInfo(alice);
        (,, uint64 hsC, uint256 bC,,,) = c.holderInfo(carol);
        assertApproxEqAbs(bA, 0.001 ether, 1);
        assertApproxEqAbs(bC, 0.001 ether, 1);
        assertEq(hsC, vm.getBlockTimestamp(), "recipient starts a fresh clock");
        assertLt(hsA, hsC);
    }

    function test_self_transfer_cannot_inflate_weight() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        buy(c, bob, 0.002 ether);
        skip(L);
        uint256 w0 = c.totalWeight();
        uint256 a0 = c.weightOf(alice);
        uint256 bal = c.balanceOf(alice);
        vm.startPrank(alice);
        for (uint256 i; i < 5; i++) c.transfer(alice, bal / 2);
        vm.stopPrank();
        assertEq(c.totalWeight(), w0);
        assertEq(c.weightOf(alice), a0);
    }

    function test_cannot_send_tokens_to_coin_contract() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        skip(L);
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.TransferLocked.selector);
        c.transfer(address(c), 1);
    }

    function test_cannot_seed_pool_before_graduation() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        skip(L);
        address pair = c.pair();
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.PoolNotLive.selector);
        c.transfer(pair, 1e18);
    }

    // ------------------------------------------------------------ anti-snipe

    function test_snipe_cap() public {
        LaunchParams memory p = params();
        p.snipeWindow = 300;
        p.snipeMaxBuy = 0.001 ether;
        LaunchCoin c = launch(p, 0);
        buy(c, alice, 0.0006 ether);
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.SnipeCap.selector);
        c.buy{value: 0.0005 ether}(0);
        buy(c, alice, 0.0004 ether); // exactly the cap
        skip(300);
        buy(c, alice, 0.005 ether); // window over
    }

    function test_snipe_cap_applies_to_dev_buy() public {
        LaunchParams memory p = params();
        p.snipeWindow = 300;
        p.snipeMaxBuy = 0.001 ether;
        vm.expectRevert(LaunchCoin.SnipeCap.selector);
        launch(p, 0.002 ether);
    }

    // ------------------------------------------------------------ rewards

    function test_rewards_stream_and_tick_up_without_txs() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        skip(10 minutes);
        buy(c, bob, 0.01 ether);
        skip(1);
        sellAll(c, bob); // bob dumps -> forfeits
        uint256 f = c.totalForfeited();
        assertGt(f, 0);
        uint256 p0 = c.pendingRewards(alice);
        skip(5 minutes);
        uint256 p1 = c.pendingRewards(alice);
        skip(10 minutes);
        uint256 p2 = c.pendingRewards(alice);
        assertGt(p1, p0, "ticks");
        assertGt(p2, p1, "ticks");
        skip(1 hours);
        uint256 p3 = c.pendingRewards(alice);
        assertApproxEqAbs(p3, f, 1e6, "sole holder gets the whole stream");
        uint256 before = alice.balance;
        vm.prank(alice);
        uint256 got = c.claim();
        assertEq(alice.balance - before, got);
        assertEq(got, p3);
        assertEq(c.pendingRewards(alice), 0);
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.ZeroAmount.selector);
        c.claim();
    }

    function test_longer_holder_gets_bigger_cut_per_token() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.001 ether);
        skip(20 minutes);
        buy(c, bob, 0.001 ether);
        skip(20 minutes);
        buy(c, carol, 0.001 ether);
        skip(10 minutes);
        buy(c, dave, 0.005 ether);
        sellAll(c, dave);
        skip(1 minutes);
        uint256 a = c.pendingRewards(alice) * 1e18 / c.balanceOf(alice);
        uint256 b = c.pendingRewards(bob) * 1e18 / c.balanceOf(bob);
        uint256 cc = c.pendingRewards(carol) * 1e18 / c.balanceOf(carol);
        assertGt(a, b);
        assertGt(b, cc);
    }

    function test_steepness_changes_split() public {
        uint256[4] memory ratio;
        for (uint8 p = 1; p <= 3; p++) {
            setUp();
            LaunchParams memory lp = params();
            lp.steepness = p;
            LaunchCoin c = launch(lp, 0);
            buy(c, alice, 0.001 ether);
            skip(30 minutes);
            buy(c, bob, 0.001 ether);
            skip(30 minutes);
            buy(c, dave, 0.004 ether);
            sellAll(c, dave);
            skip(31 minutes);
            uint256 a = c.pendingRewards(alice) * 1e18 / c.balanceOf(alice);
            uint256 b = c.pendingRewards(bob) * 1e18 / c.balanceOf(bob);
            ratio[p] = a * 1000 / b;
        }
        assertGt(ratio[2], ratio[1]);
        assertGt(ratio[3], ratio[2]);
    }

    /// splitting one buy across many wallets earns the same as one wallet (weight is linear in amount)
    function test_wallet_splitting_gains_nothing() public {
        LaunchCoin c = launch(params(), 0);
        // whale: 1 wallet, 0.004 ETH.   splitter: 4 wallets x 0.001 ETH, same block
        // buy order alternates so price paths are comparable: put whale and splitter in the same block
        address whale = makeAddr("whale");
        vm.deal(whale, 1 ether);
        address[4] memory s;
        for (uint256 i; i < 4; i++) {
            s[i] = makeAddr(string(abi.encodePacked("split", i)));
            vm.deal(s[i], 1 ether);
        }
        buy(c, whale, 0.004 ether);
        for (uint256 i; i < 4; i++) buy(c, s[i], 0.001 ether);
        uint256 splitTokens;
        for (uint256 i; i < 4; i++) splitTokens += c.balanceOf(s[i]);
        skip(15 minutes);
        buy(c, dave, 0.004 ether);
        sellAll(c, dave);
        skip(40 minutes);
        uint256 whaleR = c.pendingRewards(whale);
        uint256 splitR;
        for (uint256 i; i < 4; i++) splitR += c.pendingRewards(s[i]);
        // per token, identical
        assertApproxEqRel(whaleR * 1e18 / c.balanceOf(whale), splitR * 1e18 / splitTokens, 1e12);
    }

    function test_dust_then_topup_does_not_inherit_old_clock() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.00001 ether); // dust early
        buy(c, bob, 0.001 ether); // bob honest, same time
        skip(50 minutes);
        buy(c, alice, 0.001 ether); // alice tops up big just before the dump
        buy(c, dave, 0.004 ether);
        sellAll(c, dave);
        skip(31 minutes);
        uint256 a = c.pendingRewards(alice) * 1e18 / c.balanceOf(alice);
        uint256 b = c.pendingRewards(bob) * 1e18 / c.balanceOf(bob);
        emit log_named_uint("alice w", c.weightOf(alice));
        emit log_named_uint("bob w", c.weightOf(bob));
        emit log_named_uint("alice bal", c.balanceOf(alice));
        emit log_named_uint("bob bal", c.balanceOf(bob));
        emit log_named_uint("alice r", c.pendingRewards(alice));
        emit log_named_uint("bob r", c.pendingRewards(bob));
        (,,uint64 hsA,,,,) = c.holderInfo(alice);
        emit log_named_uint("alice hs", hsA);
        assertLt(a * 5, b, "topped-up bag earns far less per token than the honest early holder");
    }

    function test_matches_bruteforce_formula() public {
        // single release (warp past stream end before anyone touches it): exact formula check
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.001 ether);
        uint256 t0 = vm.getBlockTimestamp();
        vm.warp(t0 + 600);
        buy(c, bob, 0.002 ether);
        vm.warp(t0 + 1200);
        buy(c, dave, 0.004 ether);
        sellAll(c, dave);
        uint256 f = c.totalForfeited();
        vm.warp(t0 + 1200 + 30 minutes); // whole stream released at this instant in one step
        uint256 t = vm.getBlockTimestamp();
        uint256 wa = c.balanceOf(alice) * (t - t0) ** 2;
        uint256 wb = c.balanceOf(bob) * (t - (t0 + 600)) ** 2;
        uint256 expA = f * wa / (wa + wb);
        uint256 expB = f * wb / (wa + wb);
        assertApproxEqAbs(c.pendingRewards(alice), expA, 1e4);
        assertApproxEqAbs(c.pendingRewards(bob), expB, 1e4);
        assertEq(c.weightOf(alice), wa);
        assertEq(c.totalWeight(), wa + wb);
    }

    function test_no_holders_rewards_wait() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, dave, 0.004 ether);
        sellAll(c, dave); // nobody eligible holds
        skip(2 hours);
        c.poke();
        assertEq(c.streamRemaining(), c.totalForfeited(), "nothing released into the void");
        buy(c, alice, 0.001 ether);
        skip(10 minutes);
        assertApproxEqAbs(c.pendingRewards(alice), c.totalForfeited(), 1e6);
    }

    // ------------------------------------------------------------ graduation

    function _sellOut(LaunchCoin c) internal {
        uint256 need = c.state().graduationEth;
        buy(c, alice, need + 0.01 ether); // excess refunded
    }

    function test_completion_stops_buys_and_refunds() public {
        LaunchCoin c = launch(params(), 0);
        uint256 need = c.state().graduationEth;
        uint256 before = alice.balance;
        _sellOut(c);
        assertTrue(c.completed());
        assertEq(c.tokensSold(), c.CURVE_SUPPLY());
        assertApproxEqAbs(before - alice.balance, need, 2);
        vm.prank(bob);
        vm.expectRevert(LaunchCoin.CurveClosed.selector);
        c.buy{value: 0.001 ether}(0);
    }

    function test_graduation_waits_for_all_locks_incl_dev() public {
        LaunchCoin c = launch(params(), 0.001 ether);
        skip(30 minutes);
        _sellOut(c);
        uint64 gradAt = c.maxLockEnd();
        assertEq(gradAt, c.launchTime() + 2 * L, "dev 2L is the binding lock");
        vm.expectRevert(LaunchCoin.NotReady.selector);
        c.graduate();
        vm.warp(gradAt - 1);
        vm.expectRevert(LaunchCoin.NotReady.selector);
        c.graduate();
        vm.warp(gradAt);
        uint256 realEth = c.realEth();
        c.graduate();
        assertTrue(c.graduated());
        MockPair pair = MockPair(c.pair());
        assertEq(weth.balanceOf(address(pair)), realEth);
        assertGt(c.balanceOf(address(pair)), 0);
        assertGt(pair.lp(c.DEAD()), 0, "LP burned to dead");
        // supply: unsold burned, pool price matches the final curve price
        uint256 poolPrice = realEth * 1e18 / c.balanceOf(address(pair));
        assertApproxEqRel(poolPrice, c.price(), 1e15);
        // trading moves to the DEX; curve closed; transfers free
        vm.prank(alice);
        vm.expectRevert(LaunchCoin.AlreadyGraduated.selector);
        c.sell(1e18, 0);
        vm.prank(alice);
        c.transfer(bob, 1e18);
        vm.expectRevert(LaunchCoin.AlreadyGraduated.selector);
        c.graduate();
    }

    function test_graduation_not_before_completion() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.001 ether);
        skip(10 days);
        vm.expectRevert(LaunchCoin.NotReady.selector);
        c.graduate();
    }

    function test_sells_still_work_after_completion_before_graduation() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, bob, 0.002 ether);
        _sellOut(c);
        skip(L);
        uint256 out = sellAll(c, bob);
        assertGt(out, 0.002 ether);
        assertTrue(c.completed());
        vm.warp(c.maxLockEnd());
        c.graduate();
    }

    function test_graduation_survives_weth_donation_griefing() public {
        LaunchCoin c = launch(params(), 0);
        _sellOut(c);
        // attacker donates WETH to the pair and syncs, trying to brick mint()
        address pr = c.pair();
        vm.prank(carol);
        weth.deposit{value: 1 ether}();
        vm.prank(carol);
        weth.transfer(pr, 1 ether);
        MockPair(pr).sync();
        vm.warp(c.maxLockEnd());
        c.graduate();
        assertTrue(c.graduated());
    }

    function test_rewards_claimable_after_graduation() public {
        LaunchCoin c = launch(params(), 0);
        buy(c, alice, 0.002 ether);
        skip(5 minutes);
        buy(c, bob, 0.005 ether);
        sellAll(c, bob);
        _sellOut(c);
        vm.warp(c.maxLockEnd());
        c.graduate();
        skip(1 hours);
        vm.prank(alice);
        assertGt(c.claim(), 0);
    }

    // ------------------------------------------------------------ reentrancy

    function test_reentrancy_on_sell_refund_blocked() public {
        LaunchCoin c = launch(params(), 0);
        Reenterer r = new Reenterer(c);
        vm.deal(address(r), 1 ether);
        r.doBuy{value: 0.002 ether}();
        r.setMode(1);
        r.doSell(c.balanceOf(address(r)) / 2);
        assertTrue(r.reentered());
        assertTrue(r.reentryBlocked());
    }

    function test_reentrancy_on_claim_blocked() public {
        LaunchCoin c = launch(params(), 0);
        Reenterer r = new Reenterer(c);
        r.doBuy{value: 0.002 ether}();
        skip(5 minutes);
        buy(c, bob, 0.005 ether);
        sellAll(c, bob);
        skip(1 hours);
        r.setMode(2);
        uint256 reserveBefore = c.rewardReserve();
        r.doClaim();
        assertTrue(r.reentryBlocked());
        assertGt(reserveBefore - c.rewardReserve(), 0);
        assertLe(c.totalClaimed(), c.totalForfeited());
    }

    function test_reentrancy_on_buy_refund_blocked() public {
        LaunchCoin c = launch(params(), 0);
        Reenterer r = new Reenterer(c);
        r.setMode(3);
        uint256 need = c.state().graduationEth;
        r.doBuy{value: need + 0.01 ether}(); // refund triggers receive()
        assertTrue(r.reentryBlocked());
    }

    // ------------------------------------------------------------ fuzz: solvency

    function testFuzz_solvency(uint96[6] memory amts, uint32[6] memory gaps, uint8 steep) public {
        LaunchParams memory p = params();
        p.steepness = uint8(bound(steep, 1, 3));
        LaunchCoin c = launch(p, 0);
        address[4] memory who = [alice, bob, carol, dave];
        for (uint256 i; i < 6; i++) {
            address w = who[i % 4];
            uint256 a = bound(amts[i], 1e12, 0.01 ether);
            skip(bound(gaps[i], 0, 2 hours));
            if (c.completed()) break;
            buy(c, w, a);
            if (i % 2 == 1) sellAll(c, who[(i + 1) % 4] == w ? w : who[(i + 3) % 4]);
        }
        skip(3 hours);
        uint256 total;
        for (uint256 i; i < 4; i++) total += c.pendingRewards(who[i]);
        assertLe(total, c.rewardReserve(), "never promises more than it holds");
        assertGe(address(c).balance, c.realEth() + c.rewardReserve());
        assertEq(c.realEth(), c.vEth() - VETH0);
        for (uint256 i; i < 4; i++) {
            if (c.pendingRewards(who[i]) > 0) {
                vm.prank(who[i]);
                c.claim();
            }
        }
        assertGe(address(c).balance, c.realEth());
    }
}
