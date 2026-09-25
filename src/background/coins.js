/** Coin metadata and pair → mint resolution. */
import { API, BASE58_FULL } from "../shared/constants.js";
import { fill, request } from "../shared/http.js";
import { resolvePairOnAxiomTab } from "./axiomPair.js";

function mapPump(c, mint) {
  return {
    mint: c.mint || mint,
    name: c.name || "",
    symbol: c.symbol || "",
    image: c.image_uri || c.image || "",
    marketCapUsd: c.usd_market_cap ?? c.marketCap ?? null,
    complete: !!c.complete,
  };
}

/**
 * pump.fun listing first (needed for callouts), then DexScreener / Jupiter.
 * Manual paste may adopt an address that is not listed yet.
 */
export async function lookupCoin(mint, { allowUnknown = false } = {}) {
  if (!BASE58_FULL.test(mint || "")) return { ok: false, error: "Invalid mint address" };

  const pump = await request(fill(API.coin, { mint }), { method: "GET" });
  if (pump.ok && pump.data && (pump.data.mint || pump.data.symbol || pump.data.name)) {
    return { ok: true, source: "pump", coin: mapPump(pump.data, mint) };
  }

  const dex = await request(fill(API.dexToken, { token: mint }), { method: "GET" });
  const pairs = dex.data?.pairs || [];
  const hit = Array.isArray(pairs)
    ? pairs.find((p) => p?.baseToken?.address === mint) || pairs.find((p) => p?.baseToken?.address)
    : null;
  if (hit?.baseToken) {
    return {
      ok: true,
      source: "dexscreener",
      coin: {
        mint: hit.baseToken.address || mint,
        name: hit.baseToken.name || "",
        symbol: hit.baseToken.symbol || "",
        image: hit.info?.imageUrl || "",
        marketCapUsd: hit.marketCap ?? null,
        complete: false,
      },
    };
  }

  const jup = await request(fill(API.jupSearch, { q: mint }), { method: "GET" });
  const rows = Array.isArray(jup.data) ? jup.data : [];
  const tok = rows.find((t) => t?.id === mint || t?.address === mint) || rows[0];
  if (tok && (tok.id || tok.address || tok.symbol)) {
    return {
      ok: true,
      source: "jupiter",
      coin: {
        mint: tok.id || tok.address || mint,
        name: tok.name || "",
        symbol: tok.symbol || "",
        image: tok.icon || tok.logoURI || "",
        marketCapUsd: tok.mcap ?? null,
        complete: false,
      },
    };
  }

  if (allowUnknown) {
    return {
      ok: true,
      source: "address",
      coin: { mint, name: "", symbol: "", image: "", marketCapUsd: null, complete: false },
    };
  }
  return { ok: false, status: pump.status, error: pump.error || "Not found on pump.fun" };
}

const pairCache = new Map();
const FAIL_TTL_MS = 8000;

/** Trading terminals usually put the pool/pair in the URL, not the mint. */
export async function resolvePair(pair, tabId) {
  if (!BASE58_FULL.test(pair || "")) return { ok: false, error: "Invalid pair address" };
  const cached = pairCache.get(pair);
  if (cached && (cached.ok || Date.now() < cached.until)) return cached.ok ? cached : { ok: false, error: cached.error };

  const remember = (out) => {
    if (out.ok) pairCache.set(pair, out);
    else pairCache.set(pair, { ...out, until: Date.now() + FAIL_TTL_MS });
    return out;
  };

  const asPair = await request(fill(API.dexPair, { pair }), { method: "GET" });
  const pairs = asPair.data?.pairs || (asPair.data?.pair ? [asPair.data.pair] : []);
  const hit = Array.isArray(pairs) ? pairs.find((p) => p?.baseToken?.address) : null;
  if (hit) return remember({ ok: true, mint: hit.baseToken.address, source: "dexscreener-pair" });

  const asToken = await request(fill(API.dexToken, { token: pair }), { method: "GET" });
  const tokenPairs = asToken.data?.pairs || [];
  if (Array.isArray(tokenPairs) && tokenPairs.some((p) => p?.baseToken?.address === pair)) {
    return remember({ ok: true, mint: pair, source: "dexscreener-token" });
  }

  const search = await request(fill(API.dexSearch, { q: pair }), { method: "GET" });
  const searched = search.data?.pairs || [];
  const searchHit = Array.isArray(searched)
    ? searched.find((p) => p?.pairAddress === pair && p?.baseToken?.address) ||
      searched.find((p) => p?.baseToken?.address === pair)
    : null;
  if (searchHit?.baseToken?.address) {
    const mint = searchHit.baseToken.address === pair ? pair : searchHit.baseToken.address;
    return remember({ ok: true, mint, source: "dexscreener-search" });
  }

  const pump = await request(fill(API.coin, { mint: pair }), { method: "GET" });
  if (pump.ok && pump.data?.mint) return remember({ ok: true, mint: pump.data.mint, source: "pump-mint" });

  const gecko = await request(fill(API.geckoPool, { pair }), { method: "GET" });
  const geckoId = gecko.data?.data?.relationships?.base_token?.data?.id;
  if (typeof geckoId === "string" && geckoId.startsWith("solana_")) {
    const mint = geckoId.slice("solana_".length);
    if (BASE58_FULL.test(mint)) return remember({ ok: true, mint, source: "geckoterminal" });
  }

  const jup = await request(fill(API.jupSearch, { q: pair }), { method: "GET" });
  const jupHit = Array.isArray(jup.data) ? jup.data.find((t) => t?.id === pair || t?.address === pair) : null;
  if (jupHit) return remember({ ok: true, mint: jupHit.id || jupHit.address || pair, source: "jupiter" });

  const axiom = await resolvePairOnAxiomTab(pair, tabId);
  if (axiom?.mint) return remember(axiom);

  return remember({ ok: false, error: "No DexScreener record for this pair yet" });
}
