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
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <img src="/logo.png" alt="Uncommon Accommodations" className="h-12 mx-auto mb-5" />
          <p className="text-base text-gray-400 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-8">
          {error && (
            <div className="text-base text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-5">{error}</div>
          )}

          <label className="block mb-5">
            <span className="text-base text-gray-500 font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1.5 w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
              required
            />
          </label>

          <label className="block mb-6">
            <span className="text-base text-gray-500 font-medium">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
              required
            />
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
