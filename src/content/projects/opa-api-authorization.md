---
title: API authorization with OPA
summary: An expenses API asks Open Policy Agent who can read and approve each expense. The real Rego policy runs in the browser and explains every decision.
category: tools
tags: [OPA, Rego, Authorization, WebAssembly, TypeScript]
date: 2026-11-20
demo: https://ivan-guirola.github.io/tools/opa/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/opa
featured: true
---

Many APIs check permissions with a few lines of code scattered around the application. Open Policy Agent (OPA) moves those rules out: the API sends OPA who is calling and what they want to do, and OPA answers with a decision. The rules live in one place, written in a language called Rego, and can be tested and changed without touching the API.

This tool shows it with an expenses API used by an analyst, a manager, a finance controller and a reporting service.

- **The real policy, in the browser**: the Rego policy is compiled to WebAssembly with OPA and evaluated with the official library, in a fraction of a millisecond.
- **Every decision explained**: which rules allow the request, which ones block it, and the lines of the policy behind each of them.
- **Rules that read like the business**: nobody approves their own expense, managers approve up to a limit, larger amounts need Finance and a sign-in with MFA, and applications can read but never approve.
- **Data apart from the rules**: change the limits and every decision updates, without changing the policy.
- **Everyone at once**: a table with the decision for every person and expense.

The policy has its own tests, run with opa test, and the compiled version is tested again from TypeScript.
