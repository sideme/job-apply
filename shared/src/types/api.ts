export interface ApiMeta {
  requestId: string;
  simulated?: boolean;
  blockedReason?: string;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> =
  | {
      ok: true;
      data: T;
      meta?: ApiMeta;
    }
  | {
      ok: false;
      error: ApiErrorPayload;
      meta: ApiMeta;
    };
