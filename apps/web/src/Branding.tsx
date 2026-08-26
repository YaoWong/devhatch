import codexIcon from "./assets/codex.svg";
import piIcon from "./assets/pi.svg";
import traeIcon from "./assets/trae-cli.png";

const monochromeAgentIcons: Record<string, string> = {
  codex: codexIcon,
};

const colorAgentIcons: Record<string, string> = {
  pi: piIcon,
  traecli: traeIcon,
};

export function AgentIcon({ id, className }: { id?: string; className?: string }) {
  if (id === "opencode") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true">
        <path d="M16 6H8v12h8zm4 16H4V2h16z" />
      </svg>
    );
  }

  const monochromeIcon = id ? monochromeAgentIcons[id] : undefined;
  if (monochromeIcon) {
    return (
      <span
        className={["agent-icon-monochrome", className].filter(Boolean).join(" ")}
        style={{ maskImage: `url(${monochromeIcon})`, WebkitMaskImage: `url(${monochromeIcon})` }}
        aria-hidden="true"
      />
    );
  }

  const colorIcon = id ? colorAgentIcons[id] : undefined;
  return colorIcon ? <img className={className} src={colorIcon} alt="" aria-hidden="true" /> : null;
}

export function DevHatchLogo() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="devhatch-ring" cx="20" cy="20" r="10.2" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset=".65" stopColor="currentColor" stopOpacity=".88" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".68" />
        </radialGradient>
        <radialGradient id="devhatch-yao" cx="20" cy="20" r="13.4" gradientUnits="userSpaceOnUse">
          <stop stopColor="currentColor" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".74" />
        </radialGradient>
        <radialGradient id="devhatch-center" cx="20" cy="20" r="1.4" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity=".2" />
          <stop offset="1" stopColor="white" />
        </radialGradient>
        <mask id="devhatch-soften">
          <rect width="40" height="40" fill="white" />
          <circle cx="20" cy="20" r="1.4" fill="url(#devhatch-center)" />
        </mask>
      </defs>
      <g mask="url(#devhatch-soften)">
        <path
          d="M20 23.05V20l2.57-1.48M22.57 18.52 20 20l-2.57-1.48M17.43 18.52 20 20v3.05"
          stroke="url(#devhatch-yao)"
          strokeWidth="2.65"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M20.7 23.05 20.18 33.3a.22.22 0 0 1-.44 0l-.44-10.25Z" fill="url(#devhatch-yao)" />
        <path d="m22.18 17.84 9.45-4.78a.22.22 0 0 1 .22.38l-9.27 6.05Z" fill="url(#devhatch-yao)" />
        <path d="m17.42 19.49-9.27-6.05a.22.22 0 0 1 .22-.38l9.45 4.78Z" fill="url(#devhatch-yao)" />
      </g>
      <circle
        cx="20"
        cy="20"
        r="9.77"
        fill="none"
        stroke="url(#devhatch-ring)"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeDasharray="17.39 3.07"
        transform="rotate(-21 20 20)"
      />
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark">
        <DevHatchLogo />
      </div>
      <div>
        <strong>DevHatch</strong>
        <small>Developer Workspace</small>
      </div>
    </div>
  );
}
