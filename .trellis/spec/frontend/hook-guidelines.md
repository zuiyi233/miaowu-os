# Hook Guidelines

> How hooks are used in this project.

---

## Overview

This project expects data-fetching hooks to normalize backend failures into explicit, typed states before they reach the page layer.

---

## Data Fetching

### Quality Report Queries

`useQualityReportQuery` must own the shared `queryKey` and `queryFn` for quality report fetching.

Pages and layouts must not define duplicate `useQuery` logic for the same quality report data.

### Agents Management API

Agents-related hooks must detect the management-API disabled case explicitly and surface it as `AgentsApiDisabledError` rather than a generic network failure.

When a disabled response is identified, the hook layer must stop retrying immediately. Only non-disabled network failures may continue with limited retry behavior.

---

## Common Mistakes

- Treating `403 disabled` as a transient fetch error and letting retry logic continue.
- Returning only a loading state for disabled management APIs instead of a terminal disabled state.
