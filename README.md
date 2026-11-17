# Social Trading Overlay

Chrome extension that posts a pump.fun callout or a fomo thesis straight from an axiom.trade coin page. No switching tabs, and no pump.fun or fomo app, webapp, or terminal.

This small personal tool of mine made me $2.7k USD from pump.fun callout rewards in one month, and will continue to make more. No pump.fun/fomo app, webapp, or terminal needed at ALL.

It lets you call out coins or post a thesis the second you buy them, in the same interface, meaning more viewers, tailers, and more profit, because you called it FAST. Now on pump.fun and fomo.

<img width="1204" height="368" alt="image" src="https://github.com/user-attachments/assets/8448a97d-c4e8-4525-b36a-811240b44952" />

## What it does

On `axiom.trade/meme/*` and `axiom.trade/token/*` a floating overlay:

1. Finds the coin's mint from the address in the URL (DexScreener first; on `/meme/` pages the page DOM is a last resort).
2. Lets you pick where to post with the **PUMP / FOMO** switch in the header. The choice is remembered.
3. Shows your callout or thesis on that coin, if you have one, with live stats.
4. Posts a new one, or an update.

|            | PUMP                                   | FOMO                                                                                   |
| ---------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| Posts as   | A callout. Updates are author replies. | A thesis on your trade for that coin.                                                  |
| Length     | 280 characters                         | 3,000 characters                                                                       |
| Images     | Paste, drop, or pick a file            | Not yet (fomo doesn't take them)                                                       |
| Live stats | Likes, views, replies, shares, quotes  | Likes, views                                                                           |
| Needs      | Signed in to pump.fun                  | Signed in to fomo.family, and a trade on the coin: open, or sold less than 3 hours ago |

Use the same wallet on Axiom, pump.fun, and fomo so your buys count everywhere. The extension uses the sessions you're already signed in to in this Chrome profile. It does not store passwords.

<img width="1918" height="594" alt="image (1)" src="https://github.com/user-attachments/assets/4de5d36c-ecb5-4d5a-93fa-275f5e3fc30f" />

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Pin the extension if you want the popup one click away.

After updating the files, click **Reload** on the extension card, then refresh any open Axiom tab.

## Use

1. Sign in to [pump.fun](https://pump.fun) and/or [fomo.family](https://fomo.family) in this browser.
2. Open a coin page on Axiom (`/token/...` or `/meme/...`).
3. Pick **PUMP** or **FOMO** in the overlay header.
4. Type your note. On pump.fun it's optional for a first callout and required for an update.
5. Click **Call out** / **Update callout**, or **Post thesis** / **Update thesis**.

If the overlay picked the wrong coin, expand **Wrong coin? Paste the CA** and paste the mint address.

There is no local cooldown. Eligibility, duplicates, and rate limits come from pump.fun and fomo. When fomo refuses a thesis (no trade on the coin, sold too long ago, posting too fast, or moderation), the overlay says why.

## Hidden callouts (pump.fun)

A callout can exist and still not appear on the public coin page. pump.fun hides it when the author's tracked position is closed (exited, or held amount is 0) on the pump.fun session wallet.

That is pump.fun's listing behavior, not something this extension can override. **Why is my callout hidden?** in the overlay prints the eligibility, position, and on-chain balance data the web client uses. A common case is trading from a different wallet than the one signed in on pump.fun.

## Popup

The toolbar popup shows whether you're signed in to pump.fun and fomo, with a link to sign in if you're not. **Recheck** checks both again. **Reset overlay position** puts the overlay back if it ends up off-screen.

## How requests are sent

pump.fun and fomo reject `Origin: chrome-extension://...`. The service worker installs session declarativeNetRequest rules that set Origin to the site's own (`https://pump.fun`, `https://fomo.family`) on its own fetches. If a request still fails (CORS, network, or 401), it runs inside an open tab of that site instead.

**pump.fun**

- Create: `POST /callout/create` with `{ coinMint, thesis, version: 2 }`.
- Update: `POST /callout/{id}/replies` with `{ content }`.
- A `409 DUPLICATE_CALLOUT` is treated as an update.

**fomo** (`prod-api.fomo.family`)

- Who you are: `GET /v2/users/current`.
- Your trade on the coin: `GET /trades?userId&tokenAddress&networkId`. An open trade wins, otherwise the latest closed one.
- Post: `POST /trades/comment` with `{ tradeId, comment, visibility: "public" }`.
- Stats: `GET /trades/{id}/comments` and `POST /engagement/thesisViewCounts`.

## Layout

```
manifest.json
icons/                 toolbar and store icons (16, 32, 48, 128px)
popup/                 toolbar popup
src/background/        service worker (messages, transport, pump.fun and fomo calls)
src/content/           Axiom overlay and mint detection
src/shared/            constants, HTTP helpers, the create request, messaging
```

## Privacy

- Uses the existing pump.fun and fomo cookies in this profile.
- The Origin rewrite applies only to the service worker's own requests to pump.fun and fomo, not to ordinary browsing.

## Requirements

Chrome 120 or later (content scripts are ES modules).
