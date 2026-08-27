import { FileText, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getSkillManifest } from "../../api/skills";
import type { Skill } from "../../types/skills";

export function SkillManifestDialog({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", close);
    void getSkillManifest(skill.id)
      .then((result) => { if (current) setContent(result.content); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => {
      current = false;
      window.removeEventListener("keydown", close);
    };
  }, [onClose, skill.id]);
  return createPortal(
    <div className="dialog-backdrop skill-manifest-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="skill-manifest-dialog" role="dialog" aria-modal="true" aria-labelledby="skill-manifest-title">
        <header>
          <span><FileText /><div><h2 id="skill-manifest-title">{skill.slug}</h2><p>SKILL.md</p></div></span>
          <button className="skills-icon-button" type="button" aria-label="Close skill content" onClick={onClose}><X /></button>
        </header>
        <div className="skill-manifest-body">
          {content === null && !error && <div className="skill-manifest-loading"><LoaderCircle className="spin" />Loading content…</div>}
          {error && <div className="skill-manifest-error">{error}</div>}
          {content !== null && <pre>{content}</pre>}
        </div>
      </section>
    </div>,
    document.body,
  );
}
