#!/usr/bin/env bash
# Deploys the launchpad to BASE SEPOLIA (testnet) with the throwaway deployer in .secrets/deployer.json,
# then verifies the sources on Blockscout + Sourcify (no API keys needed). Never prints the key.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=https://sepolia.base.org
CHAIN=$(cast chain-id --rpc-url $RPC)
[ "$CHAIN" = "84532" ] || { echo "refusing: chain $CHAIN is not Base Sepolia"; exit 1; }
export PRIVATE_KEY=$(python3 -c "import json;d=json.load(open('.secrets/deployer.json'))['data'];d=d[0] if isinstance(d,list) else d;d=d.get('wallets',[d])[0] if isinstance(d,dict) else d;print(d['private_key'])")
ADDR=$(python3 -c "import json;d=json.load(open('.secrets/deployer.json'))['data'];d=d[0] if isinstance(d,list) else d;d=d.get('wallets',[d])[0] if isinstance(d,dict) else d;print(d['address'])")
echo "deployer $ADDR balance $(cast balance $ADDR --rpc-url $RPC --ether) ETH"
cd contracts
V2_FACTORY=0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e WETH=0x4200000000000000000000000000000000000006 VETH0=${VETH0:-20000000000000000} \
  forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --slow \
  --verify --verifier blockscout --verifier-url https://base-sepolia.blockscout.com/api/ 2>&1 | grep -vi "private" | tail -40
unset PRIVATE_KEY
cat ../deployments/84532.json
