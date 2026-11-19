---
title: Token debugger
summary: Paste a JWT or a SAML message and see what it says, who issued it, who it is for and whether it is still valid.
category: tools
tags: [JWT, OIDC, SAML, TypeScript]
date: 2026-11-16
demo: https://ivan-guirola.github.io/tools/debugger/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/debugger
featured: true
---

When a sign-in fails, the answer is usually inside the token or the SAML message, but they arrive encoded and cannot be read at a glance. This tool opens them and explains what they contain.

- **It recognises the format**: a JWT, a SAML message as XML, Base64 or compressed, or the full URL that carries it.
- **It summarises it**: who issued it, who it identifies, which application it is for and when it expires.
- **It shows the full content**, tidy and readable.

Everything is analysed in your browser and nothing is sent anywhere, so you can paste real tokens.
