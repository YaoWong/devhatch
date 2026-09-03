import { FileText, LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";
import { getSkillManifest } from "../../api/skills";
import type { Skill } from "../../types/skills";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

export function SkillManifestDialog({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const showLoading = useDelayedLoading(content === null && error === null);
  useEffect(() => {
    let current = true;
    void getSkillManifest(skill.id)
      .then((result) => { if (current) setContent(result.content); })
      .catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => {
      current = false;
    };
  }, [skill.id]);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="skill-manifest-dialog tw:grid tw:h-[min(760px,calc(100dvh-64px))] tw:w-[min(900px,calc(100%-48px))] tw:grid-rows-[auto_minmax(0,1fr)] tw:overflow-hidden tw:rounded-[18px] tw:border tw:border-input tw:bg-card tw:shadow-[0_24px_70px_rgb(0_0_0/24%)] tw:max-sm:top-auto tw:max-sm:bottom-0 tw:max-sm:h-[calc(100dvh-14px)] tw:max-sm:w-[calc(100%-28px)] tw:max-sm:translate-y-0 tw:max-sm:rounded-b-none">
          <header>
            <span><FileText className="tw:size-5" /><div><DialogTitle>{skill.slug}</DialogTitle><DialogDescription>SKILL.md</DialogDescription></div></span>
            <DialogClose
              className="skills-icon-button tw:size-10 tw:rounded-full tw:[@media(pointer:coarse)]:size-11"
              aria-label="Close skill content"
              render={<Button variant="ghost" size="icon" />}
            >
              <X />
            </DialogClose>
          </header>
          <div className="skill-manifest-body" aria-busy={content === null && error === null}>
            {showLoading && <div className="skill-manifest-loading" role="status"><LoaderCircle className="spin tw:size-[15px]" />Loading content…</div>}
            {error && <div className="skill-manifest-error" role="alert">{error}</div>}
            {content !== null && <pre>{content}</pre>}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
