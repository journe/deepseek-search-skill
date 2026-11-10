# DeepSeek Search / Fetch API 参考

来源：<https://api-docs.deepseek.com/zh-cn/guides/search/>

## 端点与鉴权

Base URL：`https://api.deepseek.com`

| API | 方法与端点 |
| --- | --- |
| Search | `POST /v1/tools/search` |
| Fetch | `POST /v1/tools/fetch` |

请求头：

| 请求头 | 必填 | 值 |
| --- | --- | --- |
| `Authorization` | 是 | `Bearer <DeepSeek API Key>` |
| `Content-Type` | 是 | `application/json` |

两个接口都是原始 JSON API，使用与 DeepSeek 开放平台相同的 Bearer 鉴权。

## Search 请求

```bash
curl -s https://api.deepseek.com/v1/tools/search \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query":"DeepSeek V4 模型 发布","count":5,"need_content":true}'
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `query` | string | 是 | - | 搜索词，1-128 个 Unicode 字符，不能全为空白 |
| `count` | integer | 否 | 10 | 返回条数，1-50 |
| `ori_question` | string | 否 | - | 用户原始问题，1-128 字符，帮助理解意图；`null` 视为未提供 |
| `localization` | string | 否 | `""` | 用于优先返回本地化结果的 IP 地址 |
| `need_content` | boolean | 否 | false | 是否在 `content` 中返回网页正文；false 时恒为空字符串 |

未知字段会被忽略。

### 搜索语法

| 操作符 | 示例 | 说明 |
| --- | --- | --- |
| `site:` | `DeepSeek site:github.com` | 限定站点；多个用空格分隔并通过 `OR` 连接 |
| `-site:` | `DeepSeek -site:example.com` | 排除站点；多个用空格分隔 |
| `-` | `DeepSeek -广告` | 排除含关键词的网页 |
| `-"..."` | `DeepSeek -"release notes"` | 排除含短语的网页 |
| `"..."` | `DeepSeek "精确短语"` | 精确匹配短语 |
| `lang:` | `DeepSeek lang:zh,en` | 限定语言，逗号分隔 |
| `after:` | `DeepSeek after:2025-01-01` | 发布日期下限，支持年份或完整日期 |
| `before:` | `DeepSeek before:2026-06-01` | 发布日期上限 |

### Search 响应

成功返回 HTTP 200 与 `results` 数组；无匹配时返回空数组。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `rerank_score` | number | 排序分数 0-3，综合相关性、权威性、时效性；`>= 1.5` 为优质 |
| `title` | string | 标题 |
| `url` | string | 结果链接 |
| `snippet` | string | 短摘要，约 100-200 字符，适合前端展示 |
| `summary` | string | 长摘要，约 600-800 字符，适合模型阅读 |
| `content` | string | 网页正文；`need_content` 为 false 或正文缺失时为空字符串 |
| `site_name` | string 或 null | 站点名称 |
| `site_icon` | string 或 null | 站点图标 URL |
| `date` | string 或 null | 发布时间，UTC 的 RFC 3339 格式 |
| `authority` | integer | 权威性 0-4，`-1` 表示未知；`>= 3` 为极权威 |

## Fetch 请求

```bash
curl -s https://api.deepseek.com/v1/tools/fetch \
  -H "Authorization: Bearer $DEEPSEEK_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article"}'
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `url` | string | 是 | 网页地址，不超过 8192 字符；必须是含 host 的 HTTP/HTTPS URL，不能携带用户名或密码 |

响应：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 页面标题，缺失时为空字符串 |
| `content` | string | 抓取后的 Markdown 正文 |

Fetch 的结果受目标站点可用性和访问策略影响。

## 错误格式

错误响应使用 OpenAI 兼容格式，`param` 恒为 `null`：

```json
{
  "error": {
    "message": "'count' must be between 1 and 50",
    "type": "invalid_request_error",
    "param": null,
    "code": "invalid_request_error"
  }
}
```

## 错误码

| HTTP | 说明 | 是否重试 |
| --- | --- | --- |
| 400 | 请求头或请求体不合法，包括 JSON 错误或字段值无效 | 否 |
| 401 | API Key 缺失或无效 | 否 |
| 402 | 账号余额不足 | 否，先充值 |
| 403 | Fetch 请求被安全策略拒绝 | 否 |
| 404 | Fetch 未获取到可用网页内容 | 否，换来源 |
| 408 | 读取请求体超时 | 是 |
| 413 | 请求体超过大小限制 | 否 |
| 429 | 超过 Search/Fetch 的 QPS 限制 | 是，降低频率 |
| 500 | 服务器内部错误 | 是 |
| 504 | 下游请求超时 | 是 |

## 计费

Search 与 Fetch 均按请求次数计费，不按 token 或结果条数计费：

| API | 计费单位 | 价格 |
| --- | --- | --- |
| Search | 每 1,000 次成功请求 | 5 元 |
| Fetch | 每 1,000 次成功请求 | 5 元 |

只有 HTTP 200 且产生结果（Search 的 `results` 非空，Fetch 返回正文）才计费；失败、无结果、超时不计费。`count` 不影响单次价格。

## 限速

| API | QPS 限制 |
| --- | --- |
| Search | 100 |
| Fetch | 25 |

QPS 按账号计算，与 API Key 无关，并与模型并发限制独立。超过限制返回 HTTP 429。Fetch 还会对目标域名单独限速。