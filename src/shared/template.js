/** Create-callout request template stored in chrome.storage.local. */
import { BASE58_FULL, DEFAULT_TEMPLATE, DROP_HEADERS } from "./constants.js";
import { fill, isDroppedHeader } from "./http.js";

export async function loadTemplate() {
  const { calloutTemplate } = await chrome.storage.local.get("calloutTemplate");
  return calloutTemplate?.url ? calloutTemplate : DEFAULT_TEMPLATE;
}

export async function saveTemplate(template, source) {
  await chrome.storage.local.set({ calloutTemplate: template, templateSource: source });
}

export function buildCalloutRequest(template, vars) {
  const url = fill(template.url, vars);
  const method = (template.method || "POST").toUpperCase();
  const headers = {};
  for (const [k, v] of Object.entries(template.headers || {})) {
    if (!isDroppedHeader(k)) headers[k] = fill(v, vars);
  }
  let body;
  if (template.body != null) {
    if (typeof template.body === "string") {
      body = fill(template.body, vars);
    } else {
      body = JSON.stringify(fill(template.body, vars));
      if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
        headers["content-type"] = "application/json";
      }
    }
  }
  return { url, init: { method, headers, body } };
}

/**
 * Turn a recorded write into a reusable template by swapping the mint and message
 * for `{{mint}}` / `{{content}}`. Returns null if the body has no mint-shaped value
 * (likes, replies, etc.).
 */
export function deriveTemplate(capture) {
  if (!capture?.url) return null;
  let body = capture.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!body || typeof body !== "object") return null;

  const clone = JSON.parse(JSON.stringify(body));
  let mintValue = null;
  let contentPath = null;
  let longest = { len: -1, ref: null, key: null };

  const walk = (obj) => {
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (typeof v === "string") {
        if (!mintValue && BASE58_FULL.test(v)) {
          mintValue = v;
          obj[key] = "{{mint}}";
        } else if (!contentPath && /^(thesis|content|text|message|body|caption|note|description|comment)$/i.test(key)) {
          contentPath = { ref: obj, key };
        } else if (v.length > longest.len && !BASE58_FULL.test(v)) {
          longest = { len: v.length, ref: obj, key };
        }
      } else if (v && typeof v === "object") {
        walk(v);
      }
    }
  };
  walk(clone);

  if (!mintValue) return null;
  const target = contentPath || (longest.ref ? longest : null);
  if (target) target.ref[target.key] = "{{content}}";

  const headers = {};
  for (const h of capture.headers || []) {
    const name = String(h.name || "").toLowerCase();
    if (DROP_HEADERS.has(name) || name.startsWith("sec-") || name.startsWith("accept")) continue;
    if (name === "content-type" || name.startsWith("x-") || !/^[a-z-]+$/.test(name)) {
      headers[h.name] = h.value;
    }
  }

  return {
    method: capture.method,
    url: capture.url.split(mintValue).join("{{mint}}"),
    headers,
    body: clone,
  };
}
