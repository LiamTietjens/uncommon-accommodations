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
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Urgency Levels</h1>
      <p className="text-base text-gray-400 mb-6">These levels are used by the AI to classify maintenance ticket urgency. Edit the descriptions and examples to tune the AI's behavior.</p>

      <div className="space-y-4">
        {categories.map((c) => (
          <div key={c.id} className={`border rounded-xl p-6 ${urgencyColor[c.level] ?? "bg-white border-gray-200"}`}>
            {editing === c.id ? (
              <div>
                <div className="text-base font-semibold uppercase mb-4">{c.level}</div>
                <label className="block mb-4">
                  <span className="text-sm font-medium opacity-70">Description</span>
                  <input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })}
                    className="mt-1.5 w-full px-4 py-2 text-base border rounded-lg bg-white/80" />
                </label>
                <label className="block mb-4">
                  <span className="text-sm font-medium opacity-70">Examples (comma-separated)</span>
                  <input value={form.examples ?? ""} onChange={(e) => setForm({ ...form, examples: e.target.value })}
                    className="mt-1.5 w-full px-4 py-2 text-base border rounded-lg bg-white/80" />
                </label>
                <label className="block mb-5">
                  <span className="text-sm font-medium opacity-70">Response Time</span>
                  <input value={form.response_time ?? ""} onChange={(e) => setForm({ ...form, response_time: e.target.value })}
                    className="mt-1.5 w-full px-4 py-2 text-base border rounded-lg bg-white/80" />
                </label>
                <div className="flex gap-3">
                  <button onClick={save} className="flex items-center gap-2 px-4 py-1.5 text-sm bg-white/80 rounded-lg hover:bg-white"><Check size={18} /> Save</button>
                  <button onClick={() => setEditing(null)} className="flex items-center gap-2 px-4 py-1.5 text-sm opacity-60 hover:opacity-100"><X size={18} /> Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-base font-semibold uppercase">{c.level}</div>
                  <div className="text-base mt-1.5 opacity-80">{c.description}</div>
                  <div className="text-sm mt-1.5 opacity-60">Examples: {c.examples}</div>
                  <div className="text-sm opacity-60">Response: {c.response_time}</div>
                </div>
                <button onClick={() => { setEditing(c.id); setForm(c); }} className="p-2 opacity-40 hover:opacity-80"><Pencil size={20} /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
