/**
 * Content-script entry for axiom.trade/meme/* pages.
 * Detects the coin mint, mounts the overlay, and talks to the service worker.
 */
import { BASE58_FULL, STATS_POLL_MS } from "../shared/constants.js";
import { shortAddr } from "../shared/format.js";
import { send } from "../shared/messaging.js";
import { detectMintFromDom, pairFromUrl } from "./detect.js";
import { Overlay } from "./overlay.js";

if (!window.__axiomPumpCalloutLoaded) {
  window.__axiomPumpCalloutLoaded = true;
  boot();
}

const state = {
  pair: null,
  mint: null,
  coin: null,
  resolving: false,
  resolvedFor: null,
  /** True only after DexScreener (or the URL itself) confirmed the mint for this pair. */
  mintVerified: false,
  rejected: new Set(),
  auth: null,
  busy: false,
  existing: null,
  ineligible: null,
  statsTimer: null,
};

let overlay = null;
let scanTimer = null;

async function boot() {
  if (!document.body) {
    await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
  }

  overlay = new Overlay({
    onSubmit: submitCallout,
    onManualMint: useManual,
    onDiagnose: runDiagnosis,
  });
  await overlay.mount();
  onRouteChange();
  refreshAuth();

  new MutationObserver(scheduleScan).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onRouteChange();
      return;
    }
    if (state.pair && !state.mintVerified && !state.resolving) resolveMint();
  }, 400);

  window.addEventListener("popstate", onRouteChange);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.existing) syncStatsPoll();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if ("calloutTemplate" in changes || "transport" in changes) refreshAuth();
  });
}

function scheduleScan() {
  if (state.mintVerified && state.resolvedFor === state.pair && state.mint) return;
  clearTimeout(scanTimer);
  scanTimer = setTimeout(resolveMint, 400);
}

function onRouteChange() {
  const pair = pairFromUrl();
  if (pair === state.pair && state.mint && state.mintVerified) return;
  if (pair !== state.pair) {
    state.mint = null;
    state.coin = null;
    state.existing = null;
    state.ineligible = null;
    state.resolvedFor = null;
    state.mintVerified = false;
    state.rejected.clear();
    overlay.setAttachment(null);
    overlay.resetStats();
    stopStatsPoll();
  }
  state.pair = pair;
  overlay.render(state);
  overlay.setStatus("Detecting coin...", "");
  if (pair) resolveMint();
}

async function tryAdopt(candidate, source, { verified = false } = {}) {
  if (!candidate || state.rejected.has(candidate)) return false;
  if (candidate === state.mint) {
    state.resolvedFor = state.pair;
    if (verified) state.mintVerified = true;
    return true;
  }
  const pairAtStart = state.pair;
  const res = await send({ type: "LOOKUP_COIN", mint: candidate });
  if (!res.ok) {
    state.rejected.add(candidate);
    return false;
  }
  if (source !== "manual paste" && pairFromUrl() !== pairAtStart) return false;
  state.mint = candidate;
  state.coin = res.coin;
  state.resolvedFor = state.pair;
  state.mintVerified = verified;
  state.existing = null;
  state.ineligible = null;
  overlay.resetStats();
  stopStatsPoll();
  overlay.render(state);
  overlay.setStatus(`Detected via ${source}`, "");
  refreshCalloutState();
  return true;
}

async function refreshCalloutState() {
  const mint = state.mint;
  if (!mint) return;
  const res = await send({ type: "CALLOUT_STATE", mint });
  if (state.mint !== mint) return;
  if (!res.ok) return;
  state.existing = res.existing || null;
  state.ineligible = res.eligible === false && !res.existing ? res.reasonType : null;
  overlay.render(state);
  syncStatsPoll();
}

async function resolveMint() {
  if (state.resolving) return;
  if (state.mintVerified && state.resolvedFor === state.pair && state.mint) return;
  state.resolving = true;
  try {
    const pair = state.pair || pairFromUrl();
    if (pair) {
      const res = await send({ type: "RESOLVE_PAIR", pair });
      if (pairFromUrl() !== pair) return;
      if (res.ok && res.mint) {
        await tryAdopt(res.mint, "DexScreener", { verified: true });
        return;
      }
      if (await tryAdopt(pair, "URL", { verified: true })) return;
    }
    if (!state.mint) {
      const fromDom = detectMintFromDom({ pair: state.pair, rejected: state.rejected });
      if (await tryAdopt(fromDom, "page", { verified: false })) return;
    }
    if (!state.mint) {
      overlay.setStatus("Could not detect the CA yet. Paste it below if it does not appear.", "");
    }
  } finally {
    state.resolving = false;
  }
}

function stopStatsPoll() {
  clearInterval(state.statsTimer);
  state.statsTimer = null;
  overlay?.setLive(false);
}

function syncStatsPoll() {
  stopStatsPoll();
  const id = state.existing?.calloutId;
  if (!id) return;
  overlay.setLive(true);
  const tick = async () => {
    if (document.hidden) return;
    if (state.existing?.calloutId !== id) return;
    const res = await send({ type: "GET_CALLOUT", calloutId: id });
    if (!res.ok || !res.existing) return;
    if (state.existing?.calloutId !== id) return;
    state.existing = { ...state.existing, ...res.existing };
    overlay.renderStats(state.existing);
  };
  state.statsTimer = setInterval(tick, STATS_POLL_MS);
  tick();
}

async function refreshAuth() {
  const res = await send({ type: "AUTH_STATUS" });
  state.auth = res;
  overlay.renderAuth(res);
}

async function useManual(value) {
  if (!BASE58_FULL.test(value)) {
    overlay.setStatus("That does not look like a Solana address.", "err");
    return;
  }
  state.rejected.delete(value);
  overlay.setStatus("Checking pump.fun...", "");
  const ok = await tryAdopt(value, "manual paste", { verified: true });
  if (!ok) overlay.setStatus("pump.fun does not know that mint.", "err");
  else overlay.clearManual();
}

/**
 * The listing site hides a callout when the author's position is closed
 * (exited, or held amount is 0). This prints the same eligibility / positions /
 * balance data the web client uses.
 */
async function runDiagnosis() {
  const mint = state.mint;
  if (!mint) return overlay.setStatus("No coin detected yet.", "err");
  overlay.setDiagnosis("Asking pump.fun...");
  const r = await send({ type: "DIAGNOSE_POSITION", mint });
  if (!r.ok) {
    overlay.setDiagnosis(r.error || "Diagnosis failed");
    return;
  }
  const lines = [`session wallet: ${r.wallet}`];
  const e = r.eligibility || {};
  if (e.error) {
    lines.push(`eligibility: ${e.error}`);
  } else {
    lines.push(
      `eligibility: ${e.eligible ? "eligible" : `not eligible (${e.reason})`}, verdict=${e.verdict}, attemptsRemaining=${e.attemptsRemaining}`,
    );
    lines.push(
      `  position credited: ${e.position ? `held=${e.position.amountHeld} valueUsd=${e.position.valueUsd} boughtUsd=${e.position.amountBoughtUsd}` : "none"}`,
    );
  }
  if (r.positions?.error) {
    lines.push(`positions: ${r.positions.error}`);
  } else if (!r.positions?.length) {
    lines.push("positions: no row for this mint under your wallet");
  } else {
    for (const p of r.positions) {
      lines.push(
        `position row: wallet=${p.walletAddress} held=${p.amountHeld} isExited=${p.isExited} pnlUsd=${p.pnlUsd} transfers=${p.hasTransfers}${p.callout ? ` callout=${p.callout.calloutId}` : ""}`,
      );
    }
    const open = r.positions.some((p) => !p.isExited && p.amountHeld > 0);
    lines.push(
      open
        ? "=> an OPEN position is on file; the callout should be listed"
        : "=> this position is CLOSED; that is why the callout is hidden",
    );
  }
  const oc = r.onChain || {};
  if (!oc.checked) lines.push(`on-chain balance check: unavailable${oc.error ? ` (${oc.error})` : ""}`);
  else if (oc.held) lines.push(`on-chain: session wallet holds ${oc.held.balance ?? oc.held.amount ?? JSON.stringify(oc.held)}`);
  else lines.push("on-chain: session wallet holds 0 of this mint (a different wallet may be the one trading)");
  overlay.setDiagnosis(lines.join("\n"));
}

async function submitCallout() {
  if (state.busy || !state.mint || state.ineligible) return;
  const content = overlay.getMessage();
  if (state.existing && !content) {
    overlay.setStatus("Type your update first.", "err");
    overlay.focusMessage();
    return;
  }
  state.busy = true;
  overlay.render(state);
  overlay.setStatus(state.existing ? "Posting update..." : "Posting callout...", "");

  const mint = state.mint;
  const image = overlay.getImage();
  const res = await send({ type: "CREATE_CALLOUT", mint, content, image });
  state.busy = false;
  if (state.mint !== mint) return;

  if (res.existing) state.existing = { ...(state.existing || {}), ...res.existing };
  overlay.render(state);
  syncStatsPoll();

  if (res.ok) {
    const name = state.coin ? state.coin.symbol : shortAddr(mint);
    const withImg = image ? " with image" : "";
    overlay.setStatus(
      res.kind === "update"
        ? `Update${withImg} posted to your ${name} callout (${res.via}).`
        : `Callout${withImg} posted for ${name} (${res.via}).`,
      "ok",
    );
    overlay.clearComposer();
    return;
  }
  if (!res.status && res.error && res.kind === "update") {
    overlay.setStatus(res.error, "err");
    return;
  }

  const hint =
    res.templateSource === "default" && res.status !== 401
      ? " If this persists, make one manual callout on pump.fun with this extension loaded so it can capture the exact request, then check the extension popup."
      : res.status === 401
        ? " Sign in to pump.fun in this browser, then retry."
        : "";
  const head = res.status ? `pump.fun returned ${res.status}.` : res.error || "Request failed.";
  overlay.setStatus(head + hint, "err", res.data || res.error || null);
  overlay.render(state);
}
