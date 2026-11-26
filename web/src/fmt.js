export const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '');
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** ETH from wei bigint (or number of ETH) */
export function eth(v, dp = 5) {
  const n = typeof v === 'bigint' ? Number(v) / 1e18 : v;
  if (!n) return '0';
  if (Math.abs(n) < 10 ** -dp) return n.toExponential(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}
export const ethFixed = (v, dp = 9) => (typeof v === 'bigint' ? Number(v) / 1e18 : v).toFixed(dp);

/** compact token amounts (18 decimals) */
export function tok(v) {
  const n = typeof v === 'bigint' ? Number(v) / 1e18 : v;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(n < 1 ? 4 : 0);
}

/** tiny prices with subscript zero count: 0.0₁₀186 */
export function tinyPrice(p) {
  if (!p) return '0';
  if (p >= 0.001) return p.toPrecision(4);
  const s = p.toExponential(3); // 1.860e-11
  const [m, e] = s.split('e');
  const zeros = -parseInt(e) - 1;
  const digits = m.replace('.', '').replace(/0+$/, '');
  const sub = String(zeros).split('').map((d) => '₀₁₂₃₄₅₆₇₈₉'[d]).join('');
  return `0.0${sub}${digits}`;
}

export function dur(sec, long = false) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (long) {
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m ${s}s`;
    return `${s}s`;
  }
  const p = (x) => String(x).padStart(2, '0');
  return d ? `${d}d ${p(h)}:${p(m)}:${p(s)}` : h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

export function lockLabel(sec) {
  sec = Number(sec);
  if (sec % 86400 === 0) return sec / 86400 + 'd';
  if (sec % 3600 === 0) return sec / 3600 + 'h';
  if (sec % 60 === 0) return sec / 60 + 'm';
  return sec + 's';
}

export const pct = (x, dp = 1) => (x * 100).toFixed(dp) + '%';
export const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** deterministic hue-free "ring" avatar for coins without images (SVG data URI) */
export function ringAvatar(seed) {
  let h = 2166136261;
  for (const c of seed.toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0), (h & 0xffff) / 0xffff);
  let rings = '';
  let r = 46;
  let i = 0;
  while (r > 4) {
    const w = 1 + rnd() * 5;
    const fill = i % 3 === 1 ? '#ff4f1a' : '#121210';
    rings += `<circle cx="${50 + (rnd() - 0.5) * 3}" cy="${50 + (rnd() - 0.5) * 3}" r="${r.toFixed(1)}" fill="none" stroke="${fill}" stroke-width="${w.toFixed(1)}" opacity="${(0.35 + rnd() * 0.65).toFixed(2)}"/>`;
    r -= w + 2 + rnd() * 6;
    i++;
  }
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#e4e1d8"/>${rings}</svg>`);
}
