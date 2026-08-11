import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { supabase } from "./supabase";

export type AgentMode = "test" | "live";

interface AgentModeState {
  mode: AgentMode;
  testReservationUuids: string;
  changedAt: string;
  changedBy: string;
  loading: boolean;
  /** Writes the new mode plus its audit trail. Rejected by RLS for non-admins. */
  setMode: (mode: AgentMode, actorEmail: string) => Promise<{ error: string | null }>;
  setTestReservationUuids: (value: string) => Promise<{ error: string | null }>;
  refresh: () => Promise<void>;
}

const MODE_KEYS = [
  "agent_mode",
  "test_reservation_uuids",
  "agent_mode_changed_at",
  "agent_mode_changed_by",
];

const AgentModeContext = createContext<AgentModeState | null>(null);

export function AgentModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<AgentMode>("test");
  const [testReservationUuids, setUuids] = useState("");
  const [changedAt, setChangedAt] = useState("");
  const [changedBy, setChangedBy] = useState("");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await supabase.from("agent_settings").select("key, value").in("key", MODE_KEYS);
    const settings = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    setModeState(settings.agent_mode === "live" ? "live" : "test");
    setUuids(settings.test_reservation_uuids ?? "");
    setChangedAt(settings.agent_mode_changed_at ?? "");
    setChangedBy(settings.agent_mode_changed_by ?? "");
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const setMode = useCallback(
    async (next: AgentMode, actorEmail: string) => {
      const { error } = await supabase
        .from("agent_settings")
        .update({ value: next })
        .eq("key", "agent_mode")
        .select();

      if (error) return { error: error.message };

      // The update silently affects zero rows when RLS blocks a non-admin, so
      // confirm the write landed before reporting success.
      const { data: check } = await supabase
        .from("agent_settings")
        .select("value")
        .eq("key", "agent_mode")
        .single();

      if (check?.value !== next) {
        return { error: "Not permitted — only admins can change the agent mode." };
      }

      await supabase
        .from("agent_settings")
        .update({ value: new Date().toISOString() })
        .eq("key", "agent_mode_changed_at");
      await supabase
        .from("agent_settings")
        .update({ value: actorEmail })
        .eq("key", "agent_mode_changed_by");

      await refresh();
      return { error: null };
    },
    [refresh]
  );

  const setTestReservationUuids = useCallback(
    async (value: string) => {
      const { error } = await supabase
        .from("agent_settings")
        .update({ value })
        .eq("key", "test_reservation_uuids");
      if (error) return { error: error.message };
      await refresh();
      return { error: null };
    },
    [refresh]
  );

  return (
    <AgentModeContext.Provider
      value={{
        mode,
        testReservationUuids,
        changedAt,
        changedBy,
        loading,
        setMode,
        setTestReservationUuids,
        refresh,
      }}
    >
      {children}
    </AgentModeContext.Provider>
  );
}

export function useAgentMode() {
  const ctx = useContext(AgentModeContext);
  if (!ctx) throw new Error("useAgentMode must be inside AgentModeProvider");
  return ctx;
}
