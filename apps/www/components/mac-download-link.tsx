"use client";

import { useMemo, type AnchorHTMLAttributes } from "react";

import type { MacDownloadUrl } from "@/lib/releases";

type MacDownloadLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> & {
  url: MacDownloadUrl;
  fallbackUrl: string;
};

export function MacDownloadLink({
  url,
  fallbackUrl,
  ...anchorProps
}: MacDownloadLinkProps) {
  const href = useMemo(() => {
    if (typeof url === "string" && url.trim() !== "") {
      return url;
    }

    return fallbackUrl;
  }, [fallbackUrl, url]);

  return <a {...anchorProps} href={href} />;
}
