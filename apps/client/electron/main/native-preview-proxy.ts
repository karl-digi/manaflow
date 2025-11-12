import type { Logger } from "./chrome-camouflage";
import { getNativeCoreModule, type NativeCoreModule } from "./native-core";

export interface PreviewProxyRoute {
  morphId: string;
  scope: string;
  domainSuffix: string;
}

export interface PreviewProxyConfigureOptions {
  webContentsId: number;
  persistKey?: string;
  route?: PreviewProxyRoute;
}

export interface PreviewProxyContextInfo {
  username: string;
  password: string;
  port: number;
}

export interface PreviewProxyCredentials {
  username: string;
  password: string;
}

function ensureFunction<T extends keyof NativeCoreModule>(
  mod: NativeCoreModule,
  key: T
): NonNullable<NativeCoreModule[T]> {
  const fn = mod[key];
  if (!fn) {
    throw new Error(`Native core missing function ${String(key)}`);
  }
  return fn as NonNullable<NativeCoreModule[T]>;
}

const native = getNativeCoreModule();

export async function startPreviewProxy(logger: Logger): Promise<number> {
  const fn = ensureFunction(native, "previewProxyStart");
  const port = await fn();
  logger.log("Preview proxy listening", { port });
  return port;
}

export async function configureNativePreviewProxy(
  options: PreviewProxyConfigureOptions
): Promise<PreviewProxyContextInfo> {
  const fn = ensureFunction(native, "previewProxyConfigure");
  return fn(options);
}

export function releaseNativePreviewProxy(webContentsId: number): void {
  const fn = ensureFunction(native, "previewProxyRelease");
  fn(webContentsId);
}

export function getProxyCredentialsForWebContents(
  webContentsId: number
): PreviewProxyCredentials | null {
  const fn = ensureFunction(native, "previewProxyCredentialsForWebContents");
  return fn(webContentsId);
}

export function setNativePreviewProxyLoggingEnabled(enabled: boolean): void {
  const fn = ensureFunction(native, "previewProxySetLoggingEnabled");
  fn(enabled);
}
