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
import { captureDialogReturnFocus, resolveDialogFinalFocus } from "../../shared/ui/dialogFocus";

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
  const returnFocusRef = useRef<HTMLElement | null>(captureDialogReturnFocus());
  const resolveFinalFocus = () => resolveDialogFinalFocus(returnFocusRef.current);
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
      preserveMobileNavigation: true,
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
        <DialogContent className="tw:grid tw:h-[min(620px,calc(100dvh-48px))] tw:w-[min(760px,calc(100%-48px))] tw:grid-rows-[auto_minmax(0,1fr)] tw:overflow-hidden tw:rounded-[18px] tw:bg-card tw:shadow-[0_28px_80px_rgb(0_0_0/24%)] tw:[@media(max-width:640px)]:top-auto tw:[@media(max-width:640px)]:bottom-0 tw:[@media(max-width:640px)]:h-[calc(100dvh-14px)] tw:[@media(max-width:640px)]:w-[calc(100%-28px)] tw:[@media(max-width:640px)]:translate-y-0 tw:[@media(max-width:640px)]:rounded-b-none" initialFocus={nameRef} finalFocus={resolveFinalFocus} aria-busy={saving}>
          <header className="tw:flex tw:min-w-0 tw:items-center tw:border-b tw:border-border tw:px-[21px] tw:py-[19px]">
            <div className="tw:min-w-0">
              <DialogTitle className="tw:m-0 tw:overflow-hidden tw:text-[calc(18px*var(--app-font-scale))] tw:leading-[1.25] tw:text-ellipsis tw:whitespace-nowrap">{agentName} launch configs</DialogTitle>
              <DialogDescription className="tw:mt-[4px] tw:mr-0 tw:mb-0 tw:ml-0 tw:text-sm tw:leading-[1.45] tw:text-muted-foreground">Scripts run in order in one shell with your user permissions.</DialogDescription>
            </div>
            <DialogClose
              aria-label="Close launch configs"
              disabled={locked}
              className="tw:ml-auto tw:size-10 tw:rounded-full tw:bg-background tw:text-muted-foreground tw:hover:bg-muted! tw:hover:text-foreground! tw:[@media(pointer:coarse)]:size-11"
              render={<Button variant="ghost" size="icon" />}
            >
              <X className="tw:size-[14px]" />
            </DialogClose>
          </header>
          <div className="tw:grid tw:min-h-0 tw:grid-cols-[210px_minmax(0,1fr)] tw:overflow-hidden tw:[@media(max-width:640px)]:grid-cols-1 tw:[@media(max-width:640px)]:overflow-y-auto">
            <aside className="tw:flex tw:min-h-0 tw:flex-col tw:gap-[3px] tw:overflow-y-auto tw:border-r tw:border-border tw:bg-[var(--color-surface-raised)] tw:p-[12px] tw:[@media(max-width:640px)]:min-h-[132px] tw:[@media(max-width:640px)]:max-h-[150px] tw:[@media(max-width:640px)]:border-r-0 tw:[@media(max-width:640px)]:border-b" aria-label="Launch configs">
              <Button
                variant="ghost"
                className="tw:mb-[6px] tw:h-10 tw:w-full tw:justify-start tw:rounded-lg tw:border tw:border-dashed tw:border-input tw:px-2.5 tw:text-xs tw:[@media(pointer:coarse)]:h-11"
                type="button"
                disabled={locked}
                onClick={() => { setScriptError(null); setDraft(emptyDraft(agentId)); }}
              >
                <Plus className="tw:size-[14px]" /> New config
              </Button>
              {configs.map((config) => (
                <Button
                  key={config.id}
                  type="button"
                  variant="ghost"
                  className={`tw:h-auto tw:min-h-12 tw:w-full tw:justify-start tw:rounded-lg tw:px-2.5 tw:py-2 tw:text-left tw:font-normal tw:transition-none tw:[@media(pointer:coarse)]:min-h-14 ${draft.id === config.id ? "tw:bg-muted" : ""}`}
                  aria-current={draft.id === config.id ? "true" : undefined}
                  disabled={locked}
                  onClick={() => select(config)}
                >
                  <span className="tw:w-full tw:min-w-0"><strong className="tw:block tw:overflow-hidden tw:text-sm tw:leading-[1.25] tw:text-ellipsis tw:whitespace-nowrap">{config.name}</strong><small className="tw:mt-[3px] tw:block tw:overflow-hidden tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.25] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">{config.isDefault ? "Default" : "Named config"}</small></span>
                </Button>
              ))}
            </aside>
            <form className="tw:min-h-0 tw:overflow-y-auto tw:p-[20px] tw:[@media(max-width:640px)]:overflow-visible tw:[@media(max-width:640px)]:p-[16px]" onSubmit={(event) => { event.preventDefault(); void save(); }}>
              <label className="tw:grid tw:gap-[7px] tw:text-sm tw:font-semibold tw:leading-[1.3] tw:text-[var(--color-text-subtle)]">
                Name
                <Input ref={nameRef} className="tw:h-10 tw:text-sm tw:[@media(pointer:coarse)]:h-11" required maxLength={120} value={draft.name} disabled={locked} onChange={(event) => update("name", event.target.value)} />
              </label>
              <label className="tw:mt-[10px] tw:flex tw:min-h-[40px] tw:cursor-pointer tw:items-center tw:gap-[9px] tw:text-sm tw:leading-[1.3] tw:text-[var(--color-text-subtle)]">
                <Checkbox className="tw:[@media(pointer:coarse)]:after:-inset-3" checked={draft.isDefault} disabled={locked} onCheckedChange={(checked) => update("isDefault", checked)} />
                <span>Make this the default config</span>
              </label>
              <p className="tw:mt-[10px] tw:mr-0 tw:mb-0 tw:ml-0 tw:text-xs tw:leading-[1.5] tw:text-muted-foreground">Runs in /bin/sh before {agentName}. Environment changes remain available to {agentName}.</p>
              <ScriptField
                label="Launch script"
                value={draft.launchScript}
                disabled={locked}
                onChange={(value) => {
                  setScriptError(null);
                  update("launchScript", value);
                }}
              />
              {scriptError && <p className="tw:mt-[7px] tw:mr-0 tw:mb-0 tw:ml-0 tw:text-xs tw:leading-[1.45] tw:text-destructive" role="alert">{scriptError}</p>}
              <footer className="tw:mt-[18px] tw:flex tw:flex-wrap tw:items-center tw:gap-[8px]">
                {draft.id && !draft.isDefault && (
                  <Button variant="destructive" className="tw:h-10 tw:px-3 tw:text-xs tw:[@media(pointer:coarse)]:h-11" type="button" disabled={locked} onClick={requestDelete}>
                    <Trash2 className="tw:size-[13px]" /> Delete
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
    <label className="tw:mt-[14px] tw:grid tw:gap-[7px] tw:text-sm tw:font-semibold tw:leading-[1.3] tw:text-[var(--color-text-subtle)]">
      {label}
      <Textarea value={value} disabled={disabled} spellCheck={false} className="tw:min-h-[250px] tw:resize-y tw:bg-[var(--color-surface-raised)] tw:p-3 tw:font-mono tw:text-xs tw:leading-[1.55] tw:md:text-xs tw:dark:bg-[var(--color-surface-raised)] tw:max-[640px]:min-h-[220px]" onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
