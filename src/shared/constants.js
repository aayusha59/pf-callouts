/**
 * Shared constants and pump.fun route contract.
 *
 * Create / eligibility / reply paths match the public web client's API.
 * A create is one POST per user per mint; later posts are replies on that callout.
 */

export const OVERLAY_HOST_ID = "axiom-pump-callout-host";

export const BASE58_FULL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const BASE58_GLOBAL = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export const PUMP_ORIGIN = "https://pump.fun";
export const PUMP_API = "https://frontend-api-v3.pump.fun";
export const PUMP_PROFILE_API = "https://profile-api.pump.fun";
export const DEXSCREENER = "https://api.dexscreener.com/latest/dex";

export const PUMP_TAB_PATTERN = "*://*.pump.fun/*";

export const MAX_MESSAGE_LEN = 280;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const STATS_POLL_MS = 3000;
export const MAX_CAPTURES = 5;

export const QUICK_EMOJIS = [
  { label: "lol", char: "\u{1F602}" },
  { label: "rofl", char: "\u{1F923}" },
  { label: "sob", char: "\u{1F62D}" },
  { label: "fire", char: "\u{1F525}" },
  { label: "goat", char: "\u{1F410}" },
];

/** Program / well-known accounts that appear on every Solana page and are never the coin mint. */
export const NOT_A_MINT = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCE8BenwNYB",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "11111111111111111111111111111111",
]);

export const MINT_LINK_PATTERNS = [
  /pump\.fun\/coin\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
  /solscan\.io\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
  /solscan\.io\/account\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
  /dexscreener\.com\/solana\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
  /birdeye\.so\/token\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
  /rugcheck\.xyz\/tokens\/([1-9A-HJ-NP-Za-km-z]{32,44})/,
];

/**
 * pump.fun frontend-api-v3 routes used by this extension.
 * Paths match the public web client's route contract.
 */
export const API = {
  coin: `${PUMP_API}/coins/{{mint}}`,
  me: `${PUMP_API}/auth/my-profile`,
  eligibility: `${PUMP_API}/callout/eligibility/{{mint}}`,
  userMintCallout: `${PUMP_API}/callout/user/{{userId}}/mint/{{mint}}`,
  replies: `${PUMP_API}/callout/{{calloutId}}/replies`,
  callout: `${PUMP_API}/callout/{{calloutId}}`,
  positions: `${PUMP_API}/user-positions/{{userId}}?mints={{mint}}&updatesLimit=0`,
  walletTokens: `${PUMP_PROFILE_API}/balance/tokens/{{wallet}}?page={{page}}&size=100`,
  dexPair: `${DEXSCREENER}/pairs/solana/{{pair}}`,
  dexToken: `${DEXSCREENER}/tokens/{{token}}`,
};

export const DEFAULT_TEMPLATE = {
  method: "POST",
  url: `${PUMP_API}/callout/create`,
  headers: { "content-type": "application/json" },
  body: { coinMint: "{{mint}}", thesis: "{{content}}", version: 2 },
};

export const DROP_HEADERS = new Set([
  "cookie",
  "authorization",
  "content-length",
  "host",
  "origin",
  "referer",
  "user-agent",
  "connection",
  "accept-encoding",
  "accept-language",
  "pragma",
  "cache-control",
  "priority",
  "dnt",
  "te",
]);
