import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, refreshAccessToken, setAccessToken } from "../api/client";
import type { User } from "../api/types";

type Status = "loading" | "signedIn" | "signedOut";

interface AuthValue {
  status: Status;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { name: string; email: string; password: string; phone?: string }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replaces the signed-in user after they edit their own details (Account page). */
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  // On every page load the access token is gone (it lives only in memory), so quietly
  // ask for a fresh one with the refresh cookie. If that works, the visitor is still signed in.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (await refreshAccessToken()) {
        try {
          const me = await api<{ user: User }>("/auth/me");
          if (!cancelled) {
            setUser(me.user);
            setStatus("signedIn");
          }
          return;
        } catch {
          // fall through to signed out
        }
      }
      if (!cancelled) setStatus("signedOut");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback((result: { user: User; accessToken: string }) => {
    setAccessToken(result.accessToken);
    setUser(result.user);
    setStatus("signedIn");
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      finish(await api<{ user: User; accessToken: string }>("/auth/login", { method: "POST", body: { email, password }, auth: false }));
    },
    [finish],
  );

  const signUp = useCallback(
    async (input: { name: string; email: string; password: string; phone?: string }) => {
      finish(await api<{ user: User; accessToken: string }>("/auth/register", { method: "POST", body: input, auth: false }));
    },
    [finish],
  );

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", auth: false });
    } finally {
      setAccessToken(null);
      setUser(null);
      setStatus("signedOut");
      queryClient.clear(); // forget everything that belonged to the previous person
    }
  }, [queryClient]);

  const updateUser = useCallback((next: User) => setUser(next), []);

  const value = useMemo(() => ({ status, user, signIn, signUp, signOut, updateUser }), [status, user, signIn, signUp, signOut, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>");
  return value;
}
