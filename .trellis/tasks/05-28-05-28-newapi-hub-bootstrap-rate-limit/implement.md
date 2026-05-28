# Implementation Plan

1. Read backend/frontend specs and relevant code paths.
2. Implement NewAPI Hub bootstrap rate limit config, middleware, tests, and route change in `N:\new-api-main`.
3. Implement Miaowu group-sync delay and 429 stop behavior with backend tests.
4. Adjust frontend copy only if existing dialog cannot clearly show backend error.
5. Run focused NewAPI Go tests.
6. Run focused Miaowu backend tests and lint if feasible.
7. Report remaining deployment/runtime verification steps.
