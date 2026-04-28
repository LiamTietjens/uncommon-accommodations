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
    let turnoMapped = 0;

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

    // ── Step 5: Match Turno properties to Supabase by name ───────

    if (allTurnoProperties.length > 0) {
      const { data: supabaseProperties } = await supabase
        .from("properties")
        .select("id, name, turno_property_id")
        .eq("is_active", true);

      for (const tp of allTurnoProperties) {
        const match = (supabaseProperties || []).find(
          (sp) =>
            sp.name.toLowerCase().trim() === tp.alias.toLowerCase().trim() &&
            !sp.turno_property_id
        );

        if (match) {
          await supabase
            .from("properties")
            .update({ turno_property_id: String(tp.id) })
            .eq("id", match.id);
          turnoMapped++;
          logger.info("Turno property mapped", { name: tp.alias, turnoId: tp.id });
        }
      }
    }

    const result = {
      hospitable_properties_found: allHospitableProperties.length,
      added: hospitableAdded,
      updated: hospitableUpdated,
      turno_properties_found: allTurnoProperties.length,
      turno_mapped: turnoMapped,
    };

    logger.info("Property sync complete", result);
    return result;
  },
});
