import type { ITheme, Terminal } from "@xterm/xterm";
import type { ThemeId } from "../../types/settings";

export const terminalThemes: Record<ThemeId, ITheme> = {
  default: { background: "#ffffff", foreground: "#1d1d1f", cursor: "#0071e3", selectionBackground: "#cce4ff", black: "#1d1d1f", red: "#d70015", green: "#16803c", yellow: "#9a6700", blue: "#0066cc", magenta: "#8944ab", cyan: "#007c91", white: "#f5f5f7", brightBlack: "#6e6e73", brightRed: "#ff3b30", brightGreen: "#34c759", brightYellow: "#ffcc00", brightBlue: "#0a84ff", brightMagenta: "#bf5af2", brightCyan: "#64d2ff", brightWhite: "#ffffff" },
  latte: { background: "#eff1f5", foreground: "#4c4f69", cursor: "#1e66f5", selectionBackground: "#acb0be", black: "#5c5f77", red: "#d20f39", green: "#40a02b", yellow: "#df8e1d", blue: "#1e66f5", magenta: "#8839ef", cyan: "#179299", white: "#acb0be", brightBlack: "#6c6f85", brightRed: "#d20f39", brightGreen: "#40a02b", brightYellow: "#df8e1d", brightBlue: "#1e66f5", brightMagenta: "#8839ef", brightCyan: "#179299", brightWhite: "#dce0e8" },
  frappe: { background: "#303446", foreground: "#c6d0f5", cursor: "#8caaee", selectionBackground: "#626880", black: "#51576d", red: "#e78284", green: "#a6d189", yellow: "#e5c890", blue: "#8caaee", magenta: "#ca9ee6", cyan: "#81c8be", white: "#b5bfe2", brightBlack: "#626880", brightRed: "#e78284", brightGreen: "#a6d189", brightYellow: "#e5c890", brightBlue: "#8caaee", brightMagenta: "#ca9ee6", brightCyan: "#81c8be", brightWhite: "#c6d0f5" },
  macchiato: { background: "#24273a", foreground: "#cad3f5", cursor: "#8aadf4", selectionBackground: "#5b6078", black: "#494d64", red: "#ed8796", green: "#a6da95", yellow: "#eed49f", blue: "#8aadf4", magenta: "#c6a0f6", cyan: "#8bd5ca", white: "#b8c0e0", brightBlack: "#5b6078", brightRed: "#ed8796", brightGreen: "#a6da95", brightYellow: "#eed49f", brightBlue: "#8aadf4", brightMagenta: "#c6a0f6", brightCyan: "#8bd5ca", brightWhite: "#cad3f5" },
  mocha: { background: "#1e1e2e", foreground: "#cdd6f4", cursor: "#89b4fa", selectionBackground: "#585b70", black: "#45475a", red: "#f38ba8", green: "#a6e3a1", yellow: "#f9e2af", blue: "#89b4fa", magenta: "#cba6f7", cyan: "#94e2d5", white: "#bac2de", brightBlack: "#585b70", brightRed: "#f38ba8", brightGreen: "#a6e3a1", brightYellow: "#f9e2af", brightBlue: "#89b4fa", brightMagenta: "#cba6f7", brightCyan: "#94e2d5", brightWhite: "#cdd6f4" },
};

type TerminalThemeTarget = Pick<Terminal, "clearTextureAtlas" | "options" | "refresh" | "rows">;

export function applyTerminalTheme(terminal: TerminalThemeTarget, themeId: ThemeId) {
  terminal.options.theme = terminalThemes[themeId];
  terminal.clearTextureAtlas();
  terminal.refresh(0, terminal.rows - 1);
}
