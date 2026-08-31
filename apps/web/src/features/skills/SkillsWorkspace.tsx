import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";
import { useEffect, useRef, useState, type UIEvent } from "react";
import type { SkillsSection } from "./SkillsRailPage";
import type { SkillsController } from "./controller";
import { Profiles } from "./Profiles";
import { Repositories } from "./Repositories";
import { SkillLibrary } from "./SkillLibrary";

export function SkillsWorkspace({ section, controller, error, onDismissError }: {
  section: SkillsSection;
  controller: SkillsController;
  error: string | null;
  onDismissError: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: true, bottom: false });
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
    const observer = new MutationObserver(update);
    observer.observe(element, { childList: true, subtree: true });
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [section]);
  return (
    <div className="skills-workspace" ref={scrollRef} onScroll={(event: UIEvent<HTMLDivElement>) => updateScrollEdges(event.currentTarget)}>
      <div className="skills-section-transition" key={section}>
        {section === "repositories" && <Repositories controller={controller} />}
        {section === "skills" && <SkillLibrary controller={controller} />}
        {section === "profiles" && <Profiles controller={controller} />}
      </div>
      {error && <div className={`error-banner ${section === "profiles" ? "skills-error-top" : ""}`}>{error}<button aria-label="Dismiss" onClick={onDismissError}>×</button></div>}
      <div className="skills-scroll-controls" aria-label="Page navigation">
        <button type="button" aria-label="Scroll to top" title="Scroll to top" disabled={scrollEdges.top} onClick={() => scrollTo("top")}><ArrowUpToLine /></button>
        <button type="button" aria-label="Scroll to bottom" title="Scroll to bottom" disabled={scrollEdges.bottom} onClick={() => scrollTo("bottom")}><ArrowDownToLine /></button>
      </div>
    </div>
  );
}
