import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Trash2, Shield, Building2 } from "lucide-react";

interface Profile { id: string; email: string; full_name: string | null; role: string; }
interface Property { id: string; name: string; }
interface Access { id: string; user_id: string; property_id: string; properties?: { name: string }; }

export default function Users() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [userAccess, setUserAccess] = useState<Access[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviting, setInviting] = useState(false);

  const loadUsers = () => {
    supabase.from("profiles").select("*").order("email").then(({ data }) => setUsers(data ?? []));
  };

  useEffect(() => {
    loadUsers();
    supabase.from("properties").select("id, name").order("name").then(({ data }) => setProperties(data ?? []));
  }, []);

  useEffect(() => {
    if (!selectedUser) return;
    supabase.from("user_property_access").select("*, properties(name)").eq("user_id", selectedUser)
      .then(({ data }) => setUserAccess((data as Access[]) ?? []));
  }, [selectedUser]);

  const invite = async () => {
    if (!inviteEmail || !invitePassword) return;
    setInviting(true);
    const { error } = await supabase.auth.signUp({ email: inviteEmail, password: invitePassword });
    if (error) alert(error.message);
    else { setInviteEmail(""); setInvitePassword(""); setTimeout(loadUsers, 1000); }
    setInviting(false);
  };

  const toggleRole = async (id: string, currentRole: string) => {
    const newRole = currentRole === "super_admin" ? "member" : "super_admin";
    await supabase.from("profiles").update({ role: newRole }).eq("id", id);
    loadUsers();
  };

  const addAccess = async (propertyId: string) => {
    if (!selectedUser) return;
    await supabase.from("user_property_access").insert({ user_id: selectedUser, property_id: propertyId });
    supabase.from("user_property_access").select("*, properties(name)").eq("user_id", selectedUser)
      .then(({ data }) => setUserAccess((data as Access[]) ?? []));
  };

  const removeAccess = async (accessId: string) => {
    await supabase.from("user_property_access").delete().eq("id", accessId);
    supabase.from("user_property_access").select("*, properties(name)").eq("user_id", selectedUser!)
      .then(({ data }) => setUserAccess((data as Access[]) ?? []));
  };

  return (
    <div>
      <h1 className="text-base font-semibold text-gray-900 mb-4">User Management</h1>

      {/* Invite */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
        <div className="text-[11px] font-medium text-gray-900 mb-2">Invite New User</div>
        <div className="flex gap-2 items-end">
          <label className="flex-1">
            <span className="text-[10px] text-gray-400">Email</span>
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
              className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded" placeholder="user@example.com" />
          </label>
          <label className="flex-1">
            <span className="text-[10px] text-gray-400">Temporary Password</span>
            <input value={invitePassword} onChange={(e) => setInvitePassword(e.target.value)} type="password"
              className="mt-0.5 w-full px-2 py-1 text-[11px] border border-gray-200 rounded" placeholder="min 6 characters" />
          </label>
          <button onClick={invite} disabled={inviting}
            className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50 shrink-0">
            <Plus size={12} /> {inviting ? "..." : "Invite"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* User list */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 text-[10px] text-gray-400 uppercase tracking-wider font-medium">Users</div>
          {users.map((u) => (
            <div key={u.id} onClick={() => setSelectedUser(u.id)}
              className={`flex items-center justify-between px-4 py-2 cursor-pointer border-b border-gray-50 ${selectedUser === u.id ? "bg-gray-50" : "hover:bg-gray-50/50"}`}>
              <div>
                <div className="text-[12px] text-gray-900">{u.email}</div>
                <div className="text-[10px] text-gray-400">{u.full_name || "No name"}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${u.role === "super_admin" ? "bg-purple-50 text-purple-700" : "bg-gray-100 text-gray-500"}`}>
                  {u.role === "super_admin" ? "Admin" : "Member"}
                </span>
                <button onClick={(e) => { e.stopPropagation(); toggleRole(u.id, u.role); }} title="Toggle role"
                  className="p-1 text-gray-300 hover:text-purple-500"><Shield size={12} /></button>
              </div>
            </div>
          ))}
        </div>

        {/* Property access */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-gray-100 text-[10px] text-gray-400 uppercase tracking-wider font-medium">
            Property Access {selectedUser ? `— ${users.find((u) => u.id === selectedUser)?.email}` : ""}
          </div>
          {!selectedUser ? (
            <div className="px-4 py-8 text-center text-[11px] text-gray-400">Select a user to manage access</div>
          ) : (
            <>
              <div className="px-4 py-2 border-b border-gray-50">
                <select onChange={(e) => { if (e.target.value) addAccess(e.target.value); e.target.value = ""; }}
                  className="w-full px-2 py-1 text-[11px] border border-gray-200 rounded bg-white">
                  <option value="">+ Assign property...</option>
                  {properties.filter((p) => !userAccess.some((a) => a.property_id === p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              {userAccess.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-4 py-2 border-b border-gray-50">
                  <div className="flex items-center gap-2 text-[12px] text-gray-700">
                    <Building2 size={12} className="text-gray-400" /> {(a.properties as any)?.name}
                  </div>
                  <button onClick={() => removeAccess(a.id)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              ))}
              {userAccess.length === 0 && (
                <div className="px-4 py-4 text-center text-[11px] text-gray-400">No properties assigned. Admins have access to all.</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
