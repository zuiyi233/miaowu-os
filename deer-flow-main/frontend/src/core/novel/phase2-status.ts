type StatusSeverity = "error" | "warning" | "info";

export type Phase2TaskStatus =
  | "idle"
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "blocked"
  | "failed";

export interface Phase2StatusIssue {
  code?: string;
  message: string;
  severity: StatusSeverity;
  location?: string;
  hint?: string;
  source?: string;
}

export interface Phase2StatusSnapshot {
  status: Phase2TaskStatus;
  stage?: string;
  progress?: number;
  message?: string;
  novelId?: string;
  reportUrl?: string;
  blockers: Phase2StatusIssue[];
  errors: Phase2StatusIssue[];
  warnings: Phase2StatusIssue[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function normalizeSeverity(raw: unknown): StatusSeverity {
  const normalized = (asString(raw) ?? "").toLowerCase();
  if (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized.includes("critical") ||
    normalized.includes("block")
  ) {
    return "error";
  }
  if (normalized.includes("warn")) {
    return "warning";
  }
  return "info";
}

function normalizeStatus(raw: unknown): Phase2TaskStatus | null {
  const normalized = (asString(raw) ?? "").toLowerCase();
  if (!normalized) {
    return null;
  }
  if (
    normalized.includes("blocked") ||
    normalized.includes("gate_block") ||
    normalized.includes("gate-block") ||
    normalized.includes("阻断")
  ) {
    return "blocked";
  }
  if (
    normalized.includes("fail") ||
    normalized.includes("error") ||
    normalized.includes("cancel")
  ) {
    return "failed";
  }
  if (
    normalized.includes("running") ||
    normalized.includes("progress") ||
    normalized.includes("processing") ||
    normalized.includes("in_progress") ||
    normalized.includes("executing")
  ) {
    return "running";
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("queued") ||
    normalized.includes("created")
  ) {
    return "pending";
  }
  if (normalized.includes("warn")) {
    return "warning";
  }
  if (
    normalized.includes("success") ||
    normalized.includes("complete") ||
    normalized.includes("done") ||
    normalized.includes("pass") ||
    normalized.includes("approved")
  ) {
    return "success";
  }
  if (normalized.includes("idle") || normalized.includes("ready")) {
    return "idle";
  }
  return null;
}

function formatIssueLocation(raw: Record<string, unknown>): string | undefined {
  const chapter = asString(
    firstDefined(raw, ["chapter", "chapter_id", "chapterId", "chapter_title"]),
  );
  const entity = asString(
    firstDefined(raw, ["entity", "entity_id", "entityId", "entity_name"]),
  );
  const field = asString(firstDefined(raw, ["field", "path", "location"]));

  return [chapter, entity, field].filter(Boolean).join(" / ") || undefined;
}

function normalizeIssue(
  raw: unknown,
  fallbackSeverity: StatusSeverity,
  fallbackSource?: string,
): Phase2StatusIssue | null {
  if (typeof raw === "string") {
    const message = asString(raw);
    if (!message) {
      return null;
    }
    return {
      message,
      severity: fallbackSeverity,
      source: fallbackSource,
    };
  }

  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const message = asString(
    firstDefined(record, [
      "message",
      "detail",
      "error",
      "reason",
      "description",
      "summary",
    ]),
  );

  if (!message) {
    return null;
  }

  return {
    code: asString(firstDefined(record, ["code", "type", "id"])),
    message,
    severity: normalizeSeverity(record.severity ?? fallbackSeverity),
    location: formatIssueLocation(record),
    hint: asString(
      firstDefined(record, [
        "hint",
        "suggestion",
        "suggestions",
        "action",
        "action_hint",
        "actionHint",
      ]),
    ),
    source: asString(firstDefined(record, ["source"])) ?? fallbackSource,
  };
}

function mergeIssues(
  base: Phase2StatusIssue[],
  next: Phase2StatusIssue[],
): Phase2StatusIssue[] {
  const result = [...base];
  for (const item of next) {
    const duplicate = result.find(
      (existing) =>
        existing.code === item.code &&
        existing.message === item.message &&
        existing.severity === item.severity &&
        existing.location === item.location,
    );
    if (!duplicate) {
      result.push(item);
    }
  }
  return result;
}

function collectIssues(
  record: Record<string, unknown>,
  keys: string[],
  severity: StatusSeverity,
  source?: string,
): Phase2StatusIssue[] {
  const issues: Phase2StatusIssue[] = [];
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const raw = record[key];
    const list = asArray(raw);
    if (list.length > 0) {
      for (const entry of list) {
        const normalized = normalizeIssue(entry, severity, source);
        if (normalized) {
          issues.push(normalized);
        }
      }
      continue;
    }
    const normalized = normalizeIssue(raw, severity, source);
    if (normalized) {
      issues.push(normalized);
    }
  }
  return issues;
}

function findNovelId(record: Record<string, unknown>): string | undefined {
  return asString(
    firstDefined(record, [
      "novel_id",
      "novelId",
      "project_id",
      "projectId",
      "book_id",
      "bookId",
    ]),
  );
}

function findReportUrl(record: Record<string, unknown>): string | undefined {
  const direct = asString(
    firstDefined(record, [
      "consistency_report_url",
      "consistencyReportUrl",
      "report_url",
      "reportUrl",
      "consistency_report_path",
      "consistencyReportPath",
    ]),
  );
  if (direct) {
    return direct;
  }

  const nestedKeys = [
    "consistency_report",
    "consistencyReport",
    "report",
    "quality_report",
    "qualityReport",
  ];
  for (const key of nestedKeys) {
    const nested = asRecord(record[key]);
    if (!nested) {
      continue;
    }
    const nestedUrl = asString(
      firstDefined(nested, ["url", "path", "href", "link"]),
    );
    if (nestedUrl) {
      return nestedUrl;
    }
  }
  return undefined;
}

function collectCandidates(
  values: Record<string, unknown>,
): Record<string, unknown>[] {
  const candidates: Record<string, unknown>[] = [values];
  const keys = [
    "quality_closure",
    "qualityClosure",
    "novel_pipeline",
    "novelPipeline",
    "pipeline",
    "workflow",
    "novel_workflow",
    "novelWorkflow",
    "phase2",
    "phase_2",
    "task",
    "novel_task",
    "novelTask",
    "finalization_gate",
    "finalizationGate",
    "gate",
  ];
  for (const key of keys) {
    const nested = asRecord(values[key]);
    if (nested) {
      candidates.push(nested);
    }
  }
  return candidates;
}

function buildSnapshotFromCandidate(
  candidate: Record<string, unknown>,
): Phase2StatusSnapshot | null {
  const status = normalizeStatus(
    firstDefined(candidate, [
      "status",
      "task_status",
      "taskStatus",
      "pipeline_status",
      "pipelineStatus",
      "workflow_state",
      "workflowState",
      "state",
    ]),
  );
  const stage = asString(
    firstDefined(candidate, ["stage", "phase", "step", "current_step", "currentStep"]),
  );
  const progress = asNumber(
    firstDefined(candidate, ["progress", "percent", "percentage", "progress_percent"]),
  );
  const message = asString(
    firstDefined(candidate, ["message", "summary", "detail", "description"]),
  );
  const novelId = findNovelId(candidate);
  const reportUrl = findReportUrl(candidate);

  const errors = collectIssues(
    candidate,
    ["errors", "error", "failure", "last_error", "lastError"],
    "error",
  );
  let warnings = collectIssues(
    candidate,
    ["warnings", "warning", "risks", "risk_items", "riskItems"],
    "warning",
  ).filter((issue) => issue.severity === "warning");

  let blockers = collectIssues(
    candidate,
    ["blockers", "blocking_items", "blockingItems"],
    "error",
    "finalization_gate",
  );

  const gateCandidate = asRecord(
    firstDefined(candidate, [
      "finalization_gate",
      "finalizationGate",
      "final_gate",
      "finalGate",
      "gate",
    ]),
  );
  if (gateCandidate) {
    const gateIssues = collectIssues(
      gateCandidate,
      ["blockers", "blocking_items", "blockingItems", "issues"],
      "error",
      "finalization_gate",
    );
    blockers = mergeIssues(
      blockers,
      gateIssues.filter((issue) => issue.severity === "error"),
    );
    warnings = mergeIssues(
      warnings,
      gateIssues.filter((issue) => issue.severity === "warning"),
    );
  }

  if (
    !status &&
    !stage &&
    progress === undefined &&
    !message &&
    errors.length === 0 &&
    blockers.length === 0 &&
    warnings.length === 0
  ) {
    return null;
  }

  let resolvedStatus: Phase2TaskStatus = status ?? "pending";
  if (blockers.length > 0) {
    resolvedStatus = "blocked";
  } else if (errors.length > 0 && resolvedStatus !== "success") {
    resolvedStatus = "failed";
  } else if (!status && warnings.length > 0) {
    resolvedStatus = "warning";
  }

  return {
    status: resolvedStatus,
    stage,
    progress,
    message,
    novelId,
    reportUrl,
    blockers,
    errors,
    warnings,
  };
}

function snapshotScore(snapshot: Phase2StatusSnapshot): number {
  let score = 0;
  if (snapshot.status !== "idle") {
    score += 1;
  }
  if (snapshot.stage) {
    score += 1;
  }
  if (snapshot.progress !== undefined) {
    score += 1;
  }
  score += snapshot.blockers.length * 3;
  score += snapshot.errors.length * 2;
  score += snapshot.warnings.length;
  if (snapshot.message) {
    score += 1;
  }
  return score;
}

export function buildPhase2SnapshotFromThread(
  threadValues: unknown,
  threadError?: unknown,
): Phase2StatusSnapshot | null {
  const root = asRecord(threadValues);
  const rootNovelId = root ? findNovelId(root) : undefined;
  const rootReportUrl = root ? findReportUrl(root) : undefined;
  const rootErrors = root
    ? collectIssues(root, ["errors", "error", "last_error", "lastError"], "error")
    : [];
  const rootWarnings = root
    ? collectIssues(root, ["warnings", "warning", "risks", "risk_items", "riskItems"], "warning").filter(
        (issue) => issue.severity === "warning",
      )
    : [];

  let best: Phase2StatusSnapshot | null = null;
  if (root) {
    for (const candidate of collectCandidates(root)) {
      const snapshot = buildSnapshotFromCandidate(candidate);
      if (!snapshot) {
        continue;
      }
      if (!best || snapshotScore(snapshot) > snapshotScore(best)) {
        best = snapshot;
      }
    }
  }

  const threadErrorIssue = normalizeIssue(threadError, "error", "thread");
  if (!best && !threadErrorIssue && rootErrors.length === 0 && rootWarnings.length === 0) {
    return null;
  }

  const mergedErrors = mergeIssues(
    best?.errors ?? [],
    mergeIssues(rootErrors, threadErrorIssue ? [threadErrorIssue] : []),
  );
  const mergedBlockers = best?.blockers ?? [];
  const mergedWarnings = mergeIssues(best?.warnings ?? [], rootWarnings);

  let status = best?.status ?? "failed";
  if (mergedBlockers.length > 0) {
    status = "blocked";
  } else if (mergedErrors.length > 0 && status !== "success") {
    status = "failed";
  } else if (mergedWarnings.length > 0 && ["idle", "pending", "success", "warning"].includes(status)) {
    status = "warning";
  }

  return {
    status,
    stage: best?.stage,
    progress: best?.progress,
    message: best?.message,
    novelId: best?.novelId ?? rootNovelId,
    reportUrl: best?.reportUrl ?? rootReportUrl,
    blockers: mergedBlockers,
    errors: mergedErrors,
    warnings: mergedWarnings,
  };
}

export function buildPhase2SnapshotFromQualityReport(
  qualityReport: unknown,
  novelId: string,
): Phase2StatusSnapshot {
  const report = asRecord(qualityReport) ?? {};
  const reportIssues = collectIssues(report, ["issues"], "info", "consistency_report");
  const reportBlockers = reportIssues.filter((issue) => issue.severity === "error");
  const reportWarnings = reportIssues.filter((issue) => issue.severity === "warning");

  const reportedStatus = normalizeStatus(firstDefined(report, ["status", "state"]));
  let status: Phase2TaskStatus;
  if (reportedStatus) {
    status = reportedStatus;
  } else if (reportBlockers.length > 0) {
    status = "blocked";
  } else if (reportWarnings.length > 0) {
    status = "warning";
  } else {
    status = "success";
  }

  const summary =
    asString(firstDefined(report, ["summary", "message", "detail"])) ??
    (reportBlockers.length > 0
      ? `存在 ${reportBlockers.length} 项定稿阻断`
      : reportWarnings.length > 0
        ? `存在 ${reportWarnings.length} 项待处理风险`
        : "一致性检查通过");

  const progress =
    asNumber(firstDefined(report, ["progress", "progress_percent", "progressPercent"])) ??
    (status === "running" || status === "pending" ? undefined : 100);

  const reportNovelId = findNovelId(report) ?? novelId;

  const gateCandidate = asRecord(
    firstDefined(report, [
      "finalization_gate",
      "finalizationGate",
      "final_gate",
      "finalGate",
      "gate",
    ]),
  );
  const gateIssues = gateCandidate
    ? collectIssues(
        gateCandidate,
        ["blockers", "blocking_items", "blockingItems", "issues"],
        "error",
        "finalization_gate",
      )
    : [];
  const gateBlockers = gateIssues.filter((issue) => issue.severity === "error");
  const gateWarnings = gateIssues.filter((issue) => issue.severity === "warning");

  const mergedBlockers = mergeIssues(reportBlockers, gateBlockers);
  const mergedWarnings = mergeIssues(reportWarnings, gateWarnings);
  const mergedErrors = mergeIssues(reportBlockers, mergedBlockers);
  const resolvedStatus =
    mergedBlockers.length > 0
      ? "blocked"
      : status === "failed" || status === "blocked"
        ? status
        : mergedWarnings.length > 0 && ["idle", "pending", "success", "warning"].includes(status)
          ? "warning"
          : status;

  return {
    status: resolvedStatus,
    stage: asString(firstDefined(report, ["stage", "phase"])) ?? "finalization_gate",
    progress,
    message: summary,
    novelId: reportNovelId,
    reportUrl: findReportUrl(report),
    blockers: mergedBlockers,
    errors: mergedErrors,
    warnings: mergedWarnings,
  };
}
