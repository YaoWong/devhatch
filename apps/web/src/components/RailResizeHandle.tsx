import { useRef, type KeyboardEvent, type PointerEvent } from "react";

type Props = {
  value: number;
  hidden: boolean;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onResizingChange: (resizing: boolean) => void;
};

const clamp = (value: number) => Math.min(480, Math.max(240, Math.round(value)));

export function RailResizeHandle({ value, hidden, onPreview, onCommit, onResizingChange }: Props) {
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onResizingChange(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit) onCommit(drag.currentWidth);
    else onPreview(drag.startWidth);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    if (event.key === "ArrowLeft") next -= event.shiftKey ? 32 : 8;
    else if (event.key === "ArrowRight") next += event.shiftKey ? 32 : 8;
    else if (event.key === "Home") next = 240;
    else if (event.key === "End") next = 480;
    else return;
    event.preventDefault();
    next = clamp(next);
    onPreview(next);
    onCommit(next);
  };

  return (
    <div
      className="rail-resize-handle"
      role="separator"
      aria-label="Resize navigation sidebar"
      aria-hidden={hidden}
      aria-orientation="vertical"
      aria-valuemin={240}
      aria-valuemax={480}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={hidden ? -1 : 0}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (hidden || event.button !== 0 || !window.matchMedia("(min-width: 921px)").matches) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: value,
          currentWidth: value,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        onResizingChange(true);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (drag?.pointerId !== event.pointerId) return;
        const next = clamp(drag.startWidth + event.clientX - drag.startX);
        drag.currentWidth = next;
        onPreview(next);
      }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}
    />
  );
}
