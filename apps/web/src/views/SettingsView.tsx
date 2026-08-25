import { LogOut, Palette, SlidersHorizontal } from "lucide-react";
import { CustomSelect } from "../components/CustomSelect";
import { useTheme } from "../ThemeContext";
import { themes } from "../themes";

export type SettingsSection = "appearance" | "sessions" | "account";

export function SettingsRailPage({
  section,
  onSelect,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const items = [
    { id: "appearance", label: "Appearance", icon: Palette },
    { id: "sessions", label: "Sessions", icon: SlidersHorizontal },
    { id: "account", label: "Account", icon: LogOut },
  ] as const;
  return (
    <div className="menu-section">
      <p className="menu-label">Sections</p>
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item ${section === item.id ? "active" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <Icon />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SettingsView({
  section,
  confirmDelete,
  onConfirmDeleteChange,
  onLogout,
}: {
  section: SettingsSection;
  confirmDelete: boolean;
  onConfirmDeleteChange: (enabled: boolean) => void;
  onLogout: () => Promise<void>;
}) {
  const { themeId, saving, error, selectTheme } = useTheme();
  return (
    <div className="settings-workspace">
      <div className="settings-content">
        {section === "appearance" && <section className="settings-section">
          <div className="settings-section-title">
            <h2>Appearance</h2>
            <p>Choose a theme for DevHatch and its terminals.</p>
          </div>
          <div className="settings-group settings-theme-group">
            <div className="settings-row static settings-theme-row">
              <Palette />
              <span>
                <strong>Theme</strong>
                <small>{error ?? "Applied globally to this account."}</small>
              </span>
              <CustomSelect
                label="Theme"
                value={themeId}
                options={themes}
                disabled={saving}
                compact
                renderTrigger={(theme) => <span className="select-copy"><strong>{theme?.name}</strong><small>{theme?.description}</small></span>}
                renderOption={(theme) => <span className="select-copy"><strong>{theme.name}</strong><small>{theme.description}</small></span>}
                onChange={selectTheme}
              />
            </div>
          </div>
        </section>}
        {section === "sessions" && <section className="settings-section">
          <div className="settings-section-title">
            <h2>Sessions</h2>
            <p>Control terminal and agent session behavior.</p>
          </div>
          <div className="settings-group">
            <label className="settings-row">
              <span>
                <strong>Confirm before closing live sessions</strong>
                <small>Ask before stopping a process and closing its live tab. OpenCode history is preserved.</small>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={confirmDelete}
                onChange={(event) => onConfirmDeleteChange(event.target.checked)}
              />
            </label>
          </div>
        </section>}
        {section === "account" && <section className="settings-section">
          <div className="settings-section-title">
            <h2>Account</h2>
            <p>Manage the administrator session for this browser.</p>
          </div>
          <div className="settings-group">
            <div className="settings-row static">
              <LogOut />
              <span>
                <strong>Sign out</strong>
                <small>End this browser session and return to the sign-in screen.</small>
              </span>
              <button className="settings-signout" type="button" onClick={() => void onLogout()}>
                Sign out
              </button>
            </div>
          </div>
        </section>}
      </div>
    </div>
  );
}
