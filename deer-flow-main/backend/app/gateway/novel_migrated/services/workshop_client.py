"""云端提示词工坊 API 客户端（client 模式使用）"""
from __future__ import annotations

import httpx
import logging
import os
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class WorkshopClientError(Exception):
    """工坊客户端错误"""
    pass


class WorkshopClient:
    """云端 API 客户端"""

    def __init__(
        self,
        base_url: str = "",
        timeout: float = 30.0,
        instance_id: str = "local",
        tls_verify: bool | str = True,
    ):
        self.base_url = base_url
        self.timeout = timeout
        self.instance_id = instance_id
        self.tls_verify = tls_verify

    async def _request(
        self,
        method: str,
        path: str,
        params: Optional[Dict] = None,
        json: Optional[Dict] = None,
        user_identifier: Optional[str] = None,
    ) -> Dict[str, Any]:
        """发送请求到云端"""
        headers = {
            "X-Instance-ID": self.instance_id,
            "Content-Type": "application/json",
        }
        if user_identifier:
            headers["X-User-ID"] = user_identifier

        url = f"{self.base_url.rstrip('/')}/api/prompt-workshop{path}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout, verify=self.tls_verify) as client:
                response = await client.request(
                    method=method,
                    url=url,
                    params=params,
                    json=json,
                    headers=headers,
                )
                response.raise_for_status()
                return response.json()
        except httpx.ConnectError as e:
            logger.error(f"无法连接到云端服务: {self.base_url}, 错误: {e}")
            raise WorkshopClientError("无法连接到云端服务，请检查网络连接")
        except httpx.TimeoutException:
            logger.error(f"云端服务请求超时: {url}")
            raise WorkshopClientError("云端服务请求超时，请稍后重试")
        except httpx.HTTPStatusError as e:
            logger.error(f"云端服务返回错误: {e.response.status_code}, {e.response.text}")
            raise WorkshopClientError(f"云端服务错误: {e.response.status_code}")
        except Exception as e:
            logger.error(f"请求云端服务异常: {e}")
            raise WorkshopClientError(f"请求云端服务失败: {str(e)}")

    async def check_connection(self) -> bool:
        """检查云端连接状态"""
        try:
            await self._request("GET", "/status")
            return True
        except Exception as e:
            logger.warning(f"云端连接检查失败: {e}")
            return False

    async def get_items(
        self,
        category: Optional[str] = None,
        search: Optional[str] = None,
        tags: Optional[str] = None,
        sort: str = "newest",
        page: int = 1,
        limit: int = 20,
        user_identifier: Optional[str] = None,
    ) -> Dict:
        """获取提示词列表"""
        params = {
            "sort": sort,
            "page": page,
            "limit": limit,
        }
        if category:
            params["category"] = category
        if search:
            params["search"] = search
        if tags:
            params["tags"] = tags

        return await self._request(
            "GET",
            "/items",
            params=params,
            user_identifier=user_identifier,
        )

    async def get_item(self, item_id: str, user_identifier: Optional[str] = None) -> Dict:
        """获取单个提示词详情"""
        return await self._request(
            "GET",
            f"/items/{item_id}",
            user_identifier=user_identifier,
        )

    async def record_download(self, item_id: str, user_identifier: str) -> Dict:
        """记录下载"""
        return await self._request(
            "POST",
            f"/items/{item_id}/download",
            json={
                "instance_id": self.instance_id,
                "user_identifier": user_identifier,
            },
            user_identifier=user_identifier,
        )

    async def toggle_like(self, item_id: str, user_identifier: str) -> Dict:
        """点赞/取消点赞"""
        return await self._request(
            "POST",
            f"/items/{item_id}/like",
            user_identifier=user_identifier,
        )

    async def submit(
        self,
        user_identifier: str,
        submitter_name: str,
        data: Dict,
    ) -> Dict:
        """提交提示词"""
        payload = {
            "instance_id": self.instance_id,
            "submitter_id": user_identifier,
            "submitter_name": submitter_name,
            **data,
        }
        return await self._request(
            "POST",
            "/submit",
            json=payload,
            user_identifier=user_identifier,
        )

    async def get_submissions(
        self,
        user_identifier: str,
        status: Optional[str] = None,
    ) -> Dict:
        """获取用户的提交记录"""
        params = {}
        if status:
            params["status"] = status
        return await self._request(
            "GET",
            "/my-submissions",
            params=params,
            user_identifier=user_identifier,
        )

    async def withdraw_submission(
        self,
        submission_id: str,
        user_identifier: str,
        force: bool = False,
    ) -> Dict:
        """撤回/删除提交"""
        params = {}
        if force:
            params["force"] = "true"
        return await self._request(
            "DELETE",
            f"/submissions/{submission_id}",
            params=params if params else None,
            user_identifier=user_identifier,
        )


def _parse_tls_verify(raw_value: Any) -> bool | str:
    """解析 TLS 校验配置。

    - true/false 字符串映射为布尔值；
    - 其他非空字符串视为证书路径，交由 httpx 校验；
    - 默认值为 True。
    """
    if isinstance(raw_value, bool):
        return raw_value
    if raw_value is None:
        return True

    normalized = str(raw_value).strip()
    if not normalized:
        return True

    lowered = normalized.lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    return normalized


# 全局客户端实例（延迟初始化）
_workshop_client: Optional[WorkshopClient] = None


def get_workshop_client() -> WorkshopClient:
    """
    获取全局工坊客户端实例（单例模式）
    
    使用说明：
    - 首次调用时会尝试从配置读取 WORKSHOP_CLOUD_URL 和 INSTANCE_ID
    - 如果配置缺失，返回一个未配置的客户端实例（调用时会报错）
    - 适用于需要兼容参考项目但 deer-flow 可能未配置工坊的场景
    """
    global _workshop_client
    if _workshop_client is None:
        try:
            from app.gateway.novel_migrated.core.config import settings

            _workshop_client = WorkshopClient(
                base_url=getattr(settings, "WORKSHOP_CLOUD_URL", ""),
                timeout=getattr(settings, "WORKSHOP_API_TIMEOUT", 30.0),
                instance_id=getattr(settings, "INSTANCE_ID", "local"),
                tls_verify=_parse_tls_verify(
                    getattr(settings, "WORKSHOP_TLS_VERIFY", os.getenv("NOVEL_MIGRATED_WORKSHOP_TLS_VERIFY", "true"))
                ),
            )
        except ImportError:
            logger.warning("无法导入配置模块，使用默认工坊客户端")
            _workshop_client = WorkshopClient()
    return _workshop_client


# 兼容性别名
workshop_client = get_workshop_client()
