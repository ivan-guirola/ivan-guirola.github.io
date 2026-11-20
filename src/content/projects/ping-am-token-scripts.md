---
title: Ping AM access token scripts
summary: Write an access token modification script and see the token it produces, what the client gets back and what introspection shows, on either scripting engine.
category: tools
tags: [Ping AM, ForgeRock, OAuth 2.0, JWT, TypeScript]
date: 2026-11-20
demo: https://ivan-guirola.github.io/tools/am-token-scripts/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/amscript
featured: true
---

Ping AM, formerly ForgeRock AM, can run a script just before it issues an OAuth 2.0 access token, to add data from the user profile or another service, shorten its lifetime or return extra values to the client. In AM, the only way to see the result is to run a full OAuth flow and decode the token.

This tool shows it as you write.

- **The token as an API sees it**: the signed JWT and its claims, with what the script added, changed or removed highlighted, and its size, since tokens travel in HTTP headers.
- **The response and introspection**: values added with addExtraData() go next to the token, not inside it; fields set with setField() also appear when the token is introspected.
- **Different requests**: a user signing in, an application with no user, or a JWT for a subject AM does not know, where scripts that assume a user profile fail.
- **Both engines**: run the script on the legacy or the next-generation engine, and convert a legacy script with one click to see what changes.

The script runs in an isolated worker in your browser, with the bindings AM provides. The simulation is written in TypeScript and covered by automated tests.
