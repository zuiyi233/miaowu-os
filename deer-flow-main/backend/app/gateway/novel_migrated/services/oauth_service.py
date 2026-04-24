"""
OAuth2 服务（最小兼容实现）

说明：
  - 参考项目使用 LinuxDO OAuth2 进行第三方登录
  - deer-flow 可能采用不同的认证体系（如 JWT、Session 等）
  - 此文件提供 OAuth2 服务的骨架实现，支持按需启用
  
取舍：
  ✓ 保留核心 OAuth2 流程（授权URL、token交换、用户信息获取）
  ✗ 不强制依赖特定 OAuth 提供商（可配置）
  ✗ 默认禁用，需通过配置启用
"""
from __future__ import annotations

import logging
import secrets
from typing import Any

import httpx

logger = logging.getLogger(__name__)


class OAuthServiceError(Exception):
    """OAuth 服务错误"""
    pass


class BaseOAuthService:
    """OAuth2 服务基类"""

    AUTHORIZE_URL: str = ""
    TOKEN_URL: str = ""
    USERINFO_URL: str = ""

    def __init__(
        self,
        client_id: str = "",
        client_secret: str = "",
        redirect_uri: str = "",
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def generate_state(self) -> str:
        """生成随机 state 参数（防 CSRF）"""
        return secrets.token_urlsafe(32)

    def get_authorization_url(self, state: str) -> str:
        """
        获取授权 URL
        
        Args:
            state: 随机 state 参数
            
        Returns:
            授权 URL
        """
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": "read",
            "state": state,
        }

        query_string = "&".join([f"{k}={v}" for k, v in params.items()])
        return f"{self.AUTHORIZE_URL}?{query_string}"

    async def get_access_token(self, code: str) -> dict[str, Any] | None:
        """
        使用授权码获取访问令牌
        
        Args:
            code: 授权码
            
        Returns:
            包含 access_token 的字典, 失败返回 None
        """
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri,
        }

        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    self.TOKEN_URL,
                    data=data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )

                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"获取访问令牌失败: {response.status_code} {response.text}")
                    return None

        except Exception as e:
            logger.error(f"获取访问令牌异常: {e}")
            return None

    async def get_user_info(self, access_token: str) -> dict[str, Any] | None:
        """
        使用访问令牌获取用户信息
        
        Args:
            access_token: 访问令牌
            
        Returns:
            用户信息字典, 失败返回 None
        """
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            }

            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
                response = await client.get(self.USERINFO_URL, headers=headers)

                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"获取用户信息失败: {response.status_code}")
                    return None

        except Exception as e:
            logger.error(f"获取用户信息异常: {type(e).__name__}: {e}")
            return None


class LinuxDOOAuthService(BaseOAuthService):
    """LinuxDO OAuth2 服务（参考项目兼容）"""

    AUTHORIZE_URL = "https://connect.linux.do/oauth2/authorize"
    TOKEN_URL = "https://connect.linux.do/oauth2/token"
    USERINFO_URL = "https://connect.linux.do/api/user"

    def __init__(self):
        super().__init__()
        try:
            from app.gateway.novel_migrated.core.config import settings

            self.client_id = getattr(settings, "LINUXDO_CLIENT_ID", "")
            self.client_secret = getattr(settings, "LINUXDO_CLIENT_SECRET", "")
            self.redirect_uri = getattr(settings, "LINUXDO_REDIRECT_URI", "")

            if not self.redirect_uri:
                self.redirect_uri = "http://localhost:8000/api/auth/callback"
                logger.warning(
                    "⚠️  LINUXDO_REDIRECT_URI 未配置，使用默认值: http://localhost:8000/api/auth/callback\n"
                    "如需使用 OAuth 登录，请在配置文件中设置 LINUXDO_REDIRECT_URI"
                )
        except ImportError:
            logger.warning("无法导入配置模块，LinuxDO OAuth 服务未完全初始化")


# 全局 OAuth 服务实例（延迟初始化）
_oauth_service: BaseOAuthService | None = None


def get_oauth_service() -> BaseOAuthService:
    """
    获取全局 OAuth 服务实例
    
    使用说明：
    - 默认返回 LinuxDOOAuthService 实例
    - 如果需要其他 OAuth 提供商，可在此处进行扩展
    - 适用于需要兼容参考项目 OAuth 功能的场景
    """
    global _oauth_service
    if _oauth_service is None:
        _oauth_service = LinuxDOOAuthService()
    return _oauth_service


class _LazyOAuthServiceProxy:
    """Compatibility proxy that delays real service construction until first use."""

    def __getattr__(self, item: str) -> Any:
        return getattr(get_oauth_service(), item)

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return "<LazyOAuthServiceProxy(target=LinuxDOOAuthService)>"


# 兼容性别名（保持导出名称，但不在模块加载时创建真实实例）
oauth_service: BaseOAuthService | _LazyOAuthServiceProxy = _LazyOAuthServiceProxy()
