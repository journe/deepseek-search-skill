#!/usr/bin/env node
import { resolveCredential, describeSources } from './credentials.mjs';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const VALUE_OPTIONS = new Set(['count', 'ori-question', 'localization', 'max-chars', 'timeout', 'retries', 'base-url', 'api-key', 'agent']);
const STATUS_HINTS = {
  400: '请求头或请求体不合法',
  401: 'API Key 缺失或无效',
  402: '账号余额不足，请充值后重试',
  403: 'Fetch 请求被安全策略拒绝',
  404: '未能获取可用的网页内容',
  408: '读取请求体超时',
  413: '请求体超过大小限制',
  429: '超过 QPS 限制',
  500: '服务器内部错误',
  504: '下游请求超时',
};

const USAGE = `用法：
  node deepseek_search.mjs search "<查询词>" [选项]
  node deepseek_search.mjs fetch "<URL>" [选项]
  node deepseek_search.mjs doctor

search 选项：
  --count N              返回条数，1-50，默认 10
  --content              同时返回网页正文（need_content=true）
  --ori-question TEXT    用户原始问题（1-128 字符），帮助理解搜索意图
  --localization IP      优先返回该 IP 所在地的本地化结果
  --max-chars N          文本输出中每条正文的最大字符数，默认 2000，0 为不截断
  --json                 输出原始 JSON

通用选项：
  --api-key KEY          DeepSeek API Key，显式传入时优先
  --agent NAME           凭据来源：auto/codex/proxy/claude/opencode，默认 auto
  --base-url URL         API 地址，默认读取 DEEPSEEK_BASE_URL 或 https://api.deepseek.com
  --timeout MS           单次请求超时，默认 search 30000、fetch 60000
  --retries N            408/429/5xx 或网络错误的重试次数，默认 2
  -h, --help             显示帮助`;

class CliError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function parseArgs(argv) {
  const opts = { _: [], json: false, content: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { opts.json = true; continue; }
    if (arg === '--content') { opts.content = true; continue; }
    if (arg === '--help' || arg === '-h') { opts.help = true; continue; }
    if (!arg.startsWith('--')) { opts._.push(arg); continue; }
    const key = arg.slice(2);
    if (!VALUE_OPTIONS.has(key)) throw new CliError(`未知选项：${arg}\n\n${USAGE}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new CliError(`选项 ${arg} 缺少取值`);
    opts[key] = value;
    i += 1;
  }
  return opts;
}

function toInt(value, name, min, max, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new CliError(`${name} 必须是 ${min}-${max} 的整数`);
  }
  return parsed;
}

function charLength(text) {
  return Array.from(text).length;
}

function truncate(text, limit, flag = '--max-chars') {
  if (!text) return '';
  const chars = Array.from(text);
  if (limit === 0 || chars.length <= limit) return text;
  return `${chars.slice(0, limit).join('')}\n\n…（已截断，共 ${chars.length} 字符；用 ${flag} 0 查看全文）`;
}

function indent(text) {
  return text.split('\n').map((line) => `    ${line}`).join('\n');
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

function printJson(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function resolveApiKey(opts) {
  const credential = resolveCredential({ apiKey: opts['api-key'], agent: opts.agent || 'auto' });
  if (!credential) {
    throw new CliError('未找到可用的 DeepSeek API Key。可设置 DEEPSEEK_API_KEY，或配置 Codex/Claude/OpenCode 的 DeepSeek 供应商；也可用 --api-key 传入。');
  }
  return credential.key;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt) {
  return 500 * 2 ** attempt + Math.floor(Math.random() * 200);
}

function retryDelay(response, attempt) {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 10000);
  }
  return backoff(attempt);
}

function errorDetail(raw) {
  try {
    const data = JSON.parse(raw);
    return data?.error?.message || '';
  } catch {
    return raw.trim().slice(0, 300);
  }
}

async function callApi(path, payload, opts) {
  const apiKey = resolveApiKey(opts);
  const baseUrl = (opts['base-url'] || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const timeoutMax = path.endsWith('/fetch') ? 120000 : 60000;
  const timeoutMs = toInt(opts.timeout, '--timeout', 1000, timeoutMax, path.endsWith('/fetch') ? 60000 : 30000);
  const retries = toInt(opts.retries, '--retries', 0, 5, 2);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const reason = error.name === 'TimeoutError' ? `请求超时（${timeoutMs}ms）` : `网络错误：${error.message}`;
      if (attempt === retries) throw new CliError(reason, 1);
      await sleep(backoff(attempt));
      continue;
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new CliError('服务端响应不是合法 JSON', 1);
      }
    }

    const raw = await response.text();
    const hint = STATUS_HINTS[response.status] ? `（${STATUS_HINTS[response.status]}）` : '';
    const detail = errorDetail(raw);
    const message = `HTTP ${response.status}${hint}${detail ? `：${detail}` : ''}`;
    if (!RETRYABLE_STATUS.has(response.status) || attempt === retries) {
      throw new CliError(message, 1);
    }
    await sleep(retryDelay(response, attempt));
  }

  throw new CliError('请求失败', 1);
}

function printSearch(query, results, maxChars) {
  const lines = [`搜索：${query}`];
  if (!results.length) {
    lines.push('结果：0 条', '', '未找到匹配结果。');
    console.log(lines.join('\n'));
    return;
  }

  const quality = results.filter((item) => Number(item.rerank_score) >= 1.5).length;
  lines.push(`结果：${results.length} 条（高质量 ${quality} 条）`);
  results.forEach((item, index) => {
    const meta = [
      item.site_name,
      formatDate(item.date),
      Number.isInteger(item.authority) && item.authority >= 0 ? `权威度 ${item.authority}` : null,
      item.rerank_score !== undefined ? `相关度 ${item.rerank_score}` : null,
    ].filter(Boolean);
    lines.push('', `[${index + 1}] ${item.title || '(无标题)'}`, `    ${item.url}`);
    if (meta.length) lines.push(`    ${meta.join(' · ')}`);
    const bodyText = item.content || item.summary || item.snippet;
    if (bodyText) lines.push('', indent(truncate(bodyText, maxChars)));
  });
  console.log(lines.join('\n'));
}

async function runSearch(args, opts) {
  const query = args.join(' ').trim();
  const queryLength = charLength(query);
  if (queryLength < 1 || queryLength > 128) {
    throw new CliError('查询词长度必须为 1-128 个字符');
  }

  const count = toInt(opts.count, '--count', 1, 50, 10);
  const maxChars = toInt(opts['max-chars'], '--max-chars', 0, 1000000, 2000);
  const payload = { query, count, need_content: opts.content === true };
  if (opts['ori-question'] !== undefined) payload.ori_question = opts['ori-question'];
  if (opts.localization !== undefined) payload.localization = opts.localization;

  const data = await callApi('/v1/tools/search', payload, opts);
  const results = Array.isArray(data.results) ? data.results : [];
  if (opts.json) {
    printJson(data);
    return;
  }
  printSearch(query, results, maxChars);
}

async function runFetch(args, opts) {
  const url = args[0];
  if (!url) throw new CliError('fetch 需要提供网页 URL');
  if (url.length > 8192) throw new CliError('URL 长度不能超过 8192 个字符');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError(`URL 不合法：${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new CliError('URL 必须是含 host 的 HTTP/HTTPS 地址，且不能携带用户名或密码');
  }

  const maxChars = toInt(opts['max-chars'], '--max-chars', 0, 1000000, 20000);
  const data = await callApi('/v1/tools/fetch', { url }, opts);
  if (opts.json) {
    printJson(data);
    return;
  }

  const content = data.content || '';
  const body = content ? truncate(content, maxChars) : '（未提取到正文）';
  console.log(`# ${data.title || '(无标题)'}\n\n来源：${url}\n\n${body}`);
}

function runDoctor(opts) {
  const credential = resolveCredential({ apiKey: opts['api-key'], agent: opts.agent || 'auto' });
  const lines = [
    `Node.js：${process.version}`,
    `API Key：${credential ? `已配置（来源：${credential.source}）` : '未配置'}`,
    `Base URL：${opts['base-url'] || process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL}`,
  ];
  if (!credential) {
    lines.push(
      '',
      '可用配置方式：',
      '1. 设置环境变量 DEEPSEEK_API_KEY',
      '2. 在 Codex/Claude/OpenCode 中配置 DeepSeek 供应商（自动读取）',
      '3. 使用 --api-key 显式传入',
      '',
      '来源检查：',
      describeSources(),
    );
  }
  console.log(lines.join('\n'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }

  const agents = new Set(['auto', 'codex', 'proxy', 'claude', 'opencode']);
  if (opts.agent && !agents.has(opts.agent)) throw new CliError('--agent 必须是 auto/codex/proxy/claude/opencode');

  const [command, ...args] = opts._;
  if (command === 'search') return runSearch(args, opts);
  if (command === 'fetch') return runFetch(args, opts);
  if (command === 'doctor') return runDoctor(opts);
  throw new CliError(`未知命令：${command || '(空)'}\n\n${USAGE}`);
}

main().catch((error) => {
  const exitCode = error instanceof CliError ? error.exitCode : 1;
  console.error(`错误：${error.message}`);
  process.exit(exitCode);
});
