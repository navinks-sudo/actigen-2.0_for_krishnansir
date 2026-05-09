import { useState } from "react";
import { Link, useNavigate, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Loader2, ArrowLeft, ArrowRight, User, Lock } from "lucide-react";
import { useAuth } from "../lib/auth";
import BrandLogo from "../components/BrandLogo";

export default function Login() {
  const nav = useNavigate();
  const { login, register, user } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (user) return <Navigate to="/app" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const u = username.trim();
      const p = password;
      if (mode === "login") await login(u, p);
      else await register(u, p, displayName.trim() || undefined);
      nav("/app");
    } catch (e: any) {
      setErr(e.message || "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const useDemo = () => {
    setUsername("admin");
    setPassword("admin1");
  };

  return (
    <div className="mx-auto grid min-h-[min(70vh,calc(100dvh-12rem))] max-w-6xl items-center gap-8 px-4 py-12 lg:grid-cols-2 lg:px-6">
      {/* Left: pitch panel */}
      <motion.div
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        className="hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-10 text-white shadow-xl lg:block lg:pr-8"
      >
        <Link to="/" className="mb-8 inline-flex items-center gap-1 text-sm text-zinc-400 transition-colors hover:text-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to landing
        </Link>
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-600 bg-zinc-800/80 px-3 py-1 text-xs font-medium text-zinc-200">
          Welcome back
        </div>
        <h1 className="font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-white xl:text-5xl">
          Sign in to your <span className="gradient-text">document workbench</span>.
        </h1>
        <p className="mt-5 max-w-md text-lg text-zinc-400">
          Pick up wherever you left off — every stage, every QC, every translation in one portal.
        </p>

        <div className="mt-10 max-w-md rounded-xl border border-zinc-700/90 bg-zinc-900/60 p-5 backdrop-blur-sm">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Demo credentials</div>
          <div className="flex items-center justify-between gap-3">
            <code className="font-mono text-sm text-teal-200">admin / admin1</code>
            <button type="button" onClick={useDemo} className="btn-soft shrink-0 px-3 py-1 text-xs">
              Use demo
            </button>
          </div>
        </div>
      </motion.div>

      {/* Right: form */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="surface mx-auto w-full max-w-md rounded-2xl border-zinc-200/90 p-8 shadow-lg md:rounded-3xl md:p-10"
      >
        <Link to="/" className="lg:hidden text-sm text-ink-500 hover:text-ink-800 inline-flex items-center gap-1 mb-6">
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </Link>
        <div className="mb-2">
          <BrandLogo />
        </div>
        <h2 className="font-display text-2xl font-bold mt-6">
          {mode === "login" ? "Sign in" : "Create your account"}
        </h2>
        <p className="text-ink-600 text-sm mt-1">
          {mode === "login"
            ? "Use your username and password."
            : "Pick a username and password (at least 6 characters) to get started."}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label block mb-1.5">Username</label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="input pl-9"
                placeholder="admin"
                autoFocus
                required
              />
            </div>
          </div>

          {mode === "register" && (
            <div>
              <label className="label block mb-1.5">Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input"
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label className="label block mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="input pl-9"
                placeholder="••••••••"
                required
              />
            </div>
          </div>

          {err && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm">
              {err}
            </div>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
            {busy ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                {mode === "login" ? "Sign in" : "Create account"}
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-ink-500">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                onClick={() => setMode("register")}
                className="text-brand-600 hover:text-brand-700 font-medium"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-brand-600 hover:text-brand-700 font-medium"
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
