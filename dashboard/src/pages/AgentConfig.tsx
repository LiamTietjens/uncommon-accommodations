import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Pencil, Check, X } from "lucide-react";

interface UrgencyCategory { id: string; level: string; description: string; examples: string; response_time: string; }

const levelColor: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-green-100 text-green-800 border-green-300",
};
const levelOrder = ["high", "medium", "low"];
const levelLabel: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

type Tab = "urgency" | "extras";
const tabs: { key: Tab; label: string }[] = [
  { key: "urgency", label: "Urgency Levels" },
  { key: "extras", label: "Allowed Extras" },
];

export default function AgentConfig() {
  const [tab, setTab] = useState<Tab>("urgency");

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Agent Config</h1>
      <p className="text-base text-gray-400 mb-6">Configure how the AI agent classifies urgency and handles extra requests.</p>

      <div className="flex gap-1.5 mb-8 border-b border-gray-200 pb-px">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-5 py-2.5 text-base font-medium rounded-t-lg border-b-2 transition-colors ${
              tab === t.key ? "border-gray-900 text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "urgency" && <UrgencyTab />}
      {tab === "extras" && <AllowedExtrasTab />}
    </div>
  );
}

function UrgencyTab() {
  const [categories, setCategories] = useState<UrgencyCategory[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [examples, setExamples] = useState("");

  const load = () => {
    supabase.from("urgency_categories").select("*").in("level", ["low", "medium", "high"]).order("level")
      .then(({ data }) => {
        const sorted = (data ?? []).sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));
        setCategories(sorted);
      });
  };
  useEffect(load, []);

  const save = async () => {
    if (!editing) return;
    await supabase.from("urgency_categories").update({ examples }).eq("id", editing);
    setEditing(null);
    load();
  };

  return (
    <div>
      <p className="text-base text-gray-400 mb-5">Add examples for each urgency level so the AI knows how to classify maintenance issues.</p>
      <div className="space-y-4">
        {categories.map((c) => (
          <div key={c.id} className={`border rounded-xl p-6 ${levelColor[c.level] ?? "bg-white border-gray-200"}`}>
            {editing === c.id ? (
              <div>
                <div className="text-lg font-semibold mb-4">{levelLabel[c.level]}</div>
                <label className="block mb-5">
                  <span className="text-sm font-medium opacity-70">Examples</span>
                  <textarea value={examples} onChange={(e) => setExamples(e.target.value)} rows={3}
                    className="mt-1.5 w-full px-4 py-3 text-base border rounded-lg bg-white/80 resize-y"
                    placeholder="e.g. Lightbulb out, squeaky door, minor stain..." />
                </label>
                <div className="flex gap-3">
                  <button onClick={save} className="flex items-center gap-2 px-4 py-1.5 text-sm bg-white/80 rounded-lg hover:bg-white"><Check size={18} /> Save</button>
                  <button onClick={() => setEditing(null)} className="flex items-center gap-2 px-4 py-1.5 text-sm opacity-60 hover:opacity-100"><X size={18} /> Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-semibold">{levelLabel[c.level]}</div>
                  <div className="text-base mt-2 opacity-80">{c.examples || "No examples yet — add some so the AI can classify issues."}</div>
                </div>
                <button onClick={() => { setEditing(c.id); setExamples(c.examples); }} className="p-2 opacity-40 hover:opacity-80"><Pencil size={20} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface DeclinedExtra {
  id: string;
  item_requested: string;
  created_at: string;
  properties?: { name: string };
}

function AllowedExtrasTab() {
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(true);
  const [saving, setSaving] = useState(false);
  const [declined, setDeclined] = useState<DeclinedExtra[]>([]);

  const loadAllowed = () => {
    supabase.from("allowed_extras").select("item_name").eq("is_active", true).order("item_name")
      .then(({ data }) => {
        const bullets = (data ?? []).map((e) => `• ${e.item_name}`).join("\n");
        setText(bullets);
      });
  };

  const loadDeclined = () => {
    supabase.from("extra_requests").select("id, item_requested, created_at, properties(name)")
      .eq("status", "declined").order("created_at", { ascending: false })
      .then(({ data }) => setDeclined((data as unknown as DeclinedExtra[]) ?? []));
  };

  useEffect(() => { loadAllowed(); loadDeclined(); }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const target = e.currentTarget;
      const pos = target.selectionStart;
      const before = text.slice(0, pos);
      const after = text.slice(pos);
      const newText = before + "\n• " + after;
      setText(newText);
      setSaved(false);
      setTimeout(() => { target.selectionStart = target.selectionEnd = pos + 3; }, 0);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    setSaved(false);
  };

  const handleFocus = (_e: React.FocusEvent<HTMLTextAreaElement>) => {
    if (!text) { setText("• "); setSaved(false); }
  };

  const save = async () => {
    setSaving(true);
    const items = text.split("\n")
      .map((line) => line.replace(/^[•\-\*]\s*/, "").trim())
      .filter(Boolean);

    await supabase.from("allowed_extras").delete().eq("is_active", true);

    if (items.length > 0) {
      await supabase.from("allowed_extras").insert(items.map((item_name) => ({ item_name, is_active: true })));
    }

    setSaving(false);
    setSaved(true);
  };

  const approveDeclined = async (d: DeclinedExtra) => {
    // Add to allowed list
    const newText = text ? text + "\n• " + d.item_requested : "• " + d.item_requested;
    setText(newText);
    setSaved(false);
    // Remove from declined log
    await supabase.from("extra_requests").delete().eq("id", d.id);
    loadDeclined();
  };

  const dismissDeclined = async (id: string) => {
    await supabase.from("extra_requests").delete().eq("id", id);
    loadDeclined();
  };

  return (
    <div>
      <p className="text-base text-gray-400 mb-5">List what extras guests can request. One item per bullet point.</p>

      {/* Declined requests — top of mind */}
      {declined.length > 0 && (
        <div className="mb-6">
          <h3 className="text-base font-semibold text-gray-900 mb-3">Guest Requested but Not Allowed ({declined.length})</h3>
          <div className="space-y-2">
            {declined.map((d) => (
              <div key={d.id} className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 flex items-center justify-between">
                <div>
                  <div className="text-base text-gray-800">"{d.item_requested}"</div>
                  <div className="text-sm text-gray-400">
                    {(d.properties as any)?.name} &mdash; {new Date(d.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => approveDeclined(d)}
                    className="px-3 py-1.5 text-sm font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100">
                    Allow
                  </button>
                  <button onClick={() => dismissDeclined(d.id)}
                    className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600">
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <textarea value={text} onChange={handleChange} onKeyDown={handleKeyDown} onFocus={handleFocus} rows={12}
        className="w-full px-5 py-4 text-base border border-gray-200 rounded-xl bg-white resize-y leading-relaxed font-normal focus:outline-none focus:ring-2 focus:ring-gray-300"
        placeholder="• Early check-in&#10;• Late checkout&#10;• Extra towels&#10;• Baby crib" />

      <div className="flex items-center gap-4 mt-4">
        <button onClick={save} disabled={saved || saving}
          className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
          <Check size={18} /> {saving ? "Saving..." : "Save"}
        </button>
        {saved && <span className="text-sm text-gray-400">All changes saved</span>}
      </div>
    </div>
  );
}
