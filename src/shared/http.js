/** Fetch helpers used by the service worker. */
import { DROP_HEADERS } from "./constants.js";
import { errMessage } from "./format.js";

/** Replace `{{key}}` placeholders in strings, arrays, and plain objects. */
export function fill(value, vars) {
  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fill(v, vars);
    return out;
  }
  return value;
}

export function dataUrlToBlob(dataUrl, type) {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const mime = type || (meta.match(/^data:([^;]+)/) || [])[1] || "application/octet-stream";
  return new Blob([bytes], { type: mime });
}

/**
 * A JSON-serializable body of `{ __formData, __files }` becomes multipart FormData.
 * That shape can travel through extension messages and `executeScript`.
 */
export function materializeBody(init) {
  if (!init?.body || typeof init.body !== "object" || !(init.body.__formData || init.body.__files)) {
    return init;
  }
  const fd = new FormData();
  for (const [k, v] of Object.entries(init.body.__formData || {})) fd.append(k, String(v));
  for (const [field, file] of Object.entries(init.body.__files || {})) {
    if (file?.dataUrl) fd.append(field, dataUrlToBlob(file.dataUrl, file.type), file.name || "image");
  }
  const headers = { ...(init.headers || {}) };
  for (const k of Object.keys(headers)) {
    if (k.toLowerCase() === "content-type") delete headers[k];
  }
  return { ...init, headers, body: fd };
}

export async function request(url, init = {}) {
  try {
    const res = await fetch(url, { ...materializeBody(init), credentials: "include" });
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: errMessage(err) };
  }
}

export function isDroppedHeader(name) {
  const n = name.toLowerCase();
  return DROP_HEADERS.has(n) || n.startsWith("sec-");
}
