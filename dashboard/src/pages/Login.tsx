import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setSubmitting(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-xs">
        <div className="text-center mb-6">
          <div className="w-8 h-8 bg-gray-900 rounded mx-auto mb-3" />
          <h1 className="text-sm font-semibold text-gray-900">UA Dashboard</h1>
          <p className="text-[11px] text-gray-400 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-5">
          {error && (
            <div className="text-[11px] text-red-600 bg-red-50 rounded px-3 py-2 mb-3">{error}</div>
          )}

          <label className="block mb-3">
            <span className="text-[11px] text-gray-500 font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full px-3 py-1.5 text-[12px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-300"
              required
            />
          </label>

          <label className="block mb-4">
            <span className="text-[11px] text-gray-500 font-medium">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full px-3 py-1.5 text-[12px] border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-300"
              required
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-1.5 text-[12px] font-medium bg-gray-900 text-white rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
