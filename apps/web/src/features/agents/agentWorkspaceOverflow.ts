export function selectVisibleWorkspaceIndexes(
  widths: readonly number[],
  availableWidth: number,
  selectedIndex: number,
  gap = 4,
) {
  if (!widths.length || availableWidth <= 0) return { visible: [], overflow: widths.map((_, index) => index) };
  const visible: number[] = [];
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    const next = Math.max(0, widths[index]) + (visible.length ? gap : 0);
    if (used + next > availableWidth) break;
    visible.push(index);
    used += next;
  }
  if (selectedIndex >= 0 && selectedIndex < widths.length && !visible.includes(selectedIndex)) {
    const selectedWidth = Math.max(0, widths[selectedIndex]);
    while (visible.length && used + gap + selectedWidth > availableWidth) {
      const removed = visible.pop();
      if (removed === undefined) break;
      used -= Math.max(0, widths[removed]) + (visible.length ? gap : 0);
    }
    if (!visible.length || selectedWidth <= availableWidth - used - gap) visible.push(selectedIndex);
    else visible.splice(0, visible.length, selectedIndex);
    visible.sort((left, right) => left - right);
  }
  const visibleSet = new Set(visible);
  return {
    visible,
    overflow: widths.map((_, index) => index).filter((index) => !visibleSet.has(index)),
  };
}
