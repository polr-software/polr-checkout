import type { PolrInstance } from "../types/instance";

export function polrHandler(polr: Pick<PolrInstance, "handler">): {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
} {
  return {
    GET: polr.handler,
    POST: polr.handler,
  };
}
