import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  useEffect(() => {
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);
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
  return createPortal(
    <div className="dialog-backdrop config-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section className="config-dialog" role="dialog" aria-modal="true" aria-labelledby="config-dialog-title">
        <header>
          <div>
            <h2 id="config-dialog-title">{agentName} launch configs</h2>
            <p>Scripts run in order in one shell with your user permissions.</p>
          </div>
          <button type="button" aria-label="Close launch configs" disabled={busy} onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="config-body">
          <aside aria-label="Launch configs">
            <button className="new-config" type="button" onClick={() => { setScriptError(null); setDraft(emptyDraft(agentId)); }}>
              <Plus /> New config
            </button>
            {configs.map((config) => (
              <button
                key={config.id}
                type="button"
                className={draft.id === config.id ? "active" : ""}
                aria-current={draft.id === config.id ? "true" : undefined}
                onClick={() => select(config)}
              >
                <strong>{config.name}</strong>
                <small>{config.isDefault ? "Default" : "Named config"}</small>
              </button>
            ))}
          </aside>
          <form className="config-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <label>
              Name
              <input ref={nameRef} required maxLength={120} value={draft.name} onChange={(event) => update("name", event.target.value)} />
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
            {scriptError && <p className="form-error">{scriptError}</p>}
            <footer>
              {draft.id && !draft.isDefault && (
                <button className="delete-text" type="button" disabled={busy} onClick={() => void remove()}>
                  <Trash2 /> Delete
                </button>
              )}
              <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
              <button className="save-config" type="submit" disabled={busy || !draft.name.trim()}>
                {busy ? "Saving…" : "Save config"}
              </button>
            </footer>
          </form>
        </div>
      </section>
    </div>,
    document.body,
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
