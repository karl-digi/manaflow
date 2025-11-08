"use client";

import CmuxLogo from "@/components/logo/cmux-logo";
import { MacDownloadLink } from "@/components/mac-download-link";
import type { MacDownloadUrls } from "@/lib/releases";
import clsx from "clsx";
import { Download, Github, Star } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

export const NAV_ITEMS = [
  { id: "about", label: "About" },
  { id: "workflow", label: "Workflow" },
  { id: "verification", label: "Verification" },
];

const GITHUB_REPO_URL = "https://github.com/manaflow-ai/cmux";
const GITHUB_REPO_API_URL = "https://api.github.com/repos/manaflow-ai/cmux";

type SiteHeaderProps = {
  linkPrefix?: string;
  showDownload?: boolean;
  fallbackUrl?: string;
  latestVersion?: string | null;
  macDownloadUrls?: MacDownloadUrls;
  extraEndContent?: ReactNode;
};

const DEFAULT_DOWNLOAD_URLS: MacDownloadUrls = {
  universal: null,
  arm64: null,
  x64: null,
};

const compactNumberFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function formatStarCount(value: number | null): string | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return compactNumberFormatter.format(value);
}

export function SiteHeader({
  linkPrefix = "",
  showDownload = true,
  fallbackUrl = "https://github.com/manaflow-ai/cmux/releases",
  latestVersion,
  macDownloadUrls,
  extraEndContent,
}: SiteHeaderProps) {
  const effectiveUrls = macDownloadUrls ?? DEFAULT_DOWNLOAD_URLS;
  const [isScrolled, setIsScrolled] = useState(false);
  const [githubStars, setGithubStars] = useState<number | null>(null);

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

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function fetchGitHubStars() {
      try {
        const response = await fetch(GITHUB_REPO_API_URL, {
          headers: {
            Accept: "application/vnd.github+json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as {
          stargazers_count?: number;
        };

        if (!isMounted) {
          return;
        }

        const starCount =
          typeof data.stargazers_count === "number"
            ? data.stargazers_count
            : null;

        setGithubStars(starCount);
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "AbortError" || error.message === "AbortError")
        ) {
          return;
        }
        // Swallow fetch errors so the header never blocks rendering.
        console.warn("Unable to fetch GitHub stars", error);
      }
    }

    fetchGitHubStars();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  const githubStarLabel = formatStarCount(githubStars) ?? "Star us";

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
            aria-label="Visit the cmux GitHub repository"
            className="inline-flex items-center gap-2 text-neutral-300 transition hover:text-white"
            href={GITHUB_REPO_URL}
            rel="noopener noreferrer"
            target="_blank"
          >
            <Github className="h-4 w-4" aria-hidden />
            <span>GitHub</span>
            <span
              aria-live="polite"
              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs font-semibold text-white"
            >
              <Star className="h-3 w-3 fill-current" aria-hidden />
              {githubStarLabel}
            </span>
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
