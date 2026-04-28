import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { XCircle } from "lucide-react";

interface Cooldown {
  id: string;
  property_id: string;
  activated_at: string;
  expires_at: string;
  reason: string;
  is_active: boolean;
  reservation_uuid: string;
  properties?: { name: string };
}

export default function Cooldowns() {
  const { isSuperAdmin } = useAuth();
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [showAll, setShowAll] = useState(false);

  const load = () => {
    let q = supabase.from("cooldowns").select("*, properties(name)").order("activated_at", { ascending: false });
    if (!showAll) q = q.eq("is_active", true).gt("expires_at", new Date().toISOString());
    q.then(({ data }) => setCooldowns((data as Cooldown[]) ?? []));
  };

  useEffect(load, [showAll]);

  const deactivate = async (id: string) => {
    await supabase.from("cooldowns").update({ is_active: false }).eq("id", id);
    load();
  };

  const isExpired = (c: Cooldown) => new Date(c.expires_at) < new Date();
  const isActive = (c: Cooldown) => c.is_active && !isExpired(c);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-semibold text-gray-900">Cooldowns</h1>
        <button onClick={() => setShowAll(!showAll)}
          className={`px-3 py-1 text-xs rounded ${showAll ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
          {showAll ? "Show all" : "Active only"}
        </button>
      </div>

      <div className="space-y-3">
        {cooldowns.map((c) => (
          <div key={c.id} className={`bg-white border rounded-lg px-5 py-4 ${isActive(c) ? "border-red-200" : "border-gray-200"}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">{(c.properties as any)?.name}</span>
                  {isActive(c) ? (
                    <span className="text-xs px-2 py-0.5 bg-red-50 text-red-700 rounded font-medium">Active</span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-400 rounded font-medium">
                      {isExpired(c) ? "Expired" : "Deactivated"}
                    </span>
                  )}
                </div>
                <div className="text-sm text-gray-500">{c.reason}</div>
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(c.activated_at).toLocaleString()} → {new Date(c.expires_at).toLocaleString()}
                </div>
              </div>
              {isSuperAdmin && isActive(c) && (
                <button onClick={() => deactivate(c.id)} className="flex items-center gap-1.5 px-3 py-1 text-xs text-red-600 hover:bg-red-50 rounded">
                  <XCircle size={16} /> Deactivate
                </button>
              )}
            </div>
          </div>
        ))}
        {cooldowns.length === 0 && (
          <div className="text-center py-8 text-sm text-gray-400">No {showAll ? "" : "active "}cooldowns.</div>
        )}
      </div>
    </div>
  );
}
