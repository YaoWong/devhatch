import { useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, LoaderCircle, Server, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiError } from "../../api/client";
import { getSupervisorStatus, installSupervisor } from "../../api/supervisor";
import type { ConfirmAction } from "../../types/app";
import type { SupervisorStatus } from "../../types/supervisor";
import {
  supervisorAction,
  supervisorErrorGuidance,
  supervisorPollDecision,
  supervisorPollRequestTimeout,
  supervisorPollTerminalMessage,
  supervisorStatusLabel,
  validateByteApiKeyFile,
} from "./supervisor";

type SupervisorOperation = "idle" | "loading" | "installing" | "restarting" | "error";
type RetryAction = "load" | "install" | "poll";
type RequestGeneration = { id: number; controller: AbortController };

const restartPollDeadlineMs = 90_000;
const restartPollIntervalMs = 1_000;

export function SupervisorSetup({ onConfirm }: { onConfirm: (action: ConfirmAction) => void }) {
  const lifecycleActiveRef = useRef(false);
  const generationRef = useRef(0);
  const activeControllerRef = useRef<AbortController | null>(null);
  const keyPathRef = useRef<HTMLInputElement | null>(null);
  const focusPathOnCloseRef = useRef(false);
  const [status, setStatus] = useState<SupervisorStatus | null>(null);
  const [operation, setOperation] = useState<SupervisorOperation>("loading");
  const [byteApiKeyFile, setByteApiKeyFile] = useState("");
  const [pathDirty, setPathDirty] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<RetryAction>("load");
  const [confirmationOpen, setConfirmationOpen] = useState(false);

  const beginGeneration = (): RequestGeneration | null => {
    if (!lifecycleActiveRef.current) return null;
    activeControllerRef.current?.abort();
    const controller = new AbortController();
    const generation = { id: ++generationRef.current, controller };
    activeControllerRef.current = controller;
    return generation;
  };

  const isCurrentGeneration = (generation: RequestGeneration) => lifecycleActiveRef.current
    && generationRef.current === generation.id
    && activeControllerRef.current === generation.controller
    && !generation.controller.signal.aborted;

  const pollForRestart = () => {
    const generation = beginGeneration();
    if (!generation) return;
    setOperation("restarting");
    setSectionError(null);
    setRetryAction("poll");
    void runRestartPoll(generation);
  };

  const applyLoadedStatus = (nextStatus: SupervisorStatus, generation: RequestGeneration) => {
    if (!isCurrentGeneration(generation)) return;
    setStatus(nextStatus);
    if (nextStatus.handoffPending || nextStatus.restartPending) {
      pollForRestart();
    } else {
      setOperation("idle");
    }
  };

  const runStatusLoad = async (generation: RequestGeneration) => {
    try {
      const nextStatus = await getSupervisorStatus(generation.controller.signal);
      applyLoadedStatus(nextStatus, generation);
    } catch (reason) {
      if (!isCurrentGeneration(generation)) return;
      const guidance = reason instanceof ApiError
        ? supervisorErrorGuidance(reason.status, reason.code, reason.message)
        : supervisorErrorGuidance(0, null, reason instanceof Error ? reason.message : String(reason));
      setSectionError(guidance.message);
      setRetryAction("load");
      setOperation("error");
    }
  };

  const refreshStatus = () => {
    const generation = beginGeneration();
    if (!generation) return;
    setOperation("loading");
    setSectionError(null);
    setRetryAction("load");
    void runStatusLoad(generation);
  };

  useEffect(() => {
    lifecycleActiveRef.current = true;
    refreshStatus();
    return () => {
      lifecycleActiveRef.current = false;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      generationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!pathDirty && status?.byteApiKeyFile) setByteApiKeyFile(status.byteApiKeyFile);
  }, [pathDirty, status?.byteApiKeyFile]);

  const runRestartPoll = async (generation: RequestGeneration) => {
    const deadline = Date.now() + restartPollDeadlineMs;
    while (isCurrentGeneration(generation)) {
      const remainingBeforeDelay = deadline - Date.now();
      if (remainingBeforeDelay <= 0) break;
      const continued = await abortableDelay(
        Math.min(restartPollIntervalMs, remainingBeforeDelay),
        generation.controller.signal,
      );
      if (!continued || !isCurrentGeneration(generation)) return;
      const remaining = deadline - Date.now();
      const timeoutMs = supervisorPollRequestTimeout(remaining);
      if (timeoutMs <= 0) break;
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      generation.controller.signal.addEventListener("abort", abortRequest, { once: true });
      const timeout = window.setTimeout(() => requestController.abort(), timeoutMs);
      try {
        const nextStatus = await getSupervisorStatus(requestController.signal);
        if (!isCurrentGeneration(generation)) return;
        setStatus(nextStatus);
        const decision = supervisorPollDecision(nextStatus);
        if (decision === "ready") {
          window.location.reload();
          return;
        }
        if (decision === "terminal") {
          setSectionError(supervisorPollTerminalMessage(nextStatus));
          setRetryAction("load");
          setOperation("error");
          return;
        }
      } catch (reason) {
        if (!isCurrentGeneration(generation)) return;
        if (reason instanceof ApiError && reason.status === 401) {
          setSectionError("Your session expired. Sign in again, then refresh supervisor status.");
          setRetryAction("load");
          setOperation("error");
          return;
        }
      } finally {
        window.clearTimeout(timeout);
        generation.controller.signal.removeEventListener("abort", abortRequest);
      }
    }
    if (!isCurrentGeneration(generation)) return;
    setSectionError("The restarted supervisor did not become ready in time. Retry the readiness check or refresh status.");
    setRetryAction("poll");
    setOperation("error");
  };

  const updateStatusForError = (code: string | null) => {
    setStatus((current) => {
      if (!current) return current;
      if (code === "SUPERVISOR_FOREIGN_UNIT" || code === "SUPERVISOR_FOREIGN_INSTALL") {
        return { ...current, state: "foreign" };
      }
      if (code === "SUPERVISOR_ACTIVE_PROCESS") {
        return { ...current, active: true, currentProcessManaged: false, state: "active" };
      }
      if (code === "SUPERVISOR_UNAVAILABLE") {
        return { ...current, available: false, state: "unavailable" };
      }
      return current;
    });
  };

  const runInstall = async (overwrite: boolean) => {
    const generation = beginGeneration();
    if (!generation) return true;
    setOperation("installing");
    setSectionError(null);
    setPathError(null);
    try {
      const nextStatus = await installSupervisor(
        { byteApiKeyFile: byteApiKeyFile.trim(), overwrite },
        generation.controller.signal,
      );
      applyLoadedStatus(nextStatus, generation);
    } catch (reason) {
      if (!isCurrentGeneration(generation)) return true;
      const guidance = reason instanceof ApiError
        ? supervisorErrorGuidance(reason.status, reason.code, reason.message)
        : supervisorErrorGuidance(0, null, reason instanceof Error ? reason.message : String(reason));
      if (guidance.kind === "overwrite" && !overwrite) {
        setStatus((current) => current
          ? { ...current, overwriteRequired: true, state: "overwriteRequired" }
          : current);
        setSectionError(null);
        setRetryAction("install");
        setOperation("idle");
      } else if (guidance.kind === "path") {
        setPathError(guidance.message);
        focusPathOnCloseRef.current = true;
        setRetryAction("install");
        setOperation("error");
      } else {
        updateStatusForError(reason instanceof ApiError ? reason.code : null);
        setSectionError(guidance.message);
        setRetryAction(guidance.retry);
        setOperation("error");
      }
    }
    return true;
  };

  const requestInstall = () => {
    if (!status || operation === "installing" || operation === "restarting" || confirmationOpen) return;
    const action = supervisorAction(status);
    if (!action) return;
    const validationError = validateByteApiKeyFile(byteApiKeyFile);
    setPathError(validationError);
    if (validationError) {
      keyPathRef.current?.focus();
      return;
    }
    setSectionError(null);
    setConfirmationOpen(true);
    const overwrite = action.overwrite;
    onConfirm({
      title: overwrite
        ? "Overwrite managed supervisor files?"
        : status.installed || status.managed
          ? "Update DevHatch supervisor?"
          : "Install DevHatch supervisor?",
      description: "DevHatch may create or replace user-level systemd files and a managed release. Current DevHatch sessions may stop, the server may restart, and you may be asked to sign in again.",
      confirmLabel: overwrite ? "Overwrite managed files" : status.installed || status.managed ? "Update supervisor" : "Install supervisor",
      action: () => runInstall(overwrite),
      onClose: () => {
        if (!lifecycleActiveRef.current) return;
        setConfirmationOpen(false);
        if (focusPathOnCloseRef.current) {
          focusPathOnCloseRef.current = false;
          window.requestAnimationFrame(() => keyPathRef.current?.focus());
        }
      },
    });
  };

  const retry = () => {
    if (retryAction === "poll") {
      pollForRestart();
    } else if (retryAction === "install") {
      requestInstall();
    } else {
      refreshStatus();
    }
  };

  const dismissError = () => {
    setSectionError(null);
    setOperation("idle");
  };

  const action = status ? supervisorAction(status) : null;
  const pending = operation === "installing" || operation === "restarting";
  const blockingError = !status || status.handoffPending || status.restartPending || retryAction !== "install";
  const announcement = operation === "loading"
    ? "Loading supervisor status."
    : operation === "installing"
      ? "Installing supervisor."
      : operation === "restarting"
        ? "Supervisor readiness check in progress."
        : operation === "error"
          ? "Supervisor setup needs attention."
          : status
            ? `Supervisor status: ${supervisorStatusLabel(status)}.`
            : "Supervisor status unavailable.";

  return (
    <>
      <span className="tw:sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <Card className="tw:@container/settings-card tw:gap-0 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:py-0 tw:ring-0" aria-busy={operation === "loading" || pending || undefined}>
        {operation === "loading" && !status ? (
          <div className="tw:flex tw:min-h-[92px] tw:flex-wrap tw:items-center tw:gap-2.5 tw:px-3.5 tw:py-4 tw:text-xs tw:text-muted-foreground">
            <LoaderCircle className="spin tw:size-4" />
            <span className="tw:min-w-0 tw:flex-1">Loading supervisor status…</span>
            <Button variant="outline" className="tw:h-10 tw:rounded-lg tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" onClick={refreshStatus}>Refresh status</Button>
          </div>
        ) : status ? (
          <>
            <div className="tw:flex tw:min-h-[72px] tw:flex-wrap tw:items-start tw:gap-3 tw:px-3.5 tw:py-3.5">
              <Server className="tw:size-[30px] tw:flex-none tw:rounded-lg tw:bg-muted tw:p-[7px] tw:text-muted-foreground" />
              <div className="tw:min-w-[200px] tw:flex-1">
                <strong className="tw:flex tw:items-center tw:gap-1.5 tw:text-sm tw:font-semibold tw:text-foreground">
                  {status.active && status.currentProcessManaged ? <CircleCheck className="tw:size-3.5 tw:text-[var(--color-success-fg)]" /> : pending ? <LoaderCircle className="spin tw:size-3.5" /> : null}
                  {supervisorStatusLabel(status)}
                </strong>
                <p className="tw:mt-1 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">{supervisorDescription(status)}</p>
              </div>
              {!action && <Button variant="outline" className="tw:h-10 tw:rounded-lg tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" disabled={operation === "installing"} onClick={refreshStatus}>Refresh status</Button>}
            </div>
            <dl className="tw:m-0 tw:grid tw:border-t tw:border-border tw:px-3.5 tw:py-3 tw:text-xs">
              <SupervisorDetail label="Unit" value={status.unitName} />
              <SupervisorDetail label="Service file" value={status.unitPath} />
              <SupervisorDetail label="Install root" value={status.installRoot} />
            </dl>
            {status.available && !status.lingerEnabled && (
              <p className="tw:m-0 tw:flex tw:items-start tw:gap-2 tw:border-t tw:border-border tw:bg-[var(--color-warning-soft)] tw:px-3.5 tw:py-2.5 tw:text-xs tw:leading-relaxed tw:text-[var(--color-warning-fg)]">
                <CircleAlert className="tw:mt-0.5 tw:size-3.5 tw:flex-none" />User lingering is disabled, so DevHatch may stop when you sign out of the host.
              </p>
            )}
            {action && (
              <div className="tw:grid tw:gap-3 tw:border-t tw:border-border tw:px-3.5 tw:py-3.5">
                <label className="tw:grid tw:gap-1.5 tw:text-xs tw:font-semibold tw:text-foreground" htmlFor="supervisor-byte-api-key-file">
                  Byte API key file
                  <Input
                    ref={keyPathRef}
                    id="supervisor-byte-api-key-file"
                    className="tw:h-10 tw:bg-background tw:px-3 tw:font-mono tw:text-sm tw:font-normal tw:[@media(pointer:coarse)]:h-11"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="/home/you/.config/byte-api/key"
                    value={byteApiKeyFile}
                    disabled={pending}
                    aria-invalid={Boolean(pathError)}
                    aria-describedby={pathError ? "supervisor-key-path-error supervisor-key-path-help" : "supervisor-key-path-help"}
                    onChange={(event) => {
                      setByteApiKeyFile(event.target.value);
                      setPathDirty(true);
                      if (pathError) setPathError(null);
                    }}
                  />
                </label>
                <p id="supervisor-key-path-help" className="tw:m-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">DevHatch stores only this server-local path. Pi loads the key itself; other terminals and agents do not inherit the key value.</p>
                {pathError && <p id="supervisor-key-path-error" className="tw:m-0 tw:text-xs tw:text-destructive" role="alert">{pathError}</p>}
                <Button className="tw:h-10 tw:w-fit tw:rounded-lg tw:bg-foreground tw:px-4 tw:text-xs tw:text-[var(--color-on-solid)] tw:hover:bg-foreground/80! tw:[@media(pointer:coarse)]:h-11 tw:@max-[540px]/settings-card:w-full" type="button" disabled={pending || confirmationOpen} onClick={requestInstall}>
                  {operation === "installing" ? <><LoaderCircle className="spin" />Installing…</> : action.label}
                </Button>
              </div>
            )}
          </>
        ) : null}
        {sectionError && (
          <div className="tw:flex tw:min-h-11 tw:flex-wrap tw:items-center tw:gap-2 tw:border-t tw:border-border tw:py-1 tw:pr-1 tw:pl-3.5 tw:text-xs tw:leading-relaxed tw:text-destructive" role="alert">
            <span className="tw:min-w-0 tw:flex-1 tw:[overflow-wrap:anywhere]">{sectionError}</span>
            <Button variant="ghost" className="tw:h-10 tw:rounded-lg tw:px-3 tw:text-xs tw:text-destructive tw:hover:bg-destructive/10! tw:hover:text-destructive! tw:[@media(pointer:coarse)]:h-11" type="button" onClick={retry}>{retryAction === "load" ? "Refresh status" : retryAction === "poll" ? "Retry check" : "Retry"}</Button>
            {!blockingError && <Button variant="ghost" size="icon" className="tw:size-10 tw:rounded-lg tw:text-destructive tw:hover:bg-destructive/10! tw:hover:text-destructive! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Dismiss supervisor error" onClick={dismissError}><X className="tw:size-3" /></Button>}
          </div>
        )}
      </Card>
    </>
  );
}

function abortableDelay(delayMs: number, signal: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    const finish = (continued: boolean) => {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolve(continued);
    };
    const abort = () => finish(false);
    const timeout = window.setTimeout(() => finish(true), delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}

function supervisorDescription(status: SupervisorStatus) {
  if (!status.supported) return "Supervisor setup is supported only on Linux hosts.";
  if (!status.available) return "A user-level systemd manager is not available on this host.";
  if (status.state === "foreign") return "An existing systemd service or installation is not managed by DevHatch. Resolve it on the host before continuing.";
  if (status.handoffPending) return "The managed server is starting and will take over this session shortly.";
  if (status.restartPending) return "The managed server is restarting with the updated release.";
  if (status.overwriteRequired) return "Managed files differ from the requested setup. Review and explicitly confirm the overwrite.";
  if (status.active && status.currentProcessManaged) return "This DevHatch server is running under the managed user service.";
  if (status.active) return "Another process is active under the user service. Refresh status before trying again.";
  if (status.enabled) return "The user service is enabled but is not currently active.";
  if (status.installed) return "The managed release is installed but the user service is not enabled.";
  return "Install a managed release and user-level systemd service for DevHatch.";
}

function SupervisorDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="tw:grid tw:min-w-0 tw:grid-cols-[90px_minmax(0,1fr)] tw:gap-3 tw:py-1 tw:@max-[480px]/settings-card:grid-cols-1 tw:@max-[480px]/settings-card:gap-1">
      <dt className="tw:text-muted-foreground">{label}</dt>
      <dd className="tw:m-0 tw:min-w-0 tw:break-all tw:font-mono tw:text-[11px] tw:leading-relaxed tw:text-foreground">{value}</dd>
    </div>
  );
}
