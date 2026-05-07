const BASE_URL = '';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(
  method: string,
  path: string,
  token: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(res.status, text);
  }

  return res.json() as Promise<T>;
}

export function get<T>(path: string, token: string): Promise<T> {
  return request<T>('GET', path, token);
}

export function post<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, token, body);
}

export function patch<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, token, body);
}

export function del<T>(path: string, token: string): Promise<T> {
  return request<T>('DELETE', path, token);
}
