/**
 * Runs the SAME guest message through v1 (live today) and v2 (the rework) and
 * prints them side by side, so the live A/B can be sanity-checked before deploy.
 *
 *   npm run compare
 *
 * Same safety guarantees as the other suites: only api.anthropic.com is called,
 * tool handlers are never invoked, no Turno / SMS / Hospitable / Supabase.
 */

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const SRC = "src/trigger/main-agent.ts";
const src = readFileSync(SRC, "utf8");

const bad = ["TURNO_API_KEY","TELNYX_API_KEY","HOSPITABLE_API_TOKEN","SUPABASE_SERVICE_ROLE_KEY","TRIGGER_SECRET_KEY"]
  .filter(k => process.env[k]);
if (bad.length) { console.error(`\nREFUSING TO RUN — live credentials present: ${bad.join(", ")}\n`); process.exit(2); }
if (!process.env.ANTHROPIC_API_KEY) { console.error("\nANTHROPIC_API_KEY not set.\n"); process.exit(2); }

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
const TOOLS = arrayAt(src, "const TOOLS: Anthropic.Tool[] = [");
const LEGACY_CHECKIN = eval(`(${src.match(/const LEGACY_CHECKIN_TOOL: Anthropic\.Tool = (\{[\s\S]*?\n\};)/)[1].replace(/ as const/g,"").replace(/;$/,"")})`);
const LEGACY_TOOLS = TOOLS.map(t => t.name === "handle_checkin_checkout" ? LEGACY_CHECKIN : t);

const fill = (tpl, vars) => tpl.replace(/\$\{([^}]+)\}/g, (_, e) => vars[e] ?? `\${${e}}`);
const V2_PROMPT = src.match(/const systemPrompt = `([\s\S]*?)`;\n/)[1];
const V1_PROMPT = src.match(/const legacySystemPrompt = `([\s\S]*?)`;\n/)[1];

// Stubs mirroring each variant's real tool return. v1 always coordinates.
const V1_E = 'Request forwarded to cleaning team (2 notified). Tell the guest: "Not a problem. I\'m going to check with our cleaning team to see if it\'s possible and let you know."';
const V2_E = {
  early_checkin_far: "Too early to answer — check-in is 41 days away and availability is not known until closer to the stay. Nobody has been notified and no request has been raised. Tell the guest we are happy to try to accommodate it but will not know until nearer the time, and ask them to check back about a week before check-in. Do NOT say you are checking with the cleaning team.",
  late_checkin: "No coordination needed for a late check-in. Check-in is self-service and leaving early needs nothing arranged, so nobody has been notified and nothing needs approving. Tell the guest that is completely fine and they can arrive or leave whenever suits them. Do NOT say you are checking with anyone.",
  early_checkout: "No coordination needed for an early checkout. Check-in is self-service and leaving early needs nothing arranged, so nobody has been notified and nothing needs approving. Tell the guest that is completely fine and they can arrive or leave whenever suits them. Do NOT say you are checking with anyone.",
};
const KB_FIREWOOD = "Yes — firewood is available for sale on-site for use at the shared outdoor fire pit. $10 per bundle, on the rack near the hot tub.";
const KB_NONE = "NO_ANSWER_FOUND\nREQUIRES_MAINTENANCE: false\nReason: nothing in the knowledge base covers this.";

const CASES = [
  { name: "Late arrival (10pm)", prop: "Unit 5", guest: "Sana",
    msg: "We're running behind and won't get there until about 10pm. Is that alright?",
    note: "v1 has no late_checkin case, so it forces this into late_checkout and texts the cleaners.",
    stub: (v, t) => v === "v1" ? V1_E : V2_E.late_checkin },
  { name: "Early check-in, 41 days out", prop: "Johnson Dome", guest: "Uma",
    msg: "We're booked in for the middle of October. Could we get an early check-in that day?",
    note: "v1 texts the cleaners six weeks early. v2 asks them to check back.",
    stub: (v) => v === "v1" ? V1_E : V2_E.early_checkin_far },
  { name: "Firewood", prop: "Unit 1", guest: "Johna",
    msg: "Could we get 3 bundles of firewood for the fire pit tonight?",
    note: "v1 treats it as an extra request. v2 answers from the KB.",
    stub: () => KB_FIREWOOD },
  { name: "Cigarette smell (pure feedback)", prop: "Unit 1", guest: "Mike",
    msg: "Thanks, things are great so far. I would just like to mention that the house had a smell of cigarette smoke. Not ideal, but tolerable for us. I mostly wanted to mention so you are aware that the condition existed before us.",
    note: "v1 sends this to the KB, gets nothing, and goes silent with a 2h property cooldown.",
    stub: () => KB_NONE },
  { name: "Non-English name, English message", prop: "A-Frame", guest: "rothanak",
    msg: "Thanks Tyler super excited for our upcoming stay !",
    note: "The 1 Sep incident. v1 is told to 'detect' the language with the name in the prompt.",
    stub: () => KB_NONE },
  { name: "Repeat ask on a pending early check-in", prop: "Johnson Dome", guest: "Ravi",
    msg: "Do we have any updates about the 4 o'clock check-in?",
    history: [["Guest","Could we check in at 4 instead of 5?"],
              ["Host","Not a problem. I'm going to check with our cleaning team to see if it's possible and let you know."]],
    note: "v1 is instructed to ALWAYS repeat the canned sentence. This is the Victoria case.",
    stub: () => V1_E },
];

const anthropic = new Anthropic();

async function run(variant, c) {
  const prompt = fill(variant === "v1" ? V1_PROMPT : V2_PROMPT,
    { "property.name": c.prop, guestName: c.guest });
  const tools = variant === "v1" ? LEGACY_TOOLS : TOOLS;
  const hist = (c.history ?? []).map(([r,t]) => `${r}: ${t}`).join("\n") || "(no earlier messages)";
  const messages = [{ role: "user", content: `Here is the conversation so far:\n\n${hist}\n\nThe guest's latest message is:\n"${c.msg}"` }];

  const res = await anthropic.messages.create({ model:"claude-sonnet-4-6", max_tokens:1024, system:prompt, tools, messages });
  const tb = res.content.filter(b => b.type === "tool_use");
  let text = (res.content.find(b => b.type === "text")?.text ?? "").trim();
  const called = tb.map(b => `${b.name}${b.input?.request_type ? `(${b.input.request_type})` : ""}`);

  if (tb.length && !tb.some(b => b.name === "escalate_to_human")) {
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: tb.map(b => ({ type:"tool_result", tool_use_id:b.id, content: c.stub(variant, b.name) })) });
    const f = await anthropic.messages.create({ model:"claude-sonnet-4-6", max_tokens:1024, system:prompt, tools, messages });
    text = (f.content.find(b => b.type === "text")?.text ?? "").trim();
  }
  return { called, text };
}

const wrap = (s, w = 74) => {
  const out = [];
  for (const para of (s || "(no reply — guest gets silence)").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      if ((line + " " + word).trim().length > w) { out.push(line.trim()); line = word; }
      else line += " " + word;
    }
    if (line.trim()) out.push(line.trim());
  }
  return out;
};

console.log("\n" + "═".repeat(80));
console.log("  v1 (live today)  vs  v2 (rework)   — same message, both agents");
console.log("  No Trigger.dev · No Turno · No SMS · No Hospitable · No Supabase writes");
console.log("═".repeat(80));

for (const c of CASES) {
  console.log(`\n\n### ${c.name}   [${c.prop}]`);
  console.log(`Guest: "${c.msg.length > 150 ? c.msg.slice(0,150) + "…" : c.msg}"`);
  console.log(`Note:  ${c.note}\n`);
  for (const v of ["v1", "v2"]) {
    const { called, text } = await run(v, c);
    console.log(`  ${v === "v1" ? "── v1 ─ LIVE TODAY " : "── v2 ─ REWORK    "}${"─".repeat(56)}`);
    console.log(`     tool:  ${called.length ? called.join(", ") : "(none)"}`);
    for (const l of wrap(text)) console.log(`     ${l}`);
    console.log();
  }
}
console.log("═".repeat(80) + "\n");
