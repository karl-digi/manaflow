'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

type PrReviewTheme = "light" | "dark";

type PrReviewThemeContextValue = {
  theme: PrReviewTheme;
  setTheme: (theme: PrReviewTheme) => void;
  toggleTheme: () => void;
};

const STORAGE_KEY = "cmux-pr-review-theme";

const PrReviewThemeContext = createContext<PrReviewThemeContextValue | null>(
  null
);

type PreviousThemeState = {
  hadDarkClass: boolean;
  dataTheme?: string;
};

export function PrReviewThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [theme, setThemeState] = useState<PrReviewTheme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  });

  const previousThemeState = useRef<PreviousThemeState | null>(null);

  const setTheme = useCallback((nextTheme: PrReviewTheme) => {
    setThemeState(nextTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === "light" ? "dark" : "light"));
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useLayoutEffect(() => {
    const htmlElement = document.documentElement;
    if (previousThemeState.current === null) {
      previousThemeState.current = {
        hadDarkClass: htmlElement.classList.contains("dark"),
        dataTheme: htmlElement.dataset.theme,
      };
    }

    htmlElement.classList.toggle("dark", theme === "dark");
    htmlElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const htmlElement = document.documentElement;

    return () => {
      if (previousThemeState.current) {
        htmlElement.classList.toggle(
          "dark",
          previousThemeState.current.hadDarkClass
        );

        if (previousThemeState.current.dataTheme === undefined) {
          delete htmlElement.dataset.theme;
        } else {
          htmlElement.dataset.theme =
            previousThemeState.current.dataTheme;
        }
      }
    };
  }, []);

  const contextValue = useMemo<PrReviewThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
    }),
    [setTheme, theme, toggleTheme]
  );

  return (
    <PrReviewThemeContext.Provider value={contextValue}>
      <div
        className={cn(
          "min-h-dvh bg-neutral-50 font-sans text-neutral-900 transition-colors duration-200",
          theme === "dark" && "bg-neutral-950 text-neutral-100"
        )}
        data-pr-review-theme={theme}
      >
        {children}
      </div>
    </PrReviewThemeContext.Provider>
  );
}

export function usePrReviewTheme(): PrReviewThemeContextValue {
  const context = useContext(PrReviewThemeContext);
  if (!context) {
    throw new Error("usePrReviewTheme must be used within PrReviewThemeProvider");
  }

  return context;
}
