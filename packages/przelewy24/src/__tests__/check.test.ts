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

describe("Przelewy24 check", () => {
  it("returns ok when /testAccess responds with data:true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ data: true, error: "" });
    const { client, provider } = createProvider(fetchImpl);

    await expect(provider.check?.()).resolves.toEqual({ mode: "sandbox", ok: true });
    expect(client.fetch).toHaveBeenCalledWith("/testAccess", { skipResponseCode: true });
  });

  it("returns not ok when the provider rejects the credentials", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("HTTP 401 Incorrect authentication"));
    const { provider } = createProvider(fetchImpl);

    await expect(provider.check?.()).resolves.toMatchObject({ mode: "sandbox", ok: false });
  });

  it("returns not ok when /testAccess does not report data:true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ data: false });
    const { provider } = createProvider(fetchImpl);

    await expect(provider.check?.()).resolves.toMatchObject({ mode: "sandbox", ok: false });
  });
});
