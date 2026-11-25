---
title: Exact permissions with RAR
summary: An app asks for permission to pay 45 EUR, and an AI agent asks to book one flight. Compare a plain OAuth scope with rich authorization requests and see what the token allows.
category: tools
tags: [OAuth 2.0, RAR, FAPI 2.0, AI agents, TypeScript]
date: 2026-11-25
demo: https://ivan-guirola.github.io/tools/rar/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/rar
featured: true
---

When an app asks for permission with a scope such as "payments", the token it gets allows any payment. Rich authorization requests (RFC 9396) let the app ask for exactly what it needs, the person approve exactly that, and the API check every call against it.

The tool runs the whole flow in the browser, with real keys and signatures, in two situations:

- **A shop asks to be paid**: 45.00 EUR to Example Store, once.
- **An AI agent books a flight**: Madrid to Lisbon this Friday, economy, for less than 300 EUR. The agent can do what was approved and nothing else.

For each one you can ask with a scope or with a rich authorization request, see what the person approves, and read every call: the pushed authorization request, the token exchange and the access token itself. Then the app tries other things with the same token, such as ten times the amount, another payee, business class or a hotel, and the API shows field by field what it checked.

The flow follows the FAPI 2.0 Security Profile: pushed authorization requests, PKCE and private_key_jwt client authentication.
