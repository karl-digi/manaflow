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

export function getTime(): Promise<string>;
export function previewProxyStart(): Promise<number>;
export function previewProxyConfigure(
  options: PreviewProxyConfigureOptions,
): Promise<PreviewProxyContextInfo>;
export function previewProxyRelease(webContentsId: number): void;
export function previewProxyCredentialsForWebContents(
  webContentsId: number,
): PreviewProxyCredentials | null;
export function previewProxySetLoggingEnabled(enabled: boolean): void;
