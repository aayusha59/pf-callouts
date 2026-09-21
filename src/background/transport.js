/**
 * Authenticated pump.fun transport: service-worker fetch, then a tab fallback.
 */
import { PUMP_ORIGIN, PUMP_TAB_PATTERN } from "../shared/constants.js";
import { errMessage } from "../shared/format.js";
import { request } from "../shared/http.js";

async function getTransport() {
  const { transport = "auto" } = await chrome.storage.local.get("transport");
  return transport;
}

function isCorsRejection(res) {
  const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data || "");
  return /cors/i.test(text);
}

/**
 * Authenticated pump.fun calls: service-worker fetch first (Origin rewritten),
 * then the same request inside a pump.fun tab if the direct path is unusable.
 *
 * - status 0 / CORS / transport "tab": open a background tab if none exists
 * - 401: only reuse an already-open tab
 * - any other status is returned as-is
 */
export async function pumpCall(url, init) {
  const transport = await getTransport();
  let res = transport === "tab" ? { ok: false, status: 0 } : await request(url, init);
  let via = "direct";

  const corsBlocked = res.status === 403 && isCorsRejection(res);
  const retry = transport !== "direct" && !res.ok && (res.status === 0 || res.status === 401 || corsBlocked);
  if (retry) {
    const createIfMissing = res.status === 0 || corsBlocked || transport === "tab";
    const viaTab = await runInPumpTab(url, init, { createIfMissing });
    if (viaTab) {
      res = viaTab;
      via = "tab";
    }
  }
  return { ...res, via };
}

async function runInPumpTab(url, init, { createIfMissing }) {
  let [tab] = await chrome.tabs.query({ url: PUMP_TAB_PATTERN });
  let created = false;
  if (!tab) {
    if (!createIfMissing) return null;
    tab = await chrome.tabs.create({ url: `${PUMP_ORIGIN}/`, active: false });
    created = true;
    await waitForTabComplete(tab.id, 20000);
  }
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: pageFetch,
      args: [url, init],
    });
    return injection?.result ?? null;
  } catch (err) {
    return { ok: false, status: 0, data: null, error: `Tab fallback failed: ${errMessage(err)}` };
  } finally {
    if (created) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Injected into the page. Must stay self-contained (no imports, no closures). */
function pageFetch(url, init) {
  if (init?.body && typeof init.body === "object" && (init.body.__formData || init.body.__files)) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(init.body.__formData || {})) fd.append(k, String(v));
    for (const [field, file] of Object.entries(init.body.__files || {})) {
      if (!file?.dataUrl) continue;
      const comma = file.dataUrl.indexOf(",");
      const bin = atob(file.dataUrl.slice(comma + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      fd.append(field, new Blob([bytes], { type: file.type || "application/octet-stream" }), file.name || "image");
    }
    const headers = { ...(init.headers || {}) };
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === "content-type") delete headers[k];
    }
    init = { ...init, headers, body: fd };
  }
  return fetch(url, { ...init, credentials: "include" })
    .then(async (r) => {
      const text = await r.text();
      let data = text;
      try {
        data = JSON.parse(text);
      } catch {
        /* raw */
      }
      return { ok: r.ok, status: r.status, data };
    })
    .catch((e) => ({ ok: false, status: 0, data: null, error: String(e && e.message ? e.message : e) }));
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeoutMs);
    function listener(id, info) {
      if (id === tabId && info.status === "complete") done();
    }
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(resolve, 1200);
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}
