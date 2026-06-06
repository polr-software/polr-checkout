import { describe, expect, it, vi } from "vitest";

import type { Przelewy24Client } from "../przelewy24-client";
import { createPrzelewy24Provider } from "../przelewy24-provider";
import { refundNotificationSign } from "../sign";

function createProvider() {
  const client: Przelewy24Client = {
    apiUrl: "https://sandbox.przelewy24.pl/api/v1",
    authHeader: () => "Basic test",
    fetch: vi.fn(),
    trnRequestUrl: (token) => `https://sandbox.przelewy24.pl/trnRequest/${token}`,
  };
  return createPrzelewy24Provider(
    { apiKey: "api-key", crcKey: "crc", merchantId: 123, mode: "sandbox", posId: 123 },
    client,
  );
}

async function signedRefundBody(overrides: Record<string, unknown> = {}): Promise<string> {
  const base = {
    amount: 1000,
    currency: "PLN",
    merchantId: 123,
    orderId: 987,
    refundsUuid: "rfn_1",
    sessionId: "order_1",
    status: 0,
    ...overrides,
  };
  const sign = await refundNotificationSign({
    amount: base.amount as number,
    crcKey: "crc",
    currency: base.currency as string,
    merchantId: base.merchantId as number,
    orderId: base.orderId as number,
    refundsUuid: base.refundsUuid as string,
    sessionId: base.sessionId as string,
    status: base.status as number,
  });
  return JSON.stringify({ ...base, sign });
}

describe("Przelewy24 refund notification", () => {
  it("parses a valid refund notification as a completed refund", async () => {
    const provider = createProvider();
    const body = await signedRefundBody();

    const notification = await provider.parseNotification({ body, headers: {} });

    expect(notification).toMatchObject({
      amount: 1000,
      currency: "PLN",
      kind: "refund",
      orderId: "order_1",
      providerEventId: "refund:rfn_1:0",
      providerTransactionId: "987",
      refundId: "rfn_1",
      status: "completed",
    });
  });

  it("maps status 1 to a rejected refund", async () => {
    const provider = createProvider();
    const body = await signedRefundBody({ status: 1 });

    const notification = await provider.parseNotification({ body, headers: {} });

    expect(notification).toMatchObject({
      kind: "refund",
      providerEventId: "refund:rfn_1:1",
      status: "rejected",
    });
  });

  it("rejects an invalid signature", async () => {
    const provider = createProvider();
    const body = JSON.stringify({
      amount: 1000,
      currency: "PLN",
      merchantId: 123,
      orderId: 987,
      refundsUuid: "rfn_1",
      sessionId: "order_1",
      sign: "deadbeef",
      status: 0,
    });

    await expect(provider.parseNotification({ body, headers: {} })).rejects.toThrow();
  });

  it("rejects a refund from a different merchant", async () => {
    const provider = createProvider();
    const body = await signedRefundBody({ merchantId: 999 });

    await expect(provider.parseNotification({ body, headers: {} })).rejects.toThrow();
  });
});
