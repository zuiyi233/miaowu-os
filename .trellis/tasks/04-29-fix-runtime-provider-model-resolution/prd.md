# PRD - 修复 runtime provider 场景下的 model resolution 误判

## 背景
在 `D:\miaowu-os\deer-flow-main` 中，用户在前端 AI 设置选择某供应商模型后，模型实际可连通并能返回；但后端部分路径仍抛出：
`ValueError: Model LongCat-Flash-Chat not found in config`。

## 目标
当“用户 AI 设置中的活动供应商 + 运行时 base_url/api_key/model_name”可用时，后端不应因 `config.yaml` 静态 `models[]` 列表缺失该模型而失败。

## 需求
1. 定位抛错来源：明确哪个接口/中间件路径仍依赖 `config.yaml` 静态模型查找并触发 ValueError。
2. 最小修复：优先走 runtime provider 覆盖（runtime model/base_url/api_key）；仅在 runtime provider 不可用时才回退静态 config 模型解析。
3. 保持兼容：不改动无关调用链，不回滚当前工作区已有未提交改动。
4. 回归测试：补充/更新后端测试，覆盖“model_name 不在 config.yaml，但 runtime provider 可用”的成功路径。
5. 验证：运行最小必要测试并记录结果。

## 非目标
- 不做无关重构。
- 不修改前端行为。

## 验收标准
- 相关后端路径在 runtime provider 可用时不再抛 `Model ... not found in config`。
- 新增/更新测试可稳定覆盖该回归场景。
- 最终报告包含：改动文件、核心逻辑、测试命令与结果、剩余风险。
