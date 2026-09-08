/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  REAL-WORLD SIMULATION — 34 scenarios
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Guest messages are taken from what guests have ACTUALLY sent, pulled from
 *  kb_gap_log, maintenance_tickets and extra_requests in Supabase. KB stubs are
 *  the REAL knowledge_bases content for that property. Names are shortened.
 *
 *  Run:  npm run test:real            (all)
 *        npm run test:real -- checkin (one category)
 *
 * ─── SAFETY ────────────────────────────────────────────────────────────────
 *  1. Only imports: node:fs and @anthropic-ai/sdk. Nothing from src/lib.
 *  2. Tool HANDLERS ARE NEVER CALLED. Results are hardcoded strings below.
 *     No Turno project. No SMS. No Hospitable message. No Supabase write.
 *  3. Refuses to start if any non-Anthropic credential is in the environment.
 *  4. Only outbound call is api.anthropic.com.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const SRC = "src/trigger/main-agent.ts";
const src = readFileSync(SRC, "utf8");

function assertSafeEnv() {
  const bad = ["TURNO_API_KEY","TURNO_PARTNER_ID","TELNYX_API_KEY","SMSAPI_TOKEN",
    "HOSPITABLE_API_TOKEN","SUPABASE_SERVICE_ROLE_KEY","TRIGGER_SECRET_KEY"].filter(k => process.env[k]);
  if (bad.length) {
    console.error(`\nREFUSING TO RUN — live credentials present:\n  ${bad.join("\n  ")}\n\n` +
      `Re-run with only ANTHROPIC_API_KEY:\n  env -i PATH="$PATH" HOME="$HOME" ANTHROPIC_API_KEY="sk-..." node ${process.argv[1]}\n`);
    process.exit(2);
  }
  if (!process.env.ANTHROPIC_API_KEY) { console.error("\nANTHROPIC_API_KEY not set.\n"); process.exit(2); }
}

function extractTools(source) {
  const start = source.indexOf("const TOOLS: Anthropic.Tool[] = [");
  const open = source.indexOf("= [", start) + 2;
  let depth = 0, end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]" && --depth === 0) { end = i; break; }
  }
  const t = eval(`(${source.slice(open, end + 1).replace(/ as const/g, "")})`);
  if (!t.length) throw new Error("Extracted 0 tools — parser broken");
  return t;
}
function extractPrompt(source, vars) {
  const m = source.match(/const systemPrompt = `([\s\S]*?)`;\n/);
  return m[1].replace(/\$\{([^}]+)\}/g, (_, e) => {
    if (e in vars) return vars[e];
    throw new Error(`Prompt wants \${${e}}, harness does not supply it`);
  });
}
const TOOLS = extractTools(src);

// ─── REAL knowledge base content (verbatim from Supabase) ───────────────────
const KB = {
  none: "NO_ANSWER_FOUND\nREQUIRES_MAINTENANCE: false\nReason: nothing in the knowledge base covers this.",
  noneMaint: "NO_ANSWER_FOUND — No troubleshooting info in the knowledge base for this issue. This appears to require maintenance.",
  wifi: "📶 Network: Uncommon Accommodations ext\n🔑 Password: Riverside\n\nWe use Starlink high-speed internet, so it should be fast and reliable throughout your stay.",
  wifiWeak: "Try resetting the Amazon Eero device on the fridge by unplugging it and re-plugging it",
  coffee: "Drip coffee maker with reusable filter. We provide ground coffee and sugar.",
  kitchenetteDome: "The geodome has a kitchenette with a coffee maker, microwave, and mini fridge — great for preparing simple meals and snacks. Please note this is not a full kitchen, so we'd recommend planning accordingly if you're thinking about cooking larger meals.",
  petsCambridge: "Yes, pets are welcome! We love that you want to bring your furry family members along on your Vermont adventure. Please be considerate of the peaceful setting and clean up after your pets, especially in the outdoor spaces and along the riverfront.",
  tvUnit2: "Yes! There's a TV in the tiny house, and with the high-speed Starlink WiFi, streaming your favorite shows is a breeze. We also have board games available if you feel like unplugging.",
  checkoutDome: "Before checkout, we ask that you:\n\n• Turn off lights and fireplaces\n• Leave heat ON in colder months\n• Lock the door\n• Place used towels in the bathroom\n• Start the dishwasher if you used it\n\nNo need to strip beds or take out garbage — we'll take care of that.",
  parkingDome: "Yes, free on-site parking is included with your stay — no need to worry about finding a spot! Just pull right onto the property. We also have an EV charger available on-site.",
  times: "Check-in is at 5:00 PM and check-out is at 10:00 AM. We're occasionally able to accommodate early check-in or late check-out depending on the schedule, but we're not able to guarantee it.",
  firewood: "Yes — firewood is available for sale on-site for use at the shared outdoor fire pit. $10 per bundle, on the rack near the hot tub.",
  towels: "We provide two sets of towels per guest in the unit",
};

// ─── Tool result stubs (mirror the real return strings) ─────────────────────
const STUBS = {
  use_knowledge_base: KB.none,
  raise_maintenance_ticket: "Maintenance ticket created. Urgency: medium. SMS sent to 2 recipient(s).",
  process_extra_request: "[SIMULATED] Approved. Task created for the cleaning team.",
  handle_checkin_checkout: 'Request forwarded to cleaning team (2 notified). Tell the guest: "Not a problem. I\'m going to check with our cleaning team to see if it\'s possible and let you know."',
};
// The three real subWorkflowE return strings, verbatim in shape.
const E = {
  coordinate: 'Request forwarded to cleaning team (2 notified). Tell the guest: "Not a problem. I\'m going to check with our cleaning team to see if it\'s possible and let you know."',
  tooEarly: "Too early to answer — check-in is 41 days away and availability is not known until closer to the stay. Nobody has been notified and no request has been raised. Tell the guest we are happy to try to accommodate it but will not know until nearer the time, and ask them to check back about a week before check-in. Do NOT say you are checking with the cleaning team.",
  noCoordIn: "No coordination needed for a late check-in. Check-in is self-service and leaving early needs nothing arranged, so nobody has been notified and nothing needs approving. Tell the guest that is completely fine and they can arrive or leave whenever suits them. Do NOT say you are checking with anyone.",
  noCoordOut: "No coordination needed for an early checkout. Check-in is self-service and leaving early needs nothing arranged, so nobody has been notified and nothing needs approving. Tell the guest that is completely fine and they can arrive or leave whenever suits them. Do NOT say you are checking with anyone.",
};

const has = (t, n) => t.includes(n);
const none = (t) => t.length === 0;
const checkinType = (i) => i.handle_checkin_checkout?.request_type;

// ═══ SCENARIOS ══════════════════════════════════════════════════════════════

const scenarios = [

// ─── KB: real questions guests actually sent ────────────────────────────────
{ cat:"kb", name:"coffee-pot-type", prop:"Boho Tent", guest:"Renee",
  msg:"Is the coffee pot a regular style drip coffee pot or a keurig style?",
  want:"KB lookup → 'drip with reusable filter'.", stub:{use_knowledge_base:KB.coffee},
  expect:({tools,finalText}) => !has(tools,"use_knowledge_base") ? `called ${tools.join(",")||"nothing"}`
    : /drip/i.test(finalText) ? null : "did not relay the drip answer" },

{ cat:"kb", name:"paring-knife", prop:"Johnson Dome", guest:"Alicia",
  msg:"I do have one stupid question. I know the listing says there's a kitchenette, but is there like silverware like a pairing knife or something? I brought a lot of fresh fruit and veg to snack on but I don't have a knife to cut them.",
  want:"KB kitchenette entry. Must NOT invent a knife that isn't listed.", stub:{use_knowledge_base:KB.kitchenetteDome},
  expect:({tools,finalText}) => !has(tools,"use_knowledge_base") ? `called ${tools.join(",")||"nothing"}`
    : /\b(yes,? there (is|are) (a )?(paring |pairing )?knif|knives are provided)\b/i.test(finalText)
      ? "claimed a knife is provided — the KB does not say that" : null },

{ cat:"kb", name:"dogs-backyard", prop:"Cambridge House", guest:"Priya",
  msg:"Is the backyard completely private? Just trying to anticipate what I need to bring for our dogs as well and if they'll be free to roam. Many thanks in advance!!",
  want:"KB pets entry. Must not guarantee a fenced/private yard that isn't documented.", stub:{use_knowledge_base:KB.petsCambridge},
  expect:({tools,finalText}) => !has(tools,"use_knowledge_base") ? `called ${tools.join(",")||"nothing"}`
    : /\b(fully fenced|completely private|yes,? (it'?s|the yard is) (fully )?(fenced|private))\b/i.test(finalText)
      ? "asserted a private/fenced yard the KB never mentions" : null },

{ cat:"kb", name:"tv-activation", prop:"Unit 2", guest:"Dana",
  msg:"Quick question. We are here and loving the property! We were just trying to watch the TV and it is saying the TV needs to be activated. Is there anything we are supposed to do to watch it?",
  want:"KB first. TV entry has no activation steps → should not invent a procedure.", stub:{use_knowledge_base:KB.tvUnit2},
  expect:({tools}) => has(tools,"use_knowledge_base") ? null : `called ${tools.join(",")||"nothing"}` },

{ cat:"kb", name:"wifi-password", prop:"Johnson Dome", guest:"Marc",
  msg:"Hi! What's the wifi network and password?",
  want:"KB → network + password relayed.", stub:{use_knowledge_base:KB.wifi},
  expect:({tools,finalText}) => !has(tools,"use_knowledge_base") ? `called ${tools.join(",")||"nothing"}`
    : /Riverside/i.test(finalText) ? null : "did not relay the password" },

{ cat:"kb", name:"parking-ev", prop:"Johnson Dome", guest:"Sofia",
  msg:"Is there parking on site? We're driving an EV so wondering about charging too.",
  want:"KB covers both parking and the EV charger.", stub:{use_knowledge_base:KB.parkingDome},
  expect:({tools,finalText}) => !has(tools,"use_knowledge_base") ? `called ${tools.join(",")||"nothing"}`
    : /\bEV\b|charger/i.test(finalText) ? null : "missed the EV charger the KB mentions" },

{ cat:"kb", name:"checkout-dome-dishwasher", prop:"Johnson Dome", guest:"Tara",
  msg:"What do we need to do before we head off tomorrow?",
  want:"DATA CHECK: the Dome's KB checkout entry still says 'start the dishwasher' but the Dome has only a kitchenette. Flags a live KB bug, not a prompt bug.",
  stub:{use_knowledge_base:KB.checkoutDome},
  expect:({finalText}) => /dishwasher/i.test(finalText)
    ? "relayed 'start the dishwasher' to a unit with no dishwasher (KB DATA BUG — Tyler's 13 Aug issue, still live on Johnson Dome)" : null },

{ cat:"kb", name:"which-tent-is-ours", prop:"Boho Tent", guest:"Ken",
  msg:"Hello. We only see one tent down here. Is it ours?",
  want:"Nothing in KB. Must not guess. Escalation/silence is correct.", stub:{use_knowledge_base:KB.none},
  expect:({finalText}) => /\b(yes,? that'?s (yours|it)|that is your tent)\b/i.test(finalText||"")
    ? "confirmed the tent was theirs with no KB basis" : null },

// ─── MAINTENANCE: real reported faults ──────────────────────────────────────
{ cat:"maintenance", name:"string-lights", prop:"Johnson Dome", guest:"Adele",
  msg:"Yeah it's the string lights that go from tree to tree. I flipped the switch but nothing happened. Doesn't have a big impact on our stay, just thought you should know.",
  want:"Low urgency fault. KB first then confirm → ticket. Should not be dismissed as pure feedback.", stub:{use_knowledge_base:KB.none},
  expect:({tools,text,finalText}) => tools.length || /\b(confirm|maintenance|get (someone|the team)|look at)\b/i.test(`${text} ${finalText}`)
    ? null : "took no action on a reported fault" },

{ cat:"maintenance", name:"tent-lights-out", prop:"Boho Tent", guest:"Jonas",
  msg:"We were using a griddle and the lights went out. There's still power to the tent but no lights. We've tried unplugging things, checked all the switches and any reset we could find. Nothing.",
  want:"Guest has exhausted troubleshooting → confirm then ticket. High urgency, late at night.", stub:{use_knowledge_base:KB.noneMaint},
  expect:({tools,text,finalText}) => has(tools,"raise_maintenance_ticket") ||
    /\b(confirm|get (our|the|my|someone)|maintenance|before I get)\b/i.test(`${text} ${finalText}`)
    ? null : `called ${tools.join(",")||"nothing"} and did not move toward a ticket` },

{ cat:"maintenance", name:"shower-temperature", prop:"Unit 4", guest:"Kevin",
  msg:"The shower handle is only giving us extreme hot or extreme cold. Anywhere in the middle and there's no warm water at all.",
  want:"Real fault, KB has nothing → confirm then ticket.", stub:{use_knowledge_base:KB.none},
  expect:({tools,text,finalText}) => tools.length || /\b(confirm|maintenance)\b/i.test(`${text} ${finalText}`)
    ? null : "took no action" },

{ cat:"maintenance", name:"eero-red-light", prop:"Unit 3", guest:"Meleene",
  msg:"The wifi stopped working last night. The Eero was unplugged so I plugged it back in, but it keeps showing a red light even after resetting it 3 times.",
  want:"KB has the reset tip but guest already did it 3x → should escalate to a ticket, not repeat the tip.",
  stub:{use_knowledge_base:KB.wifiWeak},
  expect:({tools,finalText}) => {
    if (has(tools,"raise_maintenance_ticket")) return null;
    return /\b(unplug(ging)? (it|the eero)|re-?plug|try resetting)\b/i.test(finalText||"")
      ? "repeated the reset instruction the guest already tried three times" : null; } },

{ cat:"maintenance", name:"fridge-leaking", prop:"Unit 2", guest:"Owen",
  msg:"The fridge is leaking water onto the floor.",
  want:"Clear fault → confirm then ticket.", stub:{use_knowledge_base:KB.none},
  expect:({tools,text,finalText}) => tools.length || /\b(confirm|maintenance)\b/i.test(`${text} ${finalText}`)
    ? null : "took no action" },

{ cat:"maintenance", name:"sauna-stairs-safety", prop:"Johnson Dome", guest:"Alicia",
  msg:"Just flagging that there are some loose boards on the stairs up to the treehouse sauna. No rush on my end, just wanted you to know it might be a safety thing.",
  want:"Safety issue. Even though phrased casually it must NOT be swallowed as pure feedback.", stub:{use_knowledge_base:KB.none},
  expect:({tools,text,finalText}) => tools.length || /\b(confirm|maintenance|safety|look at|get (someone|the team))\b/i.test(`${text} ${finalText}`)
    ? null : "treated a safety hazard as passing feedback and took no action" },

{ cat:"maintenance", name:"tent-collapsed-followup", prop:"Boho Tent", guest:"Amylyn",
  msg:"We first mentioned this when we checked in and it still hasn't been looked at. The front of the tent by the riverside door has partly collapsed, it's hard to open, and the screen on that door is missing.",
  want:"Repeat, unaddressed fault. Must acknowledge the delay and act, not restate the first reply.", stub:{use_knowledge_base:KB.none},
  expect:({tools,text,finalText}) => {
    const t = `${text} ${finalText}`;
    if (!tools.length && !/\b(confirm|maintenance|sorry|apolog)\b/i.test(t)) return "no action and no acknowledgement on a repeat report";
    return /\b(chase (it|this) up|follow(ing)? up on it|check on (its|the) (status|progress))\b/i.test(t)
      ? "promised to chase something it cannot chase" : null; } },

// ─── EXTRAS: real requests ──────────────────────────────────────────────────
{ cat:"extras", name:"extra-blanket", prop:"Unit 6 - Cabin", guest:"Ruth",
  msg:"Could we get one extra blanket? It's colder than we expected tonight.",
  want:"Allowed extra → must CONFIRM first, not raise immediately.",
  expect:({tools,text}) => has(tools,"process_extra_request") ? "raised without confirming"
    : /\?/.test(text||"") ? null : "did not ask a confirming question" },

{ cat:"extras", name:"detergent-confirmed", prop:"A-Frame", guest:"Lory",
  msg:"Yes please, that's right — detergent for one wash would be great.",
  history:[["Guest","Is there laundry detergent in the unit? I can't find any."],
           ["Host","Let me get some sent over — just to confirm, you'd like laundry detergent for a wash, is that right?"]],
  want:"Explicit confirmation → call process_extra_request now.",
  expect:({tools}) => has(tools,"process_extra_request") ? null : `called ${tools.join(",")||"nothing"} after a clear confirmation` },

{ cat:"extras", name:"towels-request", prop:"Unit 2", guest:"Chris",
  msg:"Could we please get 2 extra towels?",
  want:"Allowed extra → confirm first.",
  expect:({tools,text}) => has(tools,"process_extra_request") ? "raised without confirming"
    : /\?/.test(text||"") ? null : "did not ask a confirming question" },

{ cat:"extras", name:"firewood-real", prop:"Unit 1", guest:"Johna",
  msg:"Could we get 3 bundles of firewood for the fire pit tonight?",
  want:"REGRESSION: self-serve, priced item → KB answer, never an extra request.", stub:{use_knowledge_base:KB.firewood},
  expect:({tools,finalText}) => has(tools,"process_extra_request") ? "raised an extra request for a self-serve item"
    : /\$?10|rack|hot tub|on.?site/i.test(finalText||"") ? null : "did not tell them where to get it" },

// ─── CHECK-IN / CHECKOUT: every case, both sides of the 7-day window ────────
{ cat:"checkin", name:"early-checkin-INSIDE-window", prop:"Cambridge House", guest:"Beth",
  msg:"Hi Tyler! Any chance we could check in at 3pm this Friday instead of 5?",
  want:"early_checkin, inside 7 days → coordinate, cleaners notified, 'checking with the team'.",
  stub:{handle_checkin_checkout:E.coordinate},
  expect:({tools,inputs,finalText}) => {
    if (checkinType(inputs) !== "early_checkin") return `request_type=${checkinType(inputs)||"none"}`;
    return /\b(check(ing)? with|cleaning team|let you know)\b/i.test(finalText||"") ? null
      : "did not tell the guest it is being checked with the team"; } },

{ cat:"checkin", name:"early-checkin-OUTSIDE-window", prop:"Johnson Dome", guest:"Uma",
  msg:"We're booked in for the middle of October. Could we get an early check-in that day?",
  want:"NEW 7-DAY RULE. 41 days out → must NOT claim the cleaners were asked. Must say check back closer.",
  stub:{handle_checkin_checkout:E.tooEarly},
  expect:({inputs,finalText}) => {
    if (checkinType(inputs) !== "early_checkin") return `request_type=${checkinType(inputs)||"none"}`;
    const t = finalText||"";
    if (/\b(cleaning team|checking with (the|our)|I'?ll let you know once I hear)\b/i.test(t))
      return "claimed the cleaners were asked when nobody was notified";
    return /\b(closer|nearer|week before|check back|closer to)\b/i.test(t) ? null
      : "did not tell the guest to check back closer to the stay"; } },

{ cat:"checkin", name:"late-checkout-INSIDE-window", prop:"Boho Tent", guest:"Amylyn",
  msg:"We had asked about a noon checkout on Wednesday — it's my husband's birthday and we rarely get away. Would that be possible?",
  want:"late_checkout, inside window → coordinate.",
  stub:{handle_checkin_checkout:E.coordinate},
  expect:({inputs}) => checkinType(inputs)==="late_checkout" ? null : `request_type=${checkinType(inputs)||"none"}` },

{ cat:"checkin", name:"late-checkout-OUTSIDE-window", prop:"A-Frame", guest:"Nadia",
  msg:"We're coming in November — is a late checkout something we could arrange for the last day?",
  want:"7-DAY RULE on the late-checkout side. Must not promise, must say check back closer.",
  stub:{handle_checkin_checkout:E.tooEarly},
  expect:({inputs,finalText}) => {
    if (checkinType(inputs) !== "late_checkout") return `request_type=${checkinType(inputs)||"none"}`;
    const t = finalText||"";
    if (/\b(cleaning team|checking with (the|our))\b/i.test(t)) return "claimed the cleaners were asked when nobody was notified";
    return /\b(closer|nearer|week before|check back)\b/i.test(t) ? null : "did not tell the guest to check back closer"; } },

{ cat:"checkin", name:"late-checkin", prop:"Unit 5", guest:"Sana",
  msg:"We're running behind and won't get there until about 10pm. Is that alright?",
  want:"late_checkin → self-service, NO cleaner contact promised.",
  stub:{handle_checkin_checkout:E.noCoordIn},
  expect:({inputs,finalText}) => {
    if (checkinType(inputs) !== "late_checkin") return `request_type=${checkinType(inputs)||"none"}, expected late_checkin`;
    return /\b(cleaning team|check with|let you know once)\b/i.test(finalText||"")
      ? "promised to check with someone about a self-service arrival" : null; } },

{ cat:"checkin", name:"early-checkout", prop:"A-Frame", guest:"Lory",
  msg:"We're going to head off early on Sunday, probably around 7am instead of 10. Is that ok?",
  want:"early_checkout → nothing to arrange.",
  stub:{handle_checkin_checkout:E.noCoordOut},
  expect:({inputs,finalText}) => {
    if (checkinType(inputs) !== "early_checkout") return `request_type=${checkinType(inputs)||"none"}, expected early_checkout`;
    return /\b(cleaning team|check with)\b/i.test(finalText||"") ? "promised to check with someone" : null; } },

{ cat:"checkin", name:"followup-pending", prop:"Johnson Dome", guest:"Ravi",
  msg:"Do we have any updates about the 4 o'clock check-in?",
  history:[["Guest","Could we check in at 4 instead of 5?"],
           ["Host","Not a problem. I'm going to check with our cleaning team to see if it's possible and let you know."]],
  want:"REGRESSION (Victoria). Real message. Must NOT repeat the canned sentence verbatim.",
  stub:{handle_checkin_checkout:E.coordinate},
  expect:({finalText}) => /I'?m going to check with our cleaning team to see if it'?s possible and let you know/i.test(finalText||"")
    ? "repeated the canned sentence word for word" : null },

{ cat:"checkin", name:"arrived-early-not-a-request", prop:"Boho Tent", guest:"Elle",
  msg:"We're running ahead of schedule and just arrived — I realise it's 38 minutes before check-in time. We understand check-in isn't until five. Is it OK if we just scope out the area and check out the river?",
  want:"They are NOT asking to enter early. Should just say yes, not fire an early check-in escalation.",
  stub:{handle_checkin_checkout:E.coordinate},
  expect:({tools,finalText}) => has(tools,"handle_checkin_checkout")
    ? "escalated an early check-in for a guest who only asked to walk around the grounds"
    : /\b(of course|absolutely|sure|no problem|feel free|go ahead)\b/i.test(finalText||"") ? null : "did not simply say yes" },

{ cat:"checkin", name:"date-change-not-checkin", prop:"Unit 3", guest:"Chris",
  msg:"I was wondering if it's possible to move my reservation for one night to Friday October 2nd? I noticed it's a check-out only date in the calendar but figured I'd ask.",
  want:"DATE change, not a time change → escalate_to_human, never the check-in tool.",
  expect:({tools}) => has(tools,"handle_checkin_checkout") ? "treated a date change as a check-in time change"
    : has(tools,"escalate_to_human") ? null : `called ${tools.join(",")||"nothing"}` },

// ─── ESCALATION: real situations ────────────────────────────────────────────
{ cat:"escalate", name:"cancellation-illness", prop:"A-Frame", guest:"Dana",
  msg:"Hello Tyler, unfortunately we are going to be unable to make it there this weekend. My husband is really sick and unable to travel. I understand there are no refunds.",
  want:"Cancellation → escalate. Must not offer or refuse a refund itself.",
  expect:({tools,finalText}) => {
    if (has(tools,"escalate_to_human")) return null;
    return /\b(refund|I can'?t refund|no refunds are)\b/i.test(finalText||"") ? "made a refund decision on its own" : `called ${tools.join(",")||"nothing"}`; } },

{ cat:"escalate", name:"deposit-extension", prop:"Johnson Dome", guest:"Kim",
  msg:"We had something come up so we can't come the first weekend in November. Can I please have until Monday to pay the deposit for the new dates? We will 100% be coming the new dates chosen.",
  want:"Payment terms + date change → escalate. Must not grant an extension.",
  expect:({tools,finalText}) => has(tools,"escalate_to_human") ? null
    : /\b(that'?s fine|no problem,? you can have|I'?ve extended)\b/i.test(finalText||"") ? "granted a payment extension on its own"
    : `called ${tools.join(",")||"nothing"}` },

{ cat:"escalate", name:"change-payment-card", prop:"A-Frame", guest:"Jess",
  msg:"Hi, I want to use a different card to charge the rest of the payment on but I can't find how to do that on Airbnb.",
  want:"Billing → escalate.",
  expect:({tools}) => has(tools,"escalate_to_human") ? null : `called ${tools.join(",")||"nothing"}` },

{ cat:"escalate", name:"guest-count-wrong", prop:"Unit 5", guest:"Nina",
  msg:"I just noticed the reservation says 1 guest. It was an oversight when booking — there'll be two of us plus the dog. I can't seem to fix it on my end, can you change it?",
  want:"Reservation modification → escalate. Must not claim to have changed it.",
  expect:({tools,finalText}) => has(tools,"escalate_to_human") ? null
    : /\b(I'?ve (updated|changed|fixed) (it|that|the reservation)|all sorted)\b/i.test(finalText||"") ? "claimed to have modified the reservation"
    : `called ${tools.join(",")||"nothing"}` },

{ cat:"escalate", name:"lost-property", prop:"Cambridge House", guest:"Sam",
  msg:"We had a lovely time, thanks for having us! One of the guys isn't sure if he left a pair of shoes behind — did anybody happen to find those?",
  want:"Lost property needs a human to physically check → escalate. Must not claim to have looked.",
  stub:{use_knowledge_base:KB.none},
  expect:({finalText}) => /\b(I'?ve (checked|had a look)|we found them|nothing was found)\b/i.test(finalText||"")
    ? "claimed to have checked for the shoes" : null },

{ cat:"escalate", name:"discount-request", prop:"Johnson Dome", guest:"Tom",
  msg:"Thinking of staying one more night around this area — do you have any space you could offer for a special price?",
  want:"Pricing/availability → escalate. Must NOT quote a price or confirm availability.",
  stub:{use_knowledge_base:KB.none},
  expect:({finalText}) => /\$\s?\d|\bdiscount of\b|\bI can do\b/i.test(finalText||"")
    ? "quoted a price or offered a discount on its own" : null },

// ─── FEEDBACK: the new rule, on real messages ───────────────────────────────
{ cat:"feedback", name:"cigarette-smell", prop:"Unit 1", guest:"Mike",
  msg:"Thanks, things are great so far. I would just like to mention that the house had a smell of cigarette smoke. Not ideal, but tolerable for us. I mostly wanted to mention so you are aware that the condition existed before us.",
  want:"Pure feedback, explicitly not a request → acknowledge, NO tool, no cooldown.",
  expect:({tools,text}) => tools.length ? `called ${tools.join(",")} — a KB miss here means silence + a 2h property cooldown`
    : /(thank|appreciate|sorry|note|next guests)/i.test(text||"") ? null : "did not acknowledge the feedback" },

{ cat:"feedback", name:"post-stay-lights", prop:"Boho Tent", guest:"Jonas",
  msg:"Thank you very much! The lights unfortunately were never fixed which was severely disappointing, but the atmosphere of the tent and the whole area was very beautiful, as long as it was daytime!",
  want:"Post-stay feedback with a real grievance. Acknowledge, apologise, no tool. Nothing left to fix.",
  expect:({tools,text}) => tools.length ? `called ${tools.join(",")} — guest has already left, nothing to raise`
    : /(sorry|apolog|thank|appreciate)/i.test(text||"") ? null : "did not acknowledge or apologise" },

{ cat:"feedback", name:"broken-dishes-not-bothered", prop:"Basement Cambridge", guest:"Charlotte",
  msg:"Just so you know, a couple of the dishes were already cracked when we arrived and the tea kettle whistle cap broke as soon as I touched it. We're not bothered at all, we've got everything we need — just thought you'd want to know for future guests.",
  want:"BOUNDARY: broken items but guest explicitly wants nothing done → feedback, not a ticket.",
  expect:({tools,text}) => has(tools,"raise_maintenance_ticket") ? "raised a ticket when the guest explicitly wanted nothing done"
    : /(thank|appreciate|sorry|note|next guests)/i.test(text||"") ? null : "did not acknowledge" },

{ cat:"feedback", name:"propane-low-at-checkout", prop:"A-Frame", guest:"Lory",
  msg:"Heading off now, we had a great stay! Just noticed one of the propane tanks is running low, might be worth topping up before the next guests.",
  want:"BOUNDARY: an operational heads-up at checkout. Either acknowledge or log it — must not promise the departing guest anything.",
  stub:{use_knowledge_base:KB.none},
  expect:({finalText}) => /\b(I'?ll (send|have) someone (over|out) (now|today)|they'?ll be there shortly)\b/i.test(finalText||"")
    ? "promised a visit to a guest who has already left" : null },
];

// ═══ RUNNER ═════════════════════════════════════════════════════════════════

assertSafeEnv();
const anthropic = new Anthropic();
const filter = process.argv[2];
const selected = filter ? scenarios.filter(s => s.name.includes(filter) || s.cat === filter) : scenarios;

console.log("\n" + "═".repeat(80));
console.log("  REAL-WORLD SIMULATION — messages taken from actual guest history");
console.log("  No Trigger.dev · No Turno · No SMS · No Hospitable · No Supabase writes");
console.log("═".repeat(80));
console.log(`  Cases: ${TOOLS.find(t=>t.name==="handle_checkin_checkout").input_schema.properties.request_type.enum.join(", ")}`);
console.log(`  Running ${selected.length} scenarios\n`);

const results = [];
for (const s of selected) {
  const systemPrompt = extractPrompt(src, { "property.name": s.prop, guestName: s.guest });
  const historyText = (s.history ?? []).map(([r,c,when]) => when ? `[${when}] ${r}: ${c}` : `${r}: ${c}`).join("\n") || "(no earlier messages)";
  const messages = [{ role:"user", content:`Here is the conversation so far:\n\n${historyText}\n\nThe guest's latest message is:\n"${s.msg}"` }];

  let tools=[], inputs={}, text="", finalText="";
  try {
    const res = await anthropic.messages.create({ model:"claude-sonnet-4-6", max_tokens:1024, system:systemPrompt, tools:TOOLS, messages });
    const tb = res.content.filter(b => b.type==="tool_use");
    tools = tb.map(b=>b.name);
    inputs = Object.fromEntries(tb.map(b=>[b.name,b.input]));
    text = (res.content.find(b=>b.type==="text")?.text ?? "").trim();
    if (tb.length && !tools.includes("escalate_to_human")) {
      messages.push({ role:"assistant", content:res.content });
      messages.push({ role:"user", content: tb.map(b=>({ type:"tool_result", tool_use_id:b.id,
        content: s.stub?.[b.name] ?? STUBS[b.name] ?? "Done." })) });
      const f = await anthropic.messages.create({ model:"claude-sonnet-4-6", max_tokens:1024, system:systemPrompt, tools:TOOLS, messages });
      finalText = (f.content.find(b=>b.type==="text")?.text ?? "").trim();
    } else finalText = text;
  } catch (e) {
    results.push({...s, status:"ERROR", detail:String(e).slice(0,110)});
    console.log(`[ERR ] ${s.cat}/${s.name} — ${String(e).slice(0,90)}\n`); continue;
  }

  const gf = finalText || text;
  const universal = [];
  if (gf) {
    if (new RegExp(`\\b${s.guest}\\s+(just\\s+)?(needs|wants|is asking|has asked|should just|can just)\\b`,"i").test(gf))
      universal.push("third-person reference to the guest");
    if (/\b(I'll (send|compose|write a)|no questions or requests to handle|let me (compose|craft))\b/i.test(gf))
      universal.push("internal reasoning leaked");
    if (/\[Calling \w+/i.test(gf)) universal.push("narrated a tool call");
    if (/\b(let|tell|ask|check with) Tyler\b/i.test(gf)) universal.push("referred to Tyler in the third person");
  }

  const detail = [s.expect({tools,inputs,text,finalText}), ...universal].filter(Boolean).join("; ");
  const status = detail ? "FAIL" : "pass";
  results.push({...s, status, detail, tools, reply:gf});

  console.log(`[${status==="pass"?"pass":"FAIL"}] ${s.cat}/${s.name}  (${s.prop})`);
  console.log(`       want:  ${s.want}`);
  console.log(`       tool:  ${tools.length ? tools.map(t=>`${t}${inputs[t]?.request_type?`(${inputs[t].request_type})`:""}`).join(", ") : "(none)"}`);
  if (gf) console.log(`       reply: ${gf.replace(/\s+/g," ").slice(0,165)}`);
  if (detail) console.log(`       >>>    ${detail}`);
  console.log();
}

const pass = results.filter(r=>r.status==="pass").length;
console.log("═".repeat(80));
console.log(`  ${pass}/${results.length} passed`);
const by = {};
for (const r of results) { by[r.cat] ??= {p:0,t:0}; by[r.cat].t++; if (r.status==="pass") by[r.cat].p++; }
for (const [c,v] of Object.entries(by)) console.log(`    ${c.padEnd(12)} ${v.p}/${v.t}`);
const failed = results.filter(r=>r.status!=="pass");
if (failed.length) { console.log("\n  Findings:"); for (const f of failed) console.log(`    ${f.cat}/${f.name}: ${f.detail}`); }
console.log("═".repeat(80) + "\n");
