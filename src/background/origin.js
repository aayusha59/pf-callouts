import { FOMO_ORIGIN, PUMP_ORIGIN } from "../shared/constants.js";

const ORIGIN_RULE_ID = 1;
const FOMO_ORIGIN_RULE_ID = 2;

/** Makes a service-worker call look like it came from the site's own page. */
function originRule(id, domain, origin) {
  return {
    id,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [
        { header: "origin", operation: "set", value: origin },
        { header: "referer", operation: "set", value: `${origin}/` },
      ],
    },
    condition: {
      requestDomains: [domain],
      tabIds: [-1],
      resourceTypes: ["xmlhttprequest"],
    },
  };
}

/**
 * pump.fun rejects `Origin: chrome-extension://...` with CORS 403.
 * Rewrite Origin/Referer on service-worker fetches (tabId -1).
 * Session rules are gone after a browser restart, so this runs on every SW start.
 */
export async function installOriginRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ORIGIN_RULE_ID, FOMO_ORIGIN_RULE_ID],
      addRules: [
        originRule(ORIGIN_RULE_ID, "pump.fun", PUMP_ORIGIN),
        originRule(FOMO_ORIGIN_RULE_ID, "fomo.family", FOMO_ORIGIN),
      ],
    });
  } catch (err) {
    console.warn("[callout] origin rewrite unavailable; tab fallback will be used", err);
  }
}
