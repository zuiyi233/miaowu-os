"""AI配置管理服务"""
from __future__ import annotations

from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.gateway.novel_migrated.models.settings import Settings
from app.gateway.novel_migrated.core.logger import get_logger

logger = get_logger(__name__)

PROVIDER_PRESETS = {
    "openai": {
        "api_provider": "openai",
        "api_base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o",
    },
    "deepseek": {
        "api_provider": "deepseek",
        "api_base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat",
    },
    "zhipu": {
        "api_provider": "zhipu",
        "api_base_url": "https://open.bigmodel.cn/api/paas/v4",
        "default_model": "glm-4",
    },
    "moonshot": {
        "api_provider": "moonshot",
        "api_base_url": "https://api.moonshot.cn/v1",
        "default_model": "moonshot-v1-8k",
    },
    "qwen": {
        "api_provider": "qwen",
        "api_base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus",
    },
    "siliconflow": {
        "api_provider": "siliconflow",
        "api_base_url": "https://api.siliconflow.cn/v1",
        "default_model": "Qwen/Qwen2.5-72B-Instruct",
    },
}


class AIConfigService:

    async def get_user_config(self, user_id: str, db: AsyncSession) -> Dict[str, Any]:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if not settings:
            return {"api_provider": "openai", "llm_model": "gpt-4o", "temperature": 0.7}
        return {
            "api_provider": settings.api_provider,
            "api_key": "***" if settings.api_key else None,
            "api_base_url": settings.api_base_url,
            "llm_model": settings.llm_model,
            "temperature": settings.temperature,
            "max_tokens": settings.max_tokens,
            "system_prompt": settings.system_prompt,
        }

    async def update_user_config(self, user_id: str, config: Dict[str, Any], db: AsyncSession) -> Settings:
        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if not settings:
            settings = Settings(user_id=user_id)
            db.add(settings)

        updatable_fields = ['api_provider', 'api_key', 'api_base_url', 'llm_model',
                            'temperature', 'max_tokens', 'system_prompt']
        for field_name in updatable_fields:
            if field_name in config:
                setattr(settings, field_name, config[field_name])

        await db.commit()
        await db.refresh(settings)
        return settings

    async def apply_preset(self, user_id: str, provider: str, db: AsyncSession) -> Dict[str, Any]:
        preset = PROVIDER_PRESETS.get(provider)
        if not preset:
            raise ValueError(f"Unknown provider: {provider}")

        result = await db.execute(select(Settings).where(Settings.user_id == user_id))
        settings = result.scalar_one_or_none()
        if not settings:
            settings = Settings(user_id=user_id)
            db.add(settings)

        settings.api_provider = preset["api_provider"]
        settings.api_base_url = preset["api_base_url"]
        if not settings.llm_model:
            settings.llm_model = preset["default_model"]

        await db.commit()
        return preset

    def get_available_presets(self) -> Dict[str, Dict[str, str]]:
        return PROVIDER_PRESETS.copy()


_ai_config_service = None

def get_ai_config_service() -> AIConfigService:
    global _ai_config_service
    if _ai_config_service is None:
        _ai_config_service = AIConfigService()
    return _ai_config_service
