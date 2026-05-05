# Hook Guidelines

> How hooks are used in this project.

---

## Overview

<!--
Document your project's hook conventions here.

Questions to answer:
- What custom hooks do you have?
- How do you handle data fetching?
- What are the naming conventions?
- How do you share stateful logic?
-->

(To be filled by the team)

---

## Custom Hook Patterns

<!-- How to create and structure custom hooks -->

(To be filled by the team)

---

## Data Fetching

<!-- How data fetching is handled (React Query, SWR, etc.) -->

质量报告查询必须通过共享 hook `useQualityReportQuery` 统一管理 `queryKey` 和 `queryFn`，禁止在页面布局或其他组件中重复定义同一份 `useQuery`。

---

## Naming Conventions

<!-- Hook naming rules (use*, etc.) -->

(To be filled by the team)

---

## Common Mistakes

<!-- Hook-related mistakes your team has made -->

(To be filled by the team)
