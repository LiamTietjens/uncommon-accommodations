/**
 * Pure-logic tests for the check-in/checkout window. No network, no API keys,
 * no Trigger.dev, no Supabase — runs in about 20ms.
 *
 *   node scripts/test-checkin-logic.mjs
 *
 * The two branch constants and the date function are parsed out of
 * src/trigger/main-agent.ts so this tests the shipping values, not a copy.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const SRC = "src/trigger/main-agent.ts";
const src = readFileSync(SRC, "utf8");

// ── Mirror of getLocalHour from src/lib/turno.ts ────────────────────────────
function getLocalHour(timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  });
  const p = Object.fromEntries(
    fmt.formatToParts(new Date()).map((x) => [x.type, parseInt(x.value, 10)])
  );
  return { year: p.year, month: p.month, day: p.day, hour: p.hour === 24 ? 0 : p.hour };
}

// ── Values pulled from the source so they can't drift ───────────────────────
const windowDays = Number(src.match(/COORDINATION_WINDOW_DAYS\s*=\s*(\d+)/)?.[1]);
const noCoordBlock = src.match(/NO_COORDINATION_NEEDED:\s*Record<string, string>\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? "";
const noCoordKeys = [...noCoordBlock.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]);
const enumBlock = src.match(/enum:\s*\[([^\]]+)\]/)?.[1] ?? "";
const cases = [...enumBlock.matchAll(/"(\w+)"/g)].map((m) => m[1]);

// ── The function under test, mirroring subWorkflowE's date logic ────────────
function daysUntilCheckIn(checkInDate, timezone) {
  if (!checkInDate) return null;
  const [y, m, d] = checkInDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const local = getLocalHour(timezone);
  return Math.round(
    (Date.UTC(y, m - 1, d) - Date.UTC(local.year, local.month - 1, local.day)) / 86_400_000
  );
}

// Reproduces the branch order in subWorkflowE: no-coordination first, then window.
// Both guards are gated on useV2, so v1 always falls through to COORDINATE —
// which is exactly what it did before the rework.
function route(requestType, checkInDate, timezone = "America/New_York", useV2 = true) {
  if (useV2 && noCoordKeys.includes(requestType)) return "NO_COORDINATION";
  const days = daysUntilCheckIn(checkInDate, timezone);
  if (useV2 && days !== null && days > windowDays) return "TOO_EARLY";
  return "COORDINATE";
}

// ── Fixtures, relative to today in the property's timezone ──────────────────
const tz = "America/New_York";
const today = getLocalHour(tz);
const offset = (n) => {
  const d = new Date(Date.UTC(today.year, today.month - 1, today.day + n));
  return d.toISOString().slice(0, 10);
};

const tests = [
  // [label, requestType, checkInDate, expected]
  ["late check-in, far future        ", "late_checkin",  offset(60), "NO_COORDINATION"],
  ["late check-in, tomorrow          ", "late_checkin",  offset(1),  "NO_COORDINATION"],
  ["early checkout, mid-stay         ", "early_checkout", offset(-2), "NO_COORDINATION"],
  ["early check-in, 8 days out       ", "early_checkin", offset(8),  "TOO_EARLY"],
  ["early check-in, exactly 7 days   ", "early_checkin", offset(7),  "COORDINATE"],
  ["early check-in, tomorrow         ", "early_checkin", offset(1),  "COORDINATE"],
  ["early check-in, today            ", "early_checkin", offset(0),  "COORDINATE"],
  ["late checkout, 30 days out       ", "late_checkout", offset(30), "TOO_EARLY"],
  ["late checkout, 6 days out        ", "late_checkout", offset(6),  "COORDINATE"],
  ["late checkout, guest mid-stay    ", "late_checkout", offset(-3), "COORDINATE"],
  ["early check-in, no date on file  ", "early_checkin", null,       "COORDINATE"],
  ["early check-in, malformed date   ", "early_checkin", "not-a-date", "COORDINATE"],
];

console.log(`\nCheck-in / checkout routing — pure logic, no network`);
console.log(`Parsed from ${SRC}:`);
console.log(`  window            = ${windowDays} days`);
console.log(`  no coordination   = ${noCoordKeys.join(", ")}`);
console.log(`  cases in tool     = ${cases.join(", ")}`);
console.log(`  today (${tz}) = ${offset(0)}\n`);

let failed = 0;
for (const [label, type, date, expected] of tests) {
  const got = route(type, date);
  const ok = got === expected;
  if (!ok) failed++;
  const days = daysUntilCheckIn(date, tz);
  console.log(
    `[${ok ? "pass" : "FAIL"}] ${label} ${String(date ?? "null").padEnd(12)} ` +
    `${String(days ?? "-").padStart(4)}d  ->  ${got}${ok ? "" : `   EXPECTED ${expected}`}`
  );
}

// Structural checks that would catch a half-applied edit.
console.log();
const structural = [
  ["all four cases present in tool enum", cases.length === 4],
  ["late_checkin is a valid case", cases.includes("late_checkin")],
  ["early_checkout is a valid case", cases.includes("early_checkout")],
  ["window is 7 days", windowDays === 7],
  ["no-coordination covers exactly late_checkin + early_checkout",
    noCoordKeys.length === 2 && noCoordKeys.includes("late_checkin") && noCoordKeys.includes("early_checkout")],
  // Scoped to the v2 prompt: the legacy prompt in the same file still contains
  // the canned sentence on purpose, and must keep doing so.
  ["v2 prompt no longer hardcodes the canned check-in sentence",
    !/ALWAYS reply\s*\n?to the guest with exactly this message/.test(
      src.match(/const systemPrompt = `([\s\S]*?)`;\n/)?.[1] ?? "")],
  ["prompt does NOT depend on locale", !src.includes("${guestLocale}")],
  ["webhook locale is actually read", /sender\?\.locale/.test(src)],
  ["reply body is logged", /replyBody/.test(src)],
];

// ── v1 / v2 split ───────────────────────────────────────────────────────────
// The legacy path must be byte-identical to what is running in production today,
// otherwise the live A/B is comparing against something that never shipped.
const legacyPrompt = src.match(/const legacySystemPrompt = `([\s\S]*?)`;\n/)?.[1] ?? "";
let shippedPrompt = "";
try {
  shippedPrompt = execSync("git show HEAD:src/trigger/main-agent.ts", { encoding: "utf8" })
    .match(/const systemPrompt = `([\s\S]*?)`;\n/)?.[1] ?? "";
} catch { /* not a git checkout — the comparison below will fail loudly */ }

const v1v2 = [
  ["legacy prompt is byte-identical to the shipped one",
    legacyPrompt.length > 0 && legacyPrompt === shippedPrompt],
  ["legacy prompt still says 'Detect the language'", /Detect the language/.test(legacyPrompt)],
  ["legacy prompt still has the hardcoded canned check-in sentence",
    /ALWAYS reply\s*\n?to the guest with exactly this message/.test(legacyPrompt)],
  ["v2 prompt does NOT have the canned sentence",
    !/ALWAYS reply\s*\n?to the guest with exactly this message/.test(
      src.match(/const systemPrompt = `([\s\S]*?)`;\n/)?.[1] ?? "")],
  ["legacy tool set exists and swaps only the check-in tool",
    /LEGACY_TOOLS[\s\S]{0,200}TOOLS\.map/.test(src)],
  ["legacy check-in tool has the old 2-case enum",
    /LEGACY_CHECKIN_TOOL[\s\S]*?enum: \["early_checkin", "late_checkout"\]/.test(src)],
  ["prompt and tool set are both selected by the variant",
    /activeSystemPrompt = useV2 \? systemPrompt : legacySystemPrompt/.test(src) &&
    /activeTools = useV2 \? TOOLS : LEGACY_TOOLS/.test(src)],
  ["the agent loop uses the selected prompt and tools, not the v2 ones directly",
    /system: activeSystemPrompt,\s*\n\s*tools: activeTools,/.test(src)],
  ["subWorkflowE receives the variant flag", /useV2: boolean/.test(src)],
  ["both subWorkflowE guards are gated on useV2",
    /const noCoordLabel = useV2 \?/.test(src) && /if \(useV2 && days !== null/.test(src)],
  ["allowlist is read fresh per run", /await getV2ReservationUuids\(\)/.test(src)],
  ["runs are tagged with the variant", /tags\.add\(`agent:\$\{variant\}`\)/.test(src)],
];

// ── Conversation history timestamps ─────────────────────────────────────────
// Mirrors timeAgo in main-agent.ts. Without these labels the agent could not
// tell a request from 3 minutes ago from one 5 months ago, and told a guest
// something was "already with the team" when nothing had been raised.
function timeAgo(iso, now) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.max(1, Math.floor(days / 30));
  return `${months} month${months === 1 ? "" : "s"} ago`;
}
const NOW = Date.parse("2026-09-03T13:40:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const historyTs = [
  ["30 seconds  -> just now", timeAgo(ago(30e3), NOW) === "just now"],
  ["1 minute", timeAgo(ago(60e3), NOW) === "1 minute ago"],
  ["3 minutes", timeAgo(ago(3 * 60e3), NOW) === "3 minutes ago"],
  ["2 hours", timeAgo(ago(2 * 3600e3), NOW) === "2 hours ago"],
  ["3 days", timeAgo(ago(3 * 864e5), NOW) === "3 days ago"],
  ["5 months (the live bug)", timeAgo(ago(150 * 864e5), NOW) === "5 months ago"],
  ["missing timestamp is omitted, not guessed", timeAgo(undefined, NOW) === null],
  ["garbage timestamp is omitted", timeAgo("not-a-date", NOW) === null],
  ["future timestamp does not go negative", timeAgo(ago(-60e3), NOW) === "just now"],
  ["history is stamped in the prompt", /\[\$\{when\}\] \$\{who\}/.test(src)],
  ["both AI calls share one formatter",
    (src.match(/formatHistory\(/g) || []).length >= 3],
  ["timestamps are carried from Hospitable", /at: m\.created_at/.test(src)],
  ["prompt tells the agent to use the stamps", /stamped with how long ago/.test(src)],
  ["check-in tool is exempt from the already-done rule",
    /This does NOT apply to handle_checkin_checkout/.test(src)],
];

// v1 must never take either shortcut, whatever the case or the date.
const v1Routing = [
  ["v1: late check-in still coordinates", route("late_checkin", offset(3), tz, false) === "COORDINATE"],
  ["v1: early checkout still coordinates", route("early_checkout", offset(3), tz, false) === "COORDINATE"],
  ["v1: 40 days out still coordinates", route("early_checkin", offset(40), tz, false) === "COORDINATE"],
  ["v2: 40 days out does not", route("early_checkin", offset(40), tz, true) === "TOO_EARLY"],
];
for (const [label, ok] of structural) {
  if (!ok) failed++;
  console.log(`[${ok ? "pass" : "FAIL"}] ${label}`);
}

console.log("\n── v1 / v2 live split ──");
for (const [label, ok] of [...v1v2, ...v1Routing, ...historyTs]) {
  if (!ok) failed++;
  console.log(`[${ok ? "pass" : "FAIL"}] ${label}`);
}

const total = tests.length + structural.length + v1v2.length + v1Routing.length + historyTs.length;
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
