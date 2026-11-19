---
title: Saviynt username rule builder
summary: Build a Saviynt username rule from attributes, conditions and clean-up steps, get its SQL, and see the name each person would get.
category: tools
tags: [Saviynt, IGA, SQL, TypeScript]
date: 2026-11-17
demo: https://ivan-guirola.github.io/tools/saviynt-username/
repo: https://github.com/ivan-guirola/ivan-guirola.github.io/tree/main/src/lib/saviynt
featured: true
---

When Saviynt creates a person or an account, it builds the username from their data. Instead of a simple pattern, it takes a SQL expression that runs on its database, with # between the options it tries one after the other when a name is already taken or comes out empty.

A real naming convention, such as a prefix for external staff, the initials of a compound first name and a limit of twelve characters, quickly turns into hundreds of lines of nested CASE, CONCAT and SUBSTRING. They are hard to write, hard to review and the only way to test them is to create users and look.

This tool does both halves of the job.

- **Build the rule** by putting the username together: attributes, or a part of them such as the first word or the first letters, fixed texts like a prefix, and conditions such as the type of employee. Lower case, accents, spaces, symbols and the maximum length are tick boxes. The SQL for Saviynt is written for you.
- **Test any rule**, built here or pasted from Saviynt, on a list of sample people: see each username, the option that produced it, and the ones skipped because the name was taken, empty or NULL.
- **Find the problems** before they reach a directory: empty results and why, names that are too long, capital letters, accents and other characters that are not allowed, and the MySQL details that break these rules, such as CONCAT with a NULL or LENGTH counting bytes instead of letters.

The SQL is read by an interpreter written from scratch in TypeScript that imitates the MySQL functions most used in these rules, including `POSITION(… IN …)`, and it is covered by automated tests. Saviynt runs the real rule on its own database, so the final rule should be checked there.
