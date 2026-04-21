"""文本润色API"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id, verify_project_access
from app.gateway.novel_migrated.api.settings import get_user_ai_service
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.core.logger import get_logger
from app.gateway.novel_migrated.services.ai_service import AIService
from app.gateway.novel_migrated.services.consistency_gate_service import consistency_gate_service

logger = get_logger(__name__)
router = APIRouter(tags=["polish"])
legacy_router = APIRouter(prefix="/polish", tags=["polish"])
api_router = APIRouter(prefix="/api/polish", tags=["polish"])


class PolishRequest(BaseModel):
    text: str = Field(..., min_length=1, description="需要润色的文本")
    instructions: str = Field("", description="润色指令")
    style: str = Field("literary", description="润色风格: literary/formal/casual/vivid/concise")
    preserve_tone: bool = Field(True, description="是否保持原有语气")


class PolishResponse(BaseModel):
    original_text: str
    polished_text: str
    changes_summary: str = ""


class FinalizeGateRequest(BaseModel):
    low_score_warn_threshold: float = Field(6.5, ge=0.0, le=10.0, description="低分告警阈值")
    low_score_block_threshold: float = Field(5.0, ge=0.0, le=10.0, description="低分阻断阈值")
    min_chapter_length_warn: int = Field(300, ge=1, description="章节长度告警阈值")
    min_chapter_length_block: int = Field(80, ge=1, description="章节长度阻断阈值")
    sensitive_words: list[str] = Field(default_factory=list, description="自定义敏感词列表，为空则使用系统默认")
    idempotency_key: str = Field("", description="生命周期迁移幂等键（可选）")
    quality_gate_fusion_feature_enabled: bool | None = Field(
        default=None,
        description="质量门禁融合开关（空值时走 feature flag）",
    )
    fusion_degraded_fallback_mode: Literal["rule_only", "warn_only"] | None = Field(
        default=None,
        description="融合降级模式",
    )
    apply_feedback_backflow: bool = Field(True, description="是否启用误报反馈回流")
    feedback_evidence_key_prefix: str = Field(
        "novel_finalize_gate",
        description="误报反馈 evidence key 前缀",
    )
    model_gate_signals: dict[str, dict[str, Any] | str] = Field(
        default_factory=dict,
        description="模型门禁信号，key 为 check_id，value 为门禁级别或信号对象",
    )


class FalsePositiveFeedbackRequest(BaseModel):
    decision_id: str = Field(..., min_length=1, description="融合决策 ID")
    gate_key: str = Field(..., min_length=1, description="门禁主键")
    evidence_key: str = Field(..., min_length=1, description="证据主键")
    source: Literal["rule", "model", "fusion"] = Field("fusion", description="反馈来源")
    original_level: Literal["pass", "warn", "block"] = Field(..., description="原判定级别")
    corrected_level: Literal["pass", "warn", "block"] = Field(..., description="纠正后级别")
    reason: str = Field(..., min_length=1, description="误报原因")
    reporter: str = Field("", description="反馈人")
    note: str = Field("", description="附加备注")
    metadata: dict[str, Any] = Field(default_factory=dict, description="附加元数据")


class FinalizeActionResponse(BaseModel):
    project_id: str
    finalized: bool
    status: str
    gate_report: dict


@legacy_router.post("", response_model=PolishResponse)
@api_router.post("", response_model=PolishResponse)
async def polish_text(
    req: PolishRequest,
    user_id: str = Depends(get_user_id),
    ai_service: AIService = Depends(get_user_ai_service),
):
    style_map = {
        "literary": "文学性润色：增强文字的文学性和艺术性，使用更优美的词汇和句式",
        "formal": "正式润色：使文字更加正式、规范，适合严肃场景",
        "casual": "轻松润色：使文字更加自然、流畅，贴近口语化表达",
        "vivid": "生动润色：增强描写的画面感和生动性，加入更多感官细节",
        "concise": "精简润色：去除冗余，使文字更加精炼有力",
    }

    style_instruction = style_map.get(req.style, style_map["literary"])

    system_prompt = f"""你是一位专业的文字编辑，擅长对小说文本进行润色优化。

润色风格：{style_instruction}

要求：
1. 保持原文的核心含义和情节不变
2. {"保持原有语气和叙事风格" if req.preserve_tone else "可以调整语气和叙事风格"}
3. 优化文字的流畅度和可读性
4. 修正语法和用词问题
5. 增强文字的表现力

请直接输出润色后的文本，不要添加任何解释或注释。"""

    user_prompt = req.text
    if req.instructions:
        user_prompt = f"【额外润色要求】\n{req.instructions}\n\n【原文】\n{req.text}"

    accumulated = ""
    async for chunk in ai_service.generate_text_stream(
        prompt=user_prompt, system_prompt=system_prompt, temperature=0.5
    ):
        accumulated += chunk

    return PolishResponse(
        original_text=req.text,
        polished_text=accumulated,
        changes_summary="润色完成"
    )


@legacy_router.get("/projects/{project_id}/consistency-report")
@api_router.get("/projects/{project_id}/consistency-report")
async def get_project_consistency_report(
    project_id: str,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """获取项目级跨章一致性报告（角色/物品/时间线快照与冲突）。"""
    await verify_project_access(project_id, user_id, db)
    return await consistency_gate_service.build_consistency_report(db, project_id)


@legacy_router.post("/projects/{project_id}/finalize-gate")
@api_router.post("/projects/{project_id}/finalize-gate")
async def check_finalize_gate(
    project_id: str,
    req: FinalizeGateRequest | None = None,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """执行定稿门禁检查，返回标准化三级结果（pass/warn/block）。"""
    await verify_project_access(project_id, user_id, db)
    config = req.model_dump(exclude_none=True) if req else None
    return await consistency_gate_service.build_finalize_gate_report(
        db=db,
        project_id=project_id,
        config=config,
    )


@legacy_router.post("/projects/{project_id}/finalize", response_model=FinalizeActionResponse)
@api_router.post("/projects/{project_id}/finalize", response_model=FinalizeActionResponse)
async def finalize_project(
    project_id: str,
    req: FinalizeGateRequest | None = None,
    user_id: str = Depends(get_user_id),
    db: AsyncSession = Depends(get_db),
):
    """执行定稿：若门禁结果为 block 则返回 409 并阻断定稿。"""
    await verify_project_access(project_id, user_id, db)
    config = req.model_dump(exclude_none=True) if req else None
    passed, gate_report = await consistency_gate_service.finalize_project(
        db=db,
        project_id=project_id,
        config=config,
    )
    if not passed:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "定稿门禁未通过，项目仍处于未定稿状态。",
                "gate_report": gate_report,
            },
        )

    return FinalizeActionResponse(
        project_id=project_id,
        finalized=True,
        status=gate_report.get("project_status", "finalized"),
        gate_report=gate_report,
    )


@legacy_router.post("/quality-gate/false-positive-feedback")
@api_router.post("/quality-gate/false-positive-feedback")
async def submit_false_positive_feedback(
    req: FalsePositiveFeedbackRequest,
    user_id: str = Depends(get_user_id),
):
    """记录质量门禁误报反馈，供后续融合回流使用。"""
    try:
        payload = consistency_gate_service.record_false_positive_feedback(
            decision_id=req.decision_id,
            gate_key=req.gate_key,
            evidence_key=req.evidence_key,
            source=req.source,
            original_level=req.original_level,
            corrected_level=req.corrected_level,
            reason=req.reason,
            reporter=req.reporter or user_id,
            note=req.note,
            metadata=req.metadata,
        )
        return payload
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@legacy_router.get("/quality-gate/false-positive-feedback")
@api_router.get("/quality-gate/false-positive-feedback")
async def list_false_positive_feedback(
    gate_key: str | None = Query(default=None, description="按门禁主键过滤"),
    evidence_key: str | None = Query(default=None, description="按证据主键过滤"),
    limit: int = Query(default=50, ge=1, le=200, description="返回条数上限"),
    user_id: str = Depends(get_user_id),
):
    """查询误报反馈回流视图。"""
    _ = user_id  # explicit dependency for auth consistency
    return consistency_gate_service.get_false_positive_backflow(
        gate_key=gate_key,
        evidence_key=evidence_key,
        limit=limit,
    )


router.include_router(legacy_router)
router.include_router(api_router)
