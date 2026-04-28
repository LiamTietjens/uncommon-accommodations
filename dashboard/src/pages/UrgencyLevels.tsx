import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Pencil, Check, X } from "lucide-react";

interface Category { id: string; level: string; description: string; examples: string; response_time: string; }

const levelColor: Record<string, string> = {
  high: "bg-red-100 text-red-800 border-red-300",
  medium: "bg-amber-100 text-amber-800 border-amber-300",
  low: "bg-green-100 text-green-800 border-green-300",
};

const levelOrder = ["high", "medium", "low"];

const levelLabel: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export default function UrgencyLevels() {
  const [categories, setCategories] = useState<Category[]>([]);
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
      <h1 className="text-2xl font-semibold text-gray-900 mb-3">Urgency Levels</h1>
      <p className="text-base text-gray-400 mb-6">Add examples for each urgency level so the AI knows how to classify maintenance issues.</p>

      <div className="space-y-4">
        {categories.map((c) => (
          <div key={c.id} className={`border rounded-xl p-6 ${levelColor[c.level] ?? "bg-white border-gray-200"}`}>
            {editing === c.id ? (
              <div>
                <div className="text-lg font-semibold mb-4">{levelLabel[c.level]}</div>
                <label className="block mb-5">
                  <span className="text-sm font-medium opacity-70">Examples</span>
                  <textarea
                    value={examples}
                    onChange={(e) => setExamples(e.target.value)}
                    rows={3}
                    className="mt-1.5 w-full px-4 py-3 text-base border rounded-lg bg-white/80 resize-y"
                    placeholder="e.g. Lightbulb out, squeaky door, minor stain..."
                  />
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
