import baseSepolia from '../../deployments/84532.json';
import local from '../../deployments/31337.json';

const q = new URLSearchParams(location.search);

export const NETS = {
  84532: {
    id: 84532,
    name: 'Base Sepolia',
    rpc: 'https://sepolia.base.org',
    explorer: 'https://sepolia.basescan.org',
    currency: 'ETH',
    dep: baseSepolia,
  },
  31337: {
    id: 31337,
    name: 'Local anvil',
    rpc: q.get('rpc') || 'http://127.0.0.1:8545',
    explorer: '',
    currency: 'ETH',
    dep: local,
  },
};

export const NET = q.get('net') === 'local' ? NETS[31337] : NETS[84532];
export const DEPLOYED = !!(NET.dep && NET.dep.factory);
// preview mode replays a snapshot captured from a real local run of the contracts
export const PREVIEW = q.get('preview') === '1' || !DEPLOYED;
