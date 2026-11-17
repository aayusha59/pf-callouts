/** Builds the pump.fun create-callout request from DEFAULT_TEMPLATE. */
import { fill, isDroppedHeader } from "./http.js";

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
