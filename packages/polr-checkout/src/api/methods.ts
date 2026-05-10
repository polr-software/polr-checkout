import { createRouter } from "better-call";

import type { PolrContext } from "../core/context";
import { cancelOrder, getOrder, resolveShipping } from "../order/order.api";
import { receiveWebhook } from "../webhook/webhook.api";

export const methods = {
  getOrder,
  cancelOrder,
  resolveShipping,
  handleWebhook: receiveWebhook,
} as const;

type MethodMap = typeof methods;

function getRouteEndpoints(source: MethodMap) {
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, method]) =>
      method.endpoint ? [[key, method.endpoint]] : [],
    ),
  );
}

function normalizePolrRequest(request: Request, ctx: Pick<PolrContext, "basePath">): Request {
  const { basePath } = ctx;
  const url = new URL(request.url);

  if (url.pathname === `${basePath}/api` || url.pathname.startsWith(`${basePath}/api/`)) {
    const stripped = url.pathname.slice(`${basePath}/api`.length);
    url.pathname = `${basePath}${stripped}`;
    return new Request(url, request);
  }
  return request;
}

export function createPolrRouter(ctx: PolrContext): {
  handler: (request: Request) => Promise<Response>;
} {
  const router = createRouter(
    getRouteEndpoints(methods) as unknown as Parameters<typeof createRouter>[0],
    {
      basePath: ctx.basePath,
      onRequest(request) {
        return normalizePolrRequest(request, ctx);
      },
      routerContext: ctx,
      onError(error: unknown) {
        ctx.logger.error({ err: error }, "API error");
      },
    },
  );

  return {
    handler: (request: Request) => router.handler(request) as Promise<Response>,
  };
}
