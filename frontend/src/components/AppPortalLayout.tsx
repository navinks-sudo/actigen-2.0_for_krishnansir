import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Upload as UploadIcon,
  LogOut,
  LogIn,
  FileStack,
  ChevronLeft,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "../lib/auth";

function segmentClass(isActive: boolean) {
  return `rounded-md px-3 py-2 text-sm font-semibold transition-all sm:px-4 ${
    isActive
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
  }`;
}

/** Sticky top bar — primary navigation (replaces sidebar for clearer hierarchy). */
function WorkbenchHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-800/90 bg-zinc-950/95 backdrop-blur-xl">
      <div className="mx-auto flex h-[3.25rem] max-w-[1920px] items-center gap-2 px-3 sm:h-14 sm:gap-4 sm:px-5">
        <Link to="/app" className="flex shrink-0 items-center gap-2 rounded-lg py-1 pr-2 outline-none ring-offset-zinc-950 focus-visible:ring-2 focus-visible:ring-teal-400">
          <img src="/logo.png" alt="" className="h-7 w-auto object-contain sm:h-8" />
          <span className="hidden font-display text-sm font-bold tracking-tight text-white sm:inline">ACTIGEN</span>
        </Link>

        <nav
          className="ml-1 flex flex-1 items-center justify-center gap-0.5 rounded-lg bg-zinc-900/90 p-1 sm:ml-2 sm:max-w-md sm:justify-start"
          aria-label="Workbench"
        >
          <NavLink to="/app" end className={({ isActive }) => segmentClass(isActive)}>
            <span className="flex items-center justify-center gap-2">
              <LayoutDashboard className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
              <span>Documents</span>
            </span>
          </NavLink>
          <NavLink to="/app/upload" className={({ isActive }) => segmentClass(isActive)}>
            <span className="flex items-center justify-center gap-2">
              <UploadIcon className="h-4 w-4 opacity-80" aria-hidden />
              Upload
            </span>
          </NavLink>
        </nav>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Link
            to="/"
            className="hidden items-center gap-1 rounded-lg border border-zinc-700/90 px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-100 md:inline-flex"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            Marketing
          </Link>
          {user ? (
            <>
              <div className="hidden max-w-[11rem] text-right lg:block">
                <div className="truncate text-xs font-medium text-zinc-200">{user.display_name || user.username}</div>
                <div className="truncate text-[10px] text-zinc-500">{user.username}</div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-rose-500/40 hover:bg-rose-950/40 hover:text-rose-100 sm:gap-1.5 sm:px-3 sm:py-2"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            <Link to="/login" className="btn-primary px-3 py-1.5 text-xs sm:px-4 sm:py-2 sm:text-sm">
              <LogIn className="h-3.5 w-3.5" aria-hidden />
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/** QC route — minimal chrome so the document owns the viewport. */
function QcChrome() {
  const { user } = useAuth();

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2.5 sm:gap-3 sm:px-4">
      <Link
        to="/app"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 text-xs font-semibold text-zinc-100 transition-colors hover:border-teal-500/50 hover:bg-zinc-800 sm:gap-2 sm:px-3"
      >
        <ChevronLeft className="h-4 w-4 text-teal-400" aria-hidden />
        <FileStack className="hidden h-3.5 w-3.5 sm:inline" aria-hidden />
        <span>All documents</span>
      </Link>
      <span className="hidden h-5 w-px bg-zinc-700 sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-bold uppercase tracking-widest text-teal-400/90">QC workbench</p>
        <p className="truncate text-sm font-semibold text-white">Review & approve</p>
      </div>
      {user && (
        <span className="hidden max-w-[8rem] truncate text-right text-[11px] text-zinc-500 sm:block">
          {user.display_name || user.username}
        </span>
      )}
    </header>
  );
}

export default function AppPortalLayout() {
  const loc = useLocation();
  const isDoc = loc.pathname.startsWith("/app/doc/");

  if (isDoc) {
    return (
      <div className="flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-zinc-950">
        <QcChrome />
        <div className="min-h-0 flex-1 overflow-hidden bg-zinc-900 p-1.5 sm:p-2">
          <div className="mx-auto flex h-full max-w-[1920px] flex-col overflow-hidden rounded-lg border border-zinc-700/80 bg-white shadow-xl">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2 sm:p-3">
              <Outlet />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col bg-zinc-100 pb-[4.25rem] lg:pb-0">
      <WorkbenchHeader />
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-200/50">
        <div className="mx-auto flex w-full max-w-[1680px] flex-1 flex-col px-3 py-4 sm:px-5 sm:py-6">
          <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-zinc-200/90 bg-white shadow-sm">
            <div className="flex flex-1 flex-col p-4 sm:p-6 lg:p-8">
              <Outlet />
            </div>
          </div>
        </div>
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch justify-around gap-1 border-t border-zinc-800 bg-zinc-950/98 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden"
        aria-label="Primary"
      >
        <NavLink
          to="/app"
          end
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wide ${
              isActive ? "text-teal-400" : "text-zinc-500"
            }`
          }
        >
          <LayoutDashboard className="h-5 w-5" aria-hidden />
          Docs
        </NavLink>
        <NavLink
          to="/app/upload"
          className={({ isActive }) =>
            `flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[10px] font-bold uppercase tracking-wide ${
              isActive ? "text-teal-400" : "text-zinc-500"
            }`
          }
        >
          <UploadIcon className="h-5 w-5" aria-hidden />
          Upload
        </NavLink>
      </nav>
    </div>
  );
}
