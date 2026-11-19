---
title: Keycloak SPI template
summary: A small, working Keycloak extension to start from, with one provider, its tests and a CI build.
category: keycloak
tags: [Keycloak, Java, SPI, Maven]
date: 2026-11-16
repo: https://github.com/ivan-guirola/keycloak-spi-template
---

Keycloak can be extended with your own code when the product does not cover a requirement. Getting the first extension to load is the slow part: the right dependencies, the registration file, the configuration and a way to test it without starting a server.

This repository is that starting point, already working.

- **A complete example**: an event listener that writes one line per sign-in to the log.
- **Tests without a server**: the provider receives what it needs, so it can be tested on its own.
- **Configuration done properly**: read once at startup, validated and documented.
- **CI included**: every push builds and tests the extension.

It is a GitHub template: create your own repository from it and replace the example with your provider. Checked against a real Keycloak 26.6 server.
