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

export async function createProject(params: {
  propertyId: number;
  summary: string;
  cleanerDescription: string;
}) {
  const now = new Date();
  const beginTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now
  const endTime = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4 hours from now

  const formatDate = (d: Date) =>
    d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  const res = await fetch(`${BASE_URL}/projects`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      property_id: params.propertyId,
      summary: params.summary,
      cleaner_description: params.cleanerDescription,
      begin_time: formatDate(beginTime),
      end_time: formatDate(endTime),
      project_type_id: 1,
      use_default_checklist: false,
      publish: true,
    }),
  });
  if (!res.ok) throw new Error(`Turno POST project failed: ${res.status} ${await res.text()}`);
  return res.json();
}
