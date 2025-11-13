export function pinDefaultBranchFirst(names: string[], defaultName?: string | null): string[] {
  if (!defaultName) return names.slice();
  const idx = names.indexOf(defaultName);
  if (idx <= 0) return names.slice();
  return [defaultName, ...names.slice(0, idx), ...names.slice(idx + 1)];
}

