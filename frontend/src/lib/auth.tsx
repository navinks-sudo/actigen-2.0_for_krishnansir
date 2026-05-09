import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface User {
  username: string;
  display_name?: string | null;
}

interface AuthCtx {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, display_name?: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

const TOKEN_KEY = "vm_token";

async function readApiErrorBody(r: Response): Promise<string> {
  const raw = (await r.text()).trim();
  if (!raw) return `Request failed (${r.status})`;
  try {
    const j = JSON.parse(raw) as { detail?: unknown };
    if (j.detail != null) {
      if (typeof j.detail === "string") return j.detail;
      if (Array.isArray(j.detail))
        return j.detail.map((x: { msg?: string }) => x?.msg ?? JSON.stringify(x)).join("; ");
    }
  } catch {
    /* not JSON */
  }
  return raw.length > 240 ? `${raw.slice(0, 240)}…` : raw;
}

function mapNetworkAuthError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (
    msg === "Failed to fetch" ||
    lower.includes("networkerror") ||
    lower.includes("load failed") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("connection refused")
  ) {
    return new Error(
      "Cannot reach the API. Start the backend on port 8003 (uvicorn) and open the app via npm run dev on port 5173 so /api is proxied. Preview builds need a reverse proxy to the same API."
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function authHeaders(): HeadersInit {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error("invalid");
        return r.json();
      })
      .then((u) => setUser(u))
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  const login = async (username: string, password: string) => {
    let r: Response;
    try {
      r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
    } catch (e) {
      throw mapNetworkAuthError(e);
    }
    if (!r.ok) {
      const detail = await readApiErrorBody(r);
      throw new Error(r.status === 401 ? "Invalid username or password" : detail);
    }
    const data = await r.json();
    if (!data?.token) throw new Error("Login response missing token — check API version.");
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser({ username: data.username, display_name: data.display_name });
  };

  const register = async (username: string, password: string, display_name?: string) => {
    let r: Response;
    try {
      r = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, display_name }),
      });
    } catch (e) {
      throw mapNetworkAuthError(e);
    }
    if (!r.ok) {
      const detail = await readApiErrorBody(r);
      throw new Error(r.status === 409 ? "Username already taken" : detail);
    }
    const data = await r.json();
    if (!data?.token) throw new Error("Register response missing token — check API version.");
    localStorage.setItem(TOKEN_KEY, data.token);
    setToken(data.token);
    setUser({ username: data.username, display_name: data.display_name });
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside provider");
  return c;
}
