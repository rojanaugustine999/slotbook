import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, describeError } from "../api/client";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { useAuth } from "./AuthProvider";

interface OpenOptions {
  /** A sentence explaining why we're asking, such as "Sign in to confirm your booking". */
  /**
   * What signing in is FOR, without the verb: "to see your bookings". The dialog adds
   * "Sign in" or "Create an account" to match the form, so the line never contradicts it.
   */
  purpose?: string;
  /** Runs right after a successful sign-in, so the person carries on where they were. */
  onSuccess?: () => void;
  mode?: "signIn" | "signUp";
}

const AuthDialogContext = createContext<((options?: OpenOptions) => void) | null>(null);

/** Call the returned function to open the sign-in dialog from anywhere. */
export function useAuthDialog() {
  const open = useContext(AuthDialogContext);
  if (!open) throw new Error("useAuthDialog must be used inside <AuthDialogProvider>");
  return open;
}

export function AuthDialogProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<OpenOptions | null>(null);
  const open = useCallback((next: OpenOptions = {}) => setOptions(next), []);
  const close = useCallback(() => setOptions(null), []);

  return (
    <AuthDialogContext.Provider value={open}>
      {children}
      <Dialog open={options !== null} onClose={close} title={options?.mode === "signUp" ? "Create your account" : "Sign in"}>
        {/* The mode lives here, in one place, so the title and the form always agree. */}
        {options && <AuthForm options={options} onDone={close} onModeChange={(mode) => setOptions({ ...options, mode })} />}
      </Dialog>
    </AuthDialogContext.Provider>
  );
}

function AuthForm({ options, onDone, onModeChange }: { options: OpenOptions; onDone: () => void; onModeChange: (mode: "signIn" | "signUp") => void }) {
  const { signIn, signUp } = useAuth();
  const mode = options.mode ?? "signIn";
  const setMode = onModeChange;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const creating = mode === "signUp";

  const submit = useMemo(
    () => async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      setFieldErrors({});
      try {
        if (creating) await signUp({ name, email, password, phone });
        else await signIn(email, password);
        onDone();
        options.onSuccess?.();
      } catch (err) {
        if (err instanceof ApiError && err.code === "VALIDATION_ERROR" && err.details) setFieldErrors(err.details);
        else if (err instanceof ApiError && err.status === 401) setError("That email and password don't match.");
        else if (err instanceof ApiError && err.status === 409) setError("An account with this email already exists. Try signing in.");
        else setError(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [creating, name, email, password, phone, signIn, signUp, onDone, options],
  );

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {options.purpose && (
        <p className="text-[15px] text-ink-2">
          {creating ? "Create an account" : "Sign in"} {options.purpose}
        </p>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {creating && <Field label="Your name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={fieldErrors.name?.[0]} required />}
      <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} error={fieldErrors.email?.[0]} required />
      <Field
        label="Password"
        type="password"
        autoComplete={creating ? "new-password" : "current-password"}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={fieldErrors.password?.[0]}
        placeholder={creating ? "At least 8 characters" : undefined}
        required
      />
      {/* Required: salons need a way to reach the people who book with them. The reason is shown. */}
      {creating && (
        <Field
          label="Phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+91 98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          error={fieldErrors.phone?.[0]}
          hint="So a salon can reach you about your booking, for example if you're running late."
        />
      )}

      <Button type="submit" variant="primary" block loading={busy}>
        {creating ? "Create account" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-ink-2">
        {creating ? "Already have an account? " : "New here? "}
        <button type="button" className="font-medium text-accent underline underline-offset-2" onClick={() => setMode(creating ? "signIn" : "signUp")}>
          {creating ? "Sign in" : "Create an account"}
        </button>
      </p>
    </form>
  );
}
