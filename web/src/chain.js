import { createPublicClient, createWalletClient, custom, http, defineChain, formatEther } from 'viem';
import { NET, PREVIEW } from './config.js';

export const chain = defineChain({
  id: NET.id,
  name: NET.name,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [NET.rpc] } },
  blockExplorers: NET.explorer ? { default: { name: 'Basescan', url: NET.explorer } } : undefined,
  testnet: true,
});

export const pub = createPublicClient({ chain, transport: http(NET.rpc, { batch: { wait: 16 } }), pollingInterval: 2000 });

// ── injected wallets (EIP-6963 discovery, window.ethereum fallback)
const found = new Map();
window.addEventListener('eip6963:announceProvider', (e) => {
  const d = e.detail;
  if (d && d.info && d.provider) found.set(d.info.uuid, d);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

export function wallets() {
  const list = [...found.values()];
  if (!list.length && window.ethereum) list.push({ info: { uuid: 'injected', name: 'Browser wallet', icon: '' }, provider: window.ethereum });
  return list;
}

const listeners = new Set();
export const W = { account: null, provider: null, client: null, balance: 0n, chainOk: false };
export const onWallet = (f) => (listeners.add(f), () => listeners.delete(f));
const emit = () => listeners.forEach((f) => f(W));

const hex = (n) => '0x' + n.toString(16);

async function ensureChain(provider) {
  const cur = parseInt(await provider.request({ method: 'eth_chainId' }), 16);
  if (cur === NET.id) return true;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex(NET.id) }] });
  } catch (e) {
    if (e && (e.code === 4902 || /unrecognized|not added|unknown chain/i.test(e.message || ''))) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{ chainId: hex(NET.id), chainName: NET.name, nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [NET.rpc], blockExplorerUrls: NET.explorer ? [NET.explorer] : [] }],
      });
    } else throw e;
  }
  return parseInt(await provider.request({ method: 'eth_chainId' }), 16) === NET.id;
}

export async function connect(entry) {
  const provider = entry.provider;
  const accs = await provider.request({ method: 'eth_requestAccounts' });
  W.provider = provider;
  W.account = accs[0];
  W.chainOk = await ensureChain(provider);
  W.client = createWalletClient({ chain, transport: custom(provider), account: W.account });
  localStorage.setItem('lp.wallet', entry.info.uuid);
  if (provider.on) {
    provider.on('accountsChanged', (a) => {
      W.account = a[0] || null;
      if (W.account) W.client = createWalletClient({ chain, transport: custom(provider), account: W.account });
      refreshBalance();
    });
    provider.on('chainChanged', (c) => {
      W.chainOk = parseInt(c, 16) === NET.id;
      emit();
    });
  }
  await refreshBalance();
  return W;
}

export async function tryReconnect() {
  const id = localStorage.getItem('lp.wallet');
  if (!id) return;
  await new Promise((r) => setTimeout(r, 300));
  const e = wallets().find((w) => w.info.uuid === id);
  if (!e) return;
  try {
    const accs = await e.provider.request({ method: 'eth_accounts' });
    if (accs && accs.length) await connect(e);
  } catch {}
}

export function disconnect() {
  localStorage.removeItem('lp.wallet');
  Object.assign(W, { account: null, provider: null, client: null, balance: 0n, chainOk: false });
  emit();
}

export async function refreshBalance() {
  if (W.account) W.balance = await pub.getBalance({ address: W.account }).catch(() => 0n);
  emit();
}

export async function switchChain() {
  if (!W.provider) return;
  W.chainOk = await ensureChain(W.provider);
  emit();
}

/** send a contract write, wait for receipt */
export async function write(req) {
  if (!W.client) throw new Error('Connect a wallet first');
  if (!W.chainOk) {
    W.chainOk = await ensureChain(W.provider);
    if (!W.chainOk) throw new Error(`Switch your wallet to ${NET.name}`);
  }
  const { request } = await pub.simulateContract({ ...req, account: W.account });
  const hash = await W.client.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash, pollingInterval: 1000 });
  refreshBalance();
  if (receipt.status !== 'success') throw new Error('Transaction reverted');
  return { hash, receipt };
}

export const txUrl = (h) => (NET.explorer && !PREVIEW ? `${NET.explorer}/tx/${h}` : '');
// preview data comes from a local chain, so explorer links would point nowhere
export const addrUrl = (a) => (NET.explorer && !PREVIEW ? `${NET.explorer}/address/${a}` : location.hash || '#/');
export { formatEther };
