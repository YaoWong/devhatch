import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authStatus, login, logout, setupAdmin, type AuthStatus } from "../../api/auth";
import { configureAuth } from "../../api/client";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

export type AuthGateRenderProps = {
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string | null;
};

const authPageClass = "tw:flex tw:h-dvh tw:w-full tw:items-center tw:justify-center tw:overflow-y-auto tw:overscroll-contain tw:bg-[radial-gradient(circle_at_50%_0%,var(--color-surface)_0,var(--color-canvas)_55%)] tw:pt-[max(16px,env(safe-area-inset-top))] tw:pr-[max(16px,env(safe-area-inset-right))] tw:pb-[max(16px,env(safe-area-inset-bottom))] tw:pl-[max(16px,env(safe-area-inset-left))]";
const authCardClass = "tw:my-auto tw:grid tw:w-[min(420px,100%)] tw:flex-none tw:gap-[18px] tw:rounded-[24px] tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:p-[32px] tw:shadow-[0_24px_70px_rgb(0_0_0/10%)]";
const authTitleClass = "tw:m-0 tw:text-[calc(24px*var(--app-font-scale))] tw:tracking-[-0.04em]";
const authDescriptionClass = "tw:m-0 tw:text-sm tw:leading-[1.5] tw:text-muted-foreground";
const authLabelClass = "tw:grid tw:gap-[7px] tw:text-sm tw:font-semibold tw:text-[var(--color-text-subtle)]";

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
    return <main className={authPageClass} aria-busy={error === null}><section className={authCardClass}><h1 className={authTitleClass}>DevHatch</h1>{(error || showStatusLoading) && <p className={authDescriptionClass} role={error ? "alert" : "status"}>{error ?? "Loading…"}</p>}</section></main>;
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
    <main className={authPageClass}>
      <form className={authCardClass} onSubmit={(event) => void submit(event)}>
        <div className="tw:flex tw:items-center tw:gap-[12px]"><span className="tw:grid tw:size-[42px] tw:place-items-center tw:rounded-[12px] tw:bg-foreground tw:font-mono tw:text-[calc(13px*var(--app-font-scale))] tw:leading-none tw:font-bold tw:text-[var(--color-on-solid)]">DH</span><h1 className={authTitleClass}>{status.initialized ? "Sign in" : "Set up DevHatch"}</h1></div>
        <p className={authDescriptionClass}>{status.initialized ? "Enter the administrator password." : "Enter the setup token shown in the server log and create an administrator password."}</p>
        {!status.initialized && <label className={authLabelClass}>Setup token<Input className="tw:h-11 tw:rounded-[11px] tw:bg-card tw:px-3.5 tw:font-mono tw:text-sm tw:text-foreground tw:dark:bg-card!" name="setupToken" autoComplete="off" required autoFocus /></label>}
        <label className={authLabelClass}>Password<Input className="tw:h-11 tw:rounded-[11px] tw:bg-card tw:px-3.5 tw:font-mono tw:text-sm tw:text-foreground tw:dark:bg-card!" name="password" type="password" autoComplete={status.initialized ? "current-password" : "new-password"} minLength={12} required autoFocus={status.initialized} /></label>
        {error && <p className="tw:m-0 tw:font-mono tw:text-xs tw:leading-relaxed tw:text-destructive" role="alert">{error}</p>}
        <Button className="tw:h-11 tw:rounded-[11px] tw:bg-foreground tw:px-4 tw:font-semibold tw:text-[var(--color-on-solid)] tw:hover:bg-foreground!" type="submit" disabled={busy}>{busy ? "Please wait…" : status.initialized ? "Sign in" : "Create administrator"}</Button>
      </form>
    </main>
  );
}
