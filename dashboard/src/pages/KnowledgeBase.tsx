import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Pencil, Trash2, X, Check } from "lucide-react";

interface KBEntry {
  id: string;
  property_id: string;
  title: string;
  content: string;
  video_url: string | null;
  image_url: string | null;
  category: string;
  properties?: { name: string };
}

interface Property { id: string; name: string; }

export default function KnowledgeBase() {
  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [filterProp, setFilterProp] = useState("");
  const [editing, setEditing] = useState<KBEntry | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => {
    let q = supabase.from("knowledge_bases").select("*, properties(name)").order("title");
    if (filterProp) q = q.eq("property_id", filterProp);
    q.then(({ data }) => setEntries((data as KBEntry[]) ?? []));
  };

  useEffect(() => {
    supabase.from("properties").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setProperties(data ?? []));
  }, []);

  useEffect(load, [filterProp]);

  const save = async (entry: Partial<KBEntry> & { id?: string }) => {
    if (entry.id) {
      await supabase.from("knowledge_bases").update({
        title: entry.title, content: entry.content, category: entry.category,
        video_url: entry.video_url || null, image_url: entry.image_url || null,
      }).eq("id", entry.id);
    } else {
      await supabase.from("knowledge_bases").insert({
        property_id: entry.property_id, title: entry.title, content: entry.content,
        category: entry.category, video_url: entry.video_url || null, image_url: entry.image_url || null,
      });
    }
    setEditing(null);
    setCreating(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this KB entry?")) return;
    await supabase.from("knowledge_bases").delete().eq("id", id);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-gray-900">Knowledge Base</h1>
        <div className="flex items-center gap-2">
          <select
            value={filterProp}
            onChange={(e) => setFilterProp(e.target.value)}
            className="px-2 py-1 text-[11px] border border-gray-200 rounded bg-white"
          >
            <option value="">All properties</option>
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => { setCreating(true); setEditing({ id: "", property_id: properties[0]?.id ?? "", title: "", content: "", video_url: null, image_url: null, category: "general" }); }}
            className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium bg-gray-900 text-white rounded hover:bg-gray-800">
            <Plus size={12} /> Add Entry
          </button>
        </div>
      </div>

      {(editing || creating) && (
        <EntryForm entry={editing!} properties={properties} onSave={save} onCancel={() => { setEditing(null); setCreating(false); }} isNew={creating} />
      )}

      <div className="space-y-2">
        {entries.map((e) => (
          <div key={e.id} className="bg-white border border-gray-200 rounded-lg px-4 py-3">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-medium text-gray-900">{e.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{e.category}</span>
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">{(e.properties as any)?.name}</div>
                <div className="text-[11px] text-gray-500 mt-1 line-clamp-2">{e.content}</div>
              </div>
              <div className="flex items-center gap-1 ml-4 shrink-0">
                <button onClick={() => setEditing(e)} className="p-1 text-gray-300 hover:text-gray-500"><Pencil size={12} /></button>
                <button onClick={() => remove(e.id)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            </div>
          </div>
        ))}
        {entries.length === 0 && !creating && (
          <div className="text-center py-8 text-[11px] text-gray-400">No entries yet. Add your first knowledge base entry.</div>
        )}
      </div>
    </div>
  );
}

function EntryForm({ entry, properties, onSave, onCancel, isNew }: {
  entry: KBEntry; properties: Property[]; onSave: (e: Partial<KBEntry>) => void; onCancel: () => void; isNew: boolean;
}) {
  const [form, setForm] = useState(entry);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
      <div className="text-[12px] font-medium text-gray-900 mb-3">{isNew ? "New Entry" : "Edit Entry"}</div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-[10px] text-gray-400 font-medium uppercase">Property</span>
          <select value={form.property_id} onChange={(e) => set("property_id", e.target.value)} disabled={!isNew}
            className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded bg-white disabled:bg-gray-50">
            {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-400 font-medium uppercase">Category</span>
          <select value={form.category} onChange={(e) => set("category", e.target.value)}
            className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded bg-white">
            {["general", "check-in", "amenity", "maintenance", "house-rules", "local-tips"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label className="block mb-3">
        <span className="text-[10px] text-gray-400 font-medium uppercase">Title</span>
        <input value={form.title} onChange={(e) => set("title", e.target.value)}
          className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded" placeholder="e.g. WiFi Password" />
      </label>
      <label className="block mb-3">
        <span className="text-[10px] text-gray-400 font-medium uppercase">Content</span>
        <textarea value={form.content} onChange={(e) => set("content", e.target.value)} rows={3}
          className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded resize-y" placeholder="The full answer..." />
      </label>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-[10px] text-gray-400 font-medium uppercase">Video URL (optional)</span>
          <input value={form.video_url ?? ""} onChange={(e) => set("video_url", e.target.value)}
            className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded" />
        </label>
        <label className="block">
          <span className="text-[10px] text-gray-400 font-medium uppercase">Image URL (optional)</span>
          <input value={form.image_url ?? ""} onChange={(e) => set("image_url", e.target.value)}
            className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded" />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="flex items-center gap-1 px-3 py-1 text-[11px] text-gray-500 hover:text-gray-700"><X size={12} /> Cancel</button>
        <button onClick={() => onSave(form)} className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium bg-gray-900 text-white rounded hover:bg-gray-800"><Check size={12} /> Save</button>
      </div>
    </div>
  );
}
