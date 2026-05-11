import { task, logger } from "@trigger.dev/sdk";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseClient } from "../lib/supabase.js";
import { getReservation, getReservationMessages, sendMessage } from "../lib/hospitable.js";
import { createProject, getLocalHour } from "../lib/turno.js";
import { sendSms } from "../lib/sms.js";

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
  conversationHistory: { role: string; content: string }[];
  latestMessage: string;
  guestName: string;
  turnoPropertyId: string | null;
  timezone: string;
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

// ─── Sub-Workflow A: Knowledge Base Lookup ───────────────────────────

async function subWorkflowA(
  query: string,
  ctx: AgentContext
): Promise<string | null> {
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
  const historyText = ctx.conversationHistory
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  // A2: Call KB Answerer (AI Step #2)
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `# CRITICAL CONSTRAINT — READ THIS FIRST
You know NOTHING about this property, its amenities, rules, or surroundings except what is explicitly written in the KNOWLEDGE BASE section below. You have ZERO outside knowledge that is relevant here. If information is not in the knowledge base below, you do not know it and must not attempt to answer.

# Role
You are an information searcher. Your ONLY job is to look up answers in the knowledge base provided below and relay them to the guest. You are not a general assistant — you cannot help with anything outside of what is written below.

# Context
Property: ${ctx.propertyName}
Conversation history:
${historyText}

# KNOWLEDGE BASE (this is your ONLY source of truth)
${kbText}

# Step by Step
1. Read the guest's question carefully.
2. Search the knowledge base entries above for a relevant answer.
3. If you find an answer:
   - Write a warm, conversational reply in the guest's language.
   - If the KB entry includes a video_url or image_url, include it naturally in your reply.
   - Keep it concise. Don't over-explain.
4. If you CANNOT find the answer in the knowledge base:
   - Do NOT guess, infer, or use any general knowledge.
   - Do NOT try to be helpful by providing an approximate answer.
   - Respond with exactly: NO_ANSWER_FOUND
   - Add a brief reason on the next line.

# Output
Either a conversational reply to the guest (using ONLY content from the knowledge base above), or NO_ANSWER_FOUND followed by a reason. Nothing else.

# FINAL REMINDER
Only use the knowledge base provided in this prompt to answer. You have NO information outside of it. If the answer is not contained in the knowledge base above, you MUST output NO_ANSWER_FOUND. Never guess. Never use general knowledge. When in doubt, output NO_ANSWER_FOUND.`,
    messages: [{ role: "user", content: query }],
  });

  const answerBlock = response.content.find((b) => b.type === "text");
  const answer = answerBlock ? answerBlock.text : "";

  // A3: Check if answer was found
  if (answer.startsWith("NO_ANSWER_FOUND")) {
    logger.info("KB Answerer returned NO_ANSWER_FOUND — escalating");
    return null; // Triggers Sub-Workflow D
  }

  return answer;
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

  let smsSent = 0;
  if (recipients && recipients.length > 0) {
    const smsBody = `🔧 Maintenance [${urgency.toUpperCase()}] at ${ctx.propertyName}: ${issueDescription}`;
    for (const r of recipients) {
      try {
        await sendSms(r.phone, smsBody);
        smsSent++;
      } catch (e) {
        logger.error("SMS send failed", { recipient: r.name, error: String(e) });
      }
    }
  }

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

  // Determine delivery estimate based on local time
  const local = getLocalHour(ctx.timezone);
  const deliveryEstimate = local.hour < 15 ? "today by the end of the day" : "tomorrow by 3pm";

  if (ctx.turnoPropertyId) {
    try {
      const turnoResult = await createProject({
        propertyId: parseInt(ctx.turnoPropertyId, 10),
        summary: `Guest extra request: ${itemRequested}`,
        cleanerDescription: `${itemRequested}. Please deliver within the task window.`,
        timezone: ctx.timezone,
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
      const smsBody = `[AI Agent] Extra request approved: ${itemRequested} at ${ctx.propertyName}. No Turno property mapped - manual action needed.`;
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

  // D2: Set 8hr cooldown
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
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

  if (recipients && recipients.length > 0) {
    const smsBody = `⚠️ AI escalated at ${ctx.propertyName}: "${guestQuestion}". 8hr cooldown active. Please respond manually.`;
    for (const r of recipients) {
      try {
        await sendSms(r.phone, smsBody);
      } catch (e) {
        logger.error("SMS send failed", { recipient: r.name, error: String(e) });
      }
    }
  }

  logger.warn("Sub-Workflow D: HARD STOP — no reply to guest", {
    propertyId: ctx.propertyId,
    reason,
  });

  // D4: TERMINATE — no return, no reply
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
    const webhookPropertyUuid = (webhookData as any)?.property?.id;

    logger.info("Webhook received", { senderType, reservationUuid, hasBody: !!messageBody });

    // Filter out host messages
    if (senderType === "host") {
      logger.info("Host message — ignoring");
      return { status: "skipped", reason: "host_message" };
    }

    // --- TESTING FILTER: only process this reservation ---
    const ALLOWED_RESERVATION_UUID = "42ea05f3-41a4-4a8e-833d-3e7b974bb526";
    if (reservationUuid !== ALLOWED_RESERVATION_UUID) {
      logger.info(`Skipping reservation ${reservationUuid} — not in test allowlist`);
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

    // Step 2: Get property UUID (prefer webhook payload, fallback to reservation API)
    let propertyUuid: string | undefined = webhookPropertyUuid;
    let reservationData: any;

    if (!propertyUuid) {
      try {
        reservationData = await getReservation(reservationUuid);
        const included = reservationData?.included || [];
        const propertyData = included.find((i: any) => i.type === "property" || i.type === "properties");
        propertyUuid = propertyData?.id || reservationData?.data?.relationships?.properties?.data?.[0]?.id;
        if (!propertyUuid) {
          propertyUuid = reservationData?.data?.property_uuid || reservationData?.data?.property_id;
        }
      } catch (e) {
        logger.error("Failed to fetch reservation from Hospitable", { error: String(e) });
      }
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
    let conversationHistory: { role: string; content: string }[] = [];
    try {
      const messagesData = await getReservationMessages(reservationUuid);
      const messages = messagesData?.data || [];
      conversationHistory = messages.map((m: any) => ({
        role: m.sender_type === "guest" ? "guest" : "host",
        content: m.body || "",
      }));
    } catch (e) {
      logger.warn("Failed to fetch conversation history — continuing with latest message only", {
        error: String(e),
      });
      conversationHistory = [{ role: "guest", content: messageBody }];
    }

    // Build agent context
    const agentCtx: AgentContext = {
      propertyId: property.id,
      propertyName: property.name,
      reservationUuid,
      conversationHistory,
      latestMessage: messageBody,
      guestName,
      turnoPropertyId: property.turno_property_id,
      timezone: property.timezone || "America/New_York",
    };

    // ── Phase 2: Agent Loop ─────────────────────────────────────────

    const historyText = conversationHistory
      .map((m) => `${m.role === "guest" ? "Guest" : "Host"}: ${m.content}`)
      .join("\n");

    // Step 6: Start the agent loop
    const anthropic = new Anthropic();

    const agentMessages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Here is the conversation so far:\n\n${historyText}\n\nThe guest's latest message is:\n"${messageBody}"`,
      },
    ];

    const systemPrompt = `# You don't know anything or can't help with anything except for what's inside this prompt and the tool calls.

# Role
You are an AI that responds to guest questions and handles the inbox of Uncommon Accommodations short-term rentals business.

# Output
Your reply is sent DIRECTLY to the guest. Whatever you write, the guest reads.
Never include internal reasoning, chain of thought, analysis, or notes about
what you're doing. Only write what you'd want the guest to see.

# Language
- Detect the language the guest is writing in and reply in that same language.
- Warm, conversational answers with human touches.
- Avoid using the long "—" and write in fluid human like sentences.

# Context
Guests are messaging you through either Airbnb, Booking.com, another channel platform, or email because they've booked a stay and have a question, a maintenance request, or a request for a special item.

Property: ${property.name}
Guest name: ${guestName}

# Step by Step
1. Read the full conversation to understand context and tone.
2. Focus on the guest's latest message.
3. Classify the request and call the appropriate tool:
   - use_knowledge_base — ALWAYS call this first for any question or issue,
     including when a guest reports something not working (e.g. fireplace,
     thermostat, appliance, TV). The KB often has operating instructions
     or troubleshooting steps that solve the problem without maintenance.
   - raise_maintenance_ticket — Guest is reporting something broken,
     leaking, not working, damaged, or requiring physical repair AND
     either the knowledge base had no relevant troubleshooting info,
     or the conversation shows the guest already tried the suggested
     troubleshooting steps and the problem persists.
   - process_extra_request — Guest is requesting an additional item
     or service (towels, toiletries, blankets, pillows, etc.)
   - escalate_to_human — The request doesn't fit any category above,
     or it's a complaint, billing issue, or something you can't handle.

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

This does NOT apply to use_knowledge_base or escalate_to_human. Those can be
called immediately without confirmation.

4. After receiving the tool result, decide what to do:
   - If the tool result indicates escalation — do NOT reply to the guest. Stay silent.
   - Otherwise — compose a warm, concise reply to the guest based on the tool result.
     Do not mention internal systems, tickets, tools, or databases.`;

    logger.info("Starting coordinator agent", { propertyName: property.name });

    // ── Agent Loop: coordinator can call multiple tools in sequence ──
    const MAX_ITERATIONS = 5;
    let lastToolUsed = "";
    let replyText = "";

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
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
          await subWorkflowD(toolInput.reason, messageBody, agentCtx);
          return { status: "escalated", reason: toolInput.reason };
        }

        // Execute the appropriate sub-workflow
        let toolResult: string;

        switch (toolName) {
          case "use_knowledge_base": {
            const answer = await subWorkflowA(toolInput.query, agentCtx);
            toolResult = answer ?? "No relevant information found in the knowledge base for this query.";
            break;
          }

          case "raise_maintenance_ticket": {
            toolResult = await subWorkflowB(
              toolInput.issue_description,
              toolInput.guest_context,
              agentCtx
            );
            break;
          }

          case "process_extra_request": {
            toolResult = await subWorkflowC(toolInput.item_requested, agentCtx);
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

    // Append AI disclaimer footer
    const footer = "\n\n—\nThis message was automatically sent by my AI agent. In case of emergency, please call 610-574-1334.";
    const finalReply = replyText + footer;

    // Send the reply via Hospitable
    try {
      await sendMessage(reservationUuid, finalReply);
      logger.info("Reply sent to guest", { reservationUuid, replyLength: replyText.length });
    } catch (e) {
      logger.error("Failed to send reply via Hospitable", { error: String(e) });
      return { status: "error", reason: "hospitable_send_failed" };
    }

    return {
      status: "replied",
      tool: lastToolUsed,
      replyLength: replyText.length,
    };
  },
});
