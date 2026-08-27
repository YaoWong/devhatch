import { requestEmpty, requestJson } from "./client";

export type AuthStatus = {
  initialized: boolean;
  authenticated: boolean;
  csrfToken: string | null;
};

export function authStatus() {
  return requestJson<AuthStatus>("/api/auth/status");
}

export function verifyAuth() {
  return requestEmpty("/api/auth/verify", { method: "GET" }, "Unable to verify authentication");
}

export function setupAdmin(setupToken: string, password: string) {
  return requestJson<AuthStatus>("/api/auth/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ setupToken, password }),
  });
}

export function login(password: string) {
  return requestJson<AuthStatus>("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function logout() {
  return requestEmpty("/api/auth/logout", { method: "POST" }, "Unable to sign out");
}
