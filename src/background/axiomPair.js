import { BASE58_FULL } from "../shared/constants.js";

/**
 * Axiom pair APIs reject extension-origin fetches (425). Run the same
 * requests inside the Axiom tab so cookies and origin match the page.
 */
export async function resolvePairOnAxiomTab(pair, tabId) {
  if (!tabId || !BASE58_FULL.test(pair || "")) return null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: pageResolvePair,
      args: [pair],
    });
    const out = injection?.result;
    return out?.mint ? out : null;
  } catch {
    return null;
  }
}

/** Injected into the page. Must stay self-contained. */
function pageResolvePair(pair) {
  const mintRe = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const hosts = ["api3", "api2", "api10", "api8", "api9"];
  const paths = [`/token-info?pairAddress=${pair}`, `/pair-info?pairAddress=${pair}`];
  const urls = hosts.flatMap((h) => paths.map((p) => `https://${h}.axiom.trade${p}`));

  const pullMint = (obj, depth = 0) => {
    if (!obj || depth > 6) return null;
    if (typeof obj !== "object") return null;
    for (const key of ["tokenAddress", "token_address", "tokenMint", "coinMint", "baseMint", "mint"]) {
      const v = obj[key];
      if (typeof v === "string" && mintRe.test(v) && v !== pair) return v;
    }
    const nested = obj.baseToken?.address || obj.token?.address || obj.token?.tokenAddress;
    if (typeof nested === "string" && mintRe.test(nested) && nested !== pair) return nested;
    const kids = Array.isArray(obj) ? obj : Object.values(obj);
    for (const child of kids) {
      if (child && typeof child === "object") {
        const found = pullMint(child, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };

  const pullCoin = (obj, mint) => {
    if (!obj || typeof obj !== "object") return null;
    const name = obj.tokenName || obj.name || obj.token?.name || "";
    const symbol = obj.tokenTicker || obj.symbol || obj.token?.symbol || obj.token?.ticker || "";
    const image = obj.tokenImage || obj.image || obj.imageUrl || obj.token?.image || "";
    const marketCapUsd = obj.marketCapUsd ?? obj.marketCap ?? obj.token?.marketCapUsd ?? null;
    if (!name && !symbol && !image) return null;
    return { mint, name, symbol, image, marketCapUsd, complete: false };
  };

  return Promise.any(
    urls.map((url) =>
      fetch(url, { credentials: "include" }).then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = await r.json();
        const mint = pullMint(data);
        if (!mint) throw new Error("no mint");
        return { ok: true, mint, source: "axiom", coin: pullCoin(data, mint) };
      }),
    ),
  ).catch(() => null);
}
