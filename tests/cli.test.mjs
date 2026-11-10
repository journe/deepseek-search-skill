import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert';

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(here, '..', 'scripts', 'deepseek_search.mjs');
let retryHits = 0;

const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const auth = req.headers.authorization;
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (auth !== 'Bearer test-key') {
      return send(401, { error: { message: 'invalid api key', type: 'authentication_error', param: null, code: 'authentication_error' } });
    }
    if (req.url === '/v1/tools/search') {
      if (body.query === 'empty') return send(200, { results: [] });
      if (body.query === 'retry') {
        retryHits += 1;
        if (retryHits < 3) return send(429, { error: { message: 'rate limited', type: 'rate_limit_error', param: null, code: 'rate_limit_error' } });
      }
      return send(200, { results: [
        { rerank_score: 2.4, title: 'DeepSeek V4 发布', url: 'https://example.com/a', snippet: 's', summary: '长摘要内容', content: body.need_content ? '正文内容' : '', site_name: 'Example', site_icon: null, date: '2026-06-01T00:00:00+00:00', authority: 3 },
        { rerank_score: 0.8, title: '普通结果', url: 'https://example.com/b', snippet: 's2', summary: '另一个摘要', content: '', site_name: null, site_icon: null, date: null, authority: -1 },
      ] });
    }
    if (req.url === '/v1/tools/fetch') {
      if (body.url.includes('missing')) return send(404, { error: { message: 'no content', type: 'invalid_request_error', param: null, code: 'not_found' } });
      if (body.url.includes('slow')) return setTimeout(() => send(200, { title: '慢页面', content: '# 慢' }), 1500);
      return send(200, { title: '示例文章', content: '# 示例文章\n\n正文段落。' });
    }
    return send(404, { error: { message: 'not found' } });
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dss-cli-'));
const emptyHome = path.join(sandbox, 'home');
fs.mkdirSync(emptyHome, { recursive: true });
const env = {
  ...process.env,
  DEEPSEEK_API_KEY: '',
  DEEPSEEK_BASE_URL: base,
  DEEPSEEK_PROXY_CONFIG: path.join(sandbox, 'missing.yaml'),
  CODEX_HOME: path.join(sandbox, 'codex'),
  USERPROFILE: emptyHome,
  HOME: emptyHome,
  XDG_DATA_HOME: path.join(sandbox, 'data'),
  APPDATA: path.join(sandbox, 'appdata'),
};

async function run(args, extraEnv = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: { ...env, ...extraEnv },
      timeout: 30000,
    });
    return { status: 0, stdout, stderr };
  } catch (error) {
    return { status: typeof error.code === 'number' ? error.code : 1, stdout: error.stdout || '', stderr: error.stderr || '' };
  }
}

let passed = 0;
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}

const noKey = await run(['doctor']);
await check('doctor 无 Key 提示', () => {
  assert.equal(noKey.status, 0);
  assert.match(noKey.stdout, /未配置/);
});

const missingKey = await run(['search', 'hello']);
await check('缺少 Key 退出码 2', () => {
  assert.equal(missingKey.status, 2);
  assert.match(missingKey.stderr, /未找到可用的 DeepSeek API Key/);
});

const badCount = await run(['search', 'hello', '--count', '0'], { DEEPSEEK_API_KEY: 'test-key' });
await check('count 越界退出码 2', () => {
  assert.equal(badCount.status, 2);
  assert.match(badCount.stderr, /--count/);
});

const longQuery = await run(['search', 'a'.repeat(129)], { DEEPSEEK_API_KEY: 'test-key' });
await check('query 超长退出码 2', () => {
  assert.equal(longQuery.status, 2);
  assert.match(longQuery.stderr, /1-128/);
});

const ok = await run(['search', 'hello', '--count', '2'], { DEEPSEEK_API_KEY: 'test-key' });
await check('搜索文本输出', () => {
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /DeepSeek V4 发布/);
  assert.match(ok.stdout, /高质量 1 条/);
  assert.match(ok.stdout, /权威度 3/);
  assert.match(ok.stdout, /长摘要内容/);
  assert.doesNotMatch(ok.stdout, /正文内容/);
});

const withContent = await run(['search', 'hello', '--content', '--max-chars', '4'], { DEEPSEEK_API_KEY: 'test-key' });
await check('need_content 与截断', () => {
  assert.equal(withContent.status, 0, withContent.stderr);
  assert.match(withContent.stdout, /正文内容/);
  assert.match(withContent.stdout, /已截断/);
});

const json = await run(['search', 'hello', '--json'], { DEEPSEEK_API_KEY: 'test-key' });
await check('JSON 输出可解析', () => {
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).results.length, 2);
});

const empty = await run(['search', 'empty'], { DEEPSEEK_API_KEY: 'test-key' });
await check('空结果退出码 0', () => {
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /未找到匹配结果/);
});

const retry = await run(['search', 'retry'], { DEEPSEEK_API_KEY: 'test-key' });
await check('429 自动重试后成功', () => {
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retryHits, 3);
  assert.match(retry.stdout, /DeepSeek V4 发布/);
});

const badKey = await run(['search', 'hello'], { DEEPSEEK_API_KEY: 'bad-key-123456' });
await check('401 不重试且退出码 1', () => {
  assert.equal(badKey.status, 1);
  assert.match(badKey.stderr, /HTTP 401/);
  assert.match(badKey.stderr, /API Key 缺失或无效/);
});

const fetched = await run(['fetch', `${base}/article`], { DEEPSEEK_API_KEY: 'test-key' });
await check('Fetch 输出标题与正文', () => {
  assert.equal(fetched.status, 0, fetched.stderr);
  assert.match(fetched.stdout, /# 示例文章/);
  assert.match(fetched.stdout, /正文段落/);
});

const badUrl = await run(['fetch', 'http://user:pass@example.com/a'], { DEEPSEEK_API_KEY: 'test-key' });
await check('URL 携带凭据被拒绝', () => {
  assert.equal(badUrl.status, 2);
  assert.match(badUrl.stderr, /不能携带用户名或密码/);
});

const notFound = await run(['fetch', `${base}/missing`], { DEEPSEEK_API_KEY: 'test-key' });
await check('Fetch 404 退出码 1', () => {
  assert.equal(notFound.status, 1);
  assert.match(notFound.stderr, /HTTP 404/);
});

const slow = await run(['fetch', `${base}/slow`, '--timeout', '1000', '--retries', '0'], { DEEPSEEK_API_KEY: 'test-key' });
await check('超时退出码 1 且提示超时', () => {
  assert.equal(slow.status, 1, slow.stderr);
  assert.match(slow.stderr, /请求超时/);
});

fs.rmSync(sandbox, { recursive: true, force: true });
server.close();
console.log(`\n${passed} 项通过`);
