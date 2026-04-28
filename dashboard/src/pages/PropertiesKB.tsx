import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { RefreshCw, Plus, Pencil, Trash2, X, Check, HelpCircle } from "lucide-react";

interface Property {
  id: string;
  name: string;
  hospitable_property_uuid: string;
  turno_property_id: string | null;
  is_active: boolean;
}

interface KBEntry {
  id: string;
  property_id: string;
  title: string;
  content: string;
  video_url: string | null;
  image_url: string | null;
  category: string;
}

interface GapEntry {
  id: string;
  property_id: string;
  guest_question: string;
  created_at: string;
}

export default function PropertiesKB() {
  const { isSuperAdmin } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // KB state
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [gaps, setGaps] = useState<GapEntry[]>([]);
  const [editing, setEditing] = useState<KBEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const loadProperties = () => {
    supabase.from("properties").select("*").order("name").then(({ data }) => {
      setProperties(data ?? []);
    });
  };

  useEffect(loadProperties, []);

  const loadKB = () => {
    if (!selectedId) { setEntries([]); setGaps([]); return; }
    supabase.from("knowledge_bases").select("*").eq("property_id", selectedId).order("title")
      .then(({ data }) => setEntries((data as KBEntry[]) ?? []));
    supabase.from("kb_gap_log").select("*").eq("property_id", selectedId).order("created_at", { ascending: false })
      .then(({ data }) => setGaps((data as GapEntry[]) ?? []));
  };

  useEffect(loadKB, [selectedId]);

  const syncProperties = async () => {
    setSyncing(true);
    try {
      const triggerKey = import.meta.env.VITE_TRIGGER_SECRET_KEY;
      if (!triggerKey) {
        alert("VITE_TRIGGER_SECRET_KEY not set — trigger sync from Trigger.dev dashboard instead.");
        return;
      }
      await fetch("https://api.trigger.dev/api/v1/tasks/property-sync-workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${triggerKey}` },
        body: JSON.stringify({ payload: {} }),
      });
      alert("Property sync triggered. Refresh in a minute to see results.");
    } catch {
      alert("Sync failed. Try from the Trigger.dev dashboard.");
    } finally {
      setSyncing(false);
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("properties").update({ is_active: !current }).eq("id", id);
    loadProperties();
  };

  const saveEntry = async (entry: Partial<KBEntry> & { id?: string }) => {
    if (entry.id) {
      await supabase.from("knowledge_bases").update({
        title: entry.title, content: entry.content, category: entry.category,
        video_url: entry.video_url || null, image_url: entry.image_url || null,
      }).eq("id", entry.id);
    } else {
      await supabase.from("knowledge_bases").insert({
        property_id: selectedId, title: entry.title, content: entry.content,
        category: entry.category, video_url: entry.video_url || null, image_url: entry.image_url || null,
      });
    }
    setEditing(null);
    setCreating(false);
    loadKB();
  };

  const removeEntry = async (id: string) => {
    if (!confirm("Delete this KB entry?")) return;
    await supabase.from("knowledge_bases").delete().eq("id", id);
    loadKB();
  };

  const selected = properties.find((p) => p.id === selectedId);

  return (
    <div className="flex gap-6 -mx-8 -my-10 h-[calc(100vh)]">
      {/* Left panel — property list */}
      <div className="w-80 shrink-0 border-r border-gray-200 bg-white flex flex-col h-full">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Properties</h2>
          {isSuperAdmin && (
            <button onClick={syncProperties} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing" : "Sync"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {properties.map((p) => (
            <button
              key={p.id}
              onClick={() => { setSelectedId(p.id); setEditing(null); setCreating(false); }}
              className={`w-full text-left px-5 py-3.5 border-b border-gray-50 flex items-center justify-between transition-colors ${
                selectedId === p.id ? "bg-gray-100" : "hover:bg-gray-50"
              }`}
            >
              <div>
                <div className={`text-base font-medium ${selectedId === p.id ? "text-gray-900" : "text-gray-700"}`}>{p.name}</div>
              </div>
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                p.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"
              }`}>
                {p.is_active ? "Active" : "Inactive"}
              </span>
            </button>
          ))}
          {properties.length === 0 && (
            <div className="px-5 py-10 text-center text-sm text-gray-400">No properties yet. Run a sync.</div>
          )}
        </div>
      </div>

      {/* Right panel — KB + gaps */}
      <div className="flex-1 overflow-y-auto py-8 pr-8 pl-2">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-base text-gray-400">
            Select a property to view its knowledge base
          </div>
        ) : (
          <>
            {/* Property header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">{selected.name}</h1>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                  <span className="font-mono">{selected.hospitable_property_uuid.slice(0, 8)}...</span>
                  {selected.turno_property_id && <span>Turno: {selected.turno_property_id}</span>}
                  {isSuperAdmin && (
                    <button onClick={() => toggleActive(selected.id, selected.is_active)}
                      className="text-gray-400 hover:text-gray-600 underline">
                      {selected.is_active ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </div>
              </div>
              <button onClick={() => { setCreating(true); setEditing({ id: "", property_id: selectedId!, title: "", content: "", video_url: null, image_url: null, category: "general" }); }}
                className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                <Plus size={20} /> Add Entry
              </button>
            </div>

            {/* Entry form */}
            {(editing || creating) && (
              <EntryForm entry={editing!} onSave={saveEntry} onCancel={() => { setEditing(null); setCreating(false); }} isNew={creating} />
            )}

            {/* KB entries */}
            <div className="space-y-3 mb-10">
              {entries.map((e) => (
                <div key={e.id} className="bg-white border border-gray-200 rounded-xl px-6 py-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="text-base font-medium text-gray-900">{e.title}</span>
                        <span className="text-sm px-3 py-0.5 bg-gray-100 text-gray-500 rounded-lg">{e.category}</span>
                      </div>
                      <div className="text-base text-gray-500 mt-1.5 line-clamp-2">{e.content}</div>
                    </div>
                    <div className="flex items-center gap-1.5 ml-4 shrink-0">
                      <button onClick={() => setEditing(e)} className="p-2 text-gray-300 hover:text-gray-500"><Pencil size={20} /></button>
                      <button onClick={() => removeEntry(e.id)} className="p-2 text-gray-300 hover:text-red-500"><Trash2 size={20} /></button>
                    </div>
                  </div>
                </div>
              ))}
              {entries.length === 0 && !creating && (
                <div className="text-center py-10 text-base text-gray-400">No KB entries yet. Add your first entry above.</div>
              )}
            </div>

            {/* Unanswered questions */}
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-4">
                <HelpCircle size={20} /> Unanswered Questions
              </h2>
              {gaps.length === 0 ? (
                <div className="text-base text-gray-400">No unanswered questions for this property.</div>
              ) : (
                <div className="space-y-2">
                  {gaps.map((g) => (
                    <div key={g.id} className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5">
                      <div className="text-base text-gray-800">{g.guest_question}</div>
                      <div className="text-sm text-gray-400 mt-1">{new Date(g.created_at).toLocaleString()}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EntryForm({ entry, onSave, onCancel, isNew }: {
  entry: KBEntry; onSave: (e: Partial<KBEntry>) => void; onCancel: () => void; isNew: boolean;
}) {
  const [form, setForm] = useState(entry);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 mb-5">
      <div className="text-base font-medium text-gray-900 mb-4">{isNew ? "New Entry" : "Edit Entry"}</div>
      <div className="grid grid-cols-2 gap-5 mb-5">
        <label className="block">
          <span className="text-sm text-gray-400 font-medium uppercase">Category</span>
          <select value={form.category} onChange={(e) => set("category", e.target.value)}
            className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg bg-white">
            {["general", "check-in", "amenity", "maintenance", "house-rules", "local-tips"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="block mb-5">
        <span className="text-sm text-gray-400 font-medium uppercase">Title</span>
        <input value={form.title} onChange={(e) => set("title", e.target.value)}
          className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="e.g. WiFi Password" />
      </label>
      <label className="block mb-5">
        <span className="text-sm text-gray-400 font-medium uppercase">Content</span>
        <textarea value={form.content} onChange={(e) => set("content", e.target.value)} rows={3}
          className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg resize-y" placeholder="The full answer..." />
      </label>
      <div className="grid grid-cols-2 gap-5 mb-5">
        <label className="block">
          <span className="text-sm text-gray-400 font-medium uppercase">Video URL (optional)</span>
          <input value={form.video_url ?? ""} onChange={(e) => set("video_url", e.target.value)}
            className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" />
        </label>
        <label className="block">
          <span className="text-sm text-gray-400 font-medium uppercase">Image URL (optional)</span>
          <input value={form.image_url ?? ""} onChange={(e) => set("image_url", e.target.value)}
            className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" />
        </label>
      </div>
      <div className="flex justify-end gap-3">
        <button onClick={onCancel} className="flex items-center gap-2 px-5 py-2 text-base text-gray-500 hover:text-gray-700"><X size={20} /> Cancel</button>
        <button onClick={() => onSave(form)} className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"><Check size={20} /> Save</button>
      </div>
    </div>
  );
}
