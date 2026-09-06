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
import { LiveRegion } from "../../shared/ui/LiveRegion";
import { useDelayedLoading } from "../../shared/ui/useDelayedLoading";

export function SkillManifestDialog({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = content === null && error === null;
  const showLoading = useDelayedLoading(loading);
  const announcement = error ? "" : showLoading ? "Loading skill manifest…" : loading ? "" : "Skill manifest loaded.";
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
        <DialogContent className="tw:grid tw:h-[min(760px,calc(100dvh-64px))] tw:w-[min(900px,calc(100%-48px))] tw:grid-rows-[auto_minmax(0,1fr)] tw:overflow-hidden tw:rounded-[18px] tw:border tw:border-input tw:bg-card tw:shadow-[0_24px_70px_rgb(0_0_0/24%)] tw:max-sm:top-auto tw:max-sm:bottom-0 tw:max-sm:h-[calc(100dvh-14px)] tw:max-sm:w-[calc(100%-28px)] tw:max-sm:translate-y-0 tw:max-sm:rounded-b-none">
          <LiveRegion>{announcement}</LiveRegion>
          <header className="tw:flex tw:min-h-[66px] tw:items-center tw:gap-[16px] tw:border-b tw:border-border tw:py-[12px] tw:pr-[16px] tw:pl-[20px]">
            <span className="tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-[10px]"><FileText className="tw:size-[20px] tw:flex-none tw:text-[var(--color-accent)]" /><div className="tw:min-w-0"><DialogTitle className="tw:m-0 tw:overflow-hidden tw:text-[calc(18px*var(--app-font-scale))] tw:leading-[1.25] tw:text-ellipsis tw:whitespace-nowrap">{skill.slug}</DialogTitle><DialogDescription className="tw:m-0 tw:mt-[3px] tw:overflow-hidden tw:font-mono tw:text-[calc(11px*var(--app-font-scale))] tw:leading-[1.25] tw:text-muted-foreground tw:text-ellipsis tw:whitespace-nowrap">SKILL.md</DialogDescription></div></span>
            <DialogClose
              className="skills-icon-button tw:size-10 tw:rounded-full tw:[@media(pointer:coarse)]:size-11"
              aria-label="Close skill content"
              render={<Button variant="ghost" size="icon" />}
            >
              <X />
            </DialogClose>
          </header>
          <div className="tw:min-h-0 tw:overflow-auto tw:bg-[var(--color-surface-raised)]" aria-busy={loading}>
            {showLoading && <div className="tw:flex tw:h-full tw:items-center tw:justify-center tw:gap-[8px] tw:p-[24px] tw:text-center tw:text-[calc(12px*var(--app-font-scale))] tw:leading-[1.5] tw:text-muted-foreground tw:[overflow-wrap:anywhere]"><LoaderCircle className="spin tw:size-[15px]" />Loading content…</div>}
            {error && <div className="tw:flex tw:h-full tw:items-center tw:justify-center tw:gap-[8px] tw:p-[24px] tw:text-center tw:text-[calc(12px*var(--app-font-scale))] tw:leading-[1.5] tw:text-destructive tw:[overflow-wrap:anywhere]" role="alert">{error}</div>}
            {content !== null && <pre className="tw:m-0 tw:min-h-full tw:px-[24px] tw:py-[22px] tw:font-mono tw:text-[calc(12px*var(--app-font-scale))] tw:leading-[1.65] tw:text-[var(--color-text-subtle)] tw:whitespace-pre-wrap tw:[overflow-wrap:anywhere] tw:[tab-size:2] tw:[@media(max-width:480px)]:px-[16px] tw:[@media(max-width:480px)]:py-[18px]">{content}</pre>}
          </div>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
