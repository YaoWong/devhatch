import { useEffect, useRef, useState, type MouseEvent } from "react";
import { LogOut, PanelLeft, Palette } from "lucide-react";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { PixelRangeControl } from "../../shared/ui/PixelRangeControl";
import { useTheme } from "../../shared/theme/ThemeContext";
import { themes } from "../../shared/theme/themes";

type SettingsSection = "appearance" | "account";

const sections: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
];

export function SettingsView({
  onLogout,
  logoutBusy,
  logoutError,
}: {
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
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const [activeSection, setActiveSection] = useState<SettingsSection>("appearance");

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const sectionElements = sections.map(({ id }) => document.getElementById(`settings-${id}`)).filter((element): element is HTMLElement => Boolean(element));
    const updateActiveSection = () => {
      if (workspace.scrollHeight > workspace.clientHeight + 1 && workspace.scrollTop + workspace.clientHeight >= workspace.scrollHeight - 1) {
        setActiveSection("account");
        return;
      }
      const workspaceTop = workspace.getBoundingClientRect().top;
      const activationLine = workspaceTop + 48;
      let active = sectionElements[0];
      for (const element of sectionElements) {
        if (element.getBoundingClientRect().top <= activationLine) active = element;
      }
      const id = active?.dataset.settingsSection as SettingsSection | undefined;
      if (id) setActiveSection(id);
    };
    const observer = new IntersectionObserver(updateActiveSection, {
      root: workspace,
      rootMargin: "-48px 0px -55% 0px",
      threshold: [0, 1],
    });
    sectionElements.forEach((element) => observer.observe(element));
    workspace.addEventListener("scroll", updateActiveSection, { passive: true });
    updateActiveSection();
    return () => {
      observer.disconnect();
      workspace.removeEventListener("scroll", updateActiveSection);
    };
  }, []);

  const selectSection = (event: MouseEvent<HTMLAnchorElement>, section: SettingsSection) => {
    event.preventDefault();
    const target = document.getElementById(`settings-${section}`);
    const heading = document.getElementById(`settings-${section}-heading`);
    if (!target || !heading) return;
    setActiveSection(section);
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
    heading.removeAttribute("tabindex");
  };

  return (
    <div ref={workspaceRef} className="settings-workspace">
      <div className="settings-shell">
        <nav className="settings-toc" aria-label="Settings sections">
          <span>Settings</span>
          <div>
            {sections.map(({ id, label }) => (
              <a key={id} href={`#settings-${id}`} aria-current={activeSection === id ? "location" : undefined} onClick={(event) => selectSection(event, id)}>
                {label}
              </a>
            ))}
          </div>
        </nav>
        <div className="settings-content">
          <section id="settings-appearance" data-settings-section="appearance" className="settings-section" aria-labelledby="settings-appearance-heading">
            <div className="settings-section-title">
              <h2 id="settings-appearance-heading">Appearance</h2>
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
                  popupSize="theme"
                  getOptionLabel={(theme) => theme.name}
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
          </section>
          <section id="settings-account" data-settings-section="account" className="settings-section" aria-labelledby="settings-account-heading">
            <div className="settings-section-title">
              <h2 id="settings-account-heading">Account</h2>
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
          </section>
        </div>
      </div>
    </div>
  );
}
