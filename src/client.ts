import type { LeadbayError, LensPayload } from "./types.js";

const LENS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CONCURRENT = 5;

export class LeadbayClient {
  private token: string;
  private baseUrl: string;
  private defaultLensId: number | null = null;
  private defaultLensCachedAt: number | null = null;

  // Simple semaphore for concurrency limiting
  private activeRequests = 0;
  private waitQueue: Array<() => void> = [];

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async acquireSemaphore(): Promise<void> {
    if (this.activeRequests < MAX_CONCURRENT) {
      this.activeRequests++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  private releaseSemaphore(): void {
    this.activeRequests--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.acquireSemaphore();
    try {
      const url = `${this.baseUrl}/1.5${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };
      if (body) {
        headers["Content-Type"] = "application/json";
      }

      const res = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 204) {
        return null as T;
      }

      if (!res.ok) {
        const errorBody = await res.text();
        let parsed: any;
        try {
          parsed = JSON.parse(errorBody);
        } catch {
          parsed = null;
        }

        if (res.status === 401) {
          throw this.makeError(
            "AUTH_EXPIRED",
            "Authentication token expired or invalid",
            "Re-run plugin setup to generate a new token"
          );
        }

        if (res.status === 402 || parsed?.error === "quota_exceeded") {
          throw this.makeError(
            "QUOTA_EXCEEDED",
            "No enrichment credits remaining",
            "Purchase more credits at app.leadbay.ai"
          );
        }

        if (res.status === 403) {
          // Check for billing suspension
          const msg = parsed?.message || parsed?.error || "";
          if (
            typeof msg === "string" &&
            (msg.includes("suspend") || msg.includes("billing"))
          ) {
            throw this.makeError(
              "BILLING_SUSPENDED",
              "Account billing is suspended",
              "Check billing at app.leadbay.ai"
            );
          }
          throw this.makeError(
            "FORBIDDEN",
            "Insufficient permissions",
            "Check your account permissions"
          );
        }

        if (res.status === 404) {
          throw this.makeError(
            "NOT_FOUND",
            parsed?.message || "Resource not found",
            "Verify the ID is correct"
          );
        }

        if (res.status === 429) {
          throw this.makeError(
            "RATE_LIMITED",
            "Too many requests",
            "Wait a moment and try again"
          );
        }

        throw this.makeError(
          "API_ERROR",
          parsed?.message || `API error (${res.status})`,
          "Try again or check the Leadbay API status"
        );
      }

      return (await res.json()) as T;
    } finally {
      this.releaseSemaphore();
    }
  }

  async resolveDefaultLens(): Promise<number> {
    const now = Date.now();
    if (
      this.defaultLensId !== null &&
      this.defaultLensCachedAt !== null &&
      now - this.defaultLensCachedAt < LENS_CACHE_TTL_MS
    ) {
      return this.defaultLensId;
    }

    const lenses = await this.request<LensPayload[]>("GET", "/lenses");

    // Prefer is_last_active (myFirst lens), fall back to default
    const active = lenses.find((l) => l.is_last_active);
    const fallback = active || lenses.find((l) => l.is_default) || lenses[0];

    if (!fallback) {
      throw this.makeError(
        "NO_LENS",
        "No lenses found on your account",
        "Create a lens in the Leadbay app first"
      );
    }

    this.defaultLensId = fallback.id;
    this.defaultLensCachedAt = now;
    return this.defaultLensId;
  }

  makeError(code: string, message: string, hint: string): LeadbayError {
    return { error: true, code, message, hint };
  }
}
