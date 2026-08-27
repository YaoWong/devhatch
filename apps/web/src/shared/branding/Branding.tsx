import piIcon from "./pi.svg";
import traeIcon from "./trae-cli.png";

const colorAgentIcons: Record<string, string> = {
  pi: piIcon,
  traecli: traeIcon,
};

export function AgentIcon({ id, className = "agent-logo" }: { id?: string; className?: string }) {
  if (id === "opencode") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" fillRule="evenodd" aria-hidden="true">
        <path d="M16 6H8v12h8zm4 16H4V2h16z" />
      </svg>
    );
  }

  if (id === "codex") {
    return (
      <svg
        className={className}
        viewBox="0 0 24 24"
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        aria-hidden="true"
      >
        <path d="M13.795 23.856q-1.188 0-2.256-.448a6.1 6.1 0 0 1-1.9-1.247 5.8 5.8 0 0 1-1.875.306 5.8 5.8 0 0 1-2.944-.777 6.1 6.1 0 0 1-2.184-2.12q-.807-1.34-.808-2.99 0-.682.19-1.482a6.3 6.3 0 0 1-1.472-2.002 5.76 5.76 0 0 1 .024-4.85q.546-1.177 1.52-2.024a5.5 5.5 0 0 1 2.303-1.2A5.55 5.55 0 0 1 5.485 2.62 6.06 6.06 0 0 1 7.575.925 5.85 5.85 0 0 1 10.21.313q1.187 0 2.255.447a6.1 6.1 0 0 1 1.9 1.248 5.8 5.8 0 0 1 1.875-.306q1.59 0 2.944.776a5.9 5.9 0 0 1 2.16 2.12q.832 1.34.832 2.99 0 .682-.19 1.483a6.2 6.2 0 0 1 1.472 2.024q.522 1.13.522 2.378 0 1.272-.546 2.449a6.1 6.1 0 0 1-1.543 2.048 5.45 5.45 0 0 1-2.28 1.177 5.4 5.4 0 0 1-1.115 2.402 5.8 5.8 0 0 1-2.066 1.695 5.85 5.85 0 0 1-2.635.612M7.93 20.913q1.188 0 2.066-.495l4.463-2.542a.52.52 0 0 0 .238-.448v-2.024L8.95 18.676a.97.97 0 0 1-1.044 0L3.419 16.11a.7.7 0 0 1-.024.165v.282q0 1.201.57 2.213.594.99 1.639 1.554 1.044.59 2.326.589m.238-3.838q.143.07.26.07a.46.46 0 0 0 .238-.07l1.781-1.012-5.722-3.296q-.522-.306-.522-.918v-5.11a4.27 4.27 0 0 0-1.9 1.602 4.13 4.13 0 0 0-.712 2.354q0 1.155.594 2.213.593 1.06 1.543 1.601zm5.627 5.227q1.258 0 2.279-.565a4.25 4.25 0 0 0 1.614-1.554q.594-.99.594-2.213v-5.085q0-.283-.237-.424l-1.805-1.036v6.568q0 .613-.522.919l-4.487 2.566q1.163.825 2.564.824m.902-8.617v-3.202l-2.683-1.507-2.707 1.507v3.202l2.707 1.507zm-6.933-7.51q0-.612.522-.918l4.488-2.567a4.34 4.34 0 0 0-2.564-.824q-1.26 0-2.28.565a4.25 4.25 0 0 0-1.614 1.554q-.57.99-.57 2.213v5.062q0 .283.237.447l1.781 1.036zm12.061 11.253a4.13 4.13 0 0 0 1.876-1.6 4.2 4.2 0 0 0 .712-2.355q0-1.154-.593-2.213-.594-1.06-1.544-1.6l-4.44-2.543q-.142-.095-.26-.071a.46.46 0 0 0-.238.07l-1.78.99 5.745 3.319q.26.141.38.377a.9.9 0 0 1 .142.518zm-4.772-11.96q.522-.33 1.045 0l4.51 2.614v-.424q0-1.13-.57-2.142a4.1 4.1 0 0 0-1.59-1.648q-1.02-.613-2.374-.613-1.187 0-2.066.495L9.545 6.292a.52.52 0 0 0-.238.448v2.025z" />
      </svg>
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
