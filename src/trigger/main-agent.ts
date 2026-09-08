import { task, logger, wait, tags } from "@trigger.dev/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "../lib/supabase.js";
import { getReservation, getReservationMessages, sendMessage, extractReservationDates, formatCheckInDate, HospitableRateLimitError } from "../lib/hospitable.js";
import { createProject, getLocalHour } from "../lib/turno.js";
import { sendSms, truncateForSms, SMS_MAX_CHARS } from "../lib/sms.js";
import { getAgentMode, getV2ReservationUuids } from "../lib/settings.js";

// ─── Types ───────────────────────────────────────────────────────────

interface WebhookPayload {
  event: string;
  data: {
    action?: string;
    data?: {
      reservation_id?: string;
      sender_type?: string;
      body?: string;
      sender?: { first_name?: string; full_name?: string; locale?: string };
      platform?: string;
      conversation_id?: string;
    };
    // Flat structure fallback (in case Hospitable sends it directly)
    reservation_id?: string;
    sender_type?: string;
    body?: string;
    sender?: { first_name?: string; full_name?: string; locale?: string };
    platform?: string;
  };
  received_at: string;
}

interface AgentContext {
  propertyId: string;
  propertyName: string;
  reservationUuid: string;
  conversationHistory: ConversationMessage[];
  latestMessage: string;
  guestName: string; // first name only — feeds the guest-facing prompt, don't widen
  guestFullName: string; // "First Last" — staff SMS only
  checkInDate: string | null; // raw YYYY-MM-DD, property-local
  turnoPropertyId: string | null;
  timezone: string;
  testMode: boolean; // tags Turno tasks as test runs — see subWorkflowC
}

interface ConversationMessage {
  role: string;
  content: string;
  /** ISO timestamp from Hospitable. Undefined if the fetch failed. */
  at?: string;
}

// ─── Conversation history ────────────────────────────────────────────

// How long ago, in words. The agent cannot read an ISO date usefully but it can
// reason about "2 minutes ago" vs "5 months ago" — and without that distinction
// it treated a request from a previous stay as though it were still open, and
// told a guest something was "already with the team" when nothing had been
// raised. Relative wording also keeps the prompt stable across runs.
function timeAgo(iso: string | undefined, now: number): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  // floor, not round: "3 minutes ago" should mean at least 3 minutes have
  // passed. Rounding made 30 seconds read as "1 minute ago". A negative gap
  // (clock skew between Hospitable and us) falls through to "just now".
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

// One formatter for both AI calls, so the coordinator and the KB answerer can
// never be shown two different versions of the same conversation.
function formatHistory(history: ConversationMessage[], now = Date.now()): string {
  return history
    .map((m) => {
      const who = m.role === "guest" ? "Guest" : "Host";
      const when = timeAgo(m.at, now);
      return when ? `[${when}] ${who}: ${m.content}` : `${who}: ${m.content}`;
    })
    .join("\n");
}

// ─── Staff SMS helpers ───────────────────────────────────────────────

// Trailer appended to every staff-facing SMS. Pure string ops — never throws.
// All date handling stays in formatCheckInDate so the timezone rules live in one place.
function guestInfoBlock(ctx: AgentContext): string {
  return [
    `Guest: ${ctx.guestFullName}`,
    `Unit: ${ctx.propertyName}`,
    `Check-in: ${formatCheckInDate(ctx.checkInDate) ?? "unknown"}`,
  ].join("\n");
}

// Single send path for staff alerts, so the guest info block can't be forgotten.
async function notifyRecipients(
  recipients: { name?: string; phone: string }[] | null,
  body: string,
  ctx: AgentContext
): Promise<number> {
  if (!recipients?.length) return 0;
  // Fade the body to fit Telnyx's part cap while keeping the info block
  // intact — the body budget is whatever the trailer doesn't use.
  const info = guestInfoBlock(ctx);
  const bodyBudget = SMS_MAX_CHARS - (info.length + 2);
  const message = `${truncateForSms(body, bodyBudget)}\n\n${info}`;
  let sent = 0;
  for (const r of recipients) {
    try {
      await sendSms(r.phone, message);
      sent++;
    } catch (e) {
      logger.error("SMS send failed", { recipient: r.name, error: String(e) });
    }
  }
  return sent;
}

// ─── Tool Definitions for Claude ────────────────────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: "use_knowledge_base",
    description:
      "Search the property's knowledge base to answer a guest question about the property OR troubleshoot a reported issue. Always try this first — including for things reported as broken or not working, since the KB may have operating instructions that resolve the problem.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The guest's question rephrased for search",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "raise_maintenance_ticket",
    description:
      "Report a maintenance issue — something broken, leaking, not working, damaged, or requiring physical repair. Use this when the knowledge base had no troubleshooting steps, or when the guest has already tried troubleshooting and the problem persists.",
    input_schema: {
      type: "object" as const,
      properties: {
        issue_description: {
          type: "string",
          description: "What is broken or not working",
        },
        guest_context: {
          type: "string",
          description: "Summary of the guest conversation for context",
        },
      },
      required: ["issue_description", "guest_context"],
    },
  },
  {
    name: "process_extra_request",
    description:
      "Process a guest request for an additional item or service (towels, toiletries, blankets, pillows, etc.)",
    input_schema: {
      type: "object" as const,
      properties: {
        item_requested: {
          type: "string",
          description: "What the guest is requesting",
        },
      },
      required: ["item_requested"],
    },
  },
  {
    name: "handle_checkin_checkout",
    description:
      "Handle a guest arriving or leaving at a different time than standard. Covers all four cases: early check-in, late check-in, early checkout and late checkout. Use the case that actually matches the request — do not force it into the nearest one. Not for reservation DATE changes; those go to escalate_to_human.",
    input_schema: {
      type: "object" as const,
      properties: {
        request_type: {
          type: "string",
          enum: ["early_checkin", "late_checkin", "early_checkout", "late_checkout"],
          description:
            "early_checkin = arriving before standard check-in. late_checkin = arriving after standard check-in (self-service, no coordination). early_checkout = leaving before standard checkout (no coordination). late_checkout = leaving after standard checkout.",
        },
        requested_time: {
          type: "string",
          description: "The specific time the guest requested, if mentioned (e.g. '1pm', '2 hours early'). Empty string if not mentioned.",
        },
      },
      required: ["request_type", "requested_time"],
    },
  },
  {
    name: "escalate_to_human",
    description:
      "Escalate to a human host — the request doesn't fit any category, it's a complaint, billing issue, or something that can't be handled automatically",
    input_schema: {
      type: "object" as const,
      properties: {
        reason: {
          type: "string",
          description: "Why this needs human attention",
        },
      },
      required: ["reason"],
    },
  },
];

// The check-in tool as it was before the rework: two cases, no date awareness.
// Everything else in TOOLS was untouched, so the legacy set is the same array
// with this one entry swapped back — that way the other four can never drift
// apart between the two variants.
const LEGACY_CHECKIN_TOOL: Anthropic.Tool = {
  name: "handle_checkin_checkout",
  description:
    "Handle a guest request for early check-in or late checkout. Use this when the guest wants to arrive earlier or leave later than the standard times.",
  input_schema: {
    type: "object" as const,
    properties: {
      request_type: {
        type: "string",
        enum: ["early_checkin", "late_checkout"],
        description: "Whether the guest wants early check-in or late checkout",
      },
      requested_time: {
        type: "string",
        description: "The specific time the guest requested, if mentioned (e.g. '1pm', '2 hours early'). Empty string if not mentioned.",
      },
    },
    required: ["request_type", "requested_time"],
  },
};

const LEGACY_TOOLS: Anthropic.Tool[] = TOOLS.map((t) =>
  t.name === "handle_checkin_checkout" ? LEGACY_CHECKIN_TOOL : t
);

// ─── Sub-Workflow A: Knowledge Base Lookup ───────────────────────────

async function subWorkflowA(
  query: string,
  ctx: AgentContext
): Promise<{ answer: string; requiresMaintenance: boolean } | null> {
  const supabase = getSupabaseClient();

  // A1: Load KB entries for this property
  const { data: kbEntries, error } = await supabase
    .from("knowledge_bases")
    .select("*")
    .eq("property_id", ctx.propertyId);

  if (error) throw new Error(`KB load failed: ${error.message}`);

  if (!kbEntries || kbEntries.length === 0) {
    logger.warn("No KB entries found for property", { propertyId: ctx.propertyId });
    return null; // Will trigger escalation
  }

  // Load allowed extras and inject as a synthetic KB entry
  const { data: allowedExtras } = await supabase
    .from("allowed_extras")
    .select("item_name")
    .eq("is_active", true);

  const extrasList = (allowedExtras || []).map((e) => e.item_name);

  // Format KB for the prompt
  let kbText = kbEntries
    .map((e) => {
      let entry = `### ${e.title} [${e.category}]\n${e.content}`;
      if (e.video_url) entry += `\nVideo: ${e.video_url}`;
      if (e.image_url) entry += `\nImage: ${e.image_url}`;
      return entry;
    })
    .join("\n\n");

  if (extrasList.length > 0) {
    kbText += `\n\n### What extra amenities or items can I request? [extras]\nYou can request the following extra items during your stay: ${extrasList.join(", ")}. Just let us know and we'll arrange it for you!`;
  }

  // Format conversation history
  const historyText = formatHistory(ctx.conversationHistory);

  // A2: Call KB Answerer (AI Step #2)
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `# CRITICAL CONSTRAINT — READ THIS FIRST
You know NOTHING about this property, its amenities, rules, or surroundings except what is explicitly written in the KNOWLEDGE BASE section below. You have ZERO outside knowledge that is relevant here. If information is not in the knowledge base below, you do not know it and MUST respond with NO_ANSWER_FOUND.

# Role
You are a knowledge base lookup tool — NOT a general assistant. Your ONLY job is to find a matching answer in the KNOWLEDGE BASE below and relay it. If no match exists, output NO_ANSWER_FOUND. There is no third option.

# Context
Property: ${ctx.propertyName}
Conversation history (for context only — do NOT use this as a source of answers):
${historyText}

# KNOWLEDGE BASE (your ONLY source of truth — nothing else counts)
${kbText}
# END OF KNOWLEDGE BASE

# Rules
1. Read the guest's question carefully.
2. Search ONLY the knowledge base entries above for a relevant answer.
3. If you find an answer in the knowledge base:
   - Write a warm, conversational reply in the guest's language.
   - If the KB entry includes a video_url or image_url, include it naturally in your reply.
   - Keep it concise. Don't over-explain.
4. If the answer is NOT in the knowledge base — even partially:
   - Do NOT guess, infer, improvise, or use any general knowledge.
   - Do NOT try to be helpful by providing an approximate or partial answer.
   - Do NOT answer based on the conversation history or property name.
   - Your response MUST start with exactly: NO_ANSWER_FOUND
   - On the next line, output REQUIRES_MAINTENANCE: true OR REQUIRES_MAINTENANCE: false
     - true = the guest is describing physical damage, breakage, leaking, flooding, wobbling, malfunctioning appliances, or anything that clearly needs a repair person or on-site fix.
     - false = the guest is asking an informational question the KB should have covered (directions, policies, recommendations, etc.).
   - On the next line, add a brief reason explaining what info was missing.

# Output format
ONLY two possible outputs:
A) A guest-facing reply using ONLY knowledge base content, OR
B) All three lines in this exact order:
   NO_ANSWER_FOUND
   REQUIRES_MAINTENANCE: true/false
   Reason: brief explanation of what was missing
There is NO other valid output. When in doubt, ALWAYS choose B.

# FINAL REMINDER
The knowledge base above is your ONLY source of truth. You have ZERO information outside of it. If the answer is not explicitly in the knowledge base, you MUST output NO_ANSWER_FOUND as the very first thing in your response. Never guess. Never improvise. Never use general knowledge. The consequence of guessing is giving the guest wrong information — always choose NO_ANSWER_FOUND instead.`,
    messages: [{ role: "user", content: query }],
  });

  const answerBlock = response.content.find((b) => b.type === "text");
  const answer = answerBlock ? answerBlock.text : "";

  // A3: Check if answer was found (trim whitespace, case-insensitive check)
  const trimmed = answer.trim();
  if (trimmed.toUpperCase().startsWith("NO_ANSWER_FOUND") || trimmed === "") {
    const requiresMaintenance = /REQUIRES_MAINTENANCE:\s*true/i.test(trimmed);
    logger.info("KB Answerer returned NO_ANSWER_FOUND", { requiresMaintenance });
    return { answer: "", requiresMaintenance };
  }

  return { answer, requiresMaintenance: false };
}

// ─── Sub-Workflow B: Maintenance Ticket ──────────────────────────────

async function subWorkflowB(
  issueDescription: string,
  guestContext: string,
  ctx: AgentContext
): Promise<string> {
  const supabase = getSupabaseClient();

  // B1: Load urgency categories
  const { data: categories, error: catError } = await supabase
    .from("urgency_categories")
    .select("*")
    .order("level");

  if (catError) throw new Error(`Urgency categories load failed: ${catError.message}`);

  const categoriesText = (categories || [])
    .map((c) => `- **${c.level}**: ${c.description}. Examples: ${c.examples}. Response: ${c.response_time}`)
    .join("\n");

  // B2: Call Urgency Assessor (AI Step #3)
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 50,
    system: `# Scope
You have no knowledge beyond what is provided in this prompt. You cannot help with anything outside of it. Do not guess, assume, or use external knowledge.

# Role
You are a maintenance urgency classifier for vacation rental properties.
Your ONLY job is to read a maintenance issue description and assign the correct urgency level.

# Context
Maintenance issue reported by guest:
"${issueDescription}"

Guest context:
"${guestContext}"

Available urgency levels:
${categoriesText || "- low: Minor issue\n- medium: Moderate issue\n- high: Significant issue\n- emergency: Immediate danger or property damage"}

# Step by Step
1. Read the issue description carefully.
2. Compare it against the examples for each urgency level.
3. Consider: Does this affect guest safety? Is it time-sensitive?
4. Select the single most appropriate urgency level.

# Output
Respond with ONLY the urgency level name (e.g. "high"). No explanation, no other text.`,
    messages: [{ role: "user", content: issueDescription }],
  });

  const urgencyBlock = response.content.find((b) => b.type === "text");
  const urgency = urgencyBlock ? urgencyBlock.text.trim().toLowerCase() : "medium";

  // B3: Create ticket
  const { error: insertError } = await supabase.from("maintenance_tickets").insert({
    property_id: ctx.propertyId,
    description: issueDescription,
    urgency,
    status: "open",
    guest_context: guestContext,
    reservation_uuid: ctx.reservationUuid,
  });

  if (insertError) throw new Error(`Ticket insert failed: ${insertError.message}`);
  logger.info("Maintenance ticket created", { urgency, propertyId: ctx.propertyId });

  // B4: SMS alerts — filter by urgency level
  const urgencyColumn = `receives_maintenance_${urgency}` as const;
  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq(urgencyColumn, true)
    .eq("is_active", true);

  const smsBody = `🔧 Maintenance [${urgency.toUpperCase()}]\n\n${issueDescription}`;
  const smsSent = await notifyRecipients(recipients, smsBody, ctx);

  // B5: Return result to agent
  return `Maintenance ticket created. Urgency: ${urgency}. SMS sent to ${smsSent} recipient(s).`;
}

// ─── Sub-Workflow C: Extra Request Processing ────────────────────────

async function subWorkflowC(
  itemRequested: string,
  ctx: AgentContext
): Promise<string> {
  const supabase = getSupabaseClient();

  // C1: Check allowed extras using AI matching
  const { data: allowedExtras } = await supabase
    .from("allowed_extras")
    .select("*")
    .eq("is_active", true);

  const allowedList = (allowedExtras || []).map((e) => e.item_name).join(", ");

  let isAllowed = false;
  if (allowedExtras && allowedExtras.length > 0) {
    const anthropic = new Anthropic();
    const matchResponse = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 10,
      system: `# Scope
You have no knowledge beyond what is provided in this prompt. You cannot help with anything outside of it. Do not guess, assume, or use external knowledge.

# Role
You decide whether a guest's request matches any item on an allowed extras list. The match does NOT need to be exact — use common sense. "More towels" matches "extra towels". "Can I get some soap" matches "toiletries". But "bicycle rental" does NOT match "extra towels".

# Context
Allowed extras for this property: ${allowedList}

# Output
Respond with ONLY "YES" or "NO". Nothing else.`,
      messages: [{ role: "user", content: `Guest requested: "${itemRequested}"` }],
    });
    const matchText = matchResponse.content.find((b) => b.type === "text");
    isAllowed = matchText ? matchText.text.trim().toUpperCase() === "YES" : false;
    logger.info("Extra request AI match result", { itemRequested, allowedList, isAllowed });
  }

  if (!isAllowed) {
    // C2a: Not allowed — decline
    await supabase.from("extra_requests").insert({
      property_id: ctx.propertyId,
      reservation_uuid: ctx.reservationUuid,
      item_requested: itemRequested,
      status: "declined",
    });

    return `Declined. "${itemRequested}" is not in the allowed extras list for this property.`;
  }

  // C2b: Allowed — create Turno task
  let turnoProjectId: string | null = null;

  // Check if guest is messaging before their stay — schedule for arrival day if so
  const local = getLocalHour(ctx.timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${local.year}-${pad(local.month)}-${pad(local.day)}`;
  let scheduledBeginTime: string | undefined;
  let scheduledEndTime: string | undefined;
  let deliveryEstimate = local.hour < 15 ? "today by the end of the day" : "tomorrow by 3pm";

  // checkInDate is resolved once in Phase 1; null here means the lookup failed,
  // which falls through to immediate scheduling exactly as before.
  if (ctx.checkInDate && ctx.checkInDate > todayStr) {
    scheduledBeginTime = `${ctx.checkInDate} 10:00:00`;
    scheduledEndTime = `${ctx.checkInDate} 23:59:00`;
    deliveryEstimate = "on your arrival day";
    logger.info("Extra request scheduled for check-in day", { checkIn: ctx.checkInDate, todayStr });
  }

  if (ctx.turnoPropertyId) {
    try {
      const turnoResult = await createProject({
        propertyId: parseInt(ctx.turnoPropertyId, 10),
        summary: `Guest extra request: ${itemRequested}`,
        cleanerDescription: `${itemRequested}. Please deliver within the task window.`,
        timezone: ctx.timezone,
        scheduledBeginTime,
        scheduledEndTime,
        testMode: ctx.testMode,
      });
      turnoProjectId = String(turnoResult?.data?.id || null);
      logger.info("Turno project created", { turnoProjectId });
    } catch (e) {
      logger.error("Turno project creation failed — continuing without it", { error: String(e) });
    }
  } else {
    // No Turno mapping — send SMS alert
    logger.warn("No turno_property_id mapped — sending SMS alert");
    const { data: recipients } = await supabase
      .from("sms_recipients")
      .select("*")
      .eq("receives_kb_gaps", true)
      .eq("is_active", true);

    if (recipients && recipients.length > 0) {
      const smsBody = `[AI Agent] Extra request approved\n\n${ctx.propertyName}\n\n${itemRequested}\n\nNo Turno property mapped — manual action needed.`;
      for (const r of recipients) {
        try {
          await sendSms(r.phone, smsBody);
        } catch (e) {
          logger.error("SMS send failed", { recipient: r.name, error: String(e) });
        }
      }
    }
  }

  await supabase.from("extra_requests").insert({
    property_id: ctx.propertyId,
    reservation_uuid: ctx.reservationUuid,
    item_requested: itemRequested,
    status: "approved",
    turno_project_id: turnoProjectId,
  });

  return `Approved. "${itemRequested}" has been arranged. Our team will deliver it ${deliveryEstimate}. Tell the guest this delivery timeframe.`;
}

// ─── Sub-Workflow D: Human Escalation (HARD STOP) ────────────────────

async function subWorkflowD(
  reason: string,
  guestQuestion: string,
  ctx: AgentContext
): Promise<void> {
  const supabase = getSupabaseClient();

  // D1: Log KB gap
  await supabase.from("kb_gap_log").insert({
    property_id: ctx.propertyId,
    guest_question: guestQuestion,
    reservation_uuid: ctx.reservationUuid,
  });

  // D2: Set cooldown (configurable duration)
  const { data: cooldownSetting } = await supabase
    .from("agent_settings")
    .select("value")
    .eq("key", "cooldown_hours")
    .single();
  const cooldownHours = cooldownSetting ? parseFloat(cooldownSetting.value) : 8;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + cooldownHours * 60 * 60 * 1000);
  await supabase.from("cooldowns").insert({
    property_id: ctx.propertyId,
    activated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    reason,
    is_active: true,
    reservation_uuid: ctx.reservationUuid,
  });

  // D3: SMS alerts
  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq("receives_kb_gaps", true)
    .eq("is_active", true);

  // Guest quote goes last: it's the only unbounded part, so if the SMS has
  // to be faded to fit, the instruction above survives and the quote fades.
  const smsBody = `⚠️ AI Escalated — cooldown active. Please review all recent guest messages and respond manually.\n\nGuest wrote:\n"${guestQuestion}"`;
  await notifyRecipients(recipients, smsBody, ctx);

  logger.warn("Sub-Workflow D: HARD STOP — no reply to guest", {
    propertyId: ctx.propertyId,
    reason,
  });

  // D4: TERMINATE — no return, no reply
}

// ─── Sub-Workflow E: Check-In / Checkout Request ────────────────────

// Whole days from today (property-local) until check-in. Negative once the stay
// has started, which is what we want: a guest already on site is inside the window.
// Returns null when we have no check-in date, and the caller then falls back to
// the coordinated path rather than guessing.
function daysUntilCheckIn(ctx: AgentContext): number | null {
  if (!ctx.checkInDate) return null;
  const [y, m, d] = ctx.checkInDate.split("-").map(Number);
  if (!y || !m || !d) return null;
  const local = getLocalHour(ctx.timezone);
  const todayUtc = Date.UTC(local.year, local.month - 1, local.day);
  const checkInUtc = Date.UTC(y, m - 1, d);
  return Math.round((checkInUtc - todayUtc) / 86_400_000);
}

// Cases that need no coordination at all: check-in is self-service, and leaving
// early needs nothing arranged. Neither should ever page the cleaners.
const NO_COORDINATION_NEEDED: Record<string, string> = {
  late_checkin: "late check-in",
  early_checkout: "early checkout",
};

// Tyler's rule: availability isn't knowable until roughly a week out. Measured
// from CHECK-IN for both early check-in and late checkout — his emails said
// "arrival/departure", but we settled on check-in for both (3 Sep) since it is
// simpler to explain and handles mid-stay guests without a special case.
const COORDINATION_WINDOW_DAYS = 7;

async function subWorkflowE(
  requestType: string,
  requestedTime: string,
  ctx: AgentContext,
  useV2: boolean
): Promise<string> {
  const supabase = getSupabaseClient();

  // E0a: No-coordination cases — answer directly, never notify staff.
  // v1 had neither branch: every request paged the cleaners regardless of case
  // or how far out the stay was. Skipping both here is what keeps v1 authentic.
  const noCoordLabel = useV2 ? NO_COORDINATION_NEEDED[requestType] : undefined;
  if (noCoordLabel) {
    logger.info("Check-in/checkout needs no coordination", { requestType });
    return `No coordination needed for a ${noCoordLabel}. Check-in is self-service and leaving early needs nothing arranged, so nobody has been notified and nothing needs approving. Tell the guest that is completely fine and they can arrive or leave whenever suits them. Do NOT say you are checking with anyone.`;
  }

  // E0b: Outside the coordination window — too early to know, so don't page anyone.
  const days = daysUntilCheckIn(ctx);
  if (useV2 && days !== null && days > COORDINATION_WINDOW_DAYS) {
    logger.info("Check-in/checkout request outside coordination window", {
      requestType,
      daysUntilCheckIn: days,
    });
    return `Too early to answer — check-in is ${days} days away and availability is not known until closer to the stay. Nobody has been notified and no request has been raised. Tell the guest we are happy to try to accommodate it but will not know until nearer the time, and ask them to check back about a week before check-in. Do NOT say you are checking with the cleaning team.`;
  }

  // E1: Fetch SMS recipients tagged for check-in/checkout notifications
  const { data: recipients } = await supabase
    .from("sms_recipients")
    .select("*")
    .eq("receives_checkin_checkout", true)
    .eq("is_active", true);

  // E2: Send SMS to each recipient
  const typeLabel = requestType === "early_checkin" ? "Early check-in" : "Late checkout";
  const timeNote = requestedTime ? ` (requested: ${requestedTime})` : "";
  const smsBody = `🕐 ${typeLabel} Request${timeNote}\n\nPlease confirm availability.`;
  const smsSent = await notifyRecipients(recipients, smsBody, ctx);

  logger.info("Check-in/checkout request processed", {
    requestType,
    propertyId: ctx.propertyId,
    smsSent,
  });

  return `Request forwarded to cleaning team (${smsSent} notified). Tell the guest: "Not a problem. I'm going to check with our cleaning team to see if it's possible and let you know."`;
}

// ─── Conversation loading ────────────────────────────────────────────

// Hospitable caps the per-reservation messages path at 2 requests per ~30s
// window and counts reads against it, so a guest sending two messages in a row
// is enough to get the second run's history load refused. Three attempts covers
// roughly two windows, which is more than a realistic burst needs; beyond that
// Hospitable is down rather than throttling us.
const MESSAGES_FETCH_ATTEMPTS = 3;

// Newest N messages fed to the prompts. Long stays accumulate hundreds, and the
// agent only reasons about the recent thread — the rest is prompt weight.
const MAX_HISTORY_MESSAGES = 40;

/**
 * Loads the reservation thread, waiting out a rate limit rather than giving up.
 *
 * Returns null only when the conversation genuinely cannot be read. Callers must
 * not fall back to "just the message that triggered this run": that is what made
 * the agent answer the last of several guest messages and ignore the rest.
 *
 * The waits here are longer than 5s, so Trigger.dev checkpoints them and they
 * cost wall-clock rather than compute.
 */
async function loadReservationThread(reservationUuid: string): Promise<any[] | null> {
  for (let attempt = 1; attempt <= MESSAGES_FETCH_ATTEMPTS; attempt++) {
    try {
      const payload = await getReservationMessages(reservationUuid);
      return payload?.data || [];
    } catch (e) {
      if (e instanceof HospitableRateLimitError && attempt < MESSAGES_FETCH_ATTEMPTS) {
        logger.info("Hospitable rate limited — waiting out the window", {
          attempt,
          retryAfterSeconds: e.retryAfterSeconds,
        });
        // +1s so we resume after the window resets rather than exactly on it.
        await wait.for({ seconds: e.retryAfterSeconds + 1 });
        continue;
      }
      logger.error("Could not load conversation from Hospitable", {
        attempt,
        error: String(e),
      });
      return null;
    }
  }
  return null;
}

// Oldest-first, newest MAX_HISTORY_MESSAGES kept. Anything Hospitable did not
// send as a guest message counts as host, which is deliberate: an unknown
// sender ends the run of unanswered guest messages rather than being folded
// into it.
function toConversationHistory(messages: any[]): ConversationMessage[] {
  return [...messages]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({
      role: m.sender_type === "guest" ? "guest" : "host",
      content: m.body || "",
      at: m.created_at,
    }));
}

// ─── Main Agent Workflow ─────────────────────────────────────────────

export const mainAgentWorkflow = task({
  id: "main-agent-workflow",
  retry: { maxAttempts: 1 },
  run: async (payload: WebhookPayload) => {
    // ── Phase 1: Setup ──────────────────────────────────────────────

    // Step 1: Extract webhook data
    const webhookData = payload.data?.data || payload.data;
    const messageBody = (webhookData as any)?.body;
    const senderType = (webhookData as any)?.sender_type;
    const reservationUuid = (webhookData as any)?.reservation_id;
    const guestName = (webhookData as any)?.sender?.first_name || "Guest";
    // Hospitable's platform locale. Deliberately NOT fed to the prompt: guests
    // routinely set their app to their native language and then message in
    // English, and the locale won that fight. Language comes from the message
    // text alone. Kept here purely as a diagnostic on the run log.
    const guestLocale = (webhookData as any)?.sender?.locale || "unknown";
    const webhookPropertyUuid = (webhookData as any)?.property?.id;

    logger.info("Webhook received", { senderType, reservationUuid, hasBody: !!messageBody, guestLocale });

    // Filter out host messages
    if (senderType === "host") {
      logger.info("Host message — ignoring");
      return { status: "skipped", reason: "host_message" };
    }

    // 30-second debounce: wait, then check if a newer guest message arrived
    // Use the message's created_at (when guest actually sent it), not webhook arrival time
    const messageCreatedAt = (webhookData as any)?.created_at || payload.received_at;
    await wait.for({ seconds: 30 });

    // Which agent answers this reservation? Resolved here rather than at the
    // agent loop because v2 reads the thread once and reuses it, where v1 keeps
    // the two separate reads it has always made. Read fresh each run, so the
    // allowlist can change with no deploy.
    const v2Uuids = await getV2ReservationUuids();
    const useV2 = v2Uuids.includes(reservationUuid);

    // v1 checks for a newer guest message with its own read of the thread.
    // v2 folds that check into the single read at Step 5.
    if (!useV2 && reservationUuid) {
      try {
        const recentMessages = await getReservationMessages(reservationUuid);
        const guestMessages = (recentMessages?.data || []).filter(
          (m: any) => m.sender_type === "guest"
        );
        const newerExists = guestMessages.some(
          (m: any) => m.created_at && m.created_at > messageCreatedAt
        );
        if (newerExists) {
          logger.info("Newer guest message exists — skipping this run", {
            reservationUuid,
            thisMessageAt: messageCreatedAt,
          });
          return { status: "skipped", reason: "newer_message_exists" };
        }
      } catch (e) {
        logger.warn("Failed to check for newer messages — proceeding anyway", { error: String(e) });
      }
    }

    // --- Live/test mode (toggled from the dashboard, read fresh each run) ---
    // Test mode: only the allowlisted reservations are answered.
    // Live mode:  no reservation filter at all.
    const agentMode = await getAgentMode();
    logger.info("Agent mode", { mode: agentMode.mode });

    if (agentMode.mode === "test" && !agentMode.testReservationUuids.includes(reservationUuid)) {
      logger.info(`Skipping reservation ${reservationUuid} — test mode, not in allowlist`);
      return { status: "skipped", reason: "reservation not in test allowlist" };
    }

    if (!reservationUuid) {
      logger.error("No reservation_id in webhook payload");
      return { status: "error", reason: "no_reservation_id" };
    }

    if (!messageBody) {
      logger.error("No message body in webhook payload");
      return { status: "error", reason: "no_message_body" };
    }

    // Step 2: Fetch the reservation once — supplies the guest identity and check-in
    // date for staff SMS, plus a property UUID fallback. Best-effort: a failure here
    // must never stop an alert going out.
    let reservationData: any = null;
    try {
      reservationData = await getReservation(reservationUuid);
    } catch (e) {
      logger.error("Failed to fetch reservation from Hospitable", { error: String(e) });
    }

    let propertyUuid: string | undefined = webhookPropertyUuid;
    if (!propertyUuid && reservationData) {
      propertyUuid = reservationData?.data?.properties?.[0]?.id;
    }

    if (!propertyUuid) {
      logger.error("Could not resolve property UUID", { webhookPropertyUuid, reservationData });
      return { status: "error", reason: "no_property_uuid" };
    }

    // Step 3: Map to our Supabase property
    const supabase = getSupabaseClient();
    const { data: property, error: propError } = await supabase
      .from("properties")
      .select("*")
      .eq("hospitable_property_uuid", propertyUuid)
      .single();

    if (propError || !property) {
      logger.error("Property not found in Supabase", { propertyUuid, error: propError?.message });
      return { status: "error", reason: "property_not_synced" };
    }

    // Step 4: Cooldown check
    const { data: activeCooldowns } = await supabase
      .from("cooldowns")
      .select("*")
      .eq("property_id", property.id)
      .eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .limit(1);

    if (activeCooldowns && activeCooldowns.length > 0) {
      logger.info("Property is in cooldown — ignoring message", {
        propertyId: property.id,
        cooldownExpires: activeCooldowns[0].expires_at,
      });
      return { status: "skipped", reason: "cooldown_active" };
    }

    // Step 5: Load conversation history
    let conversationHistory: ConversationMessage[] = [];
    if (useV2) {
      // One read serves both the newer-message check and the history. The two
      // separate reads this used to make were exactly the 2 requests Hospitable
      // allows per window, so whenever a guest sent a second message the history
      // load was refused and the agent answered that message on its own — the
      // earlier ones were never seen, never answered, and left no trace.
      const thread = await loadReservationThread(reservationUuid);

      if (!thread) {
        // Without the thread we cannot tell what has already been said or
        // answered. Replying regardless is precisely the failure being fixed,
        // so stop and leave the conversation to staff.
        logger.error("Conversation unavailable — not replying", { reservationUuid });
        return { status: "skipped", reason: "conversation_unavailable" };
      }

      const newerExists = thread.some(
        (m: any) =>
          m.sender_type === "guest" && m.created_at && m.created_at > messageCreatedAt
      );
      if (newerExists) {
        logger.info("Newer guest message exists — skipping this run", {
          reservationUuid,
          thisMessageAt: messageCreatedAt,
        });
        return { status: "skipped", reason: "newer_message_exists" };
      }

      conversationHistory = toConversationHistory(thread);
    } else {
      try {
        const messagesData = await getReservationMessages(reservationUuid);
        const messages = (messagesData?.data || []).sort(
          (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        conversationHistory = messages.map((m: any) => ({
          role: m.sender_type === "guest" ? "guest" : "host",
          content: m.body || "",
          at: m.created_at,
        }));
      } catch (e) {
        logger.warn("Failed to fetch conversation history — continuing with latest message only", {
          error: String(e),
        });
        conversationHistory = [{ role: "guest", content: messageBody, at: messageCreatedAt }];
      }
    }

    // Guest identity + check-in date for staff SMS. The webhook only carries a first
    // name and no dates, so these come from the reservation — falling back to whatever
    // the webhook gave us if that fetch failed.
    const guestData = reservationData?.data?.guest ?? null;
    const guestFullName =
      [guestData?.first_name, guestData?.last_name].filter(Boolean).join(" ") ||
      (webhookData as any)?.sender?.full_name ||
      guestName;
    const { checkIn } = extractReservationDates(reservationData);
    const checkInDate = checkIn?.split(" ")[0]?.split("T")[0] ?? null;

    // Build agent context (latestMessage updated after bundling below)
    const agentCtx: AgentContext = {
      propertyId: property.id,
      propertyName: property.name,
      reservationUuid,
      conversationHistory,
      latestMessage: messageBody, // will be overwritten with bundledMessage
      guestName,
      guestFullName,
      checkInDate,
      turnoPropertyId: property.turno_property_id,
      timezone: property.timezone || "America/New_York",
      testMode: agentMode.mode === "test",
    };

    // ── Phase 2: Agent Loop ─────────────────────────────────────────

    const historyText = formatHistory(conversationHistory);

    // Bundle all unanswered guest messages into a single message
    // so the AI treats them as one cohesive request
    let unansweredMessages: string[] = [];
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === "host") break;
      if (conversationHistory[i].role === "guest") {
        unansweredMessages.unshift(conversationHistory[i].content);
      }
    }
    const bundledMessage = unansweredMessages.length > 1
      ? unansweredMessages.join("\n\n")
      : unansweredMessages[0] || messageBody;

    agentCtx.latestMessage = bundledMessage;

    logger.info("Bundled guest message", {
      messageCount: unansweredMessages.length,
      bundledLength: bundledMessage.length,
    });

    // Step 6: Start the agent loop
    const anthropic = new Anthropic();

    const agentMessages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Here is the conversation so far:\n\n${historyText}\n\nThe guest's latest message is:\n"${bundledMessage}"`,
      },
    ];

    const systemPrompt = `# You don't know anything or can't help with anything except for what's inside this prompt and the tool calls.

# Role
You are Tyler, the host of Uncommon Accommodations. You write in the first
person, as Tyler, always. You never refer to Tyler in the third person and you
never offer to pass something on to Tyler or "let Tyler know" — you are Tyler,
so you handle it yourself.

# Language
- Reply in the same language the guest is writing to you in. Judge it from the
  words in their messages, nothing else.
- If the guest switches language partway through, switch with them.
- Never infer language from the guest's NAME, their location, or the property
  name. A person's name tells you nothing about the language they write in.
- If their latest message is too short to tell (just "ok", "thanks", an emoji),
  carry on in the language you have already been using with them. If there is
  nothing at all to go on, write in English.
- Warm, conversational answers with human touches.
- Avoid using the long "—" and write in fluid human like sentences using natural flowing language.

# Context
Guests are messaging you through either Airbnb, Booking.com, another channel platform, or email because they've booked a stay and have a question, a maintenance request, or a request for a special item.

Property: ${property.name}
Guest name: ${guestName}

# Step by Step
1. Read the full conversation to understand context and tone.
2. Focus on the guest's latest message. It may contain multiple topics or
   requests. You must address ALL parts of the message, not just one.
3. Classify each part of the request and call the appropriate tool(s). You
   can and should call multiple tools when the message covers different topics:
   - **use_knowledge_base** — ALWAYS call this first for any question or issue,
     including when a guest reports something not working (e.g. fireplace,
     thermostat, appliance, TV). The KB often has operating instructions
     or troubleshooting steps that solve the problem without maintenance.
     This applies to requests too, not just questions. If the knowledge base
     already answers it, answer from the knowledge base and stop there.
   - **raise_maintenance_ticket** — Guest is reporting something broken,
     leaking, not working, damaged, or requiring physical repair AND
     either the knowledge base had no relevant troubleshooting info,
     or the conversation shows the guest already tried the suggested
     troubleshooting steps and the problem persists.
   - **process_extra_request** — Guest is requesting an additional item
     or service (towels, toiletries, blankets, pillows, etc.)
     Only for items we bring to the guest. If the knowledge base says the
     item is for sale, self-serve, or already available on the property, it
     is NOT an extra request — answer from the knowledge base and tell them
     where to find it and what it costs. Firewood is the clearest example:
     it is sold on site at the fire pit, so never raise a request for it.
   - **handle_checkin_checkout** — Guest is asking about arriving or leaving
     at a different time than standard. Always use this tool for these
     requests, for all four cases: early check-in, late check-in, early
     checkout and late checkout. Pass the case that actually matches what
     they asked for — do not force it into the nearest one.
     If the guest is asking to change their reservation DATES rather than
     their times, that is not this tool. Use escalate_to_human. Do NOT
     use the knowledge base for check-in/checkout time change requests.
   - escalate_to_human — The request doesn't fit any category above,
     or it's a complaint, billing issue, or something you can't handle.
4. After receiving all tool results, compose a single reply that addresses
   every part of the guest's message:
   - If any tool result indicates escalation — do NOT reply to the guest. Stay silent.
   - Otherwise — compose a warm, concise reply that covers all topics.
     Do not mention internal systems, tickets, tools, or databases.
     Do NOT add any footer, disclaimer, or sign-off like "this message was automatically sent" — the system adds one automatically.

# Guest Feedback and Comments
Sometimes a guest is not asking you for anything. They are telling you how the
stay went, or mentioning something they noticed. This is very common around
checkout.

When that is all they are doing, just reply warmly and acknowledge it. Do NOT
search the knowledge base, do NOT raise a ticket, and do NOT escalate. There is
nothing to look up and nothing to arrange, so none of those tools apply. For
example:
- "Thanks for letting me know, I'll be sure to make note of that for the next guests."
- "I really appreciate you flagging that, and sorry it wasn't quite spot on when you arrived."

Take it on the chin, thank them, and move on. Do not be defensive and do not
make excuses.

This only applies when the guest is not asking you to do anything. If they want
something fixed, replaced, cleaned or arranged during their stay, that is a
maintenance issue or an extra request and you handle it as normal.

It also only covers the property and the stay itself. Anything to do with the
BOOKING always goes to escalate_to_human, even when the guest is only telling
you rather than asking you, and even when they say they already know the
answer. That includes cancellations, changing dates, refunds, payments, card
changes, deposits, and the number of guests or pets on the reservation. A guest
saying "we can't make it this weekend, I understand there are no refunds" is
not feedback — it is a cancellation, and it must reach a human.

# What You Have Already Done
Before you raise anything, re-read the conversation history and check whether
you have already handled this exact thing earlier in the thread.

If you already raised a request or a ticket for it, do NOT silently raise it
again, and do NOT repeat your previous reply word for word. Say plainly that
it is already with the team. For example:
- "I've already put that request in and the team will take care of it."
- "I passed the heating issue on to the team earlier, so it's in hand."

Never promise to chase something up, follow it up, check on its progress,
chase the team, or send someone out. You cannot do any of those things and
you have no way of knowing where a request has got to. Say it is with the
team and leave it there.

If the guest asks for something additional on top of what you already raised,
you can raise that as a new request. Otherwise do not offer to raise another.

Every line of the conversation is stamped with how long ago it was sent. Use
that. Something you raised a few minutes ago is genuinely still in hand.
Something from weeks or months ago is from an earlier part of their trip and
almost certainly closed, so do not tell the guest it is still being worked on.
When in doubt, treat the old one as finished rather than claiming it is open.

This does NOT apply to handle_checkin_checkout. When the guest is genuinely
asking to arrive or leave at a different time, call that tool even if you can
see you handled a similar request earlier in the thread. Only the tool knows
their dates and whether it is too early to answer, so skipping it means
guessing. Call it, then use the history to word your reply naturally, for
example telling them you already flagged it a few minutes ago and what the
current position is.

That is only about not skipping the tool for a repeat request. It does not
widen when the tool applies. If the guest is not actually asking to change
their times, the tool does not apply at all: someone saying they have arrived
early and would like to walk around the grounds until check-in is not asking
for an early check-in, so just tell them that is fine.

Move the conversation forward. Never answer as though the earlier exchange
did not happen.

# Confirmation Before Action
Before calling raise_maintenance_ticket or process_extra_request, you MUST first
confirm with the guest. Repeat back what you understood and ask them to confirm.
For example:
- "So you'd like me to request 4 extra towels, is that right? Just confirm and I'll let our team know!"
- "Just to make sure I have this right, the hot water in the bathroom isn't working? Let me know and I'll get our maintenance team on it."

Only call the tool when the conversation history already shows you asked for
confirmation AND the guest confirmed (e.g. "yes", "correct", "that's right",
"please", thumbs up, etc.). If the guest's latest message IS that confirmation,
go ahead and call the tool now.

Only ever confirm something we are actually going to do.

This does NOT apply to use_knowledge_base, escalate_to_human, or
handle_checkin_checkout. Those can be called immediately without confirmation.

# Check-in / Checkout Requests
When you call handle_checkin_checkout, the tool tells you what to say back.
Relay that in your own warm, natural wording. Do not invent a different
outcome than the one the tool gave you, and never promise a time the tool
did not confirm.

If you already sent the guest that same update earlier in this conversation,
do not send it again. Acknowledge that you are still waiting and say when
they can expect to hear back.

# Output
Your reply is sent DIRECTLY to the guest. Whatever you write, the guest reads.
Never include internal reasoning, chain of thought, analysis, or notes about
what you're doing. Only write what you'd want the guest to see.

The FIRST word you write is the first word the guest reads. Begin directly
with your message to the guest: no preamble, no planning notes, no commentary
about what the message is or what you are about to do. Never write about the
guest in the third person.

Example of a WRONG reply (the first paragraph is internal thinking, and the
guest would read it). Never do this:
"Jared's message is just a friendly acknowledgment, no questions or requests to handle here. I'll send a warm, simple reply.

You're welcome, Jared! We'll be in touch soon."

The RIGHT reply is only the message itself:
"You're welcome, Jared! We'll be in touch soon."

# You don't know anything or can't help with anything except for what is defined in the prompt and tool calls.`;

    // The agent exactly as it ran before the rework, preserved byte-for-byte
    // from the previous commit. Reservations outside the v2 allowlist keep
    // getting this, so the trial is a genuine like-for-like comparison.
    const legacySystemPrompt = `# You don't know anything or can't help with anything except for what's inside this prompt and the tool calls.

# Role
You are an AI that responds to guest questions and handles the inbox of Uncommon Accommodations short-term rentals business.

# Language
- Detect the language the guest is writing in and reply in that same language.
- Warm, conversational answers with human touches.
- Avoid using the long "—" and write in fluid human like sentences using natural flowing language.

# Context
Guests are messaging you through either Airbnb, Booking.com, another channel platform, or email because they've booked a stay and have a question, a maintenance request, or a request for a special item.

Property: ${property.name}
Guest name: ${guestName}

# Step by Step
1. Read the full conversation to understand context and tone.
2. Focus on the guest's latest message. It may contain multiple topics or
   requests. You must address ALL parts of the message, not just one.
3. Classify each part of the request and call the appropriate tool(s). You
   can and should call multiple tools when the message covers different topics:
   - **use_knowledge_base** — ALWAYS call this first for any question or issue,
     including when a guest reports something not working (e.g. fireplace,
     thermostat, appliance, TV). The KB often has operating instructions
     or troubleshooting steps that solve the problem without maintenance.
   - **raise_maintenance_ticket** — Guest is reporting something broken,
     leaking, not working, damaged, or requiring physical repair AND
     either the knowledge base had no relevant troubleshooting info,
     or the conversation shows the guest already tried the suggested
     troubleshooting steps and the problem persists.
   - **process_extra_request** — Guest is requesting an additional item
     or service (towels, toiletries, blankets, pillows, etc.)
   - **handle_checkin_checkout** — Guest is asking about early check-in
     or late checkout. Always use this tool for these requests. Do NOT
     use the knowledge base for check-in/checkout time change requests.
   - escalate_to_human — The request doesn't fit any category above,
     or it's a complaint, billing issue, or something you can't handle.
4. After receiving all tool results, compose a single reply that addresses
   every part of the guest's message:
   - If any tool result indicates escalation — do NOT reply to the guest. Stay silent.
   - Otherwise — compose a warm, concise reply that covers all topics.
     Do not mention internal systems, tickets, tools, or databases.
     Do NOT add any footer, disclaimer, or sign-off like "this message was automatically sent" — the system adds one automatically.

# Confirmation Before Action
Before calling raise_maintenance_ticket or process_extra_request, you MUST first
confirm with the guest. Repeat back what you understood and ask them to confirm.
For example:
- "So you'd like me to request 4 extra towels, is that right? Just confirm and I'll let our team know!"
- "Just to make sure I have this right, the hot water in the bathroom isn't working? Let me know and I'll get our maintenance team on it."

Only call the tool when the conversation history already shows you asked for
confirmation AND the guest confirmed (e.g. "yes", "correct", "that's right",
"please", thumbs up, etc.). If the guest's latest message IS that confirmation,
go ahead and call the tool now.

This does NOT apply to use_knowledge_base, escalate_to_human, or
handle_checkin_checkout. Those can be called immediately without confirmation.

# Check-in / Checkout Requests
When you call handle_checkin_checkout and get the result back, ALWAYS reply
to the guest with exactly this message (translated to the guest's language):
"Not a problem. I'm going to check with our cleaning team to see if it's
possible and let you know. Someone will reach out to confirm this soon."

# Output
Your reply is sent DIRECTLY to the guest. Whatever you write, the guest reads.
Never include internal reasoning, chain of thought, analysis, or notes about
what you're doing. Only write what you'd want the guest to see.

The FIRST word you write is the first word the guest reads. Begin directly
with your message to the guest: no preamble, no planning notes, no commentary
about what the message is or what you are about to do. Never write about the
guest in the third person.

Example of a WRONG reply (the first paragraph is internal thinking, and the
guest would read it). Never do this:
"Jared's message is just a friendly acknowledgment, no questions or requests to handle here. I'll send a warm, simple reply.

You're welcome, Jared! We'll be in touch soon."

The RIGHT reply is only the message itself:
"You're welcome, Jared! We'll be in touch soon."

# You don't know anything or can't help with anything except for what is defined in the prompt and tool calls.`;

    // ── Which agent answers this reservation? ────────────────────────
    // Allowlisted reservations (ours and Tyler's) get the reworked agent so it
    // can be trialled against real messages; everyone else keeps the agent that
    // is live today. useV2 was resolved before the conversation was loaded,
    // because the two branches read the thread differently.
    const variant = useV2 ? "v2" : "v1";

    const activeTools = useV2 ? TOOLS : LEGACY_TOOLS;
    const activeSystemPrompt = useV2 ? systemPrompt : legacySystemPrompt;

    // Tagged so both variants can be filtered apart in the Trigger.dev dashboard.
    try {
      await tags.add(`agent:${variant}`);
    } catch (e) {
      logger.warn("Could not tag run with agent variant", { error: String(e) });
    }

    logger.info("Starting coordinator agent", {
      propertyName: property.name,
      agentVariant: variant,
      reservationUuid,
    });

    // ── Agent Loop: coordinator can call multiple tools in sequence ──
    const MAX_ITERATIONS = 5;
    let lastToolUsed = "";
    let replyText = "";

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: activeSystemPrompt,
        tools: activeTools,
        messages: agentMessages,
      });

      // Check if the AI produced a text reply (loop ends)
      const textBlock = response.content.find((b) => b.type === "text");
      const toolUseBlocks = response.content.filter(
        (b) => b.type === "tool_use"
      ) as (Anthropic.ContentBlockParam & { type: "tool_use"; name: string; input: any; id: string })[];

      // If no tool calls, extract text reply and exit loop
      if (toolUseBlocks.length === 0) {
        replyText = textBlock && "text" in textBlock ? textBlock.text : "";
        break;
      }

      // Process all tool calls in this response
      const toolResults: { type: "tool_result"; tool_use_id: string; content: string }[] = [];
      for (const toolUseBlock of toolUseBlocks) {
        const toolName = toolUseBlock.name;
        const toolInput = toolUseBlock.input as Record<string, string>;
        lastToolUsed = toolName;
        logger.info(`Agent loop iteration ${i + 1}: tool=${toolName}`, { input: toolInput });

        // Handle escalation (HARD STOP — Sub-Workflow D)
        if (toolName === "escalate_to_human") {
          await supabase.from("agent_activity_log").insert({
            property_id: agentCtx.propertyId,
            reservation_uuid: agentCtx.reservationUuid,
            action_type: "escalation",
          });
          await subWorkflowD(toolInput.reason, bundledMessage, agentCtx);
          return { status: "escalated", reason: toolInput.reason };
        }

        // Execute the appropriate sub-workflow
        let toolResult: string;

        switch (toolName) {
          case "use_knowledge_base": {
            const result = await subWorkflowA(toolInput.query, agentCtx);
            if (result === null) {
              // No KB entries at all → hard stop
              await supabase.from("agent_activity_log").insert({
                property_id: agentCtx.propertyId,
                reservation_uuid: agentCtx.reservationUuid,
                action_type: "escalation",
              });
              await subWorkflowD("Knowledge base had no answer", bundledMessage, agentCtx);
              return { status: "escalated", reason: "kb_no_answer" };
            }
            if (result.answer === "") {
              if (result.requiresMaintenance) {
                // KB had no answer but it's a maintenance issue → return to coordinator
                toolResult = "NO_ANSWER_FOUND — No troubleshooting info in the knowledge base for this issue. This appears to require maintenance.";
              } else {
                // Genuine KB gap → hard stop
                await supabase.from("agent_activity_log").insert({
                  property_id: agentCtx.propertyId,
                  reservation_uuid: agentCtx.reservationUuid,
                  action_type: "escalation",
                });
                await subWorkflowD("Knowledge base had no answer", bundledMessage, agentCtx);
                return { status: "escalated", reason: "kb_no_answer" };
              }
            } else {
              await supabase.from("agent_activity_log").insert({
                property_id: agentCtx.propertyId,
                reservation_uuid: agentCtx.reservationUuid,
                action_type: "kb_answer",
              });
              toolResult = result.answer;
            }
            break;
          }

          case "raise_maintenance_ticket": {
            toolResult = await subWorkflowB(
              toolInput.issue_description,
              toolInput.guest_context,
              agentCtx
            );
            await supabase.from("agent_activity_log").insert({
              property_id: agentCtx.propertyId,
              reservation_uuid: agentCtx.reservationUuid,
              action_type: "maintenance",
            });
            break;
          }

          case "process_extra_request": {
            toolResult = await subWorkflowC(toolInput.item_requested, agentCtx);
            await supabase.from("agent_activity_log").insert({
              property_id: agentCtx.propertyId,
              reservation_uuid: agentCtx.reservationUuid,
              action_type: "extra_request",
            });
            break;
          }

          case "handle_checkin_checkout": {
            toolResult = await subWorkflowE(
              toolInput.request_type,
              toolInput.requested_time,
              agentCtx,
              useV2
            );
            await supabase.from("agent_activity_log").insert({
              property_id: agentCtx.propertyId,
              reservation_uuid: agentCtx.reservationUuid,
              action_type: "checkin_checkout",
            });
            break;
          }

          default:
            logger.error("Unknown tool called", { tool: toolName });
            toolResult = "Unknown tool — cannot process.";
            break;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: toolResult,
        });
      }

      // Feed all tool results back to coordinator for next iteration
      agentMessages.push({
        role: "assistant",
        content: response.content as Anthropic.ContentBlockParam[],
      });

      agentMessages.push({
        role: "user",
        content: toolResults,
      });
    }

    if (!replyText) {
      logger.error("Agent produced no reply text");
      return { status: "error", reason: "no_reply_generated" };
    }

    // Append configurable footer
    const { data: footerSetting } = await getSupabaseClient()
      .from("agent_settings")
      .select("value")
      .eq("key", "message_footer")
      .single();
    const footer = footerSetting?.value ?? "\n\n—\nThis message was automatically sent by my AI agent. In case of emergency, please call 610-574-1334.";
    const finalReply = replyText + footer;

    // Send the reply via Hospitable
    try {
      await sendMessage(reservationUuid, finalReply);
      // Log the body, not just the length. Without this there is no way to audit
      // what a guest was actually told — language bugs and duplicate sends are
      // both invisible from a character count alone.
      logger.info("Reply sent to guest", {
        reservationUuid,
        replyLength: replyText.length,
        replyBody: replyText,
      });
    } catch (e) {
      logger.error("Failed to send reply via Hospitable", { error: String(e) });
      return { status: "error", reason: "hospitable_send_failed" };
    }

    return {
      status: "replied",
      tool: lastToolUsed,
      replyLength: replyText.length,
      agentVariant: variant,
    };
  },
});
