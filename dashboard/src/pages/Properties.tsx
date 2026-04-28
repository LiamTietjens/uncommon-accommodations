import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { RefreshCw } from "lucide-react";

interface Property {
  id: string;
  name: string;
  hospitable_property_uuid: string;
  turno_property_id: string | null;
  is_active: boolean;
}

export default function Properties() {
  const { isSuperAdmin } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [syncing, setSyncing] = useState(false);

  const load = () => {
    supabase.from("properties").select("*").order("name").then(({ data }) => {
      setProperties(data ?? []);
    });
  };

  useEffect(load, []);

  const syncProperties = async () => {
    setSyncing(true);
    try {
      const triggerKey = import.meta.env.VITE_TRIGGER_SECRET_KEY;
      if (!triggerKey) {
        alert("VITE_TRIGGER_SECRET_KEY not set — trigger sync from Trigger.dev dashboard instead.");
        return;
      }
      await fetch("https://api.trigger.dev/api/v1/tasks/property-sync-workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${triggerKey}` },
        body: JSON.stringify({ payload: {} }),
      });
      alert("Property sync triggered. Refresh in a minute to see results.");
    } catch {
      alert("Sync failed. Try from the Trigger.dev dashboard.");
    } finally {
      setSyncing(false);
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from("properties").update({ is_active: !current }).eq("id", id);
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Properties</h1>
        {isSuperAdmin && (
          <button
            onClick={syncProperties}
            disabled={syncing}
            className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            <RefreshCw size={20} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing..." : "Sync Properties"}
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium">Name</th>
              <th className="text-left px-5 py-4 font-medium">Hospitable ID</th>
              <th className="text-left px-5 py-4 font-medium">Turno ID</th>
              <th className="text-left px-5 py-4 font-medium">Status</th>
              {isSuperAdmin && <th className="px-5 py-4 font-medium" />}
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-5 py-4 font-medium text-gray-900">{p.name}</td>
                <td className="px-5 py-4 text-gray-400 font-mono text-sm">{p.hospitable_property_uuid.slice(0, 8)}...</td>
                <td className="px-5 py-4 text-gray-400">{p.turno_property_id || "—"}</td>
                <td className="px-5 py-4">
                  <span className={`inline-block px-3 py-1 rounded-lg text-sm font-medium ${p.is_active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                    {p.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                {isSuperAdmin && (
                  <td className="px-5 py-4 text-right">
                    <button onClick={() => toggleActive(p.id, p.is_active)} className="text-base text-gray-400 hover:text-gray-600">
                      {p.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {properties.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-base">No properties yet. Run a sync to import from Hospitable.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
