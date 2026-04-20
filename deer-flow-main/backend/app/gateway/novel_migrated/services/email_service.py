"""SMTP 邮件发送服务"""
from __future__ import annotations

from email.message import EmailMessage
from typing import Optional
import logging

try:
    import aiosmtplib
    HAS_AIOSMTP = True
except ImportError:
    HAS_AIOSMTP = False
    logging.getLogger(__name__).warning(
        "aiosmtplib 未安装，邮件发送功能不可用。请执行: pip install aiosmtplib"
    )

logger = logging.getLogger(__name__)


class EmailService:
    """系统 SMTP 邮件发送服务"""

    async def send_mail(
        self,
        *,
        host: str,
        port: int,
        username: str,
        password: str,
        use_tls: bool,
        use_ssl: bool,
        from_email: str,
        from_name: str,
        to_email: str,
        subject: str,
        text_body: str,
        html_body: Optional[str] = None,
    ) -> None:
        """
        发送邮件
        
        Args:
            host: SMTP 主机地址
            port: SMTP 端口
            username: SMTP 用户名
            password: SMTP 密码/授权码
            use_tls: 是否使用 STARTTLS
            use_ssl: 是否使用 SSL
            from_email: 发件人邮箱
            from_name: 发件人显示名称
            to_email: 收件人邮箱
            subject: 邮件主题
            text_body: 纯文本内容
            html_body: HTML 内容（可选）
            
        Raises:
            ValueError: 配置错误（如 TLS 和 SSL 同时启用）
            RuntimeError: aiosmtplib 未安装
        """
        if not HAS_AIOSMTP:
            raise RuntimeError("aiosmtplib 未安装，无法发送邮件。请执行: pip install aiosmtplib")

        if use_tls and use_ssl:
            raise ValueError("SMTP 配置错误：TLS 和 SSL 不能同时启用")

        message = EmailMessage()
        message["From"] = f"{from_name} <{from_email}>" if from_name else from_email
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content(text_body)
        if html_body:
            message.add_alternative(html_body, subtype="html")

        logger.info(f"[SMTP] 准备发送测试邮件到 {self._mask_email(to_email)}，服务器: {host}:{port}")

        await aiosmtplib.send(
            message,
            hostname=host,
            port=port,
            username=username,
            password=password,
            use_tls=use_ssl,
            start_tls=use_tls,
            timeout=20,
        )

        logger.info(f"[SMTP] 测试邮件发送成功: {self._mask_email(to_email)}")

    @staticmethod
    def _mask_email(email: str) -> str:
        """脱敏邮箱地址"""
        if "@" not in email:
            return email
        name, domain = email.split("@", 1)
        if len(name) <= 2:
            masked_name = name[0] + "*"
        else:
            masked_name = name[0] + "*" * (len(name) - 2) + name[-1]
        return f"{masked_name}@{domain}"

    @property
    def is_available(self) -> bool:
        """检查邮件服务是否可用"""
        return HAS_AIOSMTP


# 全局邮件服务实例
email_service = EmailService()
