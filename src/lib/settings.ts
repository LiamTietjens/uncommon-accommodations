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
