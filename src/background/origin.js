import { PUMP_ORIGIN } from "../shared/constants.js";

const ORIGIN_RULE_ID = 1;

/**
 * pump.fun rejects `Origin: chrome-extension://...` with CORS 403.
 * Rewrite Origin/Referer on service-worker fetches (tabId -1).
 * Session rules are gone after a browser restart, so this runs on every SW start.
 */
export async function installOriginRule() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ORIGIN_RULE_ID],
      addRules: [
        {
          id: ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "origin", operation: "set", value: PUMP_ORIGIN },
              { header: "referer", operation: "set", value: `${PUMP_ORIGIN}/` },
            ],
          },
          condition: {
            requestDomains: ["pump.fun"],
            tabIds: [-1],
            resourceTypes: ["xmlhttprequest"],
          },
        },
      ],
    });
  } catch (err) {
    console.warn("[callout] origin rewrite unavailable; tab fallback will be used", err);
  }
}
