import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { authStatus, login, logout, setupAdmin, type AuthStatus } from "../../api/auth";
import { configureAuth } from "../../api/client";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

export type AuthGateRenderProps = {
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string | null;
};

export function AuthGate({ children }: { children: (props: AuthGateRenderProps) => ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const showStatusLoading = useDelayedLoading(status === null && error === null);

  useEffect(() => {
    let active = true;
    void authStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    configureAuth(status?.csrfToken ?? null, () => setStatus((current) => current ? { ...current, authenticated: false, csrfToken: null } : current));
  }, [status]);

  if (!status) {
    return <main className="auth-page"><section className="auth-card"><h1>DevHatch</h1>{(error || showStatusLoading) && <p>{error ?? "Loading…"}</p>}</section></main>;
  }
  if (status.authenticated) {
    const signOut = async () => {
      if (logoutBusy) return;
      setLogoutBusy(true);
      setError(null);
      try {
        await logout();
        setStatus({ initialized: true, authenticated: false, csrfToken: null });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setLogoutBusy(false);
      }
    };
    return children({ onLogout: signOut, logoutBusy, logoutError: error });
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const next = status.initialized
        ? await login(String(data.get("password") ?? ""))
        : await setupAdmin(String(data.get("setupToken") ?? ""), String(data.get("password") ?? ""));
      setStatus(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <div><span className="auth-mark">DH</span><h1>{status.initialized ? "Sign in" : "Set up DevHatch"}</h1></div>
        <p>{status.initialized ? "Enter the administrator password." : "Enter the setup token shown in the server log and create an administrator password."}</p>
        {!status.initialized && <label>Setup token<input name="setupToken" autoComplete="off" required /></label>}
        <label>Password<input name="password" type="password" autoComplete={status.initialized ? "current-password" : "new-password"} minLength={12} required autoFocus={status.initialized} /></label>
        {error && <p className="auth-error">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "Please wait…" : status.initialized ? "Sign in" : "Create administrator"}</button>
      </form>
    </main>
  );
}
