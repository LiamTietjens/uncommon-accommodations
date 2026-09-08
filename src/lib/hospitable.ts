const BASE_URL = "https://public.api.hospitable.com/v2";

function getHeaders(): Record<string, string> {
  const token = process.env.HOSPITABLE_API_TOKEN;
  if (!token) throw new Error("Missing HOSPITABLE_API_TOKEN");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export async function getReservation(uuid: string) {
  const res = await fetch(`${BASE_URL}/reservations/${uuid}?include=properties,guest`, {
    headers: getHeaders(),
    // Without this, a hung connection blocks for undici's 300s default — the same
    // as the task's maxDuration — and the run dies before any SMS is sent.
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Hospitable GET reservation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Thrown when Hospitable refuses a call on the per-reservation messages path.
 *
 * That path is capped at 2 requests per ~30s window, per reservation, and reads
 * count against it as well as sends — measured, not documented; their docs
 * describe the limit as applying to sending only. A guest sending two messages
 * in quick succession is therefore enough to get the conversation-history load
 * refused, which is exactly when we most need it.
 *
 * Hospitable tells us how long to wait, so callers can honour it instead of
 * giving up. Inside a Trigger.dev task that wait is checkpointed, so it costs
 * wall-clock only.
 */
export class HospitableRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Hospitable rate limited; retry after ${retryAfterSeconds}s`);
    this.name = "HospitableRateLimitError";
  }
}

export async function getReservationMessages(uuid: string) {
  const res = await fetch(`${BASE_URL}/reservations/${uuid}/messages`, {
    headers: getHeaders(),
    // Matches getReservation: without it a hung connection blocks for undici's
    // 300s default, which is the task's whole maxDuration.
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 429) {
    // Fall back to a little over one window if the header is missing or junk.
    const raw = Number(res.headers.get("retry-after"));
    throw new HospitableRateLimitError(Number.isFinite(raw) && raw > 0 ? raw : 31);
  }
  if (!res.ok) throw new Error(`Hospitable GET messages failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export function extractReservationDates(reservationData: any): {
  checkIn: string | null;
  checkOut: string | null;
} {
  const data = reservationData?.data?.attributes || reservationData?.data || reservationData || {};
  const checkIn =
    data.check_in || data.checkin || data.arrival_date || data.start_date || null;
  const checkOut =
    data.check_out || data.checkout || data.departure_date || data.end_date || null;
  return { checkIn, checkOut };
}

// Formats a check-in date for display, e.g. "Sun, Jul 26".
// Hospitable returns property-local timestamps with an offset ("2026-07-26T17:00:00-04:00"),
// so we slice the date portion and pin formatting to UTC — building a local Date here
// would shift the day for some offsets.
export function formatCheckInDate(date: string | null): string | null {
  const datePart = date?.split(" ")[0]?.split("T")[0];
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  const [y, m, d] = datePart.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  // Date.UTC silently rolls over out-of-range parts (2026-13-45 -> Feb 14), so verify
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export async function sendMessage(reservationUuid: string, body: string) {
  const res = await fetch(`${BASE_URL}/reservations/${reservationUuid}/messages`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) throw new Error(`Hospitable POST message failed: ${res.status} ${await res.text()}`);
  return res.json();
}
