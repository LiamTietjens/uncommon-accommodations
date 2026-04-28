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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">SMS Recipients</h1>
        <button onClick={() => setAdding(!adding)} className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
          <Plus size={20} /> Add Recipient
        </button>
      </div>

      {adding && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-2 gap-5 mb-5">
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="Tyler" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Phone (with country code)</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="44791234567" />
            </label>
          </div>
          <div className="flex gap-6 mb-5">
            {(["receives_maintenance", "receives_kb_gaps", "receives_extras"] as const).map((f) => (
              <label key={f} className="flex items-center gap-2 text-base text-gray-600">
                <input type="checkbox" checked={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.checked })} className="rounded w-5 h-5" />
                {f.replace("receives_", "").replace("_", " ")}
              </label>
            ))}
          </div>
          <button onClick={add} className="px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">Save</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium">Name</th>
              <th className="text-left px-5 py-4 font-medium">Phone</th>
              <th className="text-center px-5 py-4 font-medium">Maintenance</th>
              <th className="text-center px-5 py-4 font-medium">KB Gaps</th>
              <th className="text-center px-5 py-4 font-medium">Extras</th>
              <th className="px-5 py-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-5 py-4 text-gray-900">{r.name}</td>
                <td className="px-5 py-4 text-gray-500 font-mono text-sm">{r.phone}</td>
                {(["receives_maintenance", "receives_kb_gaps", "receives_extras"] as const).map((f) => (
                  <td key={f} className="px-5 py-4 text-center">
                    <button onClick={() => toggle(r.id, f, r[f])}
                      className={`w-6 h-6 rounded ${r[f] ? "bg-green-500" : "bg-gray-200"}`} />
                  </td>
                ))}
                <td className="px-5 py-4 text-right">
                  <button onClick={() => remove(r.id)} className="p-2 text-gray-300 hover:text-red-500"><Trash2 size={20} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
