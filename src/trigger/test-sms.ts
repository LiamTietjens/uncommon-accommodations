import { task, logger } from "@trigger.dev/sdk";
import { sendSms } from "../lib/sms.js";

// Ops utility: send a one-off staff SMS through the prod Telnyx path
// (prod env vars + the sendSms length clamp), or check delivery status of
// a previous send. Trigger manually from the dashboard or MCP with
// { to, body } to send, or { checkId } to fetch delivery status.
// Not part of any guest workflow.
export const testSms = task({
  id: "test-sms",
  retry: { maxAttempts: 1 },
  run: async (payload: { to?: string; body?: string; checkId?: string }) => {
    if (payload.checkId) {
      const apiKey = process.env.TELNYX_API_KEY;
      if (!apiKey) throw new Error("Missing TELNYX_API_KEY");
      const res = await fetch(`https://api.telnyx.com/v2/messages/${payload.checkId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (!res.ok) throw new Error(`Telnyx status fetch failed: ${res.status} ${await res.text()}`);
      const data = (await res.json())?.data;
      return {
        checkId: payload.checkId,
        to: data?.to?.map((t: { phone_number: string; status: string }) => ({
          phone_number: t.phone_number,
          status: t.status,
        })),
        errors: data?.errors ?? [],
        sentAt: data?.sent_at ?? null,
        completedAt: data?.completed_at ?? null,
      };
    }

    if (!payload.to || !payload.body) {
      throw new Error("Provide { to, body } to send, or { checkId } to check delivery status");
    }
    const result = await sendSms(payload.to, payload.body);
    const to = result?.data?.to?.map((t: { phone_number: string; status: string }) => ({
      phone_number: t.phone_number,
      status: t.status,
    }));
    logger.info("Test SMS sent", { to: payload.to, telnyxId: result?.data?.id });
    return { telnyxId: result?.data?.id ?? null, to, parts: result?.data?.parts ?? null };
  },
});
