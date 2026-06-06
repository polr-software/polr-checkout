import { describe, expect, it, vi } from "vitest";

import type { Przelewy24Client } from "../przelewy24-client";
import { createPrzelewy24Provider } from "../przelewy24-provider";

function createProvider(fetchImpl: Przelewy24Client["fetch"]) {
  const client: Przelewy24Client = {
    apiUrl: "https://sandbox.przelewy24.pl/api/v1",
    authHeader: () => "Basic test",
    fetch: fetchImpl,
    trnRequestUrl: (token) => `https://sandbox.przelewy24.pl/trnRequest/${token}`,
  };
  const provider = createPrzelewy24Provider(
    { apiKey: "api-key", crcKey: "crc", merchantId: 123, mode: "sandbox", posId: 123 },
    client,
  );
  return { client, provider };
}

describe("Przelewy24 refund", () => {
  it("posts a refund request with refundsUuid and returns pending", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      data: [
        { amount: 1000, message: "success", orderId: 987, sessionId: "order_1", status: true },
      ],
      responseCode: 0,
    });
    const { provider } = createProvider(fetchImpl);

    const result = await provider.refund!({
      amount: 1000,
      currency: "PLN",
      orderId: "order_1",
      providerTransactionId: "987",
      reason: "customer request",
      refundId: "rfn_1",
      statusUrl: "https://shop.example.com/polr/webhook/przelewy24",
    });

    expect(fetchImpl).toHaveBeenCalledWith("/transaction/refund", {
      body: {
        refunds: [
          { amount: 1000, description: "customer request", orderId: 987, sessionId: "order_1" },
        ],
        refundsUuid: "rfn_1",
        requestId: "rfn_1",
        urlStatus: "https://shop.example.com/polr/webhook/przelewy24",
      },
      method: "POST",
    });
    expect(result).toMatchObject({ refundId: "rfn_1", status: "pending" });
  });

  it("throws when the refund item was not accepted", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      data: [
        {
          amount: 999999,
          message: "The amount of refund exceeds available amount for the transaction",
          orderId: 987,
          sessionId: "order_1",
          status: false,
        },
      ],
      responseCode: 0,
    });
    const { provider } = createProvider(fetchImpl);

    await expect(
      provider.refund!({
        amount: 999999,
        currency: "PLN",
        orderId: "order_1",
        providerTransactionId: "987",
        refundId: "rfn_1",
      }),
    ).rejects.toThrow("exceeds available");
  });

  it("rejects a non-numeric provider transaction id", async () => {
    const { provider } = createProvider(vi.fn());

    await expect(
      provider.refund!({
        amount: 100,
        currency: "PLN",
        orderId: "order_1",
        providerTransactionId: "not-a-number",
        refundId: "rfn_1",
      }),
    ).rejects.toThrow();
  });
});
