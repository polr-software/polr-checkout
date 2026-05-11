# polr-checkout

One-shot payments kit for TypeScript apps. Modular providers, runs inside your
app, uses your database. No subscriptions, no metering — just create an order,
collect the money, react to the result.

```ts
import { przelewy24 } from "@polr-software/przelewy24";
import { createCheckout, zoneShipping } from "@polr-software/checkout";
import { neonHttpDatabase } from "@polr-software/checkout/database/neon-http";

export const checkout = createCheckout({
  database: neonHttpDatabase(process.env.DATABASE_URL!),
  provider: przelewy24({
    merchantId: Number(process.env.PRZELEWY24_MERCHANT_ID!),
    posId: Number(process.env.PRZELEWY24_POS_ID!),
    crcKey: process.env.PRZELEWY24_CRC_KEY!,
    apiKey: process.env.PRZELEWY24_API_KEY!,
    mode: "sandbox",
  }),
  currency: "PLN",
  shipping: zoneShipping({
    zones: [
      { id: 1, name: "Strefa 1", amount: 500, geometry: zone1 },
      { id: 2, name: "Strefa 2", amount: 1000, geometry: zone2 },
    ],
    onOutOfZone: "reject",
  }),
  hooks: {
    orderPaid: async ({ order }) => {
      // notify your POS, send a receipt, fulfill the order
    },
  },
  events: {
    "order.paid": async ({ payload }) => {
      // analytics / logging only
    },
  },
});
```

In a Next.js app:

```ts
// app/polr/[...path]/route.ts
import { polrWebhookHandler } from "@polr-software/checkout/handlers/next";
import { checkout } from "@/lib/checkout";

export const { GET, POST } = polrWebhookHandler(checkout);
```

Use `polrHandler(checkout)` only when your app intentionally exposes the
order/shipping HTTP API. For a typical server-side integration, expose only the
webhook route and call `checkout.createOrder`, `checkout.syncOrder`, and other
methods from your server code.

After the buyer returns from the hosted payment page, you can reconcile the
local order with the payment provider:

```ts
const order = await checkout.syncOrder({
  id: orderId,
  closeIfUnpaid: true,
});
```

`syncOrder` is intentionally separate from `getOrder`, because it can update the
local order. For Przelewy24 this matters because `urlStatus` notifications are
sent only for correct payments. A failed or abandoned transaction may never hit
your webhook, so the provider adapter checks `transaction/by/sessionId`.

Status: alpha. v1 supports Przelewy24 only. Refunds and additional providers
land in a later iteration.

## Packages

- `@polr-software/checkout` — framework core
- `@polr-software/przelewy24` — Przelewy24 provider adapter

## License

MIT.
