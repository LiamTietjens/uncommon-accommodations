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
    body: JSON.stringify({ from, to, text: message }),
  });

  if (!res.ok) throw new Error(`Telnyx failed: ${res.status} ${await res.text()}`);
  return res.json();
}
