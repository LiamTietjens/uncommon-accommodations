import { NavLink, Outlet, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  Home, Building2, Wrench, Clock, Users, Bell,
  AlertTriangle, Package, LogOut, Menu, X
} from "lucide-react";
import { useState } from "react";

const nav = [
  { to: "/", icon: Home, label: "Overview" },
  { to: "/properties", icon: Building2, label: "Properties & KB" },
  { to: "/tickets", icon: Wrench, label: "Maintenance" },
  { to: "/cooldowns", icon: Clock, label: "Cooldowns" },
  { to: "/extras", icon: Package, label: "Extra Requests" },
];

const adminNav = [
  { to: "/users", icon: Users, label: "Users" },
  { to: "/sms-recipients", icon: Bell, label: "SMS Recipients" },
  { to: "/urgency", icon: AlertTriangle, label: "Urgency Levels" },
];

export default function Layout() {
  const { user, profile, loading, isSuperAdmin, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  if (loading) return <div className="flex items-center justify-center h-screen text-base text-gray-400">Loading...</div>;
  if (!user) return <Navigate to="/login" />;

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className={`${menuOpen ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 fixed md:static z-40 w-72 h-full bg-white border-r border-gray-200 flex flex-col transition-transform`}>
        <div className="px-5 py-5 border-b border-gray-100">
          <img src="/logo.png" alt="Uncommon Accommodations" className="h-10" />
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="px-4 pb-2 pt-2 text-sm font-medium text-gray-400 uppercase tracking-wider">Main</div>
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-2.5 text-base mx-2 rounded-lg ${
                  isActive ? "bg-gray-100 text-gray-900 font-medium" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                }`
              }
            >
              <n.icon size={22} strokeWidth={1.5} />
              {n.label}
            </NavLink>
          ))}

          {isSuperAdmin && (
            <>
              <div className="px-4 pb-2 pt-5 text-sm font-medium text-gray-400 uppercase tracking-wider">Admin</div>
              {adminNav.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  onClick={() => setMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-5 py-2.5 text-base mx-2 rounded-lg ${
                      isActive ? "bg-gray-100 text-gray-900 font-medium" : "text-gray-500 hover:bg-gray-50 hover:text-gray-700"
                    }`
                  }
                >
                  <n.icon size={22} strokeWidth={1.5} />
                  {n.label}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="border-t border-gray-100 p-5">
          <div className="text-base text-gray-500 truncate">{profile?.email}</div>
          <div className="text-sm text-gray-400">{profile?.role === "super_admin" ? "Admin" : "Member"}</div>
          <button onClick={signOut} className="flex items-center gap-2 mt-3 text-sm text-gray-400 hover:text-gray-600">
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile menu toggle */}
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="md:hidden fixed top-4 left-4 z-50 p-2.5 bg-white border border-gray-200 rounded-lg"
      >
        {menuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-10">
          <Outlet />
        </div>
      </main>

      {/* Mobile overlay */}
      {menuOpen && <div className="md:hidden fixed inset-0 bg-black/20 z-30" onClick={() => setMenuOpen(false)} />}
    </div>
  );
}
