export const terminalThumbnailSize = { width: 320, height: 200 } as const;

export function terminalThumbnailBounds(
  screen: { left: number; top: number; width: number; height: number },
  layer: { left: number; top: number; width: number; height: number },
) {
  if (screen.width <= 0 || screen.height <= 0) return { x: 0, y: 0, width: terminalThumbnailSize.width, height: terminalThumbnailSize.height };
  const scaleX = terminalThumbnailSize.width / screen.width;
  const scaleY = terminalThumbnailSize.height / screen.height;
  return {
    x: (layer.left - screen.left) * scaleX,
    y: (layer.top - screen.top) * scaleY,
    width: layer.width * scaleX,
    height: layer.height * scaleY,
  };
}
