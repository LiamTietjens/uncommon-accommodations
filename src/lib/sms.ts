export async function sendSms(to: string, message: string) {
  const token = process.env.SMSAPI_TOKEN;
  const from = process.env.SMSAPI_SENDER_NAME;
  if (!token) throw new Error("Missing SMSAPI_TOKEN");

  const params = new URLSearchParams({
    to,
    message,
    format: "json",
    ...(from ? { from } : {}),
  });

  const res = await fetch("https://api.smsapi.com/sms.do", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`SMSAPI failed: ${res.status} ${await res.text()}`);
  return res.json();
}
