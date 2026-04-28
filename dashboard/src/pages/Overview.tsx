import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Building2, Wrench, Clock, AlertTriangle } from "lucide-react";

export default function Overview() {
  const [stats, setStats] = useState({ properties: 0, openTickets: 0, activeCooldowns: 0, kbGaps: 0 });

  useEffect(() => {
    Promise.all([
      supabase.from("properties").select("*", { count: "exact", head: true }).eq("is_active", true),
      supabase.from("maintenance_tickets").select("*", { count: "exact", head: true }).eq("status", "open"),
      supabase.from("cooldowns").select("*", { count: "exact", head: true }).eq("is_active", true).gt("expires_at", new Date().toISOString()),
      supabase.from("kb_gap_log").select("*", { count: "exact", head: true }),
    ]).then(([props, tickets, cooldowns, gaps]) => {
      setStats({
        properties: props.count ?? 0,
        openTickets: tickets.count ?? 0,
        activeCooldowns: cooldowns.count ?? 0,
        kbGaps: gaps.count ?? 0,
      });
    });
  }, []);

  const cards = [
    { label: "Active Properties", value: stats.properties, icon: Building2, color: "text-blue-600" },
    { label: "Open Tickets", value: stats.openTickets, icon: Wrench, color: "text-amber-600" },
    { label: "Active Cooldowns", value: stats.activeCooldowns, icon: Clock, color: "text-red-500" },
    { label: "KB Gaps Logged", value: stats.kbGaps, icon: AlertTriangle, color: "text-purple-600" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Overview</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-6">
            <c.icon size={28} className={`${c.color} mb-3`} strokeWidth={1.5} />
            <div className="text-4xl font-semibold text-gray-900">{c.value}</div>
            <div className="text-base text-gray-400 mt-1">{c.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
