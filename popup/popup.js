/** Toolbar popup: pump.fun and fomo sign-in status, and an overlay position reset. */
import { send } from "../src/shared/messaging.js";

const $ = (id) => document.getElementById(id);

const SITES = {
  pump: { type: "AUTH_STATUS", url: "https://pump.fun", name: "pump.fun" },
  fomo: { type: "FOMO_AUTH", url: "https://fomo.family", name: "fomo.family" },
};

function setStatus(text, kind = "") {
  const el = $("status");
  el.className = kind;
  el.textContent = text;
  if (text) setTimeout(() => (el.textContent === text ? (el.textContent = "") : null), 4000);
}

async function check(key) {
  const site = SITES[key];
  const el = $(`${key}-auth`);
  el.className = "site-status muted";
  el.textContent = "Checking...";
  el.title = "";
  const res = await send({ type: site.type });
  if (res?.ok && res.loggedIn) {
    el.className = "site-status ok";
    el.textContent = "Signed in";
    el.title = res.user?.username ? `@${res.user.username}` : "";
    return;
  }
  el.className = "site-status";
  el.textContent = "Not signed in. ";
  const link = document.createElement("a");
  link.href = site.url;
  link.textContent = `Sign in on ${site.name}`;
  link.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: site.url });
  });
  el.append(link);
}

function checkAll() {
  check("pump");
  check("fomo");
}

$("recheck").addEventListener("click", checkAll);

$("reset-pos").addEventListener("click", async () => {
  await chrome.storage.local.set({ overlayPos: null, overlayCollapsed: false });
  setStatus("Overlay position reset.", "ok");
});

checkAll();
