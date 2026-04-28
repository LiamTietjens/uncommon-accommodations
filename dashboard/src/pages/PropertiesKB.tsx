import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { RefreshCw, Trash2, X, Plus, HelpCircle, Link } from "lucide-react";

interface Property {
  id: string;
  name: string;
  hospitable_property_uuid: string;
  turno_property_id: string | null;
  is_active: boolean;
}

interface KBEntry {
  id: string;
  property_id: string;
  title: string;
  content: string;
  video_url: string | null;
  image_url: string | null;
}

interface GapEntry {
  id: string;
  property_id: string;
  guest_question: string;
  created_at: string;
}

interface Cooldown {
  id: string;
  property_id: string;
  activated_at: string;
  expires_at: string;
  reason: string;
  is_active: boolean;
}

function healthPercent(answered: number, unanswered: number): number | null {
  const total = answered + unanswered;
  if (total === 0) return null;
  return Math.round((answered / total) * 100);
}

function healthColor(pct: number): string {
  if (pct >= 80) return "text-green-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}

// Store all URLs in image_url field as newline-separated
const parseUrls = (e: KBEntry): string[] => {
  const urls: string[] = [];
  if (e.image_url) urls.push(...e.image_url.split("\n").filter(Boolean));
  if (e.video_url) urls.push(...e.video_url.split("\n").filter(Boolean));
  return urls;
};

export default function PropertiesKB() {
  const { isSuperAdmin } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [entries, setEntries] = useState<KBEntry[]>([]);
  const [gaps, setGaps] = useState<GapEntry[]>([]);
  const [cooldowns, setCooldowns] = useState<Cooldown[]>([]);
  const [allCooldowns, setAllCooldowns] = useState<Cooldown[]>([]);
  const [kbCounts, setKbCounts] = useState<Record<string, number>>({});
  const [gapCounts, setGapCounts] = useState<Record<string, number>>({});

  // New entry form
  const [newQ, setNewQ] = useState("");
  const [newA, setNewA] = useState("");
  const [newUrls, setNewUrls] = useState<string[]>([]);
  const [newUrlInput, setNewUrlInput] = useState("");

  const loadProperties = () => {
    supabase.from("properties").select("*").order("name").then(({ data }) => {
      setProperties(data ?? []);
    });
  };

  const loadAllCooldowns = () => {
    supabase.from("cooldowns").select("*").eq("is_active", true)
      .gt("expires_at", new Date().toISOString())
      .then(({ data }) => setAllCooldowns((data as Cooldown[]) ?? []));
  };

  const loadHealthCounts = () => {
    supabase.from("knowledge_bases").select("property_id").then(({ data }) => {
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r) => { counts[r.property_id] = (counts[r.property_id] || 0) + 1; });
      setKbCounts(counts);
    });
    supabase.from("kb_gap_log").select("property_id").then(({ data }) => {
      const counts: Record<string, number> = {};
      (data ?? []).forEach((r) => { counts[r.property_id] = (counts[r.property_id] || 0) + 1; });
      setGapCounts(counts);
    });
  };

  useEffect(() => { loadProperties(); loadAllCooldowns(); loadHealthCounts(); }, []);

  const loadRightPanel = () => {
    if (!selectedId) { setEntries([]); setGaps([]); setCooldowns([]); return; }
    supabase.from("knowledge_bases").select("*").eq("property_id", selectedId).order("title")
      .then(({ data }) => setEntries((data as KBEntry[]) ?? []));
    supabase.from("kb_gap_log").select("*").eq("property_id", selectedId).order("created_at", { ascending: false })
      .then(({ data }) => setGaps((data as GapEntry[]) ?? []));
    supabase.from("cooldowns").select("*").eq("property_id", selectedId).eq("is_active", true)
      .gt("expires_at", new Date().toISOString()).order("activated_at", { ascending: false })
      .then(({ data }) => setCooldowns((data as Cooldown[]) ?? []));
  };

  useEffect(loadRightPanel, [selectedId]);

  const refreshAfterChange = () => { loadRightPanel(); loadHealthCounts(); };

  const syncProperties = async () => {
    setSyncing(true);
    try {
      const triggerKey = import.meta.env.VITE_TRIGGER_SECRET_KEY;
      if (!triggerKey) { alert("VITE_TRIGGER_SECRET_KEY not set."); return; }
      await fetch("https://api.trigger.dev/api/v1/tasks/property-sync-workflow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${triggerKey}` },
        body: JSON.stringify({ payload: {} }),
      });
      alert("Property sync triggered. Refresh in a minute.");
    } catch { alert("Sync failed."); }
    finally { setSyncing(false); }
  };

  const hasCooldown = (propId: string) => allCooldowns.some((c) => c.property_id === propId);

  const toggleCooldown = async (propId: string) => {
    const active = cooldowns.filter((c) => c.property_id === propId);
    if (active.length > 0) {
      for (const c of active) await supabase.from("cooldowns").update({ is_active: false }).eq("id", c.id);
    } else {
      await supabase.from("cooldowns").insert({
        property_id: propId,
        expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
        reason: "Manually paused by admin",
        is_active: true,
        reservation_uuid: "manual",
      });
    }
    loadRightPanel();
    loadAllCooldowns();
  };

  const joinUrls = (arr: string[]) => arr.length > 0 ? arr.join("\n") : null;

  const addEntry = async () => {
    if (!newQ.trim() || !newA.trim() || !selectedId) return;
    await supabase.from("knowledge_bases").insert({
      property_id: selectedId, title: newQ.trim(), content: newA.trim(),
      image_url: joinUrls(newUrls),
    });
    setNewQ(""); setNewA(""); setNewUrls([]); setNewUrlInput("");
    refreshAfterChange();
  };

  const removeEntry = async (id: string) => {
    if (!confirm("Delete this Q&A entry?")) return;
    await supabase.from("knowledge_bases").delete().eq("id", id);
    refreshAfterChange();
  };

  const answerGap = async (g: GapEntry) => {
    setNewQ(g.guest_question);
    await supabase.from("kb_gap_log").delete().eq("id", g.id);
    refreshAfterChange();
  };

  const addNewUrl = () => {
    if (!newUrlInput.trim()) return;
    setNewUrls([...newUrls, newUrlInput.trim()]);
    setNewUrlInput("");
  };

  const selected = properties.find((p) => p.id === selectedId);
  const isPaused = selectedId ? hasCooldown(selectedId) : false;
  const selectedHealth = selectedId ? healthPercent(kbCounts[selectedId] || 0, gapCounts[selectedId] || 0) : null;
  const latestExpiry = cooldowns.length > 0
    ? cooldowns.reduce((latest, c) => new Date(c.expires_at) > latest ? new Date(c.expires_at) : latest, new Date(0))
    : null;

  return (
    <div className="flex h-full">
      {/* Property list */}
      <div className="w-72 shrink-0 border-r border-gray-200 bg-white flex flex-col h-full">
        <div className="px-4 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Properties</h2>
          {isSuperAdmin && (
            <button onClick={syncProperties} disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Syncing" : "Sync"}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          {properties.map((p) => {
            const paused = hasCooldown(p.id);
            const pct = healthPercent(kbCounts[p.id] || 0, gapCounts[p.id] || 0);
            return (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left px-4 py-3 border-b border-gray-50 flex items-center justify-between transition-colors ${
                  selectedId === p.id ? "bg-gray-100" : "hover:bg-gray-50"
                }`}
              >
                <div className="min-w-0">
                  <div className={`text-base font-medium truncate ${selectedId === p.id ? "text-gray-900" : "text-gray-700"}`}>{p.name}</div>
                  {pct !== null && (
                    <div className={`text-xs ${healthColor(pct)}`}>KB {pct}%</div>
                  )}
                </div>
                <span className={`shrink-0 ml-2 inline-block px-2 py-0.5 rounded text-xs font-medium ${
                  paused ? "bg-red-50 text-red-600" : "bg-green-50 text-green-700"
                }`}>
                  {paused ? "Paused" : "Active"}
                </span>
              </button>
            );
          })}
          {properties.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-gray-400">No properties yet. Run a sync.</div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 overflow-y-auto px-8 py-8">
        {!selected ? (
          <div className="flex items-center justify-center h-full text-base text-gray-400">
            Select a property to view its knowledge base
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">{selected.name}</h1>
                <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
                  <span className="font-mono">{selected.hospitable_property_uuid.slice(0, 8)}...</span>
                  {selected.turno_property_id && <span>Turno: {selected.turno_property_id}</span>}
                </div>
                {selectedHealth !== null && (
                  <div className="flex items-center gap-2 mt-2">
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${
                        selectedHealth >= 80 ? "bg-green-500" : selectedHealth >= 50 ? "bg-amber-500" : "bg-red-500"
                      }`} style={{ width: `${selectedHealth}%` }} />
                    </div>
                    <span className={`text-sm font-medium ${healthColor(selectedHealth)}`}>
                      KB Health {selectedHealth}%
                    </span>
                    <span className="text-xs text-gray-400">
                      ({entries.length} answered, {gaps.length} unanswered)
                    </span>
                  </div>
                )}
              </div>
              {isSuperAdmin && (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-3">
                    <span className={`text-sm ${isPaused ? "text-red-600 font-medium" : "text-gray-500"}`}>
                      {isPaused ? "Paused" : "Active"}
                    </span>
                    <button
                      onClick={() => toggleCooldown(selected.id)}
                      className={`relative w-14 h-8 rounded-full transition-colors ${
                        isPaused ? "bg-red-400" : "bg-green-500"
                      }`}
                    >
                      <span className={`absolute top-1 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                        isPaused ? "left-1" : "left-7"
                      }`} />
                    </button>
                  </div>
                  {isPaused && latestExpiry && (
                    <span className="text-xs text-gray-400">
                      Auto-resumes {latestExpiry.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Unanswered questions — top of mind, clickable */}
            {gaps.length > 0 && (
              <div className="mb-6">
                <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-3">
                  <HelpCircle size={20} /> Unanswered Questions ({gaps.length})
                </h2>
                <div className="space-y-2">
                  {gaps.map((g) => (
                    <button key={g.id} onClick={() => answerGap(g)} className="w-full text-left bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 hover:bg-amber-100 transition-colors cursor-pointer">
                      <div className="text-base text-gray-800">{g.guest_question}</div>
                      <div className="text-sm text-gray-400 mt-1">{new Date(g.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Add form */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <label className="text-sm font-semibold text-gray-500 pt-2.5 w-6 shrink-0">Q:</label>
                  <input value={newQ} onChange={(e) => setNewQ(e.target.value)}
                    className="flex-1 px-4 py-2 text-base border border-gray-200 rounded-lg"
                    placeholder="What question might a guest ask?" />
                </div>
                <div className="flex items-start gap-3">
                  <label className="text-sm font-semibold text-gray-500 pt-2.5 w-6 shrink-0">A:</label>
                  <textarea value={newA} onChange={(e) => setNewA(e.target.value)} rows={2}
                    className="flex-1 px-4 py-2 text-base border border-gray-200 rounded-lg resize-y"
                    placeholder="The answer the AI should give..." />
                </div>
                <div className="ml-9">
                  {newUrls.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-2">
                      {newUrls.map((url, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-gray-100 rounded-lg text-sm text-gray-600">
                          <Link size={12} /> <span className="max-w-[200px] truncate">{url}</span>
                          <button onClick={() => setNewUrls(newUrls.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input value={newUrlInput} onChange={(e) => setNewUrlInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addNewUrl(); } }}
                      className="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg"
                      placeholder="Image or video URL (optional)" />
                    <button onClick={addNewUrl} disabled={!newUrlInput.trim()}
                      className="text-sm text-gray-400 hover:text-gray-600 disabled:opacity-30">+ URL</button>
                  </div>
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button onClick={addEntry} disabled={!newQ.trim() || !newA.trim()}
                  className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
                  <Plus size={18} /> Add
                </button>
              </div>
            </div>

            {/* KB entries — click to edit, auto-saves on blur */}
            <div className="space-y-3">
              {entries.map((e) => (
                <InlineEntry key={e.id} entry={e} onDelete={removeEntry} parseUrls={parseUrls} onRefresh={loadRightPanel} />
              ))}
              {entries.length === 0 && (
                <div className="text-center py-8 text-base text-gray-400">No Q&A entries yet. Add your first one above.</div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function InlineEntry({ entry, onDelete, parseUrls, onRefresh }: {
  entry: KBEntry;
  onDelete: (id: string) => void;
  parseUrls: (e: KBEntry) => string[];
  onRefresh: () => void;
}) {
  const [q, setQ] = useState(entry.title);
  const [a, setA] = useState(entry.content);
  const qRef = useRef(entry.title);
  const aRef = useRef(entry.content);
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);

  useEffect(() => { setQ(entry.title); qRef.current = entry.title; }, [entry.title]);
  useEffect(() => { setA(entry.content); aRef.current = entry.content; }, [entry.content]);

  const save = async (field: "title" | "content", value: string, ref: React.MutableRefObject<string>) => {
    if (value.trim() && value !== ref.current) {
      await supabase.from("knowledge_bases").update({ [field]: value.trim() }).eq("id", entry.id);
      ref.current = value;
    }
  };

  const addUrl = async () => {
    if (!urlInput.trim()) return;
    const existing = parseUrls(entry);
    const updated = [...existing, urlInput.trim()].join("\n");
    await supabase.from("knowledge_bases").update({ image_url: updated }).eq("id", entry.id);
    setUrlInput("");
    setShowUrlInput(false);
    onRefresh();
  };

  const removeUrl = async (index: number) => {
    const existing = parseUrls(entry);
    const updated = existing.filter((_, i) => i !== index);
    await supabase.from("knowledge_bases").update({ image_url: updated.length > 0 ? updated.join("\n") : null }).eq("id", entry.id);
    onRefresh();
  };

  const urls = parseUrls(entry);

  return (
    <div className="bg-white border border-gray-200 rounded-xl px-6 py-4 group">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-1">
          <div className="flex items-start gap-2">
            <span className="text-sm font-semibold text-gray-400 pt-1 shrink-0">Q:</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => save("title", q, qRef)}
              className="flex-1 text-base text-gray-900 bg-transparent border-0 outline-none px-0 py-0.5 focus:ring-0 focus:bg-gray-50 rounded -ml-0.5 pl-1 transition-colors" />
          </div>
          <div className="flex items-start gap-2">
            <span className="text-sm font-semibold text-gray-400 pt-1 shrink-0">A:</span>
            <textarea value={a} onChange={(e) => setA(e.target.value)} onBlur={() => save("content", a, aRef)} rows={1}
              onInput={(e) => { const t = e.target as HTMLTextAreaElement; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
              ref={(el) => { if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }}
              className="flex-1 text-base text-gray-600 bg-transparent border-0 outline-none px-0 py-0.5 focus:ring-0 focus:bg-gray-50 rounded -ml-0.5 pl-1 resize-none overflow-hidden transition-colors" />
          </div>
          <div className="flex flex-wrap items-center gap-2 ml-6">
            {urls.map((url, i) => (
              <span key={i} className="inline-flex items-center gap-1 text-sm text-blue-600 group/url">
                <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-blue-800">
                  <Link size={12} /> <span className="max-w-[200px] truncate">{url}</span>
                </a>
                <button onClick={() => removeUrl(i)} className="text-gray-300 hover:text-red-500 opacity-0 group-hover/url:opacity-100 transition-opacity"><X size={14} /></button>
              </span>
            ))}
            {showUrlInput ? (
              <div className="flex items-center gap-2">
                <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addUrl(); } if (e.key === "Escape") { setShowUrlInput(false); setUrlInput(""); } }}
                  onBlur={() => { if (!urlInput.trim()) { setShowUrlInput(false); } }}
                  className="px-2 py-1 text-sm border border-gray-200 rounded-lg w-56" placeholder="Paste URL and press Enter" />
              </div>
            ) : (
              <button onClick={() => setShowUrlInput(true)}
                className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600">
                <Link size={12} /> URL
              </button>
            )}
          </div>
        </div>
        <button onClick={() => onDelete(entry.id)}
          className="p-2 text-gray-200 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-3 shrink-0">
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}
