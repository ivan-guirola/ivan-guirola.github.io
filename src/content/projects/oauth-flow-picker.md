---
title: OAuth flow picker
summary: Answer a few questions about the application you want to connect and see which OAuth flow fits it and how to set it up.
category: tools
tags: [OAuth 2.0, OIDC, PKCE, TypeScript]
date: 2026-11-17
demo: https://ivan-guirola.github.io/tools/oauth-flow/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/oauth
featured: true
---

OAuth offers several ways of signing in, and choosing the wrong one for an application is one of the most common mistakes when connecting it to an identity provider.

This tool asks a few plain questions and answers with the flow that applies.

- **The questions**: who signs in, what kind of application it is, where it runs and how sensitive the data is.
- **The answer**: the flow, explained step by step in plain language.
- **How to set it up**: the kind of client to register, how it should prove its identity and which protections to add.
- **What to avoid**: the older flows that are no longer recommended, and why.

The rules follow the current OAuth security best practice (RFC 9700) and the OAuth 2.1 draft. They are written as a small TypeScript module covered by automated tests.
