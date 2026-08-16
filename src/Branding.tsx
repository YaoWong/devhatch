import codexIcon from "./assets/codex.svg";
import opencodeIcon from "./assets/opencode.svg";

export function AgentIcon({ id, className }: { id?: string; className?: string }) {
  return <img className={className} src={id === "codex" ? codexIcon : opencodeIcon} alt="" aria-hidden="true" />;
}

export function DevHatchLogo() {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <radialGradient id="devhatch-ring" cx="20" cy="20" r="10.2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0e0e0e" />
          <stop offset=".65" stopColor="#1a1a1a" />
          <stop offset="1" stopColor="#323232" />
        </radialGradient>
        <radialGradient id="devhatch-yao" cx="20" cy="20" r="13.4" gradientUnits="userSpaceOnUse">
          <stop stopColor="#202020" />
          <stop offset="1" stopColor="#343431" />
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
