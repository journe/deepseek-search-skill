import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const cli = path.join(root, 'scripts', 'deepseek_search.mjs');
const modulePath = path.join(root, 'scripts', 'credentials.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dss-cred-'));
const home = path.join(tmp, 'home');
const codexHome = path.join(tmp, 'codex');
const dataHome = path.join(tmp, 'data');
const appData = path.join(tmp, 'appdata');

fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
fs.mkdirSync(codexHome, { recursive: true });
fs.mkdirSync(path.join(dataHome, 'opencode'), { recursive: true });
fs.mkdirSync(appData, { recursive: true });

fs.writeFileSync(path.join(codexHome, 'config.toml'), [
  'model_provider = "proxy"',
  '',
  '[model_providers.proxy]',
  'base_url = "http://127.0.0.1:8317/v1"',
  'experimental_bearer_token = "sk-proxy-token-123456"',
  '',
  '[model_providers.deepseek]',
  'name = "DeepSeek"',
  'base_url = "https://api.deepseek.com"',
  'experimental_bearer_token = "sk-codex-1234567890"',
].join('\n'), 'utf8');

const proxyFile = path.join(tmp, 'proxy.yaml');
fs.writeFileSync(proxyFile, [
  'api-keys:',
  '    codex:',
  '        - base-url: "https://api.deepseek.com"',
  '          disabled: true',
  '          keys:',
  '            - api-key: "sk-disabled-1234567890"',
  '          name: "disabled-deepseek"',
  '        - base-url: "https://api.deepseek.com"',
  '          keys:',
  '            - api-key: "sk-proxy-1234567890"',
  '          name: "codex-1"',
  '        - base-url: "https://open.bigmodel.cn/api/anthropic"',
  '          keys:',
  '            - api-key: "sk-other-1234567890"',
  '          name: "other"',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({
  env: {
    ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
    ANTHROPIC_AUTH_TOKEN: 'sk-claude-1234567890',
  },
}), 'utf8');

fs.writeFileSync(path.join(dataHome, 'opencode', 'auth.json'), JSON.stringify({
  deepseek: { type: 'api', key: 'sk-opencode-1234567890' },
}), 'utf8');

process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.CODEX_HOME = codexHome;
process.env.DEEPSEEK_PROXY_CONFIG = proxyFile;
process.env.XDG_DATA_HOME = dataHome;
process.env.APPDATA = appData;
process.env.DEEPSEEK_API_KEY = '';
process.chdir(tmp);

const mod = await import(pathToFileURL(modulePath).href);
let passed = 0;
function check(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; }
}

check('Codex 配置读取 DeepSeek provider', () => {
  const found = mod.resolveCredential({ agent: 'codex' });
  assert.equal(found.key, 'sk-codex-1234567890');
  assert.match(found.source, /Codex/);
});

check('代理配置跳过 disabled 与非 DeepSeek 项', () => {
  const found = mod.resolveCredential({ agent: 'proxy' });
  assert.equal(found.key, 'sk-proxy-1234567890');
  assert.match(found.source, /codex-1/);
});

check('Claude 配置读取 DeepSeek token', () => {
  const found = mod.resolveCredential({ agent: 'claude' });
  assert.equal(found.key, 'sk-claude-1234567890');
});

check('OpenCode 配置读取 deepseek key', () => {
  const found = mod.resolveCredential({ agent: 'opencode' });
  assert.equal(found.key, 'sk-opencode-1234567890');
});

check('auto 优先使用 Codex 配置', () => {
  const found = mod.resolveCredential({});
  assert.equal(found.key, 'sk-codex-1234567890');
});

check('显式 --api-key 优先级最高', () => {
  const found = mod.resolveCredential({ apiKey: 'sk-explicit-1234567890' });
  assert.equal(found.key, 'sk-explicit-1234567890');
});

check('环境变量优先于自动读取', () => {
  process.env.DEEPSEEK_API_KEY = 'sk-env-1234567890';
  const found = mod.resolveCredential({});
  assert.equal(found.key, 'sk-env-1234567890');
  process.env.DEEPSEEK_API_KEY = '';
});

check('占位符 Key 被拒绝', () => {
  const found = mod.resolveCredential({ apiKey: 'sk-...' });
  assert.equal(found, null);
});

check('--agent 非法值退出码 2', () => {
  const result = spawnSync(process.execPath, [cli, 'doctor', '--agent', 'bad'], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--agent/);
});

check('无任何配置时 doctor 显示未配置', () => {
  fs.rmSync(proxyFile);
  fs.rmSync(path.join(codexHome, 'config.toml'));
  fs.rmSync(path.join(home, '.claude', 'settings.json'));
  fs.rmSync(path.join(dataHome, 'opencode', 'auth.json'));
  const result = spawnSync(process.execPath, [cli, 'doctor'], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /API Key：未配置/);
  assert.match(result.stdout, /来源检查/);
});

process.chdir(os.tmpdir());
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} 项通过`);
