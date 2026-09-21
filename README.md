# Axiom to Pump.fun Callout

Chrome extension (Manifest V3) that posts a pump.fun callout from an axiom.trade coin page without switching tabs.

## What it does

On `axiom.trade/meme/*` a floating overlay:

1. Resolves the current coin mint from the pair address in the URL (DexScreener first; the page DOM is a last resort).
2. Checks whether you already have a callout on that mint.
3. Creates a callout, or posts an update (an author reply) if one already exists.
4. Optionally attaches an image (paste, drop, or file picker) and inserts a short emoji row.

You stay signed in to pump.fun in the same Chrome profile. The extension uses that session; it does not store passwords.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin the extension if you want the popup one click away.

After updating the files, click **Reload** on the extension card, then refresh any open Axiom tab.

## Use

1. Sign in to [pump.fun](https://pump.fun) in this browser.
2. Open a coin page on Axiom (`/meme/...`).
3. Type a note in the overlay (optional on a first callout; required for an update).
4. Click **Call out** or **Update callout**.

If the overlay picked the wrong mint, expand **Wrong coin? Paste the CA** and paste the mint address.

There is no local cooldown. Eligibility and duplicate handling come from the pump.fun API.

Live likes, views, replies, shares, and quotes refresh every few seconds while a callout of yours is on the current coin.

## Hidden callouts

A callout can exist and still not appear on the public coin page. The listing site hides it when the author's tracked position is closed (exited, or held amount is 0) on the pump.fun session wallet.

That is server/client listing behavior, not something this extension can override. **Why is my callout hidden?** in the overlay prints the eligibility, position, and on-chain balance data the web client uses. A common case is trading from a different wallet than the one signed in on pump.fun.

## Popup

The toolbar popup is for session status and request plumbing:

- **Request template:** JSON for `POST /callout/create`. Placeholders `{{mint}}` and `{{content}}` are filled at send time.
- **Captured callout requests:** while the extension is loaded, a successful write from the pump.fun site itself is recorded (cookies redacted) and adopted as the template unless you edited it by hand.
- **How to send the request:** auto (service-worker fetch, then a pump.fun tab), direct only, or always via a tab.

## How requests are sent

pump.fun rejects `Origin: chrome-extension://...`. The service worker installs a session declarativeNetRequest rule that sets Origin/Referer to `https://pump.fun` on its own fetches. If that still fails (CORS, network, or 401), the same request is run inside an existing pump.fun tab.

Create path: `POST /callout/create` with `{ coinMint, thesis, version: 2 }`.  
Update path: `POST /callout/{id}/replies` with `{ content }`.  
A `409 DUPLICATE_CALLOUT` is treated as an update.

## Layout

```
manifest.json
popup/                 toolbar popup
src/background/        service worker (messages, transport, recorder)
src/content/           Axiom overlay and mint detection
src/shared/            constants, HTTP helpers, templates, messaging
```

## Privacy

- Uses the existing pump.fun cookies in this profile.
- Captured request headers redact `Cookie` and `Authorization`.
- The Origin rewrite applies only to service-worker requests to pump.fun, not to ordinary browsing.

## Requirements

Chrome 120 or later (content scripts are ES modules).
