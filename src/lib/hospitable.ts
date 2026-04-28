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
  const res = await fetch(`${BASE_URL}/reservations/${uuid}?include=properties`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Hospitable GET reservation failed: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function getReservationMessages(uuid: string) {
  const res = await fetch(`${BASE_URL}/reservations/${uuid}/messages`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error(`Hospitable GET messages failed: ${res.status} ${await res.text()}`);
  return res.json();
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
