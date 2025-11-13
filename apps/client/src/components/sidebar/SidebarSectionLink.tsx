import { Link, type LinkProps } from "@tanstack/react-router";
import clsx from "clsx";
import { type ReactNode } from "react";

interface SidebarSectionLinkProps {
  to: LinkProps["to"];
  params?: LinkProps["params"];
  search?: LinkProps["search"];
  exact?: boolean;
  children: ReactNode;
  className?: string;
}

export function SidebarSectionLink({
  to,
  params,
  search,
  exact = true,
  children,
  className,
}: SidebarSectionLinkProps) {
  return (
    <Link
      to={to}
      params={params}
      search={search}
      activeOptions={{ exact }}
      className={clsx(
        "pointer-default cursor-default flex items-center rounded-sm pl-2 ml-2 pr-3 py-0.5 text-[12px] font-medium text-neutral-600 select-none hover:bg-neutral-200/45 dark:text-neutral-300 dark:hover:bg-neutral-800/45 data-[active=true]:hover:bg-neutral-200/75 dark:data-[active=true]:hover:bg-neutral-800/65",
        className
      )}
      activeProps={{
        className: clsx(
          "bg-neutral-200/75 text-neutral-900 dark:bg-neutral-800/65 dark:text-neutral-100",
          className
        ),
        "data-active": "true",
      }}
    >
      {children}
    </Link>
  );
}
