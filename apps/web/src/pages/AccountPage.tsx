import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { ApiError, describeError } from "../api/client";
import { useChangePassword, useSignOutOtherDevices, useUpdateMe } from "../api/hooks";
import type { User } from "../api/types";
import { useAuthDialog } from "../auth/AuthDialog";
import { useAuth } from "../auth/AuthProvider";
import { Button, Spinner } from "../ui/Button";
import { Field } from "../ui/Field";
import { Notice } from "../ui/Notice";

// ─── Your account ────────────────────────────────────────────────────────────
// The same page for everyone: customers, salon owners and SlotBook admins are all just
// accounts. Name and phone, password, and signing out other devices.
// ──────────────────────────────────────────────────────────────────────────────

export function AccountPage() {
  const { status, user, signOut } = useAuth();
  const openAuth = useAuthDialog();

  if (status === "loading") {
    return (
      <div className="flex justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (status === "signedOut" || !user) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <h1 className="text-xl font-medium">Your account</h1>
        <p className="mt-2 text-ink-2">Sign in to see and change your details.</p>
        <Button variant="primary" className="mt-5" onClick={() => openAuth({ reason: "Sign in to see your account." })}>
          Sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-medium">Your account</h1>
      {user.isPlatformAdmin && (
        <Notice>
          You're a SlotBook admin.{" "}
          <Link to="/admin" className="font-medium text-accent underline underline-offset-2">
            Open the admin page
          </Link>
        </Notice>
      )}
      {/* key: start the form again from the saved values whenever they change */}
      <Details key={`${user.name}|${user.phone ?? ""}`} user={user} />
      <Password />
      <Devices />
      {/* On phones the header has no room for Sign out, so it lives here too. */}
      <div className="flex justify-center pb-4">
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-[17px] font-medium">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

// ─── Name and phone ─────────────────────────────────────────────────────────

function Details({ user }: { user: User }) {
  const save = useUpdateMe();
  const [name, setName] = useState(user.name);
  const [phone, setPhone] = useState(user.phone ?? "");
  const [nameError, setNameError] = useState<string>();
  const [saved, setSaved] = useState(false);

  // The API's own message ("use digits, like ...") is shown under the phone box.
  const phoneError = save.error instanceof ApiError && save.error.status === 400 ? describeError(save.error) : undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return setNameError("Enter your name.");
    setNameError(undefined);
    setSaved(false);
    save.mutate({ name: name.trim(), phone: phone.trim() }, { onSuccess: () => setSaved(true) });
  }

  return (
    <Card title="Your details">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Name" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} error={nameError} maxLength={100} />
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-2">Email</p>
          <p className="text-[15px]">{user.email}</p>
          <p className="mt-1 text-xs text-ink-3">The email you sign in with can't be changed here.</p>
        </div>
        <Field
          label="Phone (optional)"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+91 98765 43210"
          value={phone}
          onChange={(e) => { setPhone(e.target.value); setSaved(false); }}
          error={phoneError}
          hint="Salons you book with can call you, for example if you're running late. Leave it empty to remove it."
        />
        {save.isError && !phoneError && <Notice tone="error">{describeError(save.error)}</Notice>}
        <div className="flex items-center gap-3">
          <Button type="submit" variant="primary" loading={save.isPending}>Save</Button>
          {saved && <span className="text-sm text-ink-2" role="status">Saved</span>}
        </div>
      </form>
    </Card>
  );
}

// ─── Password ───────────────────────────────────────────────────────────────

function Password() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [nextError, setNextError] = useState<string>();
  const [done, setDone] = useState<number | null>(null);

  const wrongCurrent = change.error instanceof ApiError && change.error.code === "WRONG_PASSWORD";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (next.length < 8) return setNextError("At least 8 characters.");
    setNextError(undefined);
    setDone(null);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: ({ signedOutOtherDevices }) => {
          setDone(signedOutOtherDevices);
          setCurrent("");
          setNext("");
        },
      },
    );
  }

  return (
    <Card title="Password">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={wrongCurrent ? "That isn't your current password." : undefined}
        />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={nextError}
          hint="At least 8 characters."
          maxLength={72}
        />
        {change.isError && !wrongCurrent && <Notice tone="error">{describeError(change.error)}</Notice>}
        {done !== null && (
          <Notice>
            Password changed.{" "}
            {done === 0 ? "You weren't signed in anywhere else." : `Signed out of ${done} other ${done === 1 ? "device" : "devices"}.`}
          </Notice>
        )}
        <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || !next}>
          Change password
        </Button>
      </form>
    </Card>
  );
}

// ─── Other devices ──────────────────────────────────────────────────────────

function Devices() {
  const signOutOthers = useSignOutOtherDevices();
  const count = signOutOthers.data?.signedOutOtherDevices;

  return (
    <Card title="Signed-in devices">
      <p className="text-[15px] text-ink-2">
        Used SlotBook on a shared or lost device? Sign out everywhere except here. Changing your password does this too.
      </p>
      {signOutOthers.isError && <Notice tone="error" className="mt-3">{describeError(signOutOthers.error)}</Notice>}
      {count !== undefined && (
        <Notice className="mt-3">
          {count === 0 ? "You weren't signed in anywhere else." : `Signed out of ${count} other ${count === 1 ? "device" : "devices"}. They may stay signed in for up to 15 minutes.`}
        </Notice>
      )}
      <Button className="mt-4" loading={signOutOthers.isPending} onClick={() => signOutOthers.mutate()}>
        Sign out everywhere else
      </Button>
    </Card>
  );
}
