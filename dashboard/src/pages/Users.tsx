import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

interface Profile {
  id: string; email: string; full_name: string | null; role: string;
  can_view_kb: boolean; can_view_maintenance: boolean;
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "super_admin">("member");
  const [inviteKB, setInviteKB] = useState(true);
  const [inviteMaintenance, setInviteMaintenance] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState<{ email: string; password: string } | null>(null);

  const loadUsers = () => {
    supabase.from("profiles").select("*").order("email").then(({ data }) => setUsers((data as Profile[]) ?? []));
  };

  useEffect(loadUsers, []);

  const invite = async () => {
    if (!inviteEmail || !invitePassword) return;
    setInviting(true);
    const redirectTo = `${window.location.origin}/login`;
    const { data, error } = await supabase.auth.signUp({
      email: inviteEmail,
      password: invitePassword,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) { alert(error.message); setInviting(false); return; }

    const userId = data.user?.id;
    if (userId) {
      await new Promise((r) => setTimeout(r, 1500));
      await supabase.from("profiles").update({
        role: inviteRole,
        can_view_kb: inviteRole === "super_admin" ? true : inviteKB,
        can_view_maintenance: inviteRole === "super_admin" ? true : inviteMaintenance,
      }).eq("id", userId);
    }

    setInviteSuccess({ email: inviteEmail, password: invitePassword });
    setInviteEmail(""); setInvitePassword(""); setInviteRole("member");
    setInviteKB(true); setInviteMaintenance(true);
    setShowInvite(false);
    loadUsers();
    setInviting(false);
  };

  const changeRole = async (userId: string, newRole: string) => {
    await supabase.from("profiles").update({ role: newRole }).eq("id", userId);
    loadUsers();
  };

  const toggleAccess = async (userId: string, field: "can_view_kb" | "can_view_maintenance", current: boolean) => {
    await supabase.from("profiles").update({ [field]: !current }).eq("id", userId);
    loadUsers();
  };

  const deleteUser = async (userId: string) => {
    if (!confirm("Remove this user?")) return;
    await supabase.from("user_property_access").delete().eq("user_id", userId);
    await supabase.from("profiles").delete().eq("id", userId);
    loadUsers();
  };

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
        <button onClick={() => setShowInvite(!showInvite)}
          className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
          <Plus size={20} /> Invite User
        </button>
      </div>

      {/* Invite success */}
      {inviteSuccess && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-base font-medium text-green-800">Invite sent to {inviteSuccess.email}</div>
              <div className="text-sm text-green-700 mt-1">A confirmation email has been sent. Share these credentials with the user:</div>
              <div className="mt-3 bg-white rounded-lg border border-green-200 px-4 py-3 font-mono text-sm text-gray-800 select-all">
                Email: {inviteSuccess.email}<br />
                Password: {inviteSuccess.password}
              </div>
              <div className="text-xs text-green-600 mt-2">The user must click the confirmation link in their email before they can log in.</div>
            </div>
            <button onClick={() => setInviteSuccess(null)} className="text-green-400 hover:text-green-600 p-1">
              <ChevronUp size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="text-base font-medium text-gray-900 mb-4">Invite New User</div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <label className="block">
              <span className="text-sm text-gray-400">Email</span>
              <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="user@example.com" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-400">Temporary Password</span>
              <input value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} type="password"
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="min 6 characters" />
            </label>
          </div>
          <div className="mb-4">
            <span className="text-sm text-gray-400">Role</span>
            <div className="flex gap-3 mt-1.5">
              {(["member", "super_admin"] as const).map((r) => (
                <button key={r} onClick={() => setInviteRole(r)}
                  className={`px-4 py-2 text-sm rounded-lg border ${inviteRole === r
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"}`}>
                  {r === "super_admin" ? "Admin" : "Member"}
                </button>
              ))}
            </div>
          </div>
          {inviteRole === "member" && (
            <div className="mb-4">
              <span className="text-sm text-gray-400">Can access</span>
              <div className="flex gap-4 mt-1.5">
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={inviteKB} onChange={(e) => setInviteKB(e.target.checked)}
                    className="rounded w-4 h-4 text-gray-900" />
                  <span className="text-base text-gray-700">Knowledge Base</span>
                </label>
                <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={inviteMaintenance} onChange={(e) => setInviteMaintenance(e.target.checked)}
                    className="rounded w-4 h-4 text-gray-900" />
                  <span className="text-base text-gray-700">Maintenance</span>
                </label>
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={invite} disabled={inviting || !inviteEmail || !invitePassword}
              className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50">
              {inviting ? "Inviting..." : "Send Invite"}
            </button>
            <button onClick={() => setShowInvite(false)} className="px-5 py-2 text-base text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {/* User list */}
      <div className="space-y-3">
        {users.map((u) => {
          const isExpanded = expandedUser === u.id;
          const isAdmin = u.role === "super_admin";
          const isSelf = currentUser?.id === u.id;
          return (
            <div key={u.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-4 cursor-pointer" onClick={() => setExpandedUser(isExpanded ? null : u.id)}>
                <div>
                  <div className="text-base font-medium text-gray-900">
                    {u.email}
                    {isSelf && <span className="text-sm text-gray-400 ml-2">(you)</span>}
                  </div>
                  {u.full_name && <div className="text-sm text-gray-400">{u.full_name}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-sm px-3 py-0.5 rounded-lg font-medium ${isAdmin ? "bg-purple-50 text-purple-700" : "bg-gray-100 text-gray-500"}`}>
                    {isAdmin ? "Admin" : "Member"}
                  </span>
                  {!isAdmin && (
                    <span className="text-xs text-gray-400">
                      {[u.can_view_kb && "KB", u.can_view_maintenance && "Maintenance"].filter(Boolean).join(", ") || "No access"}
                    </span>
                  )}
                  {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-100 px-6 py-4 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-400">Role</span>
                      {isSelf ? (
                        <span className="text-sm text-gray-500">{isAdmin ? "Admin" : "Member"}</span>
                      ) : (
                        <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}
                          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white cursor-pointer">
                          <option value="member">Member</option>
                          <option value="super_admin">Admin</option>
                        </select>
                      )}
                    </div>
                    {!isSelf && (
                      <button onClick={() => deleteUser(u.id)} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-500">
                        <Trash2 size={14} /> Remove user
                      </button>
                    )}
                  </div>

                  {!isAdmin && (
                    <div>
                      <span className="text-sm text-gray-400">Can access</span>
                      <div className="flex gap-4 mt-2">
                        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox" checked={u.can_view_kb}
                            onChange={() => toggleAccess(u.id, "can_view_kb", u.can_view_kb)}
                            className="rounded w-4 h-4 text-gray-900" />
                          <span className="text-base text-gray-700">Knowledge Base</span>
                        </label>
                        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 cursor-pointer">
                          <input type="checkbox" checked={u.can_view_maintenance}
                            onChange={() => toggleAccess(u.id, "can_view_maintenance", u.can_view_maintenance)}
                            className="rounded w-4 h-4 text-gray-900" />
                          <span className="text-base text-gray-700">Maintenance</span>
                        </label>
                      </div>
                    </div>
                  )}
                  {isAdmin && (
                    <div className="text-sm text-gray-400">Admins have full access to all sections.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
