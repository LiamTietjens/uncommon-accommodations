import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";

interface Recipient {
  id: string; name: string; phone: string;
  receives_maintenance_low: boolean; receives_maintenance_medium: boolean; receives_maintenance_high: boolean;
  receives_kb_gaps: boolean; receives_checkin_checkout: boolean; is_active: boolean;
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
    receives_kb_gaps: true, receives_checkin_checkout: true,
  });
  const [editing, setEditing] = useState<{ id: string; name: string; phone: string } | null>(null);

  const isE164 = (raw: string) => /^\+\d{10,15}$/.test(raw.replace(/[\s\-()]/g, ""));
  const stripFormatting = (raw: string) => raw.replace(/[\s\-()]/g, "");
  const missingPlus = (raw: string) => {
    const stripped = stripFormatting(raw);
    return stripped.length > 0 && !stripped.startsWith("+") && /^\d{10,15}$/.test(stripped);
  };
  const hasLeadingZeroAfterCC = (raw: string) => {
    const digits = stripFormatting(raw).replace(/^\+/, "");
    if (/^[17]/.test(digits) && digits[1] === "0") return true;
    if (/^[2-689]/.test(digits) && digits[2] === "0") return true;
    return false;
  };

  const phoneValid = form.phone === "" || isE164(form.phone);
  const phoneMissingPlus = missingPlus(form.phone);
  const phoneLooksLikeLeadingZero = form.phone !== "" && hasLeadingZeroAfterCC(form.phone);
  const canSave = form.name.trim() !== "" && isE164(form.phone) && !hasLeadingZeroAfterCC(form.phone);

  const editPhoneValid = editing ? (editing.phone === "" || isE164(editing.phone)) : true;
  const editPhoneMissingPlus = editing ? missingPlus(editing.phone) : false;
  const editPhoneLooksLikeLeadingZero = editing ? hasLeadingZeroAfterCC(editing.phone) : false;
  const canSaveEdit = editing ? (editing.name.trim() !== "" && isE164(editing.phone) && !hasLeadingZeroAfterCC(editing.phone)) : false;

  const load = () => { supabase.from("sms_recipients").select("*").order("name").then(({ data }) => setRecipients(data ?? [])); };
  useEffect(load, []);

  const add = async () => {
    if (!canSave) return;
    await supabase.from("sms_recipients").insert({ ...form, phone: stripFormatting(form.phone), is_active: true });
    setForm({ name: "", phone: "", receives_maintenance_low: true, receives_maintenance_medium: true, receives_maintenance_high: true, receives_kb_gaps: true, receives_checkin_checkout: true });
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

  const saveEdit = async () => {
    if (!editing || !canSaveEdit) return;
    await supabase.from("sms_recipients").update({ name: editing.name, phone: stripFormatting(editing.phone) }).eq("id", editing.id);
    setEditing(null);
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
                className={`mt-1.5 w-full px-4 py-2 text-base border rounded-lg ${!phoneValid ? "border-red-400 bg-red-50" : "border-gray-200"}`} placeholder="+49 157 55577318" />
              {phoneMissingPlus && <p className="text-red-500 text-sm mt-1">Must start with + (e.g. +16465470093)</p>}
              {!phoneValid && !phoneMissingPlus && !phoneLooksLikeLeadingZero && form.phone !== "" && <p className="text-red-500 text-sm mt-1">Enter a valid E.164 number: +[country code][number], 10-15 digits</p>}
              {phoneLooksLikeLeadingZero && <p className="text-red-500 text-sm mt-1">Remove the leading 0 after the country code (e.g. +49 0157… → +49 157…)</p>}
              {form.phone && phoneValid && !phoneLooksLikeLeadingZero && <p className="text-green-600 text-sm mt-1">Will be saved as: {stripFormatting(form.phone)}</p>}
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
            <label className="flex items-center gap-2 text-base text-gray-600">
              <input type="checkbox" checked={form.receives_checkin_checkout} onChange={(e) => setForm({ ...form, receives_checkin_checkout: e.target.checked })} className="rounded w-5 h-5" />
              Check-in / checkout requests
            </label>
          </div>
          <button onClick={add} disabled={!canSave} className={`px-5 py-2 text-base font-medium rounded-lg ${canSave ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}>Save</button>
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
              <th className="text-center px-5 py-4 font-medium">Check-in/out</th>
              <th className="px-5 py-4 font-medium" />
            </tr>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
              <th colSpan={2} />
              {maintenanceFields.map((f) => (
                <th key={f.key} className="px-3 py-2 font-medium text-center">{f.label}</th>
              ))}
              <th />
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.id} className="border-b border-gray-50">
                {editing?.id === r.id ? (
                  <>
                    <td className="px-5 py-4">
                      <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        className="w-full px-3 py-1.5 text-base border border-gray-200 rounded-lg" />
                    </td>
                    <td className="px-5 py-4">
                      <input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                        className={`w-full px-3 py-1.5 text-base font-mono border rounded-lg ${!editPhoneValid ? "border-red-400 bg-red-50" : "border-gray-200"}`}
                        placeholder="+49 157 55577318" />
                      {editPhoneMissingPlus && <p className="text-red-500 text-xs mt-1">Must start with + (e.g. +16465470093)</p>}
                      {!editPhoneValid && !editPhoneMissingPlus && !editPhoneLooksLikeLeadingZero && editing.phone !== "" && <p className="text-red-500 text-xs mt-1">Enter a valid E.164 number: +[country code][number]</p>}
                      {editPhoneLooksLikeLeadingZero && <p className="text-red-500 text-xs mt-1">Remove leading 0 after country code</p>}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-5 py-4 text-gray-900">{r.name}</td>
                    <td className="px-5 py-4 font-mono text-sm">
                      <span className={r.phone.startsWith("+") ? "text-gray-500" : "text-red-500"}>{r.phone}</span>
                      {!r.phone.startsWith("+") && <p className="text-red-500 text-xs mt-0.5">Missing + prefix — edit to fix</p>}
                    </td>
                  </>
                )}
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
                <td className="px-5 py-4 text-center">
                  <button onClick={() => toggle(r.id, "receives_checkin_checkout", r.receives_checkin_checkout)}
                    className={`w-6 h-6 rounded ${r.receives_checkin_checkout ? "bg-purple-500" : "bg-gray-200"}`} />
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex gap-1 justify-end">
                    {editing?.id === r.id ? (
                      <>
                        <button onClick={saveEdit} disabled={!canSaveEdit} className={`p-2 ${canSaveEdit ? "text-green-500 hover:text-green-700" : "text-gray-300 cursor-not-allowed"}`}><Check size={20} /></button>
                        <button onClick={() => setEditing(null)} className="p-2 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setEditing({ id: r.id, name: r.name, phone: r.phone })} className="p-2 text-gray-300 hover:text-gray-500"><Pencil size={20} /></button>
                        <button onClick={() => remove(r.id)} className="p-2 text-gray-300 hover:text-red-500"><Trash2 size={20} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
