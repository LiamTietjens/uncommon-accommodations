import { getSupabaseClient } from "./supabase.js";

export type AgentMode = "test" | "live";

export interface AgentModeConfig {
  mode: AgentMode;
  /** Reservations the agent is allowed to answer while in test mode. */
  testReservationUuids: string[];
}

/**
 * Reads the live/test switch from agent_settings on every run, so flipping the
 * toggle in the dashboard takes effect on the next guest message with no deploy.
 *
 * Fails closed: any read error leaves the agent in test mode rather than
 * silently going live to real guests.
 */
/**
 * Reservations that should run the reworked (v2) agent while everyone else stays
 * on the agent that is live today. Lets the rebuild be trialled against real
 * guest messages on our own two reservations before it reaches paying guests.
 *
 * Reads `v2_reservation_uuids` if that row exists, otherwise falls back to the
 * existing test-mode allowlist — so this needs no database change to start.
 * Add the row later if the two lists ever need to differ.
 *
 * Fails closed: any read error means nobody gets v2 and the live agent is
 * untouched.
 */
export async function getV2ReservationUuids(): Promise<string[]> {
  try {
    const { data, error } = await getSupabaseClient()
      .from("agent_settings")
      .select("key, value")
      .in("key", ["v2_reservation_uuids", "test_reservation_uuids"]);

    if (error || !data) return [];

    const settings = Object.fromEntries(data.map((r) => [r.key, r.value]));
    const raw = settings.v2_reservation_uuids ?? settings.test_reservation_uuids ?? "";

    return raw
      .split(/[\s,]+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

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
