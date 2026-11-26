// Interactive rule scrubber: drag the sell moment, see what you'd get.
import { eth, lockLabel } from './fmt.js';

export function timelineHTML(id) {
  return `<div class="tl" id="${id}">
    <div class="tl-top">
      <label class="tl-in"><span class="mono">You put in</span><b><span data-o="basis">0.01</span> ETH</b></label>
      <label class="tl-in"><span class="mono">Price since your buy</span><input type="range" min="40" max="400" value="180" data-i="mult"><b data-o="mult">1.8×</b></label>
    </div>
    <div class="tl-track" data-track>
      <div class="tl-zone early" data-z="early"><span>locked · early sell is penalised</span></div>
      <div class="tl-zone free" data-z="free"><span>free to sell</span></div>
      <div class="tl-mark" data-m="L"><i></i><span class="mono">L · you're free</span></div>
      <div class="tl-mark dev" data-m="2L"><i></i><span class="mono">2L · creator free</span></div>
      <div class="tl-knob" data-knob tabindex="0" role="slider" aria-label="Sell moment"><span class="mono" data-o="t">sell at 0:30</span></div>
    </div>
    <div class="tl-out">
      <div><span class="mono">Curve value</span><b data-o="value">–</b></div>
      <div><span class="mono">You receive</span><b data-o="recv">–</b></div>
      <div class="hot"><span class="mono">Goes to holders</span><b data-o="forf">–</b></div>
      <p class="tl-note" data-o="note"></p>
    </div>
  </div>`;
}

export function mountTimeline(root, getParams) {
  const knob = root.querySelector('[data-knob]');
  const track = root.querySelector('[data-track]');
  const mult = root.querySelector('[data-i="mult"]');
  const o = (k) => root.querySelector(`[data-o="${k}"]`);
  let x = 0.21; // fraction of the track (track = 2.4 L)
  const SPAN = 2.4;
  function render() {
    const { L, penaltyBps } = getParams();
    const lf = 1 / SPAN, df = 2 / SPAN;
    root.querySelector('[data-z="early"]').style.width = lf * 100 + '%';
    root.querySelector('[data-z="free"]').style.left = lf * 100 + '%';
    root.querySelector('[data-z="free"]').style.width = (1 - lf) * 100 + '%';
    root.querySelector('[data-m="L"]').style.left = lf * 100 + '%';
    root.querySelector('[data-m="2L"]').style.left = df * 100 + '%';
    root.querySelector('[data-m="L"] span').textContent = `L = ${lockLabel(L)} · you're free`;
    root.querySelector('[data-m="2L"] span').textContent = `2L = ${lockLabel(2 * L)} · creator free`;
    knob.style.left = x * 100 + '%';
    const t = x * SPAN * L;
    const early = t < L;
    const m = mult.value / 100;
    const basis = 0.01, value = basis * m;
    const pen = (basis * penaltyBps) / 10000;
    const recv = early ? Math.max(0, Math.min(value, basis) - pen) : value;
    const forf = value - recv;
    const mm = Math.floor(t / 60), ss = Math.floor(t % 60), hh = Math.floor(mm / 60);
    o('t').textContent = 'sell at ' + (hh ? `${hh}h ${mm % 60}m` : `${mm}m ${String(ss).padStart(2, '0')}s`);
    o('mult').textContent = m.toFixed(2) + '×';
    o('value').textContent = eth(value, 5) + ' ETH';
    o('recv').textContent = eth(recv, 5) + ' ETH';
    o('forf').textContent = eth(forf, 5) + ' ETH';
    root.classList.toggle('is-early', early);
    o('note').innerHTML = early
      ? `Selling before L: you keep at most what you paid, minus <b>${penaltyBps / 100}%</b> of it. Everything else streams to the people still holding.`
      : `After L the lock is gone: you keep the full curve value, profit included.`;
  }
  const move = (e) => {
    const r = track.getBoundingClientRect();
    x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    render();
  };
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    move(e);
    const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  });
  knob.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') x = Math.min(1, x + 0.02);
    if (e.key === 'ArrowLeft') x = Math.max(0, x - 0.02);
    render();
  });
  mult.addEventListener('input', render);
  render();
  return { render };
}
