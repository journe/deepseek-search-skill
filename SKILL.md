---
name: deepseek-search
description: 使用 DeepSeek 官方 Search/Fetch API 进行联网搜索，获取实时网页结果或抓取网页 Markdown 正文。当用户要求搜索/搜一下/查最新消息、获取训练数据之外的近期信息、按站点/语言/时间范围检索、核实事实，或读取某个网页的具体内容时使用；不用于本地文件或代码库检索。
metadata:
  short-description: DeepSeek 实时网页搜索与正文抓取
---

# DeepSeek 网页搜索与抓取

通过 DeepSeek 的 Search / Fetch API 获取实时网页内容。这是纯 HTTP 服务，任何模型或 Agent 都可以调用，不依赖 DeepSeek 模型本身。

## 前置条件

默认无需额外配置 Key：脚本会按顺序读取本机已有的 DeepSeek 官方 Key：

1. `--api-key` 或环境变量 `DEEPSEEK_API_KEY`（显式配置优先）
2. Codex `~/.codex/config.toml` 中 DeepSeek provider 的 `experimental_bearer_token`
3. 本地 CLI 代理配置（自动扫描常见位置的 `EasyCLIProxyAPI/cpa-core/config.yaml`，也可用 `DEEPSEEK_PROXY_CONFIG` 指定路径）
4. Claude Code 的 `~/.claude/settings.json`（仅当 `ANTHROPIC_BASE_URL` 指向 DeepSeek）
5. OpenCode 的 `~/.local/share/opencode/auth.json`

只读取 `base-url` 为 `*.deepseek.com` 的配置项，不会把其他供应商的 Key 发给 DeepSeek。用 `--agent auto|codex|proxy|claude|opencode` 限定来源，默认 `auto`。

脚本只依赖 Node.js 18+，无第三方包。下文命令中的脚本路径相对于本 skill 目录。先检查环境：

```bash
node scripts/deepseek_search.mjs doctor
```

`doctor` 会显示 Key 来源，但不显示 Key 本身。只有所有来源都未找到时，才需要设置 `DEEPSEEK_API_KEY`；不要猜测或伪造 Key。

## 搜索网页

```bash
node scripts/deepseek_search.mjs search "DeepSeek V4 模型 发布" --count 5
```

常用参数：

- `--count N`：返回 1-50 条，默认 10
- `--json`：输出原始 JSON，需要程序化处理时使用
- `--content`：同时返回网页正文（`need_content`），上下文开销大，建议配合较小的 count
- `--max-chars N`：文本输出中每条正文的最大字符数，默认 2000，`0` 为不截断
- `--ori-question TEXT`：用户原始问题，帮助搜索引擎理解意图

默认文本输出包含标题、URL、站点、日期、权威度、相关度与长摘要，通常足够回答问题和给出来源。

## 搜索语法

`query` 支持以下操作符，可在一个查询中组合：

| 语法 | 作用 | 示例 |
| --- | --- | --- |
| `site:` | 限定站点，多个用 `OR` | `DeepSeek site:github.com OR site:huggingface.co` |
| `-site:` | 排除站点 | `DeepSeek -site:example.com` |
| `"..."` | 精确短语 | `"release notes"` |
| `-` | 排除关键词 | `DeepSeek -广告` |
| `-"..."` | 排除短语 | `-"release notes"` |
| `lang:` | 限定语言 | `lang:zh,en` |
| `after:` | 发布日期下限 | `after:2025` 或 `after:2025-01-01` |
| `before:` | 发布日期上限 | `before:2026-06-01` |

## 抓取网页正文

```bash
node scripts/deepseek_search.mjs fetch "https://example.com/article"
```

返回页面标题与 Markdown 正文，默认截断到 20000 字符；`--max-chars 0` 获取全文。

## 使用策略

- 先搜索并读 `summary`，确认目标来源后再 `fetch`，避免无谓的正文抓取和上下文膨胀。
- 需要交叉验证时增加 `count`，优先采用相关度 `>= 1.5`、权威度 `>= 3` 的结果。
- 时效性问题加 `after:`，中文资料加 `lang:`，限定来源用 `site:`。
- 回答时引用结果 URL；摘要不是全文，不要把摘要当作原文直接引用。
- 返回空 `results` 表示确实没有匹配，应改写查询，而不是重试同一请求。
- 脚本已自动重试 408/429/5xx 和网络错误；其余 4xx 重试也不会成功。

## 错误处理

| 状态码 | 含义 | 处理 |
| --- | --- | --- |
| 400 | 参数或 JSON 不合法 | 检查 `count`、`query` 长度等参数 |
| 401 | Key 缺失或无效 | 运行 `doctor` 检查 Key 来源 |
| 402 | 余额不足 | 提示用户充值，不要重试 |
| 403/404 | Fetch 被拒绝或无法提取正文 | 换一个来源，不要重试 |
| 429 | 超过 QPS | 降低调用频率后重试 |
| 5xx | 服务端错误 | 稍后重试 |

Search 与 Fetch 均为只读请求。每次成功调用计费 0.005 元（5 元/1000 次），失败、无结果和超时不计费，`count` 不影响单价；不要对同一问题反复调用。

## 在其他 Agent 中使用

把整个 `deepseek-search` 目录复制到目标 Agent 的 skills 目录即可，例如 Codex 的 `~/.codex/skills/` 或 Claude Code 的 `~/.claude/skills/`。脚本会自动读取该环境中已有的 Codex / Claude / OpenCode / 本地代理 DeepSeek Key，通常无需额外配置。

如果目标环境没有任何上述配置，再设置 `DEEPSEEK_API_KEY` 或用 `--api-key` 传入。任何能执行 shell 的模型都可以直接调用脚本；没有 Node 时，可按 `references/api.md` 中的 curl 示例直接请求。

## 参考

- `references/api.md`：完整字段、响应结构、错误码、计费、限速与 curl 示例
