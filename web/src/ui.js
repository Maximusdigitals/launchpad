// small UI kit: toasts, modal, safe images, tx runner
import { esc, ringAvatar } from './fmt.js';
import { txUrl } from './chain.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function toast(msg, kind = 'info', link) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<span class="dot"></span><span class="msg">${esc(msg)}</span>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">view tx ↗</a>` : ''}`;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => { el.classList.remove('in'); setTimeout(() => el.remove(), 400); }, kind === 'error' ? 9000 : 5500);
  return el;
}

export function modal(html, onMount) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-bg" data-close></div><div class="modal-card" role="dialog" aria-modal="true">${html}<button class="modal-x" data-close aria-label="Close">×</button></div>`;
  m.classList.add('open');
  const close = () => { m.classList.remove('open'); setTimeout(() => (m.innerHTML = ''), 250); };
  m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  onMount && onMount(m, close);
  return close;
}

export function safeImg(src, seed) {
  if (typeof src === 'string') {
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(src)) return src;
    if (/^https:\/\/[^\s"'<>]+$/i.test(src)) return src;
    if (/^ipfs:\/\/[a-z0-9]+/i.test(src)) return 'https://ipfs.io/ipfs/' + src.slice(7);
  }
  return ringAvatar(seed || 'x');
}

export function niceError(e) {
  const full = [e && e.shortMessage, e && e.message, e && e.cause && e.cause.data && e.cause.data.errorName, e && e.data && e.data.errorName].filter(Boolean).join(' | ') || String(e);
  const m = full;
  const map = {
    SnipeCap: 'Anti-sniper cap: this wallet has hit the max buy for the launch window.',
    DevLocked: 'Creators cannot sell before their 2× lock ends.',
    TransferLocked: 'Tokens can’t move while your lock is running.',
    CurveClosed: 'The curve is sold out. Buys are closed until graduation.',
    AlreadyGraduated: 'This coin has graduated. Trade it on the DEX pool.',
    Slippage: 'Price moved. Try again.',
    NotReady: 'Not ready to graduate yet.',
    BadParams: 'One of the launch settings is out of bounds.',
    ZeroAmount: 'Nothing to do (amount is zero).',
    'User rejected': 'You rejected the request in your wallet.',
    'insufficient funds': 'Not enough test ETH in this wallet.',
  };
  for (const k in map) if (m.includes(k)) return map[k];
  return ((e && e.shortMessage) || m).split('\n')[0].slice(0, 160);
}

/** run a write with toasts; returns receipt or null */
export async function runTx(label, fn) {
  const t = toast(`${label}… confirm in your wallet`, 'pending');
  try {
    const r = await fn();
    t.remove();
    toast(`${label}: confirmed`, 'ok', r && r.hash ? txUrl(r.hash) : '');
    return r;
  } catch (e) {
    t.remove();
    toast(niceError(e), 'error');
    return null;
  }
}

/** compress an image file into a small data URL that fits the on-chain event (max ~10 KB) */
export async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  for (const [size, q] of [[160, 0.82], [128, 0.75], [112, 0.65], [96, 0.6], [80, 0.5]]) {
    c.width = c.height = size;
    const g = c.getContext('2d');
    const s = Math.min(bmp.width, bmp.height);
    g.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
    let url = c.toDataURL('image/webp', q);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/jpeg', q);
    if (url.length <= 10000) return url;
  }
  throw new Error('Image too detailed, try a simpler one');
}
