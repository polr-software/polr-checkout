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
    // posId defaults to merchantId; set only if your POS id differs.
    crcKey: process.env.PRZELEWY24_CRC_KEY!,
    apiKey: process.env.PRZELEWY24_API_KEY!,
    // mode defaults to "live"; set "sandbox" for testing.
    mode: "sandbox",
  }),
  // Public origin of your app. Lets polr build an absolute webhook (statusUrl)
  // and resolve relative returnUrls — required by Przelewy24.
  appUrl: process.env.APP_URL!,
  // Default return URL; supports the {ORDER_ID} placeholder. May be relative
  // when appUrl is set. Override per order via createOrder({ returnUrl }).
  returnUrl: "/checkout/success?token={ORDER_ID}",
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

## Refunds

Refund a paid order in full or in part. Each refund is stored as its own row
(`polr_refund`), so one order can have several partial refunds.

```ts
// Full refund of the remaining balance:
const { refundId, status } = await checkout.refundOrder({ id: orderId });

// Partial refund (minor units), with a reason shown on the transfer:
await checkout.refundOrder({
  id: orderId,
  amount: 500,
  reason: "Out of stock: 1 item",
});
```

Refunds are asynchronous. `refundOrder` returns `status: "pending"` once the
provider accepts the request — the money has not moved yet. The final state
arrives as a provider notification on the same webhook route, which polr verifies
and applies:

- the refund row becomes `completed` or `rejected`
- on `completed`, the order's `refundedAmount` grows and its status moves to
  `partially_refunded`, then `refunded` once the full amount is returned

React to refunds with events (analytics/logging) or the blocking `orderRefunded`
hook (fired only on a full refund):

```ts
createCheckout({
  // ...
  hooks: {
    orderRefunded: async ({ order, refund }) => {
      // restock, issue a credit note
    },
  },
  events: {
    "refund.completed": async ({ payload }) => {
      // payload.order, payload.refund
    },
  },
});
```

If the async notification never arrives, reconcile a pending refund with the
provider, and list an order's refunds:

```ts
const refund = await checkout.syncRefund({ id: orderId, refundId });
const { refunds } = await checkout.listRefunds({ orderId });
```

For Przelewy24, the refund API must be enabled on your merchant account (contact
your account manager). Refunds are paid from your Przelewy24 balance, so a refund
can be rejected for insufficient funds.

Status: alpha. Currently supports Przelewy24 only — including full and partial
refunds. Additional providers land in a later iteration.

## Packages

- `@polr-software/checkout` — framework core
- `@polr-software/przelewy24` — Przelewy24 provider adapter

## License

MIT.
