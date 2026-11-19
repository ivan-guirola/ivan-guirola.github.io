---
title: SCIM lifecycle viewer
summary: See the SCIM calls Microsoft Entra ID and Okta send to an application when someone joins, changes department, leaves or comes back.
category: tools
tags: [SCIM, Microsoft Entra ID, Okta, Provisioning, TypeScript]
date: 2026-11-19
demo: https://ivan-guirola.github.io/tools/scim-lifecycle/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/scim
featured: true
---

When someone joins a company, changes role or leaves, every application they use has to find out. Most identity providers tell them through SCIM, a standard way of creating, updating and disabling accounts. The standard leaves room for interpretation, and Microsoft Entra ID and Okta do the same job in different ways.

This tool shows those differences, one event at a time.

- **Pick a provider and an event**: joining, a change of department, joining a group, leaving, coming back or being deleted.
- **See every call in order**, with what it does in plain words, the exact request and the answer the application gives.
- **See the account in the application** before and after, with the lines that change highlighted.
- **Read what to watch out for**: Entra works in cycles of about 40 minutes and sends only what changed, while Okta sends each change as it happens and replaces the whole account; Entra deletes accounts after 30 days, while Okta never does.

It follows the Entra ID and Okta documentation for SCIM 2.0 with their default attribute mappings. A real connection can send more or less, depending on how it is set up.
