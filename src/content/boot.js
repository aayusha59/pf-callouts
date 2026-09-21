/**
 * Classic content-script entry. Chrome is unreliable about injecting
 * `"type": "module"` content scripts, so this file imports the overlay module.
 */
(() => {
  if (window.__axiomPumpCalloutBooting) return;
  window.__axiomPumpCalloutBooting = true;
  import(chrome.runtime.getURL("src/content/axiom.js")).catch((err) => {
    console.error("[pf-callout] overlay failed to load", err);
  });
})();
