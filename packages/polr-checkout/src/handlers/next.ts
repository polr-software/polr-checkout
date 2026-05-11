import type { PolrInstance } from "../types/instance";

export interface PolrWebhookHandlerOptions {
  /** Mount path for the polr handler. Defaults to `polr.options.basePath ?? "/polr"`. */
  basePath?: string;
  /** Provider id used in the webhook path. Defaults to `polr.options.provider.id`. */
  providerId?: string;
}

export function polrHandler(polr: Pick<PolrInstance, "handler">): {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
} {
  return {
    GET: polr.handler,
    POST: polr.handler,
  };
}

/**
 * Exposes only the provider webhook route for apps that do not need the public
 * order/shipping HTTP API.
 */
export function polrWebhookHandler(
  polr: Pick<PolrInstance, "handler" | "options">,
  options: PolrWebhookHandlerOptions = {},
): {
  GET: () => Response;
  POST: (request: Request) => Promise<Response>;
} {
  const basePath = normalizeBasePath(options.basePath ?? polr.options.basePath ?? "/polr");
  const providerId = options.providerId ?? polr.options.provider.id;
  const webhookPath = `${basePath}/webhook/${providerId}`;

  return {
    GET: () => new Response(null, { headers: { Allow: "POST" }, status: 405 }),
    POST(request) {
      if (new URL(request.url).pathname !== webhookPath) {
        return Promise.resolve(new Response(null, { status: 404 }));
      }

      return polr.handler(request);
    },
  };
}

function normalizeBasePath(value: string): string {
  const path = value.trim() || "/polr";
  const prefixed = path.startsWith("/") ? path : `/${path}`;
  return prefixed.length > 1 ? prefixed.replace(/\/+$/u, "") : prefixed;
}
