import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

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
  low: "bg-blue-50 text-blue-700",
  medium: "bg-amber-50 text-amber-700",
  high: "bg-orange-50 text-orange-700",
  emergency: "bg-red-50 text-red-700",
};

const statusColor: Record<string, string> = {
  open: "bg-yellow-50 text-yellow-700",
  in_progress: "bg-blue-50 text-blue-700",
  resolved: "bg-green-50 text-green-700",
};

export default function Tickets() {
  const { isSuperAdmin } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState("open");

  const load = () => {
    let q = supabase.from("maintenance_tickets").select("*, properties(name)").order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    q.then(({ data }) => setTickets((data as Ticket[]) ?? []));
  };

  useEffect(load, [filter]);

  const updateStatus = async (id: string, status: string) => {
    const update: Record<string, unknown> = { status };
    if (status === "resolved") update.resolved_at = new Date().toISOString();
    await supabase.from("maintenance_tickets").update(update).eq("id", id);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Maintenance Tickets</h1>
        <div className="flex gap-1">
          {["open", "in_progress", "resolved", "all"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs rounded ${filter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {tickets.map((t) => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-lg px-5 py-4">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">{(t.properties as any)?.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${urgencyColor[t.urgency] ?? "bg-gray-100 text-gray-500"}`}>{t.urgency}</span>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${statusColor[t.status] ?? "bg-gray-100 text-gray-500"}`}>{t.status.replace("_", " ")}</span>
                </div>
                <div className="text-sm text-gray-700">{t.description}</div>
                <div className="text-xs text-gray-400 mt-1">{new Date(t.created_at).toLocaleString()}</div>
              </div>
              {isSuperAdmin && t.status !== "resolved" && (
                <div className="flex gap-1 ml-4 shrink-0">
                  {t.status === "open" && (
                    <button onClick={() => updateStatus(t.id, "in_progress")} className="px-3 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100">In Progress</button>
                  )}
                  <button onClick={() => updateStatus(t.id, "resolved")} className="px-3 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100">Resolve</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {tickets.length === 0 && (
          <div className="text-center py-8 text-sm text-gray-400">No tickets found.</div>
        )}
      </div>
    </div>
  );
}
