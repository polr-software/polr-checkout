# AGENTS.md

## Project

polr-checkout is a TypeScript-first kit for one-shot payments. It runs inside
the user's app, uses their database, and provides a small typed API to create
an order, redirect the buyer to a payment provider, and react to the resulting
notification.

It is *not* a billing platform. It deliberately has no subscriptions, plans,
metered usage, entitlements, or customer portal. It is a thin, modular layer
between an app (e.g. a pizzeria shop) and a payment provider (e.g. Przelewy24).

Provider-specific details stay behind a typed `PaymentProvider` interface. Each
provider is a separate package.

## Code Style

- Follow the repository's formatter, linter, and TypeScript config.
- Use `import type` for type-only imports.
- Prefer functions and plain objects over classes.
- Keep comments rare and about code logic. No banner/separator comments.
- Prefer single-line code comments; JSDoc is the exception.
- Most user-facing functions in the library core get short JSDoc.
- Follow JSDoc tags (`@param`, `@returns`, `@example`...).

## Behavior

- When asked an opinion question, answer only. Do not edit code unless asked.
- Never commit, push, or run database migrations unless explicitly asked.
- When generating migrations, always provide a name.
- Never edit past migrations; create a new migration instead.
- NEVER publish or release packages without double confirmation.
