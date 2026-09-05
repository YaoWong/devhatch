import { useEffect, useRef, useState, type MouseEvent } from "react";
import { LogOut, PanelLeft, Palette, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CustomSelect } from "../../shared/ui/CustomSelect";
import { PixelRangeControl } from "../../shared/ui/PixelRangeControl";
import { useTheme } from "../../shared/theme/ThemeContext";
import { themes } from "../../shared/theme/themes";
import type { ConfirmAction } from "../../types/app";
import { SupervisorSetup } from "./SupervisorSetup";

type SettingsSection = "appearance" | "account" | "help";

const sections: ReadonlyArray<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "account", label: "Account" },
  { id: "help", label: "Help & setup" },
];

export function SettingsView({
  onLogout,
  logoutBusy,
  logoutError,
  onConfirm,
}: {
  onLogout: () => Promise<void>;
  logoutBusy: boolean;
  logoutError: string | null;
  onConfirm: (action: ConfirmAction) => void;
}) {
  const {
    themeId,
    navigationRailWidthPx,
    saving,
    error,
    dismissError,
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
        setActiveSection(sections.at(-1)?.id ?? "appearance");
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
    <div ref={workspaceRef} className="tw:@container/settings-workspace tw:min-h-0 tw:overflow-auto tw:bg-[var(--color-canvas)]">
      <div className="tw:mx-auto tw:grid tw:w-[min(1020px,calc(100%-40px))] tw:grid-cols-[148px_minmax(0,820px)] tw:gap-9 tw:pt-9 tw:pb-12 tw:@max-[920px]/settings-workspace:w-[calc(100%-28px)] tw:@max-[920px]/settings-workspace:grid-cols-1 tw:@max-[920px]/settings-workspace:gap-5 tw:@max-[920px]/settings-workspace:pt-3 tw:@max-[920px]/settings-workspace:pb-8">
        <nav className="tw:sticky tw:top-7 tw:self-start tw:@max-[920px]/settings-workspace:top-0 tw:@max-[920px]/settings-workspace:z-2 tw:@max-[920px]/settings-workspace:-mx-3.5 tw:@max-[920px]/settings-workspace:overflow-x-auto tw:@max-[920px]/settings-workspace:border-b tw:@max-[920px]/settings-workspace:border-border tw:@max-[920px]/settings-workspace:bg-[color-mix(in_srgb,var(--color-canvas)_92%,transparent)] tw:@max-[920px]/settings-workspace:px-3.5 tw:@max-[920px]/settings-workspace:py-2.5 tw:@max-[920px]/settings-workspace:backdrop-blur-xl" aria-label="Settings sections">
          <span className="tw:mx-2.5 tw:mb-3 tw:block tw:text-[11px] tw:font-bold tw:tracking-[0.08em] tw:text-muted-foreground tw:uppercase tw:@max-[920px]/settings-workspace:hidden">Settings</span>
          <div className="tw:grid tw:gap-1 tw:@max-[920px]/settings-workspace:flex tw:@max-[920px]/settings-workspace:w-max">
            {sections.map(({ id, label }) => (
              <a className="tw:flex tw:min-h-10 tw:items-center tw:rounded-lg tw:px-2.5 tw:text-xs tw:font-semibold tw:text-muted-foreground tw:no-underline tw:outline-none tw:hover:bg-muted tw:hover:text-foreground tw:focus-visible:ring-3 tw:focus-visible:ring-ring/50 tw:[@media(pointer:coarse)]:min-h-11 tw:aria-[current=location]:bg-muted tw:aria-[current=location]:text-foreground tw:@max-[920px]/settings-workspace:px-3" key={id} href={`#settings-${id}`} aria-current={activeSection === id ? "location" : undefined} onClick={(event) => selectSection(event, id)}>
                {label}
              </a>
            ))}
          </div>
        </nav>
        <div className="tw:min-w-0">
          <section id="settings-appearance" data-settings-section="appearance" className="tw:grid tw:scroll-mt-7 tw:gap-3.5 tw:border-b tw:border-border tw:pb-6 tw:@max-[920px]/settings-workspace:scroll-mt-[68px] tw:@max-[920px]/settings-workspace:gap-3" aria-labelledby="settings-appearance-heading">
            <div className="tw:min-w-0">
              <h2 className="tw:m-0 tw:text-lg tw:font-semibold tw:tracking-[-0.02em] tw:text-foreground" id="settings-appearance-heading">Appearance</h2>
              <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">Choose a theme for DevHatch and its terminals.</p>
            </div>
            <Card className="tw:@container/settings-card tw:gap-0 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:py-0 tw:ring-0">
              <div className="tw:grid tw:min-h-[72px] tw:grid-cols-[30px_minmax(0,1fr)_minmax(180px,240px)] tw:items-center tw:gap-x-3 tw:gap-y-2.5 tw:px-3.5 tw:py-2.5 tw:@max-[540px]/settings-card:grid-cols-[30px_minmax(0,1fr)]">
                <Palette className="tw:size-[30px] tw:rounded-lg tw:bg-muted tw:p-[7px] tw:text-muted-foreground" />
                <span className="tw:min-w-0">
                  <strong className="tw:block tw:text-sm tw:font-semibold tw:text-foreground">Theme</strong>
                  <small className="tw:mt-1 tw:block tw:text-xs tw:leading-relaxed tw:text-muted-foreground">Applied globally to this account.</small>
                </span>
                <div className="tw:min-w-0 tw:@max-[540px]/settings-card:col-span-2 tw:@max-[540px]/settings-card:w-full">
                  <CustomSelect
                    density="compact"
                    appearance="quiet"
                    label="Theme"
                    value={themeId}
                    options={themes}
                    disabled={saving}
                    getOptionLabel={(theme) => theme.name}
                    renderTrigger={(theme) => <span className="select-copy"><strong>{theme?.name}</strong><small>{theme?.description}</small></span>}
                    renderOption={(theme) => <span className="select-copy"><strong>{theme.name}</strong><small>{theme.description}</small></span>}
                    onChange={selectTheme}
                  />
                </div>
              </div>
              <div className="tw:grid tw:min-h-[72px] tw:grid-cols-[30px_minmax(0,1fr)_minmax(260px,320px)] tw:items-center tw:gap-x-3 tw:gap-y-2.5 tw:border-t tw:border-border tw:px-3.5 tw:py-2.5 tw:@max-[620px]/settings-card:grid-cols-[30px_minmax(0,1fr)]">
                <PanelLeft className="tw:size-[30px] tw:rounded-lg tw:bg-muted tw:p-[7px] tw:text-muted-foreground" />
                <span className="tw:min-w-0">
                  <strong className="tw:block tw:text-sm tw:font-semibold tw:text-foreground">Sidebar width</strong>
                  <small className="tw:mt-1 tw:block tw:text-xs tw:leading-relaxed tw:text-muted-foreground">Set the desktop navigation sidebar width.</small>
                </span>
                <div className="tw:min-w-0 tw:@max-[620px]/settings-card:col-span-2 tw:@max-[620px]/settings-card:w-full">
                  <PixelRangeControl label="Sidebar width" min={240} max={480} step={8} value={navigationRailWidthPx} disabled={saving} onChange={setNavigationRailWidthPx} />
                </div>
              </div>
              {error && <div className="tw:flex tw:min-h-10 tw:items-center tw:gap-2 tw:border-t tw:border-border tw:py-1 tw:pr-1 tw:pl-3.5 tw:text-xs tw:leading-relaxed tw:text-destructive" role="alert"><span className="tw:min-w-0 tw:flex-1 tw:[overflow-wrap:anywhere]">{error}</span><Button variant="ghost" size="icon" className="tw:size-10 tw:flex-none tw:rounded-lg tw:text-destructive tw:hover:bg-destructive/10! tw:hover:text-destructive! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Dismiss settings error" onClick={dismissError}><X className="tw:size-3" /></Button></div>}
            </Card>
          </section>
          <section id="settings-account" data-settings-section="account" className="tw:grid tw:scroll-mt-7 tw:gap-3.5 tw:border-b tw:border-border tw:py-6 tw:@max-[920px]/settings-workspace:scroll-mt-[68px] tw:@max-[920px]/settings-workspace:gap-3" aria-labelledby="settings-account-heading">
            <div className="tw:min-w-0">
              <h2 className="tw:m-0 tw:text-lg tw:font-semibold tw:tracking-[-0.02em] tw:text-foreground" id="settings-account-heading">Account</h2>
              <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">Manage the administrator session for this browser.</p>
            </div>
            <Card className="tw:@container/settings-card tw:gap-0 tw:rounded-xl tw:border tw:border-border tw:bg-card tw:py-0 tw:ring-0">
              <div className="tw:grid tw:min-h-[72px] tw:grid-cols-[30px_minmax(0,1fr)_auto] tw:items-center tw:gap-x-3 tw:gap-y-2.5 tw:px-3.5 tw:py-2.5 tw:@max-[540px]/settings-card:grid-cols-[30px_minmax(0,1fr)]">
                <LogOut className="tw:size-[30px] tw:rounded-lg tw:bg-muted tw:p-[7px] tw:text-muted-foreground" />
                <span className="tw:min-w-0">
                  <strong className="tw:block tw:text-sm tw:font-semibold tw:text-foreground">Sign out</strong>
                  <small className="tw:mt-1 tw:block tw:text-xs tw:leading-relaxed tw:text-muted-foreground">End this browser session and return to the sign-in screen.</small>
                </span>
                <Button variant="ghost" className="tw:h-10 tw:rounded-lg tw:px-4 tw:text-xs tw:text-destructive tw:hover:bg-destructive/10! tw:hover:text-destructive! tw:[@media(pointer:coarse)]:h-11 tw:@max-[540px]/settings-card:col-span-2 tw:@max-[540px]/settings-card:w-full" type="button" disabled={logoutBusy} aria-describedby={logoutError ? "logout-error" : undefined} onClick={() => void onLogout()}>
                  {logoutBusy ? "Signing out…" : "Sign out"}
                </Button>
              </div>
              {logoutError && <p id="logout-error" className="tw:m-0 tw:border-t tw:border-border tw:px-3.5 tw:py-2.5 tw:text-xs tw:leading-relaxed tw:text-destructive" role="alert">{logoutError}</p>}
            </Card>
          </section>
          <section id="settings-help" data-settings-section="help" className="tw:grid tw:scroll-mt-7 tw:gap-3.5 tw:pt-6 tw:@max-[920px]/settings-workspace:scroll-mt-[68px] tw:@max-[920px]/settings-workspace:gap-3" aria-labelledby="settings-help-heading">
            <div className="tw:min-w-0">
              <h2 className="tw:m-0 tw:text-lg tw:font-semibold tw:tracking-[-0.02em] tw:text-foreground" id="settings-help-heading">Help &amp; setup</h2>
              <p className="tw:mt-2 tw:mb-0 tw:text-xs tw:leading-relaxed tw:text-muted-foreground">Install and inspect the managed DevHatch supervisor.</p>
            </div>
            <SupervisorSetup onConfirm={onConfirm} />
          </section>
        </div>
      </div>
    </div>
  );
}
