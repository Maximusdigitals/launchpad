// ─────────────────────────────────────────────────────────────
// Rename the whole product here. Nothing else in the UI hard-codes it.
// (Contracts are name-neutral: LaunchFactory / LaunchCoin.)
// ─────────────────────────────────────────────────────────────
export const BRAND = {
  name: 'Holdpad',
  wordmark: 'HOLDPAD', // used in the giant footer / header mark
  tickerPrefix: '$',
  tagline: 'Paper hands pay. Diamond hands get paid.',
  heroTop: 'Paper hands',
  heroTopVerb: 'pay.',
  heroBottom: 'Diamond hands get paid.',
  description:
    'A hold-to-earn meme coin launchpad. Every coin trades on a bonding curve, early sellers forfeit their profit plus a penalty, and the longest holders split it.',
  url: 'https://maximusdigitals.github.io/launchpad/',
  network: 'Base Sepolia',
};
export const tick = (sym) => `${BRAND.tickerPrefix}${sym}`;
