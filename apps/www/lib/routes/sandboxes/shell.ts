export const singleQuote = (value: string): string =>
  `'${value.replace(/'/g, "'\\''")}'`;

export const maskSensitive = (value: string): string =>
  value.replace(/:[^@]*@/g, ":***@");
