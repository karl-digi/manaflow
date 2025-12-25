import type { SVGProps } from "react";

export function CmuxIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      {...props}
    >
      <path
        d="M4 3L19 12L4 21V16.5L12.5 12L4 7.5V3Z"
        fill="currentColor"
      />
    </svg>
  );
}
