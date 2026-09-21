/** Auth, eligibility, create, and update (author reply) against pump.fun. */
import { API, BASE58_FULL } from "../shared/constants.js";
import { finiteNumber } from "../shared/format.js";
import { fill, request } from "../shared/http.js";
import { buildCalloutRequest, loadTemplate } from "../shared/template.js";
import { pumpCall } from "./transport.js";

export async function authStatus() {
  const res = await pumpCall(API.me, { method: "GET" });
  if (!res.ok) {
    return { ok: true, loggedIn: false, status: res.status, via: res.via, error: res.error || null };
  }
  const u = res.data || {};
  return {
    ok: true,
    loggedIn: true,
    via: res.via,
    user: {
      username: u.username || u.name || "",
      address: u.address || u.wallet || "",
      image: u.profile_image || u.image || "",
    },
  };
}

export function summarizeCallout(raw) {
  const c = raw?.callout ? raw.callout : raw;
  if (!c?.calloutId) return null;
  return {
    calloutId: c.calloutId,
    thesis: c.thesis || "",
    createdAt: c.createdAt || null,
    updateCount: finiteNumber(c.updateCount),
    coinMint: c.coinMint || null,
    likes: finiteNumber(c.likes ?? c.likeCount),
    views: finiteNumber(c.viewCount),
    replies: finiteNumber(c.replyCount),
    comments: finiteNumber(c.commentCount),
    shares: finiteNumber(c.repostCount),
    quotes: finiteNumber(c.quoteCount),
  };
}

export async function getCallout(calloutId) {
  if (!calloutId) return { ok: false, error: "Missing callout id" };
  const res = await request(fill(API.callout, { calloutId }), { method: "GET" });
  if (!res.ok) return { ok: false, status: res.status, error: res.error || null };
  const existing = summarizeCallout(res.data);
  return existing ? { ok: true, existing } : { ok: false, error: "No callout in response" };
}

export async function calloutState(mint) {
  if (!BASE58_FULL.test(mint || "")) return { ok: false, error: "Invalid mint address" };
  const res = await pumpCall(fill(API.eligibility, { mint }), { method: "GET" });
  if (!res.ok) return { ok: false, status: res.status, error: res.error || null, data: res.data };
  const d = res.data || {};
  if (d.eligible === false) {
    const type = d.reason?.type || "INELIGIBLE";
    let existing = type === "EXISTING_CALLOUT" ? summarizeCallout(d.reason.existingCallout) : null;
    if (existing) {
      const live = await getCallout(existing.calloutId);
      if (live.ok) existing = { ...existing, ...live.existing, thesis: existing.thesis || live.existing.thesis };
    }
    return { ok: true, eligible: false, reasonType: type, existing };
  }
  return { ok: true, eligible: true, existing: null };
}

async function findOwnCallout(mint) {
  const auth = await authStatus();
  const userId = auth.loggedIn && auth.user ? auth.user.address : "";
  if (!userId) return null;
  const res = await pumpCall(fill(API.userMintCallout, { userId, mint }), { method: "GET" });
  return res.ok ? summarizeCallout(res.data) : null;
}

function withFile(fields, image) {
  const body = { __formData: fields };
  if (image?.dataUrl) {
    body.__files = { image: { name: image.name || "image", type: image.type || "", dataUrl: image.dataUrl } };
  }
  return body;
}

/** An update is the author posting a reply on their own callout. */
async function postUpdate(existing, content, image) {
  const text = (content || "").trim();
  if (!text) {
    return {
      ok: false,
      kind: "update",
      existing,
      error: "You already called this coin out. Type a message to post an update.",
    };
  }
  const url = fill(API.replies, { calloutId: existing.calloutId });
  let res;
  if (image) {
    res = await pumpCall(url, { method: "POST", body: withFile({ content: text }, image) });
  } else {
    res = await pumpCall(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (res.status === 400 || res.status === 415) {
      res = await pumpCall(url, { method: "POST", body: withFile({ content: text }, null) });
    }
  }
  return {
    ok: res.ok,
    kind: "update",
    status: res.status,
    data: res.data,
    error: res.error || null,
    via: res.via,
    existing: { ...existing, updateCount: existing.updateCount + (res.ok ? 1 : 0) },
  };
}

export async function createCallout(mint, content, image) {
  if (!BASE58_FULL.test(mint || "")) return { ok: false, error: "Invalid mint address" };

  const state = await calloutState(mint);
  if (state.ok && state.existing) return postUpdate(state.existing, content, image);
  if (state.ok && state.eligible === false) {
    return {
      ok: false,
      kind: "create",
      status: 409,
      error: `Not eligible to call this coin out right now (${state.reasonType}).`,
    };
  }

  // Create. With an image the request is multipart: template fields plus an "image" part.

  const template = await loadTemplate();
  const { templateSource = "default" } = await chrome.storage.local.get("templateSource");
  const req = buildCalloutRequest(template, { mint, content: content || "" });
  if (image) {
    let fields = {};
    try {
      fields = typeof req.init.body === "string" ? JSON.parse(req.init.body) : {};
    } catch {
      fields = { coinMint: mint, thesis: content || "" };
    }
    if (!(content || "").trim()) delete fields.thesis;
    req.init = { method: req.init.method, headers: {}, body: withFile(fields, image) };
  }
  let res = await pumpCall(req.url, req.init);

  if (image && res.status === 400 && req.init.body?.__formData && "version" in req.init.body.__formData) {
    const { version, ...rest } = req.init.body.__formData;
    res = await pumpCall(req.url, { ...req.init, body: withFile(rest, image) });
  }

  // Race / stale eligibility: the server says a callout already exists, so update it.
  if (res.status === 409 && /DUPLICATE_CALLOUT/i.test(JSON.stringify(res.data || ""))) {
    const existing = await findOwnCallout(mint);
    if (existing) return postUpdate(existing, content, image);
  }

  return {
    ok: res.ok,
    kind: "create",
    status: res.status,
    data: res.data,
    error: res.error || null,
    via: res.via,
    templateSource,
    existing: res.ok ? summarizeCallout(res.data) : null,
    request: { method: req.init.method, url: req.url },
  };
}
