import { Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { AgentLaunchConfig, AgentLaunchConfigInput } from "../../types/agents";

type ScriptParts = Pick<AgentLaunchConfigInput, "preLaunchScript" | "providerScript" | "tuiScript">;
type Draft = Pick<AgentLaunchConfigInput, "agentId" | "name" | "isDefault"> & ScriptParts & {
  id: string | null;
  launchScript: string;
};

const joinScripts = ({ preLaunchScript, providerScript, tuiScript }: ScriptParts) => {
  let source = "";
  for (const script of [preLaunchScript, providerScript, tuiScript]) {
    source += script;
    if (script && !script.endsWith("\n")) source += "\n";
  }
  return source;
};

const emptyDraft = (agentId: string): Draft => ({
  id: null,
  agentId,
  name: "",
  isDefault: false,
  preLaunchScript: "",
  providerScript: "",
  tuiScript: "",
  launchScript: "",
});

const configDraft = (config: AgentLaunchConfig): Draft => ({
  id: config.id,
  agentId: config.agentId,
  name: config.name,
  isDefault: config.isDefault,
  preLaunchScript: config.preLaunchScript,
  providerScript: config.providerScript,
  tuiScript: config.tuiScript,
  launchScript: joinScripts(config),
});

export function AgentConfigDialog({
  configs,
  agentId,
  agentName,
  selectedConfigId,
  onSelect,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: {
  configs: AgentLaunchConfig[];
  agentId: string;
  agentName: string;
  selectedConfigId: string | null;
  onSelect: (id: string) => void;
  onCreate: (input: AgentLaunchConfigInput) => Promise<boolean>;
  onUpdate: (id: string, input: AgentLaunchConfigInput) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const initial = configs.find((config) => config.id === selectedConfigId) ?? configs[0];
  const [draft, setDraft] = useState<Draft>(() => (initial ? configDraft(initial) : emptyDraft(agentId)));
  const [busy, setBusy] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const resolveFinalFocus = () => {
    const previous = returnFocusRef.current;
    if (
      previous?.isConnected && !previous.closest("[inert], .canvas-rail-auto:not(.canvas-rail-open):not(.drawer-open)") &&
      getComputedStyle(previous).display !== "none" && getComputedStyle(previous).visibility !== "hidden"
    ) return previous;
    const mobileTrigger = document.querySelector<HTMLElement>(".canvas-mobile-trigger");
    if (mobileTrigger && getComputedStyle(mobileTrigger).display !== "none") return mobileTrigger;
    const edgeTrigger = document.querySelector<HTMLElement>(".canvas-edge-trigger");
    if (edgeTrigger && getComputedStyle(edgeTrigger).display !== "none") return edgeTrigger;
    return document.querySelector<HTMLElement>(".rail:not([inert])") ?? document.body;
  };
  const select = (config: AgentLaunchConfig) => {
    setScriptError(null);
    setDraft(configDraft(config));
    onSelect(config.id);
  };
  const update = <K extends keyof Draft>(field: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [field]: value }));
  const save = async () => {
    if (!draft.name.trim()) {
      nameRef.current?.focus();
      return;
    }
    const scriptChanged = draft.launchScript !== joinScripts(draft);
    if (scriptChanged && new TextEncoder().encode(draft.launchScript).length > 65_536) {
      setScriptError("Launch script must not exceed 65,536 bytes.");
      return;
    }
    setScriptError(null);
    setBusy(true);
    const input: AgentLaunchConfigInput = {
      agentId: draft.agentId,
      name: draft.name.trim(),
      isDefault: draft.isDefault,
      preLaunchScript: scriptChanged ? draft.launchScript : draft.preLaunchScript,
      providerScript: scriptChanged ? "" : draft.providerScript,
      tuiScript: scriptChanged ? "" : draft.tuiScript,
    };
    const saved = draft.id ? await onUpdate(draft.id, input) : await onCreate(input);
    setBusy(false);
    if (saved) onClose();
  };
  const remove = async () => {
    if (!draft.id || draft.isDefault) return;
    setBusy(true);
    const deleted = await onDelete(draft.id);
    setBusy(false);
    if (deleted) onClose();
  };
  return (
    <Dialog
      open
      disablePointerDismissal={busy}
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        if (busy) eventDetails.cancel();
        else onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="tw:z-[1000]" />
        <DialogContent className="config-dialog tw:z-[1001] tw:grid tw:h-[min(620px,calc(100dvh-48px))] tw:w-[min(760px,calc(100%-48px))] tw:grid-rows-[auto_minmax(0,1fr)] tw:overflow-hidden tw:rounded-[18px] tw:bg-card tw:shadow-[0_28px_80px_rgb(0_0_0/24%)] tw:max-sm:top-auto tw:max-sm:bottom-0 tw:max-sm:h-[calc(100dvh-14px)] tw:max-sm:w-[calc(100%-28px)] tw:max-sm:translate-y-0 tw:max-sm:rounded-b-none" initialFocus={nameRef} finalFocus={resolveFinalFocus} aria-busy={busy}>
          <header>
            <div className="config-header-copy">
              <DialogTitle>{agentName} launch configs</DialogTitle>
              <DialogDescription>Scripts run in order in one shell with your user permissions.</DialogDescription>
            </div>
            <DialogClose
              aria-label="Close launch configs"
              disabled={busy}
              className="config-close tw:ml-auto tw:size-10 tw:rounded-full tw:bg-background tw:text-muted-foreground tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:size-11"
              render={<Button variant="ghost" size="icon" />}
            >
              <X />
            </DialogClose>
          </header>
          <div className="config-body">
            <aside aria-label="Launch configs">
              <Button
                variant="ghost"
                className="new-config tw:h-10 tw:w-full tw:justify-start tw:rounded-lg tw:border tw:border-dashed tw:border-input tw:px-2.5 tw:text-xs tw:[@media(pointer:coarse)]:h-11"
                type="button"
                onClick={() => { setScriptError(null); setDraft(emptyDraft(agentId)); }}
              >
                <Plus /> New config
              </Button>
              {configs.map((config) => (
                <Button
                  key={config.id}
                  type="button"
                  variant="ghost"
                  className={`config-option tw:h-auto tw:min-h-12 tw:w-full tw:justify-start tw:rounded-lg tw:px-2.5 tw:py-2 tw:text-left tw:font-normal tw:transition-none tw:[@media(pointer:coarse)]:min-h-14 ${draft.id === config.id ? "active tw:bg-muted" : ""}`}
                  aria-current={draft.id === config.id ? "true" : undefined}
                  onClick={() => select(config)}
                >
                  <span><strong>{config.name}</strong><small>{config.isDefault ? "Default" : "Named config"}</small></span>
                </Button>
              ))}
            </aside>
            <form className="config-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label>
                Name
                <Input ref={nameRef} className="tw:h-10 tw:text-sm" required maxLength={120} value={draft.name} onChange={(event) => update("name", event.target.value)} />
              </label>
              <label className="default-check">
                <input type="checkbox" checked={draft.isDefault} onChange={(event) => update("isDefault", event.target.checked)} />
                Make this the default config
              </label>
              <p className="form-message">Runs in /bin/sh before {agentName}. Environment changes remain available to {agentName}.</p>
              <ScriptField
                label="Launch script"
                value={draft.launchScript}
                onChange={(value) => {
                  setScriptError(null);
                  update("launchScript", value);
                }}
              />
              {scriptError && <p className="form-error" role="alert">{scriptError}</p>}
              <footer>
                {draft.id && !draft.isDefault && (
                  <Button variant="destructive" className="delete-text tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" disabled={busy} onClick={() => void remove()}>
                    <Trash2 /> Delete
                  </Button>
                )}
                <DialogClose className="tw:ml-auto tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" disabled={busy} render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button className="save-config tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="submit" disabled={busy || !draft.name.trim()}>
                  {busy ? "Saving…" : "Save config"}
                </Button>
              </footer>
            </form>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function ScriptField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="script-field">
      {label}
      <textarea value={value} spellCheck={false} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
