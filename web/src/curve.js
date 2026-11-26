// exact BigInt mirror of the contract's curve + early-sell math (for instant quotes)
const ceilDiv = (a, b) => (a + b - 1n) / b;
export const CURVE_SUPPLY = 793_100_000n * 10n ** 18n;

export function quoteBuy(st, ethIn) {
  if (st.completed || st.graduated || ethIn <= 0n) return { out: 0n, used: 0n };
  const k = st.vEth * st.vTok;
  let out = st.vTok - ceilDiv(k, st.vEth + ethIn);
  let used = ethIn;
  const remaining = CURVE_SUPPLY - st.tokensSold;
  if (out >= remaining) {
    out = remaining;
    used = ceilDiv(k, st.vTok - out) - st.vEth;
    if (used > ethIn) used = ethIn;
  }
  return { out, used };
}

export function quoteSell(st, h, amount, nowTs, penaltyBps) {
  if (st.graduated || amount <= 0n || amount > h.balance) return { value: 0n, toSeller: 0n, forfeit: 0n, early: false };
  const k = st.vEth * st.vTok;
  const value = st.vEth - ceilDiv(k, st.vTok + amount);
  const early = nowTs < Number(h.lockEnd);
  const basis = (h.costBasis * amount) / h.balance;
  if (!early) return { value, toSeller: value, forfeit: 0n, early, basis };
  const capped = value < basis ? value : basis;
  const penalty = (basis * BigInt(penaltyBps)) / 10000n;
  const toSeller = capped > penalty ? capped - penalty : 0n;
  return { value, toSeller, forfeit: value - toSeller, early, basis };
}
