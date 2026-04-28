import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface ExtraRequest {
  id: string;
  item_requested: string;
  status: string;
  turno_project_id: string | null;
  created_at: string;
  properties?: { name: string };
}

const statusColor: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700",
  approved: "bg-green-50 text-green-700",
  declined: "bg-red-50 text-red-700",
  fulfilled: "bg-blue-50 text-blue-700",
};

export default function ExtraRequests() {
  const [requests, setRequests] = useState<ExtraRequest[]>([]);

  useEffect(() => {
    supabase.from("extra_requests").select("*, properties(name)").order("created_at", { ascending: false })
      .then(({ data }) => setRequests((data as ExtraRequest[]) ?? []));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Extra Requests</h1>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium">Property</th>
              <th className="text-left px-5 py-4 font-medium">Item</th>
              <th className="text-left px-5 py-4 font-medium">Status</th>
              <th className="text-left px-5 py-4 font-medium">Turno ID</th>
              <th className="text-left px-5 py-4 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="px-5 py-4 text-gray-900">{(r.properties as any)?.name}</td>
                <td className="px-5 py-4 text-gray-700">{r.item_requested}</td>
                <td className="px-5 py-4">
                  <span className={`text-sm px-3 py-0.5 rounded-lg font-medium ${statusColor[r.status] ?? "bg-gray-100 text-gray-500"}`}>{r.status}</span>
                </td>
                <td className="px-5 py-4 text-gray-400 text-sm">{r.turno_project_id || "—"}</td>
                <td className="px-5 py-4 text-gray-400 text-sm">{new Date(r.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-base">No extra requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
