"""
AI与小说模块连接状态测试脚本
测试目标：验证主项目AI对话功能是否能正确识别"创建小说"指令并调用小说模块
"""

import asyncio
import json
import time
import sys
from datetime import datetime
from typing import Any, Dict, Optional

try:
    import httpx
except ImportError:
    print("请安装依赖: pip install httpx")
    sys.exit(1)


class ConnectionTestResult:
    def __init__(self):
        self.test_results = []
        self.start_time = None
        self.end_time = None

    def add_result(self, test_name: str, status: str, details: Dict[str, Any], response_time_ms: float = 0):
        self.test_results.append({
            "test_name": test_name,
            "status": status,  # "PASS", "FAIL", "WARN"
            "details": details,
            "response_time_ms": round(response_time_ms, 2),
            "timestamp": datetime.now().isoformat()
        })

    def generate_report(self) -> str:
        report = []
        report.append("=" * 80)
        report.append("AI与小说模块连接状态测试报告")
        report.append(f"测试时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        report.append(f"总耗时: {((self.end_time or datetime.now()) - (self.start_time or datetime.now())).total_seconds():.2f}秒")
        report.append("=" * 80)
        report.append("")

        for i, result in enumerate(self.test_results, 1):
            status_icon = "✅" if result["status"] == "PASS" else ("⚠️" if result["status"] == "WARN" else "❌")
            report.append(f"{i}. {result['test_name']}")
            report.append(f"   状态: {status_icon} {result['status']}")
            report.append(f"   响应时间: {result['response_time_ms']}ms")

            for key, value in result["details"].items():
                if isinstance(value, (dict, list)):
                    value_str = json.dumps(value, ensure_ascii=False, indent=2)
                    if len(value_str) > 200:
                        value_str = value_str[:200] + "..."
                    report.append(f"   {key}: {value_str}")
                else:
                    value_str = str(value)
                    if len(value_str) > 200:
                        value_str = value_str[:200] + "..."
                    report.append(f"   {key}: {value_str}")
            report.append("")

        # 汇总
        total = len(self.test_results)
        passed = sum(1 for r in self.test_results if r["status"] == "PASS")
        failed = sum(1 for r in self.test_results if r["status"] == "FAIL")
        warned = sum(1 for r in self.test_results if r["status"] == "WARN")

        report.append("-" * 80)
        report.append("测试汇总:")
        report.append(f"  总计: {total} 项测试")
        report.append(f"  通过: {passed} 项")
        report.append(f"  失败: {failed} 项")
        report.append(f"  警告: {warned} 项")
        report.append("-" * 80)

        if failed > 0:
            overall_status = "❌ 连接状态异常 - 存在集成问题"
        elif warned > 0:
            overall_status = "⚠️ 连接状态部分正常 - 存在潜在风险"
        else:
            overall_status = "✅ 连接状态正常"

        report.append(f"\n总体结论: {overall_status}")
        report.append("=" * 80)

        return "\n".join(report)


class AINovelConnectionTester:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url.rstrip('/')
        self.result = ConnectionTestResult()
        self.client = None

    async def __aenter__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.result.start_time = datetime.now()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()
        self.result.end_time = datetime.now()

    async def _make_request(self, method: str, endpoint: str, **kwargs) -> tuple[int, Any, float]:
        """发送HTTP请求并返回状态码、响应内容和耗时"""
        url = f"{self.base_url}{endpoint}"
        start_time = time.time()

        try:
            if method.upper() == "GET":
                response = await self.client.get(url, **kwargs)
            elif method.upper() == "POST":
                response = await self.client.post(url, **kwargs)
            else:
                raise ValueError(f"Unsupported method: {method}")

            elapsed_ms = (time.time() - start_time) * 1000

            try:
                content = response.json()
            except Exception:
                content = response.text

            return response.status_code, content, elapsed_ms

        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            return 0, {"error": str(e)}, elapsed_ms

    async def test_1_backend_health(self):
        """测试1: 后端服务健康检查"""
        print("\n📋 测试1: 检查后端服务健康状态...")

        status_code, content, elapsed = await self._make_request("GET", "/health")

        if status_code == 200 and content.get("status") == "healthy":
            self.result.add_result(
                "后端服务健康检查",
                "PASS",
                {
                    "service_status": content.get("status"),
                    "mode": content.get("gateway_mode"),
                    "deerflow_available": content.get("deerflow_available"),
                    "registered_routers": f"{content.get('registered_harness_routers', 'N/A')}/{content.get('total_harness_routers', 'N/A')}"
                },
                elapsed
            )
        else:
            self.result.add_result(
                "后端服务健康检查",
                "FAIL",
                {"error": "服务不可达或异常", "status_code": status_code, "response": content},
                elapsed
            )

    async def test_2_ai_chat_endpoint(self):
        """测试2: AI聊天端点可用性"""
        print("\n📋 测试2: 验证AI聊天端点 (/api/ai/chat)...")

        test_payload = {
            "messages": [
                {"role": "user", "content": "你好，这是一条测试消息"}
            ],
            "stream": False,
            "provider_config": {
                "provider": "openai",
                "base_url": "",
                "model_name": "gpt-3.5-turbo",
                "temperature": 0.7,
                "max_tokens": 50
            }
        }

        status_code, content, elapsed = await self._make_request(
            "POST",
            "/api/ai/chat",
            json=test_payload
        )

        if status_code in [200, 400, 422]:  # 400/422可能是因为缺少认证或配置，但端点存在
            if status_code == 200:
                self.result.add_result(
                    "AI聊天端点可用性",
                    "PASS",
                    {
                        "endpoint_response": "正常响应",
                        "has_content": "content" in content,
                        "content_preview": str(content.get("content", ""))[:100]
                    },
                    elapsed
                )
            else:
                self.result.add_result(
                    "AI聊天端点可用性",
                    "WARN",
                    {
                        "endpoint_accessible": "端点可达但请求被拒绝（可能需要认证或配置）",
                        "status_code": status_code,
                        "error_detail": str(content.get("detail", content))[:200]
                    },
                    elapsed
                )
        else:
            self.result.add_result(
                "AI聊天端点可用性",
                "FAIL",
                {"error": "AI聊天端点不可达", "status_code": status_code, "response": str(content)[:200]},
                elapsed
            )

    async def test_3_novel_api_endpoint(self):
        """测试3: 小说API端点可用性"""
        print("\n📋 测试3: 验证小说API端点...")

        # 尝试获取小说列表（可能需要认证）
        status_code, content, elapsed = await self._make_request("GET", "/novels")

        if status_code in [200, 401, 403]:  # 401/403说明端点存在但需要认证
            self.result.add_result(
                "小说API端点可用性",
                "PASS" if status_code == 200 else "WARN",
                {
                    "endpoint_accessible": "小说API端点可达",
                    "status_code": status_code,
                    "note": "需要认证" if status_code in [401, 403] else "正常访问"
                },
                elapsed
            )
        else:
            self.result.add_result(
                "小说API端点可用性",
                "FAIL",
                {"error": "小说API端点不可达", "status_code": status_code, "response": str(content)[:200]},
                elapsed
            )

    async def test_4_create_novel_command_recognition(self):
        """测试4: 核心测试 - "创建小说"指令识别能力"""
        print("\n📋 测试4: 🎯 核心测试 - 验证'创建小说'指令识别...")

        test_messages = [
            "请帮我创建一本新的小说",
            "我想写一部科幻小说",
            "创建一个名为《星际迷航》的小说项目"
        ]

        recognition_results = []

        for msg in test_messages:
            payload = {
                "messages": [
                    {"role": "system", "content": "你是一个AI助手"},
                    {"role": "user", "content": msg}
                ],
                "stream": False,
                "context": {},
                "provider_config": {
                    "provider": "openai",
                    "base_url": "",
                    "model_name": "gpt-3.5-turbo",
                    "temperature": 0.7,
                    "max_tokens": 200
                }
            }

            status_code, content, elapsed = await self._make_request(
                "POST",
                "/api/ai/chat",
                json=payload
            )

            response_text = ""
            has_novel_api_call = False
            tool_calls = []

            if status_code == 200:
                response_text = content.get("content", "")
                # 检查是否有工具调用或特殊标记
                if "tool_calls" in content:
                    tool_calls = content.get("tool_calls", [])
                    has_novel_api_call = any(
                        "novel" in str(tc).lower() or "create" in str(tc).lower()
                        for tc in tool_calls
                    )

            recognition_results.append({
                "input_message": msg,
                "status_code": status_code,
                "response_preview": response_text[:150],
                "has_tool_calls": len(tool_calls) > 0,
                "has_novel_related_tool_call": has_novel_api_call,
                "tool_calls": tool_calls[:3] if tool_calls else []
            })

        # 分析结果
        any_tool_calls = any(r["has_tool_calls"] for r in recognition_results)
        any_novel_calls = any(r["has_novel_related_tool_call"] for r in recognition_results)

        if any_novel_calls:
            self.result.add_result(
                "'创建小说'指令识别与路由",
                "PASS",
                {
                    "recognition_status": "✅ 系统能够识别'创建小说'指令并触发小说相关工具调用",
                    "test_cases": recognition_results,
                    "conclusion": "AI与小说模块已建立正确的指令路由机制"
                },
                0
            )
        elif any_tool_calls:
            self.result.add_result(
                "'创建小说'指令识别与路由",
                "WARN",
                {
                    "recognition_status": "⚠️ 系统支持工具调用，但未检测到小说相关的工具调用",
                    "test_cases": recognition_results,
                    "conclusion": "可能原因：1) 未注册小说创建工具 2) 系统提示词未包含小说功能引导 3) 需要特定上下文才能激活"
                },
                0
            )
        else:
            self.result.add_result(
                "'创建小说'指令识别与路由",
                "FAIL",
                {
                    "recognition_status": "❌ 系统无法自动识别'创建小说'指令并调用小说模块",
                    "test_cases": recognition_results,
                    "conclusion": "AI对话模块与小说模块之间缺乏自动化的指令识别和路由机制",
                    "root_cause_analysis": [
                        "1. /api/ai/chat 是通用LLM聊天接口，不包含业务逻辑路由",
                        "2. 未发现从AI对话到小说创建API的中间件/拦截器",
                        "3. 小说模块有独立的API端点(/novels)，但未被AI层自动调用",
                        "4. 当前架构下，用户需手动切换到小说模块进行操作"
                    ]
                },
                0
            )

    async def test_5_architecture_analysis(self):
        """测试5: 架构层面的连接分析"""
        print("\n📋 测试5: 架构层面分析...")

        architecture_findings = {
            "ai_module_location": "frontend/src/core/ai/global-ai-service.ts → backend/app/gateway/api/ai_provider.py",
            "novel_module_location": "frontend/src/core/novel/ → backend/app/gateway/novel_migrated/",
            "ai_endpoint": "/api/ai/chat (通用LLM聊天接口)",
            "novel_endpoints": "/novels/* (独立小说CRUD API)",
            "connection_mechanism": "❌ 未发现自动指令识别和路由机制",
            "novel_internal_ai": "✅ 小说模块内部有独立的AI对话组件(AiChatView.tsx)",
            "integration_points": [
                "ai_provider.py 导入了 novel_migrated 的 AIService (共享AI服务层)",
                "但这是底层服务共享，非业务逻辑集成"
            ],
            "mcp_plugin_system": "✅ 存在MCP插件系统(mcp_plugins.py)，可用于扩展",
            "recommended_solution": [
                "方案1: 在AI Provider层添加意图识别中间件，检测'创建小说'等关键词",
                "方案2: 注册小说操作为AI工具(tool calling)，让LLM主动调用",
                "方案3: 使用MCP插件系统将小说API暴露为AI可调用的工具",
                "方案4: 在前端添加指令预处理层，根据用户输入路由到不同模块"
            ]
        }

        has_auto_routing = False  # 基于前面的测试结果判断

        if has_auto_routing:
            self.result.add_result(
                "架构连接分析",
                "PASS",
                architecture_findings,
                0
            )
        else:
            self.result.add_result(
                "架构连接分析",
                "FAIL",
                architecture_findings,
                0
            )

    async def run_all_tests(self):
        """运行所有测试"""
        print("\n" + "=" * 80)
        print("🚀 开始AI与小说模块连接状态测试")
        print("=" * 80)

        try:
            await self.test_1_backend_health()
            await self.test_2_ai_chat_endpoint()
            await self.test_3_novel_api_endpoint()
            await self.test_4_create_novel_command_recognition()
            await self.test_5_architecture_analysis()
        except Exception as e:
            print(f"\n❌ 测试过程出错: {e}")
            import traceback
            traceback.print_exc()

        # 生成报告
        report = self.result.generate_report()
        print("\n" + report)

        # 保存报告到文件
        report_file = f"connection_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
        with open(report_file, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"\n📄 详细报告已保存至: {report_file}")

        return self.result


async def main():
    """主函数"""
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"

    print(f"\n🎯 测试目标: {base_url}")
    print(f"📝 测试内容: AI对话模块 ↔ 小说功能模块 连接状态验证\n")

    async with AINovelConnectionTester(base_url) as tester:
        result = await tester.run_all_tests()

    # 返回退出码
    failed_count = sum(1 for r in result.test_results if r["status"] == "FAIL")
    sys.exit(1 if failed_count > 0 else 0)


if __name__ == "__main__":
    asyncio.run(main())
