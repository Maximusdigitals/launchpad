// Seeds a local anvil chain with a realistic story for previews/screenshots. LOCAL ONLY.
import fs from 'fs';
import { createPublicClient, createWalletClient, http, parseEther, decodeEventLog } from 'viem';
import { foundry } from 'viem/chains';
import { factoryAbi, coinAbi } from '../src/abi.js';

const RPC = process.env.RPC || 'http://127.0.0.1:8545';
const dep = JSON.parse(fs.readFileSync('../../deployments/31337.json'));
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
if ((await pub.getChainId()) !== 31337) throw new Error('seed is local-only');
const accounts = await pub.request({ method: 'eth_accounts' });
const wc = (i) => createWalletClient({ chain: foundry, transport: http(RPC), account: accounts[i] });
const img = JSON.parse(fs.readFileSync('emblems.json'));
const warp = async (s) => { await pub.request({ method: 'evm_increaseTime', params: [s] }); await pub.request({ method: 'evm_mine', params: [] }); };
const send = async (i, req) => { const h = await wc(i).writeContract({ ...req, account: accounts[i], chain: foundry }); const r = await pub.waitForTransactionReceipt({ hash: h }); if (r.status !== 'success') throw new Error('reverted ' + req.functionName); return r; };

async function launch(i, p, image, desc, devBuy = '0') {
  const r = await send(i, { address: dep.factory, abi: factoryAbi, functionName: 'createCoin', args: [p, image, desc], value: parseEther(devBuy) });
  for (const l of r.logs) { try { const e = decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics }); if (e.eventName === 'CoinCreated') return e.args.coin; } catch {} }
}
const buy = (i, c, e) => send(i, { address: c, abi: coinAbi, functionName: 'buy', args: [0n], value: parseEther(e) });
const bal = (c, i) => pub.readContract({ address: c, abi: coinAbi, functionName: 'balanceOf', args: [accounts[i]] });
const sell = async (i, c, frac = 1) => { const b = await bal(c, i); return send(i, { address: c, abi: coinAbi, functionName: 'sell', args: [(b * BigInt(Math.round(frac * 100))) / 100n, 0n] }); };
const claim = (i, c) => send(i, { address: c, abi: coinAbi, functionName: 'claim', args: [] });
const P = (name, symbol, L, pen, p, sw = 300, mb = '0.001') => ({ name, symbol, lockDuration: BigInt(L), penaltyBps: pen * 100, steepness: p, snipeWindow: sw, snipeMaxBuy: parseEther(mb) });

// 1. a graduated coin from "yesterday"
const moss = await launch(1, P('Moss', 'MOSS', 1800, 10, 1, 120, '0.002'), img[3], 'Grows on whoever stays still.', '0.001');
await buy(2, moss, '0.002'); await buy(3, moss, '0.0015'); await warp(150);
await buy(4, moss, '0.006'); await warp(200); await sell(4, moss); // early dumper
await buy(5, moss, '0.004'); await warp(600);
await buy(6, moss, '0.07'); // sells out (refund)
await warp(3700); await send(7, { address: moss, abi: coinAbi, functionName: 'graduate', args: [] });
await claim(2, moss);
await warp(3 * 3600);

// 2. a sold-out coin waiting for its last locks
const snail = await launch(3, P('Slow Snail', 'SNAIL', 6 * 3600, 20, 2, 300, '0.0015'), img[2], 'Fastest way to get paid is to go slow.', '0.001');
await buy(4, snail, '0.0015'); await buy(5, snail, '0.0012'); await warp(400);
await buy(6, snail, '0.01'); await buy(7, snail, '0.004'); await warp(900); await sell(6, snail); await warp(60);
await buy(8, snail, '0.08');
await warp(2 * 3600);

// 3. the hero: Diamond Duck, busy, with forfeits streaming right now
const duck = await launch(0, P('Diamond Duck', 'DUCK', 3600, 10, 2, 300, '0.001'), img[0], 'Quack early, cry later.', '0.0008');
await buy(1, duck, '0.001'); await buy(2, duck, '0.0009'); await warp(120);
await buy(3, duck, '0.001'); await warp(240);
await buy(4, duck, '0.004'); await warp(420);
await buy(5, duck, '0.006'); await buy(6, duck, '0.003'); await warp(300);
await sell(4, duck); // paper hands #1, in profit -> forfeits all profit + 10%
await warp(500);
await buy(7, duck, '0.005'); await buy(8, duck, '0.002'); await warp(700);
await sell(6, duck, 0.5); // half early
await warp(1500);
await buy(9, duck, '0.003');
await warp(300);
await sell(5, duck); // big early dump
await warp(420);
await claim(1, duck);
await warp(90);

// 4. paper plane: short lock, harsh penalty, steep p=3
const plane = await launch(2, P('Paper Plane', 'PLANE', 900, 35, 3, 60, '0.002'), img[1], 'Folded in 15 minutes. So is your lock.', '0');
await buy(3, plane, '0.002'); await buy(4, plane, '0.0015'); await warp(200);
await buy(5, plane, '0.004'); await warp(240); await sell(5, plane);
await buy(6, plane, '0.002'); await warp(500);
await sell(3, plane, 0.3); // after lock: free
await warp(200);

// 5. brand new, sniper guard still on
const hold = await launch(4, P('Hold & Chill', 'CHILL', 2 * 3600, 15, 2, 600, '0.0008'), img[4], 'Do nothing. Professionally.', '0.0005');
await buy(5, hold, '0.0008'); await buy(6, hold, '0.0006'); await warp(45);
await buy(7, hold, '0.0007');

console.log(JSON.stringify({ moss, snail, duck, plane, hold }));
fs.writeFileSync('/tmp/seed-coins.json', JSON.stringify({ moss, snail, duck, plane, hold }));
