---
title: Ping AM script migration
summary: Convert a legacy Scripted Decision node script to the next-generation engine, see every change explained and run both versions to check they behave the same.
category: tools
tags: [Ping AM, ForgeRock, Journeys, JavaScript, TypeScript]
date: 2026-11-20
demo: https://ivan-guirola.github.io/tools/am-script-migration/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/amscript
featured: true
---

Journeys in Ping AM, formerly ForgeRock AM, often include scripts that decide which way the user goes. Many of them were written for the legacy scripting engine, and they do not run on the next-generation engine as they are: the Action class, sharedState, the way callbacks are sent and read, the HTTP client and the profile methods all changed.

This tool helps move them.

- **Convert the script**: paste a legacy script and get the next-generation version, following Ping's migration guide. The script is read as code, not with search and replace, so the HTTP request built over several lines becomes one set of options and each answer is read from the right list of callbacks.
- **Every change explained**: each kind of change says what it replaces and why, with the lines it affects.
- **Nothing guessed**: what can't be converted safely, such as Java classes with no equivalent binding, is listed for review instead.
- **Run both versions**: the legacy and the converted script run side by side with the same journey state, user profile and request. When the node asks the user for input, answer the form and both continue. The tool then says whether they did the same thing: outcome, state, profile changes, calls to other services and log.

Both engines are simulated in the browser with the bindings each one offers, and each script runs in its own isolated worker. The converter and the simulation are written in TypeScript and covered by automated tests, including a check that every example behaves the same before and after conversion.
