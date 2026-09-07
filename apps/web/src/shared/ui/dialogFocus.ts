function visible(element: HTMLElement | null): element is HTMLElement {
  if (!element) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function captureDialogReturnFocus() {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

export function isCanvasRailOwned(element: Element | null) {
  return Boolean(element?.closest(".rail"));
}

export function resolveCanvasNavigationFocusFallback(): HTMLElement {
  const mobileTrigger = document.querySelector<HTMLElement>(".canvas-mobile-trigger");
  if (visible(mobileTrigger)) return mobileTrigger;
  const edgeTrigger = document.querySelector<HTMLElement>(".canvas-edge-trigger");
  if (visible(edgeTrigger)) return edgeTrigger;
  return document.querySelector<HTMLElement>(".rail:not([inert])") ?? document.body;
}

export function resolveDialogFinalFocus(previous: HTMLElement | null) {
  const previousInOpenSheet = previous?.closest('[data-slot="sheet-content"][data-open]');
  if (
    previous?.isConnected &&
    (previousInOpenSheet || !previous.closest("[inert], .canvas-rail-auto:not(.canvas-rail-open)")) &&
    visible(previous)
  ) return previous;
  return resolveCanvasNavigationFocusFallback();
}
