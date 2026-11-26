import { createChart, CrosshairMode } from 'lightweight-charts';
import { parseEther, formatEther } from 'viem';
import { BRAND, tick } from './brand.js';
import { NET, PREVIEW } from './config.js';
import { W, onWallet, write, addrUrl } from './chain.js';
import { coinAbi } from './abi.js';
import { rankHolders, candles } from './core.js';
import { quoteBuy, quoteSell } from './curve.js';
import { $, $$, runTx, safeImg, toast } from './ui.js';
import { esc, short, eth, ethFixed, tok, tinyPrice, lockLabel, dur, pct, clock } from './fmt.js';
import { mountRings } from './rings.js';

const STEEP = { 1: 'gentle', 2: 'steep', 3: 'very steep' };

export async function coinView(v, addr, { S, onLeave }) {
  v.innerHTML = `<div class="loading mono">Loading coin…</div>`;
  let c;
  try { c = await S.coin(addr); } catch (e) { v.innerHTML = `<div class="loading mono">Coin not found. <a href="#/">Back to the ledger</a></div>`; return; }
  const L = Number(c.lockDuration);
  const me = () => (W.account || '').toLowerCase();
  const isCreator = () => me() && me() === c.creator.toLowerCase();

  v.innerHTML = `
  <section class="c-head">
    <img class="c-img" src="${esc(safeImg(c.image, c.coin))}" alt="">
    <div class="c-id">
      <p class="kicker mono">${esc(c.name)} · <a href="${addrUrl(c.coin)}" target="_blank" rel="noopener">${short(c.coin)}</a> · by ${isCreatorTag(c)}</p>
      <h1 class="c-tick">${esc(tick(c.symbol))}</h1>
      ${c.description ? `<p class="c-desc">${esc(c.description)}</p>` : ''}
    </div>
    <dl class="c-rules mono">
      <div><dt>holder lock</dt><dd>${lockLabel(L)}</dd></div>
      <div><dt>creator lock</dt><dd>${lockLabel(2 * L)}</dd></div>
      <div><dt>early-sell penalty</dt><dd>${c.penaltyBps / 100}%</dd></div>
      <div><dt>rank steepness</dt><dd>p=${c.steepness} · ${STEEP[c.steepness]}</dd></div>
      <div><dt>sniper guard</dt><dd>${Number(c.snipeWindow) ? `${eth(c.snipeMaxBuy, 4)} Ξ / wallet · ${lockLabel(c.snipeWindow)}` : 'off'}</dd></div>
    </dl>
  </section>
  <section class="c-grid">
    <div class="c-main">
      <div class="panel chart-p">
        <div class="p-head"><div><span class="mono lbl">price</span><b class="big" id="px">–</b><span class="mono chg" id="chg"></span></div><div class="mono lbl r" id="mc"></div></div>
        <div class="chart" id="chart"></div>
      </div>
      <div class="panel board">
        <div class="p-head"><h2 class="p-h">The Rings <em>holders by time held</em></h2><span class="mono lbl" id="pool"></span></div>
        <div class="board-in">
          <div class="board-rings"><canvas id="ringsC" aria-label="Holder rings: inner rings have held longest"></canvas><p class="mono ring-cap" id="ringCap">inner ring = longest holder</p></div>
          <div class="board-t">
            <div class="lb-head mono"><span>#</span><span>holder</span><span>held</span><span>bag</span><span>share</span><span>rewards</span></div>
            <div id="lb"></div>
          </div>
        </div>
      </div>
      <div class="panel tape-p">
        <div class="p-head"><h2 class="p-h">Tape</h2><span class="mono lbl">every buy, sell and forfeit</span></div>
        <div id="tape" class="tape-list"></div>
      </div>
    </div>
    <aside class="c-side">
      <div class="ticket panel" id="ticket">
        <div class="t-tabs"><button class="on" data-side="buy">Buy</button><button data-side="sell">Sell</button></div>
        <div class="t-body" id="tBody"></div>
      </div>
      <div class="panel pos" id="pos"></div>
      <div class="panel vault" id="vault"></div>
      <div class="panel grad" id="grad"></div>
    </aside>
  </section>`;

  // ── chart
  const chartEl = $('#chart', v);
  const chart = createChart(chartEl, {
    autoSize: true,
    layout: { attributionLogo: false, background: { color: 'transparent' }, textColor: '#5d5b55', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 },
    grid: { vertLines: { color: 'rgba(18,18,16,0.05)' }, horzLines: { color: 'rgba(18,18,16,0.05)' } },
    crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#121210', width: 1, style: 3 }, horzLine: { color: '#121210', width: 1, style: 3 } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.15, bottom: 0.1 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    localization: { priceFormatter: (p) => tinyPrice(p) },
    handleScroll: { vertTouchDrag: false },
  });
  const series = chart.addCandlestickSeries({
    upColor: '#121210', downColor: '#ff4f1a', borderUpColor: '#121210', borderDownColor: '#ff4f1a', wickUpColor: '#121210', wickDownColor: '#ff4f1a',
    priceFormat: { type: 'custom', formatter: (p) => tinyPrice(p), minMove: 1e-14 },
  });
  onLeave(() => chart.remove());

  // ── state
  let st = c.state, rows = [], ranked = [], trades = [], my = null, fetchedAt = 0;
  const prev = new Map(); // holder -> {p, t}
  const rate = new Map();
  let side = 'buy';

  const rings = mountRings($('#ringsC', v), {
    data: () => ranked.filter((r) => r.eligible || r.holder.toLowerCase() === c.creator.toLowerCase()).slice(0, 60).map((r) => ({ weight: Math.max(0.002, Number(r.balance) / 1e27), mine: r.holder.toLowerCase() === me() })),
    onHover: (i) => {
      const r = ranked.filter((r) => r.eligible || r.holder.toLowerCase() === c.creator.toLowerCase())[i];
      $('#ringCap', v).textContent = r ? `#${r.rank} ${short(r.holder)} · held ${dur(S.now() - Number(r.holdSince), true)} · ${tok(r.balance)}` : 'inner ring = longest holder';
      $$('.lb-row', v).forEach((el) => el.classList.toggle('hl', r && el.dataset.h === r.holder.toLowerCase()));
    },
  });
  onLeave(() => rings.destroy());

  // ── ticket
  $$('.t-tabs button', v).forEach((b) => b.addEventListener('click', () => {
    side = b.dataset.side;
    $$('.t-tabs button', v).forEach((x) => x.classList.toggle('on', x === b));
    paintTicket();
  }));

  function paintTicket() {
    const body = $('#tBody', v);
    const now = S.now();
    if (st.graduated) {
      body.innerHTML = `<p class="t-note">Graduated. The curve is closed and ${esc(tick(c.symbol))} now trades in its Uniswap V2 pool.</p>`;
      return;
    }
    if (side === 'buy') {
      const sniping = now < Number(c.launchTime) + Number(c.snipeWindow);
      body.innerHTML = `
        ${st.completed ? `<p class="t-warn">Sold out. The curve no longer takes buys; it graduates once every lock has ended.</p>` : ''}
        <label class="t-field"><span class="mono">You pay</span><input id="tIn" inputmode="decimal" placeholder="0.00" value="${st.completed ? '' : '0.001'}" ${st.completed ? 'disabled' : ''}><b>ETH</b></label>
        <div class="chips mono">${['0.0005', '0.001', '0.005', '0.01'].map((x) => `<button data-v="${x}">${x}</button>`).join('')}</div>
        <div class="t-q mono" id="tQ"></div>
        ${sniping ? `<p class="t-info">Sniper guard is on for ${dur(Number(c.launchTime) + Number(c.snipeWindow) - now, true)} more: max <b>${eth(c.snipeMaxBuy, 5)} ETH</b> per wallet.</p>` : ''}
        <p class="t-info lock">${isCreator() ? `You created this coin: buys lock for <b>${lockLabel(2 * L)}</b> (2L) and you can't sell or transfer before that.` : `Buying locks your <b>whole bag</b> for <b>${lockLabel(L)}</b>, until about ${clock(now + L)}. Selling before then forfeits your profit plus ${c.penaltyBps / 100}% of your cost.`}</p>
        <button class="btn wide" id="tGo" ${st.completed || PREVIEW ? 'disabled' : ''}>${PREVIEW ? 'Trading opens when live' : W.account ? `Buy ${esc(tick(c.symbol))}` : 'Connect wallet to buy'}</button>`;
    } else {
      const bal = my ? my.balance : 0n;
      body.innerHTML = `
        <label class="t-field"><span class="mono">You sell</span><input id="tIn" inputmode="decimal" placeholder="0" value=""><b>${esc(c.symbol)}</b></label>
        <div class="chips mono">${[25, 50, 75, 100].map((x) => `<button data-p="${x}">${x}%</button>`).join('')}</div>
        <p class="mono t-bal">balance ${tok(bal)} ${esc(c.symbol)}</p>
        <div class="t-q mono" id="tQ"></div>
        <div id="tWarn"></div>
        <button class="btn wide" id="tGo" ${PREVIEW ? 'disabled' : ''}>${PREVIEW ? 'Trading opens when live' : W.account ? 'Sell' : 'Connect wallet to sell'}</button>`;
    }
    const inp = $('#tIn', body);
    $$('.chips button', body).forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.v) { inp.value = b.dataset.v; delete inp.dataset.exact; }
      else if (my) {
        const x = (my.balance * BigInt(b.dataset.p)) / 100n;
        inp.dataset.exact = x.toString();
        inp.value = Math.floor(Number(formatEther(x))).toString();
      }
      quote();
    }));
    inp && inp.addEventListener('input', () => { delete inp.dataset.exact; quote(); });
    $('#tGo', body).addEventListener('click', submit);
    quote();
  }

  function amountIn() {
    const el = $('#tIn', v);
    if (el && el.dataset.exact) return BigInt(el.dataset.exact);
    const raw = (el || {}).value || '';
    try { return raw ? parseEther(raw.replace(',', '.')) : 0n; } catch { return 0n; }
  }

  function quote() {
    const q = $('#tQ', v);
    if (!q) return;
    const a = amountIn();
    const now = S.now();
    const go = $('#tGo', v);
    if (side === 'buy') {
      const r = quoteBuy(st, a);
      q.innerHTML = a ? `<div><span>you get</span><b>${tok(r.out)} ${esc(c.symbol)}</b></div><div><span>avg price</span><b>${r.out ? tinyPrice(Number(r.used) / Number(r.out)) : '–'} Ξ</b></div>${r.used < a ? `<div><span>refund</span><b>${eth(a - r.used, 6)} Ξ (curve sells out)</b></div>` : ''}` : '';
      return;
    }
    const w = $('#tWarn', v);
    if (!my || my.balance === 0n) { q.innerHTML = `<div><span>nothing to sell yet</span></div>`; w.innerHTML = ''; return; }
    const r = quoteSell(st, my, a > my.balance ? my.balance : a, now, c.penaltyBps);
    const creatorLocked = isCreator() && now < Number(my.lockEnd);
    q.innerHTML = a ? `<div><span>curve value</span><b>${eth(r.value, 6)} Ξ</b></div><div><span>you receive</span><b>${eth(r.toSeller, 6)} Ξ</b></div>${r.early ? `<div class="hot"><span>forfeited to holders</span><b>${eth(r.forfeit, 6)} Ξ</b></div>` : ''}` : '';
    if (creatorLocked) {
      w.innerHTML = `<div class="t-warn big"><b>Creator lock</b><span>You can't sell for another ${dur(Number(my.lockEnd) - now, true)}. Creators hold for 2L, no exceptions.</span></div>`;
      go.disabled = true; go.textContent = `Locked until ${clock(Number(my.lockEnd))}`;
    } else if (r.early) {
      w.innerHTML = `<div class="t-warn big"><b>Early sell · ${dur(Number(my.lockEnd) - now)} left on your lock</b><span>You'd give up <u>${eth(r.forfeit, 6)} ETH</u>: all of your profit plus ${c.penaltyBps / 100}% of what you paid. It goes to the holders who stay.</span></div>`;
      if (!PREVIEW && W.account) { go.textContent = 'Sell early anyway'; go.classList.add('danger'); }
    } else {
      w.innerHTML = a ? `<p class="t-info ok">Your lock is over. You keep the full value.</p>` : '';
      go.classList.remove('danger');
      if (!PREVIEW && W.account) go.textContent = 'Sell';
    }
  }

  async function submit() {
    if (PREVIEW) return;
    if (!W.account) return $('#walletBtn').click();
    const a = amountIn();
    if (!a) return toast('Enter an amount', 'error');
    if (side === 'buy') {
      const r = quoteBuy(st, a);
      const minOut = (r.out * 98n) / 100n;
      await runTx(`Buying ${tick(c.symbol)}`, () => write({ address: c.coin, abi: coinAbi, functionName: 'buy', args: [minOut], value: a }));
    } else {
      const amt = a > my.balance ? my.balance : a;
      const r = quoteSell(st, my, amt, S.now(), c.penaltyBps);
      const minOut = (r.toSeller * 98n) / 100n;
      await runTx(r.early ? 'Early sell' : 'Selling', () => write({ address: c.coin, abi: coinAbi, functionName: 'sell', args: [amt, minOut] }));
    }
    refresh();
  }

  async function claim() {
    await runTx('Claiming rewards', () => write({ address: c.coin, abi: coinAbi, functionName: 'claim', args: [] }));
    refresh();
  }

  async function graduate() {
    await runTx('Graduating to the pool', () => write({ address: c.coin, abi: coinAbi, functionName: 'graduate', args: [] }));
    refresh();
  }

  // ── panels
  function shown(r, now) {
    const base = r.pending;
    const rt = rate.get(r.holder.toLowerCase()) || 0;
    const est = Number(base) / 1e18 + rt * Math.max(0, now - fetchedAt);
    return est;
  }

  function paintPos(now) {
    const el = $('#pos', v);
    if (!W.account) { el.innerHTML = `<h3 class="p-h">Your position</h3><p class="t-info">Connect a wallet to see your lock, your rank and what you've earned.</p>`; return; }
    if (!my || my.balance === 0n) { el.innerHTML = `<h3 class="p-h">Your position</h3><p class="t-info">You don't hold ${esc(tick(c.symbol))} yet.</p>${my && my.pending > 0n ? claimBtn() : ''}`; bindClaim(el); return; }
    const left = Number(my.lockEnd) - now;
    const total = isCreator() ? 2 * L : L;
    const frac = left > 0 ? Math.min(1, left / total) : 0;
    const R = 54, C = 2 * Math.PI * R;
    const me_r = ranked.find((r) => r.holder.toLowerCase() === me());
    el.innerHTML = `<h3 class="p-h">Your position</h3>
      <div class="pos-in">
        <svg class="dial ${left > 0 ? 'locked' : 'free'}" viewBox="0 0 128 128" aria-label="Lock countdown">
          <circle cx="64" cy="64" r="${R}" class="d-bg"/>
          <circle cx="64" cy="64" r="${R}" class="d-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}" transform="rotate(-90 64 64)"/>
          <text x="64" y="62" class="d-t">${left > 0 ? dur(left) : 'free'}</text>
          <text x="64" y="80" class="d-s">${left > 0 ? (isCreator() ? 'creator lock' : 'until free to sell') : 'sell any time'}</text>
        </svg>
        <dl class="mono pos-dl">
          <div><dt>bag</dt><dd>${tok(my.balance)}</dd></div>
          <div><dt>cost basis</dt><dd>${eth(my.costBasis, 6)} Ξ</dd></div>
          <div><dt>held for</dt><dd>${dur(now - Number(my.holdSince), true)}</dd></div>
          <div><dt>rank</dt><dd>${me_r ? '#' + me_r.rank + ' of ' + ranked.length : '–'}</dd></div>
          <div><dt>share of stream</dt><dd>${me_r && me_r.eligible ? me_r.share.toFixed(2) + '%' : isCreator() ? 'creators earn 0' : '–'}</dd></div>
          <div class="rew"><dt>claimable</dt><dd data-tick="${me()}">${ethFixed(shown(my, now), 10)}</dd></div>
        </dl>
      </div>${left > 0 && !isCreator() ? `<p class="t-warn">Sell before ${clock(Number(my.lockEnd))} and you forfeit your profit plus ${c.penaltyBps / 100}% of your cost.</p>` : ''}
      ${my.pending > 0n ? claimBtn() : ''}`;
    bindClaim(el);
  }
  const claimBtn = () => `<button class="btn wide" data-claim ${PREVIEW ? 'disabled' : ''}>${PREVIEW ? 'Claim (live only)' : 'Claim rewards'}</button>`;
  const bindClaim = (el) => $$('[data-claim]', el).forEach((b) => b.addEventListener('click', claim));

  function paintVault(now) {
    const cr = rows.find((r) => r.holder.toLowerCase() === c.creator.toLowerCase());
    const end = Number(st.creatorLockEnd);
    const left = end - now;
    const frac = Math.max(0, Math.min(1, 1 - left / (2 * L)));
    $('#vault', v).innerHTML = `<h3 class="p-h">Creator vault</h3>
      <p class="mono lbl">${short(c.creator)} · ${cr ? tok(cr.balance) + ' ' + esc(c.symbol) : 'no dev buy'} · earns no rewards</p>
      <div class="pbar"><span style="width:${(frac * 100).toFixed(2)}%"></span></div>
      <p class="v-s">${left > 0 ? `<b>Locked</b> for ${dur(left)} more, until ${clock(end)}. The creator can't sell or move tokens before then.` : `<b>Unlocked.</b> The creator has held for the full 2L.`}</p>`;
  }

  function paintGrad(now) {
    const prog = st.graduated || st.completed ? 1 : st.graduationEth > 0n ? Math.min(1, Number(st.realEth) / Number(st.graduationEth)) : 0;
    const wait = Number(st.maxLockEnd) - now;
    let msg, btn = '';
    if (st.graduated) msg = `<b>Graduated.</b> Liquidity is in the Uniswap V2 pool and the LP tokens are burned.`;
    else if (st.completed && wait > 0) msg = `<b>Sold out.</b> Buys are closed. It graduates in ${dur(wait)}, when the last lock (creator's 2L included) ends.`;
    else if (st.completed) { msg = `<b>Ready.</b> Every lock has ended. Anyone can send it to the pool.`; btn = `<button class="btn wide" id="gradBtn" ${PREVIEW ? 'disabled' : ''}>Graduate to Uniswap V2</button>`; }
    else msg = `${eth(st.graduationEth - st.realEth, 5)} ETH left on the curve. Once it sells out, buys stop and it graduates after every lock ends.`;
    $('#grad', v).innerHTML = `<h3 class="p-h">Graduation</h3><div class="pbar ${st.completed ? 'done' : ''}"><span style="width:${(prog * 100).toFixed(2)}%"></span></div><p class="mono lbl">${eth(st.realEth, 5)} / ${eth(st.graduationEth, 5)} Ξ · ${pct(prog, 1)}</p><p class="v-s">${msg}</p>${btn}`;
    const gb = $('#gradBtn', v);
    gb && gb.addEventListener('click', graduate);
  }

  function paintBoard(now) {
    const list = ranked;
    $('#pool', v).textContent = `${eth(st.totalForfeited, 6)} Ξ forfeited · ${eth(st.totalClaimed, 6)} Ξ claimed`;
    $('#lb', v).innerHTML = list.length
      ? list.slice(0, 50).map((r) => {
          const mine = r.holder.toLowerCase() === me();
          const creator = r.holder.toLowerCase() === c.creator.toLowerCase();
          const locked = now < Number(r.lockEnd);
          return `<div class="lb-row ${mine ? 'mine' : ''}" data-h="${r.holder.toLowerCase()}">
            <span class="mono">${r.rank}</span>
            <span class="lb-who"><a href="${addrUrl(r.holder)}" target="_blank" rel="noopener" class="mono">${mine ? 'you' : short(r.holder)}</a>${creator ? '<i class="tag">creator</i>' : ''}${locked ? `<i class="tag lock" title="locked until ${clock(Number(r.lockEnd))}">locked</i>` : ''}</span>
            <span class="mono">${dur(now - Number(r.holdSince), true)}</span>
            <span class="mono">${tok(r.balance)}</span>
            <span class="mono">${r.eligible ? r.share.toFixed(2) + '%' : '–'}</span>
            <span class="mono rew" data-tick="${r.holder.toLowerCase()}">${r.eligible ? ethFixed(shown(r, now), 10) : 'n/a'}</span>
            ${mine && r.pending > 0n ? `<button class="btn mini" data-claim ${PREVIEW ? 'disabled' : ''}>claim</button>` : '<span></span>'}
          </div>`;
        }).join('')
      : `<p class="mono lbl pad">No holders yet.</p>`;
    bindClaim($('#lb', v));
  }

  function paintTape() {
    const list = [...trades].sort((a, b) => Number(b.block - a.block) || b.logIndex - a.logIndex).slice(0, 40);
    $('#tape', v).innerHTML = list.length ? list.map((t) => `<div class="tp ${t.isBuy ? 'b' : t.forfeited > 0n ? 'f' : 's'}">
      <span class="mono">${clock(Number(t.timestamp))}</span>
      <span class="mono">${t.isBuy ? 'BUY' : t.forfeited > 0n ? 'EARLY SELL' : 'SELL'}</span>
      <span class="mono">${short(t.trader)}</span>
      <span class="mono">${tok(t.tokenAmount)}</span>
      <span class="mono">${eth(t.isBuy ? t.ethAmount : t.ethToTrader, 6)} Ξ</span>
      <span class="mono hot">${t.forfeited > 0n ? '→ holders ' + eth(t.forfeited, 6) + ' Ξ' : ''}</span>
    </div>`).join('') : `<p class="mono lbl pad">No trades yet.</p>`;
  }

  function paintChart() {
    const span = trades.length ? Number(trades[trades.length - 1].timestamp) - Number(trades[0].timestamp) : 0;
    const data = candles(trades, span > 6 * 3600 ? 300 : 60);
    series.setData(data.map((d) => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close })));
    series.setMarkers(trades.filter((t) => t.forfeited > 0n).map((t) => ({ time: Number(t.timestamp) - (Number(t.timestamp) % (span > 6 * 3600 ? 300 : 60)), position: 'aboveBar', color: '#ff4f1a', shape: 'arrowDown', text: 'forfeit' })).sort((a, b) => a.time - b.time));
    const p = Number(c.price) / 1e18;
    $('#px', v).textContent = tinyPrice(p) + ' Ξ';
    const first = data.length ? data[0].open : p;
    const ch = first ? (p / first - 1) * 100 : 0;
    $('#chg', v).textContent = (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%';
    $('#chg', v).classList.toggle('dn', ch < 0);
    $('#mc', v).textContent = `mcap ${eth(p * 1e9, 4)} Ξ · ${trades.length} trades`;
    if (!paintChart.fitted && data.length) {
      if (data.length > 40) chart.timeScale().fitContent();
      else chart.timeScale().setVisibleLogicalRange({ from: data.length - 40, to: data.length + 1 });
      paintChart.fitted = true;
    }
  }

  function paintAll() {
    const now = S.now();
    paintChart();
    paintBoard(now);
    paintTape();
    paintPos(now);
    paintVault(now);
    paintGrad(now);
    if (document.activeElement !== $('#tIn', v)) paintTicket();
    else quote();
  }

  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      await S.sync();
      c = await S.coin(addr);
      st = c.state;
      const act = await S.activity(addr, c.launchBlock);
      trades = act.trades;
      const list = [...new Set([...act.holders.map((h) => h.toLowerCase()), ...(W.account ? [me()] : [])])];
      rows = await S.holderRows(addr, list);
      const now = S.now();
      // per-holder reward rate from consecutive reads (drives the live ticker)
      const streaming = st.streamRemaining > 0n && now < Number(st.streamEnd);
      const streamRate = streaming ? Number(st.streamRemaining) / 1e18 / Math.max(1, Number(st.streamEnd) - now) : 0;
      const tw = st.totalWeight > 0n ? Number(st.totalWeight) : 0;
      for (const r of rows) {
        const k = r.holder.toLowerCase();
        const p = Number(r.pending) / 1e18;
        const pv = prev.get(k);
        const est = r.eligible && tw ? (Number(r.weight) / tw) * streamRate : 0;
        let rt = est;
        if (pv && now > pv.t + 0.5 && p >= pv.p) rt = (p - pv.p) / (now - pv.t);
        if (!streaming) rt = 0;
        rate.set(k, rt);
        prev.set(k, { p, t: now });
      }
      fetchedAt = now;
      ranked = rankHolders(rows, st.totalWeight);
      my = W.account ? rows.find((r) => r.holder.toLowerCase() === me()) || null : null;
      paintAll();
    } catch (e) {
      console.warn(e);
    } finally {
      busy = false;
    }
  }

  await refresh();
  const iv = setInterval(refresh, PREVIEW ? 60000 : 5000);
  onLeave(() => clearInterval(iv));
  onLeave(onWallet(() => refresh()));

  // live ticker: claimable rewards and countdowns tick every frame between reads
  let raf;
  let lastSec = 0;
  const tickFn = () => {
    const now = S.now();
    for (const el of $$('[data-tick]', v)) {
      const k = el.dataset.tick;
      const r = rows.find((x) => x.holder.toLowerCase() === k);
      if (r && r.eligible) el.textContent = ethFixed(shown(r, now), 10);
    }
    if (Math.floor(now) !== lastSec) {
      lastSec = Math.floor(now);
      paintPos(now); paintVault(now); paintGrad(now);
      if (side === 'sell' && document.activeElement !== $('#tIn', v)) quote();
    }
    raf = requestAnimationFrame(tickFn);
  };
  raf = requestAnimationFrame(tickFn);
  onLeave(() => cancelAnimationFrame(raf));
}

function isCreatorTag(c) {
  return `<a href="${addrUrl(c.creator)}" target="_blank" rel="noopener">${short(c.creator)}</a> · launched ${new Date(Number(c.launchTime) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}
