import { Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import type { AgentLaunchConfig, AgentLaunchConfigInput } from "../../types/agents";
import type { ConfirmAction } from "../../types/app";

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
  onConfirm,
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
  onConfirm: (action: ConfirmAction) => void;
  onClose: () => void;
}) {
  const initial = configs.find((config) => config.id === selectedConfigId) ?? configs[0];
  const [draft, setDraft] = useState<Draft>(() => (initial ? configDraft(initial) : emptyDraft(agentId)));
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
    if (saving) return;
    setScriptError(null);
    setDraft(configDraft(config));
    onSelect(config.id);
  };
  const update = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    if (saving) return;
    setDraft((current) => ({ ...current, [field]: value }));
  };
  const save = async () => {
    if (saving) return;
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
    setSaving(true);
    const input: AgentLaunchConfigInput = {
      agentId: draft.agentId,
      name: draft.name.trim(),
      isDefault: draft.isDefault,
      preLaunchScript: scriptChanged ? draft.launchScript : draft.preLaunchScript,
      providerScript: scriptChanged ? "" : draft.providerScript,
      tuiScript: scriptChanged ? "" : draft.tuiScript,
    };
    try {
      const saved = draft.id ? await onUpdate(draft.id, input) : await onCreate(input);
      if (saved) onClose();
    } catch {
      setScriptError("Could not save the launch config.");
    } finally {
      setSaving(false);
    }
  };
  const requestDelete = () => {
    if (saving || confirmingDelete || !draft.id || draft.isDefault) return;
    const id = draft.id;
    const name = configs.find((config) => config.id === id)?.name ?? draft.name;
    setConfirmingDelete(true);
    onConfirm({
      title: "Delete launch config?",
      description: `“${name}” will be permanently deleted.`,
      confirmLabel: "Delete config",
      danger: true,
      onClose: () => setConfirmingDelete(false),
      action: async () => {
        try {
          const deleted = await onDelete(id);
          if (deleted) window.setTimeout(onClose);
          else setScriptError("Could not delete the launch config.");
        } catch {
          setScriptError("Could not delete the launch config.");
        }
        return true;
      },
    });
  };
  const locked = saving || confirmingDelete;
  return (
    <Dialog
      open
      disablePointerDismissal={locked}
      onOpenChange={(open, eventDetails) => {
        if (open) return;
        if (locked) eventDetails.cancel();
        else onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="config-dialog tw:grid tw:h-[min(620px,calc(100dvh-48px))] tw:w-[min(760px,calc(100%-48px))] tw:grid-rows-[auto_minmax(0,1fr)] tw:overflow-hidden tw:rounded-[18px] tw:bg-card tw:shadow-[0_28px_80px_rgb(0_0_0/24%)] tw:max-sm:top-auto tw:max-sm:bottom-0 tw:max-sm:h-[calc(100dvh-14px)] tw:max-sm:w-[calc(100%-28px)] tw:max-sm:translate-y-0 tw:max-sm:rounded-b-none" initialFocus={nameRef} finalFocus={resolveFinalFocus} aria-busy={saving}>
          <header>
            <div className="config-header-copy">
              <DialogTitle>{agentName} launch configs</DialogTitle>
              <DialogDescription>Scripts run in order in one shell with your user permissions.</DialogDescription>
            </div>
            <DialogClose
              aria-label="Close launch configs"
              disabled={locked}
              className="tw:ml-auto tw:size-10 tw:rounded-full tw:bg-background tw:text-muted-foreground tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:size-11"
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
                disabled={locked}
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
                  disabled={locked}
                  onClick={() => select(config)}
                >
                  <span><strong>{config.name}</strong><small>{config.isDefault ? "Default" : "Named config"}</small></span>
                </Button>
              ))}
            </aside>
            <form className="config-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label>
                Name
                <Input ref={nameRef} className="tw:h-10 tw:text-sm tw:[@media(pointer:coarse)]:h-11" required maxLength={120} value={draft.name} disabled={locked} onChange={(event) => update("name", event.target.value)} />
              </label>
              <label className="default-check">
                <Checkbox className="tw:[@media(pointer:coarse)]:after:-inset-3" checked={draft.isDefault} disabled={locked} onCheckedChange={(checked) => update("isDefault", checked)} />
                <span>Make this the default config</span>
              </label>
              <p className="form-message">Runs in /bin/sh before {agentName}. Environment changes remain available to {agentName}.</p>
              <ScriptField
                label="Launch script"
                value={draft.launchScript}
                disabled={locked}
                onChange={(value) => {
                  setScriptError(null);
                  update("launchScript", value);
                }}
              />
              {scriptError && <p className="form-error" role="alert">{scriptError}</p>}
              <footer>
                {draft.id && !draft.isDefault && (
                  <Button variant="destructive" className="tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" disabled={locked} onClick={requestDelete}>
                    <Trash2 /> Delete
                  </Button>
                )}
                <DialogClose className="tw:ml-auto tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" disabled={locked} render={<Button variant="outline" />}>
                  Cancel
                </DialogClose>
                <Button className="tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="submit" disabled={locked || !draft.name.trim()}>
                  {saving ? "Saving…" : "Save config"}
                </Button>
              </footer>
            </form>
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

function ScriptField({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <label className="script-field">
      {label}
      <Textarea value={value} disabled={disabled} spellCheck={false} className="tw:min-h-[250px] tw:resize-y tw:bg-[var(--color-surface-raised)] tw:p-3 tw:font-mono tw:text-xs tw:leading-[1.55] tw:md:text-xs tw:dark:bg-[var(--color-surface-raised)] tw:max-[640px]:min-h-[220px]" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
