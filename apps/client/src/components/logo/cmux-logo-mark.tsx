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
  /** Debug: draw guides and border */
  showGuides?: boolean;
  showBorder?: boolean;
};

export default function CmuxLogoMark({
  height = "1em",
  label,
  from = "#00D4FF",
  to = "#7C3AED",
  showGuides = false,
  showBorder = false,
  style,
  ...rest
}: Props) {
  const id = React.useId();
  const gradId = `cmuxMarkGradient-${id}`;
  const filterId = `cmuxMarkFilter-${id}`;
  const titleId = label ? `cmuxTitle-${id}` : undefined;

  const css = `
    .mark-fill { fill: url(#${gradId}); }
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
        <filter
          id={filterId}
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
          <feBlend
            mode="normal"
            in2="BackgroundImageFix"
            result="effect1_dropShadow_116_97"
          />
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
          <feBlend
            mode="normal"
            in2="effect1_dropShadow_116_97"
            result="effect2_dropShadow_116_97"
          />
          <feBlend
            mode="normal"
            in="SourceGraphic"
            in2="effect2_dropShadow_116_97"
            result="shape"
          />
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

      {/* Logomark - new path */}
      <g filter={`url(#${filterId})`}>
        <path
          d="M64 64L453 333.5L64 603V483.222L273.462 333.5L64 183.778V64Z"
          className="mark-fill"
        />
      </g>

      {/* Debug guides and border */}
      {showGuides ? (
        <g className="pointer-events-none">
          {showBorder ? (
            <rect
              x={0}
              y={0}
              width={517}
              height={667}
              fill="none"
              className="stroke-neutral-300 dark:stroke-neutral-700"
              strokeWidth={1}
            />
          ) : null}
          <line
            x1={517 / 2}
            y1={0}
            x2={517 / 2}
            y2={667}
            className="stroke-neutral-200 dark:stroke-neutral-800"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <line
            x1={0}
            y1={667 / 2}
            x2={517}
            y2={667 / 2}
            className="stroke-neutral-200 dark:stroke-neutral-800"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        </g>
      ) : null}
    </svg>
  );
}
