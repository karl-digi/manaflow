"use client";

import CmuxLogo from "@/components/logo/cmux-logo";
import { MacDownloadLink } from "@/components/mac-download-link";
import type { MacDownloadUrls } from "@/lib/releases";
import clsx from "clsx";
import { Download, Github } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export const NAV_ITEMS = [
  { id: "about", label: "About" },
  { id: "workflow", label: "Workflow" },
  { id: "verification", label: "Verification" },
];

type SiteHeaderProps = {
  linkPrefix?: string;
  showDownload?: boolean;
  fallbackUrl?: string;
  latestVersion?: string | null;
  macDownloadUrls?: MacDownloadUrls;
  extraEndContent?: ReactNode;
  githubStars?: number | null;
};

const DEFAULT_DOWNLOAD_URLS: MacDownloadUrls = {
  universal: null,
  arm64: null,
  x64: null,
};

const CMUX_GITHUB_URL = "https://github.com/manaflow-ai/cmux";

const formatStarCount = (stars?: number | null): string | null => {
  if (typeof stars !== "number" || !Number.isFinite(stars) || stars < 0) {
    return null;
  }

  if (stars < 1000) {
    return Math.round(stars).toString();
  }

  const thresholds = [
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" },
  ] as const;

  for (const { value, suffix } of thresholds) {
    if (stars >= value) {
      const compact = (stars / value)
        .toFixed((stars / value) >= 10 ? 0 : 1)
        .replace(/\.0$/, "");
      return `${compact}${suffix}`;
    }
  }

  return Math.round(stars).toString();
};

export function SiteHeader({
  linkPrefix = "",
  showDownload = true,
  fallbackUrl = "https://github.com/manaflow-ai/cmux/releases",
  latestVersion,
  macDownloadUrls,
  extraEndContent,
  githubStars,
}: SiteHeaderProps) {
  const effectiveUrls = macDownloadUrls ?? DEFAULT_DOWNLOAD_URLS;
  const [isScrolled, setIsScrolled] = useState(false);
  const formattedStars = formatStarCount(githubStars);

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 12);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  return (
    <header
      className={clsx(
        "sticky top-0 z-40 backdrop-blur transition-colors",
        isScrolled
          ? "border-b border-white/10 bg-transparent"
          : "border-b border-transparent bg-transparent"
      )}
    >
      <div
        className={clsx(
          "mx-auto flex max-w-6xl items-center justify-between px-4 sm:px-6",
          isScrolled ? "py-3" : "py-4"
        )}
      >
        <Link aria-label="cmux" href="/">
          <div className="flex items-center gap-3">
            <CmuxLogo height={36} label="cmux" showWordmark />
          </div>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.id}
              className="text-neutral-300 transition hover:text-white"
              href={`${linkPrefix}#nav-${item.id}`}
            >
              {item.label}
            </Link>
          ))}
          {/* <Link className="text-neutral-300 transition hover:text-white" href="/tutorial">
            Tutorial
          </Link> */}
          <a
            className="text-neutral-300 transition hover:text-white"
            href={CMUX_GITHUB_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            GitHub
          </a>
          <a
            className="text-neutral-300 transition hover:text-white"
            href="https://cal.com/team/manaflow/meeting"
            rel="noopener noreferrer"
            target="_blank"
          >
            Contact
          </a>
        </nav>
        <div className="flex items-center gap-3">
          {extraEndContent}
          <a
            className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-mono text-neutral-100 transition hover:border-white/30 hover:bg-white/10 md:inline-flex"
            href={CMUX_GITHUB_URL}
            rel="noopener noreferrer"
            target="_blank"
            aria-label={
              formattedStars
                ? `View cmux on GitHub (${formattedStars} stars)`
                : "View cmux on GitHub"
            }
          >
            <Github className="h-4 w-4" aria-hidden />
            <span className="flex items-center gap-1 tabular-nums">
              <span>GitHub</span>
              <span className="text-neutral-500">|</span>
              <span>{formattedStars ?? "Star us"}</span>
            </span>
          </a>
          {showDownload ? (
            <MacDownloadLink
              autoDetect
              fallbackUrl={fallbackUrl}
              className="hidden md:inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black shadow-sm transition hover:bg-neutral-100"
              title={
                latestVersion
                  ? `Download cmux ${latestVersion} for macOS`
                  : "Download cmux for macOS"
              }
              urls={effectiveUrls}
            >
              <Download className="h-4 w-4" aria-hidden />
              <span>Download</span>
            </MacDownloadLink>
          ) : null}
        </div>
      </div>
    </header>
  );
}
