import { LogOut, PanelLeft, Palette } from "lucide-react";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { PixelRangeControl } from "../../shared/ui/PixelRangeControl";
import { useTheme } from "../../shared/theme/ThemeContext";
import { themes } from "../../shared/theme/themes";

export type SettingsSection = "appearance" | "account";

export function SettingsView({
  section,
  onSelectSection,
  onLogout,
  logoutBusy,
  logoutError,
}: {
  section: SettingsSection;
  onSelectSection: (section: SettingsSection) => void;
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string | null;
}) {
  const {
    themeId,
    navigationRailWidthPx,
    saving,
    error,
    selectTheme,
    setNavigationRailWidthPx,
  } = useTheme();
  return (
    <div className="settings-workspace">
      <nav className="settings-canvas-tabs" aria-label="Settings sections">
        {(["appearance", "account"] as const).map((item) => (
          <button key={item} type="button" aria-current={section === item ? "page" : undefined} onClick={() => onSelectSection(item)}>
            {item === "appearance" ? "Appearance" : "Account"}
          </button>
        ))}
      </nav>
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
            <div className="settings-row settings-range-row">
              <PanelLeft />
              <span>
                <strong>Sidebar width</strong>
                <small>Set the desktop navigation sidebar width.</small>
                {error && <small className="settings-error" role="alert">{error}</small>}
              </span>
              <PixelRangeControl label="Sidebar width" min={240} max={480} step={8} value={navigationRailWidthPx} disabled={saving} onChange={setNavigationRailWidthPx} />
            </div>
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
