import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Trash2 } from "lucide-react";

interface Recipient {
  id: string; name: string; phone: string;
  receives_maintenance_low: boolean; receives_maintenance_medium: boolean; receives_maintenance_high: boolean;
  receives_kb_gaps: boolean; is_active: boolean;
}

const maintenanceFields = [
  { key: "receives_maintenance_high" as const, label: "High", color: "bg-red-500" },
  { key: "receives_maintenance_medium" as const, label: "Medium", color: "bg-amber-500" },
  { key: "receives_maintenance_low" as const, label: "Low", color: "bg-green-500" },
];

export default function SmsRecipients() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    name: "", phone: "",
    receives_maintenance_low: true, receives_maintenance_medium: true, receives_maintenance_high: true,
    receives_kb_gaps: true,
  });

  const load = () => { supabase.from("sms_recipients").select("*").order("name").then(({ data }) => setRecipients(data ?? [])); };
  useEffect(load, []);

  const add = async () => {
    await supabase.from("sms_recipients").insert({ ...form, is_active: true });
    setForm({ name: "", phone: "", receives_maintenance_low: true, receives_maintenance_medium: true, receives_maintenance_high: true, receives_kb_gaps: true });
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
    <div className="max-w-5xl mx-auto px-8 py-10">
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
          <div className="mb-4">
            <span className="text-sm text-gray-400 font-medium uppercase">Maintenance urgency</span>
            <div className="flex gap-5 mt-2">
              {maintenanceFields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-base text-gray-600">
                  <input type="checkbox" checked={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} className="rounded w-5 h-5" />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-6 mb-5">
            <label className="flex items-center gap-2 text-base text-gray-600">
              <input type="checkbox" checked={form.receives_kb_gaps} onChange={(e) => setForm({ ...form, receives_kb_gaps: e.target.checked })} className="rounded w-5 h-5" />
              KB gap escalations
            </label>
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
              <th className="text-center px-3 py-4 font-medium" colSpan={3}>
                <span>Maintenance</span>
              </th>
              <th className="text-center px-5 py-4 font-medium">KB Gaps</th>
              <th className="px-5 py-4 font-medium" />
            </tr>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
              <th colSpan={2} />
              {maintenanceFields.map((f) => (
                <th key={f.key} className="px-3 py-2 font-medium text-center">{f.label}</th>
              ))}
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-5 py-4 text-gray-900">{r.name}</td>
                <td className="px-5 py-4 text-gray-500 font-mono text-sm">{r.phone}</td>
                {maintenanceFields.map((f) => (
                  <td key={f.key} className="px-3 py-4 text-center">
                    <button onClick={() => toggle(r.id, f.key, r[f.key])}
                      className={`w-6 h-6 rounded ${r[f.key] ? f.color : "bg-gray-200"}`} />
                  </td>
                ))}
                <td className="px-5 py-4 text-center">
                  <button onClick={() => toggle(r.id, "receives_kb_gaps", r.receives_kb_gaps)}
                    className={`w-6 h-6 rounded ${r.receives_kb_gaps ? "bg-blue-500" : "bg-gray-200"}`} />
                </td>
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
