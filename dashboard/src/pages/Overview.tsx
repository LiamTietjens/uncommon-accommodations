import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Building2, Wrench, Clock, AlertTriangle, Bot, MessageSquare, BedDouble, Package, ArrowUpRight } from "lucide-react";

const SECONDS_PER_ACTION = 70;

function formatTimeSaved(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return remainingMin > 0 ? `${hours}h ${remainingMin}m` : `${hours}h`;
}

export default function Overview() {
  const [stats, setStats] = useState({ properties: 0, openTickets: 0, activeCooldowns: 0, kbGaps: 0 });
  const [aiStats, setAiStats] = useState({
    kb_answer: 0,
    maintenance: 0,
    extra_request: 0,
    checkin_checkout: 0,
    escalation: 0,
  });

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

    // Load AI activity counts
    supabase
      .from("agent_activity_log")
      .select("action_type")
      .then(({ data }) => {
        if (!data) return;
        const counts = { kb_answer: 0, maintenance: 0, extra_request: 0, checkin_checkout: 0, escalation: 0 };
        for (const row of data) {
          const t = row.action_type as keyof typeof counts;
          if (t in counts) counts[t]++;
        }
        setAiStats(counts);
      });
  }, []);

  const cards = [
    { label: "Active Properties", value: stats.properties, icon: Building2, color: "text-blue-600" },
    { label: "Open Tickets", value: stats.openTickets, icon: Wrench, color: "text-amber-600" },
    { label: "Active Cooldowns", value: stats.activeCooldowns, icon: Clock, color: "text-red-500" },
    { label: "KB Gaps Logged", value: stats.kbGaps, icon: AlertTriangle, color: "text-purple-600" },
  ];

  const totalActions = aiStats.kb_answer + aiStats.maintenance + aiStats.extra_request + aiStats.checkin_checkout + aiStats.escalation;
  const timeSaved = formatTimeSaved(totalActions * SECONDS_PER_ACTION);

  const aiCards = [
    { label: "Questions Answered", value: aiStats.kb_answer, icon: MessageSquare, color: "text-emerald-600" },
    { label: "Maintenance Tickets", value: aiStats.maintenance, icon: Wrench, color: "text-amber-600" },
    { label: "Extra Requests", value: aiStats.extra_request, icon: Package, color: "text-blue-600" },
    { label: "Check-in / Checkout", value: aiStats.checkin_checkout, icon: BedDouble, color: "text-indigo-600" },
    { label: "Escalations", value: aiStats.escalation, icon: ArrowUpRight, color: "text-red-500" },
  ];

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
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

      <div className="mt-10">
        <div className="flex items-center gap-3 mb-5">
          <Bot size={24} className="text-emerald-600" strokeWidth={1.5} />
          <h2 className="text-xl font-semibold text-gray-900">AI Performance</h2>
        </div>

        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 mb-5">
          <div className="text-sm font-medium text-emerald-700 mb-1">Estimated Time Saved</div>
          <div className="text-4xl font-semibold text-emerald-800">{timeSaved}</div>
          <div className="text-sm text-emerald-600 mt-1">{totalActions} actions handled at ~70s each</div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {aiCards.map((c) => (
            <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-5">
              <c.icon size={22} className={`${c.color} mb-2`} strokeWidth={1.5} />
              <div className="text-3xl font-semibold text-gray-900">{c.value}</div>
              <div className="text-sm text-gray-400 mt-1">{c.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
