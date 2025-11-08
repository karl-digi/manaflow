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
  githubRepo?: GithubRepoInfo;
};

type GithubRepoInfo = {
  repoUrl: string;
  name: string;
  stars: number | null;
};

const DEFAULT_DOWNLOAD_URLS: MacDownloadUrls = {
  universal: null,
  arm64: null,
  x64: null,
};

const DEFAULT_GITHUB_REPO: GithubRepoInfo = {
  repoUrl: "https://github.com/manaflow-ai/cmux",
  name: "manaflow-ai/cmux",
  stars: null,
};

const formatStarCount = (value: number | null): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }

  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return `${millions.toFixed(millions >= 10 ? 0 : 1).replace(/\.0$/, "")}M`;
  }

  if (value >= 1_000) {
    const thousands = value / 1_000;
    return `${thousands.toFixed(thousands >= 10 ? 0 : 1).replace(/\.0$/, "")}K`;
  }

  return value.toLocaleString();
};

function GithubRepoStarLink({ repo }: { repo: GithubRepoInfo }) {
  const formattedStars = formatStarCount(repo.stars);
  const ariaLabel =
    formattedStars !== null
      ? `${repo.name} has ${formattedStars} GitHub stars`
      : `View ${repo.name} on GitHub`;

  return (
    <a
      className="hidden h-[26px] items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 text-[0.78rem] font-mono text-neutral-100 transition hover:border-white/40 hover:bg-white/10 md:inline-flex"
      href={repo.repoUrl}
      rel="noopener noreferrer"
      target="_blank"
      aria-label={ariaLabel}
    >
      <Github className="h-4 w-4" aria-hidden />
      <span className="tabular-nums">{formattedStars ?? "GitHub"}</span>
    </a>
  );
}

export function SiteHeader({
  linkPrefix = "",
  showDownload = true,
  fallbackUrl = "https://github.com/manaflow-ai/cmux/releases",
  latestVersion,
  macDownloadUrls,
  extraEndContent,
  githubRepo,
}: SiteHeaderProps) {
  const effectiveUrls = macDownloadUrls ?? DEFAULT_DOWNLOAD_URLS;
  const effectiveGithubRepo = githubRepo ?? DEFAULT_GITHUB_REPO;
  const [isScrolled, setIsScrolled] = useState(false);

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
            href="https://github.com/manaflow-ai/cmux"
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
          <GithubRepoStarLink repo={effectiveGithubRepo} />
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
