---
title: Keycloak CSV claim mapper
summary: A Keycloak extension that turns a value such as "1,2,3", from an OIDC claim or a SAML attribute, into separate values.
category: keycloak
tags: [Keycloak, Java, SPI, OIDC, SAML, Federation]
date: 2026-11-16
repo: https://github.com/ivan-guirola/keycloak-csv-claim-mapper
---

When Keycloak signs users in through another identity provider, it copies data from the token or assertion that provider sends. Some providers send a list as a single piece of text, such as `"1, 2,3"`, and Keycloak stores it as one value. Anything that later needs the individual items has to split the text itself.

This extension does the split once, at sign-in.

- **One value per item**: `"1, 2,3"` is stored as `1`, `2` and `3`.
- **Any separator**: a comma by default, or whatever the provider uses.
- **Clean values**: spaces, empty items and repeated items are removed.
- **Kept in sync**: the attribute can be refreshed on every sign-in and is removed when the provider stops sending it.

The same mapper works with OpenID Connect and SAML identity providers: it reads the claim from the token or the attribute from the assertion. The user attribute that receives the values has to be declared as multivalued in the realm user profile.

It is added from the admin console like any built-in mapper. Built from my [Keycloak SPI template](/projects/keycloak-spi-template/) and checked on a real Keycloak 26.6 server with federated realms over both protocols.
