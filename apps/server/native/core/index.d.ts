export interface PreviewProxyStartOptions {
  startPort?: number
  maxAttempts?: number
}

export interface PreviewProxyRegisterOptions {
  webContentsId: number
  initialUrl: string
  persistKey?: string | null
}

export interface PreviewProxyCredentials {
  username: string
  password: string
}

export function getTime(): Promise<string>
export function previewProxyStart(options?: PreviewProxyStartOptions): Promise<number>
export function previewProxySetLoggingEnabled(enabled: boolean): void
export function previewProxyRegisterContext(
  options: PreviewProxyRegisterOptions,
): PreviewProxyCredentials | null
export function previewProxyReleaseContext(webContentsId: number): boolean
