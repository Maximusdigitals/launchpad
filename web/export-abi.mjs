// regenerates src/abi.js from the Foundry build output
import fs from 'fs';
const out = '../contracts/out';
const pick = (f, c) => JSON.parse(fs.readFileSync(`${out}/${f}/${c}.json`)).abi;
const abis = { coinAbi: pick('LaunchCoin.sol', 'LaunchCoin'), factoryAbi: pick('LaunchFactory.sol', 'LaunchFactory'), lensAbi: pick('LaunchLens.sol', 'LaunchLens') };
fs.writeFileSync('src/abi.js', Object.entries(abis).map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`).join('\n') + '\n');
console.log('abi.js written');
