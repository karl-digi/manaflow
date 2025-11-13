export interface WebContentsLayoutExpectedState {
  width: number;
  height: number;
  offsetTop: number;
  offsetLeft: number;
  borderRadius: number;
  timestamp: string;
}

export interface WebContentsLayoutRendererBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WebContentsLayoutLogRequest {
  viewId: number;
  persistKey?: string;
  expected: WebContentsLayoutExpectedState;
  rendererBounds?: WebContentsLayoutRendererBounds | null;
}

export interface WebContentsLayoutActualState {
  bounds: WebContentsLayoutRendererBounds;
  ownerWindowId: number;
  ownerWebContentsId: number;
  suspended: boolean;
  destroyed: boolean;
  visible: boolean;
}

export interface WebContentsLayoutLogResponse {
  ok: boolean;
  actual?: WebContentsLayoutActualState | null;
  error?: string;
}
