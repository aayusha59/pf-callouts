import { errMessage } from "./format.js";

/** Promise wrapper around `chrome.runtime.sendMessage`. */
export function send(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(res || { ok: false, error: "No response" });
        }
      });
    } catch (err) {
      resolve({ ok: false, error: errMessage(err) });
    }
  });
}
