import { API, BASE58_FULL } from "../shared/constants.js";
import { errMessage } from "../shared/format.js";
import { fill, request } from "../shared/http.js";
import { authStatus } from "./callouts.js";
import { pumpCall } from "./transport.js";

/**
 * Reads the same eligibility / positions / balance endpoints the web client uses
 * so a hidden callout can be explained from the platform's own data.
 */
export async function diagnosePosition(mint) {
  if (!BASE58_FULL.test(mint || "")) return { ok: false, error: "Invalid mint address" };
  const auth = await authStatus();
  if (!auth.loggedIn) return { ok: false, error: "Not signed in to pump.fun" };
  const wallet = auth.user.address;

  const [elig, pos] = await Promise.all([
    pumpCall(fill(API.eligibility, { mint }), { method: "GET" }),
    pumpCall(fill(API.positions, { userId: wallet, mint }), { method: "GET" }),
  ]);

  const pre = elig.ok ? elig.data?.preflight : null;
  // postableAccounts[0] is the signed-in caller: verdict plus the position used for it.
  const me = Array.isArray(pre?.postableAccounts) ? pre.postableAccounts[0] || null : null;
  const rows = pos.ok && Array.isArray(pos.data?.positions) ? pos.data.positions : [];

  let onChain = { checked: false, held: null, error: null };
  try {
    for (let page = 1; page <= 5; page++) {
      const r = await request(fill(API.walletTokens, { wallet, page: String(page) }), { method: "GET" });
      if (r.status === 404) {
        onChain = { checked: true, held: null, error: null };
        break;
      }
      if (!r.ok) {
        onChain = { checked: false, held: null, error: `HTTP ${r.status}` };
        break;
      }
      const tokens = r.data?.data?.tokens || [];
      const hit = tokens.find((t) => t?.token_mint === mint);
      if (hit) {
        onChain = { checked: true, held: hit, error: null };
        break;
      }
      onChain = { checked: true, held: null, error: null };
      if (tokens.length < 100) break;
    }
  } catch (err) {
    onChain = { checked: false, held: null, error: errMessage(err) };
  }

  return {
    ok: true,
    wallet,
    eligibility: elig.ok
      ? {
          eligible: elig.data.eligible,
          reason: elig.data.reason?.type ?? null,
          verdict: me?.verdict ?? null,
          attemptsRemaining: me?.attemptsRemaining ?? null,
          position: me?.position ?? null,
          userFound: pre?.userFound ?? null,
        }
      : { error: elig.error || `HTTP ${elig.status}` },
    positions: pos.ok
      ? rows.map((r) => ({
          walletAddress: r.walletAddress,
          chainId: r.chainId,
          amountHeld: r.amountHeld,
          isExited: r.isExited,
          pnlUsd: r.pnlUsd,
          valueUsd: r.valueUsd ?? null,
          amountBoughtUsd: r.amountBoughtUsd ?? null,
          hasTransfers: r.hasTransfers ?? null,
          callout: r.callout ? { calloutId: r.callout.calloutId || r.callout.id || null } : null,
        }))
      : { error: pos.error || `HTTP ${pos.status}` },
    onChain,
  };
}
