/**
 * Service-worker entry. Installs the Origin rewrite and request recorder,
 * then routes messages from the overlay and popup.
 */
import { errMessage } from "../shared/format.js";
import { deriveTemplate, saveTemplate } from "../shared/template.js";
import { authStatus, calloutState, createCallout, getCallout } from "./callouts.js";
import { lookupCoin, resolvePair } from "./coins.js";
import { diagnosePosition } from "./diagnose.js";
import { installOriginRule } from "./origin.js";
import { installRecorder } from "./recorder.js";

installOriginRule();
installRecorder();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, error: errMessage(err) }));
  return true;
});

async function handleMessage(msg, sender) {
  switch (msg?.type) {
    case "LOOKUP_COIN":
      return lookupCoin(msg.mint, { allowUnknown: !!msg.allowUnknown });
    case "RESOLVE_PAIR":
      return resolvePair(msg.pair, sender?.tab?.id);
    case "AUTH_STATUS":
      return authStatus();
    case "CALLOUT_STATE":
      return calloutState(msg.mint);
    case "GET_CALLOUT":
      return getCallout(msg.calloutId);
    case "CREATE_CALLOUT":
      return createCallout(msg.mint, msg.content, msg.image || null);
    case "DIAGNOSE_POSITION":
      return diagnosePosition(msg.mint);
    case "GET_CAPTURES": {
      const { captures = [] } = await chrome.storage.local.get("captures");
      return { ok: true, captures };
    }
    case "USE_CAPTURE": {
      const { captures = [] } = await chrome.storage.local.get("captures");
      const capture = captures.find((c) => c.id === msg.id);
      const template = deriveTemplate(capture);
      if (!template) {
        return { ok: false, error: "No mint-shaped value in that capture; it is probably not a create request." };
      }
      await saveTemplate(template, "captured");
      return { ok: true, template };
    }
    case "CLEAR_CAPTURES":
      await chrome.storage.local.set({ captures: [] });
      return { ok: true };
    default:
      return { ok: false, error: `Unknown message type: ${msg?.type}` };
  }
}
