import { describe, expect, it, vi } from "vitest";

import { polrWebhookHandler } from "../handlers/next";
import type { PolrInstance } from "../types/instance";

function createPolr(handler: (request: Request) => Promise<Response>) {
  return {
    handler,
    options: {
      basePath: "/polr",
      provider: {
        id: "przelewy24",
      },
    },
  } as unknown as Pick<PolrInstance, "handler" | "options">;
}

describe("polrWebhookHandler", () => {
  it("passes the configured webhook route to the polr handler", async () => {
    const response = Response.json({ received: true });
    const handler = vi.fn(async () => response);
    const { POST } = polrWebhookHandler(createPolr(handler));
    const request = new Request("https://example.com/polr/webhook/przelewy24", {
      method: "POST",
    });

    await expect(POST(request)).resolves.toBe(response);
    expect(handler).toHaveBeenCalledWith(request);
  });

  it("returns 404 for other POST routes", async () => {
    const handler = vi.fn(async () => new Response(null));
    const { POST } = polrWebhookHandler(createPolr(handler));
    const response = await POST(
      new Request("https://example.com/polr/orders/order-1/cancel", { method: "POST" }),
    );

    expect(response.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });

  it("returns 405 for GET requests", () => {
    const handler = vi.fn(async () => new Response(null));
    const { GET } = polrWebhookHandler(createPolr(handler));
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(handler).not.toHaveBeenCalled();
  });
});
