import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Trash2 } from "lucide-react";

interface Recipient { id: string; name: string; phone: string; receives_maintenance: boolean; receives_kb_gaps: boolean; receives_extras: boolean; is_active: boolean; }

export default function SmsRecipients() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", receives_maintenance: true, receives_kb_gaps: true, receives_extras: true });

  const load = () => { supabase.from("sms_recipients").select("*").order("name").then(({ data }) => setRecipients(data ?? [])); };
  useEffect(load, []);

  const add = async () => {
    await supabase.from("sms_recipients").insert({ ...form, is_active: true });
    setForm({ name: "", phone: "", receives_maintenance: true, receives_kb_gaps: true, receives_extras: true });
    setAdding(false);
    load();
  };

  const toggle = async (id: string, field: string, current: boolean) => {
    await supabase.from("sms_recipients").update({ [field]: !current }).eq("id", id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this recipient?")) return;
    await supabase.from("sms_recipients").delete().eq("id", id);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-base font-semibold text-gray-900">SMS Recipients</h1>
        <button onClick={() => setAdding(!adding)} className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium bg-gray-900 text-white rounded hover:bg-gray-800">
          <Plus size={12} /> Add Recipient
        </button>
      </div>

      {adding && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <label className="block">
              <span className="text-[10px] text-gray-400 font-medium uppercase">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded" placeholder="Tyler" />
            </label>
            <label className="block">
              <span className="text-[10px] text-gray-400 font-medium uppercase">Phone (with country code)</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded" placeholder="44791234567" />
            </label>
          </div>
          <div className="flex gap-4 mb-3">
            {(["receives_maintenance", "receives_kb_gaps", "receives_extras"] as const).map((f) => (
              <label key={f} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                <input type="checkbox" checked={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.checked })} className="rounded" />
                {f.replace("receives_", "").replace("_", " ")}
              </label>
            ))}
          </div>
          <button onClick={add} className="px-3 py-1 text-[11px] font-medium bg-gray-900 text-white rounded hover:bg-gray-800">Save</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-gray-100 text-[10px] text-gray-400 uppercase tracking-wider">
              <th className="text-left px-4 py-2 font-medium">Name</th>
              <th className="text-left px-4 py-2 font-medium">Phone</th>
              <th className="text-center px-4 py-2 font-medium">Maintenance</th>
              <th className="text-center px-4 py-2 font-medium">KB Gaps</th>
              <th className="text-center px-4 py-2 font-medium">Extras</th>
              <th className="px-4 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-4 py-2 text-gray-900">{r.name}</td>
                <td className="px-4 py-2 text-gray-500 font-mono text-[10px]">{r.phone}</td>
                {(["receives_maintenance", "receives_kb_gaps", "receives_extras"] as const).map((f) => (
                  <td key={f} className="px-4 py-2 text-center">
                    <button onClick={() => toggle(r.id, f, r[f])}
                      className={`w-4 h-4 rounded ${r[f] ? "bg-green-500" : "bg-gray-200"}`} />
                  </td>
                ))}
                <td className="px-4 py-2 text-right">
                  <button onClick={() => remove(r.id)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
