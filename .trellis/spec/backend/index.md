# Backend Development Guidelines

> Executable backend contracts for DeerFlow and Miaowu-OS backend work.

---

## Overview

This directory captures backend implementation rules that must be followed when changing runtime behavior, error recovery, caching, or background workers.

Each file should document:

1. The exact trigger that makes the rule applicable
2. The concrete API / function / runtime contract
3. The forbidden pattern and the allowed replacement
4. The verification path that proves the rule was respected

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations | To fill |
| [Error Handling](./error-handling.md) | Closed-loop recovery rules, retry behavior, user-facing fallbacks | Updated |
| [Quality Guidelines](./quality-guidelines.md) | Async runtime contracts: cache scope, memory worker, fire-and-forget hygiene | Updated |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |

---

## How to Use These Guidelines

- Read the relevant guide **before** touching the corresponding backend code
- Treat `Must` / `Must Not` / `Verify` as executable constraints, not suggestions
- When a rule spans multiple files, keep the canonical behavior in the most specific guide and cross-link the related guide
- If a new bugfix reveals a recurring pattern, capture it here immediately so future work does not regress

---

**Language**: All documentation should be written in **English**.
