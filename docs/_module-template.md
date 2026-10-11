---
title: <Module> Architecture
type: explanation
status: draft
owner: zoyoong124@gmail.com
last-updated: YYYY-MM-DD
audience: internal
---

# <Module> Architecture

> One line: what `src/<module>/` owns, what it only mirrors, and who should read this before changing it.

<!--
The skeleton of docs/explanation/<module>-architecture.md (spec: openspec module-docs). Copy it, then:
- keep exactly these six sections in this order, and no deeper heading; a section with nothing to say holds the line None.
- keep only the three tables below; field-by-field reference belongs in the generated contracts and reference docs
- cite a value by its constant's name, never the number; say what holds now, not what changed
- stay under the line cap; split a longer explanation into another doc and link it from Related
- an app-facing module keeps the Field and App use table; a module with no client-facing route deletes it
- every backticked name in a Not cell goes into the module's id-denylist block in eslint.config.js; a word wrong only in prose has no backticks
-->

## Context

What the module owns and what it only mirrors, in two or three sentences.

| System | Quirk tag | Gives | Enters at |
| --- | --- | --- | --- |
| <an upstream, a writer outside src/, or a store> | `<system>` or — | <what it gives the module> | <the file or class it enters through> |

## Glossary

| Term | Means | Derived from | Not |
| --- | --- | --- | --- |
| `<name>` (`<Brand>`) | <what it is, its unit and scope> | <the upstream field or the function that makes it> | `<forbiddenName>`, a prose-only word |

## Structure

```mermaid
flowchart LR
  upstream["<upstream>"] -->|<what flows>| coll[("<collection>")]
  coll -->|<repository or service>| route["<METHOD> <path>"]
  route -->|<field read>| screen["app: <Screen>"]
```

| Field | App use |
| --- | --- |
| `<field>` | <the app screen that renders it, or served and not rendered> |

## Invariants

- <a rule the code keeps, naming the constant or function that keeps it, or the ADR that decided it>

## Open questions

None.

## Related

- [ADR 0010](../decisions/0010-server-architecture.md): the shape every migrated module follows
- [Docs index](../README.md): writing rules
