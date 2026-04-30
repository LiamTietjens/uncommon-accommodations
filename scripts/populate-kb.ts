import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ─── Config ──────────────────────────────────────────────────────────

const HOSPITABLE_BASE = "https://public.api.hospitable.com/v2";
const HOSPITABLE_TOKEN = process.env.HOSPITABLE_API_TOKEN!;
const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

// ─── Hospitable fetch ────────────────────────────────────────────────

interface HospitableProperty {
  id: string;
  name: string;
  public_name: string;
  summary: string;
  description: string;
  checkin: string;
  checkout: string;
  amenities: string[];
  capacity: { max: number; bedrooms: number; beds: number; bathrooms: number };
  house_rules: { pets_allowed: boolean; smoking_allowed: boolean; events_allowed: boolean };
  address: { display: string; city: string; state: string };
  details: {
    space_overview: string;
    guest_access: string;
    house_manual: string;
    other_details: string;
    additional_rules: string;
    neighborhood_description: string;
    getting_around: string;
    wifi_name: string;
    wifi_password: string;
  };
}

async function fetchAllHospitableProperties(): Promise<HospitableProperty[]> {
  const all: HospitableProperty[] = [];
  let page = 1;
  let lastPage = 1;

  do {
    const res = await fetch(
      `${HOSPITABLE_BASE}/properties?include=listings,details&page=${page}&per_page=100`,
      { headers: { Authorization: `Bearer ${HOSPITABLE_TOKEN}`, Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`Hospitable API error: ${res.status}`);
    const json = await res.json();
    all.push(...(json.data || []));
    lastPage = json.meta?.last_page || 1;
    page++;
  } while (page <= lastPage);

  return all;
}

// ─── Build raw knowledge text ────────────────────────────────────────

function buildRawKnowledge(p: HospitableProperty): string {
  const sections: string[] = [];

  sections.push(`Property: ${p.public_name || p.name}`);
  sections.push(`Location: ${p.address?.display || "N/A"}`);
  sections.push(`Check-in: ${p.checkin || "N/A"}, Check-out: ${p.checkout || "N/A"}`);
  sections.push(`Max guests: ${p.capacity?.max}, Bedrooms: ${p.capacity?.bedrooms}, Beds: ${p.capacity?.beds}, Bathrooms: ${p.capacity?.bathrooms}`);

  const rules = p.house_rules || {};
  sections.push(`House rules: Pets ${rules.pets_allowed ? "allowed" : "not allowed"}, Smoking ${rules.smoking_allowed ? "allowed" : "not allowed"}, Events ${rules.events_allowed ? "allowed" : "not allowed"}`);

  if (p.amenities?.length) {
    sections.push(`Amenities: ${p.amenities.map((a) => a.replace(/_/g, " ")).join(", ")}`);
  }

  if (p.details?.wifi_name) sections.push(`WiFi network: ${p.details.wifi_name}`);
  if (p.details?.wifi_password) sections.push(`WiFi password: ${p.details.wifi_password}`);

  const textFields: [string, string | undefined][] = [
    ["Summary", p.summary],
    ["Space Overview", p.details?.space_overview],
    ["House Manual", p.details?.house_manual],
    ["Guest Access", p.details?.guest_access],
    ["Neighborhood", p.details?.neighborhood_description],
    ["Getting Around / Parking", p.details?.getting_around],
    ["Additional Rules", p.details?.additional_rules],
    ["Other Details", p.details?.other_details],
  ];

  for (const [label, text] of textFields) {
    if (text?.trim()) sections.push(`--- ${label} ---\n${text.trim()}`);
  }

  return sections.join("\n\n");
}

// ─── Claude Q&A generation ───────────────────────────────────────────

interface QAPair {
  title: string;
  content: string;
  category: string;
}

async function generateQAPairs(propertyName: string, rawKnowledge: string): Promise<QAPair[]> {
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `You are given raw property data for a vacation rental called "${propertyName}". Generate a JSON array of Q&A pairs that a guest might ask.

Each pair must have:
- "title": A natural guest question (e.g. "What's the WiFi password?")
- "content": The answer, written in a friendly host voice. Include all relevant details.
- "category": One of: "general", "check-in", "amenity", "house-rules", "local-tips", "parking"

Guidelines:
- Cover ALL information present: WiFi, door codes, parking, check-in/out times, amenities, house rules, hot tub/sauna, HVAC, pets, local attractions, getting around, capacity, etc.
- Each distinct topic should be its own Q&A pair
- Only use information present in the data — do not invent answers
- If the data contains specific codes, passwords, or instructions, include them exactly
- Aim for 10-25 Q&A pairs depending on how much information is available
- Write answers as if you are the host speaking to a guest

Respond with ONLY a valid JSON array, no other text.

--- RAW PROPERTY DATA ---
${rawKnowledge}`,
      },
    ],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  // Extract JSON array from response (handle potential markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error(`Failed to parse Q&A JSON for ${propertyName}`);
  return JSON.parse(jsonMatch[0]);
}

// ─── Main ────────────────────────────────────────────────────────────

async function main() {
  console.log("Fetching properties from Hospitable...");
  const hospProperties = await fetchAllHospitableProperties();
  console.log(`Found ${hospProperties.length} properties in Hospitable`);

  // Get our Supabase properties for mapping
  const { data: supaProperties, error: spError } = await supabase
    .from("properties")
    .select("id, name, hospitable_property_uuid");
  if (spError) throw new Error(`Supabase query failed: ${spError.message}`);

  const supaMap = new Map(supaProperties!.map((p) => [p.hospitable_property_uuid, p]));

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const hp of hospProperties) {
    const sp = supaMap.get(hp.id);
    if (!sp) {
      console.log(`  SKIP: "${hp.name}" — not synced to Supabase`);
      totalSkipped++;
      continue;
    }

    // Check if KB entries already exist
    const { count } = await supabase
      .from("knowledge_bases")
      .select("id", { count: "exact", head: true })
      .eq("property_id", sp.id);

    if (count && count > 0) {
      console.log(`  SKIP: "${sp.name}" — already has ${count} KB entries`);
      totalSkipped++;
      continue;
    }

    console.log(`  Processing "${sp.name}"...`);
    const rawKnowledge = buildRawKnowledge(hp);

    const qaPairs = await generateQAPairs(hp.public_name || hp.name, rawKnowledge);
    console.log(`    Generated ${qaPairs.length} Q&A pairs`);

    // Insert into Supabase
    const rows = qaPairs.map((qa) => ({
      property_id: sp.id,
      title: qa.title,
      content: qa.content,
      category: qa.category,
    }));

    const { error: insertError } = await supabase.from("knowledge_bases").insert(rows);
    if (insertError) {
      console.error(`    ERROR inserting KB for "${sp.name}":`, insertError.message);
    } else {
      console.log(`    Inserted ${rows.length} KB entries for "${sp.name}"`);
      totalCreated += rows.length;
    }
  }

  console.log(`\nDone! Created ${totalCreated} KB entries, skipped ${totalSkipped} properties.`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
