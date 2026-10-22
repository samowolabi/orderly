---
name: sam-code-style
description: Apply Sam's readable, simple coding style when writing, reviewing, or refactoring TypeScript backends and similar service-oriented applications. Use semantic field ordering, explicit module boundaries, concise function comments, proportionate tests, and atomic commits.
---

# Sam's code style

Write code that is easy to follow in one pass. Prefer a small, direct implementation over clever abstractions, speculative flexibility, or unnecessary files.

## Readability

- Use descriptive names and straightforward control flow. Prefer early returns to deep nesting.
- Separate meaningful stages with blank lines. Keep related statements together instead of spacing every line.
- Add one concise intent comment above every project-defined function, method, and constructor. Comment meaningful inline callbacks immediately before the callback.
- Explain purpose, business rules, or non-obvious constraints. Do not narrate syntax.
- In long workflows, use short numbered stage comments when they make validation, loading, mutation, side effects, and return steps easier to scan.
- Preserve behavior during readability-only refactors.

## Data shapes

- Order fields semantically, not alphabetically.
- Put identity first, then descriptive fields and related entities, quantities and money, people or contact details, state and errors, provider details, and timestamps last.
- Use blank lines between field groups when the shape is long enough to benefit.
- Keep equivalent types, schemas, query projections, and serializers in the same conceptual order when practical.
- Place new fields beside their peers instead of prepending or appending them for convenience.
- Keep API and database naming conventions intact at their boundaries. Do not mix naming styles inside one contract.

## Modules and boundaries

- Keep routes focused on endpoint wiring and middleware.
- Keep controllers focused on translating HTTP input and output.
- Put business rules, database workflows, transactions, and invariants in services.
- Put cross-cutting request behavior in middleware and shared pure helpers in utilities.
- Hide third-party providers behind small adapter contracts so business services do not depend on provider payloads.
- Keep OpenAPI schemas and path definitions in an independent module. Do not couple the specification to routes or controllers.
- Keep types near the code that owns them. Create a shared types module only when several modules genuinely share a stable contract.
- Keep modules cohesive. Do not split code into tiny files solely to reduce file length.

## Correctness

- Enforce important rules in code and the database, not only in prompts, documentation, or clients.
- Use database transactions for multi-step state changes that must succeed or fail together.
- Make scarce-resource updates concurrency-safe with conditional updates, locks, or database constraints.
- Make retryable operations and webhooks idempotent.
- Verify external payment or provider state before confirming irreversible business state.
- Store money in minor units internally and keep currency explicit at system boundaries.
- Return consistent errors that are safe and useful to the caller.

## Scope and cleanup

- Reuse the project's current patterns before introducing another abstraction.
- Remove obsolete code and files only after checking their callers and generated outputs.
- Avoid broad cleanup while implementing an unrelated feature unless the user explicitly requests it.
- Keep generated files and local test artifacts out of commits unless they are deliberate source artifacts.
- Write documentation in plain, direct language. Do not use em dashes.

## Verification and commits

- Test locally before external integration testing. Cover the happy path, expected failures, retries, and concurrency risks in proportion to the change.
- Run the relevant typecheck, build, and focused tests before finishing.
- Make small atomic commits: one coherent change with its tests, migration, and documentation.
- Inspect the working tree and staged diff before committing. Preserve unrelated user changes.
- Use a clear imperative commit message, report the commit hash and verification results, and do not push unless asked.

Before finishing, confirm that the result is simple, boundaries remain clear, comments describe intent, fields are grouped semantically, verification passed, and the working tree contains no accidental artifacts.
