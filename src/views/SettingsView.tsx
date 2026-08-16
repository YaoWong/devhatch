export function SettingsView({
  confirmDelete,
  onConfirmDeleteChange,
}: {
  confirmDelete: boolean;
  onConfirmDeleteChange: (enabled: boolean) => void;
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
      </div>
    </div>
  );
}
