/**
 * Service-worker entry. Installs the Origin rewrite,
 * then routes messages from the overlay and popup.
 */
import { errMessage } from "../shared/format.js";
import { authStatus, calloutState, createCallout, getCallout } from "./callouts.js";
import { lookupCoin, resolvePair } from "./coins.js";
import { diagnosePosition } from "./diagnose.js";
import { fomoAuth, fomoThesisState, fomoThesisStats, postFomoThesis } from "./fomo.js";
import { installOriginRule } from "./origin.js";

installOriginRule();

// Older versions kept an editable request template, captured pump.fun requests, and a
// send-method setting. All three are gone; drop what they stored so it can't apply.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove(["calloutTemplate", "templateSource", "captures", "transport"]);
});

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
    case "FOMO_AUTH":
      return fomoAuth();
    case "FOMO_THESIS":
      return postFomoThesis(msg.mint, msg.content);
    case "FOMO_THESIS_STATE":
      return fomoThesisState(msg.mint);
    case "FOMO_THESIS_STATS":
      return fomoThesisStats(msg.thesisId);
    case "DIAGNOSE_POSITION":
      return diagnosePosition(msg.mint);
    default:
      return { ok: false, error: `Unknown message type: ${msg?.type}` };
  }
}
