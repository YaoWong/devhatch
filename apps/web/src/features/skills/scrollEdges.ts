export type ScrollEdges = { top: boolean; bottom: boolean };

type ScrollMetrics = {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
};

export function resolveScrollEdges(current: ScrollEdges, metrics: ScrollMetrics) {
  const top = metrics.scrollTop <= 1;
  const bottom = metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 1;
  return current.top === top && current.bottom === bottom ? current : { top, bottom };
}
