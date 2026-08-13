// Telnyx rejects any message that would exceed 10 SMS parts (error 40302) —
// the whole send fails, nothing is delivered. Our alert prefixes use emoji,
// which forces UCS-2 encoding at 67 chars per part, so the hard ceiling is
// 670 chars. We keep two full parts of safety buffer so prefix growth or
// encoding quirks can never push a message over the edge. JS .length counts
// UTF-16 code units, which matches UCS-2 part accounting exactly.
const TELNYX_MAX_PARTS = 10;
const UCS2_CHARS_PER_PART = 67;
const SAFETY_BUFFER_PARTS = 2;
export const SMS_MAX_CHARS = (TELNYX_MAX_PARTS - SAFETY_BUFFER_PARTS) * UCS2_CHARS_PER_PART; // 536
export const SMS_TRUNCATION_SUFFIX = "... (Read the full message on Hospitable)";

export function truncateForSms(text: string, maxChars: number = SMS_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const cut = Math.max(0, maxChars - SMS_TRUNCATION_SUFFIX.length);
  return text.slice(0, cut).trimEnd() + SMS_TRUNCATION_SUFFIX;
}

export async function sendSms(to: string, message: string) {
  const apiKey = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!apiKey) throw new Error("Missing TELNYX_API_KEY");
  if (!from) throw new Error("Missing TELNYX_FROM_NUMBER");

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    // Last-resort clamp — callers that compose structured bodies should
    // truncate their variable parts first (see notifyRecipients).
    body: JSON.stringify({ from, to, text: truncateForSms(message) }),
  });

  if (!res.ok) throw new Error(`Telnyx failed: ${res.status} ${await res.text()}`);
  return res.json();
}
