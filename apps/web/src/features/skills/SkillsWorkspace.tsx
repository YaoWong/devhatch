import { ArrowDownToLine, ArrowUpToLine, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ConfirmAction } from "../../types/app";
import { FloatingAlert } from "../../shared/ui/FloatingAlert";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";
import type { SkillsSection } from "./SkillsRailPage";
import type { SkillsController } from "./controller";
import { Profiles } from "./Profiles";
import { formatRepositoryOperationBytes, repositoryOperationLabel, repositoryOperationPercentage } from "./repositoryOperation";
import { Repositories } from "./Repositories";
import { SkillLibrary } from "./SkillLibrary";

export function SkillsWorkspace({ section, controller, error, onDismissError, onConfirm }: {
  section: SkillsSection;
  controller: SkillsController;
  error: string | null;
  onDismissError: () => void;
  onConfirm: (action: ConfirmAction) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: true, bottom: false });
  const operation = controller.repositoryOperation;
  const showBusy = useDelayedLoading(controller.busy);
  const percentage = operation ? repositoryOperationPercentage(operation.progress) : 0;
  const bytes = operation ? formatRepositoryOperationBytes(operation.downloadedBytes, operation.totalBytes) : null;
  const updateScrollEdges = (element: HTMLDivElement) => setScrollEdges({
    top: element.scrollTop <= 1,
    bottom: element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
  });
  const scrollTo = (edge: "top" | "bottom") => {
    const element = scrollRef.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollTo({ top: edge === "top" ? 0 : element.scrollHeight, behavior: reducedMotion ? "auto" : "smooth" });
  };
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: 0, behavior: "auto" });
    const update = () => updateScrollEdges(element);
    update();
    const mutationObserver = new MutationObserver(update);
    const resizeObserver = new ResizeObserver(update);
    mutationObserver.observe(element, { childList: true, subtree: true });
    resizeObserver.observe(element);
    if (contentRef.current) resizeObserver.observe(contentRef.current);
    window.addEventListener("resize", update);
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [section]);
  return (
    <div className="tw:relative tw:min-h-0 tw:overflow-x-hidden tw:overflow-y-scroll tw:bg-[var(--color-canvas)] tw:px-[38px] tw:pt-[38px] tw:pb-[96px] tw:[scrollbar-gutter:stable] tw:[@media(max-width:920px)]:pt-[58px]! tw:[@media(max-width:640px)]:px-[14px] tw:[@media(max-width:640px)]:pb-[96px]" ref={scrollRef} onScroll={(event: UIEvent<HTMLDivElement>) => updateScrollEdges(event.currentTarget)}>
      {showBusy && (
        operation ? (
          <div className="tw:fixed tw:top-[28px] tw:right-[28px] tw:z-[8] tw:grid tw:w-[min(300px,calc(100vw-56px))] tw:gap-[6px] tw:rounded-[12px] tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:px-[11px] tw:py-[8px] tw:text-xs tw:leading-[1.3] tw:text-muted-foreground tw:shadow-[0_6px_18px_rgb(0_0_0/8%)] tw:backdrop-blur-[8px]" role="status" aria-label={`${repositoryOperationLabel(operation)}, ${percentage}%`}>
            <div className="tw:flex tw:items-center tw:gap-[7px]"><LoaderCircle className="spin tw:size-3.5" /><strong className="tw:flex-1 tw:font-semibold tw:text-[var(--color-text-subtle)]">{repositoryOperationLabel(operation)}…</strong><span>{percentage}%</span></div>
            <progress className="tw:h-[5px] tw:w-full tw:accent-[var(--color-accent)]" max="100" value={percentage} aria-label="Repository operation progress" />
            {bytes && <small className="tw:text-right tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.3] tw:text-muted-foreground">{bytes}</small>}
          </div>
        ) : <div className="tw:fixed tw:top-[28px] tw:right-[28px] tw:z-[8] tw:flex tw:items-center tw:gap-[7px] tw:rounded-[99px] tw:border tw:border-border tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:px-[11px] tw:py-[8px] tw:text-xs tw:leading-[1.3] tw:text-muted-foreground tw:shadow-[0_6px_18px_rgb(0_0_0/8%)] tw:backdrop-blur-[8px]" role="status"><LoaderCircle className="spin tw:size-3.5" />Working…</div>
      )}
      <div ref={contentRef} className="skills-section-transition tw:@container/skills-workspace" key={section} aria-busy={controller.busy}>
        {section === "repositories" && <Repositories controller={controller} onConfirm={onConfirm} />}
        {section === "skills" && <SkillLibrary controller={controller} onConfirm={onConfirm} />}
        {section === "profiles" && <Profiles controller={controller} />}
      </div>
      {error && <FloatingAlert className="tw:fixed tw:top-[76px] tw:left-1/2 tw:max-w-[min(560px,calc(100vw-32px))] tw:-translate-x-1/2" dismissLabel="Dismiss skills error" onDismiss={onDismissError}>{error}</FloatingAlert>}
      <div className="tw:fixed tw:right-[28px] tw:bottom-[28px] tw:z-[8] tw:grid tw:gap-[6px] tw:[@media(max-width:640px)]:right-[14px] tw:[@media(max-width:640px)]:bottom-[14px]" role="group" aria-label="Page navigation">
        <Button variant="outline" size="icon" className="tw:size-10 tw:rounded-[11px] tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:text-[var(--color-text-subtle)] tw:shadow-[0_5px_16px_rgb(0_0_0/10%)] tw:backdrop-blur-[12px] tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Scroll to top" title="Scroll to top" disabled={scrollEdges.top} onClick={() => scrollTo("top")}><ArrowUpToLine className="tw:size-4" /></Button>
        <Button variant="outline" size="icon" className="tw:size-10 tw:rounded-[11px] tw:bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] tw:text-[var(--color-text-subtle)] tw:shadow-[0_5px_16px_rgb(0_0_0/10%)] tw:backdrop-blur-[12px] tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Scroll to bottom" title="Scroll to bottom" disabled={scrollEdges.bottom} onClick={() => scrollTo("bottom")}><ArrowDownToLine className="tw:size-4" /></Button>
      </div>
    </div>
  );
}
