import { describe, expect, it } from "vitest";

import {
  buildPhase2SnapshotFromQualityReport,
  buildPhase2SnapshotFromThread,
} from "@/core/novel/phase2-status";

describe("phase2 status mapping", () => {
  it("extracts blockers and report link from thread values", () => {
    const snapshot = buildPhase2SnapshotFromThread({
      novel_pipeline: {
        status: "running",
        stage: "revision",
        progress: 68,
        project_id: "novel-123",
        consistency_report: {
          url: "/workspace/novel/novel-123/quality",
        },
        finalization_gate: {
          blockers: [
            {
              code: "LOW_SCORE",
              message: "章节评分过低",
              chapter_id: "chapter-9",
              suggestion: "先修订后重提",
            },
          ],
        },
        warnings: [
          {
            code: "TIMELINE_RISK",
            severity: "warning",
            message: "时间线存在潜在冲突",
            chapter_id: "chapter-8",
          },
        ],
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("blocked");
    expect(snapshot?.stage).toBe("revision");
    expect(snapshot?.progress).toBe(68);
    expect(snapshot?.novelId).toBe("novel-123");
    expect(snapshot?.reportUrl).toBe("/workspace/novel/novel-123/quality");
    expect(snapshot?.blockers).toHaveLength(1);
    expect(snapshot?.blockers[0]?.code).toBe("LOW_SCORE");
    expect(snapshot?.blockers[0]?.location).toContain("chapter-9");
    expect(snapshot?.warnings).toHaveLength(1);
    expect(snapshot?.warnings[0]?.message).toBe("时间线存在潜在冲突");
  });

  it("falls back to thread error when no status payload exists", () => {
    const snapshot = buildPhase2SnapshotFromThread({}, "gateway timeout");

    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("failed");
    expect(snapshot?.errors).toHaveLength(1);
    expect(snapshot?.errors[0]?.message).toBe("gateway timeout");
    expect(snapshot?.warnings).toHaveLength(0);
  });

  it("maps quality report issues to blocked gate status", () => {
    const snapshot = buildPhase2SnapshotFromQualityReport(
      {
        issues: [
          {
            type: "character_conflict",
            severity: "error",
            message: "角色年龄与前文矛盾",
            chapter_id: "chapter-12",
            suggestion: "统一角色设定后重试",
          },
          {
            type: "timeline_risk",
            severity: "warning",
            message: "时间线存在潜在冲突",
          },
        ],
      },
      "novel-456",
    );

    expect(snapshot.status).toBe("blocked");
    expect(snapshot.novelId).toBe("novel-456");
    expect(snapshot.blockers).toHaveLength(1);
    expect(snapshot.errors).toHaveLength(1);
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.blockers[0]?.message).toContain("角色年龄与前文矛盾");
    expect(snapshot.warnings[0]?.message).toContain("时间线存在潜在冲突");
  });

  it("maps warning-only quality report to warning status", () => {
    const snapshot = buildPhase2SnapshotFromQualityReport(
      {
        issues: [
          {
            type: "style_risk",
            severity: "warning",
            message: "叙事风格与前文有轻微偏移",
            chapter_id: "chapter-3",
            suggestion: "统一语气后再定稿",
          },
        ],
      },
      "novel-warning-only",
    );

    expect(snapshot.status).toBe("warning");
    expect(snapshot.blockers).toHaveLength(0);
    expect(snapshot.errors).toHaveLength(0);
    expect(snapshot.warnings).toHaveLength(1);
    expect(snapshot.warnings[0]?.message).toBe("叙事风格与前文有轻微偏移");
    expect(snapshot.warnings[0]?.location).toContain("chapter-3");
  });

  it("honors explicit report status when no blockers exist", () => {
    const snapshot = buildPhase2SnapshotFromQualityReport(
      {
        status: "running",
        progress_percent: 42,
        message: "一致性分析执行中",
        issues: [],
      },
      "novel-789",
    );

    expect(snapshot.status).toBe("running");
    expect(snapshot.progress).toBe(42);
    expect(snapshot.message).toBe("一致性分析执行中");
    expect(snapshot.blockers).toHaveLength(0);
    expect(snapshot.errors).toHaveLength(0);
    expect(snapshot.warnings).toHaveLength(0);
  });

  it("drops meaningless placeholder message in thread snapshot", () => {
    const snapshot = buildPhase2SnapshotFromThread({
      novel_pipeline: {
        status: "running",
        progress: 15,
        message: "N/A",
      },
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.status).toBe("running");
    expect(snapshot?.progress).toBe(15);
    expect(snapshot?.message).toBeUndefined();
  });

  it("falls back to synthesized summary when report message is placeholder", () => {
    const snapshot = buildPhase2SnapshotFromQualityReport(
      {
        status: "success",
        summary: "null",
        issues: [],
      },
      "novel-empty-message",
    );

    expect(snapshot.status).toBe("success");
    expect(snapshot.message).toBe("一致性检查通过");
  });
});
