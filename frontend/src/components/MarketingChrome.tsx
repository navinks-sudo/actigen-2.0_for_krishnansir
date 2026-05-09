import { Link, useLocation } from "react-router-dom";
import { LogIn, ArrowUpRight } from "lucide-react";
import { useAuth } from "../lib/auth";
import BrandLogo from "./BrandLogo";

export function MarketingHeader() {
  const { user } = useAuth();
  const loc = useLocation();
  const onLogin = loc.pathname === "/login";

  return (
    <header className="sticky top-0 z-40 shrink-0 border-b border-zinc-800/80 bg-zinc-950/95 shadow-lg shadow-black/25 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <BrandLogo tone="onDark" />
        </Link>
        <nav className="flex items-center gap-2 sm:gap-3">
          {!onLogin && (
            <Link
              to="/#stages"
              className="rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800/60 hover:text-white"
            >
              Pipeline
            </Link>
          )}
          {user ? (
            <Link
              to="/app"
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-grad px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-teal-900/35 transition-opacity hover:opacity-95"
            >
              Workbench <ArrowUpRight className="h-3.5 w-3.5 opacity-90" />
            </Link>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800/80 px-4 py-2 text-sm font-semibold text-white transition-colors hover:border-zinc-500 hover:bg-zinc-700/90"
            >
              <LogIn className="h-4 w-4" /> Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-800 bg-zinc-950 py-10 text-center">
      <div className="mx-auto max-w-6xl space-y-2 px-4">
        <p className="text-sm font-semibold text-zinc-200">ACTIGEN 2.0</p>
        <p className="text-xs text-zinc-500">One engine · multiple solutions · QC at every stage</p>
      </div>
    </footer>
  );
}

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain flex min-h-[100dvh] flex-col bg-zinc-100">
      <MarketingHeader />
      <div className="relative flex-1">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_45%_at_50%_-15%,rgba(20,184,166,0.14),transparent)]" />
        <div className="relative">{children}</div>
      </div>
      <MarketingFooter />
    </div>
  );
}
