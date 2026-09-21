/** Coin metadata and DexScreener pair → mint resolution. */
import { API, BASE58_FULL } from "../shared/constants.js";
import { fill, request } from "../shared/http.js";

export async function lookupCoin(mint) {
  if (!BASE58_FULL.test(mint || "")) return { ok: false, error: "Invalid mint address" };
  const res = await request(fill(API.coin, { mint }), { method: "GET" });
  if (!res.ok) return { ok: false, status: res.status, error: res.error || "Not found on pump.fun" };
  const c = res.data || {};
  return {
    ok: true,
    coin: {
      mint: c.mint || mint,
      name: c.name || "",
      symbol: c.symbol || "",
      image: c.image_uri || c.image || "",
      marketCapUsd: c.usd_market_cap ?? null,
      complete: !!c.complete,
    },
  };
}

const pairCache = new Map();

/** Trading terminals usually put the pool/pair in the URL, not the mint. */
export async function resolvePair(pair) {
  if (!BASE58_FULL.test(pair || "")) return { ok: false, error: "Invalid pair address" };
  if (pairCache.has(pair)) return pairCache.get(pair);

  const asPair = await request(fill(API.dexPair, { pair }), { method: "GET" });
  const pairs = asPair.data?.pairs || (asPair.data?.pair ? [asPair.data.pair] : []);
  const hit = Array.isArray(pairs) ? pairs.find((p) => p?.baseToken?.address) : null;
  if (hit) {
    const out = { ok: true, mint: hit.baseToken.address, source: "dexscreener-pair" };
    pairCache.set(pair, out);
    return out;
  }

  const asToken = await request(fill(API.dexToken, { token: pair }), { method: "GET" });
  const tokenPairs = asToken.data?.pairs || [];
  if (Array.isArray(tokenPairs) && tokenPairs.some((p) => p?.baseToken?.address === pair)) {
    const out = { ok: true, mint: pair, source: "dexscreener-token" };
    pairCache.set(pair, out);
    return out;
  }

  return { ok: false, error: "No DexScreener record for this pair yet" };
}
