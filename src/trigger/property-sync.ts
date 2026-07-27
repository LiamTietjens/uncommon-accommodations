import { task, logger } from "@trigger.dev/sdk";
import { getSupabaseClient } from "../lib/supabase.js";
import { listProperties as listTurnoProperties } from "../lib/turno.js";

const HOSPITABLE_BASE = "https://public.api.hospitable.com/v2";

function getHospitableHeaders(): Record<string, string> {
  const token = process.env.HOSPITABLE_API_TOKEN;
  if (!token) throw new Error("Missing HOSPITABLE_API_TOKEN");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

interface HospitableProperty {
  id: string;
  name?: string;
  internal_name?: string;
}

interface TurnoProperty {
  id: string;
  alias: string;
  external_property_id?: string;
}

export const propertySyncWorkflow = task({
  id: "property-sync-workflow",
  retry: { maxAttempts: 2 },
  run: async (_payload: Record<string, unknown>) => {
    const supabase = getSupabaseClient();
    let hospitableAdded = 0;
    let hospitableUpdated = 0;
    let turnoCached = 0;

    // ── Step 2: Fetch all properties from Hospitable ─────────────

    logger.info("Fetching properties from Hospitable...");
    const allHospitableProperties: HospitableProperty[] = [];
    let page = 1;
    let lastPage = 1;

    do {
      const res = await fetch(
        `${HOSPITABLE_BASE}/properties?include=listings,details&page=${page}&per_page=100`,
        { headers: getHospitableHeaders() }
      );
      if (!res.ok) throw new Error(`Hospitable GET properties failed: ${res.status}`);

      const json = await res.json();
      const items = json?.data || [];
      allHospitableProperties.push(...items);

      lastPage = json?.meta?.last_page || json?.last_page || 1;
      page++;
    } while (page <= lastPage);

    logger.info(`Fetched ${allHospitableProperties.length} properties from Hospitable`);

    // ── Step 3: Upsert into Supabase ─────────────────────────────

    for (const hp of allHospitableProperties) {
      const name = hp.name || hp.internal_name || `Property ${hp.id}`;

      const { data: existing } = await supabase
        .from("properties")
        .select("id")
        .eq("hospitable_property_uuid", hp.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("properties")
          .update({ name })
          .eq("id", existing.id);
        hospitableUpdated++;
      } else {
        await supabase.from("properties").insert({
          name,
          hospitable_property_uuid: hp.id,
          is_active: true,
        });
        hospitableAdded++;
      }
    }

    logger.info("Hospitable sync complete", { added: hospitableAdded, updated: hospitableUpdated });

    // ── Step 4: Fetch all properties from Turno ──────────────────

    let allTurnoProperties: TurnoProperty[] = [];

    try {
      logger.info("Fetching properties from Turno...");
      let turnoPage = 1;
      let turnoLastPage = 1;

      do {
        const turnoData = await listTurnoProperties(turnoPage, 50);
        const items = turnoData?.data?.items || [];
        allTurnoProperties.push(...items);
        turnoLastPage = turnoData?.data?.last_page || 1;
        turnoPage++;
      } while (turnoPage <= turnoLastPage);

      logger.info(`Fetched ${allTurnoProperties.length} properties from Turno`);
    } catch (e) {
      logger.warn("Turno fetch failed — skipping Turno mapping", { error: String(e) });
    }

    // ── Step 5: Cache the Turno list for the dashboard's mapping dropdown ─
    //
    // Deliberately does NOT auto-match. Name-similarity matching was removed because
    // "Unit 1" and "Unit 2" score 0.8 on Dice — well above the old 0.7 threshold — so a
    // property without an exact counterpart could silently bind to the wrong unit and
    // route guest extras to another unit's cleaner. Even exact-name matching is unsafe
    // once two properties share a name across buildings, or Turno holds duplicate
    // aliases. Mapping is now an explicit human choice in the dashboard.

    if (allTurnoProperties.length > 0) {
      const { error: turnoUpsertError } = await supabase.from("turno_properties").upsert(
        allTurnoProperties.map((tp) => ({
          id: String(tp.id),
          alias: tp.alias,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "id" }
      );

      if (turnoUpsertError) {
        logger.error("Failed to cache Turno properties", { error: turnoUpsertError.message });
      } else {
        turnoCached = allTurnoProperties.length;
        logger.info(`Cached ${turnoCached} Turno properties for manual mapping`);
      }
    }

    // Surface how many properties still need a human to pick their Turno counterpart
    const { count: unmappedCount } = await supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .is("turno_property_id", null);

    const result = {
      hospitable_properties_found: allHospitableProperties.length,
      added: hospitableAdded,
      updated: hospitableUpdated,
      turno_properties_found: allTurnoProperties.length,
      turno_properties_cached: turnoCached,
      properties_awaiting_mapping: unmappedCount ?? 0,
    };

    logger.info("Property sync complete", result);
    return result;
  },
});
