import { useEffect, useRef, type FocusEventHandler, type KeyboardEvent, type PointerEvent, type Ref } from "react";
import { MAX_NAVIGATION_RAIL_WIDTH_PX, MIN_NAVIGATION_RAIL_WIDTH_PX } from "../theme/displaySettings";

type Props = {
  value: number;
  hidden: boolean;
  handleRef?: Ref<HTMLDivElement>;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  onResizingChange: (resizing: boolean) => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
};

const clamp = (value: number) => Math.min(MAX_NAVIGATION_RAIL_WIDTH_PX, Math.max(MIN_NAVIGATION_RAIL_WIDTH_PX, Math.round(value)));

const setAccessibleValue = (element: HTMLDivElement, value: number) => {
  element.setAttribute("aria-valuenow", String(value));
  element.setAttribute("aria-valuetext", `${value} pixels`);
};

export function RailResizeHandle({ value, hidden, handleRef, onPreview, onCommit, onResizingChange, onPointerEnter, onPointerLeave, onFocus, onBlur }: Props) {
  const dragRef = useRef<{
    element: HTMLDivElement;
    pointerId: number;
    startX: number;
    startWidth: number;
    currentWidth: number;
  } | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const callbacksRef = useRef({ onPreview, onResizingChange });
  callbacksRef.current = { onPreview, onResizingChange };
  useEffect(() => {
    const query = window.matchMedia("(max-width: 920px)");
    const cancel = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      callbacksRef.current.onResizingChange(false);
      setAccessibleValue(drag.element, valueRef.current);
      callbacksRef.current.onPreview(valueRef.current);
    };
    query.addEventListener("change", cancel);
    window.addEventListener("pageshow", cancel);
    window.addEventListener("orientationchange", cancel);
    return () => {
      query.removeEventListener("change", cancel);
      window.removeEventListener("pageshow", cancel);
      window.removeEventListener("orientationchange", cancel);
      dragRef.current = null;
    };
  }, []);

  const finish = (event: PointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onResizingChange(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (commit) onCommit(drag.currentWidth);
    else {
      setAccessibleValue(event.currentTarget, valueRef.current);
      onPreview(valueRef.current);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next = value;
    if (event.key === "ArrowLeft") next -= event.shiftKey ? 32 : 8;
    else if (event.key === "ArrowRight") next += event.shiftKey ? 32 : 8;
    else if (event.key === "Home") next = MIN_NAVIGATION_RAIL_WIDTH_PX;
    else if (event.key === "End") next = MAX_NAVIGATION_RAIL_WIDTH_PX;
    else return;
    event.preventDefault();
    next = clamp(next);
    onPreview(next);
    onCommit(next);
  };

  return (
    <div
      ref={handleRef}
      className="rail-resize-handle"
      role="separator"
      aria-label="Resize navigation sidebar"
      aria-hidden={hidden}
      aria-orientation="vertical"
      aria-valuemin={MIN_NAVIGATION_RAIL_WIDTH_PX}
      aria-valuemax={MAX_NAVIGATION_RAIL_WIDTH_PX}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={hidden ? -1 : 0}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (hidden || event.button !== 0 || window.matchMedia("(max-width: 920px)").matches) return;
        dragRef.current = {
          element: event.currentTarget,
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
        setAccessibleValue(event.currentTarget, next);
        onPreview(next);
      }}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      onLostPointerCapture={(event) => finish(event, false)}
    >
      <span aria-hidden="true" />
    </div>
  );
}
