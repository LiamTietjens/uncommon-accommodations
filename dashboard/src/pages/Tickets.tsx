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
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Maintenance Tickets</h1>
        <div className="flex gap-1.5">
          {["open", "in_progress", "resolved", "all"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-4 py-1.5 text-sm rounded-lg ${filter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {s === "all" ? "All" : s.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {tickets.map((t) => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-xl px-6 py-5">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <span className="text-base font-medium text-gray-900">{(t.properties as any)?.name}</span>
                  <span className={`text-sm px-3 py-0.5 rounded-lg font-medium ${urgencyColor[t.urgency] ?? "bg-gray-100 text-gray-500"}`}>{t.urgency}</span>
                  <span className={`text-sm px-3 py-0.5 rounded-lg font-medium ${statusColor[t.status] ?? "bg-gray-100 text-gray-500"}`}>{t.status.replace("_", " ")}</span>
                </div>
                <div className="text-base text-gray-700">{t.description}</div>
                <div className="text-sm text-gray-400 mt-1.5">{new Date(t.created_at).toLocaleString()}</div>
              </div>
              {isSuperAdmin && t.status !== "resolved" && (
                <div className="flex gap-2 ml-4 shrink-0">
                  {t.status === "open" && (
                    <button onClick={() => updateStatus(t.id, "in_progress")} className="px-4 py-1.5 text-sm bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100">In Progress</button>
                  )}
                  <button onClick={() => updateStatus(t.id, "resolved")} className="px-4 py-1.5 text-sm bg-green-50 text-green-700 rounded-lg hover:bg-green-100">Resolve</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {tickets.length === 0 && (
          <div className="text-center py-10 text-base text-gray-400">No tickets found.</div>
        )}
      </div>
    </div>
  );
}
