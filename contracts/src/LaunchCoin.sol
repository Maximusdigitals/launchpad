// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IV2Factory {
    function createPair(address a, address b) external returns (address);
    function getPair(address a, address b) external view returns (address);
}

interface IV2Pair {
    function mint(address to) external returns (uint256);
}

interface IWETH {
    function deposit() external payable;
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice Creator-chosen rules, fixed forever at launch.
struct LaunchParams {
    string name;
    string symbol;
    uint64 lockDuration; // L, seconds. Holders: L. Creator: 2L.
    uint16 penaltyBps; // extra % of cost basis lost on an early sell (100 = 1%)
    uint8 steepness; // p in weight = amount * holdTime^p  (1 gentle, 2 steep, 3 very steep)
    uint32 snipeWindow; // seconds after launch with a per-wallet buy cap
    uint128 snipeMaxBuy; // max ETH a wallet can spend during the snipe window
}

/// @title Hold-to-earn bonding-curve coin
/// @notice ERC20 + pump.fun-style constant-product bonding curve with:
///  - per-wallet sell lock L (creator: 2L, and the creator cannot sell early at all)
///  - early sellers forfeit profit + penaltyBps of cost basis into a reward stream
///  - the reward stream is paid to holders pro-rata to amount * (seconds held)^p (pull payments)
///  - wallet-to-wallet transfers revert while the sender is locked, and nobody can seed the DEX pool early
///  - graduation to a Uniswap V2 pool only once the curve is sold out AND every lock (incl. creator 2L) has ended
/// There is no owner, admin, pause or upgrade path. All rules are immutable after deployment.
contract LaunchCoin is ERC20, ReentrancyGuard {
    // ---------------------------------------------------------------- constants
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint256 public constant CURVE_SUPPLY = 793_100_000e18; // sold on the curve; the rest seeds the DEX pool
    uint256 public constant VIRTUAL_TOKEN0 = 1_073_000_000e18;
    uint256 public constant STREAM_DURATION = 30 minutes; // forfeits drip to holders over this window
    uint256 public constant SCALE = 1e36;
    uint256 public constant MIN_WEIGHT = 1e18; // rewards wait if total weight < 1 token * 1 s^p
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint64 public constant MIN_LOCK = 60;
    uint64 public constant MAX_LOCK = 7 days;
    uint16 public constant MIN_PENALTY_BPS = 100;
    uint16 public constant MAX_PENALTY_BPS = 5000;
    uint32 public constant MAX_SNIPE_WINDOW = 1 hours;
    uint128 public constant MIN_SNIPE_MAX_BUY = 1e13;

    // ---------------------------------------------------------------- immutables
    address public immutable factory;
    address public immutable creator;
    address public immutable weth;
    address public immutable pair;
    uint64 public immutable launchTime;
    uint64 public immutable lockDuration;
    uint16 public immutable penaltyBps;
    uint8 public immutable steepness;
    uint32 public immutable snipeWindow;
    uint128 public immutable snipeMaxBuy;
    uint256 public immutable virtualEth0;

    // ---------------------------------------------------------------- curve state
    uint256 public vEth; // virtual ETH reserve
    uint256 public vTok; // virtual token reserve
    uint256 public realEth; // ETH backing the curve
    uint256 public tokensSold; // curve tokens currently in wallets
    bool public completed; // curve sold out once -> no more buys, ever
    bool public graduated;
    uint64 public maxLockEnd; // latest lock end across all wallets (incl. creator 2L)

    // ---------------------------------------------------------------- holder state
    struct Holder {
        uint64 lockEnd; // can't sell without penalty (creator: can't sell at all) before this
        uint64 holdSince; // seconds since launch, amount-weighted average entry time
        uint128 costBasis; // ETH paid for the current bag
        uint128 snipeSpent; // ETH spent inside the snipe window
        uint256 owed; // settled, unclaimed rewards
    }

    mapping(address => Holder) public holders;
    mapping(address => int256[4]) internal _snap; // accumulator snapshot at last settle

    // ---------------------------------------------------------------- reward state
    // weight_i(t) = b_i * (t - h_i)^p ; total weight D(t) = sum_k C(p,k) (-1)^k t^(p-k) M_k, M_k = sum b_i h_i^k
    int256[4] internal _m; // power sums over eligible holders
    int256[4] internal _acc; // acc_k += R * C(p,k) (-1)^k t^(p-k) * SCALE / D(t) for every release R at time t
    uint256 public streamRemaining; // forfeits not yet released to holders
    uint64 public streamEnd;
    uint64 public lastRelease;
    uint256 public rewardReserve; // ETH reserved for rewards (released or not), minus claims
    uint256 public totalForfeited;
    uint256 public totalClaimed;

    bool private _curveMove; // internal curve transfers only

    // ---------------------------------------------------------------- events
    event Trade(
        address indexed trader,
        bool isBuy,
        uint256 ethAmount, // buy: ETH spent. sell: gross curve value
        uint256 tokenAmount,
        uint256 ethToTrader, // sell: what the trader received
        uint256 forfeited, // sell: what went to the reward stream
        uint256 vEthAfter,
        uint256 vTokAfter,
        uint64 lockEnd
    );
    event RewardsClaimed(address indexed holder, uint256 amount);
    event CurveCompleted(uint256 realEth, uint64 graduatesAt);
    event Graduated(address pair, uint256 ethToPool, uint256 tokensToPool, uint256 tokensBurned);

    // ---------------------------------------------------------------- errors
    error BadParams();
    error CurveClosed();
    error AlreadyGraduated();
    error SnipeCap();
    error Slippage();
    error ZeroAmount();
    error DevLocked();
    error TransferLocked();
    error PoolNotLive();
    error NotReady();
    error EthSendFailed();

    constructor(
        LaunchParams memory p,
        address creator_,
        address v2Factory,
        address weth_,
        uint256 virtualEth0_
    ) payable ERC20(p.name, p.symbol) {
        if (
            p.lockDuration < MIN_LOCK || p.lockDuration > MAX_LOCK || p.penaltyBps < MIN_PENALTY_BPS
                || p.penaltyBps > MAX_PENALTY_BPS || p.steepness < 1 || p.steepness > 3
                || p.snipeWindow > MAX_SNIPE_WINDOW || p.snipeMaxBuy < MIN_SNIPE_MAX_BUY || bytes(p.name).length == 0
                || bytes(p.name).length > 32 || bytes(p.symbol).length == 0 || bytes(p.symbol).length > 10
                || virtualEth0_ == 0 || creator_ == address(0)
        ) revert BadParams();

        factory = msg.sender;
        creator = creator_;
        weth = weth_;
        launchTime = uint64(block.timestamp);
        lockDuration = p.lockDuration;
        penaltyBps = p.penaltyBps;
        steepness = p.steepness;
        snipeWindow = p.snipeWindow;
        snipeMaxBuy = p.snipeMaxBuy;
        virtualEth0 = virtualEth0_;
        vEth = virtualEth0_;
        vTok = VIRTUAL_TOKEN0;
        maxLockEnd = uint64(block.timestamp) + 2 * p.lockDuration;
        lastRelease = uint64(block.timestamp);

        // The pool exists from day one so its address is known and nobody can seed it before graduation.
        pair = v2Factory == address(0) ? address(0) : IV2Factory(v2Factory).createPair(address(this), weth_);

        _curveMove = true;
        _mint(address(this), TOTAL_SUPPLY);
        _curveMove = false;

        if (msg.value > 0) _buy(creator_, msg.value, 0);
    }

    // ================================================================ trading

    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256) {
        return _buy(msg.sender, msg.value, minTokensOut);
    }

    function _buy(address buyer, uint256 ethIn, uint256 minOut) internal returns (uint256 out) {
        if (graduated) revert AlreadyGraduated();
        if (completed) revert CurveClosed();
        if (ethIn == 0) revert ZeroAmount();

        Holder storage h = holders[buyer];
        uint256 used;
        (out, used) = _quoteBuy(ethIn);
        if (out == 0) revert ZeroAmount();
        if (out < minOut) revert Slippage();

        if (block.timestamp < uint256(launchTime) + snipeWindow) {
            uint256 spent = uint256(h.snipeSpent) + used;
            if (spent > snipeMaxBuy) revert SnipeCap();
            h.snipeSpent = uint128(spent);
        }

        vEth += used;
        vTok -= out;
        realEth += used;
        tokensSold += out;
        h.costBasis += uint128(used);

        uint64 end = uint64(block.timestamp) + (buyer == creator ? 2 * lockDuration : lockDuration);
        if (end > h.lockEnd) h.lockEnd = end;
        if (end > maxLockEnd) maxLockEnd = end;

        _curveMove = true;
        _transfer(address(this), buyer, out);
        _curveMove = false;

        if (tokensSold == CURVE_SUPPLY) {
            completed = true;
            emit CurveCompleted(realEth, maxLockEnd);
        }

        emit Trade(buyer, true, used, out, 0, 0, vEth, vTok, h.lockEnd);

        if (ethIn > used) _send(buyer, ethIn - used);
    }

    function sell(uint256 amount, uint256 minEthOut) external nonReentrant returns (uint256 toSeller) {
        if (graduated) revert AlreadyGraduated();
        if (amount == 0) revert ZeroAmount();
        Holder storage h = holders[msg.sender];
        bool early = block.timestamp < h.lockEnd;
        if (early && msg.sender == creator) revert DevLocked();

        uint256 bal = balanceOf(msg.sender); // reverts below in _transfer if amount > bal
        if (amount > bal) revert ZeroAmount();
        uint256 value = _quoteSellValue(amount);
        uint256 basis = Math.mulDiv(h.costBasis, amount, bal);
        uint256 forfeit;
        (toSeller, forfeit) = _split(value, basis, early);
        if (toSeller < minEthOut) revert Slippage();

        vTok += amount;
        vEth -= value;
        realEth -= value;
        tokensSold -= amount;
        h.costBasis -= uint128(basis);

        _curveMove = true;
        _transfer(msg.sender, address(this), amount); // settles rewards on the old balance first
        _curveMove = false;

        if (forfeit > 0) _addForfeit(forfeit);

        emit Trade(msg.sender, false, value, amount, toSeller, forfeit, vEth, vTok, h.lockEnd);
        if (toSeller > 0) _send(msg.sender, toSeller);
    }

    /// @dev early seller gets min(value, basis) minus penalty% of basis (floored at 0); the rest is forfeited
    function _split(uint256 value, uint256 basis, bool early) internal view returns (uint256 toSeller, uint256 forfeit) {
        if (!early) return (value, 0);
        uint256 capped = value < basis ? value : basis;
        uint256 penalty = (basis * penaltyBps) / 10_000;
        toSeller = capped > penalty ? capped - penalty : 0;
        forfeit = value - toSeller;
    }

    // ================================================================ rewards

    function claim() external nonReentrant returns (uint256 amount) {
        _release();
        _settle(msg.sender);
        Holder storage h = holders[msg.sender];
        amount = h.owed;
        if (amount > rewardReserve) amount = rewardReserve;
        if (amount == 0) revert ZeroAmount();
        h.owed -= amount;
        rewardReserve -= amount;
        totalClaimed += amount;
        emit RewardsClaimed(msg.sender, amount);
        _send(msg.sender, amount);
    }

    /// @notice Anyone may push the reward stream forward (purely a gas donation; view functions already account for it).
    function poke() external {
        _release();
    }

    function _addForfeit(uint256 amount) internal {
        _release();
        streamRemaining += amount;
        streamEnd = uint64(block.timestamp + STREAM_DURATION);
        lastRelease = uint64(block.timestamp);
        rewardReserve += amount;
        totalForfeited += amount;
    }

    function _release() internal {
        (uint256 amt, int256[4] memory acc) = _previewRelease();
        if (amt == 0) {
            if (streamRemaining == 0) lastRelease = uint64(block.timestamp);
            return;
        }
        _acc = acc;
        streamRemaining -= amt;
        lastRelease = uint64(block.timestamp);
    }

    /// @dev what a release right now would do (amount released, accumulators after)
    function _previewRelease() internal view returns (uint256 amt, int256[4] memory acc) {
        acc = _acc;
        uint256 rem = streamRemaining;
        uint256 t = block.timestamp;
        if (rem == 0 || t <= lastRelease) return (0, acc);
        amt = t >= streamEnd ? rem : Math.mulDiv(rem, t - lastRelease, uint256(streamEnd) - lastRelease);
        if (amt == 0) return (0, acc);
        uint256 rel = t - launchTime;
        int256 d = _totalWeightAt(rel);
        if (d < int256(MIN_WEIGHT)) return (0, acc); // nobody (eligible) to pay yet: keep streaming later
        uint8 p = steepness;
        for (uint8 k = 0; k <= p; k++) {
            // round in the pool's favour: positive terms down, negative terms up
            bool neg = k % 2 == 1;
            uint256 inc = Math.mulDiv(
                amt * _binom(p, k) * (rel ** (p - k)), SCALE, uint256(d), neg ? Math.Rounding.Ceil : Math.Rounding.Floor
            );
            if (neg) acc[k] -= int256(inc);
            else acc[k] += int256(inc);
        }
    }

    function _totalWeightAt(uint256 rel) internal view returns (int256 d) {
        uint8 p = steepness;
        for (uint8 k = 0; k <= p; k++) {
            int256 term = int256(_binom(p, k) * (rel ** (p - k))) * _m[k];
            d += (k % 2 == 0) ? term : -term;
        }
    }

    function _pendingWith(address a, int256[4] memory acc) internal view returns (uint256) {
        uint256 b = balanceOf(a);
        if (b == 0 || !_eligible(a)) return 0;
        uint256 hs = holders[a].holdSince;
        int256[4] storage s = _snap[a];
        int256 sum;
        for (uint8 k = 0; k <= steepness; k++) {
            int256 delta = acc[k] - s[k];
            if (delta == 0) continue;
            uint256 mag = Math.mulDiv(
                b * (hs ** k),
                uint256(delta < 0 ? -delta : delta),
                SCALE,
                delta < 0 ? Math.Rounding.Ceil : Math.Rounding.Floor
            );
            sum += delta < 0 ? -int256(mag) : int256(mag);
        }
        return sum > 0 ? uint256(sum) : 0;
    }

    function _settle(address a) internal {
        if (a == address(0) || !_eligible(a)) return;
        uint256 pend = _pendingWith(a, _acc);
        if (pend > 0) holders[a].owed += pend;
        _snap[a] = _acc;
    }

    function _eligible(address a) internal view returns (bool) {
        return a != creator && a != address(this) && a != pair && a != address(0) && a != DEAD;
    }

    function _binom(uint8 p, uint8 k) internal pure returns (uint256) {
        if (k == 0 || k == p) return 1;
        if (p == 3) return 3; // C(3,1)=C(3,2)=3
        return 2; // C(2,1)
    }

    function _setPower(uint256 b, uint256 hs, bool add) internal {
        for (uint8 k = 0; k <= steepness; k++) {
            int256 v = int256(b * (hs ** k));
            if (add) _m[k] += v;
            else _m[k] -= v;
        }
    }

    // ================================================================ transfers

    function _update(address from, address to, uint256 value) internal override {
        bool internalMove = _curveMove;
        if (!internalMove) {
            // plain wallet-to-wallet transfer
            if (to == address(this)) revert TransferLocked();
            if (!graduated) {
                if (from != address(0) && block.timestamp < holders[from].lockEnd) revert TransferLocked();
                if (to == pair && pair != address(0)) revert PoolNotLive();
            }
        }

        _release();
        uint256 fb = from == address(0) ? 0 : balanceOf(from);
        uint256 tb = to == address(0) ? 0 : balanceOf(to);
        _settle(from);
        _settle(to);

        super._update(from, to, value);

        uint64 rel = uint64(block.timestamp - launchTime);
        if (from != address(0) && _eligible(from) && value > 0) {
            uint256 hs = holders[from].holdSince;
            _setPower(fb, hs, false);
            if (fb - value > 0) _setPower(fb - value, hs, true);
            else holders[from].holdSince = 0;
        }
        if (to != address(0) && _eligible(to) && value > 0) {
            uint256 hs = holders[to].holdSince;
            if (tb > 0) _setPower(tb, hs, false);
            uint256 nb = tb + value;
            // amount-weighted average entry time: topping up (or receiving) restarts the clock for the new tokens only
            uint256 nhs = (tb * hs + value * rel) / nb;
            holders[to].holdSince = uint64(nhs);
            _setPower(nb, nhs, true);
        }
        if (!internalMove && from != address(0) && to != address(0) && fb > 0) {
            // cost basis travels with the tokens (post-lock transfers only)
            Holder storage hf = holders[from];
            uint128 moved = uint128(Math.mulDiv(hf.costBasis, value, fb));
            hf.costBasis -= moved;
            holders[to].costBasis += moved;
        }
    }

    // ================================================================ graduation

    function graduate() external nonReentrant {
        if (graduated) revert AlreadyGraduated();
        if (!completed || block.timestamp < maxLockEnd || pair == address(0)) revert NotReady();
        graduated = true;
        _release();

        uint256 ethToPool = realEth;
        realEth = 0;
        uint256 have = balanceOf(address(this));
        uint256 tokensToPool = Math.mulDiv(ethToPool, vTok, vEth); // match the final curve price
        if (tokensToPool > have) tokensToPool = have;
        uint256 burnAmt = have - tokensToPool;

        _curveMove = true;
        if (burnAmt > 0) _burn(address(this), burnAmt);
        if (tokensToPool > 0) _transfer(address(this), pair, tokensToPool);
        _curveMove = false;

        if (ethToPool > 0) {
            IWETH(weth).deposit{value: ethToPool}();
            if (!IWETH(weth).transfer(pair, ethToPool)) revert EthSendFailed();
        }
        IV2Pair(pair).mint(DEAD); // LP tokens burned: liquidity locked forever
        emit Graduated(pair, ethToPool, tokensToPool, burnAmt);
    }

    // ================================================================ views

    function _quoteBuy(uint256 ethIn) internal view returns (uint256 out, uint256 used) {
        uint256 k = vEth * vTok;
        uint256 newTok = Math.ceilDiv(k, vEth + ethIn);
        out = vTok - newTok;
        used = ethIn;
        uint256 remaining = CURVE_SUPPLY - tokensSold;
        if (out >= remaining) {
            out = remaining;
            used = Math.ceilDiv(k, vTok - out) - vEth;
            if (used > ethIn) used = ethIn;
        }
    }

    function _quoteSellValue(uint256 amount) internal view returns (uint256) {
        uint256 k = vEth * vTok;
        return vEth - Math.ceilDiv(k, vTok + amount);
    }

    function quoteBuy(uint256 ethIn) external view returns (uint256 tokensOut, uint256 ethUsed) {
        if (completed || graduated || ethIn == 0) return (0, 0);
        return _quoteBuy(ethIn);
    }

    /// @return value gross curve value, toSeller what you'd receive, forfeit what goes to holders, early whether penalised
    function quoteSell(address seller, uint256 amount)
        external
        view
        returns (uint256 value, uint256 toSeller, uint256 forfeit, bool early)
    {
        uint256 bal = balanceOf(seller);
        if (graduated || amount == 0 || amount > bal) return (0, 0, 0, false);
        value = _quoteSellValue(amount);
        early = block.timestamp < holders[seller].lockEnd;
        uint256 basis = Math.mulDiv(holders[seller].costBasis, amount, bal);
        (toSeller, forfeit) = _split(value, basis, early);
    }

    /// @notice claimable rewards right now (includes the part of the stream that has dripped since the last tx)
    function pendingRewards(address a) public view returns (uint256) {
        (, int256[4] memory acc) = _previewRelease();
        uint256 v = holders[a].owed + _pendingWith(a, acc);
        return v > rewardReserve ? rewardReserve : v;
    }

    function weightOf(address a) public view returns (uint256) {
        if (!_eligible(a)) return 0;
        uint256 b = balanceOf(a);
        if (b == 0) return 0;
        uint256 rel = block.timestamp - launchTime;
        uint256 hs = holders[a].holdSince;
        return b * ((rel - hs) ** steepness);
    }

    function totalWeight() public view returns (uint256) {
        int256 d = _totalWeightAt(block.timestamp - launchTime);
        return d > 0 ? uint256(d) : 0;
    }

    /// @notice current ETH price per whole token on the curve (1e18 = 1 ETH)
    function price() external view returns (uint256) {
        return Math.mulDiv(vEth, 1e18, vTok);
    }

    function holderInfo(address a)
        external
        view
        returns (
            uint256 balance,
            uint64 lockEnd,
            uint64 holdSinceTs,
            uint256 costBasis,
            uint256 pending,
            uint256 weight,
            bool eligible
        )
    {
        Holder storage h = holders[a];
        balance = balanceOf(a);
        lockEnd = h.lockEnd;
        holdSinceTs = balance > 0 ? launchTime + h.holdSince : 0;
        costBasis = h.costBasis;
        pending = pendingRewards(a);
        weight = weightOf(a);
        eligible = _eligible(a);
    }

    struct State {
        uint256 vEth;
        uint256 vTok;
        uint256 realEth;
        uint256 tokensSold;
        bool completed;
        bool graduated;
        uint64 maxLockEnd;
        uint64 creatorLockEnd;
        uint256 streamRemaining;
        uint64 streamEnd;
        uint256 rewardReserve;
        uint256 totalForfeited;
        uint256 totalClaimed;
        uint256 totalWeight;
        uint256 graduationEth; // real ETH needed to sell out the curve
    }

    function state() external view returns (State memory s) {
        s.vEth = vEth;
        s.vTok = vTok;
        s.realEth = realEth;
        s.tokensSold = tokensSold;
        s.completed = completed;
        s.graduated = graduated;
        s.maxLockEnd = maxLockEnd;
        s.creatorLockEnd = holders[creator].lockEnd > launchTime + 2 * lockDuration
            ? holders[creator].lockEnd
            : launchTime + 2 * lockDuration;
        s.streamRemaining = streamRemaining;
        s.streamEnd = streamEnd;
        s.rewardReserve = rewardReserve;
        s.totalForfeited = totalForfeited;
        s.totalClaimed = totalClaimed;
        s.totalWeight = totalWeight();
        uint256 k = virtualEth0 * VIRTUAL_TOKEN0;
        s.graduationEth = Math.ceilDiv(k, VIRTUAL_TOKEN0 - CURVE_SUPPLY) - virtualEth0;
    }

    // ================================================================ internal

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthSendFailed();
    }

    receive() external payable {
        // only WETH unwrap paths or donations; donated ETH is never counted as curve or reward ETH
    }
}
