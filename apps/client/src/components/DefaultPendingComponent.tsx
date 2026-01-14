import CmuxLogoMarkAnimated from "./logo/cmux-logo-mark-animated";
import { getRandomKitty } from "./kitties";

/**
 * Shows the animated cmux logo during route transitions.
 * This is displayed while beforeLoad is running, such as when
 * polling for team membership to handle webhook sync lag for new users.
 */
export function DefaultPendingComponent() {
  return (
    <div className="absolute inset-0 w-screen h-dvh flex flex-col items-center justify-center bg-white dark:bg-black z-[var(--z-global-blocking)]">
      <CmuxLogoMarkAnimated height={40} duration={2.9} />
      <pre className="text-xs font-mono text-neutral-200 dark:text-neutral-800 absolute bottom-0 left-0 pl-4 pb-4">
        {getRandomKitty()}
      </pre>
    </div>
  );
}
