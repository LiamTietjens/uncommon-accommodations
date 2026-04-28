import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Pencil, Check, X } from "lucide-react";

interface Category { id: string; level: string; description: string; examples: string; response_time: string; }

export default function UrgencyLevels() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<Category>>({});

  const load = () => { supabase.from("urgency_categories").select("*").order("level").then(({ data }) => setCategories(data ?? [])); };
  useEffect(load, []);

  const save = async () => {
    if (!editing) return;
    await supabase.from("urgency_categories").update({
      description: form.description, examples: form.examples, response_time: form.response_time,
    }).eq("id", editing);
    setEditing(null);
    load();
  };

  const urgencyColor: Record<string, string> = {
    low: "bg-blue-50 text-blue-700 border-blue-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    high: "bg-orange-50 text-orange-700 border-orange-200",
    emergency: "bg-red-50 text-red-700 border-red-200",
  };

  return (
    <div>
      <h1 className="text-lg font-semibold text-gray-900 mb-5">Urgency Levels</h1>
      <p className="text-sm text-gray-400 mb-5">These levels are used by the AI to classify maintenance ticket urgency. Edit the descriptions and examples to tune the AI's behavior.</p>

      <div className="space-y-3">
        {categories.map((c) => (
          <div key={c.id} className={`border rounded-lg p-5 ${urgencyColor[c.level] ?? "bg-white border-gray-200"}`}>
            {editing === c.id ? (
              <div>
                <div className="text-sm font-semibold uppercase mb-3">{c.level}</div>
                <label className="block mb-3">
                  <span className="text-xs font-medium opacity-70">Description</span>
                  <input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="mt-1 w-full px-3 py-1.5 text-sm border rounded bg-white/80" />
                </label>
                <label className="block mb-3">
                  <span className="text-xs font-medium opacity-70">Examples (comma-separated)</span>
                  <input value={form.examples ?? ""} onChange={(e) => setForm({ ...form, examples: e.target.value })}
                    className="mt-1 w-full px-3 py-1.5 text-sm border rounded bg-white/80" />
                </label>
                <label className="block mb-4">
                  <span className="text-xs font-medium opacity-70">Response Time</span>
                  <input value={form.response_time ?? ""} onChange={(e) => setForm({ ...form, response_time: e.target.value })}
                    className="mt-1 w-full px-3 py-1.5 text-sm border rounded bg-white/80" />
                </label>
                <div className="flex gap-2">
                  <button onClick={save} className="flex items-center gap-1.5 px-3 py-1 text-xs bg-white/80 rounded hover:bg-white"><Check size={14} /> Save</button>
                  <button onClick={() => setEditing(null)} className="flex items-center gap-1.5 px-3 py-1 text-xs opacity-60 hover:opacity-100"><X size={14} /> Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold uppercase">{c.level}</div>
                  <div className="text-sm mt-1 opacity-80">{c.description}</div>
                  <div className="text-xs mt-1 opacity-60">Examples: {c.examples}</div>
                  <div className="text-xs opacity-60">Response: {c.response_time}</div>
                </div>
                <button onClick={() => { setEditing(c.id); setForm(c); }} className="p-1.5 opacity-40 hover:opacity-80"><Pencil size={16} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
