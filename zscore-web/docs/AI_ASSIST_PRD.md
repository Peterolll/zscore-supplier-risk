# Z-Score AI 辅助提取系统 PRD

> 版本：1.0 | 更新：2026-08-27

---

## 1. 背景与目标

### 1.1 问题陈述

Z-Score 供应商信用评估系统通过 Python 引擎（pdfplumber / pypdf）从财报 PDF 中自动提取 10 个核心财务科目。但实际使用中存在三类提取失败场景：

| 场景 | 占比 | 原因 |
|------|------|------|
| 扫描件 / 图片 PDF | ~30% | pdfplumber 无法提取文本层 |
| 非标准格式财报 | ~15% | 科目名称不匹配 / 表格嵌套复杂 |
| 合并报表拆分 | ~10% | 需跨多页聚合数字 |

原流程依赖人工手动查找并填入数字，效率低且易出错。

### 1.2 目标

引入 AI 大模型（视觉 + 文本双路）自动补全提取失败的字段，**人工确认后**写入数据库。

- 提取成功率从 ~55% 提升至 >90%
- 单字段补全延迟 < 15 秒
- 支持任意 OpenAI-compatible API 端点（不绑定单一供应商）
- AI 建议不自动覆盖已有值，需用户显式采纳

---

## 2. 系统架构

### 2.1 分层设计

```
┌─────────────────────────────────────────────────────────┐
│  前端层 (Next.js App Router)                              │
│  ├─ 详情页：字段级 🤖 按钮 + 采纳/忽略操作                   │
│  ├─ 设置页：Provider 选择 + API Key + 测试连接             │
│  └─ 全局 AI 分析按钮（批量补全空缺字段）                     │
├─────────────────────────────────────────────────────────┤
│  API 层 (Route Handlers)                                  │
│  ├─ POST /api/runs/[id]/ai-analyze  → AI 分析端点         │
│  ├─ GET/POST/DELETE /api/settings/ai-key  → 配置 CRUD    │
│  ├─ POST /api/settings/ai-key/test  → 连通性测试          │
│  └─ POST /api/analyze  → 原始 Python 引擎提取             │
├─────────────────────────────────────────────────────────┤
│  AI 客户端层                                              │
│  ├─ ai-client.ts     → 视觉/文本模型调用 + 5 层校验        │
│  ├─ ai-prompts.ts    → 约束化 Prompt 模板                 │
│  └─ PDF 工具函数     → pdftoppm (PDF→PNG) / pdftotext     │
├─────────────────────────────────────────────────────────┤
│  配置管理层                  │  外部 AI API               │
│  ├─ ai-config.ts  → 多 Provider  │  ├─ 智谱 GLM           │
│  └─ ai-config.json → 本地持久化   │  ├─ 并行科技            │
│                                  │  ├─ DeepSeek          │
│                                  │  ├─ Moonshot          │
│                                  │  └─ 自定义端点          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 模块清单

| 文件 | 职责 | 关键导出 |
|------|------|----------|
| `lib/ai-config.ts` | 多 Provider 配置管理（读写/迁移/脱敏） | `getAiConfig()`, `saveAiConfig()`, `PROVIDER_PRESETS` |
| `lib/ai-client.ts` | 通用 OpenAI-compatible 客户端 | `callVisionModel()`, `callTextModel()`, `testApiConnection()` |
| `lib/ai-prompts.ts` | 约束化 Prompt 模板 | `buildVisionSystemPrompt()`, `buildTextSystemPrompt()` |
| `app/api/runs/[id]/ai-analyze/route.ts` | AI 分析编排端点 | POST handler |
| `app/api/settings/ai-key/route.ts` | 配置 CRUD | GET/POST/DELETE |
| `app/api/settings/ai-key/test/route.ts` | 连通性测试 | POST handler |
| `components/SettingsClient.tsx` | 设置页 UI | default component |
| `components/EditableRunDetail.tsx` | 详情页 AI 交互 | `handleAiAnalyze()`, `acceptAiSuggestion()` |

---

## 3. 工作流

### 3.1 主流程

```
用户上传 PDF
    ↓
Python 引擎提取（pdfplumber）
    ↓
字段完整性检查 → 所有字段都有值？
    ├─ 是 → 计算 Z-Score → 展示结果
    └─ 否 → 展示"⚠ N 项数字待确认"横幅
              ↓
         用户选择分析方式：
         ├─ 全局"🤖 AI 分析补全" → 只分析空缺字段
         └─ 单字段"🤖"按钮 → 强制分析该字段（即使有值）
              ↓
         AI 双路并行分析：
         ├─ 视觉 OCR：PDF → PNG (pdftoppm) → Vision 模型
         └─ 文本分析：PDF → 全文 (pdftotext) → Text 模型
              ↓
         文本为空？→ 自动 fallback 到 OCR
              ↓
         合并去重（OCR > Analyze）
              ↓
         5 层校验 + 会计恒等推算
              ↓
         返回建议（含 value/evidence/confidence）
              ↓
         前端展示：蓝色高亮 + evidence 原文 + 采纳/忽略按钮
              ↓
         用户确认 → 采纳 → 填入输入框
                   忽略 → 清除建议
              ↓
         保存 → PATCH 写回 DB（method=manual）→ 重算 Z
```

### 3.2 关键设计决策

#### D1: AI 建议不自动写入

AI 返回的建议值**不直接写入数据库**，而是填入前端输入框（蓝色高亮），用户必须点击"保存修改"才会通过 PATCH 端点写入（标记 `method=manual`）。

**理由**：AI 可能返回错误数字（如量级错误、币种混淆），人工确认是必要的质量门。

#### D2: 双路并行 + 自动 Fallback

- `mode=both`：视觉 OCR 和文本分析同时执行，合并去重
- `mode=analyze` 但 PDF 文本为空 → 自动 fallback 到 OCR
- 合并优先级：`ai_ocr > ai_analyze > ai_derived`

**理由**：电子 PDF 走文本路径更快更准；扫描件必须走 OCR；自动 fallback 避免用户需手动切换模式。

#### D3: 字段级 AI 分析

每个字段旁有独立 🤖 按钮，点击只对该字段调 AI（`fields: ["field_key"]`），不影响其他字段。

**两种模式区别**：
- 全局按钮 → 只分析 `value==null` 的空缺字段
- 单字段按钮 → **强制分析**该字段，即使已有值

**理由**：用户可能想用 AI 重新验证某个可疑数字，而不影响其他已确认的字段。

#### D4: 只覆盖空缺字段

全局 AI 分析时，`isFieldEmpty()` 判定只有 `value==null` 才算缺失。已有值的字段不发给 AI，AI 返回的建议也只保留空缺字段。

**理由**：避免 AI 建议覆盖用户已手工确认的正确值。

---

## 4. Prompt 约束设计

### 4.1 约束规则（7 条硬约束）

| # | 约束 | 实现方式 |
|---|------|----------|
| 1 | 字段白名单 | Prompt 中列出允许的字段名；`parseAiResponse` 中 `allowed.has(field_key)` 过滤 |
| 2 | JSON-only 输出 | Prompt 明确禁止解释性文字；`parseAiResponse` 用正则提取 JSON 数组兼容 |
| 3 | 金额归一 | Prompt 要求以"元"为单位去逗号；前端显示时人工核对 |
| 4 | 未知即 null | Prompt 要求找不到设 null；`parseAiResponse` 中 `typeof x.value === "number"` 校验 |
| 5 | evidence 原文追溯 | Prompt 要求填原文行；前端展示 evidence 便于核对 |
| 6 | confidence 分档 | 1.0/0.85/0.7 三档语义；前端显示 confidence 分数 |
| 7 | 会计恒等推导 | Prompt 包含推导规则；后端 `ai_derived` 补充 EBIT |

### 4.2 调用参数

```json
{
  "model": "GLM-4V-Flash",
  "messages": [
    { "role": "system", "content": "<约束化 system prompt>" },
    { "role": "user", "content": "<图片/文本 + 字段列表>" }
  ],
  "temperature": 0.1,
  "max_tokens": 1024
}
```

- `temperature: 0.1` — 降低随机性，提高提取一致性
- `max_tokens: 1024` — 兼容并行科技 GLM-4V-Flash 限制

### 4.3 视觉模型 System Prompt 示例

```
你是一名财务报表分析专家。请仔细查看提供的财报图片，提取以下科目的数字。

## 字段白名单
仅允许返回以下字段，不得编造其他字段名：
  - "current_assets" (流动资产合计)
  - "current_liabilities" (流动负债合计)
  ...

## 输出格式（严格遵守）
仅返回 JSON 数组，每项格式如下：
[{"field_key":"current_assets","value":12266099.57,"evidence":"流动资产合计 12,266,099.57","confidence":1.0}]

## 规则
1. 金额以"元"为单位，去除千分位逗号
2. 如果找不到某科目，value 必须设为 null，不得猜测
3. evidence 填原始文本行
4. confidence：1.0=直接命中 / 0.85=子项求和 / 0.7=推算
5. field_key 必须与白名单完全一致
6. 不得输出任何解释性文字、Markdown 标记
7. 图片不清晰时所有字段 value 设为 null
```

---

## 5. 校验机制

### 5.1 五层校验

| 层 | 位置 | 校验内容 | 失败处理 |
|----|------|----------|----------|
| L1 | `parseAiResponse` | field_key 在白名单中 | 丢弃该条目 |
| L2 | `parseAiResponse` | value 是 number 类型 | value 设为 null |
| L3 | `parseAiResponse` | JSON 数组可解析 | 返回 `PARSE_NO_ARRAY` 错误 |
| L4 | `ai-analyze/route.ts` | 双路合并去重（OCR > Analyze） | 取高优先级 |
| L5 | `ai-analyze/route.ts` | 会计恒等推算（EBIT = PBT + 利息） | 补充 `ai_derived` 建议 |

### 5.2 已知薄弱点（待加强）

| # | 问题 | 严重度 | 建议方案 |
|---|------|--------|----------|
| 1 | 无金额量级校验 | 高 | 对比 evidence 中原始数字和 value，量级差 >100 倍时标记 warning |
| 2 | 无会计恒等式校验 | 中 | 资产 ≠ 负债+权益 时在返回中标记 `balance_check: false` |
| 3 | confidence 语义不可靠 | 中 | 后端根据 evidence 长度/匹配度重新计算 confidence |
| 4 | PDF 文本截断 | 低 | `pdfText.slice(0, 8000)` 可能截掉关键科目，改为分页提取 |
| 5 | 无重试机制 | 低 | API 429/500 时重试 1 次 |

---

## 6. API 接口规范

### 6.1 AI 分析端点

```
POST /api/runs/[runId]/ai-analyze
```

**请求体**：
```json
{
  "mode": "ocr" | "analyze" | "both",    // 可选，默认 both
  "fields": ["current_assets", "revenue"] // 可选，指定字段时强制分析（即使有值）
}
```

**响应**：
```json
{
  "ok": true,
  "suggestions": [
    {
      "field_key": "current_assets",
      "field_label": "流动资产合计",
      "value": 12266099.57,
      "confidence": 1.0,
      "evidence": "流动资产合计 12,266,099.57",
      "method": "ai_ocr"
    }
  ],
  "missing_fields": ["current_assets", "revenue"],
  "models_used": ["GLM-4V-Flash"],
  "errors": ["Analyze: PDF 文本提取为空"],
  "api_key_masked": "sk-J5j****"
}
```

**ok 判定逻辑**：
- 有建议 → `ok=true`（即使部分路径有 errors）
- 无建议 + 有 errors → `ok=false` + 返回 `error`/`message`
- 无建议 + 无 errors → `ok=true`（AI 正常返回但没找到值）

### 6.2 配置 CRUD

```
GET /api/settings/ai-key
→ { ok, data: { provider, base_url, vision_model, text_model, masked_key, configured, presets[] } }

POST /api/settings/ai-key
body: { provider, base_url, api_key, vision_model, text_model }
→ { ok, data: { provider, base_url, ..., masked_key } }

DELETE /api/settings/ai-key
→ { ok: true }
```

### 6.3 连通性测试

```
POST /api/settings/ai-key/test
body: { base_url, api_key, model }        // 测试指定配置
body: { use_saved: true }                 // 用已保存配置测试

→ { ok: true, latency_ms: 1748, model_response: "好的" }
→ { ok: false, error: "令牌已过期", latency_ms: 111 }
```

---

## 7. 前端交互

### 7.1 设置页

| 元素 | 说明 |
|------|------|
| Provider 下拉 | 5 个预设（智谱/OpenAI/Deepseek/Moonshot/自定义），切换时自动填充 base_url + 模型名 |
| Base URL 输入 | OpenAI-compatible 端点地址 |
| 视觉模型输入 | 如 `GLM-4V-Flash` / `gpt-4o-mini` |
| 文本模型输入 | 如 `GLM-5.2` / `gpt-4o-mini` |
| API Key 输入 | password 类型，已配置时显示脱敏值 |
| 🔌 测试连接按钮 | 发送最小请求验证 key，显示延迟 + 模型回复 |
| 保存配置按钮 | 写入 `data/ai-config.json` |
| 当前状态卡片 | 脱敏展示当前配置 |

### 7.2 详情页 — 字段级 AI 交互

每个可编辑字段旁有 🤖 按钮：

```
┌──────────────────────────────────────────┐
│ 流动资产 [人工补录]               🤖      │
│ ┌──────────────────────────────────────┐ │
│ │ 126008432.01                         │ │  ← 蓝色高亮（AI 建议）
│ └──────────────────────────────────────┘ │
│ 💡 流动资产合计 12,266,099.57             │  ← evidence 原文
│ [✓ 采纳] [✗ 忽略]                        │  ← 操作按钮
└──────────────────────────────────────────┘
```

**状态流转**：
1. 点击 🤖 → 按钮变为 ⏳ → 后端调 AI
2. AI 返回 → 输入框蓝色高亮 + 显示 evidence + 采纳/忽略按钮
3. 采纳 → 建议值写入输入框（待保存）
4. 忽略 → 清除建议，恢复原值
5. 保存 → 写入 DB（method=manual）→ 重算 Z-Score

### 7.3 全局 AI 分析

顶部横幅"⚠ N 项数字待人工确认"区域有三个按钮：
- **🤖 AI 分析补全**（both 模式）— 批量分析所有空缺字段
- **仅文本分析**（analyze 模式）
- **仅 OCR 识别**（ocr 模式）

全局分析只覆盖 `value==null` 的空缺字段，已有值的不动。

---

## 8. 配置管理

### 8.1 配置优先级

```
1. 环境变量（最高）
   ZSCORE_AI_API_KEY / ZSCORE_AI_BASE_URL / ZSCORE_AI_VISION_MODEL / ZSCORE_AI_TEXT_MODEL

2. 配置文件
   data/ai-config.json

3. 默认值（最低）
   智谱 GLM（base_url: open.bigmodel.cn, vision: glm-4v-flash, text: glm-4-flash）
```

### 8.2 配置文件格式

```json
{
  "provider": "custom",
  "base_url": "https://llmapi.paratera.com",
  "api_key": "sk-xxx",
  "vision_model": "GLM-4V-Flash",
  "text_model": "GLM-5.2",
  "updated_at": "2026-08-27T00:00:00.000Z"
}
```

### 8.3 向后兼容

旧格式 `{ "zhipu_api_key": "xxx" }` 自动迁移为新格式（`migrateOldFormat`）。

旧导出 `getZhipuApiKey()` / `hasZhipuKey()` / `saveZhipuApiKey()` 仍可用，内部转发到新接口。

---

## 9. 安全设计

| 维度 | 措施 |
|------|------|
| API Key 存储 | 本地 `data/ai-config.json`，不上传服务器，`.gitignore` 排除 |
| API Key 展示 | 脱敏（前 6 + 后 4，中间 ****） |
| PDF 路径处理 | `execFileSync` + 数组参数，杜绝命令注入 |
| 文件上传 | 大小限制 50MB，扩展名 + MIME 校验 |
| API 响应 | 统一 `{ ok, data }` 格式，敏感信息不外泄 |
| 配置文件 | 仅本机文件系统，无网络传输 |

---

## 10. 已知限制与未来规划

### 10.1 当前限制

- `max_tokens: 1024` 限制单次返回字段数（10 个字段接近上限）
- PDF 文本截取前 8000 字符，长财报可能遗漏后半部分科目
- 无金额量级校验（AI 可能返回少 3 个零的数字）
- 无重试机制（API 429/500 直接失败）
- 无异步任务队列（长 PDF 分析可能超时）

### 10.2 路线图

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P1 | 金额量级校验 | 对比 evidence 原始数字和 value，差异 >100 倍时 warning |
| P1 | 会计恒等式校验 | 资产 ≠ 负债+权益 时标记 `balance_check: false` |
| P2 | 分页文本提取 | 超长 PDF 按 4000 字符分页提取，合并结果 |
| P2 | API 重试 | 429/500 时自动重试 1 次，间隔 2 秒 |
| P2 | 批量分析进度 | 前端显示 "分析中 3/10" 进度条 |
| P3 | 异步任务队列 | 长 PDF 改为后台任务 + WebSocket 推送结果 |
| P3 | 多模型投票 | 同一字段调用 2+ 模型，取一致结果 |
| P3 | 历史建议缓存 | 同一 PDF 重复分析时命中缓存 |
