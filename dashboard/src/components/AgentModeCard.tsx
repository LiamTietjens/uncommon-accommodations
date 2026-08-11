import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { useAgentMode, type AgentMode } from "../lib/agentMode";
import { FlaskConical, Radio, TriangleAlert, Check, X, Pencil } from "lucide-react";

export default function AgentModeCard() {
  const { profile, isSuperAdmin } = useAuth();
  const { mode, changedAt, changedBy, loading, setMode } = useAgentMode();
  const [confirming, setConfirming] = useState<AgentMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) return null;

  const isLive = mode === "live";
  const target: AgentMode = isLive ? "test" : "live";

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const { error } = await setMode(target, profile?.email ?? "unknown");
    setSaving(false);
    if (error) setError(error);
    else setConfirming(null);
  };

  return (
    <>
      <div
        className={`rounded-xl border px-6 py-5 mb-8 ${
          isLive ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
        }`}
      >
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-4">
            <div className={isLive ? "text-green-600 mt-0.5" : "text-amber-600 mt-0.5"}>
              {isLive ? <Radio size={26} strokeWidth={1.5} /> : <FlaskConical size={26} strokeWidth={1.5} />}
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-semibold text-gray-900">
                  {isLive ? "Live Mode" : "Test Mode"}
                </h2>
                <span
                  className={`px-2.5 py-0.5 text-xs font-semibold rounded-full tracking-wide ${
                    isLive ? "bg-green-600 text-white" : "bg-amber-500 text-white"
                  }`}
                >
                  {isLive ? "LIVE" : "TEST"}
                </span>
              </div>
              <p className="text-base text-gray-600 mt-1.5 max-w-2xl leading-relaxed">
                {isLive
                  ? "The AI agent is replying to every guest across all properties, and Turno tasks are sent to cleaners as real jobs."
                  : "The AI agent only replies to the test reservations listed below. Turno tasks are tagged “IGNORE THIS IS A TEST” so cleaners skip them."}
              </p>
              {changedAt && (
                <p className="text-sm text-gray-400 mt-2">
                  Last changed {new Date(changedAt).toLocaleString()}
                  {changedBy ? ` by ${changedBy}` : ""}
                </p>
              )}
            </div>
          </div>

          {isSuperAdmin ? (
            <button
              onClick={() => { setError(null); setConfirming(target); }}
              className={`px-5 py-2.5 text-base font-medium rounded-lg text-white shrink-0 ${
                isLive ? "bg-gray-900 hover:bg-gray-800" : "bg-green-600 hover:bg-green-700"
              }`}
            >
              {isLive ? "Switch to Test Mode" : "Go Live"}
            </button>
          ) : (
            <span className="text-sm text-gray-400 shrink-0 self-center">Admins only</span>
          )}
        </div>

        {!isLive && isSuperAdmin && <TestAllowlist />}
      </div>

      {confirming && (
        <ConfirmDialog
          target={confirming}
          saving={saving}
          error={error}
          onCancel={() => setConfirming(null)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  target,
  saving,
  error,
  onCancel,
  onConfirm,
}: {
  target: AgentMode;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const goingLive = target === "live";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6" onClick={onCancel}>
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-7 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <div className={goingLive ? "text-red-500 mt-0.5" : "text-amber-500 mt-0.5"}>
            <TriangleAlert size={26} strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              {goingLive ? "Go live to real guests?" : "Switch back to test mode?"}
            </h3>
            <p className="text-base text-gray-600 mt-2 leading-relaxed">
              {goingLive
                ? "The AI agent will start replying to every guest message on every property — not just the test reservations. Turno tasks will be sent to cleaners as real jobs, without the test warning."
                : "The AI agent will stop replying to real guests. It will only answer the reservations on the test allowlist, and Turno tasks will be tagged as tests again."}
            </p>
            <p className="text-sm text-gray-400 mt-3">
              Takes effect on the next guest message. No deploy needed.
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-5 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 mt-7">
          <button onClick={onCancel} className="px-5 py-2.5 text-base text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={saving}
            className={`px-5 py-2.5 text-base font-medium text-white rounded-lg disabled:opacity-50 ${
              goingLive ? "bg-green-600 hover:bg-green-700" : "bg-gray-900 hover:bg-gray-800"
            }`}
          >
            {saving ? "Switching..." : goingLive ? "Yes, go live" : "Yes, switch to test"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TestAllowlist() {
  const { testReservationUuids, setTestReservationUuids } = useAgentMode();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const uuids = testReservationUuids.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  const save = async () => {
    setSaving(true);
    await setTestReservationUuids(
      text.split(/[\s,\n]+/).map((s) => s.trim()).filter(Boolean).join(",")
    );
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="mt-5 pt-5 border-t border-amber-200">
      <div className="flex items-center justify-between mb-2.5">
        <h4 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
          Test Reservations ({uuids.length})
        </h4>
        {!editing && (
          <button
            onClick={() => { setText(uuids.join("\n")); setEditing(true); }}
            className="p-1.5 text-gray-400 hover:text-gray-600"
          >
            <Pencil size={18} />
          </button>
        )}
      </div>

      {editing ? (
        <div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="One Hospitable reservation UUID per line"
            className="w-full px-4 py-3 text-sm font-mono border border-amber-200 rounded-lg bg-white resize-y focus:outline-none focus:ring-2 focus:ring-amber-300"
          />
          <div className="flex gap-3 mt-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-1.5 text-sm bg-white border border-amber-200 rounded-lg hover:bg-amber-50 disabled:opacity-50"
            >
              <Check size={18} /> {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="flex items-center gap-2 px-4 py-1.5 text-sm text-gray-400 hover:text-gray-600"
            >
              <X size={18} /> Cancel
            </button>
          </div>
        </div>
      ) : uuids.length > 0 ? (
        <ul className="space-y-1">
          {uuids.map((u) => (
            <li key={u} className="text-sm font-mono text-gray-500">{u}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-500">
          No test reservations — the agent will not reply to anyone while in test mode.
        </p>
      )}
    </div>
  );
}
