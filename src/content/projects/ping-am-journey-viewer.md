---
title: Ping AM journey viewer
summary: Open a journey exported from Ping AM, see it as a diagram, check it for common mistakes and compare it between two environments.
category: tools
tags: [Ping AM, ForgeRock, Journeys, TypeScript]
date: 2026-11-17
demo: https://ivan-guirola.github.io/tools/journey/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/journey
featured: true
---

In Ping AM, formerly ForgeRock AM, the way people sign in is built as a journey: a chain of steps such as asking for a username, checking a password, sending a one-time code or running a script that decides which way to go. Journeys are exported as JSON files, which are hard to read without opening the admin console.

This tool reads those files.

- **See the journey**: it is drawn as a diagram, in the same layout as in the AM editor. Select a step to see what it does, where each of its outcomes leads and how it is set up, including the code of its scripts.
- **Check it**: it points out steps nobody can reach, outcomes connected to nothing, links to steps that do not exist, journeys that can never succeed and scripts still on the legacy scripting engine.
- **Compare two exports**: open the same journeys from two environments, such as production and development, and see which steps were added, removed or changed, down to each setting and each line of script.

It accepts exports from Frodo, from the platform admin console and from the AM REST API. Everything is read in your browser and nothing is sent anywhere.

The reader, the checks, the layout and the comparison are written in TypeScript with no external libraries, and covered by automated tests. The example journeys are made up for the demo.
