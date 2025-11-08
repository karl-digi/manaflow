"use client";

import CmuxLogo from "@/components/logo/cmux-logo";
import { MacDownloadLink } from "@/components/mac-download-link";
import type { MacDownloadUrls } from "@/lib/releases";
import clsx from "clsx";
import { Download } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

function GitHubStarButton() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/github-stars")
      .then((res) => res.json())
      .then((data) => {
        if (data.stars) {
          setStars(data.stars);
        }
      })
      .catch((error) => {
        console.error("Failed to fetch GitHub stars:", error);
      });
  }, []);

  const formatStars = (count: number) => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  return (
    <a
      href="https://github.com/manaflow-ai/cmux"
      target="_blank"
      rel="noopener noreferrer"
      className="hidden lg:flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs font-mono text-neutral-300 transition hover:bg-white/5 hover:text-white"
    >
      <svg
        className="w-4 h-4"
        viewBox="0 0 17 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          d="M8.5 2.22168C5.23312 2.22168 2.58496 4.87398 2.58496 8.14677C2.58496 10.7642 4.27962 12.9853 6.63026 13.7684C6.92601 13.8228 7.03366 13.6401 7.03366 13.4827C7.03366 13.3425 7.02893 12.9693 7.02597 12.4754C5.38041 12.8333 5.0332 11.681 5.0332 11.681C4.76465 10.996 4.37663 10.8139 4.37663 10.8139C3.83954 10.4471 4.41744 10.4542 4.41744 10.4542C5.01072 10.4956 5.32303 11.0647 5.32303 11.0647C5.85065 11.9697 6.70774 11.7082 7.04431 11.5568C7.09873 11.1741 7.25134 10.9132 7.42051 10.7654C6.10737 10.6157 4.72621 10.107 4.72621 7.83683C4.72621 7.19031 4.95689 6.66092 5.33486 6.24686C5.27394 6.09721 5.07105 5.49447 5.39283 4.67938C5.39283 4.67938 5.88969 4.51967 7.01947 5.28626C7.502 5.15466 7.99985 5.08763 8.5 5.08692C9.00278 5.08929 9.50851 5.15495 9.98113 5.28626C11.1103 4.51967 11.606 4.67879 11.606 4.67879C11.9289 5.49447 11.7255 6.09721 11.6651 6.24686C12.0437 6.66092 12.2732 7.19031 12.2732 7.83683C12.2732 10.1129 10.8897 10.6139 9.5724 10.7606C9.78475 10.9434 9.97344 11.3048 9.97344 11.8579C9.97344 12.6493 9.96634 13.2887 9.96634 13.4827C9.96634 13.6413 10.0728 13.8258 10.3733 13.7678C11.5512 13.3728 12.5751 12.6175 13.3003 11.6089C14.0256 10.6002 14.4155 9.38912 14.415 8.14677C14.415 4.87398 11.7663 2.22168 8.5 2.22168Z"
          fill="currentColor"
        />
      </svg>
      <span>{stars !== null ? formatStars(stars) : "..."}</span>
    </a>
  );
}

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
};

const DEFAULT_DOWNLOAD_URLS: MacDownloadUrls = {
  universal: null,
  arm64: null,
  x64: null,
};

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
          <GitHubStarButton />
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
