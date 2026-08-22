import { LogOut } from "lucide-react";

export function SettingsView({
  confirmDelete,
  onConfirmDeleteChange,
  onLogout,
}: {
  confirmDelete: boolean;
  onConfirmDeleteChange: (enabled: boolean) => void;
  onLogout: () => Promise<void>;
}) {
  return (
    <div className="settings-workspace">
      <div className="settings-content">
        <section className="settings-section">
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
        </section>
        <section className="settings-section">
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
        </section>
      </div>
    </div>
  );
}
