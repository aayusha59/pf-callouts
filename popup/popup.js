/** Toolbar popup: session status, request template, captures, and transport. */
import { DEFAULT_TEMPLATE } from "../src/shared/constants.js";
import { escapeHtml } from "../src/shared/format.js";
import { send } from "../src/shared/messaging.js";

const $ = (id) => document.getElementById(id);

function setStatus(text, kind = "") {
  const el = $("status");
  el.className = kind;
  el.textContent = text;
  if (text) setTimeout(() => (el.textContent === text ? (el.textContent = "") : null), 4000);
}

async function loadAuth() {
  $("auth").textContent = "Checking pump.fun session...";
  $("auth").className = "muted";
  const res = await send({ type: "AUTH_STATUS" });
  if (res.ok && res.loggedIn) {
    $("auth").textContent = `Signed in to pump.fun${res.user.username ? ` as @${res.user.username}` : ""} (${res.via})`;
    $("auth").className = "ok";
  } else {
    $("auth").textContent = `Not signed in to pump.fun${res.status ? ` (HTTP ${res.status})` : ""}. Open pump.fun and log in.`;
    $("auth").className = "err";
  }
}

async function loadTemplate() {
  const { calloutTemplate, templateSource = "default" } = await chrome.storage.local.get([
    "calloutTemplate",
    "templateSource",
  ]);
  $("template").value = JSON.stringify(calloutTemplate || DEFAULT_TEMPLATE, null, 2);
  const labels = {
    default: "Source: built-in. A captured request from pump.fun will replace it.",
    captured: "Source: derived from a captured request.",
    manual: "Source: edited by you.",
  };
  $("template-source").textContent = labels[templateSource] || "";
}

function summarizeHeaders(headers = []) {
  return headers.map((h) => `${h.name}: ${h.value}`).join("\n");
}

async function loadCaptures() {
  const res = await send({ type: "GET_CAPTURES" });
  const list = res?.captures || [];
  $("capture-help").style.display = list.length ? "none" : "block";
  const box = $("captures");
  box.replaceChildren();
  for (const c of list) {
    const el = document.createElement("div");
    el.className = "capture";
    const when = new Date(c.at).toLocaleString();
    el.innerHTML = `
      <div class="row">
        <code><b>${escapeHtml(c.method)}</b> ${escapeHtml(c.url)}</code>
      </div>
      <div class="muted">${escapeHtml(when)} - HTTP ${escapeHtml(String(c.status ?? "?"))}</div>
      <pre>${escapeHtml(typeof c.body === "string" ? c.body : JSON.stringify(c.body, null, 2))}</pre>
      <details><summary class="muted">headers</summary><pre>${escapeHtml(summarizeHeaders(c.headers))}</pre></details>
      <div class="row stack"><button data-use="${escapeHtml(c.id)}" class="primary" type="button">Use as template</button></div>`;
    box.appendChild(el);
  }
  box.querySelectorAll("[data-use]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      const r = await send({ type: "USE_CAPTURE", id: btn.dataset.use });
      if (r.ok) {
        setStatus("Template updated from capture.", "ok");
        loadTemplate();
      } else {
        setStatus(r.error || "Could not derive template.", "err");
      }
    }),
  );
}

async function loadSettings() {
  const { transport = "auto" } = await chrome.storage.local.get(["transport"]);
  $("transport").value = transport;
}

$("recheck").addEventListener("click", loadAuth);

$("save-template").addEventListener("click", async () => {
  try {
    const t = JSON.parse($("template").value);
    if (!t.url || !t.method) throw new Error("Template needs at least url and method");
    await chrome.storage.local.set({ calloutTemplate: t, templateSource: "manual" });
    setStatus("Template saved.", "ok");
    loadTemplate();
  } catch (e) {
    setStatus(`Invalid template: ${e.message}`, "err");
  }
});

$("reset-template").addEventListener("click", async () => {
  await chrome.storage.local.set({ calloutTemplate: DEFAULT_TEMPLATE, templateSource: "default" });
  setStatus("Template reset.", "ok");
  loadTemplate();
});

$("clear-captures").addEventListener("click", async () => {
  await send({ type: "CLEAR_CAPTURES" });
  loadCaptures();
});

$("save-settings").addEventListener("click", async () => {
  await chrome.storage.local.set({ transport: $("transport").value, defaultMessage: "" });
  setStatus("Settings saved.", "ok");
});

$("reset-pos").addEventListener("click", async () => {
  await chrome.storage.local.set({ overlayPos: null, overlayCollapsed: false });
  setStatus("Overlay position reset.", "ok");
});

chrome.storage.onChanged.addListener((changes) => {
  if ("captures" in changes) loadCaptures();
  if ("calloutTemplate" in changes) loadTemplate();
});

loadAuth();
loadTemplate();
loadCaptures();
loadSettings();
