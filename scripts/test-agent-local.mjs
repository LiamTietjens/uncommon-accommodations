/**
 * Local harness for the coordinator prompt. Talks to the Anthropic API directly —
 * Trigger.dev is never involved, nothing is deployed, and no guest is ever messaged.
 *
 *   node scripts/test-agent-local.mjs            # all scenarios
 *   node scripts/test-agent-local.mjs firewood   # filter by name
 *
 * The prompt and tool definitions are parsed out of src/trigger/main-agent.ts at
 * runtime rather than copied here, so this can never drift from what actually ships.
 */

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const SRC = "src/trigger/main-agent.ts";
const src = readFileSync(SRC, "utf8");

// ── Pull the live TOOLS array and system prompt out of the source ────────────

function extractTools(source) {
  const start = source.indexOf("const TOOLS: Anthropic.Tool[] = [");
  if (start === -1) throw new Error("Could not find TOOLS in " + SRC);
  // Skip past the "[]" in the `Anthropic.Tool[]` type annotation — the array
  // literal starts at the "= [", not at the first bracket after `start`.
  const open = source.indexOf("= [", start) + 2;
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  const literal = source.slice(open, end + 1).replace(/ as const/g, "");
  return eval(`(${literal})`);
}

function extractPrompt(source, vars) {
  const m = source.match(/const systemPrompt = `([\s\S]*?)`;\n/);
  if (!m) throw new Error("Could not find systemPrompt in " + SRC);
  return m[1].replace(/\$\{([^}]+)\}/g, (full, expr) => {
    if (expr in vars) return vars[expr];
    throw new Error(`Prompt references \${${expr}} which the harness does not supply`);
  });
}

const TOOLS = extractTools(src);
if (!TOOLS.length) throw new Error("Extracted 0 tools — the parser is broken, not the prompt");
const toolNames = TOOLS.map((t) => t.name);
const checkinEnum =
  TOOLS.find((t) => t.name === "handle_checkin_checkout")?.input_schema
    ?.properties?.request_type?.enum ?? [];

// ── Scenarios ───────────────────────────────────────────────────────────────
// `history` is the prior thread. `message` is the guest's latest.
// `expect` returns null on pass, or a string explaining the failure.

const scenarios = [
  {
    name: "firewood",
    why: "Tyler, 26 Aug — must answer from the KB, not raise an extra request",
    guestName: "Marcus",
    locale: "en-US",
    history: [
      ["Guest", "Hi! Is there firewood available for the fire pit?"],
      ["Host", "Yes, firewood is available for sale on site at $10 per bundle, on the rack by the hot tub."],
    ],
    message: "Yes, could we please get a bundle of firewood that would be great.",
    expect: ({ tools }) =>
      tools.includes("process_extra_request")
        ? "called process_extra_request — should answer from the KB instead"
        : null,
  },
  {
    name: "language-name",
    why: "1 Sep incident — English message, non-English guest name, must reply in English",
    guestName: "rothanak",
    locale: "en-US",
    history: [],
    message: "Thanks Tyler super excited for our upcoming stay !",
    expect: ({ text }) => {
      if (!text) return "no text reply produced";
      // Crude but effective: flag obvious non-English function words.
      const foreign = /\b(bonjour|merci|votre|nous|vous|c'est|séjour|bienvenue|hola|gracias|willkommen|freue)\b/i;
      return foreign.test(text) ? `replied in a non-English language: "${text.slice(0, 90)}"` : null;
    },
  },
  {
    name: "late-checkin",
    why: "Tyler, 13 Aug — self-service, must NOT be treated as a late checkout",
    guestName: "Priya",
    locale: "en",
    history: [],
    message: "Hey, we're running behind and won't get there until about 10pm. Is that alright?",
    expect: ({ tools, inputs }) => {
      if (!tools.includes("handle_checkin_checkout")) return `called ${tools.join(",") || "no tool"}`;
      const t = inputs.handle_checkin_checkout?.request_type;
      return t === "late_checkin" ? null : `request_type was "${t}", expected late_checkin`;
    },
  },
  {
    name: "early-checkout",
    why: "Tyler, 26 Aug — needs no coordination",
    guestName: "Dan",
    locale: "en",
    history: [],
    message: "We're planning to head off early Sunday, probably around 7am rather than 11. That ok?",
    expect: ({ tools, inputs }) => {
      if (!tools.includes("handle_checkin_checkout")) return `called ${tools.join(",") || "no tool"}`;
      const t = inputs.handle_checkin_checkout?.request_type;
      return t === "early_checkout" ? null : `request_type was "${t}", expected early_checkout`;
    },
  },
  {
    name: "early-checkin",
    why: "The coordinated case — tool decides the 7-day branch, prompt just routes",
    guestName: "Sarah",
    locale: "en",
    history: [],
    message: "Would it be possible to check in a couple of hours early, around 1pm?",
    expect: ({ tools, inputs }) => {
      if (!tools.includes("handle_checkin_checkout")) return `called ${tools.join(",") || "no tool"}`;
      const t = inputs.handle_checkin_checkout?.request_type;
      return t === "early_checkin" ? null : `request_type was "${t}", expected early_checkin`;
    },
  },
  {
    name: "date-change",
    why: "1 Sep — date changes must escalate, never be auto-handled",
    guestName: "Elena",
    locale: "en",
    history: [],
    message: "Could we move our booking to the following weekend instead?",
    expect: ({ tools }) =>
      tools.includes("escalate_to_human")
        ? null
        : `called ${tools.join(",") || "no tool"} — expected escalate_to_human`,
  },
  {
    name: "already-raised",
    why: "Your rule — must not silently re-raise, must not promise to chase",
    guestName: "Tom",
    locale: "en",
    history: [
      ["Guest", "Could we get a couple of extra towels?"],
      ["Host", "Of course — so that's 2 extra towels, is that right?"],
      ["Guest", "Yes please"],
      ["Host", "I've already put that request in and the team will take care of it."],
    ],
    message: "Hey, any update on those towels?",
    expect: ({ text, tools }) => {
      const problems = [];
      if (tools.includes("process_extra_request")) problems.push("re-raised the request silently");
      if (text && /\b(chase|follow(ing)? up|check on it|get someone (back )?out|send someone)\b/i.test(text))
        problems.push(`promised to chase: "${text.slice(0, 90)}"`);
      return problems.length ? problems.join("; ") : null;
    },
  },
  {
    name: "persona",
    why: "Tyler, 26 Aug — first person, never 'I'll let Tyler know'",
    guestName: "Jared",
    locale: "en",
    history: [],
    message: "Thanks so much, can't wait!",
    expect: ({ text }) => {
      if (!text) return "no text reply produced";
      return /\b(let|tell|ask|check with|pass (this|that|it) (on )?to)\s+Tyler\b/i.test(text)
        ? `referred to Tyler in the third person: "${text.slice(0, 90)}"`
        : null;
    },
  },
];

// ── Runner ──────────────────────────────────────────────────────────────────

const anthropic = new Anthropic();
const filter = process.argv[2];
const selected = filter ? scenarios.filter((s) => s.name.includes(filter)) : scenarios;

console.log(`\nCoordinator prompt — local test (no Trigger.dev, no guest messaged)`);
console.log(`Tools found in source: ${toolNames.join(", ")}`);
console.log(`handle_checkin_checkout cases: ${checkinEnum.join(", ")}\n`);

let passed = 0;
const failures = [];

for (const s of selected) {
  const systemPrompt = extractPrompt(src, {
    "property.name": "Unit 5",
    guestName: s.guestName,
    guestLocale: s.locale,
  });

  const historyText = s.history.map(([r, c]) => `${r}: ${c}`).join("\n") || "(no earlier messages)";

  const res = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    tools: TOOLS,
    messages: [
      {
        role: "user",
        content: `Here is the conversation so far:\n\n${historyText}\n\nThe guest's latest message is:\n"${s.message}"`,
      },
    ],
  });

  const tools = res.content.filter((b) => b.type === "tool_use").map((b) => b.name);
  const inputs = Object.fromEntries(
    res.content.filter((b) => b.type === "tool_use").map((b) => [b.name, b.input])
  );
  const textBlock = res.content.find((b) => b.type === "text");
  const text = textBlock?.text?.trim() ?? "";

  // Universal checks — these apply to every guest-facing reply, whatever the
  // scenario. The reasoning leak is the one incident Tyler escalated hardest on.
  const universal = [];
  if (text) {
    if (new RegExp(`\\b${s.guestName}\\b[^.?!]*\\b(needs|wants|is asking|just needs|should|has)\\b`, "i").test(text))
      universal.push(`talks about the guest in the third person: "${text.slice(0, 90)}"`);
    if (/\b(I'll (send|write|compose|reply with)|no questions or requests to handle|let me (compose|craft)|internal note)\b/i.test(text))
      universal.push(`internal reasoning leaked into the reply: "${text.slice(0, 90)}"`);
    if (/\[Calling \w+/i.test(text))
      universal.push(`narrated a tool call in the reply text: "${text.slice(0, 90)}"`);
  }

  const problem = [s.expect({ tools, inputs, text }), ...universal].filter(Boolean).join("; ") || null;
  const label = problem ? "FAIL" : "pass";
  console.log(`[${label}] ${s.name}`);
  console.log(`       ${s.why}`);
  console.log(`       tool: ${tools.join(", ") || "(none — replied directly)"}`);
  if (Object.keys(inputs).length) console.log(`       input: ${JSON.stringify(Object.values(inputs)[0])}`);
  if (text) console.log(`       reply: ${text.replace(/\s+/g, " ").slice(0, 150)}`);
  if (problem) {
    console.log(`       >>> ${problem}`);
    failures.push(`${s.name}: ${problem}`);
  } else passed++;
  console.log();
}

console.log(`${passed}/${selected.length} passed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
