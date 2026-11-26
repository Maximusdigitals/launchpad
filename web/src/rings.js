// The signature motif: growth rings. Time held is drawn the way a tree records it.
const TAU = Math.PI * 2;

function wobble(seed) {
  const a = [], n = 5;
  for (let i = 0; i < n; i++) a.push({ f: 2 + i * 1.7 + (seed % 7) * 0.13, p: (seed * (i + 1) * 1.37) % TAU, m: 1 / (i + 2) });
  return (t, time) => a.reduce((s, w) => s + Math.sin(t * w.f + w.p + time * 0.00004 * (w.f % 3)) * w.m, 0);
}

/**
 * mount a ring field on a canvas.
 * opts.data() -> [{ weight: 0..1 (ring thickness share), mine: bool, label }] ordered inner (longest held) -> outer
 * opts.mode: 'hero' (generative, grows forever) | 'holders'
 */
export function mountRings(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 0, h = 0, dpr = 1, raf = 0, alive = true, hover = -1;
  const t0 = performance.now();
  const seeds = Array.from({ length: 400 }, (_, i) => wobble(i * 97 + 13));

  function size() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  size();

  let geo = [];
  function frame(now) {
    if (!alive) return;
    const time = Math.max(0, now - t0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = opts.cx ? opts.cx(w, h) : w / 2, cy = opts.cy ? opts.cy(w, h) : h / 2;
    const R = opts.radius ? opts.radius(w, h) : Math.min(w, h) * 0.46;
    let rings;
    if (opts.mode === 'hero') {
      // a ring is added every few seconds; old rings drift outward - the field never stops growing
      const grow = reduce ? 0 : (time / 2600) % 1;
      rings = [];
      for (let i = 0; i < 46; i++) rings.push({ weight: 0.6 + 0.4 * Math.abs(Math.sin(i * 1.91)), mine: i % 11 === 4, k: i + grow });
    } else {
      rings = (opts.data ? opts.data() : []).map((r, i) => ({ ...r, k: i }));
    }
    const total = rings.reduce((s, r) => s + r.weight, 0) || 1;
    let acc = opts.mode === 'hero' ? 0 : R * 0.08;
    geo = [];
    const span = opts.mode === 'hero' ? R : R * 0.92;
    for (let i = 0; i < rings.length; i++) {
      const g = rings[i];
      let r0, thick;
      if (opts.mode === 'hero') {
        r0 = (g.k / rings.length) * span; thick = 1 + g.weight * 2.2;
      } else {
        thick = Math.min(span * 0.16, Math.max(1.2, (g.weight / total) * span * 0.9));
        r0 = acc + thick / 2; acc += thick + Math.max(1.5, span * 0.012);
      }
      const wob = seeds[(opts.mode === 'hero' ? Math.floor(g.k) : i) % seeds.length];
      const amp = (opts.mode === 'hero' ? 0.018 : 0.012) * r0;
      ctx.beginPath();
      const steps = Math.max(64, Math.floor(r0 * 0.9));
      for (let s = 0; s <= steps; s++) {
        const t = (s / steps) * TAU;
        const rr = r0 + wob(t, time) * amp;
        const x = cx + Math.cos(t) * rr, y = cy + Math.sin(t) * rr;
        s ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      const fade = opts.mode === 'hero' ? Math.max(0, Math.min(1, (g.k) / 3)) * Math.max(0, 1 - (g.k / rings.length) ** 3) : 1;
      const isHover = hover === i;
      ctx.lineWidth = thick;
      ctx.strokeStyle = g.mine ? `rgba(255,79,26,${0.95 * fade})` : `rgba(18,18,16,${(isHover ? 0.95 : opts.mode === 'hero' ? 0.16 + 0.3 * g.weight : 0.22 + 0.55 * (1 - i / Math.max(1, rings.length))) * fade})`;
      ctx.stroke();
      geo.push({ r0, thick, i });
    }
    if (opts.mode !== 'hero') {
      ctx.fillStyle = '#121210';
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, TAU); ctx.fill();
    }
    if (opts.after) opts.after(ctx, { w, h, cx, cy, R, time });
    if (!reduce || opts.mode !== 'hero') raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  canvas.addEventListener('pointermove', (e) => {
    if (opts.mode === 'hero' || !opts.onHover) return;
    const r = canvas.getBoundingClientRect();
    const cx = opts.cx ? opts.cx(w, h) : w / 2, cy = opts.cy ? opts.cy(w, h) : h / 2;
    const d = Math.hypot(e.clientX - r.left - cx, e.clientY - r.top - cy);
    const g = geo.find((g) => Math.abs(d - g.r0) <= g.thick / 2 + 3);
    hover = g ? g.i : -1;
    opts.onHover(hover);
  });
  canvas.addEventListener('pointerleave', () => { hover = -1; opts.onHover && opts.onHover(-1); });

  return { destroy() { alive = false; cancelAnimationFrame(raf); ro.disconnect(); }, setHover(i) { hover = i; } };
}
