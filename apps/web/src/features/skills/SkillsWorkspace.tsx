import { ArrowDownToLine, ArrowUpToLine, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import { Button } from "@/components/ui/button";
import type { ConfirmAction } from "../../types/app";
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
    <div className="skills-workspace" ref={scrollRef} onScroll={(event: UIEvent<HTMLDivElement>) => updateScrollEdges(event.currentTarget)}>
      {showBusy && (
        operation ? (
          <div className="skills-loading skills-operation-progress" role="status" aria-label={`${repositoryOperationLabel(operation)}, ${percentage}%`}>
            <div><LoaderCircle className="spin tw:size-3.5" /><strong>{repositoryOperationLabel(operation)}…</strong><span>{percentage}%</span></div>
            <progress max="100" value={percentage} aria-label="Repository operation progress" />
            {bytes && <small>{bytes}</small>}
          </div>
        ) : <div className="skills-loading" role="status"><LoaderCircle className="spin tw:size-3.5" />Working…</div>
      )}
      <div ref={contentRef} className="skills-section-transition skills-query-container" key={section} aria-busy={controller.busy}>
        {section === "repositories" && <Repositories controller={controller} onConfirm={onConfirm} />}
        {section === "skills" && <SkillLibrary controller={controller} onConfirm={onConfirm} />}
        {section === "profiles" && <Profiles controller={controller} />}
      </div>
      {error && <div className="error-banner skills-error-banner" role="alert"><span>{error}</span><Button variant="ghost" size="icon" className="tw:size-10 tw:flex-none tw:rounded-full tw:text-[var(--color-on-solid)] tw:hover:bg-[color-mix(in_srgb,var(--color-on-solid)_12%,transparent)]! tw:hover:text-[var(--color-on-solid)]! tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Dismiss" onClick={onDismissError}><X className="tw:size-3" /></Button></div>}
      <div className="skills-scroll-controls" role="group" aria-label="Page navigation">
        <Button variant="outline" size="icon" className="tw:size-10 tw:rounded-[11px] tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Scroll to top" title="Scroll to top" disabled={scrollEdges.top} onClick={() => scrollTo("top")}><ArrowUpToLine className="tw:size-4" /></Button>
        <Button variant="outline" size="icon" className="tw:size-10 tw:rounded-[11px] tw:[@media(pointer:coarse)]:size-11" type="button" aria-label="Scroll to bottom" title="Scroll to bottom" disabled={scrollEdges.bottom} onClick={() => scrollTo("bottom")}><ArrowDownToLine className="tw:size-4" /></Button>
      </div>
    </div>
  );
}
