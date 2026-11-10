# DeepSeek Search Skill

简体中文 | [English](README.en.md)

让 Codex、Claude Code、OpenCode 等支持 `SKILL.md` 的 Agent 调用 DeepSeek 官方 Search / Fetch API：搜索网页返回结构化结果，抓取网页返回 Markdown 正文。

- 零依赖：只需 Node.js 18+，无第三方包
- 免配置：自动复用本机已有的 DeepSeek 官方 Key
- 可控：支持站点、语言、时间范围等搜索语法，自动重试 429/5xx

## 安装

```bash
git clone https://github.com/journe/deepseek-search-skill.git ~/.codex/skills/deepseek-search
```

Claude Code 安装到 `~/.claude/skills/deepseek-search`，OpenCode 等支持 Agent Skills 的工具放入各自的 skills 目录。

## 无需配置 API Key

脚本按以下顺序查找 DeepSeek **官方** Key，找到即用：

1. `--api-key` 或环境变量 `DEEPSEEK_API_KEY`
2. Codex `~/.codex/config.toml` 中 `base-url` 指向 `*.deepseek.com` 的 Provider
3. 本地 CLI 代理配置（自动扫描常见路径的 `EasyCLIProxyAPI/cpa-core/config.yaml`，可用 `DEEPSEEK_PROXY_CONFIG` 指定）
4. Claude Code `~/.claude/settings.json`（仅当 `ANTHROPIC_BASE_URL` 指向 DeepSeek）
5. OpenCode `~/.local/share/opencode/auth.json`

只读取 `base-url` 为 `*.deepseek.com` 的条目，不会把其他供应商的 Key 发给 DeepSeek。用 `--agent auto|codex|proxy|claude|opencode` 限定来源。

检查当前可用的 Key 来源：

```bash
node scripts/deepseek_search.mjs doctor
```

`doctor` 只显示来源，不显示 Key 本身。

## 用法

```bash
# 搜索
node scripts/deepseek_search.mjs search "DeepSeek V4 发布" --count 5

# 带搜索语法
node scripts/deepseek_search.mjs search "DeepSeek site:github.com lang:zh after:2025"

# 同时返回正文
node scripts/deepseek_search.mjs search "Agent 框架对比" --content --max-chars 3000

# 抓取网页
node scripts/deepseek_search.mjs fetch "https://api-docs.deepseek.com/zh-cn/guides/search"

# 原始 JSON
node scripts/deepseek_search.mjs search "DeepSeek" --json
```

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--count N` | 返回 1-50 条，默认 10 |
| `--content` | 返回网页正文（`need_content=true`） |
| `--max-chars N` | 文本输出截断长度，`0` 为不截断 |
| `--ori-question TEXT` | 用户原始问题，帮助理解搜索意图 |
| `--agent NAME` | 限定凭据来源 |
| `--json` | 输出原始 JSON |

## 搜索语法

| 语法 | 示例 |
| --- | --- |
| 限定站点 | `DeepSeek site:github.com OR site:huggingface.co` |
| 排除站点 | `DeepSeek -site:example.com` |
| 精确短语 | `DeepSeek "release notes"` |
| 排除关键词 | `DeepSeek -广告` |
| 限定语言 | `DeepSeek lang:zh,en` |
| 时间范围 | `DeepSeek after:2025-01-01 before:2026-06-01` |

## 目录结构

```text
deepseek-search/
├── SKILL.md                     技能说明与使用策略
├── README.md
├── README.en.md                英文说明
├── LICENSE                      MIT 许可证
├── agents/openai.yaml           UI 元数据与自动调用策略
├── references/api.md            API 字段、错误码、计费与限速
└── scripts/
    ├── deepseek_search.mjs      CLI 入口
    └── credentials.mjs          多来源凭据解析
```

## 错误码

| HTTP | 含义 | 处理 |
| --- | --- | --- |
| 400 | 参数不合法 | 检查 `count`、`query` 长度 |
| 401 | Key 无效 | 运行 `doctor` 检查来源 |
| 402 | 余额不足 | 充值后重试 |
| 403/404 | Fetch 被拒绝或无法提取正文 | 换来源，不要重试 |
| 429 | 超过 QPS | 脚本自动退避重试 |
| 5xx | 服务端错误 | 脚本自动重试 |

## 计费

Search 与 Fetch 均按成功请求计费，5 元 / 1000 次。失败、无结果、超时不计费，`count` 不影响单价。

## 声明

本项目为个人封装的第三方工具，与 DeepSeek 官方无隶属关系。API 用法以 [官方文档](https://api-docs.deepseek.com/zh-cn/guides/search/) 为准。
