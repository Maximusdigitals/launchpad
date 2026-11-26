// Data source: live chain (viem) or a preview snapshot captured from a real local run of the contracts.
import { NET, PREVIEW } from './config.js';
import { makeIndexer, fromJSON } from './core.js';
import { pub } from './chain.js';

let impl;

function liveSource() {
  const ix = makeIndexer(pub, NET.dep);
  let offset = 0; // chain time - wall time
  let synced = 0;
  async function sync() {
    try {
      const t = await ix.chainNow();
      offset = t - Date.now() / 1000;
      synced = Date.now();
    } catch {}
  }
  sync();
  return {
    preview: false,
    coins: ix.coins,
    coin: ix.coin,
    activity: ix.activity,
    holderRows: ix.holderRows,
    now: () => {
      if (Date.now() - synced > 15000) sync();
      return Date.now() / 1000 + offset;
    },
    sync,
  };
}

function previewSource() {
  let snap;
  const load = (async () => {
    const r = await fetch('data/snapshot.json?v=__V__');
    snap = fromJSON(await r.text());
    snap.loadedAt = Date.now() / 1000;
  })();
  const now = () => (snap ? snap.capturedAt + (Date.now() / 1000 - snap.loadedAt) : Date.now() / 1000);
  const byAddr = (a) => snap.coins.find((c) => c.row.coin.toLowerCase() === a.toLowerCase());
  return {
    preview: true,
    async coins() {
      await load;
      return snap.coins.map((c) => ({ ...c.row, ...c.meta }));
    },
    async coin(a) {
      await load;
      const c = byAddr(a);
      if (!c) throw new Error('Unknown coin');
      return { ...c.row, ...c.meta };
    },
    async activity(a) {
      await load;
      const c = byAddr(a);
      return { trades: c.trades, holders: c.holders.map((h) => h.holder) };
    },
    async holderRows(a) {
      await load;
      return byAddr(a).holders;
    },
    now,
    sync: async () => {},
    capturedAt: () => snap && snap.capturedAt,
  };
}

export function source() {
  if (!impl) impl = PREVIEW ? previewSource() : liveSource();
  return impl;
}
