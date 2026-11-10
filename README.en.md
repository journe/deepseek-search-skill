# DeepSeek Search Skill

An Agent Skill that lets Codex, Claude Code, OpenCode, and any other `SKILL.md`-compatible agent call DeepSeek's official Search and Fetch APIs: search the web for structured results, or fetch a page as Markdown.

- Zero dependencies: Node.js 18+ only, no third-party packages
- No extra setup: reuses the DeepSeek official key already configured on your machine
- Controllable: supports site, language, and date-range search operators, with automatic retries on 429/5xx

[简体中文](README.md) | English

## Install

```bash
git clone https://github.com/journe/deepseek-search-skill.git ~/.codex/skills/deepseek-search
```

For Claude Code, clone into `~/.claude/skills/deepseek-search`. Other Agent Skills hosts can use their own skills directory.

## No API key setup required

The script looks up an **official** DeepSeek key in the following order and uses the first one it finds:

1. `--api-key` or the `DEEPSEEK_API_KEY` environment variable
2. The Codex provider in `~/.codex/config.toml` whose `base-url` points to `*.deepseek.com`
3. Local CLI proxy config (auto-scans the usual `EasyCLIProxyAPI/cpa-core/config.yaml` locations; override with `DEEPSEEK_PROXY_CONFIG`)
4. Claude Code `~/.claude/settings.json` (only when `ANTHROPIC_BASE_URL` points to DeepSeek)
5. OpenCode `~/.local/share/opencode/auth.json`

Only entries whose `base-url` is `*.deepseek.com` are read, so keys from other providers are never sent to DeepSeek. Use `--agent auto|codex|proxy|claude|opencode` to restrict the source.

Check which sources are available:

```bash
node scripts/deepseek_search.mjs doctor
```

`doctor` shows the key source but never the key itself.

## Usage

```bash
# Search
node scripts/deepseek_search.mjs search "DeepSeek V4 release" --count 5

# Search with operators
node scripts/deepseek_search.mjs search "DeepSeek site:github.com lang:en after:2025"

# Include page content
node scripts/deepseek_search.mjs search "agent framework comparison" --content --max-chars 3000

# Fetch a page
node scripts/deepseek_search.mjs fetch "https://api-docs.deepseek.com/zh-cn/guides/search"

# Raw JSON
node scripts/deepseek_search.mjs search "DeepSeek" --json
```

Common options:

| Option | Description |
| --- | --- |
| `--count N` | 1-50 results, default 10 |
| `--content` | Return page content (`need_content=true`) |
| `--max-chars N` | Truncate text output; `0` disables truncation |
| `--ori-question TEXT` | Original user question, improves intent understanding |
| `--agent NAME` | Restrict the credential source |
| `--json` | Output raw JSON |

## Search operators

| Operator | Example |
| --- | --- |
| Restrict to sites | `DeepSeek site:github.com OR site:huggingface.co` |
| Exclude sites | `DeepSeek -site:example.com` |
| Exact phrase | `DeepSeek "release notes"` |
| Exclude keyword | `DeepSeek -ads` |
| Restrict language | `DeepSeek lang:zh,en` |
| Date range | `DeepSeek after:2025-01-01 before:2026-06-01` |

## Layout

```text
deepseek-search/
├── SKILL.md                     Skill instructions and usage strategy
├── README.md                    Chinese README
├── README.en.md                 English README
├── LICENSE                      MIT
├── agents/openai.yaml           UI metadata and implicit invocation policy
├── references/api.md            API fields, error codes, billing, rate limits
├── scripts/
│   ├── deepseek_search.mjs      CLI entry point
│   ├── credentials.mjs          Multi-source credential resolution
│   └── release.ps1              One-command release script
└── tests/
    ├── cli.test.mjs             CLI behavior tests
    └── credentials.test.mjs     Credential resolution tests
```

## Tests

Tests start a local mock server and do not consume real API quota.

```bash
node tests/cli.test.mjs
node tests/credentials.test.mjs
```

## Release

The release script validates the repo, runs tests, creates a tag, pushes, and publishes a GitHub Release:

```powershell
# Dry run: validate and test only
pwsh scripts/release.ps1 1.0.1 -DryRun

# Publish with auto-generated notes
pwsh scripts/release.ps1 1.0.1

# Publish with custom notes
pwsh scripts/release.ps1 1.0.1 -NotesFile ./release-notes.md
```

Requirements: on `main`, clean working tree, tag must not exist, and `gh` must be authenticated.

## Error codes

| HTTP | Meaning | Action |
| --- | --- | --- |
| 400 | Invalid parameters | Check `count`, `query` length |
| 401 | Invalid key | Run `doctor` to check the source |
| 402 | Insufficient balance | Top up and retry |
| 403/404 | Fetch rejected or no extractable content | Try another source, do not retry |
| 429 | QPS limit exceeded | The script backs off and retries automatically |
| 5xx | Server error | The script retries automatically |

## Billing

Search and Fetch are billed per successful request at CNY 5 per 1,000 requests. Failed requests, empty results, and timeouts are not billed, and `count` does not affect the unit price.

## Disclaimer

This is an unofficial community wrapper and is not affiliated with DeepSeek. See the [official API docs](https://api-docs.deepseek.com/zh-cn/guides/search/) for authoritative behavior.
