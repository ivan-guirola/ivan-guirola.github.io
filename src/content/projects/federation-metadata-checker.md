---
title: Federation metadata checker
summary: Paste SAML metadata or an OpenID Connect discovery document and see its addresses, its keys and when its certificates expire.
category: tools
tags: [SAML, OIDC, X.509, Federation, TypeScript]
date: 2026-11-17
demo: https://ivan-guirola.github.io/tools/metadata/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/metadata
featured: true
---

Before an application and an identity provider can trust each other, they exchange a small file: SAML metadata, or a discovery document in OpenID Connect. It says where to send people to sign in and which keys to trust. When a certificate inside it expires, sign-in stops working for everyone at once.

This tool reads that file and shows what matters.

- **What it is**: an identity provider or an application, and how it identifies itself.
- **Where it sends people**: the sign-in, sign-out and response addresses.
- **Its keys and certificates**: what each one is used for and when it expires, with a warning for the ones that have expired or are about to.
- **What it supports**: sign-in methods, signature algorithms and other options.

Paste the file, or give the address of an OpenID Connect provider and the tool reads its published keys too. What you paste is analysed in your browser and sent nowhere.

The certificate reader is written from scratch in TypeScript, with no external libraries, and covered by automated tests.
