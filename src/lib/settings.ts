import { getSupabaseClient } from "./supabase.js";

export type AgentMode = "test" | "live";

export interface AgentModeConfig {
  mode: AgentMode;
  /** Reservations the agent is allowed to answer while in test mode. */
  testReservationUuids: string[];
}

/**
 * Which agent answers this reservation.
 *
 * v2 is the default for every guest as of the rollout on 2026-09-09. v1 is kept
 * only as a rollback path, reachable two ways without a deploy:
 *
 *   agent_variant = "v1"        sends every reservation back to the old agent
 *   v1_reservation_uuids = ...  pins named reservations to it, leaving the rest
 *
 * Read fresh on every run, so either takes effect on the next guest message.
 *
 * Fails open to v2: if the settings read fails we want the variant that stops
 * rather than replying on a conversation it could not fully read. Falling back
 * to v1 here would restore the truncated-history bug precisely when the
 * database is already misbehaving.
 */
export async function getAgentVariant(reservationUuid: string): Promise<"v1" | "v2"> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("agent_settings")
      .select("key, value")
      .in("key", ["agent_variant", "v1_reservation_uuids"]);

    if (error || !data) return "v2";

    const settings = Object.fromEntries(data.map((r) => [r.key, r.value]));

    if (settings.agent_variant === "v1") return "v1";

    const pinnedToV1 = (settings.v1_reservation_uuids ?? "")
      .split(/[\s,]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);

    return pinnedToV1.includes(reservationUuid) ? "v1" : "v2";
  } catch {
    return "v2";
  }
}

/**
 * Reads the live/test switch from agent_settings on every run, so flipping the
 * toggle in the dashboard takes effect on the next guest message with no deploy.
 *
 * Fails closed: any read error leaves the agent in test mode rather than
 * silently going live to real guests.
 */
export async function getAgentMode(): Promise<AgentModeConfig> {
  const fallback: AgentModeConfig = { mode: "test", testReservationUuids: [] };

  try {
    const { data, error } = await getSupabaseClient()
      .from("agent_settings")
      .select("key, value")
      .in("key", ["agent_mode", "test_reservation_uuids"]);

    if (error || !data) return fallback;

    const settings = Object.fromEntries(data.map((r) => [r.key, r.value]));

    return {
      mode: settings.agent_mode === "live" ? "live" : "test",
      testReservationUuids: (settings.test_reservation_uuids ?? "")
        .split(/[\s,]+/)
        .map((s: string) => s.trim())
        .filter(Boolean),
    };
  } catch {
    return fallback;
  }
}
