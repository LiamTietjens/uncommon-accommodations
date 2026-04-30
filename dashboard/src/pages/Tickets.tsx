import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus } from "lucide-react";

interface Ticket {
  id: string;
  description: string;
  urgency: string;
  status: string;
  guest_context: string;
  reservation_uuid: string;
  created_at: string;
  resolved_at: string | null;
  properties?: { name: string };
}

const urgencyColor: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-green-100 text-green-700 border-green-200",
};
const urgencyDot: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-green-500",
};

const statuses = ["open", "in_progress", "resolved"];
const statusColor: Record<string, string> = {
  open: "bg-yellow-50 text-yellow-700 border-yellow-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  resolved: "bg-green-50 text-green-700 border-green-200",
};
const statusLabel: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

export default function Tickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState("open");
  const [adding, setAdding] = useState(false);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ property_id: "", description: "", urgency: "medium", status: "open" });

  const load = () => {
    let q = supabase.from("maintenance_tickets").select("*, properties(name)").order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    q.then(({ data }) => setTickets((data as Ticket[]) ?? []));
  };

  useEffect(load, [filter]);
  useEffect(() => { supabase.from("properties").select("id, name").order("name").then(({ data }) => setProperties(data ?? [])); }, []);

  const canAdd = form.property_id !== "" && form.description.trim() !== "";
  const addTicket = async () => {
    if (!canAdd) return;
    await supabase.from("maintenance_tickets").insert({
      property_id: form.property_id,
      description: form.description.trim(),
      urgency: form.urgency,
      status: form.status,
      guest_context: "Manually created",
      reservation_uuid: "manual",
    });
    setForm({ property_id: "", description: "", urgency: "medium", status: "open" });
    setAdding(false);
    load();
  };

  const updateField = async (id: string, field: string, value: string) => {
    const update: Record<string, unknown> = { [field]: value };
    if (field === "status" && value === "resolved") update.resolved_at = new Date().toISOString();
    if (field === "status" && value !== "resolved") update.resolved_at = null;
    await supabase.from("maintenance_tickets").update(update).eq("id", id);
    load();
  };

  return (
    <div className="max-w-7xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold text-gray-900">Maintenance Tickets</h1>
          <button onClick={() => setAdding(!adding)} className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
            <Plus size={16} /> Add Ticket
          </button>
        </div>
        <div className="flex gap-1.5">
          {["open", "in_progress", "resolved", "all"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-4 py-1.5 text-sm rounded-lg ${filter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {s === "all" ? "All" : statusLabel[s] || s}
            </button>
          ))}
        </div>
      </div>

      {adding && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-2 gap-5 mb-5">
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Property</span>
              <select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg">
                <option value="">Select property…</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Description</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="Describe the issue…" />
            </label>
          </div>
          <div className="flex gap-6 mb-5">
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Urgency</span>
              <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                className="block mt-3 px-4 py-2 text-base border border-gray-200 rounded-lg">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Status</span>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="block mt-3 px-4 py-2 text-base border border-gray-200 rounded-lg">
                {statuses.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
              </select>
            </label>
          </div>
          <button onClick={addTicket} disabled={!canAdd} className={`px-5 py-2 text-base font-medium rounded-lg ${canAdd ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}>Save</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium w-28">Priority</th>
              <th className="text-left px-5 py-4 font-medium">Property</th>
              <th className="text-left px-5 py-4 font-medium">Issue</th>
              <th className="text-left px-5 py-4 font-medium w-36">Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                {/* Priority — read-only, set by AI */}
                <td className="px-5 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium border ${urgencyColor[t.urgency] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                    <span className={`w-2 h-2 rounded-full ${urgencyDot[t.urgency]}`} />
                    {t.urgency.charAt(0).toUpperCase() + t.urgency.slice(1)}
                  </span>
                </td>
                {/* Property + date */}
                <td className="px-5 py-4">
                  <div className="text-base font-medium text-gray-900">{(t.properties as any)?.name}</div>
                  <div className="text-sm text-gray-400">{new Date(t.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</div>
                </td>
                {/* Description */}
                <td className="px-5 py-4 text-gray-700">{t.description}</td>
                {/* Status dropdown */}
                <td className="px-5 py-4">
                  <select value={t.status} onChange={(e) => updateField(t.id, "status", e.target.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border appearance-none cursor-pointer ${statusColor[t.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                    {statuses.map((s) => (
                      <option key={s} value={s}>{statusLabel[s]}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-gray-400 text-base">No tickets found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
