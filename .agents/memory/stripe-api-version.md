---
name: Stripe API version
description: The correct Stripe apiVersion string for stripe npm v17
---

## Rule
Stripe npm package v17.x requires apiVersion `"2025-02-24.acacia"`.

**Why:** TypeScript types are strict about the apiVersion string. Using a version string not in the type union (like "2025-04-30.basil") causes TS2322. The installed v17 types only allow "2025-02-24.acacia".

**How to apply:** When constructing Stripe client:
```ts
new Stripe(key, { apiVersion: "2025-02-24.acacia" })
```
