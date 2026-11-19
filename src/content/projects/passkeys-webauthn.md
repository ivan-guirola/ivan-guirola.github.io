---
title: Passkey demo
summary: Create a passkey and use it to sign in without a password, with your fingerprint, your face or your device PIN.
category: tools
tags: [WebAuthn, FIDO2, Passkeys, TypeScript]
date: 2026-11-16
demo: https://ivan-guirola.github.io/tools/passkeys/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/webauthn
featured: true
---

A passkey replaces the password with your fingerprint, your face or your device PIN. In this demo you can create one, sign in with it and see what is stored where.

- **Create**: your device generates the passkey and keeps the secret part.
- **Sign in**: you confirm on the device and the page checks, step by step, that it is you.
- **Delete**: remove the data from the page whenever you want.

There is no server: everything runs in your browser. The WebAuthn logic is written in TypeScript with no external libraries and covered by automated tests.
