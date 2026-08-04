import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "./auth-store";

// Same-origin in Next.js — the API route handlers live under /api/v1 in this app.
const BASE_URL = "/api/v1";

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  // File uploads must not inherit the instance-wide application/json above. A multipart
  // body needs `multipart/form-data; boundary=…`, and only the browser knows the
  // boundary — so the header has to be deleted, not replaced. Leaving it as JSON makes
  // the server's req.formData() fail with "Content-Type was not one of
  // multipart/form-data...". Handled here so every upload gets it right by default.
  if (typeof FormData !== "undefined" && config.data instanceof FormData) {
    delete config.headers["Content-Type"];
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) throw new Error("No refresh token");
  const res = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken });
  const { accessToken, refreshToken: newRefresh, user } = res.data;
  useAuthStore.getState().setSession({ accessToken, refreshToken: newRefresh, user });
  return accessToken;
}

api.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => (refreshPromise = null));
        const newToken = await refreshPromise;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        useAuthStore.getState().clear();
      }
    }
    return Promise.reject(error);
  },
);

/** Normalises API error responses into a user-facing message string. */
export function apiError(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (data?.message) {
      return Array.isArray(data.message) ? data.message.join(", ") : data.message;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : fallback;
}
