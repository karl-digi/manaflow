import * as React from "react";

type Props = Omit<
  React.SVGProps<SVGSVGElement>,
  "width" | "height" | "title"
> & {
  /** Visual height (e.g. "1.5rem", 48). Width stays proportional. Default: "1em". */
  height?: number | string;
  /** Accessible label (screen readers only). If omitted, the SVG is aria-hidden. */
  label?: string;
  /** Gradient colors for the mark. */
  from?: string; // default "#00D4FF"
  to?: string; // default "#7C3AED"
  /** Pulse duration in seconds. */
  duration?: number; // default 3.2s
};

export default function CmuxLogoMarkAnimated({
  height = "1em",
  label,
  from = "#00D4FF",
  to = "#7C3AED",
  duration = 2.9,
  style,
  ...rest
}: Props) {
  const id = React.useId();
  const gradId = `cmuxAnimGradient-${id}`;
  const mediumFilterId = `cmuxGlowMedium-${id}`;
  const bigFilterId = `cmuxGlowBig-${id}`;
  const titleId = label ? `cmuxTitle-${id}` : undefined;

  const css = `
    .mark-fill { fill: url(#${gradId}); }
    .glow {
      animation-name: cmuxPulse;
      animation-timing-function: ease-in-out;
      animation-iteration-count: infinite;
      transform-box: fill-box;
      transform-origin: 50% 50%;
      mix-blend-mode: screen;
    }
    @keyframes cmuxPulse {
      0%   { opacity: 0.15; transform: scale(1); }
      40%  { opacity: 0.9;  transform: scale(1.015); }
      60%  { opacity: 0.9;  transform: scale(1.015); }
      100% { opacity: 0.15; transform: scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .glow { animation: none; opacity: 0.35; }
    }
  `;

  return (
    <svg
      viewBox="0 0 517 667"
      role="img"
      aria-labelledby={label ? titleId : undefined}
      aria-hidden={label ? undefined : true}
      preserveAspectRatio="xMidYMid meet"
      style={{
        display: "inline-block",
        verticalAlign: "middle",
        height,
        width: "auto",
        ...style,
      }}
      {...rest}
    >
      {label ? <title id={titleId}>{label}</title> : null}

      <defs>
        {/* Medium glow filter */}
        <filter
          id={mediumFilterId}
          x="0"
          y="0"
          width="517"
          height="667"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="32" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.14902 0 0 0 0 0.65098 0 0 0 0 0.980392 0 0 0 0.3 0"
          />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_116_97" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="8" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.14902 0 0 0 0 0.65098 0 0 0 0 0.980392 0 0 0 0.4 0"
          />
          <feBlend mode="normal" in2="effect1_dropShadow_116_97" result="effect2_dropShadow_116_97" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow_116_97" result="shape" />
        </filter>

        {/* Big glow filter */}
        <filter
          id={bigFilterId}
          x="-52"
          y="-52"
          width="569"
          height="719"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="45" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.14902 0 0 0 0 0.65098 0 0 0 0 0.980392 0 0 0 0.2 0"
          />
          <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_112_88" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset />
          <feGaussianBlur stdDeviation="32" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.14902 0 0 0 0 0.65098 0 0 0 0 0.980392 0 0 0 0.3 0"
          />
          <feBlend mode="normal" in2="effect1_dropShadow_112_88" result="effect2_dropShadow_112_88" />
          <feColorMatrix
            in="SourceAlpha"
            type="matrix"
            values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            result="hardAlpha"
          />
          <feOffset dy="4" />
          <feGaussianBlur stdDeviation="8" />
          <feComposite in2="hardAlpha" operator="out" />
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.14902 0 0 0 0 0.65098 0 0 0 0 0.980392 0 0 0 0.4 0"
          />
          <feBlend mode="normal" in2="effect2_dropShadow_112_88" result="effect3_dropShadow_112_88" />
          <feBlend mode="normal" in="SourceGraphic" in2="effect3_dropShadow_112_88" result="shape" />
        </filter>

        <linearGradient
          id={gradId}
          x1="64"
          y1="64"
          x2="38964"
          y2="64"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor={from} />
          <stop offset="0.0120866" stopColor={to} />
          <stop offset="0.024529" stopColor={to} />
        </linearGradient>
        <style>{css}</style>
      </defs>

      {/* Base mark with medium glow (constant) */}
      <g filter={`url(#${mediumFilterId})`}>
        <path
          d="M64 64L453 333.5L64 603V483.222L273.462 333.5L64 183.778V64Z"
          className="mark-fill"
        />
      </g>

      {/* Animated overlay with bigger glow */}
      <g
        className="glow"
        style={{ animationDuration: `${duration}s` }}
        filter={`url(#${bigFilterId})`}
      >
        <path
          d="M64 64L453 333.5L64 603V483.222L273.462 333.5L64 183.778V64Z"
          className="mark-fill"
        />
      </g>
    </svg>
  );
}
