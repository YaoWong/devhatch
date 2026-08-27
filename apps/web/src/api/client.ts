let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export class ApiError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ErrorBody = { message?: string; error?: string } | null;

async function apiError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => null)) as ErrorBody;
  return new ApiError(response.status, body?.error ?? null, body?.message || body?.error || fallback);
}

export function configureAuth(token: string | null, onUnauthorized?: () => void) {
  csrfToken = token;
  unauthorizedHandler = onUnauthorized ?? null;
}

export function notifyUnauthorized() {
  unauthorizedHandler?.();
}

function authenticatedOptions(options?: RequestInit): RequestInit | undefined {
  if (!options) return options;
  const method = (options.method ?? "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method) || !csrfToken) return options;
  const headers = new Headers(options.headers);
  headers.set("x-csrf-token", csrfToken);
  return { ...options, headers };
}

export async function requestJson<T>(url: string, options?: RequestInit, fallback = "Request failed") {
  const response = await fetch(url, authenticatedOptions(options));
  if (response.status === 401) unauthorizedHandler?.();
  if (!response.ok) {
    throw await apiError(response, fallback);
  }
  return response.json() as Promise<T>;
}

export async function requestEmpty(url: string, options: RequestInit, fallback: string, allowNotFound = false) {
  const response = await fetch(url, authenticatedOptions(options));
  if (response.status === 401) unauthorizedHandler?.();
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    throw await apiError(response, fallback);
  }
}
