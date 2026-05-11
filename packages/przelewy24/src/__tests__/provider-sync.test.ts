import { describe, expect, it, vi } from "vitest";

import type { Przelewy24Client } from "../przelewy24-client";
import { createPrzelewy24Provider } from "../przelewy24-provider";

function createProviderWithResponse(response: unknown) {
  const client: Przelewy24Client = {
    apiUrl: "https://sandbox.przelewy24.pl/api/v1",
    authHeader: () => "Basic test",
    fetch: vi.fn().mockResolvedValue(response),
    trnRequestUrl: (token) => `https://sandbox.przelewy24.pl/trnRequest/${token}`,
  };
  const provider = createPrzelewy24Provider(
    {
      apiKey: "api-key",
      crcKey: "crc",
      merchantId: 123,
      mode: "sandbox",
      posId: 123,
    },
    client,
  );

  return { client, provider };
}

function createTransaction(status: 0 | 1 | 2 | 3) {
  return {
    data: {
      amount: 1000,
      currency: "PLN",
      orderId: 987,
      paymentMethod: 25,
      sessionId: "order_1",
      status,
    },
    responseCode: 0,
  };
}

describe("Przelewy24 syncTransaction", () => {
  it("maps paid transaction status to paid provider sync state", async () => {
    const { client, provider } = createProviderWithResponse(createTransaction(2));

    const result = await provider.syncTransaction?.({
      amount: 1000,
      currency: "PLN",
      orderId: "order_1",
    });

    expect(client.fetch).toHaveBeenCalledWith("/transaction/by/sessionId/order_1", {
      notFoundOk: true,
    });
    expect(result).toEqual({
      amount: 1000,
      currency: "PLN",
      providerData: {
        lastStatusCheck: createTransaction(2).data,
        providerMethodId: 25,
      },
      providerTransactionId: "987",
      status: "paid",
    });
  });

  it("keeps advance payments pending", async () => {
    const { provider } = createProviderWithResponse(createTransaction(1));

    await expect(
      provider.syncTransaction?.({
        amount: 1000,
        currency: "PLN",
        orderId: "order_1",
      }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("keeps no-payment status pending unless closeIfUnpaid is set", async () => {
    const { provider } = createProviderWithResponse(createTransaction(0));

    await expect(
      provider.syncTransaction?.({
        amount: 1000,
        currency: "PLN",
        orderId: "order_1",
      }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("maps no-payment status to failed when closeIfUnpaid is set", async () => {
    const { provider } = createProviderWithResponse(createTransaction(0));

    await expect(
      provider.syncTransaction?.({
        amount: 1000,
        closeIfUnpaid: true,
        currency: "PLN",
        orderId: "order_1",
      }),
    ).resolves.toMatchObject({
      error: "Przelewy24 reported no payment",
      providerTransactionId: "987",
      status: "failed",
    });
  });

  it("maps returned payment status to failed", async () => {
    const { provider } = createProviderWithResponse(createTransaction(3));

    await expect(
      provider.syncTransaction?.({
        amount: 1000,
        currency: "PLN",
        orderId: "order_1",
      }),
    ).resolves.toMatchObject({
      error: "Przelewy24 reported returned payment",
      providerTransactionId: "987",
      status: "failed",
    });
  });

  it("keeps missing remote transactions pending", async () => {
    const { provider } = createProviderWithResponse(null);

    await expect(
      provider.syncTransaction?.({
        amount: 1000,
        currency: "PLN",
        orderId: "order_1",
      }),
    ).resolves.toEqual({ status: "pending" });
  });
});
