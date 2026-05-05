# State Management

> How state is managed in this project.

---

## Overview

<!--
Document your project's state management conventions here.

Questions to answer:
- What state management solution do you use?
- How is local vs global state decided?
- How do you handle server state?
- What are the patterns for derived state?
-->

(To be filled by the team)

---

## State Categories

<!-- Local state, global state, server state, URL state -->

(To be filled by the team)

---

## When to Use Global State

<!-- Criteria for promoting state to global -->

(To be filled by the team)

---

## Server State

<!-- How server data is cached and synchronized -->

质量报告的刷新策略按路由区分：默认轮询间隔为 `15000ms`，`quality` 页面使用 `5000ms`。
非 `quality` 路由应按需加载质量报告查询逻辑，避免布局层对所有路由进行无差别轮询。

---

## Common Mistakes

<!-- State management mistakes your team has made -->

(To be filled by the team)
