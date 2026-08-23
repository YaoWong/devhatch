let csrfToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function configureAuth(token: string | null, onUnauthorized?: () => void) {
  csrfToken = token;
  unauthorizedHandler = onUnauthorized ?? null;
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
    const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || fallback);
  }
  return response.json() as Promise<T>;
}

export async function requestEmpty(url: string, options: RequestInit, fallback: string, allowNotFound = false) {
  const response = await fetch(url, authenticatedOptions(options));
  if (response.status === 401) unauthorizedHandler?.();
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    const body = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;
    throw new Error(body?.message || body?.error || fallback);
  }
}
