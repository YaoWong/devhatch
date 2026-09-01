export function focusTrapTarget<T>(elements: readonly T[], active: T | null, backwards: boolean): T | null {
  if (elements.length === 0) return null;
  const index = active === null ? -1 : elements.indexOf(active);
  if (backwards && index <= 0) return elements[elements.length - 1];
  if (!backwards && (index < 0 || index === elements.length - 1)) return elements[0];
  return null;
}
