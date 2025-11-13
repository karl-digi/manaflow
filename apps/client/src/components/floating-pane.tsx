export function FloatingPane({
  children,
  header,
}: {
  children?: React.ReactNode;
  header?: React.ReactNode;
}) {
  return (
    <div className="py-1.5 px-[5.8px] grow h-dvh flex flex-col bg-neutral-50 min-w-0 min-h-0 dark:bg-black">
      <div className="rounded-md border border-neutral-200/70 dark:border-neutral-800/50 flex flex-col grow min-h-0 h-full overflow-hidden bg-white dark:bg-neutral-900">
        {header ? <div className="flex-shrink-0">{header}</div> : null}
        <div className="flex-1 overflow-y-auto min-h-0">{children}</div>
      </div>
    </div>
  );
}
