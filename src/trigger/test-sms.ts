import { task, logger } from "@trigger.dev/sdk";
import { sendSms } from "../lib/sms.js";

// Ops utility: send a one-off staff SMS through the prod Telnyx path
// (prod env vars + the sendSms length clamp). Trigger manually from the
// dashboard or MCP with { to, body }. Not part of any guest workflow.
export const testSms = task({
  id: "test-sms",
  retry: { maxAttempts: 1 },
  run: async (payload: { to: string; body: string }) => {
    const result = await sendSms(payload.to, payload.body);
    const to = result?.data?.to?.map((t: { phone_number: string; status: string }) => ({
      phone_number: t.phone_number,
      status: t.status,
    }));
    logger.info("Test SMS sent", { to: payload.to, telnyxId: result?.data?.id });
    return { telnyxId: result?.data?.id ?? null, to, parts: result?.data?.parts ?? null };
  },
});
