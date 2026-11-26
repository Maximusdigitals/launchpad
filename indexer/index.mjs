#!/usr/bin/env node
// Lightweight indexer: reads factory + coin events and writes one JSON snapshot
// (coins, trades, holder rankings with pending rewards, reward pools).
// The web app reads the chain directly in the browser with the same code (web/src/core.js);
// this CLI exists for hosted snapshots, analytics, or a preview build.
//
//   node indexer/index.mjs --chain 31337 --out web/public/data/snapshot.json
//   node indexer/index.mjs --chain 84532 --watch 15      (re-index every 15 s)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createPublicClient, http } from 'viem';
import { makeIndexer, rankHolders, toJSON } from '../web/src/core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const chainId = +arg('chain', '84532');
const RPCS = { 84532: 'https://sepolia.base.org', 31337: 'http://127.0.0.1:8545' };
const rpc = arg('rpc', RPCS[chainId]);
const out = arg('out', path.join(here, `../web/public/data/snapshot-${chainId}.json`));
const dep = JSON.parse(fs.readFileSync(path.join(here, `../deployments/${chainId}.json`)));
if (!dep.factory) { console.error(`no deployment for chain ${chainId}`); process.exit(1); }

const client = createPublicClient({ transport: http(rpc) });
const ix = makeIndexer(client, dep);

async function run() {
  const t0 = Date.now();
  const capturedAt = await ix.chainNow();
  const coins = [];
  for (const row of await ix.coins()) {
    const { image, description, devBuy, createdBlock, ...r } = row;
    const act = await ix.activity(r.coin, r.launchBlock);
    const rows = await ix.holderRows(r.coin, act.holders);
    coins.push({ row: r, meta: { image, description, devBuy }, trades: act.trades, holders: rankHolders(rows, r.state.totalWeight) });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, toJSON({ chainId, capturedAt, factory: dep.factory, coins }));
  const pool = coins.reduce((s, c) => s + c.row.state.rewardReserve, 0n);
  console.log(`[${new Date().toISOString()}] ${coins.length} coins, ${coins.reduce((s, c) => s + c.trades.length, 0)} trades, reward pools ${Number(pool) / 1e18} ETH -> ${out} (${Date.now() - t0} ms)`);
}

const every = +arg('watch', '0');
await run();
if (every > 0) setInterval(() => run().catch((e) => console.error(e.shortMessage || e.message)), every * 1000);
