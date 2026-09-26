import { useLayoutEffect, useRef } from "react";

export function useScrollEdgeFade<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const overflowing = element.scrollHeight > element.clientHeight + 1;
      element.dataset.scrollFadeTop = String(overflowing && element.scrollTop > 1);
      element.dataset.scrollFadeBottom = String(
        overflowing && element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      );
    };
    const resizeObserver = new ResizeObserver(update);
    const mutationObserver = new MutationObserver(update);

    update();
    element.addEventListener("scroll", update, { passive: true });
    resizeObserver.observe(element);
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });

    return () => {
      element.removeEventListener("scroll", update);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  return ref;
}
