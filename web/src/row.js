import { tick } from './brand.js';
import { safeImg } from './ui.js';
import { esc, eth, lockLabel, dur, pct } from './fmt.js';

// ───────────────────────────────── feed row (the Ledger)
export function rowHTML(c, now, i) {
  const s = c.state;
  const prog = s.graduated || s.completed ? 1 : s.graduationEth > 0n ? Math.min(1, Number(s.realEth) / Number(s.graduationEth)) : 0;
  const price = Number(c.price) / 1e18;
  const mcap = price * 1e9;
  const age = now - Number(c.launchTime);
  const status = s.graduated ? 'graduated' : s.completed ? 'sold out' : now < Number(c.launchTime) + Number(c.snipeWindow) ? 'sniper guard' : 'curve open';
  return `<a class="row" href="#/coin/${c.coin}" style="--d:${i * 40}ms">
    <span class="r-n mono">${String(i + 1).padStart(3, '0')}</span>
    <img class="r-img" src="${esc(safeImg(c.image, c.coin))}" alt="" loading="lazy">
    <span class="r-t"><b>${esc(tick(c.symbol))}</b><em>${esc(c.name)}</em></span>
    <span class="r-k mono"><i>lock</i>${lockLabel(c.lockDuration)}</span>
    <span class="r-k mono"><i>penalty</i>${c.penaltyBps / 100}%</span>
    <span class="r-k mono hide-s"><i>steep</i>p=${c.steepness}</span>
    <span class="r-k mono"><i>mcap</i>${eth(mcap, 4)} Ξ</span>
    <span class="r-k mono hide-s"><i>to holders</i>${eth(s.totalForfeited, 5)} Ξ</span>
    <span class="r-p"><span class="r-bar"><span style="width:${(prog * 100).toFixed(1)}%"></span></span><span class="mono">${status} · ${pct(prog, 0)}</span></span>
    <span class="r-age mono">${dur(age, true)}</span>
  </a>`;
}

