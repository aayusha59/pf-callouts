/**
 * Records POST/PUT/PATCH requests to pump.fun whose URL mentions "callout".
 * A successful capture can be adopted as the create template.
 */
import { MAX_CAPTURES, PUMP_TAB_PATTERN } from "../shared/constants.js";
import { deriveTemplate, saveTemplate } from "../shared/template.js";

const pending = new Map();
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH"]);

function isCalloutWrite(details) {
  if (!WRITE_METHODS.has(details.method)) return false;
  if (!/callout/i.test(details.url)) return false;
  if (details.initiator?.startsWith("chrome-extension://")) return false;
  return true;
}

function decodeBody(requestBody) {
  if (!requestBody) return null;
  if (requestBody.formData) return requestBody.formData;
  if (requestBody.raw?.length) {
    try {
      const chunks = requestBody.raw.filter((r) => r.bytes).map((r) => new Uint8Array(r.bytes));
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return new TextDecoder().decode(merged);
    } catch {
      return null;
    }
  }
  return null;
}

function redactHeaders(headers = []) {
  return headers.map((h) => {
    const name = h.name.toLowerCase();
    if (name === "cookie" || name === "authorization") return { name: h.name, value: "<redacted>" };
    return { name: h.name, value: h.value ?? "" };
  });
}

async function saveCapture(capture) {
  const { captures = [], templateSource = "default" } = await chrome.storage.local.get(["captures", "templateSource"]);
  await chrome.storage.local.set({ captures: [capture, ...captures].slice(0, MAX_CAPTURES) });
  if (templateSource !== "manual" && capture.status >= 200 && capture.status < 300) {
    const template = deriveTemplate(capture);
    if (template) await saveTemplate(template, "captured");
  }
}

export function installRecorder() {
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (!isCalloutWrite(details)) return;
      pending.set(details.requestId, {
        id: `${details.timeStamp}-${details.requestId}`,
        at: details.timeStamp,
        method: details.method,
        url: details.url,
        body: decodeBody(details.requestBody),
        headers: [],
      });
    },
    { urls: [PUMP_TAB_PATTERN] },
    ["requestBody"],
  );

  chrome.webRequest.onSendHeaders.addListener(
    (details) => {
      const c = pending.get(details.requestId);
      if (c) c.headers = redactHeaders(details.requestHeaders);
    },
    { urls: [PUMP_TAB_PATTERN] },
    ["requestHeaders", "extraHeaders"],
  );

  chrome.webRequest.onCompleted.addListener(
    async (details) => {
      const c = pending.get(details.requestId);
      if (!c) return;
      pending.delete(details.requestId);
      c.status = details.statusCode;
      await saveCapture(c);
    },
    { urls: [PUMP_TAB_PATTERN] },
  );

  chrome.webRequest.onErrorOccurred.addListener((details) => pending.delete(details.requestId), {
    urls: [PUMP_TAB_PATTERN],
  });
}
