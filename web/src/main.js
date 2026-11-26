import { BRAND, tick } from './brand.js';
import { NET, DEPLOYED, PREVIEW } from './config.js';
import { W, wallets, connect, disconnect, onWallet, tryReconnect, switchChain, addrUrl } from './chain.js';
import { source } from './source.js';
import { $, $$, modal, toast, safeImg } from './ui.js';
import { esc, short, eth, tok, tinyPrice, lockLabel, dur, pct } from './fmt.js';
import { mountRings } from './rings.js';
import { timelineHTML, mountTimeline } from './timeline.js';
import { coinView } from './coin.js';
import { createView } from './create.js';
import { rowHTML } from './row.js';

document.title = `${BRAND.name}: ${BRAND.tagline}`;
const S = source();
let cleanup = [];
const onLeave = (f) => cleanup.push(f);

// ───────────────────────────────── shell
function shell() {
  const tape = Array(14).fill(`TESTNET <i>◎</i> ${NET.name.toUpperCase()} <i>◎</i> NO REAL MONEY <i>◎</i>`).join(' ');
  document.body.insertAdjacentHTML(
    'afterbegin',
    `<div class="tape" role="note" aria-label="Testnet only: ${esc(NET.name)}, no real money"><div class="tape-track">${tape}</div></div>
    <header class="bar">
      <a class="mark" href="#/" aria-label="${esc(BRAND.name)} home"><span class="mark-ring"></span>${esc(BRAND.wordmark)}</a>
      <nav class="nav">
        <a href="#/" data-nav="home">Ledger</a>
        <a href="#/create" data-nav="create">Launch</a>
        <a href="#/rules" data-nav="rules">Rules</a>
      </nav>
      <div class="bar-r">
        <span class="badge-testnet" title="Everything here runs on ${esc(NET.name)}. Test ETH only.">TESTNET</span>
        <button class="btn-wallet" id="walletBtn">Connect</button>
      </div>
    </header>
    ${PREVIEW ? `<div class="preview-note mono">${DEPLOYED ? 'Preview mode' : 'Preview'}: you are looking at a replay of a real local run of the contracts. Live trading opens once the ${esc(NET.name)} deployment is funded.</div>` : ''}
    <main id="view" tabindex="-1"></main>
    <footer class="foot">
      <div class="foot-grid mono">
        <span>${esc(BRAND.name)} · hold-to-earn launchpad · ${esc(NET.name)} testnet</span>
        <span>No owner keys · no fees · rules fixed at launch</span>
        <span>${DEPLOYED ? `<a href="${addrUrl(NET.dep.factory)}" target="_blank" rel="noopener">factory ${short(NET.dep.factory)} ↗</a>` : 'contracts: local preview'}</span>
        <span>Unaudited. Testnet only. Not financial advice. Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener">TradingView</a>.</span>
      </div>
      <div class="foot-word" aria-hidden="true">${esc(BRAND.wordmark)}</div>
    </footer>
    <div id="toasts" aria-live="polite"></div><div id="modal"></div>`
  );
  $('#walletBtn').addEventListener('click', walletMenu);
  onWallet(paintWallet);
  paintWallet();
}

function paintWallet() {
  const b = $('#walletBtn');
  if (!W.account) { b.textContent = 'Connect'; b.classList.remove('on', 'warn'); return; }
  if (!W.chainOk) { b.textContent = `Switch to ${NET.name}`; b.classList.add('warn'); return; }
  b.classList.remove('warn'); b.classList.add('on');
  b.innerHTML = `<span class="mono">${eth(W.balance, 4)} ETH</span><span>${short(W.account)}</span>`;
}

function walletMenu() {
  if (W.account && !W.chainOk) return switchChain();
  if (W.account) {
    return modal(
      `<h3 class="m-h">Wallet</h3><p class="mono m-sub">${esc(W.account)}</p>
      <p class="m-p">Need test ETH? Grab some from a ${esc(NET.name)} faucet: <a href="https://faucet.quicknode.com/base/sepolia" target="_blank" rel="noopener">QuickNode</a>, <a href="https://www.alchemy.com/faucets/base-sepolia" target="_blank" rel="noopener">Alchemy</a>, <a href="https://portal.cdp.coinbase.com/products/faucet" target="_blank" rel="noopener">Coinbase</a>.</p>
      <button class="btn ghost" id="dc">Disconnect</button>`,
      (m, close) => m.querySelector('#dc').addEventListener('click', () => { disconnect(); close(); })
    );
  }
  const list = wallets();
  modal(
    `<h3 class="m-h">Connect a wallet</h3>
     <p class="m-p">${esc(BRAND.name)} runs on <b>${esc(NET.name)}</b>. Use a test wallet; you will be asked to switch networks. Never use a wallet holding real funds you care about for experiments.</p>
     <div class="w-list">${list.length ? list.map((w, i) => `<button class="w-item" data-i="${i}">${w.info.icon ? `<img src="${esc(w.info.icon)}" alt="">` : '<span class="w-ico"></span>'}<span>${esc(w.info.name)}</span><span class="mono">→</span></button>`).join('') : `<p class="m-p mono">No browser wallet found. Install MetaMask, Rabby, Coinbase Wallet or Phantom, or open this page inside your wallet's browser.</p>`}</div>`,
    (m, close) => m.querySelectorAll('.w-item').forEach((b) => b.addEventListener('click', async () => {
      try { await connect(list[+b.dataset.i]); close(); toast('Wallet connected', 'ok'); } catch (e) { toast((e && e.message) || 'Could not connect', 'error'); }
    }))
  );
}

// ───────────────────────────────── home
async function homeView(v) {
  v.innerHTML = `
  <section class="hero">
    <canvas class="hero-rings" aria-hidden="true"></canvas>
    <div class="hero-in">
      <p class="kicker mono">A hold-to-earn meme coin launchpad <span>· ${esc(NET.name)} testnet</span></p>
      <h1 class="hero-h"><span class="l1">${esc(BRAND.heroTop)}</span><span class="l2">${esc(BRAND.heroTopVerb)}</span></h1>
      <p class="hero-serif">${esc(BRAND.heroBottom)}</p>
      <div class="hero-row">
        <p class="hero-p">Every coin has a lock. Sell before it ends and you forfeit your profit plus a penalty. That ETH streams, second by second, to whoever has held the longest.</p>
        <div class="hero-cta"><a class="btn" href="#/create">Launch a coin</a><a class="btn ghost" href="#/rules">How the payout works</a></div>
      </div>
      <div class="hero-stats" id="stats"></div>
    </div>
    <div class="stamp" aria-hidden="true"><span>TESTNET</span><small>${esc(NET.name)}</small></div>
  </section>
  <section class="ledger">
    <div class="sec-head">
      <h2 class="sec-h">The Ledger</h2>
      <div class="tabs mono" role="tablist"><button class="on" data-sort="new">New</button><button data-sort="hot">Most forfeited</button><button data-sort="close">Closest to graduation</button></div>
    </div>
    <div class="rows" id="rows"><div class="rows-empty mono">Reading the chain…</div></div>
  </section>
  <section class="rules-band">
    <div class="band-l">
      <p class="kicker mono">The one rule</p>
      <h2 class="band-h">Drag the moment<br><em>you sell.</em></h2>
      <p class="band-p">This is the exact math the contract runs, with a 1h lock and a 10% penalty. Before the lock ends you can still leave, but you leave the upside behind.</p>
    </div>
    ${timelineHTML('tlHome')}
  </section>`;
  const rings = mountRings($('.hero-rings', v), { mode: 'hero', cx: (w, h) => w * 0.78, cy: (w, h) => h * 0.52, radius: (w, h) => Math.max(w, h) * 0.62 });
  onLeave(() => rings.destroy());
  mountTimeline($('#tlHome', v), () => ({ L: 3600, penaltyBps: 1000 }));

  let sort = 'new', coins = [];
  $$('.tabs button', v).forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button', v).forEach((x) => x.classList.toggle('on', x === b));
    sort = b.dataset.sort; paint();
  }));
  function paint() {
    const now = S.now();
    const list = [...coins];
    if (sort === 'new') list.sort((a, b) => Number(b.launchTime) - Number(a.launchTime));
    if (sort === 'hot') list.sort((a, b) => (b.state.totalForfeited > a.state.totalForfeited ? 1 : -1));
    if (sort === 'close') list.sort((a, b) => Number(b.state.realEth) / Number(b.state.graduationEth) - Number(a.state.realEth) / Number(a.state.graduationEth));
    $('#rows', v).innerHTML = list.length ? list.map((c, i) => rowHTML(c, now, i)).join('') : `<div class="rows-empty"><p class="mono">No launches yet.</p><a class="btn" href="#/create">Be the first</a></div>`;
    const forfeited = coins.reduce((s, c) => s + c.state.totalForfeited, 0n);
    const claimed = coins.reduce((s, c) => s + c.state.totalClaimed, 0n);
    const raised = coins.reduce((s, c) => s + c.state.realEth, 0n);
    $('#stats', v).innerHTML = [
      [coins.length, 'coins launched'],
      [eth(raised, 4) + ' Ξ', 'on the curves'],
      [eth(forfeited, 5) + ' Ξ', 'forfeited by paper hands'],
      [eth(claimed, 5) + ' Ξ', 'claimed by holders'],
    ].map(([a, b]) => `<div><b>${a}</b><span class="mono">${b}</span></div>`).join('');
  }
  async function load() {
    try { coins = await S.coins(); paint(); } catch (e) { $('#rows', v).innerHTML = `<div class="rows-empty mono">Couldn't read the chain: ${esc(e.shortMessage || e.message)}</div>`; }
  }
  await load();
  const iv = setInterval(load, PREVIEW ? 30000 : 6000);
  onLeave(() => clearInterval(iv));
}

// ───────────────────────────────── rules
function rulesView(v) {
  v.innerHTML = `
  <section class="doc">
    <p class="kicker mono">Rules · enforced by the contract, fixed at launch, no admin key</p>
    <h1 class="doc-h">How ${esc(BRAND.name)}<br><em>pays the patient.</em></h1>
    <ol class="doc-list">
      <li><span class="n mono">01</span><div><h3>Every coin trades on a curve</h3><p>Pump-style constant-product bonding curve: price rises as people buy and falls as they sell. 1B supply; 793.1M are sold on the curve, the rest seeds the DEX pool at graduation. No fees, no owner.</p></div></li>
      <li><span class="n mono">02</span><div><h3>Buying starts your lock, L</h3><p>The creator picks L at launch (1 minute to 7 days). Each buy locks your whole bag until <span class="mono">now + L</span>. Topping up re-locks the whole bag. While locked, your tokens can't be transferred to another wallet: the transfer reverts.</p></div></li>
      <li><span class="n mono">03</span><div><h3>Sell early, pay the holders</h3><p>Sell before L ends and you receive <span class="mono">max(0, min(value, cost) − penalty × cost)</span>. Your profit and the penalty (creator-set, 1–50%, default 10%) are forfeited and stream to holders over 30 minutes.</p></div></li>
      <li><span class="n mono">04</span><div><h3>The creator holds twice as long</h3><p>The creator's buys lock for <b>2L</b> and the creator can't sell or transfer before then. Not with a penalty: at all. The creator also earns nothing from the reward pool.</p></div></li>
      <li><span class="n mono">05</span><div><h3>Longest holders earn the most</h3><p>The stream is split by weight <span class="mono">amount × (seconds held)<sup>p</sup></span>. The creator sets the steepness <span class="mono">p</span> (1 gentle, 2 steep, 3 very steep). Holding longer beats holding more. Splitting a bag across wallets earns exactly the same as one wallet. Rewards accrue every second; claim whenever you like.</p></div></li>
      <li><span class="n mono">06</span><div><h3>Snipers get a speed limit</h3><p>For the first minutes after launch (creator-set, default 5 min) each wallet can only spend up to a cap (default 0.001 test ETH), the creator included.</p></div></li>
      <li><span class="n mono">07</span><div><h3>Graduation waits for every lock</h3><p>When the curve sells out it stops taking buys. It graduates to a Uniswap V2 pool only after every lock has ended, the creator's 2L included. Anyone can trigger it; the LP tokens are burned.</p></div></li>
    </ol>
    <div class="formula">
      <p class="kicker mono">The payout formula</p>
      <div class="f-big">share<sub>i</sub>(t) = <span>b<sub>i</sub> · (t − h<sub>i</sub>)<sup>p</sup></span> ⁄ <span>Σ<sub>j</sub> b<sub>j</sub> · (t − h<sub>j</sub>)<sup>p</sup></span></div>
      <p class="f-p">At every moment t, the slice of the stream released in that moment goes to each eligible holder i in proportion to their balance <span class="mono">b</span> times the time they've held <span class="mono">(t − h)</span> raised to <span class="mono">p</span>. <span class="mono">h</span> is your amount-weighted entry time: a top-up only starts the clock for the new tokens. The contract does this in O(1) gas by keeping power sums of balances and entry times and expanding the binomial, then each wallet pulls its rewards with <span class="mono">claim()</span>.</p>
    </div>
    ${timelineHTML('tlRules')}
  </section>`;
  mountTimeline($('#tlRules', v), () => ({ L: 3600, penaltyBps: 1000 }));
}

// ───────────────────────────────── router
async function route() {
  cleanup.forEach((f) => { try { f(); } catch {} });
  cleanup = [];
  const v = $('#view');
  const hash = location.hash.slice(1) || '/';
  const [, page, arg] = hash.split('/');
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === (page || 'home')));
  const go = async () => {
    window.scrollTo(0, 0);
    if (page === 'coin' && arg) await coinView(v, arg, { S, onLeave });
    else if (page === 'create') await createView(v, { S, onLeave });
    else if (page === 'rules') rulesView(v);
    else await homeView(v);
  };
  v.classList.remove('enter');
  void v.offsetWidth;
  v.classList.add('enter');
  await go();
}

shell();
window.addEventListener('hashchange', route);
route();
tryReconnect();
window.__lp = { W, S, ready: true };
