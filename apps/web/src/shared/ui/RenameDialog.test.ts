import { describe, expect, it } from "vitest";
import renameDialogSource from "./RenameDialog.tsx?raw";

const sources = import.meta.glob("../../**/*.{ts,tsx}", { eager: true, import: "default", query: "?raw" }) as Record<string, string>;

const renameDialogUsers = Object.entries(sources)
  .filter(([path, source]) => !path.endsWith("RenameDialog.tsx") && source.includes("<RenameDialog"))
  .map(([path]) => path);

describe("rename dialogs", () => {
  it("use the shared dialog instead of inline rename controls", () => {
    expect(renameDialogUsers).toHaveLength(5);
    expect(renameDialogUsers.some((path) => path.endsWith("features/agents/LaunchPaths.tsx"))).toBe(true);
    expect(renameDialogUsers.some((path) => path.endsWith("features/skills/Profiles.tsx"))).toBe(true);
    expect(renameDialogUsers.some((path) => path.endsWith("features/skills/Repositories.tsx"))).toBe(true);
    expect(renameDialogUsers.some((path) => path.endsWith("features/terminals/TerminalWorkspace.tsx"))).toBe(true);
    expect(renameDialogUsers.some((path) => path.endsWith("/RailWorkspaceList.tsx"))).toBe(true);
    expect(Object.keys(sources).some((path) => path.endsWith("InlineRename.tsx"))).toBe(false);
  });

  it("enforces limits and supports nested sheet overlays", () => {
    expect(renameDialogSource).toContain("maxLength = 120");
    expect(renameDialogSource).toContain("maxLength={maxLength}");
    expect(renameDialogSource).toContain("{value.length}/{maxLength}");
    expect(renameDialogSource).toContain("<DialogOverlay forceRender");
  });
});
