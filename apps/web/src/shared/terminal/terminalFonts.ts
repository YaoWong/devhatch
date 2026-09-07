interface FontLoader {
  load(font: string): PromiseLike<unknown>;
}

const terminalFontDescriptors = [
  '400 16px "JetBrainsMono Nerd Font Web"',
  '700 16px "JetBrainsMono Nerd Font Web"',
];
const terminalFontLoads = new WeakMap<FontLoader, Promise<void>>();

export function loadTerminalFonts(fonts: FontLoader | null | undefined): Promise<void> {
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  const existing = terminalFontLoads.get(fonts);
  if (existing) return existing;
  const load = (descriptor: string) => {
    try {
      return Promise.resolve(fonts.load(descriptor));
    } catch (reason) {
      return Promise.reject(reason);
    }
  };
  const promise = Promise.all(terminalFontDescriptors.map(load)).then(() => undefined);
  terminalFontLoads.set(fonts, promise);
  void promise.catch(() => {
    if (terminalFontLoads.get(fonts) === promise) terminalFontLoads.delete(fonts);
  });
  return promise;
}
