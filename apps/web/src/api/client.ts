// ─── Talking to the API ──────────────────────────────────────────────────────
// Sign-in works with two tokens (see apps/api/src/modules/auth/auth.service.ts):
//
//  access token   short-lived (15 min). Kept only in this variable, in memory, and sent
//                 as "Authorization: Bearer ...". Not in localStorage: any script on the
//                 page could read localStorage, but it can't read a JavaScript variable
//                 it has no reference to, and the token vanishes when the tab closes.
//
//  refresh token  long-lived, in an httpOnly cookie that JavaScript can't read at all.
//                 When the access token expires (a 401), we ask /auth/refresh for a new
//                 one: the browser attaches the cookie itself ("credentials: include").
// ──────────────────────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// If several requests hit an expired token at once, they must share ONE refresh call.
// The API rotates refresh tokens (each works once), so two simultaneous refreshes
// would look like token theft and sign the user out everywhere.
let refreshInFlight: Promise<boolean> | null = null;

export function refreshAccessToken(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, { method: "POST", credentials: "include" });
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      accessToken = ((await res.json()) as { accessToken: string }).accessToken;
      return true;
    } catch {
      return false; // network trouble: treat as signed out for now
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** false for login and sign-up, where a 401 means "wrong password", not "token expired". */
  auth?: boolean;
}

export async function api<T>(path: string, { method = "GET", body, auth = true }: RequestOptions = {}): Promise<T> {
  const send = () =>
    fetch(`${BASE_URL}${path}`, {
      method,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await send();
  if (res.status === 401 && auth && (await refreshAccessToken())) res = await send(); // retry once, with the new token

  if (res.status === 204) return undefined as T;

  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: Record<string, string[]> } } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? "UNKNOWN", data?.error?.message ?? "Something went wrong. Please try again.", data?.error?.details);
  }
  return data as T;
}

/** A friendly sentence for an error, for showing to people. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Too many attempts. Please wait a few minutes and try again.";
    if (error.code === "SLOT_TAKEN") return "That time was just taken. Please pick another.";
    return error.message;
  }
  return "We couldn't reach the server. Check your connection and try again.";
}
