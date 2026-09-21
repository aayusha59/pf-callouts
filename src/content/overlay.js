import { MAX_IMAGE_BYTES, MAX_MESSAGE_LEN, OVERLAY_HOST_ID, QUICK_EMOJIS } from "../shared/constants.js";
import { fmtBytes, fmtStat, fmtUsd, shortAddr, timeAgo } from "../shared/format.js";

/**
 * Shadow DOM overlay on the trading-terminal page.
 * Coin/auth/callout state is owned by the boot script; this module owns the DOM.
 */
export class Overlay {
  constructor({ onSubmit, onManualMint, onDiagnose }) {
    this.onSubmit = onSubmit;
    this.onManualMint = onManualMint;
    this.onDiagnose = onDiagnose;
    this.ui = null;
    this.image = null;
    this.lastStats = null;
  }

  async mount() {
    const host = document.createElement("div");
    host.id = OVERLAY_HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    try {
      style.textContent = await (await fetch(chrome.runtime.getURL("src/content/overlay.css"))).text();
    } catch {
      style.textContent = "";
    }
    shadow.appendChild(style);

    const wrap = document.createElement("div");
    wrap.innerHTML = panelHtml();
    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);

    const q = (sel) => shadow.querySelector(sel);
    this.ui = {
      host,
      panel: q(".apc-panel"),
      header: q("[data-drag]"),
      auth: q("[data-auth]"),
      collapse: q("[data-collapse]"),
      img: q("[data-img]"),
      symbol: q("[data-symbol]"),
      ca: q("[data-ca]"),
      copy: q("[data-copy]"),
      existing: q("[data-existing]"),
      stats: q("[data-stats]"),
      live: q("[data-live]"),
      stat: {
        likes: q('[data-stat="likes"] em'),
        views: q('[data-stat="views"] em'),
        replies: q('[data-stat="replies"] em'),
        shares: q('[data-stat="shares"] em'),
        quotes: q('[data-stat="quotes"] em'),
      },
      msg: q("[data-msg]"),
      attach: q("[data-attach]"),
      attachImg: q("[data-attach-img]"),
      attachName: q("[data-attach-name]"),
      attachRemove: q("[data-attach-remove]"),
      attachBtn: q("[data-attach-btn]"),
      file: q("[data-file]"),
      emojis: q("[data-emojis]"),
      count: q("[data-count]"),
      callout: q("[data-callout]"),
      status: q("[data-status]"),
      manual: q("[data-manual]"),
      useManual: q("[data-use-manual]"),
      diagnose: q("[data-diagnose]"),
      diag: q("[data-diag]"),
    };

    this.#bind();
    this.#setupDrag();
    await this.#restorePrefs();
  }

  getMessage() {
    return this.ui?.msg.value.trim() || "";
  }

  getImage() {
    if (!this.image) return null;
    return { name: this.image.name, type: this.image.type, dataUrl: this.image.dataUrl };
  }

  clearComposer() {
    if (!this.ui) return;
    this.ui.msg.value = "";
    this.ui.count.textContent = `0/${MAX_MESSAGE_LEN}`;
    this.setAttachment(null);
  }

  clearManual() {
    if (this.ui) this.ui.manual.value = "";
  }

  focusMessage() {
    this.ui?.msg.focus();
  }

  setLive(on) {
    this.ui?.live.classList.toggle("on", !!on);
  }

  setDiagnosis(text) {
    if (!this.ui) return;
    this.ui.diag.hidden = false;
    this.ui.diag.textContent = text;
  }

  setStatus(text, kind, detail) {
    if (!this.ui) return;
    this.ui.status.className = `apc-status ${kind || ""}`.trim();
    this.ui.status.textContent = text || "";
    if (detail) {
      const pre = document.createElement("pre");
      pre.textContent = typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);
      this.ui.status.appendChild(pre);
    }
  }

  renderAuth(res) {
    if (!this.ui) return;
    if (res.ok && res.loggedIn) {
      this.ui.auth.className = "apc-auth ok";
      this.ui.auth.textContent = res.user.username ? `@${res.user.username}` : "signed in";
      this.ui.auth.title = `pump.fun session detected (${res.via})`;
      return;
    }
    this.ui.auth.className = "apc-auth bad";
    this.ui.auth.replaceChildren();
    const a = document.createElement("a");
    a.href = "https://pump.fun/";
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "sign in to pump.fun";
    this.ui.auth.appendChild(a);
    this.ui.auth.title = res.error || `pump.fun returned ${res.status}`;
  }

  render(state) {
    if (!this.ui) return;
    this.#renderCoin(state);
    this.#renderExisting(state);
    this.#renderButton(state);
  }

  renderStats(existing) {
    if (!this.ui) return;
    if (!existing?.calloutId) {
      this.ui.stats.hidden = true;
      return;
    }
    this.ui.stats.hidden = false;
    const next = {
      likes: existing.likes ?? 0,
      views: existing.views ?? 0,
      replies: existing.replies ?? 0,
      shares: existing.shares ?? 0,
      quotes: existing.quotes ?? 0,
    };
    const prev = this.lastStats;
    for (const key of Object.keys(next)) {
      const el = this.ui.stat[key];
      if (!el) continue;
      el.textContent = fmtStat(next[key]);
      el.parentElement.classList.toggle("up", !!(prev && next[key] > (prev[key] ?? 0)));
    }
    this.lastStats = next;

    const head = this.ui.existing.querySelector(".apc-existing-head");
    if (head) {
      head.textContent = existingHeadline(existing);
    }
  }

  resetStats() {
    this.lastStats = null;
  }

  setAttachment(file) {
    if (!this.ui) return;
    if (!file) {
      this.image = null;
      this.ui.attach.hidden = true;
      this.ui.attachImg.removeAttribute("src");
      return;
    }
    if (!file.type.startsWith("image/")) {
      this.setStatus("Only image files can be attached.", "err");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.setStatus(`Image is ${fmtBytes(file.size)}; keep it under ${fmtBytes(MAX_IMAGE_BYTES)}.`, "err");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      this.image = { name: file.name || "image.png", type: file.type, size: file.size, dataUrl: reader.result };
      this.ui.attachImg.src = reader.result;
      this.ui.attachName.textContent = `${this.image.name} \u00b7 ${fmtBytes(file.size)}`;
      this.ui.attach.hidden = false;
      this.setStatus("", "");
    };
    reader.onerror = () => this.setStatus("Could not read that image.", "err");
    reader.readAsDataURL(file);
  }

  #renderCoin(state) {
    const { ui } = this;
    if (state.coin) {
      ui.img.style.visibility = state.coin.image ? "" : "hidden";
      ui.img.src = state.coin.image || "";
      const label = state.coin.symbol || state.coin.name || "Coin";
      ui.symbol.replaceChildren(label);
      const small = document.createElement("small");
      const extraName = state.coin.name && state.coin.name !== label ? state.coin.name : "";
      small.textContent = [extraName, fmtUsd(state.coin.marketCapUsd)].filter(Boolean).join(" \u00b7 ");
      ui.symbol.appendChild(small);
      ui.ca.textContent = shortAddr(state.mint);
      ui.copy.hidden = false;
      ui.copy.dataset.mint = state.mint || "";
      return;
    }
    ui.img.src = "";
    ui.symbol.textContent = state.pair ? "Detecting coin..." : "Open a coin page";
    ui.ca.textContent = state.pair ? shortAddr(state.pair) : "";
    ui.copy.hidden = true;
    delete ui.copy.dataset.mint;
  }

  #renderExisting(state) {
    const { ui } = this;
    if (state.existing) {
      ui.existing.hidden = false;
      ui.existing.replaceChildren();
      const head = document.createElement("div");
      head.className = "apc-existing-head";
      head.textContent = existingHeadline(state.existing);
      const body = document.createElement("div");
      body.className = "apc-existing-body";
      body.textContent = state.existing.thesis || "(no note)";
      ui.existing.append(head, body);
      ui.msg.placeholder = "Post an update to your callout...";
      this.renderStats(state.existing);
      return;
    }
    if (state.ineligible) {
      ui.existing.hidden = false;
      ui.existing.textContent = `Not eligible to call this coin out (${state.ineligible}).`;
      ui.msg.placeholder = "Why are you calling this out?";
      this.renderStats(null);
      return;
    }
    ui.existing.hidden = true;
    ui.existing.textContent = "";
    ui.msg.placeholder = "Why are you calling this out?";
    this.renderStats(null);
  }

  #renderButton(state) {
    const { ui } = this;
    ui.callout.textContent = state.busy ? "Posting..." : state.existing ? "Update callout" : "Call out";
    ui.callout.disabled = state.busy || !state.mint || !!state.ineligible;
  }

  #bind() {
    const { ui } = this;

    ui.diagnose.addEventListener("click", () => this.onDiagnose());
    ui.msg.addEventListener("input", () => {
      ui.count.textContent = `${ui.msg.value.length}/${MAX_MESSAGE_LEN}`;
    });
    ui.msg.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") this.onSubmit();
    });
    ui.msg.addEventListener("paste", (e) => {
      const items = e.clipboardData?.items || [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          e.preventDefault();
          e.stopPropagation();
          this.setAttachment(item.getAsFile());
          return;
        }
      }
    });

    ui.panel.addEventListener("dragover", (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
        e.preventDefault();
        ui.panel.classList.add("dragging");
      }
    });
    ui.panel.addEventListener("dragleave", () => ui.panel.classList.remove("dragging"));
    ui.panel.addEventListener("drop", (e) => {
      ui.panel.classList.remove("dragging");
      const file = e.dataTransfer?.files?.[0];
      if (file?.type.startsWith("image/")) {
        e.preventDefault();
        e.stopPropagation();
        this.setAttachment(file);
      }
    });

    ui.attachBtn.addEventListener("click", () => ui.file.click());
    ui.file.addEventListener("change", () => {
      if (ui.file.files?.[0]) this.setAttachment(ui.file.files[0]);
      ui.file.value = "";
    });
    ui.attachRemove.addEventListener("click", () => this.setAttachment(null));
    ui.emojis.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-emoji]");
      if (btn) this.#insertAtCursor(btn.dataset.emoji);
    });
    ui.manual.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") this.onManualMint(ui.manual.value.trim());
    });
    ui.callout.addEventListener("click", () => this.onSubmit());
    ui.useManual.addEventListener("click", () => this.onManualMint(ui.manual.value.trim()));
    ui.img.addEventListener("error", () => {
      ui.img.style.visibility = "hidden";
    });
    ui.copy.addEventListener("click", () => {
      const mint = ui.copy.dataset.mint;
      if (mint) navigator.clipboard.writeText(mint).catch(() => {});
    });
    ui.collapse.addEventListener("click", () => {
      const collapsed = ui.panel.classList.toggle("collapsed");
      ui.collapse.innerHTML = collapsed ? "+" : "&#8722;";
      chrome.storage.local.set({ overlayCollapsed: collapsed });
    });

    chrome.storage.onChanged.addListener((changes) => {
      if ("overlayPos" in changes) this.#applyPosition(changes.overlayPos.newValue);
    });
  }

  #insertAtCursor(text) {
    const el = this.ui.msg;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    if (next.length > MAX_MESSAGE_LEN) return;
    el.value = next;
    const pos = start + text.length;
    el.setSelectionRange(pos, pos);
    el.focus();
    this.ui.count.textContent = `${el.value.length}/${MAX_MESSAGE_LEN}`;
  }

  #setupDrag() {
    let start = null;
    this.ui.header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button,a")) return;
      const rect = this.ui.host.getBoundingClientRect();
      start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!start) return;
      this.#applyPosition({ left: e.clientX - start.x, top: e.clientY - start.y });
    });
    window.addEventListener("mouseup", () => {
      if (!start) return;
      start = null;
      const rect = this.ui.host.getBoundingClientRect();
      chrome.storage.local.set({ overlayPos: { left: rect.left, top: rect.top } });
    });
  }

  #applyPosition(pos) {
    const s = this.ui.host.style;
    if (pos && Number.isFinite(pos.left) && Number.isFinite(pos.top)) {
      s.left = `${Math.max(0, Math.min(pos.left, window.innerWidth - 60))}px`;
      s.top = `${Math.max(0, Math.min(pos.top, window.innerHeight - 40))}px`;
      s.right = "auto";
      s.bottom = "auto";
    } else {
      s.left = "auto";
      s.top = "auto";
      s.right = "16px";
      s.bottom = "16px";
    }
  }

  async #restorePrefs() {
    const prefs = await chrome.storage.local.get(["overlayPos", "overlayCollapsed", "defaultMessage"]);
    this.#applyPosition(prefs.overlayPos);
    if (prefs.overlayCollapsed) {
      this.ui.panel.classList.add("collapsed");
      this.ui.collapse.textContent = "+";
    }
    if (prefs.defaultMessage) chrome.storage.local.set({ defaultMessage: "" });
  }
}

function existingHeadline(e) {
  const updates = e.updateCount ? ` \u00b7 ${e.updateCount} update${e.updateCount === 1 ? "" : "s"}` : "";
  return `Your callout ${timeAgo(e.createdAt)}${updates}`;
}

function panelHtml() {
  const emojis = QUICK_EMOJIS.map(
    (e) => `<button type="button" class="apc-emoji" data-emoji="${e.char}" title=":${e.label}:">${e.char}</button>`,
  ).join("");
  return `
      <div class="apc-panel">
        <div class="apc-header" data-drag>
          <span class="apc-badge">PUMP</span>
          <span class="apc-title">Callout</span>
          <span class="apc-auth" data-auth>checking...</span>
          <button class="apc-icon" data-collapse title="Collapse">&#8722;</button>
        </div>
        <div class="apc-body">
          <div class="apc-coin">
            <img data-img src="" alt="">
            <div class="apc-coin-meta">
              <div class="apc-symbol" data-symbol>Detecting coin...</div>
              <div class="apc-ca"><span data-ca></span><button data-copy hidden>copy</button></div>
            </div>
          </div>
          <div class="apc-existing" data-existing hidden></div>
          <div class="apc-stats" data-stats hidden>
            <span data-stat="likes" title="Likes"><b>likes</b> <em>0</em></span>
            <span data-stat="views" title="Views"><b>views</b> <em>0</em></span>
            <span data-stat="replies" title="Replies"><b>replies</b> <em>0</em></span>
            <span data-stat="shares" title="Shares / reposts"><b>shares</b> <em>0</em></span>
            <span data-stat="quotes" title="Quotes"><b>quotes</b> <em>0</em></span>
            <span class="apc-live" data-live title="Polling every 3s">LIVE</span>
          </div>
          <textarea data-msg placeholder="Why are you calling this out?" maxlength="${MAX_MESSAGE_LEN}"></textarea>
          <div class="apc-attach" data-attach hidden>
            <img data-attach-img alt="">
            <span class="apc-attach-name" data-attach-name></span>
            <button class="apc-icon" data-attach-remove title="Remove image">&#215;</button>
          </div>
          <div class="apc-tools">
            <div class="apc-emojis" data-emojis>${emojis}</div>
            <button type="button" class="apc-secondary apc-attach-btn" data-attach-btn title="Attach an image (or paste / drop one)">+ Image</button>
            <input type="file" accept="image/*" data-file hidden>
          </div>
          <div class="apc-row">
            <span class="apc-count" data-count>0/${MAX_MESSAGE_LEN}</span>
            <button class="apc-primary" data-callout disabled>Call out</button>
          </div>
          <div class="apc-status" data-status></div>
          <details class="apc-manual">
            <summary>Wrong coin? Paste the CA</summary>
            <div class="apc-row">
              <input data-manual placeholder="Mint address" spellcheck="false">
              <button class="apc-secondary" data-use-manual>Use</button>
            </div>
            <div class="apc-row">
              <button class="apc-secondary" data-diagnose title="Ask which wallet is credited for this coin">Why is my callout hidden?</button>
            </div>
            <pre class="apc-diag" data-diag hidden></pre>
          </details>
        </div>
      </div>`;
}
