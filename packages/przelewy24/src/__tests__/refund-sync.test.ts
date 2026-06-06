import { describe, expect, it, vi } from "vitest";

import type { Przelewy24Client } from "../przelewy24-client";
import { createPrzelewy24Provider } from "../przelewy24-provider";

function createProvider(response: unknown) {
  const client: Przelewy24Client = {
    apiUrl: "https://sandbox.przelewy24.pl/api/v1",
    authHeader: () => "Basic test",
    fetch: vi.fn().mockResolvedValue(response),
    trnRequestUrl: (token) => `https://sandbox.przelewy24.pl/trnRequest/${token}`,
  };
  const provider = createPrzelewy24Provider(
    { apiKey: "api-key", crcKey: "crc", merchantId: 123, mode: "sandbox", posId: 123 },
    client,
  );
  return { client, provider };
}

function infoResponse(status: number) {
  return {
    data: {
      amount: 1000,
      currency: "PLN",
      orderId: 987,
      refunds: [{ amount: 1000, requestId: "rfn_1", status }],
      sessionId: "order_1",
    },
    responseCode: 0,
  };
}

const input = { orderId: "order_1", providerTransactionId: "987", refundId: "rfn_1" };

describe("Przelewy24 syncRefund", () => {
  it("maps status 1 to completed", async () => {
    const { client, provider } = createProvider(infoResponse(1));

    const result = await provider.syncRefund?.(input);

    expect(client.fetch).toHaveBeenCalledWith("/refund/by/orderId/987", { notFoundOk: true });
    expect(result).toMatchObject({ amount: 1000, status: "completed" });
  });

  it("maps status 4 to rejected", async () => {
    const { provider } = createProvider(infoResponse(4));

    await expect(provider.syncRefund?.(input)).resolves.toMatchObject({ status: "rejected" });
  });

  it("keeps statuses 2 and 3 pending", async () => {
    const { provider } = createProvider(infoResponse(2));
    await expect(provider.syncRefund?.(input)).resolves.toMatchObject({ status: "pending" });

    const { provider: awaiting } = createProvider(infoResponse(3));
    await expect(awaiting.syncRefund?.(input)).resolves.toMatchObject({ status: "pending" });
  });

  it("returns unknown when no matching refund is found", async () => {
    const { provider } = createProvider(null);

    await expect(provider.syncRefund?.(input)).resolves.toEqual({ status: "unknown" });
  });
});
