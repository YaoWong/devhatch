import { useEffect, useRef, useState } from "react";

export function useDelayedLoading(loading: boolean, delayMs = 180, minimumVisibleMs = 280) {
  const [visible, setVisible] = useState(false);
  const visibleAt = useRef(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (loading) {
      if (!visible) {
        timer = setTimeout(() => {
          visibleAt.current = Date.now();
          setVisible(true);
        }, delayMs);
      }
    } else if (visible) {
      const remaining = Math.max(0, minimumVisibleMs - (Date.now() - visibleAt.current));
      timer = setTimeout(() => setVisible(false), remaining);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [delayMs, loading, minimumVisibleMs, visible]);

  return visible;
}
