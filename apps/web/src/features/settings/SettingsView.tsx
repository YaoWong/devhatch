import type { LayoutMode } from "../../types/settings";
import { LogOut, Palette } from "lucide-react";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { useTheme } from "../../shared/theme/ThemeContext";
import { themes } from "../../shared/theme/themes";

export type SettingsSection = "appearance" | "account";

export function SettingsRailPage({
  section,
  onSelect,
}: {
  section: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const items = [
    { id: "appearance", label: "Appearance", icon: Palette },
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
  layoutMode: viewLayoutMode,
  section,
  onSelectSection,
  onLogout,
  logoutBusy,
  logoutError,
}: {
  layoutMode: LayoutMode;
  section: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string | null;
}) {
  const {
    themeId,
    layoutMode,
    navigationRailWidthPx,
    saving,
    error,
    selectTheme,
    selectLayoutMode,
    setNavigationRailWidthPx,
  } = useTheme();
  return (
    <div className="settings-workspace">
      {viewLayoutMode === "canvas" && (
        <nav className="settings-canvas-tabs" aria-label="Settings sections">
          {(["appearance", "account"] as const).map((item) => (
            <button key={item} type="button" aria-current={section === item ? "page" : undefined} onClick={() => onSelectSection(item)}>
              {item === "appearance" ? "Appearance" : "Account"}
            </button>
          ))}
        </nav>
      )}
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
                <strong>Layout</strong>
                <small>Canvas uses a full workspace with an overlay sidebar. Classic keeps the original framed layout.</small>
              </span>
              <CustomSelect
                label="Layout"
                value={layoutMode}
                options={[
                  { id: "canvas", name: "Canvas", description: "Full workspace with overlay navigation" },
                  { id: "classic", name: "Classic", description: "Original framed workspace" },
                ] as const}
                disabled={saving}
                compact
                renderTrigger={(layout) => <span className="select-copy"><strong>{layout?.name}</strong><small>{layout?.description}</small></span>}
                renderOption={(layout) => <span className="select-copy"><strong>{layout.name}</strong><small>{layout.description}</small></span>}
                onChange={selectLayoutMode}
              />
            </div>
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
            <label className="settings-row settings-range-row">
              <span>
                <strong>Sidebar width</strong>
                <small>Set the desktop navigation sidebar width.</small>
                {error && <small className="settings-error" role="alert">{error}</small>}
              </span>
              <span className="settings-range-control">
                <input
                  type="range"
                  min="240"
                  max="480"
                  step="8"
                  value={navigationRailWidthPx}
                  aria-label="Sidebar width"
                  onChange={(event) => setNavigationRailWidthPx(event.target.valueAsNumber)}
                />
                <output>{navigationRailWidthPx}px</output>
              </span>
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
              <button className="settings-signout" type="button" disabled={logoutBusy} aria-describedby={logoutError ? "logout-error" : undefined} onClick={() => void onLogout()}>
                {logoutBusy ? "Signing out…" : "Sign out"}
              </button>
            </div>
            {logoutError && <p id="logout-error" className="settings-error" role="alert">{logoutError}</p>}
          </div>
        </section>}
      </div>
    </div>
  );
}
