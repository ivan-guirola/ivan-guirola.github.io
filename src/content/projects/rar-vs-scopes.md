---
title: Scopes vs RAR for payments
summary: Compare how an app asks a bank for permission to pay, with an OAuth scope, the PSD2 Berlin Group approach and rich authorization requests under FAPI 2.0.
category: tools
tags: [OAuth 2.0, RAR, FAPI 2.0, PSD2, Open banking, TypeScript]
date: 2026-11-20
demo: https://ivan-guirola.github.io/tools/rar-vs-scopes/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/rar
featured: true
---

When an app pays from someone's bank account, the bank has to know exactly what the person agreed to. A plain OAuth scope such as "payments" cannot say how much or to whom, so open banking had to find other ways.

This tool follows one payment of 45.00 EUR through three of them:

- **Scope only**, with the full FAPI 2.0 protection: pushed authorization requests, PKCE and tokens tied to the app's key. The token is safe, but it allows any payment.
- **PSD2 as most European banks do it**, following the Berlin Group standard: the app creates the payment first and the scope points at it.
- **Rich authorization requests** (RFC 9396): the payment travels in the authorization request itself, the person approves exactly that and the token carries it.

For each one you see what the person approves at the bank, every call with its request and response, and the token the app gets. You can then try a different payment of 4,500.00 EUR with the same token and see which approach stops it.

It follows RFC 9396, the FAPI 2.0 Security Profile and the Berlin Group NextGenPSD2 Implementation Guidelines.
