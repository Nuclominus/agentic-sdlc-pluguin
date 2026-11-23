---
adr: 0001
status: accepted
date: 2026-01-12
---

# ADR-0001: Payments go through a queue

## Context

Checkout used to call the payment provider directly. When the provider was slow or down,
customers could not finish an order.

## Decision

Checkout enqueues a payment request and returns immediately. A background worker charges the
provider and retries on failure, so a provider outage never blocks checkout.

## Consequences

- Checkout stays available during provider outages.
- A payment is confirmed asynchronously, so the order shows "pending" until the worker succeeds.
- Failed charges are retried a bounded number of times, then surfaced for manual follow-up.
