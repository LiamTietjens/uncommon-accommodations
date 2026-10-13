/**
 * Pure-logic tests for the 13 Oct rules. Imports the real functions from
 * src/trigger/main-agent.ts (no copies to drift). No network, no credentials,
 * no Trigger.dev run, no guest contacted.
 *
 *   npm run test:rules
 *
 * 1. Host replies: which messages count as a person stepping in, and when that
 *    should stop a run.
 * 2. Extras too late to reach the guest: after 3pm the day before checkout
 *    (next-day delivery lands after they've left), on checkout day, or later.
 * 3. Source checks: v2 replies in English, v1 is untouched.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  HOST_REPLY_PAUSE_MINUTES,
  isHostReplyFromSomeoneElse,
  findHostReply,
  daysFromToday,
  extraMissesCheckout,
  EXTRAS_SAME_DAY_CUTOFF_HOUR,
  type ExtraTooLate,
} from "../src/trigger/main-agent.js";

let failed = 0;
function check(label: string, ok: boolean) {
  if (!ok) failed++;
  console.log(`[${ok ? "pass" : "FAIL"}] ${label}`);
}

// ── 1. Host replies ─────────────────────────────────────────────────────────
console.log("\n── Who counts as someone else replying ──");
const host = (source: string | undefined | null) => ({ sender_type: "host", source });
check("Tyler in Hospitable (hospitable) counts", isHostReplyFromSomeoneElse(host("hospitable")));
check("typed in Airbnb/Booking (platform) counts", isHostReplyFromSomeoneElse(host("platform")));
check("Hospitable's AI button (AI) counts", isHostReplyFromSomeoneElse(host("AI")));
check("a new, unknown source counts", isHostReplyFromSomeoneElse(host("email")));
check("this agent's own reply (public_api) does NOT count", !isHostReplyFromSomeoneElse(host("public_api")));
check("scheduled message (automated) does NOT count", !isHostReplyFromSomeoneElse(host("automated")));
check("missing source does NOT count", !isHostReplyFromSomeoneElse(host(undefined)));
check("null source does NOT count", !isHostReplyFromSomeoneElse(host(null)));
check("a guest message does NOT count", !isHostReplyFromSomeoneElse({ sender_type: "guest", source: "platform" }));

console.log(`\n── When a person's message stops the run (pause = ${HOST_REPLY_PAUSE_MINUTES} min) ──`);
const T = Date.parse("2026-10-01T21:44:00Z"); // guest message being answered
const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z"); // Hospitable's format
const sec = 1000, min = 60_000;
const msg = (sender_type: string, source: string, at: number) => ({ sender_type, source, created_at: iso(at) });
const guestAt = iso(T);
const runNow = T + 35 * sec; // after the 30s debounce

check("Gregory (1 Oct): Tyler replied 24s after the guest → stop",
  !!findHostReply([msg("guest", "platform", T), msg("host", "hospitable", T + 24 * sec)], guestAt, runNow));
check("Tyler wrote 3 min before the guest (mid-conversation) → stop",
  !!findHostReply([msg("host", "hospitable", T - 3 * min), msg("guest", "platform", T)], guestAt, runNow));
check("Tyler wrote 10 min before the guest → carry on",
  !findHostReply([msg("host", "hospitable", T - 10 * min), msg("guest", "platform", T)], guestAt, runNow));
check("Tyler replied after the guest, run delayed 8 min → still stop",
  !!findHostReply([msg("guest", "platform", T), msg("host", "platform", T + 1 * min)], guestAt, T + 8 * min));
check("only this agent's own reply after the guest → carry on",
  !findHostReply([msg("guest", "platform", T), msg("host", "public_api", T + 20 * sec)], guestAt, runNow));
check("only a scheduled message after the guest → carry on",
  !findHostReply([msg("guest", "platform", T), msg("host", "automated", T + 20 * sec)], guestAt, runNow));
check("empty thread → carry on", !findHostReply([], guestAt, runNow));
check("guest time in webhook received_at format (+00:00, microseconds) still parses",
  !!findHostReply([msg("host", "AI", T + 10 * sec)], "2026-10-01T21:44:00.535256+00:00", runNow));
check("message with no timestamp is ignored",
  !findHostReply([{ sender_type: "host", source: "hospitable" }], guestAt, runNow));

// ── 2. Extras too late to reach the guest before checkout ───────────────────
console.log(`\n── Days from today, property-local ──`);
const NY = "America/New_York";
const at = (s: string) => new Date(s);
check("15:30 EDT Sep 29 → Sep 30 is 1 day", daysFromToday("2026-09-30", NY, at("2026-09-29T19:30:00Z")) === 1);
check("15:30 EDT Sep 29 → Sep 29 is 0 days", daysFromToday("2026-09-29", NY, at("2026-09-29T19:30:00Z")) === 0);
check("15:30 EDT Sep 29 → Oct 1 is 2 days", daysFromToday("2026-10-01", NY, at("2026-09-29T19:30:00Z")) === 2);
check("23:30 EDT Sep 29 (already Sep 30 in UTC) → Sep 30 is still 1 day",
  daysFromToday("2026-09-30", NY, at("2026-09-30T03:30:00Z")) === 1);
check("across the clocks-go-back weekend (Oct 31 → Nov 1) → 1 day",
  daysFromToday("2026-11-01", NY, at("2026-10-31T20:00:00Z")) === 1);
check("no date → null", daysFromToday(null, NY, at("2026-09-29T19:30:00Z")) === null);
check("garbage date → null", daysFromToday("not-a-date", NY, at("2026-09-29T19:30:00Z")) === null);

console.log(`\n── Escalate instead of promising? (cutoff ${EXTRAS_SAME_DAY_CUTOFF_HOUR}:00 local) ──`);
const cases: [string, string | null, string, string, ExtraTooLate | null][] = [
  // [label, checkout, timezone, now (UTC), expected]
  ["14:59 EDT, checkout tomorrow → promise (today by end of day)", "2026-09-30", NY, "2026-09-29T18:59:00Z", null],
  ["15:00 EDT, checkout tomorrow → ESCALATE", "2026-09-30", NY, "2026-09-29T19:00:00Z", "checkout_eve"],
  ["15:30 EDT, checkout tomorrow → ESCALATE", "2026-09-30", NY, "2026-09-29T19:30:00Z", "checkout_eve"],
  ["23:59 EDT, checkout tomorrow → ESCALATE", "2026-09-30", NY, "2026-09-30T03:59:00Z", "checkout_eve"],
  ["00:00 EDT on checkout day → ESCALATE", "2026-09-30", NY, "2026-09-30T04:00:00Z", "checkout_day"],
  ["07:00 EDT on checkout day, before a 10am checkout → ESCALATE", "2026-09-30", NY, "2026-09-30T11:00:00Z", "checkout_day"],
  ["09:00 EDT on checkout day → ESCALATE (the live test clock)", "2026-09-30", NY, "2026-09-30T13:00:00Z", "checkout_day"],
  ["14:59 EDT on checkout day → ESCALATE", "2026-09-30", NY, "2026-09-30T18:59:00Z", "checkout_day"],
  ["16:00 EDT on checkout day → ESCALATE", "2026-09-30", NY, "2026-09-30T20:00:00Z", "checkout_day"],
  ["23:59 EDT on checkout day → ESCALATE", "2026-09-30", NY, "2026-10-01T03:59:00Z", "checkout_day"],
  ["00:00 EDT the day after checkout → ESCALATE (already gone)", "2026-09-30", NY, "2026-10-01T04:00:00Z", "after_checkout"],
  ["two weeks after checkout → ESCALATE (already gone)", "2026-09-30", NY, "2026-10-13T16:00:00Z", "after_checkout"],
  ["09:00 EDT, checkout in 2 days → promise (today by end of day)", "2026-10-01", NY, "2026-09-29T13:00:00Z", null],
  ["16:00 EDT, checkout in 2 days → promise (tomorrow by 3pm)", "2026-10-01", NY, "2026-09-29T20:00:00Z", null],
  ["before the stay, checkout in a week → promise", "2026-10-06", NY, "2026-09-29T20:00:00Z", null],
  ["no checkout date on file → fall back to promising", null, NY, "2026-09-30T13:00:00Z", null],
  ["15:30 PDT, Los Angeles property, checkout tomorrow → ESCALATE", "2026-09-30", "America/Los_Angeles", "2026-09-29T22:30:00Z", "checkout_eve"],
  ["14:30 PDT (already 17:30 in New York) → promise, local time wins", "2026-09-30", "America/Los_Angeles", "2026-09-29T21:30:00Z", null],
  ["22:00 PDT the night before (already checkout day in New York) → eve, local date wins", "2026-09-30", "America/Los_Angeles", "2026-09-30T05:00:00Z", "checkout_eve"],
  ["16:00 EDT Oct 31, checkout Nov 1 (clocks go back) → ESCALATE", "2026-11-01", NY, "2026-10-31T20:00:00Z", "checkout_eve"],
  ["01:30 EST Nov 1, checkout that day (just after clocks go back) → ESCALATE", "2026-11-01", NY, "2026-11-01T06:30:00Z", "checkout_day"],
];
for (const [label, checkout, tz, now, expected] of cases) {
  const got = extraMissesCheckout(checkout, tz, at(now));
  check(got === expected ? label : `${label} (got ${got})`, got === expected);
}

// ── 3. Source checks: v2 changed, v1 untouched ──────────────────────────────
console.log("\n── Source ──");
const SRC = "src/trigger/main-agent.ts";
const src = readFileSync(SRC, "utf8");
const v2Prompt = src.match(/const systemPrompt = `([\s\S]*?)`;\n/)?.[1] ?? "";
const legacyPrompt = src.match(/const legacySystemPrompt = `([\s\S]*?)`;\n/)?.[1] ?? "";
let shippedLegacy = "";
try {
  shippedLegacy = execSync(`git show HEAD:${SRC}`, { encoding: "utf8" })
    .match(/const legacySystemPrompt = `([\s\S]*?)`;\n/)?.[1] ?? "";
} catch { /* not a git checkout — the comparison below fails loudly */ }

check("v2 prompt: always reply in English", /Always reply in English/.test(v2Prompt));
check("v2 prompt: no longer follows the guest's language", !/same language the guest/.test(v2Prompt));
check("v2 KB answerer writes English", /useV2 \? "English, whatever language the guest wrote in"/.test(src));
check("v1 KB answerer keeps the guest's language", /: "the guest's language"\}/.test(src));
check("v1 prompt byte-identical to the last commit", legacyPrompt.length > 0 && legacyPrompt === shippedLegacy);
check("v1 prompt still detects the guest's language", /Detect the language the guest is writing in/.test(legacyPrompt));
check("checkout escalation is v2 only", /const tooLate = useV2 \? extraMissesCheckout\(/.test(src));
check("last look before sending is v2 only", /if \(useV2\) \{\s*\n\s*const pause = await getActiveCooldown/.test(src));
check("thread check pauses and stops before the agent loop",
  /findHostReply\(thread, messageCreatedAt, Date\.now\(\)\)[\s\S]{0,200}pauseForHostReply/.test(src));
check("host webhooks pause the property", /await pauseIfSomeoneElseReplied\(webhookData/.test(src));
check("host pause only for v2", /getAgentVariant\(reservationUuid\)\) !== "v2"\) return false/.test(src));
check("test clock honoured for test reservations only",
  /testReservationUuids\.includes\(reservationUuid\)\s*\n?\s*\? Date\.parse\(payload\.test_now/.test(src));
check("escalation SMS names the item and the problem",
  /The guest asked for \$\{itemRequested\} \$\{problem\}\. The AI hasn't promised anything/.test(src));
for (const [key, wording] of [
  ["checkout_eve", "after 3pm, but checks out tomorrow (${checkout}), so next-day delivery would come after they leave"],
  ["checkout_day", "on their checkout day (${checkout}), so a delivery might not reach them before they leave"],
  ["after_checkout", "after they checked out (${checkout})"],
]) {
  check(`escalation SMS wording for ${key} names the checkout date`,
    src.includes(`${key}: {`) && src.includes(`problem: \`${wording}\``));
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
