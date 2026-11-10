import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SOURCE_ORDER = ['codex', 'proxy', 'claude', 'opencode'];

function readText(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function readJson(file) {
  try { return JSON.parse(readText(file)); } catch { return null; }
}

function unquote(value) {
  const text = String(value ?? '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function isOfficialDeepSeek(url) {
  const host = hostOf(url);
  return host === 'api.deepseek.com' || host.endsWith('.deepseek.com');
}

export function validKey(value, source) {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  if (key.length < 8) return null;
  if (key.includes('${') || key.includes('$env') || key.includes('<')) return null;
  if (/^(your|xxx|changeme|placeholder|sk-\.\.\.)/i.test(key)) return null;
  return { key, source };
}

export function parseProxyConfig(text) {
  const providers = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();
    if (line.startsWith('- ')) {
      const body = line.slice(2).trim();
      const colon = body.indexOf(':');
      if (colon < 0) continue;
      const key = body.slice(0, colon).trim();
      const value = body.slice(colon + 1).trim();
      if ((key === 'base-url' || key === 'name') && (!current || indent <= current.baseIndent)) {
        current = { baseUrl: '', name: '', disabled: false, keys: [], baseIndent: indent };
        providers.push(current);
      }
      if (key === 'base-url' && current) current.baseUrl = unquote(value);
      else if (key === 'api-key' && current) current.keys.push(unquote(value));
      else if (key === 'name' && current && indent === current.baseIndent) current.name = unquote(value);
      continue;
    }
    const colon = line.indexOf(':');
    if (colon < 0 || !current) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (indent !== current.baseIndent + 2) continue;
    if (key === 'base-url') current.baseUrl = unquote(value);
    else if (key === 'disabled') current.disabled = value === 'true';
    else if (key === 'name') current.name = unquote(value);
  }
  return providers;
}

export function parseCodexProviders(text) {
  const providers = {};
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const section = line.match(/^\[model_providers\.([^\]]+)\]$/);
    if (section) { current = {}; providers[section[1]] = current; continue; }
    if (line.startsWith('[')) { current = null; continue; }
    if (!current) continue;
    const pair = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!pair) continue;
    let value = pair[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    current[pair[1]] = value;
  }
  return providers;
}

function proxyPaths() {
  const explicit = process.env.DEEPSEEK_PROXY_CONFIG;
  if (explicit) return [explicit];
  const home = os.homedir();
  const bases = [home, process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean);
  const paths = [];
  for (const base of bases) paths.push(path.join(base, 'EasyCLIProxyAPI', 'cpa-core', 'config.yaml'));
  if (process.platform === 'win32') {
    for (const drive of ['C:', 'D:', 'E:', 'F:']) {
      paths.push(path.join(`${drive}\\`, 'EasyCLIProxyAPI', 'cpa-core', 'config.yaml'));
    }
  }
  paths.push(path.join(home, '.easycli', 'cpa-core', 'config.yaml'));
  paths.push(path.join(home, '.cli-proxy-api', 'config.yaml'));
  paths.push(path.join(home, '.config', 'cli-proxy-api', 'config.yaml'));
  return [...new Set(paths)];
}

export function findProxyCredential() {
  for (const file of proxyPaths()) {
    const text = readText(file);
    if (!text) continue;
    const target = parseProxyConfig(text).find(
      (item) => !item.disabled && item.keys.length && isOfficialDeepSeek(item.baseUrl),
    );
    if (target) {
      const found = validKey(target.keys[0], `本地代理配置（${target.name || 'DeepSeek'}）`);
      if (found) return found;
    }
  }
  return null;
}

export function findCodexCredential() {
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const providers = parseCodexProviders(readText(path.join(home, 'config.toml')));
  for (const [name, config] of Object.entries(providers)) {
    if (!isOfficialDeepSeek(config.base_url)) continue;
    const found = validKey(
      config.experimental_bearer_token || config.bearer_token,
      `Codex 配置（${name}）`,
    );
    if (found) return found;
  }
  return null;
}

export function findClaudeCredential() {
  const files = [
    path.join(os.homedir(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.json'),
    path.join(process.cwd(), '.claude', 'settings.local.json'),
  ];
  for (const file of files) {
    const data = readJson(file);
    const env = data && data.env;
    if (!env || !isOfficialDeepSeek(env.ANTHROPIC_BASE_URL)) continue;
    const found = validKey(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY, 'Claude 配置');
    if (found) return found;
  }
  return null;
}

export function findOpenCodeCredential() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const files = [
    path.join(dataHome, 'opencode', 'auth.json'),
    ...(process.env.APPDATA ? [path.join(process.env.APPDATA, 'opencode', 'auth.json')] : []),
  ];
  for (const file of files) {
    const data = readJson(file);
    if (!data || typeof data !== 'object') continue;
    for (const [name, entry] of Object.entries(data)) {
      if (!name.toLowerCase().includes('deepseek') || !entry || typeof entry !== 'object') continue;
      const found = validKey(entry.key || entry.apiKey || entry.token, `OpenCode 配置（${name}）`);
      if (found) return found;
    }
  }
  return null;
}

const FINDERS = {
  codex: findCodexCredential,
  proxy: findProxyCredential,
  claude: findClaudeCredential,
  opencode: findOpenCodeCredential,
};

export function resolveCredential({ apiKey, agent = 'auto' } = {}) {
  if (apiKey) return validKey(apiKey, '命令行参数 --api-key');
  const fromEnv = validKey(process.env.DEEPSEEK_API_KEY, '环境变量 DEEPSEEK_API_KEY');
  if (fromEnv) return fromEnv;
  if (agent && agent !== 'auto') {
    return FINDERS[agent] ? FINDERS[agent]() : null;
  }
  for (const name of SOURCE_ORDER) {
    const found = FINDERS[name]();
    if (found) return found;
  }
  return null;
}

export function describeSources() {
  return SOURCE_ORDER.map((name) => {
    const found = FINDERS[name]();
    return `${name}：${found ? `可用（${found.source}）` : '未找到'}`;
  }).join('\n');
}
