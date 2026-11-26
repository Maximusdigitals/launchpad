// Chain-reading core shared by the browser app and the Node indexer (no DOM here).
import { parseAbiItem } from 'viem';
import { coinAbi, factoryAbi, lensAbi } from './abi.js';

export const EV_CREATED = parseAbiItem(
  'event CoinCreated(address indexed coin, address indexed creator, string name, string symbol, string image, string description, uint64 lockDuration, uint16 penaltyBps, uint8 steepness, uint32 snipeWindow, uint128 snipeMaxBuy, uint256 devBuy)'
);
export const EV_TRADE = parseAbiItem(
  'event Trade(address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 ethToTrader, uint256 forfeited, uint256 vEthAfter, uint256 vTokAfter, uint64 lockEnd, uint64 timestamp)'
);
export const EV_TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
export const EV_CLAIM = parseAbiItem('event RewardsClaimed(address indexed holder, uint256 amount)');

const ZERO = '0x0000000000000000000000000000000000000000';
const DEAD = '0x000000000000000000000000000000000000dead';

/** chunked getLogs that adapts to RPC range limits */
export async function getLogsChunked(client, { address, event, fromBlock, toBlock }) {
  let step = 9000n;
  const out = [];
  let from = BigInt(fromBlock);
  const to = BigInt(toBlock);
  while (from <= to) {
    const end = from + step - 1n > to ? to : from + step - 1n;
    try {
      const logs = await client.getLogs({ address, event, fromBlock: from, toBlock: end });
      out.push(...logs);
      from = end + 1n;
    } catch (e) {
      if (step <= 500n) throw e;
      step /= 2n;
    }
  }
  return out;
}

export function makeIndexer(client, dep) {
  const factory = dep.factory;
  const lens = dep.lens;
  const meta = new Map(); // coin -> {image, description, devBuy}
  const trades = new Map(); // coin -> [trade]
  const holderSet = new Map(); // coin -> Set(addr)
  const scanned = new Map(); // key -> last scanned block
  let createdScanned = BigInt(dep.block || 0) - 1n;

  async function head() {
    return client.getBlockNumber();
  }

  async function scanCreated(toBlock) {
    if (toBlock <= createdScanned) return;
    const logs = await getLogsChunked(client, { address: factory, event: EV_CREATED, fromBlock: createdScanned + 1n, toBlock });
    for (const l of logs) {
      const a = l.args;
      meta.set(a.coin.toLowerCase(), { image: a.image, description: a.description, devBuy: a.devBuy, createdBlock: l.blockNumber });
    }
    createdScanned = toBlock;
  }

  async function coins() {
    const n = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'coinsCount' });
    const rows = [];
    for (let s = 0n; s < n; s += 40n) {
      const page = await client.readContract({ address: lens, abi: lensAbi, functionName: 'coins', args: [factory, s, 40n] });
      rows.push(...page);
    }
    const toBlock = await head();
    await scanCreated(toBlock);
    return rows.map((r) => ({ ...r, ...(meta.get(r.coin.toLowerCase()) || {}) }));
  }

  async function coin(addr) {
    const r = await client.readContract({ address: lens, abi: lensAbi, functionName: 'coin', args: [addr] });
    if (!meta.has(addr.toLowerCase())) {
      const logs = await getLogsChunked(client, { address: factory, event: EV_CREATED, fromBlock: r.launchBlock, toBlock: r.launchBlock });
      for (const l of logs) meta.set(l.args.coin.toLowerCase(), { image: l.args.image, description: l.args.description, devBuy: l.args.devBuy });
    }
    return { ...r, ...(meta.get(addr.toLowerCase()) || {}) };
  }

  /** incremental: returns all trades + holders for a coin */
  async function activity(addr, launchBlock) {
    const k = addr.toLowerCase();
    const toBlock = await head();
    const from = scanned.has(k) ? scanned.get(k) + 1n : BigInt(launchBlock);
    if (!trades.has(k)) trades.set(k, []);
    if (!holderSet.has(k)) holderSet.set(k, new Set());
    if (from <= toBlock) {
      const [tl, xl] = await Promise.all([
        getLogsChunked(client, { address: addr, event: EV_TRADE, fromBlock: from, toBlock }),
        getLogsChunked(client, { address: addr, event: EV_TRANSFER, fromBlock: from, toBlock }),
      ]);
      const list = trades.get(k);
      for (const l of tl) list.push({ ...l.args, tx: l.transactionHash, block: l.blockNumber, logIndex: l.logIndex });
      const hs = holderSet.get(k);
      for (const l of xl) {
        const to = l.args.to.toLowerCase();
        if (to !== ZERO && to !== DEAD && to !== k) hs.add(l.args.to);
      }
      scanned.set(k, toBlock);
    }
    return { trades: trades.get(k), holders: [...holderSet.get(k)] };
  }

  async function holderRows(addr, list) {
    if (!list.length) return [];
    const rows = [];
    for (let i = 0; i < list.length; i += 60) {
      const part = await client.readContract({ address: lens, abi: lensAbi, functionName: 'holders', args: [addr, list.slice(i, i + 60)] });
      rows.push(...part);
    }
    return rows;
  }

  async function chainNow() {
    const b = await client.getBlock();
    return Number(b.timestamp);
  }

  return { coins, coin, activity, holderRows, chainNow, head };
}

/** rank holders: longest hold first (the contract weights by amount * holdTime^p) */
export function rankHolders(rows, totalWeight) {
  const live = rows.filter((r) => r.balance > 0n);
  live.sort((a, b) => (a.holdSince === b.holdSince ? (b.balance > a.balance ? 1 : -1) : Number(a.holdSince) - Number(b.holdSince)));
  const tw = totalWeight > 0n ? totalWeight : 1n;
  return live.map((r, i) => ({ ...r, rank: i + 1, share: r.eligible ? Number((r.weight * 1000000n) / tw) / 1e4 : 0 }));
}

/** candles from Trade events; price = vEth/vTok after each trade (ETH per whole token) */
export function candles(trades, bucket = 60) {
  const out = [];
  let cur = null;
  const sorted = [...trades].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : Number(a.block - b.block)));
  for (const t of sorted) {
    const p = Number(t.vEthAfter) / Number(t.vTokAfter);
    const ts = Number(t.timestamp);
    const b = ts - (ts % bucket);
    if (!cur || cur.time !== b) {
      const open = cur ? cur.close : p;
      cur = { time: b, open, high: Math.max(open, p), low: Math.min(open, p), close: p, vol: 0 };
      out.push(cur);
    } else {
      cur.high = Math.max(cur.high, p);
      cur.low = Math.min(cur.low, p);
      cur.close = p;
    }
    cur.vol += Number(t.ethAmount) / 1e18;
  }
  return out;
}

// JSON with bigint support (indexer snapshots)
export const toJSON = (v) => JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? { $b: x.toString() } : x));
export const fromJSON = (s) => JSON.parse(s, (_, x) => (x && typeof x === 'object' && '$b' in x ? BigInt(x.$b) : x));

export { coinAbi, factoryAbi, lensAbi };
