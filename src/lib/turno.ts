const BASE_URL = "https://api.turno.com/v2";

function getHeaders(): Record<string, string> {
  const token = process.env.TURNO_API_KEY;
  if (!token) throw new Error("Missing TURNO_API_KEY");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const partnerId = process.env.TURNO_PARTNER_ID;
  if (partnerId) headers["TBNB-Partner-ID"] = partnerId;
  return headers;
}

export async function listProperties(page = 1, limit = 50) {
  const res = await fetch(`${BASE_URL}/properties?page=${page}&limit=${limit}&sort=alias&order=asc`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Turno GET properties failed: ${res.status} ${await res.text()}`);
  return res.json();
}

function formatLocalTime(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}

export function getLocalHour(timezone: string): { hour: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, parseInt(p.value, 10)])
  );
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour === 24 ? 0 : parts.hour };
}

export async function createProject(params: {
  propertyId: number;
  summary: string;
  cleanerDescription: string;
  timezone: string;
}) {
  const local = getLocalHour(params.timezone);
  const pad = (n: number) => String(n).padStart(2, "0");

  // begin = now in local timezone
  const beginFull = formatLocalTime(new Date(), params.timezone);
  const beginDate = beginFull.split(" ")[0]; // YYYY-MM-DD
  const beginTimeOnly = beginFull.split(" ")[1]; // HH:MM:SS

  // end depends on whether it's before or after 3pm local
  let endDate: string;
  let endTimeOnly: string;
  if (local.hour < 15) {
    // Before 3pm → end at 11:59 PM today (local)
    endDate = `${local.year}-${pad(local.month)}-${pad(local.day)}`;
    endTimeOnly = "23:59:00";
  } else {
    // 3pm or later → end at 2:59 PM next day (local)
    const tomorrow = new Date(local.year, local.month - 1, local.day + 1);
    endDate = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
    endTimeOnly = "14:59:00";
  }

  const res = await fetch(`${BASE_URL}/projects`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      property_id: params.propertyId,
      cleaner_description: params.cleanerDescription + "\n\nIGNORE THIS IS A TEST",
      begin_date: beginDate,
      begin_time: beginTimeOnly,
      end_date: endDate,
      end_time: endTimeOnly,
      project_type_id: 1,
      use_default_checklist: false,
      price: 0,
      publish: true,
    }),
  });
  if (!res.ok) throw new Error(`Turno POST project failed: ${res.status} ${await res.text()}`);
  return res.json();
}
