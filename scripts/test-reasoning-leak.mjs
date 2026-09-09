/**
 * Regression test for the 8 Sep reasoning leak (Catherine, Unit 6 - Cabin).
 *
 * Replays her EXACT thread and the exact position in it — the trailing
 * one-line acknowledgment that made the agent narrate itself — across 15
 * wordings, against both the old v2 prompt (with the WRONG example) and the
 * current one (without it). Running both is the point: the leak is
 * intermittent, so a clean run on the new prompt alone cannot tell a fix
 * apart from a lucky sample.
 *
 *   node scripts/test-reasoning-leak.mjs
 *
 * Only api.anthropic.com is called. Tool handlers are never invoked and no
 * message can reach a guest: there is no Hospitable send path in this file.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";

const FIXTURE = process.env.LEAK_FIXTURE;
if (!FIXTURE) { console.error("Set LEAK_FIXTURE to the saved thread JSON."); process.exit(2); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set."); process.exit(2); }

const MODEL = "claude-sonnet-4-6";
const REPEATS = Number(process.env.REPEATS ?? 1);
const PROPERTY = "Unit 6 - Cabin";
const GUEST = "Catherine";
// The moment the coordinator actually ran, so the "[x ago]" stamps match the incident.
const NOW = new Date("2026-09-08T23:50:57Z").getTime();
const LEAKED_AT = "2026-09-08T23:51:01Z"; // the bad reply — excluded to rebuild the pre-leak state

// ── Prompts: current working tree vs the commit before the fix ──────────
const pickV2 = (src) => src.match(/const systemPrompt = `([\s\S]*?)`;\n/)[1];
const NEW_SRC = readFileSync("src/trigger/main-agent.ts", "utf8");
const OLD_SRC = execSync("git show HEAD~1:src/trigger/main-agent.ts", { encoding: "utf8" });
const PROMPTS = { "OLD (with example)": pickV2(OLD_SRC), "NEW (example removed)": pickV2(NEW_SRC) };

if (!PROMPTS["OLD (with example)"].includes("Jared")) throw new Error("old prompt lacks the example — wrong baseline");
if (PROMPTS["NEW (example removed)"].includes("Jared")) throw new Error("new prompt still has the example");

function arrayAt(source, startNeedle) {
  const start = source.indexOf(startNeedle);
  const open = source.indexOf("[", start + startNeedle.length - 1);
  let depth = 0, end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]" && --depth === 0) { end = i; break; }
  }
  return eval(`(${source.slice(open, end + 1).replace(/ as const/g, "")})`);
}
const TOOLS = arrayAt(NEW_SRC, "const TOOLS: Anthropic.Tool[] = [");
const fill = (tpl, v) => tpl.replace(/\$\{([^}]+)\}/g, (_, e) => v[e] ?? `\${${e}}`);

// ── Rebuild the history exactly as main-agent.ts would have ─────────────
function timeAgo(iso, now) {
  const then = new Date(iso).getTime();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  return `${Math.max(1, Math.floor(days / 30))} month${Math.floor(days / 30) === 1 ? "" : "s"} ago`;
}

const raw = JSON.parse(readFileSync(FIXTURE, "utf8"));
const thread = (raw.data ?? raw)
  .filter((m) => m.created_at !== LEAKED_AT)
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  .slice(-40)
  .map((m) => ({ role: m.sender_type === "guest" ? "guest" : "host", content: m.body || "", at: m.created_at }));

const LAST = thread[thread.length - 1];
if (LAST.role !== "guest" || LAST.content.trim() !== "sounds good")
  throw new Error(`expected trailing "sounds good", got ${LAST.role}: ${LAST.content.slice(0, 60)}`);

// 15 wordings of the same trailing acknowledgment. #1 is verbatim what she sent.
const VARIATIONS = [
  "sounds good", "Sounds good!", "sounds good, thank you", "perfect, thanks!",
  "great, thanks", "ok great", "awesome, see you Friday", "sounds great, thanks so much",
  "perfect", "👍", "ok sounds good see you then", "wonderful, thank you!",
  "great! looking forward to it", "thanks, sounds good to me", "Sounds Good",
];

// ONLY=<substring> narrows the sweep to one wording, for hammering a hot spot.
const ONLY = process.env.ONLY;
const ACTIVE = ONLY ? VARIATIONS.filter((v) => v.includes(ONLY)) : VARIATIONS;
if (!ACTIVE.length) { console.error(`ONLY="${ONLY}" matched no variation.`); process.exit(2); }

function userTurn(msg) {
  const hist = thread
    .map((m, i) => {
      const content = i === thread.length - 1 ? msg : m.content;
      const when = timeAgo(m.at, NOW);
      return `[${when}] ${m.role === "guest" ? "Guest" : "Host"}: ${content}`;
    })
    .join("\n");
  return `Here is the conversation so far:\n\n${hist}\n\nThe guest's latest message is:\n"${msg}"`;
}

// ── Leak detection ─────────────────────────────────────────────────────
// Narration about the guest or about the reply itself. A vocative
// ("You're so welcome, Catherine!") is second person and must not match.
const SIGNALS = [
  [/^\s*["']?Catherine[''`]s\b/i,                      "opens with \"Catherine's ...\""],
  [/\bCatherine (is|was|seems|just|has|hasn't|doesn't|does not|only|simply)\b/i, "refers to guest in 3rd person"],
  [/\b(the guest|this message|their message|her message)\s+(is|was|seems|just|only)\b/i, "narrates the message"],
  [/friendly acknowledg|just an acknowledg|simple acknowledg/i, "classifies the message"],
  [/nothing to action|no action (is )?(needed|required)|nothing (needs|to be) (done|actioned)|nothing to (handle|arrange|look up)/i, "states no action needed"],
  [/no (questions|requests|tools?|need for)\b/i,       "states nothing to answer"],
  [/I'?ll (send|write|reply with|keep (it|this)|just (send|reply))/i, "announces the reply"],
  [/here'?s (my|the) (reply|response|message)/i,       "labels the reply"],
  [/\b(knowledge base|escalat|maintenance ticket|tool call|no tool)\b/i, "mentions internals"],
];
const detect = (t) => SIGNALS.filter(([re]) => re.test(t)).map(([, l]) => l);

const anthropic = new Anthropic();

async function once(promptTpl, msg) {
  const system = fill(promptTpl, { "property.name": PROPERTY, guestName: GUEST });
  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 1024, system, tools: TOOLS,
    messages: [{ role: "user", content: userTurn(msg) }],
  });
  const tools = res.content.filter((b) => b.type === "tool_use").map((b) => b.name);
  // main-agent.ts sends the FIRST text block verbatim, so judge exactly that.
  const text = (res.content.find((b) => b.type === "text")?.text ?? "").trim();
  return { tools, text, flags: detect(text) };
}

const wrap = (s, w = 88) => {
  const out = [];
  for (const para of (s || "(no text)").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > w) { out.push(line.trim()); line = word; }
      else line += " " + word;
    }
    out.push(line.trim());
  }
  return out.filter((l) => l.length);
};

console.log("\n" + "=".repeat(96));
console.log("  REASONING-LEAK REGRESSION — Catherine / Unit 6 - Cabin / 8 Sep 23:49 UTC");
console.log(`  Exact thread replayed, ${ACTIVE.length} wording(s) x ${REPEATS} rep(s) per arm`);
console.log("  Anthropic API only. No Hospitable send path exists in this file.");
console.log("=".repeat(96));

const summary = {};
for (const [label, tpl] of Object.entries(PROMPTS)) {
  console.log(`\n\n${"#".repeat(96)}\n##  ${label}\n${"#".repeat(96)}`);
  let leaks = 0, toolCalls = 0, n = 0;
  for (let rep = 0; rep < REPEATS; rep++) {
  for (let i = 0; i < ACTIVE.length; i++) {
    const msg = ACTIVE[i];
    n++;
    let r;
    for (let attempt = 0; ; attempt++) {
      try { r = await once(tpl, msg); break; }
      catch (e) {
        if (attempt >= 3) throw e;
        await new Promise((s) => setTimeout(s, 2000 * (attempt + 1)));
      }
    }
    if (r.flags.length) leaks++;
    if (r.tools.length) toolCalls++;
    const mark = r.flags.length ? "LEAK" : " ok ";
    // On repeat sweeps only the failures matter; run 1 is printed in full.
    if (rep === 0 || r.flags.length) {
      console.log(`\n[${mark}] ${REPEATS > 1 ? `r${rep + 1}.` : ""}${String(i + 1).padStart(2)}. guest: "${msg}"`);
      if (r.tools.length) console.log(`        tools: ${r.tools.join(", ")}`);
      if (r.flags.length) console.log(`        flags: ${r.flags.join("; ")}`);
      for (const l of wrap(r.text)) console.log(`        ${l}`);
    }
  }
  }
  summary[label] = { leaks, toolCalls, n };
}

console.log("\n\n" + "=".repeat(96));
console.log("  RESULT");
console.log("=".repeat(96));
for (const [label, s] of Object.entries(summary)) {
  const pct = ((s.leaks / s.n) * 100).toFixed(1);
  console.log(`  ${label.padEnd(24)}  leaked ${String(s.leaks).padStart(2)}/${s.n}  (${pct}%)   tool-calls ${s.toolCalls}/${s.n}`);
}
console.log("=".repeat(96) + "\n");
