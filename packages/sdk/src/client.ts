import { ErrorCode, type ErrorResponse } from '@lark/shared';

export interface ClientOptions {
  baseUrl: string;
  token?: string;
}

export class AgentFeedError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'AgentFeedError';
  }
}

export class AgentFeedClient {
  private readonly baseUrl: string;
  private token: string | undefined;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.token) {
      h['Authorization'] = `Bearer ${this.token}`;
    }
    return h;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers(),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);

    if (!res.ok) {
      let errBody: ErrorResponse | undefined;
      try {
        errBody = (await res.json()) as ErrorResponse;
      } catch {
        // non-JSON error response
      }
      if (errBody?.error) {
        throw new AgentFeedError(
          errBody.error.code,
          errBody.error.message,
          errBody.error.retryable,
          res.status,
        );
      }
      throw new AgentFeedError(
        ErrorCode.VALIDATION_ERROR,
        `HTTP ${res.status}: ${res.statusText}`,
        false,
        res.status,
      );
    }

    return (await res.json()) as T;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
}
