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

function getLocalDateParts(timezone: string): { year: number; month: number; day: number; hour: number } {
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

function localToUTC(timezone: string, year: number, month: number, day: number, hour: number): Date {
  // Build an ISO-like string in the target timezone, then resolve to UTC
  const pad = (n: number) => String(n).padStart(2, "0");
  const localStr = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:00:00`;
  // Use a formatter round-trip to find the UTC offset
  const guess = new Date(localStr + "Z");
  const fmtUTC = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hour12: false, day: "2-digit", month: "2-digit", year: "numeric" });
  const guessParts = Object.fromEntries(
    fmtUTC.formatToParts(guess).map((p) => [p.type, parseInt(p.value, 10)])
  );
  const guessHour = guessParts.hour === 24 ? 0 : guessParts.hour;
  // Offset = what we wanted - what we got (in hours)
  let offsetHours = hour - guessHour;
  let offsetDays = day - guessParts.day;
  if (offsetDays > 1) offsetDays = -1; // month wrap
  if (offsetDays < -1) offsetDays = 1;
  const totalOffsetMs = (offsetDays * 24 + offsetHours) * 60 * 60 * 1000;
  return new Date(guess.getTime() + totalOffsetMs);
}

export async function createProject(params: {
  propertyId: number;
  summary: string;
  cleanerDescription: string;
  timezone: string;
}) {
  const now = new Date();
  const local = getLocalDateParts(params.timezone);

  let endTime: Date;
  if (local.hour < 15) {
    // Before 3pm local → end at midnight tonight (00:00 same day = start of next day)
    endTime = localToUTC(params.timezone, local.year, local.month, local.day + 1, 0);
  } else {
    // 3pm or later → end at noon next day
    endTime = localToUTC(params.timezone, local.year, local.month, local.day + 1, 12);
  }

  const formatDate = (d: Date) =>
    d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  const res = await fetch(`${BASE_URL}/projects`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      property_id: params.propertyId,
      cleaner_description: params.summary + " — " + params.cleanerDescription + "\n\nIGNORE THIS IS A TEST",
      begin_time: formatDate(now),
      end_time: formatDate(endTime),
      project_type_id: 1,
      use_default_checklist: false,
      price: 0,
      publish: true,
    }),
  });
  if (!res.ok) throw new Error(`Turno POST project failed: ${res.status} ${await res.text()}`);
  return res.json();
}
