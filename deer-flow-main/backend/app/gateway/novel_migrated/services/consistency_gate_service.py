"""跨章一致性与定稿门禁服务（聚合入口）。

代码审查（H-09）指出该模块曾膨胀为“状态机 + 报告生成 + 门禁合并 + 定稿执行”的单体文件。
本文件保留对外 API 兼容，同时将实现拆分到 `services/consistency_gate/` 子模块中：

- `ConsistencyChecker`: 跨章一致性检测与报告
- `GateReporter`: 定稿门禁报告生成 + 质量门禁融合 + 误报反馈
- `FinalizationExecutor`: 定稿执行（含 lifecycle 状态迁移）

这样可以显著降低回归面，并让各职责具备可独立单测的边界。
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from .consistency_gate.base import GateLevel
from .consistency_gate.checker import ConsistencyChecker
from .consistency_gate.finalizer import FinalizationExecutor
from .consistency_gate.reporter import GateReporter


class ConsistencyGateService:
    """跨章一致性与定稿门禁聚合服务（thin wrapper）。"""

    def __init__(self) -> None:
        self._checker = ConsistencyChecker()
        self._reporter = GateReporter(checker=self._checker)
        self._finalizer = FinalizationExecutor(reporter=self._reporter)

    async def build_consistency_report(self, db: AsyncSession, project_id: str) -> dict[str, Any]:
        """构建项目级跨章一致性报告。"""
        return await self._checker.build_consistency_report(db, project_id)

    async def build_finalize_gate_report(
        self,
        db: AsyncSession,
        project_id: str,
        config: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """执行定稿门禁检查，输出标准化三级结果。"""
        return await self._reporter.build_finalize_gate_report(db, project_id, config=config)

    async def finalize_project(
        self,
        db: AsyncSession,
        project_id: str,
        config: dict[str, Any] | None = None,
    ) -> tuple[bool, dict[str, Any]]:
        """执行门禁并在可通过时完成定稿。"""
        return await self._finalizer.finalize_project(db, project_id, config=config)

    def record_false_positive_feedback(
        self,
        *,
        decision_id: str,
        gate_key: str,
        evidence_key: str,
        source: str,
        original_level: GateLevel,
        corrected_level: GateLevel,
        reason: str,
        reporter: str,
        note: str = "",
        metadata: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._reporter.record_false_positive_feedback(
            decision_id=decision_id,
            gate_key=gate_key,
            evidence_key=evidence_key,
            source=source,
            original_level=original_level,
            corrected_level=corrected_level,
            reason=reason,
            reporter=reporter,
            note=note,
            metadata=metadata,
        )

    def get_false_positive_backflow(
        self,
        *,
        gate_key: str | None = None,
        evidence_key: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        return self._reporter.get_false_positive_backflow(
            gate_key=gate_key,
            evidence_key=evidence_key,
            limit=limit,
        )


consistency_gate_service = ConsistencyGateService()
