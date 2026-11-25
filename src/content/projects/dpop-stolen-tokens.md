---
title: Stolen tokens and DPoP
summary: Most access tokens work like cash, and whoever copies one can use it. See an attacker try, and how DPoP ties the token to a key that never leaves the app.
category: oauth
tags: [OAuth 2.0, DPoP, FAPI 2.0, JWT, TypeScript]
date: 2026-11-25
demo: https://ivan-guirola.github.io/tools/dpop/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/dpop
featured: true
---

An ordinary access token is a bearer token: the API accepts it from whoever sends it. If it leaks, through a log file, a proxy or a browser extension, someone else can use it until it expires.

DPoP (RFC 9449) ties the token to a key pair the app creates and never lets go of. The token carries the thumbprint of the public key, and every call has to come with a short proof signed by the private key for that exact request.

The tool runs the whole thing in the browser with real keys and signatures:

- **The app** signs in, gets a token and reads Laura's accounts.
- **An attacker** who copied the token and saw the app's last request tries to use them: the token on its own, a proof signed with its own key, the same request again, and the app's proof on a transfer.
- **The API** shows, check by check, why it accepts or rejects each call: the key the token is tied to, the method and address in the proof, the hash of the token, the age of the proof and whether it was used before.

Switch to a bearer token to see the same attacks succeed.
