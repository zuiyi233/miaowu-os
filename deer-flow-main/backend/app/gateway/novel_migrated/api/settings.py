"""Settings API for novel_migrated.

提供完整的设置管理接口，兼容参考项目 MuMuAINovel 的 settings API。
支持：
- AI 模型配置管理（models/test/function-calling）
- 预设管理（presets CRUD）
- SMTP 邮件配置（get/update/test）
"""

from __future__ import annotations

import logging
import smtplib
import time
import uuid
from datetime import datetime
from email.mime.text import MIMEText
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.gateway.novel_migrated.api.common import get_user_id
from app.gateway.novel_migrated.core.crypto import encrypt_secret, is_encryption_enabled, safe_decrypt
from app.gateway.novel_migrated.core.database import get_db
from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.services.ai_service import AIService, create_user_ai_service
from app.gateway.novel_migrated.services.ai_settings_service import get_ai_settings_service
from app.gateway.novel_migrated.services.cover_generation_service import cover_generation_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


# ==================== 请求/响应模型 ====================

class ModelConfig(BaseModel):
    """模型配置"""
    name: str = Field(..., description="模型名称")
    provider: str = Field(..., description="API 提供商")
    api_base_url: str | None = Field(None, description="API 基础 URL")


class TestRequest(BaseModel):
    """测试请求"""
    prompt: str = Field("你好，请回复'测试成功'", description="测试提示词")
    model_name: str | None = Field(None, description="模型名称（为空则使用当前配置）")
    max_tokens: int | None = Field(50, description="最大 token 数")


class FunctionCallingTestRequest(BaseModel):
    """Function Calling 测试请求"""
    prompt: str = Field("查询北京天气", description="测试提示词")
    tools: list[dict] = Field(
        default=[
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "获取指定城市的天气",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "city": {"type": "string", "description": "城市名称"}
                        },
                        "required": ["city"]
                    }
                }
            }
        ],
        description="工具定义列表"
    )


class PresetCreate(BaseModel):
    """创建预设请求"""
    name: str = Field(..., min_length=1, max_length=100, description="预设名称")
    description: str | None = Field(None, max_length=500, description="预设描述")
    config: dict = Field(..., description="预设配置（JSON）")


class PresetUpdate(BaseModel):
    """更新预设请求"""
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    config: dict | None = None


class PresetFromCurrentRequest(BaseModel):
    """从当前配置创建预设"""
    name: str = Field(..., min_length=1, max_length=100, description="预设名称")
    description: str | None = Field(None, max_length=500, description="预设描述")


class SettingsPayload(BaseModel):
    """设置保存/更新请求（对齐参考项目核心字段）"""

    api_provider: str | None = Field(default=None, deprecated=True, description="遗留字段，请使用 /api/user/ai-settings 的 providers")
    api_key: str | None = Field(default=None, deprecated=True, description="遗留字段，请使用 /api/user/ai-settings 的 providers[id].api_key")
    api_base_url: str | None = Field(default=None, deprecated=True, description="遗留字段，请使用 /api/user/ai-settings 的 providers[id].base_url")
    llm_model: str | None = Field(default=None, deprecated=True, description="遗留字段，请使用 /api/user/ai-settings 的 providers[id].models")
    temperature: float | None = Field(default=None, deprecated=True, description="遗留字段")
    max_tokens: int | None = Field(default=None, deprecated=True, description="遗留字段")
    system_prompt: str | None = Field(default=None, description="系统提示词")
    cover_api_provider: str | None = Field(default=None, description="封面 API 提供商")
    cover_api_key: str | None = Field(default=None, description="封面 API 密钥")
    cover_api_base_url: str | None = Field(default=None, description="封面 API 基础 URL")
    cover_image_model: str | None = Field(default=None, description="封面模型")
    cover_enabled: bool | None = Field(default=None, description="是否启用封面")
    preferences: str | None = Field(default=None, description="扩展偏好(JSON 字符串)")


class CoverSettingsTestRequest(BaseModel):
    """封面设置测试请求"""

    cover_api_provider: str = Field(..., description="封面 API 提供商")
    cover_api_key: str = Field(..., description="封面 API 密钥")
    cover_api_base_url: str | None = Field(None, description="封面 API 基础 URL")
    cover_image_model: str = Field(..., description="封面模型名称")


class SMTPConfigUpdate(BaseModel):
    """SMTP 配置更新"""
    smtp_host: str | None = Field(None, description="SMTP 服务器地址")
    smtp_port: int | None = Field(None, description="SMTP 端口")
    smtp_user: str | None = Field(None, description="SMTP 用户名")
    smtp_password: str | None = Field(None, description="SMTP 密码")
    smtp_from_email: EmailStr | None = Field(None, description="发件人邮箱")
    use_tls: bool | None = Field(True, description="是否使用 TLS")
    smtp_enabled: bool | None = Field(False, description="是否启用 SMTP")


class SMTPTestRequest(BaseModel):
    """SMTP 测试请求"""
    to_email: EmailStr = Field(..., description="收件人邮箱")
    subject: str = Field("Miaowu OS SMTP 测试邮件", description="邮件主题")


# ==================== 辅助函数 ====================

_SENSITIVE_FIELDS = {"api_key", "cover_api_key"}
_AI_SYNC_FIELD_KEYS = {
    "api_provider",
    "api_key",
    "api_base_url",
    "llm_model",
    "temperature",
    "max_tokens",
    "system_prompt",
}


def _encrypt_if_needed(field_name: str, value: Any) -> Any:
    if value is None:
        return None
    if field_name not in _SENSITIVE_FIELDS:
        return value
    if not is_encryption_enabled():
        return value
    str_val = str(value).strip()
    if not str_val:
        return value
    return encrypt_secret(str_val)


def _apply_settings_payload(settings: Settings, payload: dict[str, Any]) -> None:
    for key, value in payload.items():
        setattr(settings, key, _encrypt_if_needed(key, value))


def _sync_ai_bundle_if_needed(settings: Settings, payload: dict[str, Any]) -> None:
    ai_payload = {key: value for key, value in payload.items() if key in _AI_SYNC_FIELD_KEYS}
    if ai_payload:
        get_ai_settings_service().sync_preferences_from_settings_payload(settings, ai_payload)


def _as_non_empty_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed or None


def _extract_ai_provider_bundle(settings: Settings) -> dict[str, Any]:
    preferences = _load_preferences(settings)
    bundle = preferences.get("ai_provider_settings")
    return bundle if isinstance(bundle, dict) else {}


def _extract_target_from_routing_node(node: Any) -> tuple[str | None, str | None]:
    if not isinstance(node, dict):
        return None, None

    provider_id = _as_non_empty_str(node.get("providerId") or node.get("provider_id"))
    model_name = _as_non_empty_str(node.get("model") or node.get("model_name"))
    return provider_id, model_name


def _resolve_feature_routing_target(
    bundle: dict[str, Any],
    module_id: str | None,
) -> tuple[str | None, str | None]:
    feature_settings = bundle.get("feature_routing_settings")
    if not isinstance(feature_settings, dict):
        return None, None

    target_provider_id: str | None = None
    target_model: str | None = None

    if module_id:
        modules = feature_settings.get("modules")
        if isinstance(modules, list):
            matched_module = next(
                (
                    item
                    for item in modules
                    if isinstance(item, dict) and _as_non_empty_str(item.get("moduleId")) == module_id
                ),
                None,
            )
            if isinstance(matched_module, dict):
                current_mode = _as_non_empty_str(matched_module.get("currentMode")) or "primary"
                backup_provider_id, backup_model = _extract_target_from_routing_node(
                    matched_module.get("backupTarget")
                )
                primary_provider_id, primary_model = _extract_target_from_routing_node(
                    matched_module.get("primaryTarget")
                )
                default_provider_id, default_model = _extract_target_from_routing_node(
                    matched_module.get("defaultTarget")
                )

                if current_mode == "backup" and backup_provider_id and backup_model:
                    target_provider_id, target_model = backup_provider_id, backup_model
                elif primary_provider_id and primary_model:
                    target_provider_id, target_model = primary_provider_id, primary_model
                elif default_provider_id and default_model:
                    target_provider_id, target_model = default_provider_id, default_model

    if target_provider_id and target_model:
        return target_provider_id, target_model

    return _extract_target_from_routing_node(feature_settings.get("defaultTarget"))


def _find_provider_record(bundle: dict[str, Any], provider_id: str | None) -> dict[str, Any] | None:
    if not provider_id:
        return None

    providers = bundle.get("providers")
    if not isinstance(providers, list):
        return None

    for provider in providers:
        if not isinstance(provider, dict):
            continue
        if _as_non_empty_str(provider.get("id")) == provider_id:
            return provider

    return None


def _provider_models(provider_record: dict[str, Any]) -> list[str]:
    models = provider_record.get("models")
    if not isinstance(models, list):
        return []

    parsed: list[str] = []
    for model_name in models:
        if not isinstance(model_name, str):
            continue
        trimmed = model_name.strip()
        if trimmed:
            parsed.append(trimmed)
    return parsed


def _resolve_user_ai_runtime_config(
    settings: Settings,
    *,
    ai_provider_id: str | None = None,
    ai_model: str | None = None,
    module_id: str | None = None,
) -> tuple[dict[str, Any], str]:
    runtime = {
        "api_provider": _as_non_empty_str(settings.api_provider) or "openai",
        "api_key": safe_decrypt(settings.api_key) or "",
        "api_base_url": settings.api_base_url or "",
        "model_name": _as_non_empty_str(settings.llm_model) or "gpt-4",
        "temperature": float(settings.temperature) if settings.temperature is not None else 0.7,
        "max_tokens": int(settings.max_tokens) if settings.max_tokens is not None else 2000,
    }
    source = "settings-default"

    bundle = _extract_ai_provider_bundle(settings)

    explicit_provider_id = _as_non_empty_str(ai_provider_id)
    explicit_model_name = _as_non_empty_str(ai_model)
    normalized_module_id = _as_non_empty_str(module_id)

    routed_provider_id, routed_model = _resolve_feature_routing_target(bundle, normalized_module_id)

    target_provider_id = explicit_provider_id or routed_provider_id
    provider_record = _find_provider_record(bundle, target_provider_id)

    if provider_record is None and target_provider_id:
        logger.warning(
            "未找到 provider_id=%s（module=%s），回退 Settings 顶层配置",
            target_provider_id,
            normalized_module_id,
        )

    if provider_record is not None:
        runtime["api_provider"] = _as_non_empty_str(provider_record.get("provider")) or runtime["api_provider"]
        runtime["api_base_url"] = _as_non_empty_str(provider_record.get("base_url")) or ""

        encrypted_key = _as_non_empty_str(provider_record.get("api_key_encrypted"))
        if encrypted_key is not None:
            runtime["api_key"] = safe_decrypt(encrypted_key) or ""

        provider_temperature = provider_record.get("temperature")
        if provider_temperature is not None:
            try:
                runtime["temperature"] = float(provider_temperature)
            except Exception:
                pass

        provider_max_tokens = provider_record.get("max_tokens")
        if provider_max_tokens is not None:
            try:
                runtime["max_tokens"] = int(provider_max_tokens)
            except Exception:
                pass

        provider_models = _provider_models(provider_record)

        if explicit_model_name:
            runtime["model_name"] = explicit_model_name
            source = "explicit-provider+explicit-model"
        elif routed_model:
            if not provider_models or routed_model in provider_models:
                runtime["model_name"] = routed_model
                source = f"feature-routing:{normalized_module_id or 'default'}"
            elif provider_models:
                runtime["model_name"] = provider_models[0]
                source = f"feature-routing-fallback:{normalized_module_id or 'default'}"
        elif provider_models:
            runtime["model_name"] = provider_models[0]
            source = "provider-default-model"

        if explicit_provider_id and not explicit_model_name:
            source = "explicit-provider"
    else:
        if explicit_model_name:
            runtime["model_name"] = explicit_model_name
            source = "explicit-model"
        elif routed_model:
            runtime["model_name"] = routed_model
            source = f"feature-routing-model-only:{normalized_module_id or 'default'}"

    return runtime, source


async def get_user_ai_service_with_overrides(
    request: Request,
    db: AsyncSession,
    *,
    ai_provider_id: str | None = None,
    ai_model: str | None = None,
    module_id: str | None = None,
) -> AIService:
    user_id = get_user_id(request)

    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()

    if not settings:
        settings = Settings(user_id=user_id)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)

    runtime, source = _resolve_user_ai_runtime_config(
        settings,
        ai_provider_id=ai_provider_id,
        ai_model=ai_model,
        module_id=module_id,
    )

    logger.info(
        "Resolved AI runtime: user=%s module=%s source=%s provider=%s model=%s",
        user_id,
        module_id,
        source,
        runtime["api_provider"],
        runtime["model_name"],
    )

    return create_user_ai_service(
        api_provider=runtime["api_provider"],
        api_key=runtime["api_key"],
        api_base_url=runtime["api_base_url"],
        model_name=runtime["model_name"],
        temperature=runtime["temperature"],
        max_tokens=runtime["max_tokens"],
        system_prompt=settings.system_prompt,
        user_id=user_id,
        db_session=db,
        enable_mcp=True,
    )


async def get_user_ai_service(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AIService:
    """Create user AI service from persisted settings (without explicit overrides)."""
    return await get_user_ai_service_with_overrides(
        request,
        db,
    )


async def get_or_create_settings(user_id: str, db: AsyncSession) -> Settings:
    """获取或创建用户设置"""
    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()

    if not settings:
        settings = Settings(user_id=user_id)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)

    return settings


def _load_preferences(settings: Settings) -> dict[str, Any]:
    import json as _json

    raw = settings.preferences or "{}"
    parsed = _json.loads(raw) if isinstance(raw, str) else raw
    return parsed if isinstance(parsed, dict) else {}


def _save_preferences(settings: Settings, preferences: dict[str, Any]) -> None:
    import json as _json

    settings.preferences = _json.dumps(preferences, ensure_ascii=False)


def _get_presets(preferences: dict[str, Any]) -> list[dict[str, Any]]:
    presets = preferences.get("presets", [])
    if isinstance(presets, list):
        return presets
    return []


def _sanitize_preset_config_for_response(config: dict[str, Any]) -> dict[str, Any]:
    """Return a response-safe preset config without leaking secrets."""
    sanitized = dict(config)
    has_api_key = bool(sanitized.get("api_key") or sanitized.get("api_key_encrypted"))
    has_cover_api_key = bool(sanitized.get("cover_api_key") or sanitized.get("cover_api_key_encrypted"))

    for key in ("api_key", "cover_api_key", "api_key_encrypted", "cover_api_key_encrypted"):
        sanitized.pop(key, None)

    sanitized["has_api_key"] = has_api_key
    sanitized["has_cover_api_key"] = has_cover_api_key
    return sanitized


def _sanitize_preset_for_response(preset: dict[str, Any]) -> dict[str, Any]:
    """Return a response-safe preset payload."""
    sanitized = dict(preset)
    config = sanitized.get("config")
    if isinstance(config, dict):
        sanitized["config"] = _sanitize_preset_config_for_response(config)
    return sanitized


def _resolve_secret_for_preset_activate(config: dict[str, Any], *, plain_field: str, encrypted_field: str) -> tuple[str | None, bool]:
    """Resolve preset secret for activation.

    Returns:
        tuple[str | None, bool]:
            - str | None: stored secret value to apply
            - bool: whether the returned value is already encrypted
    """
    encrypted_value = config.get(encrypted_field)
    if isinstance(encrypted_value, str):
        trimmed_encrypted = encrypted_value.strip()
        if trimmed_encrypted:
            return trimmed_encrypted, True

    plain_value = config.get(plain_field)
    if isinstance(plain_value, str):
        trimmed_plain = plain_value.strip()
        if trimmed_plain:
            decrypted = safe_decrypt(trimmed_plain)
            if is_encryption_enabled() and decrypted is not None and decrypted != trimmed_plain:
                return trimmed_plain, True
            return trimmed_plain, False

    return None, False


def _resolve_secret_for_runtime(config: dict[str, Any], *, plain_field: str, encrypted_field: str) -> str | None:
    """Resolve preset secret into plaintext for runtime calls."""
    encrypted_value = config.get(encrypted_field)
    if isinstance(encrypted_value, str) and encrypted_value.strip():
        return safe_decrypt(encrypted_value.strip())

    plain_value = config.get(plain_field)
    if isinstance(plain_value, str) and plain_value.strip():
        return safe_decrypt(plain_value.strip())

    return None


def _settings_to_response(settings: Settings) -> dict[str, Any]:
    """将 Settings ORM 对象转为兼容参考项目核心字段的响应结构。"""
    raw_api_key = safe_decrypt(settings.api_key)
    raw_cover_api_key = safe_decrypt(settings.cover_api_key)
    return {
        "id": settings.id,
        "user_id": settings.user_id,
        "api_provider": settings.api_provider,
        "api_key": "***" if raw_api_key else None,
        "api_base_url": settings.api_base_url,
        "llm_model": settings.llm_model,
        "temperature": settings.temperature,
        "max_tokens": settings.max_tokens,
        "system_prompt": settings.system_prompt,
        "cover_api_provider": settings.cover_api_provider,
        "cover_api_key": "***" if raw_cover_api_key else None,
        "cover_api_base_url": settings.cover_api_base_url,
        "cover_image_model": settings.cover_image_model,
        "cover_enabled": settings.cover_enabled,
        "preferences": settings.preferences,
        "created_at": settings.created_at.isoformat() if settings.created_at else None,
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
    }


# ==================== settings 主配置端点（参考契约对齐） ====================

@router.get("")
async def get_settings(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """获取当前用户 settings，不存在则自动创建默认记录。"""
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)
    return _settings_to_response(settings)


@router.post("")
async def save_settings(
    data: SettingsPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """创建或更新当前用户 settings（Upsert）。"""
    user_id = get_user_id(request)
    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()
    payload = data.model_dump(exclude_unset=True)

    if settings:
        _apply_settings_payload(settings, payload)
    else:
        encrypted_payload = {k: _encrypt_if_needed(k, v) for k, v in payload.items()}
        settings = Settings(user_id=user_id, **encrypted_payload)
        db.add(settings)

    # Keep canonical provider bundle in sync when legacy fields are written.
    _sync_ai_bundle_if_needed(settings, payload)

    await db.commit()
    await db.refresh(settings)
    return _settings_to_response(settings)


@router.put("")
async def update_settings(
    data: SettingsPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """更新当前用户 settings（不存在时返回 404）。"""
    user_id = get_user_id(request)
    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()

    if settings is None:
        raise HTTPException(status_code=404, detail="设置不存在，请先创建设置")

    payload = data.model_dump(exclude_unset=True)
    _apply_settings_payload(settings, payload)

    # Keep canonical provider bundle in sync when legacy fields are written.
    _sync_ai_bundle_if_needed(settings, payload)

    await db.commit()
    await db.refresh(settings)
    return _settings_to_response(settings)


@router.delete("")
async def delete_settings(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """删除当前用户 settings。"""
    user_id = get_user_id(request)
    result = await db.execute(select(Settings).where(Settings.user_id == user_id))
    settings = result.scalar_one_or_none()

    if settings is None:
        raise HTTPException(status_code=404, detail="设置不存在")

    await db.delete(settings)
    await db.commit()
    return {"message": "设置已删除", "user_id": user_id}


@router.post("/cover/test")
async def test_cover_settings(
    data: CoverSettingsTestRequest,
    request: Request,
):
    """测试封面生成配置（兼容 MuMuAINovel /settings/cover/test）。"""
    user_id = get_user_id(request)
    logger.info("用户 %s 发起封面设置测试", user_id)

    result = await cover_generation_service.test_cover_settings(
        provider=data.cover_api_provider,
        api_key=data.cover_api_key,
        api_base_url=data.cover_api_base_url,
        model=data.cover_image_model,
    )
    return {
        "success": result.success,
        "message": result.message,
        "provider": result.provider,
        "model": result.model,
    }


# ==================== 模型配置端点 ====================

@router.get("/models")
async def get_available_models(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    获取可用模型列表

    返回：
    - 当前配置的模型
    - deerflow 支持的所有模型列表
    - 各模型的基本信息
    """
    try:
        from deerflow.config import get_app_config

        config = get_app_config()
        models_list = []

        if hasattr(config, 'models') and config.models:
            for model in config.models:
                models_list.append({
                    "name": model.name,
                    "provider": getattr(model, 'provider', 'unknown'),
                    "description": getattr(model, 'description', ''),
                    "max_tokens": getattr(model, 'max_tokens', None),
                    "supports_function_calling": getattr(model, 'supports_tools', False),
                })

        # 获取用户当前使用的模型
        user_id = get_user_id(request)
        settings = await get_or_create_settings(user_id, db)

        return {
            "success": True,
            "data": {
                "current_model": settings.llm_model or (models_list[0]["name"] if models_list else None),
                "available_models": models_list,
                "total_count": len(models_list),
            },
        }
    except Exception as e:
        logger.error(f"获取模型列表失败: {e}")
        raise HTTPException(status_code=500, detail=f"获取模型列表失败: {str(e)}")


@router.post("/test")
async def test_ai_connection(
    data: TestRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    测试 AI 连接

    发送简单请求验证 API Key 和模型配置是否正确。
    """
    try:
        ai_service = await get_user_ai_service(request, db)

        start_time = __import__('time').time()
        result = await ai_service.generate_text(
            prompt=data.prompt,
            model=data.model_name,
            max_tokens=data.max_tokens,
        )
        elapsed_ms = (__import__('time').time() - start_time) * 1000

        return {
            "success": True,
            "data": {
                "response": result.get("content", "")[:200],  # 截断长响应
                "model_used": data.model_name or ai_service.default_model,
                "finish_reason": result.get("finish_reason"),
                "elapsed_ms": round(elapsed_ms, 2),
                "has_tool_calls": bool(result.get("tool_calls")),
            },
            "message": "AI 连接测试成功",
        }
    except Exception as e:
        logger.error(f"AI 连接测试失败: {e}")
        return {
            "success": False,
            "error": str(e),
            "message": f"AI 连接测试失败: {str(e)}",
        }


@router.post("/check-function-calling")
async def check_function_calling(
    data: FunctionCallingTestRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    测试 Function Calling 支持

    检查当前模型是否支持工具调用功能。
    """
    try:
        ai_service = await get_user_ai_service(request, db)

        # 尝试使用工具调用
        from langchain_core.messages import HumanMessage, SystemMessage

        messages = [
            SystemMessage(content="你是一个有帮助的助手。当被问及天气时，必须调用 get_weather 工具。"),
            HumanMessage(content=data.prompt),
        ]

        # 绑定工具
        llm = ai_service._resolve_model_name()
        from deerflow.models import create_chat_model

        model_instance = create_chat_model(name=llm)
        model_instance = model_instance.bind_tools(data.tools)

        response = await model_instance.ainvoke(messages)

        tool_calls = getattr(response, 'tool_calls', None) or []

        return {
            "success": True,
            "data": {
                "supported": len(tool_calls) > 0,
                "tool_calls": tool_calls[:3],  # 最多返回前3个
                "response_content": response.content if hasattr(response, 'content') else None,
                "model_used": llm,
            },
            "message": "Function Calling 能力检测完成" + ("，当前模型支持" if tool_calls else "，当前模型可能不支持或未触发"),
        }
    except Exception as e:
        logger.error(f"Function Calling 测试失败: {e}")
        return {
            "success": False,
            "error": str(e),
            "supported": False,
            "message": f"Function Calling 测试失败: {str(e)}",
        }


# ==================== 预设管理端点 ====================

@router.get("/presets")
async def get_presets(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    获取用户预设列表

    返回用户保存的所有配置预设（如不同的写作风格、参数组合等）。
    """
    user_id = get_user_id(request)

    # 使用 Settings 表的 preferences 字段存储预设（JSON 格式）
    settings = await get_or_create_settings(user_id, db)

    try:
        import json as _json

        preferences = settings.preferences or "{}"
        presets_data = _json.loads(preferences) if isinstance(preferences, str) else preferences

        presets = presets_data.get("presets", [])
        safe_presets = [_sanitize_preset_for_response(item) for item in presets if isinstance(item, dict)]

        return {
            "success": True,
            "data": {
                "presets": safe_presets,
                "total": len(safe_presets),
            },
        }
    except Exception as e:
        logger.error(f"读取预设失败: {e}")
        return {
            "success": True,
            "data": {"presets": [], "total": 0},
            "message": "暂无预设",
        }


@router.post("/presets")
async def create_preset(
    data: PresetCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    创建新预设

    保存一组常用的配置参数为预设，方便快速切换。
    """
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    try:
        import json as _json
        import uuid as _uuid

        preferences = settings.preferences or "{}"
        presets_data = _json.loads(preferences) if isinstance(preferences, str) else preferences

        new_preset = {
            "id": str(_uuid.uuid4())[:8],
            "name": data.name,
            "description": data.description,
            "config": data.config,
            "created_at": __import__('datetime').datetime.utcnow().isoformat(),
        }

        if "presets" not in presets_data:
            presets_data["presets"] = []

        presets_data["presets"].append(new_preset)
        settings.preferences = _json.dumps(presets_data, ensure_ascii=False)

        await db.commit()
        await db.refresh(settings)

        logger.info(f"用户 {user_id} 创建预设: {data.name}")

        return {
            "success": True,
            "data": _sanitize_preset_for_response(new_preset),
            "message": f"预设 '{data.name}' 创建成功",
        }
    except Exception as e:
        logger.error(f"创建预设失败: {e}")
        raise HTTPException(status_code=500, detail=f"创建预设失败: {str(e)}")


@router.put("/presets/{preset_id}")
async def update_preset(
    preset_id: str,
    data: PresetUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    更新预设

    修改已存在的预设配置。
    """
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    try:
        import json as _json

        preferences = settings.preferences or "{}"
        presets_data = _json.loads(preferences) if isinstance(preferences, str) else preferences

        presets = presets_data.get("presets", [])
        preset_found = False

        for preset in presets:
            if preset.get("id") == preset_id:
                if data.name is not None:
                    preset["name"] = data.name
                if data.description is not None:
                    preset["description"] = data.description
                if data.config is not None:
                    preset["config"] = data.config
                preset["updated_at"] = __import__('datetime').datetime.utcnow().isoformat()
                preset_found = True
                break

        if not preset_found:
            raise HTTPException(status_code=404, detail=f"预设 {preset_id} 不存在")

        settings.preferences = _json.dumps(presets_data, ensure_ascii=False)
        await db.commit()
        await db.refresh(settings)

        logger.info(f"用户 {user_id} 更新预设: {preset_id}")

        return {
            "success": True,
            "message": f"预设 '{data.name or preset_id}' 更新成功",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"更新预设失败: {e}")
        raise HTTPException(status_code=500, detail=f"更新预设失败: {str(e)}")


@router.delete("/presets/{preset_id}")
async def delete_preset(
    preset_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    删除预设

    移除不需要的预设配置。
    """
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    try:
        import json as _json

        preferences = settings.preferences or "{}"
        presets_data = _json.loads(preferences) if isinstance(preferences, str) else preferences

        presets = presets_data.get("presets", [])
        original_count = len(presets)

        presets_data["presets"] = [p for p in presets if p.get("id") != preset_id]

        if len(presets_data["presets"]) == original_count:
            raise HTTPException(status_code=404, detail=f"预设 {preset_id} 不存在")

        settings.preferences = _json.dumps(presets_data, ensure_ascii=False)
        await db.commit()

        logger.info(f"用户 {user_id} 删除预设: {preset_id}")

        return {
            "success": True,
            "message": f"预设 {preset_id} 删除成功",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"删除预设失败: {e}")
        raise HTTPException(status_code=500, detail=f"删除预设失败: {str(e)}")


@router.post("/presets/{preset_id}/activate")
async def activate_preset(
    preset_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """激活预设，并将预设配置应用到当前用户设置。"""
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    preferences = _load_preferences(settings)
    presets = _get_presets(preferences)

    target_preset: dict[str, Any] | None = None
    for preset in presets:
        if preset.get("id") == preset_id:
            target_preset = preset
            preset["is_active"] = True
            preset["activated_at"] = datetime.utcnow().isoformat()
        else:
            preset["is_active"] = False

    if target_preset is None:
        raise HTTPException(status_code=404, detail=f"预设 {preset_id} 不存在")

    preset_config = target_preset.get("config")
    if isinstance(preset_config, dict):
        if preset_config.get("api_provider") is not None:
            settings.api_provider = str(preset_config.get("api_provider") or settings.api_provider)
        preset_api_key, api_key_already_encrypted = _resolve_secret_for_preset_activate(preset_config, plain_field="api_key", encrypted_field="api_key_encrypted")
        if preset_api_key is not None:
            settings.api_key = preset_api_key if api_key_already_encrypted else _encrypt_if_needed("api_key", preset_api_key)
        if preset_config.get("api_base_url") is not None:
            settings.api_base_url = str(preset_config.get("api_base_url") or "")
        if preset_config.get("llm_model") is not None:
            settings.llm_model = str(preset_config.get("llm_model") or settings.llm_model)
        if preset_config.get("temperature") is not None:
            settings.temperature = float(preset_config.get("temperature"))
        if preset_config.get("max_tokens") is not None:
            settings.max_tokens = int(preset_config.get("max_tokens"))
        if preset_config.get("system_prompt") is not None:
            settings.system_prompt = str(preset_config.get("system_prompt") or "")

    preferences["presets"] = presets
    _save_preferences(settings, preferences)
    await db.commit()
    await db.refresh(settings)

    logger.info("用户 %s 激活预设: %s", user_id, target_preset.get("name"))
    return {
        "success": True,
        "message": "预设已激活",
        "data": {
            "preset_id": preset_id,
            "preset_name": target_preset.get("name"),
        },
    }


@router.post("/presets/{preset_id}/test")
async def test_preset(
    preset_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """测试指定预设的 AI 连通性。"""
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    preferences = _load_preferences(settings)
    presets = _get_presets(preferences)
    target_preset = next((preset for preset in presets if preset.get("id") == preset_id), None)
    if target_preset is None:
        raise HTTPException(status_code=404, detail=f"预设 {preset_id} 不存在")

    config = target_preset.get("config") if isinstance(target_preset.get("config"), dict) else {}
    preset_runtime_api_key = _resolve_secret_for_runtime(config, plain_field="api_key", encrypted_field="api_key_encrypted")
    ai_service = create_user_ai_service(
        api_provider=str(config.get("api_provider") or settings.api_provider or "openai"),
        api_key=preset_runtime_api_key or safe_decrypt(settings.api_key) or "",
        api_base_url=str(config.get("api_base_url") or settings.api_base_url or ""),
        model_name=str(config.get("llm_model") or settings.llm_model or "gpt-4"),
        temperature=float(config.get("temperature") if config.get("temperature") is not None else (settings.temperature or 0.7)),
        max_tokens=int(config.get("max_tokens") if config.get("max_tokens") is not None else (settings.max_tokens or 50)),
        system_prompt=str(config.get("system_prompt") or settings.system_prompt or ""),
        user_id=user_id,
        db_session=db,
        enable_mcp=True,
    )

    try:
        started = time.time()
        result = await ai_service.generate_text(
            prompt="请回复“预设测试成功”。",
            max_tokens=50,
        )
        elapsed_ms = round((time.time() - started) * 1000, 2)
        return {
            "success": True,
            "message": "预设测试成功",
            "data": {
                "preset_id": preset_id,
                "preset_name": target_preset.get("name"),
                "response": str(result.get("content", ""))[:200],
                "elapsed_ms": elapsed_ms,
            },
        }
    except Exception as exc:
        logger.error("预设测试失败: %s", exc)
        return {
            "success": False,
            "message": "预设测试失败",
            "error": str(exc),
            "data": {
                "preset_id": preset_id,
                "preset_name": target_preset.get("name"),
            },
        }


@router.post("/presets/from-current")
async def create_preset_from_current(
    request: Request,
    db: AsyncSession = Depends(get_db),
    payload: PresetFromCurrentRequest | None = Body(default=None),
    name: str | None = None,
    description: str | None = None,
):
    """从当前 settings 主配置创建预设。兼容 body 与 query 两种入参。"""
    preset_name = (payload.name if payload else name) or ""
    preset_name = preset_name.strip()
    if not preset_name:
        raise HTTPException(status_code=422, detail="name 不能为空")

    preset_description = payload.description if payload else description
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    preferences = _load_preferences(settings)
    presets = _get_presets(preferences)
    new_preset = {
        "id": str(uuid.uuid4())[:8],
        "name": preset_name,
        "description": preset_description,
        "is_active": False,
        "created_at": datetime.utcnow().isoformat(),
        "config": {
            "api_provider": settings.api_provider,
            "api_base_url": settings.api_base_url,
            "llm_model": settings.llm_model,
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
            "system_prompt": settings.system_prompt,
            "has_api_key": bool(safe_decrypt(settings.api_key)),
            "has_cover_api_key": bool(safe_decrypt(settings.cover_api_key)),
        },
    }
    if is_encryption_enabled() and isinstance(settings.api_key, str) and settings.api_key.strip():
        new_preset["config"]["api_key_encrypted"] = settings.api_key.strip()
    if is_encryption_enabled() and isinstance(settings.cover_api_key, str) and settings.cover_api_key.strip():
        new_preset["config"]["cover_api_key_encrypted"] = settings.cover_api_key.strip()

    presets.append(new_preset)
    preferences["presets"] = presets
    _save_preferences(settings, preferences)

    await db.commit()
    await db.refresh(settings)
    logger.info("用户 %s 从当前配置创建预设: %s", user_id, preset_name)
    return {
        "success": True,
        "data": _sanitize_preset_for_response(new_preset),
        "message": f"已从当前配置创建预设 '{preset_name}'",
    }


# ==================== SMTP 配置端点 ====================

@router.get("/system/smtp")
@router.get("/smtp")
async def get_smtp_config(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    获取 SMTP 配置

    返回当前的邮件发送配置（敏感信息脱敏）。
    """
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    try:
        import json as _json

        preferences = settings.preferences or "{}"
        prefs = _json.loads(preferences) if isinstance(preferences, str) else preferences
        smtp_config = prefs.get("smtp", {})

        # 脱敏处理
        safe_config = {
            "smtp_host": smtp_config.get("smtp_host"),
            "smtp_port": smtp_config.get("smtp_port", 587),
            "smtp_user": smtp_config.get("smtp_user"),
            "smtp_from_email": smtp_config.get("smtp_from_email"),
            "use_tls": smtp_config.get("use_tls", True),
            "smtp_enabled": smtp_config.get("smtp_enabled", False),
            "smtp_password_set": bool(smtp_config.get("smtp_password")),
        }

        return {
            "success": True,
            "data": safe_config,
        }
    except Exception as e:
        logger.error(f"读取 SMTP 配置失败: {e}")
        return {
            "success": True,
            "data": {
                "smtp_enabled": False,
                "smtp_password_set": False,
            },
            "message": "未配置 SMTP",
        }


@router.put("/system/smtp")
@router.put("/smtp")
async def update_smtp_config(
    data: SMTPConfigUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    更新 SMTP 配置

    配置邮件发送服务，用于通知、备份等功能。
    """
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    try:
        import json as _json

        preferences = settings.preferences or "{}"
        prefs = _json.loads(preferences) if isinstance(preferences, str) else preferences

        if "smtp" not in prefs:
            prefs["smtp"] = {}

        smtp = prefs["smtp"]

        if data.smtp_host is not None:
            smtp["smtp_host"] = data.smtp_host
        if data.smtp_port is not None:
            smtp["smtp_port"] = data.smtp_port
        if data.smtp_user is not None:
            smtp["smtp_user"] = data.smtp_user
        if data.smtp_password is not None:
            smtp["smtp_password"] = data.smtp_password
        if data.smtp_from_email is not None:
            smtp["smtp_from_email"] = data.smtp_from_email
        if data.use_tls is not None:
            smtp["use_tls"] = data.use_tls
        if data.smtp_enabled is not None:
            smtp["smtp_enabled"] = data.smtp_enabled

        prefs["smtp"] = smtp
        settings.preferences = _json.dumps(prefs, ensure_ascii=False)

        await db.commit()
        await db.refresh(settings)

        logger.info(f"用户 {user_id} 更新 SMTP 配置")

        return {
            "success": True,
            "message": "SMTP 配置更新成功",
            "data": {
                "smtp_host": smtp.get("smtp_host"),
                "smtp_port": smtp.get("smtp_port"),
                "smtp_user": smtp.get("smtp_user"),
                "smtp_from_email": smtp.get("smtp_from_email"),
                "smtp_enabled": smtp.get("smtp_enabled", False),
            },
        }
    except Exception as e:
        logger.error(f"更新 SMTP 配置失败: {e}")
        raise HTTPException(status_code=500, detail=f"更新 SMTP 配置失败: {str(e)}")


@router.post("/system/smtp/test")
@router.post("/smtp/test")
async def test_smtp_connection(
    data: SMTPTestRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    测试 SMTP 连接

    发送测试邮件验证配置是否正确。
    """
    user_id = get_user_id(request)
    settings = await get_or_create_settings(user_id, db)

    try:
        import json as _json

        preferences = settings.preferences or "{}"
        prefs = _json.loads(preferences) if isinstance(preferences, str) else preferences
        smtp_config = prefs.get("smtp", {})

        host = smtp_config.get("smtp_host")
        port = smtp_config.get("smtp_port", 587)
        username = smtp_config.get("smtp_user")
        password = smtp_config.get("smtp_password")
        from_email = smtp_config.get("smtp_from_email")
        use_tls = smtp_config.get("use_tls", True)

        if not all([host, username, password, from_email]):
            raise HTTPException(status_code=400, detail="SMTP 配置不完整，请先配置所有必需项")

        # 创建邮件
        msg = MIMEText(f"这是一封来自 Miaowu OS 的测试邮件。\n\n发送时间: {__import__('datetime').datetime.utcnow().isoformat()}\n\n如果您收到此邮件，说明 SMTP 配置正确！")
        msg["Subject"] = data.subject
        msg["From"] = from_email
        msg["To"] = data.to_email

        # 发送邮件
        if use_tls:
            server = smtplib.SMTP(host, port)
            server.starttls()
        else:
            server = smtplib.SMTP(host, port)

        server.login(username, password)
        server.sendmail(from_email, [data.to_email], msg.as_string())
        server.quit()

        logger.info(f"用户 {user_id} SMTP 测试邮件发送至 {data.to_email}")

        return {
            "success": True,
            "message": f"测试邮件已发送至 {data.to_email}，请检查收件箱",
            "data": {
                "to_email": data.to_email,
                "sent_at": __import__('datetime').datetime.utcnow().isoformat(),
            },
        }
    except HTTPException:
        raise
    except smtplib.SMTPAuthenticationError as e:
        logger.error(f"SMTP 认证失败: {e}")
        return {
            "success": False,
            "error": "SMTP 认证失败，请检查用户名和密码",
            "error_type": "authentication_error",
        }
    except smtplib.SMTPConnectError as e:
        logger.error(f"SMTP 连接失败: {e}")
        return {
            "success": False,
            "error": f"无法连接到 SMTP 服务器: {str(e)}",
            "error_type": "connection_error",
        }
    except Exception as e:
        logger.error(f"SMTP 测试失败: {e}")
        return {
            "success": False,
            "error": str(e),
            "error_type": "unknown_error",
        }
