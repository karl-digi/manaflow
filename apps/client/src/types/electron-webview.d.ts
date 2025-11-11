import type React from "react";

// Minimal typings for Electron's <webview> so TSX compiles in the renderer.
// Keep attributes we actually use to avoid depending on Electron types here.
declare global {
  interface HTMLWebViewElement extends HTMLElement {
    src: string;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
  }

  namespace JSX {
    interface WebviewHTMLAttributes<T> extends React.HTMLAttributes<T> {
      src?: string;
      allowpopups?: boolean;
      // Common styling props will come from React.HTMLAttributes via extension
    }

    interface IntrinsicElements {
      webview: WebviewHTMLAttributes<HTMLWebViewElement>;
    }
  }
}

export {};
