import { parseEther, decodeEventLog } from 'viem';
import { BRAND, tick } from './brand.js';
import { NET, PREVIEW } from './config.js';
import { W, write } from './chain.js';
import { factoryAbi } from './abi.js';
import { $, $$, runTx, compressImage, toast, safeImg } from './ui.js';
import { esc, lockLabel, eth } from './fmt.js';
import { timelineHTML, mountTimeline } from './timeline.js';

const LOCKS = [300, 900, 3600, 6 * 3600, 86400];
const SNIPE = [0, 60, 180, 300, 600];

export async function createView(v, { onLeave }) {
  const f = { name: '', symbol: '', image: '', description: '', lock: 3600, penalty: 10, steep: 2, snipe: 300, maxBuy: '0.001', devBuy: '' };
  v.innerHTML = `
  <section class="create">
    <div class="cr-l">
      <p class="kicker mono">Launch · ${esc(NET.name)} testnet</p>
      <h1 class="doc-h">Write the<br><em>rules once.</em></h1>
      <p class="cr-p">Everything below is baked into the coin's contract at launch. Nobody can change it afterwards, including you.</p>
      <form class="charter" id="charter" autocomplete="off">
        <div class="cf two">
          <label><span class="mono">Name</span><input name="name" maxlength="32" placeholder="Diamond Duck" required></label>
          <label><span class="mono">Ticker</span><input name="symbol" maxlength="10" placeholder="DUCK" required></label>
        </div>
        <div class="cf img-f">
          <div class="img-drop" id="drop"><img id="imgPrev" alt=""><span class="mono">Drop an image<br>or click</span><input type="file" id="file" accept="image/*"></div>
          <label class="grow"><span class="mono">…or an image URL (https:// or ipfs://)</span><input name="imageUrl" placeholder="https://…"></label>
        </div>
        <label class="cf"><span class="mono">One line about it (optional)</span><input name="description" maxlength="280" placeholder="Only the patient eat."></label>

        <div class="cf"><span class="mono">Holder lock, L <i>creator holds 2L</i></span>
          <div class="seg" data-g="lock">${LOCKS.map((s) => `<button type="button" data-v="${s}" class="${s === 3600 ? 'on' : ''}">${lockLabel(s)}</button>`).join('')}<label class="seg-c"><input name="lockMin" inputmode="numeric" placeholder="custom min"></label></div>
        </div>
        <div class="cf"><span class="mono">Early-sell penalty <i>on top of forfeiting all profit</i></span>
          <div class="range"><input type="range" name="penalty" min="1" max="50" value="10"><b id="penOut">10%</b></div>
        </div>
        <div class="cf"><span class="mono">Rank steepness, p <i>how hard the longest holders win</i></span>
          <div class="seg" data-g="steep"><button type="button" data-v="1">1 · gentle</button><button type="button" data-v="2" class="on">2 · steep</button><button type="button" data-v="3">3 · very steep</button></div>
          <svg class="steep-viz" id="steepViz" viewBox="0 0 300 70" preserveAspectRatio="none" aria-hidden="true"></svg>
        </div>
        <div class="cf two">
          <div><span class="mono">Sniper guard window</span><div class="seg" data-g="snipe">${SNIPE.map((s) => `<button type="button" data-v="${s}" class="${s === 300 ? 'on' : ''}">${s ? lockLabel(s) : 'off'}</button>`).join('')}</div></div>
          <label><span class="mono">Max buy per wallet in window</span><input name="maxBuy" value="0.001" inputmode="decimal"><b class="unit mono">ETH</b></label>
        </div>
        <label class="cf"><span class="mono">Your opening buy (optional, locked 2L, counts toward the sniper cap)</span><input name="devBuy" inputmode="decimal" placeholder="0"><b class="unit mono">ETH</b></label>
        <button class="btn wide big" id="launch" ${PREVIEW ? 'disabled' : ''}>${PREVIEW ? 'Launching opens when contracts are live' : 'Launch coin'}</button>
        <p class="mono fine">Costs a little test gas. Creator buys lock for 2L and creators earn no share of forfeits.</p>
      </form>
    </div>
    <div class="cr-r">
      <div class="cr-sticky">
        <p class="kicker mono">Preview</p>
        <div class="cr-card">
          <img id="pvImg" alt="">
          <div><b id="pvTick">${esc(tick('TICKER'))}</b><em id="pvName">Your coin</em></div>
          <dl class="mono" id="pvRules"></dl>
        </div>
        ${timelineHTML('tlCreate')}
      </div>
    </div>
  </section>`;
  const form = $('#charter', v);
  const tl = mountTimeline($('#tlCreate', v), () => ({ L: f.lock, penaltyBps: f.penalty * 100 }));

  $$('.seg', v).forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', g).forEach((x) => x.classList.toggle('on', x === b));
    const k = g.dataset.g;
    if (k === 'lock') { f.lock = +b.dataset.v; form.lockMin.value = ''; }
    if (k === 'steep') f.steep = +b.dataset.v;
    if (k === 'snipe') f.snipe = +b.dataset.v;
    paint();
  }));
  form.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name === 'lockMin') {
      const m = parseInt(t.value);
      if (m >= 1 && m <= 10080) { f.lock = m * 60; $$('[data-g="lock"] button', v).forEach((x) => x.classList.remove('on')); }
    }
    if (t.name === 'penalty') f.penalty = +t.value;
    if (t.name === 'imageUrl') f.image = t.value.trim();
    paint();
  });
  const file = $('#file', v);
  $('#drop', v).addEventListener('click', () => file.click());
  $('#drop', v).addEventListener('dragover', (e) => { e.preventDefault(); $('#drop', v).classList.add('over'); });
  $('#drop', v).addEventListener('dragleave', () => $('#drop', v).classList.remove('over'));
  $('#drop', v).addEventListener('drop', (e) => { e.preventDefault(); $('#drop', v).classList.remove('over'); e.dataTransfer.files[0] && useFile(e.dataTransfer.files[0]); });
  file.addEventListener('change', () => file.files[0] && useFile(file.files[0]));
  async function useFile(fl) {
    try { f.image = await compressImage(fl); form.imageUrl.value = ''; paint(); } catch (e) { toast(e.message, 'error'); }
  }

  function steepViz() {
    // reward share per token for 8 holders who joined at evenly spaced times
    const n = 8, pts = [];
    const ws = Array.from({ length: n }, (_, i) => (n - i) ** f.steep);
    const mx = Math.max(...ws);
    let bars = '';
    ws.forEach((w, i) => {
      const hgt = (w / mx) * 60;
      bars += `<rect x="${i * 37 + 4}" y="${66 - hgt}" width="28" height="${hgt}" rx="1" class="${i === 0 ? 'top' : ''}"/>`;
    });
    $('#steepViz', v).innerHTML = bars + `<text x="4" y="10" class="sv-t">longest held →</text>`;
  }

  function paint() {
    f.name = form.name.value.trim();
    f.symbol = form.symbol.value.trim().toUpperCase().replace(/\s+/g, '');
    f.description = form.description.value.trim();
    $('#penOut', v).textContent = f.penalty + '%';
    $('#pvTick', v).textContent = tick(f.symbol || 'TICKER');
    $('#pvName', v).textContent = f.name || 'Your coin';
    const src = safeImg(f.image, f.symbol || 'preview');
    $('#pvImg', v).src = src;
    $('#imgPrev', v).src = f.image ? src : '';
    $('#drop', v).classList.toggle('has', !!f.image);
    $('#pvRules', v).innerHTML = [
      ['holder lock', lockLabel(f.lock)], ['creator lock', lockLabel(2 * f.lock)], ['penalty', f.penalty + '% + all profit'], ['steepness', 'p=' + f.steep], ['sniper guard', f.snipe ? `${form.maxBuy.value || '?'} Ξ for ${lockLabel(f.snipe)}` : 'off'],
    ].map(([a, b]) => `<div><dt>${a}</dt><dd>${esc(b)}</dd></div>`).join('');
    steepViz();
    tl.render();
  }
  paint();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (PREVIEW) return;
    if (!W.account) return $('#walletBtn').click();
    paint();
    if (!f.name || !f.symbol) return toast('Name and ticker are required', 'error');
    let maxBuy, devBuy;
    try { maxBuy = parseEther(form.maxBuy.value || '0.001'); devBuy = form.devBuy.value ? parseEther(form.devBuy.value) : 0n; } catch { return toast('Check the ETH amounts', 'error'); }
    if (f.image && !/^(data:image\/|https:\/\/|ipfs:\/\/)/.test(f.image)) return toast('Image must be an upload, https:// or ipfs:// URL', 'error');
    const params = { name: f.name, symbol: f.symbol, lockDuration: BigInt(f.lock), penaltyBps: f.penalty * 100, steepness: f.steep, snipeWindow: f.snipe, snipeMaxBuy: maxBuy < 10n ** 13n ? 10n ** 13n : maxBuy };
    $('#launch', v).disabled = true;
    const r = await runTx(`Launching ${tick(f.symbol)}`, () => write({ address: NET.dep.factory, abi: factoryAbi, functionName: 'createCoin', args: [params, f.image, f.description], value: devBuy }));
    $('#launch', v).disabled = false;
    if (!r) return;
    for (const log of r.receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
        if (ev.eventName === 'CoinCreated') { location.hash = `#/coin/${ev.args.coin}`; return; }
      } catch {}
    }
    location.hash = '#/';
  });
}
