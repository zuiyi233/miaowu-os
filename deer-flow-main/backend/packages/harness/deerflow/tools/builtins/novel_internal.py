"""Internal direct-call bridge for novel tools.

通过 Protocol + 注册回调消除 harness -> app 反向 import。

App 层在启动时调用 register_novel_backend(impl)，传入实现这些方法的对象；
harness 层只通过此处的 Protocol 调用，不直接依赖应用层模块。

为兼容历史行为，若 register_novel_backend 未被调用，
get_internal_db / get_internal_ai_service / resolve_user_id 将返回 None / 默认值，
调用方应当回退到 HTTP 路径。
"""
from __future__ import annotations

import logging
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@runtime_checkable
class NovelBackendProtocol(Protocol):
    """App 层应实现此协议并通过 register_novel_backend 注入。"""

    async def get_db_session_factory(self) -> Any:
        """返回 sqlalchemy AsyncSession 的工厂（通常是 AsyncSessionLocal）。"""
        ...

    async def get_ai_service(self, user_id: str | None, module_id: str | None) -> Any:
        """根据 user_id / module_id 返回已构建好的 AIService 实例。"""
        ...

    def resolve_user_id(self, raw_user_id: str | None) -> str:
        """标准化 user_id；为空时回退默认值。"""
        ...

    def load_attr(self, module_path: str, attr_name: str) -> Any | None:
        """按需加载 app 层模块的属性（用于 file_truth_bridge 等少数遗留点）。"""
        ...


_backend: NovelBackendProtocol | None = None


def register_novel_backend(impl: NovelBackendProtocol) -> None:
    """由 app 层启动时调用。"""
    global _backend
    _backend = impl
    logger.info("Novel backend registered: %s", type(impl).__name__)


def is_internal_available() -> bool:
    return _backend is not None


async def get_internal_db():
    """返回 AsyncSession 工厂；未注册时抛 RuntimeError。"""
    if _backend is None:
        raise RuntimeError(
            "internal db session unavailable: app 层未调用 register_novel_backend()。"
            "请确认 backend.app.gateway.app 启动流程已注册 novel backend。",
        )
    return await _backend.get_db_session_factory()


async def get_internal_ai_service(
    user_id: str | None = None,
    module_id: str | None = None,
) -> Any:
    if _backend is None:
        raise RuntimeError(
            "internal ai service unavailable: app 层未调用 register_novel_backend()。",
        )
    return await _backend.get_ai_service(user_id, module_id)


def resolve_user_id(raw_user_id: str | None) -> str:
    if _backend is not None:
        try:
            result = _backend.resolve_user_id(raw_user_id)
            if isinstance(result, str) and result.strip():
                return result.strip()
        except Exception:
            logger.exception("backend.resolve_user_id failed, fallback to default")
    normalized = (raw_user_id or "").strip()
    return normalized or "local_single_user"


def load_attr(module_path: str, attr_name: str) -> Any | None:
    """兼容遗留点：仅通过已注册 backend 访问。

    历史行为是 importlib 反向加载 app 模块；现在改为只允许通过 backend 接口访问。
    若 backend 未注册或不支持该 module_path，返回 None。
    """
    if _backend is None:
        return None
    try:
        return _backend.load_attr(module_path, attr_name)
    except Exception:
        logger.debug("backend.load_attr(%s, %s) failed", module_path, attr_name)
        return None


def to_dict(result: Any) -> dict[str, Any]:
    if isinstance(result, dict):
        return result
    if hasattr(result, "model_dump") and callable(result.model_dump):
        return result.model_dump()
    if hasattr(result, "__dict__"):
        return {k: v for k, v in result.__dict__.items() if not k.startswith("_")}
    return {"raw": result}
