---
title: Verifiable credentials with SD-JWT
summary: Get a digital card from an issuer, keep it in a wallet and show a verifier only the one fact it needs.
category: decentralized
tags: [OpenID4VCI, OpenID4VP, SD-JWT, Verifiable Credentials, TypeScript]
date: 2026-11-16
demo: https://ivan-guirola.github.io/openid4vc-demo/
repo: https://github.com/ivan-guirola/openid4vc-demo
featured: true
---

A verifiable credential is a digital document that you hold yourself, in a wallet, and that anyone can check without calling whoever issued it. It is the model behind the European digital identity wallet.

In this demo a city hall issues a resident card and a cinema needs to know that you are an adult. You decide what the cinema sees.

- **The card is yours**: it is issued once and stays in your wallet.
- **You share one fact, not the whole card**: the cinema learns "over 18" and never sees your name or your date of birth.
- **It can be checked**: the cinema confirms that the city hall signed that fact and that the answer comes from your wallet.
- **Nothing hidden**: the page shows every message the three parties exchange, and the SD-JWT the cinema received, split into its parts.

Behind the page there is a small issuer, wallet and verifier written in TypeScript, following OpenID for Verifiable Credential Issuance, OpenID for Verifiable Presentations and SD-JWT. The same code runs in your browser and over HTTP.
