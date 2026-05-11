import { POLR_ERROR_CODES, PolrError } from "@polr-software/checkout";

export type Przelewy24Mode = "sandbox" | "live";

export interface Przelewy24ClientOptions {
  posId: number;
  apiKey: string;
  mode: Przelewy24Mode;
  /** Override base URL (mainly for tests). */
  apiUrl?: string;
}

export interface Przelewy24Client {
  apiUrl: string;
  trnRequestUrl: (token: string) => string;
  authHeader: () => string;
  fetch: <TResponse>(
    path: string,
    init?: { method?: "GET" | "POST" | "PUT"; body?: unknown },
  ) => Promise<TResponse>;
}

const SANDBOX_BASE = "https://sandbox.przelewy24.pl";
const LIVE_BASE = "https://secure.przelewy24.pl";

function modeBase(mode: Przelewy24Mode): string {
  return mode === "sandbox" ? SANDBOX_BASE : LIVE_BASE;
}

interface Przelewy24ApiError {
  responseCode?: number;
  error?: string;
  code?: number;
  data?: unknown;
}

function base64Encode(value: string): string {
  if (typeof btoa !== "function") {
    throw new Error("btoa is not available in this runtime");
  }

  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function createPrzelewy24Client(options: Przelewy24ClientOptions): Przelewy24Client {
  const base = options.apiUrl?.replace(/\/+$/, "") ?? `${modeBase(options.mode)}/api/v1`;
  const trnBase = options.apiUrl
    ? new URL("/trnRequest", options.apiUrl).toString().replace(/\/+$/, "")
    : `${modeBase(options.mode)}/trnRequest`;

  const auth = `Basic ${base64Encode(`${options.posId}:${options.apiKey}`)}`;

  return {
    apiUrl: base,
    authHeader: () => auth,
    trnRequestUrl: (token) => `${trnBase}/${encodeURIComponent(token)}`,
    async fetch<TResponse>(
      path: string,
      init: { method?: "GET" | "POST" | "PUT"; body?: unknown } = {},
    ): Promise<TResponse> {
      const response = await fetch(`${base}${path}`, {
        method: init.method ?? "GET",
        headers: {
          Authorization: auth,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
      });

      const text = await response.text();
      let data: unknown;
      try {
        data = text.length > 0 ? JSON.parse(text) : null;
      } catch {
        throw PolrError.from(
          "BAD_GATEWAY",
          POLR_ERROR_CODES.PROVIDER_TRANSACTION_FAILED,
          `Przelewy24 returned non-JSON response (${response.status}): ${text.slice(0, 256)}`,
        );
      }

      if (!response.ok || (data as Przelewy24ApiError | null)?.responseCode !== 0) {
        throw PolrError.from(
          "BAD_GATEWAY",
          POLR_ERROR_CODES.PROVIDER_TRANSACTION_FAILED,
          `Przelewy24 ${path} failed: HTTP ${response.status} ${JSON.stringify(data)}`,
        );
      }

      return data as TResponse;
    },
  };
}
