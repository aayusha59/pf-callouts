/**
 * Posting a thesis on fomo.family. Fomo attaches a thesis to the user's trade on a
 * coin, so this looks up that trade first. Routes match the fomo.family web client.
 */
import { BASE58_FULL, FOMO_API, FOMO_MAX_THESIS_LEN, FOMO_SOLANA_NETWORK } from "../shared/constants.js";
import { fomoCall } from "./transport.js";

const HEADERS = { "content-type": "application/json", "x-supported-chains": String(FOMO_SOLANA_NETWORK) };

const ERRORS = {
  ERR_TRADE_COMMENT_NOT_APPROPRIATE: "Fomo's moderation turned that thesis down. Reword it and try again.",
  ERR_USER_CONTENT_NOT_APPROPRIATE: "Fomo's moderation turned that thesis down. Reword it and try again.",
  ERR_TRADE_COMMENT_RATE_LIMITED: "Fomo says you're posting too fast. Wait a bit, then retry.",
  ERR_TRADE_CLOSED_TOO_LONG_AGO: "You sold this more than 3 hours ago, so Fomo won't take a thesis on it.",
};

/** Fomo wraps every reply as { success, statusCode, responseObject, errorCode, message }. */
async function fomoApi(path, init, opts) {
  const res = await fomoCall(`${FOMO_API}${path}`, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } }, opts);
  const body = res.data && typeof res.data === "object" ? res.data : null;
  return {
    ok: res.ok && body?.success !== false,
    status: body?.statusCode ?? res.status,
    via: res.via,
    body,
    errorCode: body?.errorCode || null,
    error: body?.message || res.error || null,
  };
}

export async function fomoAuth({ createTab = false } = {}) {
  const res = await fomoApi("/v2/users/current", { method: "GET" }, { createTab });
  const user = res.body?.responseObject;
  if (!res.ok || !user?.id) {
    return { ok: true, loggedIn: false, status: res.status, via: res.via, error: res.error };
  }
  return {
    ok: true,
    loggedIn: true,
    via: res.via,
    user: { id: user.id, username: user.userHandle || user.displayName || "" },
  };
}

function firstTradeId(items) {
  return (items || []).find((item) => item?.trade?.id)?.trade.id || null;
}

/** Your trade on this coin: an open one first, otherwise the most recent closed one. */
async function findTrade(userId, mint, createTab) {
  const query = new URLSearchParams({
    userId,
    orderBy: "closedAt",
    tokenAddress: mint,
    networkId: String(FOMO_SOLANA_NETWORK),
  });
  const res = await fomoApi(`/trades?${query}`, { method: "GET" }, { createTab });
  if (!res.ok) return { ok: false, status: res.status, body: res.body };
  const list = res.body?.responseObject || {};
  return { ok: true, tradeId: firstTradeId(list.activeTrades) || firstTradeId(list.closedTrades) };
}

/** Likes and views for one thesis, the way Fomo's own feed refreshes them. */
async function thesisCounts(thesisId) {
  const res = await fomoApi("/engagement/thesisViewCounts", {
    method: "POST",
    body: JSON.stringify({ theses: [{ type: "thesis", id: thesisId }] }),
  });
  const counts = res.body?.responseObject?.counts;
  if (!res.ok || !Array.isArray(counts)) return null;
  return counts.find((item) => item?.id === thesisId) || counts[0] || null;
}

function countOr(value, fallback) {
  return Number.isFinite(value) ? value : Number.isFinite(fallback) ? fallback : 0;
}

/** Your latest thesis on this coin, with its stats. Never opens a tab. */
export async function fomoThesisState(mint) {
  if (!BASE58_FULL.test(mint || "")) return { ok: false, error: "Invalid mint address" };
  const auth = await fomoAuth();
  if (!auth.loggedIn) return { ok: true, existing: null };
  const trade = await findTrade(auth.user.id, mint, false);
  if (!trade.ok) return { ok: false, status: trade.status };
  if (!trade.tradeId) return { ok: true, existing: null };

  const res = await fomoApi(`/trades/${encodeURIComponent(trade.tradeId)}/comments`, { method: "GET" });
  if (!res.ok) return { ok: false, status: res.status };
  // Newest first. Every thesis on a trade is its owner's, so these are all yours.
  const theses = (res.body?.responseObject?.comments || []).filter((c) => c?.id && (!c.userId || c.userId === auth.user.id));
  const latest = theses[0];
  if (!latest) return { ok: true, existing: null };
  const counts = await thesisCounts(latest.id);
  return {
    ok: true,
    existing: {
      thesisId: latest.id,
      thesis: latest.comment || "",
      createdAt: latest.createdAt || null,
      updateCount: Math.max(0, theses.length - 1),
      likes: countOr(counts?.likeCount, latest.numLikes),
      views: countOr(counts?.viewCount, latest.viewCount),
    },
  };
}

export async function fomoThesisStats(thesisId) {
  if (!thesisId) return { ok: false, error: "Missing thesis id" };
  const counts = await thesisCounts(thesisId);
  if (!counts) return { ok: false };
  return { ok: true, likes: countOr(counts.likeCount), views: countOr(counts.viewCount) };
}

export async function postFomoThesis(mint, content) {
  if (!BASE58_FULL.test(mint || "")) return { ok: false, error: "Invalid mint address" };
  const text = (content || "").trim();
  if (!text) return { ok: false, error: "Type your thesis first." };
  if (text.length > FOMO_MAX_THESIS_LEN) {
    return { ok: false, error: `Fomo takes up to ${FOMO_MAX_THESIS_LEN} characters; this is ${text.length}.` };
  }

  const auth = await fomoAuth({ createTab: true });
  if (!auth.loggedIn) {
    return { ok: false, status: auth.status || 401, error: "Sign in to fomo.family in this browser, then retry." };
  }

  const trade = await findTrade(auth.user.id, mint, true);
  if (!trade.ok) {
    return { ok: false, status: trade.status, error: `Couldn't load your Fomo trades (${trade.status}).`, data: trade.body };
  }
  // Fomo takes a thesis on an open trade, or for 3 hours after selling.
  const { tradeId } = trade;
  if (!tradeId) {
    return { ok: false, error: "Fomo doesn't show a trade on this coin for your wallet yet, so there's nothing to attach a thesis to." };
  }

  const res = await fomoApi(
    "/trades/comment",
    { method: "POST", body: JSON.stringify({ tradeId, comment: text, visibility: "public" }) },
    { createTab: true },
  );
  if (res.ok) return { ok: true, via: res.via };
  return {
    ok: false,
    status: res.status,
    error: ERRORS[res.errorCode] || `Fomo returned ${res.status}${res.errorCode ? ` (${res.errorCode})` : ""}.`,
    data: res.body,
  };
}
