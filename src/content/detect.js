import { BASE58_FULL, BASE58_GLOBAL, MINT_LINK_PATTERNS, NOT_A_MINT, OVERLAY_HOST_ID } from "../shared/constants.js";

/** Pair/pool address from a trading-terminal `/meme/{address}` URL. */
export function pairFromUrl(pathname = location.pathname) {
  const m = pathname.match(/\/meme\/([1-9A-HJ-NP-Za-km-z]{32,44})/);
  return m ? m[1] : null;
}

function nearMintLabel(el, addr) {
  if (!el) return false;
  const text = el.textContent || "";
  const idx = text.indexOf(addr);
  const around = idx >= 0 ? text.slice(Math.max(0, idx - 24), idx + addr.length + 8) : text.slice(0, 80);
  if (/\bCA\b|Contract|Mint|token address/i.test(around)) return true;
  const prev = el.previousElementSibling?.textContent || "";
  return /\bCA\b|Contract|Mint/i.test(prev);
}

function isChatish(el) {
  if (!el) return false;
  let node = el;
  for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
    const id = `${node.id || ""} ${node.className || ""} ${node.getAttribute("data-testid") || ""}`.toLowerCase();
    if (/chat|message|comment|reply|feed|tweet|post/.test(id)) return true;
  }
  return false;
}

function scoreCandidate(addr, ctx, { pair, rejected }) {
  if (NOT_A_MINT.has(addr) || addr === pair || rejected.has(addr)) return -1;
  let score = 0;
  if (addr.endsWith("pump")) score += 10;
  if (ctx.fromLink) score += 6;
  if (ctx.nearCaLabel) score += 12;
  if (ctx.inChat) score -= 20;
  return score;
}

/**
 * Last-resort mint scan. Chat and other-coin links will surface the wrong address,
 * so the URL pair (resolved via DexScreener) is the source of truth.
 */
export function detectMintFromDom({ pair, rejected }) {
  const scores = new Map();
  const bump = (addr, ctx) => {
    const s = scoreCandidate(addr, ctx, { pair, rejected });
    if (s <= 0) return;
    scores.set(addr, (scores.get(addr) || 0) + s);
  };

  for (const a of document.querySelectorAll("a[href]")) {
    if (isChatish(a)) continue;
    const href = a.getAttribute("href") || "";
    for (const re of MINT_LINK_PATTERNS) {
      const m = href.match(re);
      if (m) bump(m[1], { fromLink: true });
    }
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.length < 32) return NodeFilter.FILTER_SKIP;
      const parent = node.parentElement;
      if (!parent || parent.closest(`script,style,#${OVERLAY_HOST_ID}`)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node;
  while ((node = walker.nextNode())) {
    const matches = node.nodeValue.match(BASE58_GLOBAL);
    if (!matches) continue;
    const parent = node.parentElement;
    const nearCaLabel = nearMintLabel(parent, matches[0]);
    if (!nearCaLabel) continue;
    bump(matches[0], { nearCaLabel, inChat: isChatish(parent) });
  }

  for (const el of document.querySelectorAll("[title],[data-value],[data-address],[data-mint],[data-token],[data-ca],[data-clipboard-text]")) {
    if (isChatish(el)) continue;
    for (const attr of ["title", "data-value", "data-address", "data-mint", "data-token", "data-ca", "data-clipboard-text"]) {
      const v = el.getAttribute(attr);
      if (v && BASE58_FULL.test(v.trim())) bump(v.trim(), { nearCaLabel: true });
    }
  }

  for (const btn of document.querySelectorAll("button,[role='button']")) {
    if (isChatish(btn)) continue;
    const label = `${btn.getAttribute("title") || ""} ${btn.getAttribute("aria-label") || ""} ${btn.textContent || ""}`.toLowerCase();
    if (!/copy|ca|mint|address/.test(label)) continue;
    const root = btn.parentElement?.parentElement || btn.parentElement;
    const text = root?.textContent || "";
    const found = text.match(BASE58_GLOBAL);
    if (found) bump(found[0], { nearCaLabel: true });
  }

  let best = null;
  for (const [addr, s] of scores) if (!best || s > best.s) best = { addr, s };
  return best && best.s >= 12 ? best.addr : null;
}
