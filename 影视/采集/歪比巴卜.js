/**
 * @name 歪比巴卜
 * @key wbbb
 * @type 4
 * @api /video/wbbb
 * @searchable 1
 * @quickSearch 1
 * @changeable 0
 * @version 1.0.3
 * @downloadURL https://github.com/Silent1566/OmniBox-Spider/raw/main/影视/采集/歪比巴卜.js
 */

let OmniBox;
try {
  OmniBox = require('omnibox_sdk');
} catch (_) {
  OmniBox = {
    log(level, message) {
      console.log(`[${level}] ${message}`);
    },
  };
}
let runner;
try {
  runner = require('spider_runner');
} catch (_) {
  runner = { run() {} };
}
const axios = require('axios');
const http = require('http');
const https = require('https');
const vm = require('vm');
const CryptoJS = require('crypto-js');

const SITE = {
  key: 'wbbb',
  name: '歪比巴卜',
  api: '/video/wbbb',
  host: 'https://wbbb1.com',
  ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  timeout: 20000,
};

const CATS = [
  { type_id: '1', type_name: '电影' },
  { type_id: '2', type_name: '剧集' },
  { type_id: '3', type_name: '动漫' },
  { type_id: '4', type_name: '综艺' },
];

const LINE_DIRECT_RE = /^(?:lzm3u8|bfzym3u8)$/i;

const httpClient = axios.create({
  timeout: SITE.timeout,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  validateStatus: () => true,
  headers: {
    'User-Agent': SITE.ua,
    'Referer': `${SITE.host}/`,
    'Accept-Language': 'zh-CN,zh;q=0.9',
  },
});

function ok(res) {
  if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
  return res.data || '';
}

async function getHtml(url) {
  const full = /^https?:\/\//.test(url) ? url : `${SITE.host}${url}`;
  const res = await httpClient.get(full);
  return ok(res);
}

function pickMatch(str, reg, idx = 1, def = '') {
  const m = str.match(reg);
  return m ? (m[idx] || def) : def;
}

function stripTags(str = '') {
  return String(str)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanSlashText(str = '') {
  return stripTags(str)
    .replace(/\s*\/\s*/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .trim();
}

function escapeRegExp(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toProtocolRelativeUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';
  if (raw.startsWith('//')) return raw;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      return `//${u.host}${u.pathname}${u.search}${u.hash}`;
    } catch (_) {}
  }
  if (raw.startsWith('/')) {
    try {
      return `//${new URL(SITE.host).host}${raw}`;
    } catch (_) {}
  }
  return raw;
}

function redactSensitive(value = '') {
  return String(value == null ? '' : value)
    .replace(/([?&](?:url|key|vkey|ckey|token|play|player|auth|sign)=)([^&]+)/ig, '$1[REDACTED]')
    .replace(/(cookie\s*[:=]\s*)([^;\n]+)/ig, '$1[REDACTED]')
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, (token) => `[REDACTED:${token.length}]`);
}

function redactJson(value) {
  try {
    return redactSensitive(JSON.stringify(value));
  } catch (_) {
    return redactSensitive(String(value || ''));
  }
}

function buildCookieHeader(setCookie) {
  return (Array.isArray(setCookie) ? setCookie : [])
    .map((item) => String(item || '').split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

function isInvalidWbbbLineName(name = '') {
  const value = stripTags(String(name || '')).replace(/\s+/g, '').trim();
  return !value || /^(?:排序|选择播放源|切换播放源|更多|展开|收起)$/i.test(value);
}

function buildWbbbEpisode(item = '') {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    const playUrl = absUrl(item.playUrl || item.playId || item.url || item.id || '');
    const name = stripTags(item.name || '').trim();
    if (!playUrl || !name) return null;
    return { name, id: playUrl, playId: playUrl, playUrl, url: playUrl };
  }
  const text = String(item || '').trim();
  if (!text) return null;
  const sep = text.indexOf('$');
  if (sep < 0) return null;
  const name = text.slice(0, sep).trim();
  const playUrl = absUrl(text.slice(sep + 1).trim());
  if (!name || !playUrl) return null;
  return { name, id: playUrl, playId: playUrl, playUrl, url: playUrl };
}

function buildWbbbPlaySource(lineName, items, idx = 0) {
  if (isInvalidWbbbLineName(lineName)) return null;
  const name = stripTags(String(lineName || '')).replace(/\s+/g, ' ').trim() || `线路${idx + 1}`;
  const seen = new Set();
  const episodes = [];
  for (const item of Array.isArray(items) ? items : []) {
    const episode = buildWbbbEpisode(item);
    if (!episode || seen.has(episode.playId)) continue;
    seen.add(episode.playId);
    episodes.push(episode);
  }
  if (!episodes.length) return null;
  return {
    name,
    url: episodes.map((episode) => `${episode.name}$${episode.playUrl}`).join('#'),
    episodes,
  };
}

function extractCurrentEpisodeName(html = '', vodName = '') {
  const activeText = stripTags(pickMatch(html, /<a[^>]+module-play-list-link[^"']*active[^"']*[^>]*>([\s\S]*?)<\/a>/i, 1, ''));
  const fallbackText = stripTags(pickMatch(html, /(?:正在播放|当前播放)[^：:]*[：:]\s*([\s\S]*?)(?:<|$)/i, 1, ''));
  let episodeName = activeText || fallbackText;
  if (vodName && episodeName) {
    episodeName = episodeName.replace(new RegExp(`^${escapeRegExp(vodName)}\s*`), '').trim();
    episodeName = episodeName.replace(new RegExp(`^《?${escapeRegExp(vodName)}》?\s*`), '').trim();
  }
  return episodeName.trim();
}

function buildWbbbResolveTitle(html = '', player = {}) {
  const vodName = String(player?.vod_data?.vod_name || '').trim();
  const episodeName = extractCurrentEpisodeName(html, vodName);
  const title = `在线播放${vodName}${episodeName ? ` ${episodeName}` : ''}`.trim();
  return title || vodName || '在线播放';
}

function createWbbbVmSandbox(pageUrl) {
  const noop = () => {};
  const jq = function jqStub() {
    return {
      on: noop,
      hide: noop,
      show: noop,
      html: noop,
      text: noop,
      click: noop,
      append: noop,
      remove: noop,
      css: noop,
      attr: noop,
      addClass: noop,
      removeClass: noop,
      find: () => ({}),
      val: () => '',
      ready: noop,
      length: 0,
    };
  };
  jq.post = noop;
  jq.ajax = noop;
  jq.get = noop;
  jq.fn = {};
  const loc = new URL(pageUrl);
  const sandbox = {
    console,
    CryptoJS,
    URL,
    URLSearchParams,
    atob: (text) => Buffer.from(text, 'base64').toString('binary'),
    btoa: (text) => Buffer.from(text, 'binary').toString('base64'),
    setTimeout: noop,
    setInterval: () => 0,
    clearTimeout: noop,
    clearInterval: noop,
    fetch: async () => ({ ok: true, status: 200, headers: new Map(), text: async () => '', json: async () => ({}) }),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    sessionStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { userAgent: SITE.ua, clipboard: { writeText: async () => {} } },
    document: {
      title: 'wbbb-parser',
      body: {},
      addEventListener: noop,
      querySelector: () => null,
      createElement: () => ({ style: {}, click: noop }),
      getElementById: () => ({ style: {}, addEventListener: noop, play: async () => {}, pause: noop }),
    },
    location: {
      origin: loc.origin,
      pathname: loc.pathname,
      search: loc.search,
      href: loc.toString(),
      host: loc.host,
    },
    window: null,
    top: null,
    parent: null,
    self: null,
    $: jq,
    jQuery: jq,
    Artplayer() {
      return {
        on: noop,
        once: noop,
        emit: noop,
        destroy: noop,
        template: {},
        plugins: {},
        setting: { show: noop },
        controls: { add: noop },
        layers: { add: noop },
        events: { proxy: noop },
        notice: { show: noop },
        storage: { get: () => null, set: noop },
      };
    },
    animation: {},
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  sandbox.parent = sandbox;
  sandbox.self = sandbox;
  return sandbox;
}

async function getWbbbResolveRuntime(parsePageUrl, parseHtml) {
  const settingSrc = pickMatch(parseHtml, /<script[^>]+src=["']([^"']*setting\.js[^"']*)["']/i, 1, '');
  if (!settingSrc) throw new Error('setting.js missing');
  const settingUrl = new URL(settingSrc, parsePageUrl).toString();
  const settingRes = await httpClient.get(settingUrl, {
    headers: {
      'User-Agent': SITE.ua,
      'Referer': parsePageUrl,
    },
  });
  const settingCode = `${ok(settingRes)}\n;globalThis.__wbbbResolveRuntime={ urlValueurl, keyValue, vkeyValue, ckeyValue, nextParam, titleParam };`;
  const sandbox = createWbbbVmSandbox(parsePageUrl);
  vm.createContext(sandbox);
  vm.runInContext(settingCode, sandbox, { timeout: 5000 });
  const runtime = {
    ...(sandbox.__wbbbResolveRuntime || {}),
    decrypt: typeof sandbox.decrypt === 'function' ? sandbox.decrypt.bind(sandbox) : null,
    deplay: typeof sandbox.deplay === 'function' ? sandbox.deplay.bind(sandbox) : null,
  };
  if (!runtime.urlValueurl || !runtime.keyValue || !runtime.vkeyValue || !runtime.ckeyValue) {
    throw new Error('setting runtime params missing');
  }
  return runtime;
}

function absUrl(url = '') {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${SITE.host}${url}`;
  return `${SITE.host}/${url}`;
}

function normalizeVodFromCard(block) {
  const vod_id = pickMatch(block, /href="\/detail\/(\d+)\.html"/, 1, '');
  const vod_name = stripTags(pickMatch(block, /<div class="module-(?:poster-item-title|card-item-title)">([\s\S]*?)<\/div>/, 1, '')) || pickMatch(block, /alt="([^"]+)"/, 1, '');
  const vod_pic = absUrl(pickMatch(block, /(?:data-original|data-src|src)="([^"]+)"/, 1, ''));
  const vod_remarks = stripTags(pickMatch(block, /<div class="module-item-note">([\s\S]*?)<\/div>/, 1, ''));
  return { vod_id, vod_name, vod_pic, vod_remarks };
}

function parseCards(html) {
  const list = [];
  const reg = /<a href="\/detail\/(\d+)\.html" title="([^"]+)" class="module-poster-item module-item">([\s\S]*?)<\/a>/g;
  let m;
  while ((m = reg.exec(html)) !== null) {
    const block = m[0];
    list.push({
      vod_id: m[1],
      vod_name: m[2],
      vod_pic: absUrl(pickMatch(block, /(?:data-original|data-src|src)="([^"]+)"/, 1, '')),
      vod_remarks: stripTags(pickMatch(block, /<div class="module-item-note">([\s\S]*?)<\/div>/, 1, '')),
    });
  }
  if (list.length) return list;

  const reg2 = /<div class="module-card-item module-item">([\s\S]*?)<\/div>\s*<\/div>/g;
  while ((m = reg2.exec(html)) !== null) {
    const vod = normalizeVodFromCard(m[1]);
    if (vod.vod_id && vod.vod_name) list.push(vod);
  }
  return list;
}

/**
 * 解析播放标签（线路）名称。
 *
 * 原实现只匹配了两种特定的 HTML 结构，导致在页面结构略有变化时返回空数组，
 * 从而使得后续的播放线路名全部回退为默认的 "线路N"，甚至导致播放列表
 * 完全为空。这里改用更宽松的正则捕获所有带有 `module-tab-item` 类的 div，
 * 优先读取 `data-dropdown-value`，没有则取标签内部文字（去除 HTML）。
 */
function parseTabs(detailHtml) {
  const tabs = [];
  // 捕获包含 class="module-tab-item"（或其它组合） 的 div 块
  const reg = /<div[^>]*class=["'][^"'>]*\bmodule-tab-item\b[^"'>]*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = reg.exec(detailHtml)) !== null) {
    const block = m[0];
    // 先尝试 data-dropdown-value 属性
    const value = pickMatch(block, /data-dropdown-value\s*=\s*['"]([^'"]+)['"]/i, 1, '').trim();
    if (value) {
      if (!isInvalidWbbbLineName(value)) tabs.push(value);
      continue;
    }
    // 否则提取块内部的文字作为名称（去除标签）
    const inner = stripTags(m[1] || '').trim();
    if (inner && !isInvalidWbbbLineName(inner)) tabs.push(inner);
  }
  // 若仍未解析到任何线路，保持空数组，后续逻辑会使用兜底方案
  return tabs;
}

function parsePlayGroups(detailHtml) {
  const groups = [];
  const blockReg = /<div class="module-play-list-content[^\"]*">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = blockReg.exec(detailHtml)) !== null) {
    const block = m[1];
    const items = [];
    const aReg = /<a[^>]+class="module-play-list-link[^\"]*"[^>]+href="([^\"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let a;
    while ((a = aReg.exec(block)) !== null) {
      const href = absUrl(a[1]);
      const label = stripTags(a[2]).trim();
      if (!href || !label) continue;
      items.push(`${label}$${href}`);
    }
    if (items.length) groups.push(items);
  }

  if (groups.length) return groups;

  const hrefOnly = [...detailHtml.matchAll(/<a[^>]+href="([^\"]*\/(?:vplay|play)\/[^\"#]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  if (hrefOnly.length) {
    return [hrefOnly.map((mm) => `${stripTags(mm[2]).trim() || '播放'}$${absUrl(mm[1])}`)];
  }
  return groups;
}

function parsePlayer(html) {
  const patterns = [
    /var\s+player_aaaa\s*=\s*(\{.*?\})<\/script>/s,
    /var\s+player_.*?=\s*(\{.*?\})<\/script>/s,
    /player_aaaa\s*=\s*(\{.*?\})\s*;/s,
    /player_data\s*=\s*(\{.*?\})\s*;/s,
  ];
  for (const reg of patterns) {
    const m = html.match(reg);
    if (!m) continue;
    try { return JSON.parse(m[1]); } catch (_) {}
  }
  return null;
}

function decodePlayUrl(raw, encrypt) {
  let url = String(raw || '').trim();
  const enc = String(encrypt || '').trim();
  if (enc === '1') {
    try { url = unescape(url); } catch (_) {}
  } else if (enc === '2') {
    try { url = Buffer.from(url, 'base64').toString('utf8'); } catch (_) {}
    try { url = unescape(url); } catch (_) {}
  }
  if (url.startsWith('//')) url = `https:${url}`;
  else if (url.startsWith('/')) url = absUrl(url);
  return url;
}

function isDirectMediaUrl(url, fromOrType) {
  const value = String(url || '').trim();
  const hint = String(fromOrType || '').trim();
  if (!value) return false;
  if (/\.(?:m3u8|mp4|m4v|m4a|mp3|flv|avi|mkv|mov|webm)(?:[?#]|$)/i.test(value)) return true;
  if (/^(?:m3u8|mp4|m4v|m4a|mp3|flv|avi|mkv|mov|webm)$/i.test(hint) && /^https?:\/\//i.test(value)) return true;
  if (LINE_DIRECT_RE.test(hint)) return true;
  try {
    const u = new URL(value);
    return /\.(?:m3u8|mp4|m4v|m4a|mp3|flv|avi|mkv|mov|webm)(?:$|\?)/i.test(u.pathname + u.search);
  } catch (_) {
    return false;
  }
}

function decodeAesMaybeBase64(value = '') {
  const text = String(value || '').trim();
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(text) && text.length % 4 === 0) {
    try { return CryptoJS.enc.Base64.parse(text); } catch (_) {}
  }
  return CryptoJS.enc.Utf8.parse(text);
}

async function resolveWbbbPlayerUrl(playerToken, nextUrl, title) {
  const nextParam = toProtocolRelativeUrl(nextUrl);
  const titleParam = String(title || '').trim();
  const parsePageUrl = `https://xn--qvr2v.850088.xyz/player/?url=${encodeURIComponent(playerToken)}${nextParam ? `&next=${encodeURIComponent(nextParam)}` : ''}${titleParam ? `&title=${encodeURIComponent(titleParam)}` : ''}`;
  const parseRes = await httpClient.get(parsePageUrl, {
    headers: {
      'User-Agent': SITE.ua,
      'Referer': `${SITE.host}/`,
    },
  });
  const parseHtml = ok(parseRes);
  const parserCookie = buildCookieHeader(parseRes.headers?.['set-cookie']);
  const runtime = await getWbbbResolveRuntime(parsePageUrl, parseHtml);
  const payloadUrl = runtime.urlValueurl || `${String(playerToken || '').trim()}${nextParam ? `&next=${nextParam}` : ''}`;
  const apiUrl = 'https://xn--qvr2v.850088.xyz/player/api.php';
  const formPayload = {
    url: payloadUrl,
    key: runtime.keyValue,
    vkey: runtime.vkeyValue,
    ckey: runtime.ckeyValue,
  };
  OmniBox.log('info', `[wbbb][resolve][request] ${redactJson({ parsePageUrl, apiUrl, headers: { Origin: 'https://xn--qvr2v.850088.xyz', Referer: parsePageUrl, 'X-Requested-With': 'XMLHttpRequest', Cookie: parserCookie || '' }, payload: formPayload })}`);
  const formData = new URLSearchParams(formPayload).toString();
  const apiRes = await httpClient.post(apiUrl, formData, {
    headers: {
      'User-Agent': SITE.ua,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': parsePageUrl,
      'Origin': 'https://xn--qvr2v.850088.xyz',
      ...(parserCookie ? { Cookie: parserCookie } : {}),
    },
  });
  const payload = typeof apiRes.data === 'string' ? JSON.parse(apiRes.data) : apiRes.data;
  OmniBox.log('info', `[wbbb][resolve][payload] ${redactJson(payload)}`);
  if (!payload || Number(payload.code) !== 200 || !payload.url) {
    throw new Error(payload && payload.msg ? payload.msg : 'parse api failed');
  }
  const encUrl = String(payload.url || '').trim();
  let finalUrl = '';
  if (encUrl && runtime && typeof runtime.decrypt === 'function') {
    try {
      finalUrl = (runtime.decrypt(encUrl) || '').trim();
      try { finalUrl = decodeURIComponent(finalUrl); } catch (_) {}
    } catch (_) {}
  }
  if (!finalUrl && encUrl && runtime && typeof runtime.deplay === 'function') {
    try {
      const decodedKey = String(runtime.deplay(payload.aes_key || '') || '').trim();
      const decodedIv = String(runtime.deplay(payload.aes_iv || '') || '').trim();
      if (decodedKey && decodedIv) {
        const decrypted = CryptoJS.AES.decrypt(encUrl, CryptoJS.enc.Utf8.parse(decodedKey), {
          iv: CryptoJS.enc.Utf8.parse(decodedIv),
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        });
        finalUrl = (decrypted.toString(CryptoJS.enc.Utf8) || '').trim();
        try { finalUrl = decodeURIComponent(finalUrl); } catch (_) {}
      }
    } catch (_) {}
  }
  if (!finalUrl) {
    const aesKey = decodeAesMaybeBase64(payload.aes_key || '');
    const aesIv = decodeAesMaybeBase64(payload.aes_iv || '');
    if (encUrl && aesKey && aesIv) {
      try {
        const decrypted = CryptoJS.AES.decrypt(encUrl, aesKey, {
          iv: aesIv,
          mode: CryptoJS.mode.CBC,
          padding: CryptoJS.pad.Pkcs7,
        });
        finalUrl = (decrypted.toString(CryptoJS.enc.Utf8) || '').trim();
        try { finalUrl = decodeURIComponent(finalUrl); } catch (_) {}
      } catch (_) {}
    }
  }
  if (!finalUrl && /^https?:\/\//i.test(encUrl)) finalUrl = encUrl;
  if (!finalUrl) {
    try { finalUrl = decodeURIComponent(encUrl); } catch (_) {
      finalUrl = encUrl;
    }
  }
  if (finalUrl.startsWith('//')) finalUrl = `https:${finalUrl}`;
  if (finalUrl.startsWith('/')) finalUrl = absUrl(finalUrl);
  if (!isDirectMediaUrl(finalUrl, payload.type || '')) finalUrl = parsePageUrl;
  OmniBox.log('info', `[wbbb][resolve][final] ${redactJson({ type: payload.type || '', url: finalUrl, parsePageUrl })}`);
  return { url: finalUrl, type: payload.type || '', parsePageUrl };
}

async function home(params = {}) {
  OmniBox.log('info', `[wbbb][home] params=${JSON.stringify(params)}`);
  try {
    const html = await getHtml('/');
    const list = parseCards(html).slice(0, 40);
    return { class: CATS, list };
  } catch (e) {
    OmniBox.log('error', `[wbbb][home] error=${e.message}`);
    return { class: CATS, list: [], error: e.message || String(e) };
  }
}

async function category(params = {}) {
  OmniBox.log('info', `[wbbb][category] params=${JSON.stringify(params)}`);
  try {
    const id = params.id || params.t || params.type_id || params.categoryId || '1';
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    const path = page > 1 ? `/show/${id}--------${page}---.html` : `/show/${id}-----------.html`;
    OmniBox.log('info', `[wbbb][category] url=${SITE.host}${path}`);
    const html = await getHtml(path);
    const list = parseCards(html);
    OmniBox.log('info', `[wbbb][category] id=${id} page=${page} count=${list.length}`);
    const hasNext = html.includes('title="下一页"');
    return { list, page, pagecount: hasNext ? page + 1 : page, total: list.length };
  } catch (e) {
    OmniBox.log('error', `[wbbb][category] error=${e.message}`);
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    return { list: [], page, pagecount: page, total: 0, error: e.message || String(e) };
  }
}

async function detail(params = {}) {
  OmniBox.log('info', `[wbbb][detail][01] 入口参数 params=${JSON.stringify(params)}`);
  try {
    OmniBox.log('info', '[wbbb][detail][02] 开始解析视频 ID');
    let ids = [];
    if (Array.isArray(params.id)) ids = params.id;
    else if (Array.isArray(params.ids)) ids = params.ids;
    else if (params.ids) ids = String(params.ids).split(',').map((s) => s.trim()).filter(Boolean);
    else if (params.id) ids = String(params.id).split(',').map((s) => s.trim()).filter(Boolean);
    else if (params.vod_id) ids = String(params.vod_id).split(',').map((s) => s.trim()).filter(Boolean);
    else if (params.videoId) ids = String(params.videoId).split(',').map((s) => s.trim()).filter(Boolean);
    else if (params.video_id) ids = String(params.video_id).split(',').map((s) => s.trim()).filter(Boolean);
    OmniBox.log('info', `[wbbb][detail][03] 解析到 ids=${JSON.stringify(ids)}`);

    if (!ids.length) {
      OmniBox.log('warn', '[wbbb][detail][04] 未解析到任何视频 ID，直接返回空列表');
      return { list: [] };
    }

    const list = [];
    for (const rawId of ids) {
      const mediaId = String(rawId).trim();
      const detailPath = `/detail/${mediaId}.html`;
      OmniBox.log('info', `[wbbb][detail][05] 准备请求详情页 mediaId=${mediaId}, url=${SITE.host}${detailPath}`);
      const html = await getHtml(detailPath);
      OmniBox.log('info', `[wbbb][detail][06] 详情页请求完成 mediaId=${mediaId}, htmlLength=${String(html || '').length}, hasVplay=${String(html || '').includes('/vplay/')}`);

      OmniBox.log('info', '[wbbb][detail][07] 开始解析基础信息：标题/封面/简介/标签/导演/主演');
      const vod_name = stripTags(pickMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/, 1, ''));
      const vod_pic = absUrl(pickMatch(html, /<div class="module-item-pic">[\s\S]*?<img[^>]+data-original="([^\"]+)"/, 1, ''))
        || absUrl(pickMatch(html, /<div class="module-item-pic">[\s\S]*?<img[^>]+(?:data-src|src)="([^\"]+)"/, 1, ''));
      const vod_content = stripTags(pickMatch(html, /<div class="module-info-introduction-content[^>]*>([\s\S]*?)<\/div>/, 1, ''));
      const tagLinks = [...html.matchAll(/<div class="module-info-tag-link">([\s\S]*?)<\/div>/g)].map(x => x[1]);
      const vod_year = stripTags(tagLinks[0] || '');
      const vod_area = stripTags(tagLinks[1] || '');
      const vod_type = cleanSlashText(tagLinks[2] || '');
      const vod_remarks = stripTags(pickMatch(html, /<div class="module-item-note">([\s\S]*?)<\/div>/, 1, '')) || stripTags(pickMatch(html, /\u66f4\u65b0\u81f3[^<\s]+/, 0, ''));
      const vod_director = cleanSlashText(pickMatch(html, /\u5bfc\u6f14：[\s\S]*?<div[^>]*class="module-info-item-content">([\s\S]*?)<\/div>/, 1, ''));
      const vod_actor = cleanSlashText(pickMatch(html, /\u4e3b\u6f14：[\s\S]*?<div[^>]*class="module-info-item-content">([\s\S]*?)<\/div>/, 1, ''));
      OmniBox.log('info', `[wbbb][detail][08] 基础信息完成 mediaId=${mediaId}, name=${vod_name || '空'}, pic=${vod_pic ? '有' : '空'}, contentLen=${vod_content.length}, tags=${tagLinks.length}`);

      OmniBox.log('info', '[wbbb][detail][09] 开始解析播放线路 tabs');
      const tabs = parseTabs(html);
      OmniBox.log('info', `[wbbb][detail][10] tabs 解析完成 count=${tabs.length}, tabs=${tabs.join(' / ') || '空'}`);

      OmniBox.log('info', '[wbbb][detail][11] 开始解析播放分组 groups');
      const groups = parsePlayGroups(html);
      OmniBox.log('info', `[wbbb][detail][12] groups 解析完成 count=${groups.length}, episodeCounts=${groups.map(g => g.length).join('/') || '空'}`);

      let playSources = [];
      OmniBox.log('info', '[wbbb][detail][13] 开始组装 vod_play_from / vod_play_url');
      groups.forEach((items, idx) => {
        const lineName = tabs[idx] || `线路${idx + 1}`;
        const source = buildWbbbPlaySource(lineName, items, idx);
        if (!source) {
          OmniBox.log('warn', `[wbbb][detail][13-${idx}] 跳过无效播放组 idx=${idx}, lineName=${lineName}, itemCount=${Array.isArray(items) ? items.length : 0}`);
          return;
        }
        playSources.push(source);
      });
      // 如果结构化分组解析失败，再直接抓取页面中所有 /vplay/ 或 /play/ 链接作为单线路兜底。
      if (playSources.length === 0) {
        const seenFallback = new Set();
        const fallbackItems = [...html.matchAll(/<a[^>]+href=["']([^"']*\/(?:vplay|play)\/[^"']+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .map((m, index) => {
            const href = absUrl(m[1]);
            const name = stripTags(m[2]).trim() || `第${index + 1}集`;
            if (!href || seenFallback.has(href)) return '';
            seenFallback.add(href);
            return `${name}$${href}`;
          })
          .filter(Boolean);
        const fallbackSource = buildWbbbPlaySource(tabs[0] || '播放线路', fallbackItems, 0);
        if (fallbackSource) {
          playSources = [fallbackSource];
          OmniBox.log('info', `[wbbb][detail][fallback] 结构化线路为空，捕获到 ${fallbackSource.episodes.length} 条 vplay/play 链接作为兜底线路`);
        }
      }
      const playFrom = playSources.map((source) => source.name);
      const playUrl = playSources.map((source) => source.url);
      const vodPlayFrom = playFrom.join('$$$');
      const vodPlayUrl = playUrl.join('$$$');
      OmniBox.log('info', `[wbbb][detail][14] 播放字段组装完成 fromCount=${playFrom.length}, urlGroupCount=${playUrl.length}, vod_play_url_length=${vodPlayUrl.length}, firstLine=${playFrom[0] || '空'}, firstEpisode=${playSources[0]?.episodes?.[0]?.playId || '空'}`);

      const vod = {
        videoId: mediaId,
        id: mediaId,
        vod_id: mediaId,
        vod_name,
        vod_pic,
        type_name: vod_type,
        vod_year,
        vod_area,
        vod_remarks,
        vod_actor,
        vod_director,
        vod_content,
        vod_play_from: vodPlayFrom,
        vod_play_url: vodPlayUrl,
        vod_play_list: playSources.map((source) => ({
          name: source.name,
          url: source.url,
          episodes: source.episodes.map((episode) => ({ ...episode })),
        })),
        vod_play_sources: playSources.map((source) => ({
          name: source.name,
          episodes: source.episodes.map((episode) => ({ ...episode })),
        })),
      };
      OmniBox.log('info', `[wbbb][detail][15] 结果对象完成 mediaId=${mediaId}, has_vod_play_from=${!!vod.vod_play_from}, has_vod_play_url=${!!vod.vod_play_url}, vod_play_list_count=${vod.vod_play_list.length}, vod_play_sources_count=${vod.vod_play_sources.length}`);
      OmniBox.log('info', `[wbbb][detail][final] 完整返回数据: ${JSON.stringify(vod, null, 2)}`);
      if (!vod.vod_play_url) {
        OmniBox.log('warn', `[wbbb][detail][16] 未生成 vod_play_url：htmlLength=${html.length}, hasVplay=${html.includes('/vplay/')}, tabs=${tabs.length}, groups=${groups.length}`);
      }
      list.push(vod);
    }
    OmniBox.log('info', `[wbbb][detail][17] 即将返回 list，总数=${list.length}, firstName=${list[0]?.vod_name || '空'}, firstPlayFrom=${list[0]?.vod_play_from || '空'}, firstPlayUrlLen=${list[0]?.vod_play_url?.length || 0}`);
    return { list };
  } catch (e) {
    OmniBox.log('error', `[wbbb][detail][ERR] error=${e.message}, stack=${e.stack || ''}`);
    return { list: [], error: e.message || String(e) };
  }
}

async function search(params = {}) {
  OmniBox.log('info', `[wbbb][search] params=${JSON.stringify(params)}`);
  try {
    const wd = params.wd || params.keyword || params.key || '';
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    if (!wd) return { list: [], page, pagecount: page, total: 0 };
    const path = page > 1 ? `/search/-------------.html?wd=${encodeURIComponent(wd)}&page=${page}` : `/search/-------------.html?wd=${encodeURIComponent(wd)}`;
    OmniBox.log('info', `[wbbb][search] url=${SITE.host}${path}`);
    const html = await getHtml(path);
    const list = parseCards(html);
    return { list, page, pagecount: list.length >= 20 ? page + 1 : page, total: list.length };
  } catch (e) {
    const page = parseInt(params.page || params.pg || '1', 10) || 1;
    OmniBox.log('error', `[wbbb][search] error=${e.message}`);
    return { list: [], page, pagecount: page, total: 0, error: e.message || String(e) };
  }
}

function buildPlayHeaders(extra = {}) {
  const headers = {
    'User-Agent': SITE.ua,
    Referer: `${SITE.host}/`,
    Origin: SITE.host,
  };
  return Object.assign(headers, extra || {});
}

function buildAppSniffFallback(sniffUrl, headers = {}) {
  const finalHeaders = buildPlayHeaders(headers);
  return {
    parse: 1,
    jx: 1,
    url: sniffUrl,
    playId: sniffUrl,
    urls: [{ name: '嗅探线路', url: sniffUrl, playId: sniffUrl }],
    header: finalHeaders,
  };
}

async function play(params = {}) {
  OmniBox.log('info', `[wbbb][play][start] raw params=${JSON.stringify(params)}`);
  const rawId = params.id || params.playId || params.play || params.url || (typeof params === 'string' ? params : '');
  if (!rawId) {
    OmniBox.log('error', '[wbbb][play][ERR] No identifier provided in params');
    return { parse: 1, jx: 1, url: '', playId: '', error: 'Missing playback identifier' };
  }
  const id = /^https?:\/\//i.test(rawId) ? rawId : absUrl(rawId);
  OmniBox.log('info', `[wbbb][play][id] rawId=${String(rawId).slice(0, 120)}, normalized=${id}`);
  try {
    const html = await getHtml(id);
    const player = parsePlayer(html);
    OmniBox.log('info', `[wbbb][play] player url=${redactSensitive(player?.url || '')} from=${player?.from || ''}`);
    // If player parsing fails, try SDK sniff directly on the vplay page
    if (!player) {
      if (typeof OmniBox.sniffVideo === 'function') {
        try {
          const sniffed = await OmniBox.sniffVideo(id, { 'User-Agent': SITE.ua, Referer: `${SITE.host}/` });
          if (sniffed?.url) {
            return { parse: 0, jx: 0, url: sniffed.url, playId: sniffed.url, header: sniffed.header || { 'User-Agent': SITE.ua, Referer: `${SITE.host}/` } };
          }
        } catch (e) {
          await OmniBox.log('warn', `[wbbb][play] sdk sniff failed: ${e.message || e}`);
        }
      }
      // final fallback: app sniff format
      const fallback = { parse: 0, jx: 0, url: id, playId: id, header: { 'User-Agent': SITE.ua, Referer: `${SITE.host}/` } };
      OmniBox.log('info', `[wbbb][play][fallback] ${redactJson(fallback)}`);
      return fallback;
    }
    // Attempt direct media URL
    const from = String(player.from || '').trim();
    const nextUrl = id;
    const title = buildWbbbResolveTitle(html, player);
    OmniBox.log('info', `[wbbb][play][resolve-meta] current=${redactSensitive(id)}, link_next=${redactSensitive(player?.link_next || '')}, nextUrl=${redactSensitive(nextUrl)}, title=${title}`);
    // 1. 尝试通过静态 playerconfig.js 获取解析地址（在 SDK 嗅探前）
    const parseCandidates = [
      '/static/js/playerconfig.js',
      `/static/player/${from}.js`,
      '/static/player/config.js',
      '/js/playerconfig.js',
      '/player/config.js',
    ];
    for (const p of parseCandidates) {
      try {
        const conf = await getHtml(p);
        const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regs = [
          new RegExp(`player_list\\s*\\[\\s*['\"]${escapedFrom}['\"]\\s*\\]\\s*=\\s*\\{[\\s\\S]*?parse\\s*[:=]\\s*['\"]([^'\"]+)['\"]`, 'i'),
          new RegExp(`${escapedFrom}[\\s\\S]*?parse\\s*[:=]\\s*['\"]([^'\"]+)['\"]`, 'i'),
          new RegExp(`"${escapedFrom}"\\s*:\\s*\\{[\\s\\S]*?"parse"\\s*[:=]\\s*"([^\"]*)"`, 'i'),
          /MacPlayerConfig[\s\S]*?parse['"]?\s*[:=]\s*['"]([^'\"]+)['"]/i,
        ];
        for (const reg of regs) {
          const m = conf.match(reg);
          if (m && typeof m[1] === 'string') {
            const prefix = m[1].trim();
            if (prefix) {
              const jump = /^https?:\/\//i.test(prefix)
                ? `${prefix}${encodeURIComponent(player.url)}`
                : absUrl(`${prefix}${encodeURIComponent(player.url)}`);
              if (isDirectMediaUrl(jump, from)) {
                return { parse: 0, jx: 0, url: jump, playId: jump, header: { 'User-Agent': SITE.ua, Referer: `${SITE.host}/` } };
              }
              // otherwise continue to other fallback mechanisms
            }
          }
        }
      } catch (_) {}
    }
    const directUrl = decodePlayUrl(player.url, player.encrypt);
    if (isDirectMediaUrl(directUrl, from)) {
      return { parse: 0, jx: 0, url: directUrl, playId: directUrl, header: { 'User-Agent': SITE.ua, Referer: `${SITE.host}/` } };
    }
    // parse API handling
    const parseApi = String(player.parse || player.jx || '').trim();
    if (parseApi) {
      const jump = /^https?:\/\//i.test(parseApi)
        ? `${parseApi}${encodeURIComponent(directUrl)}`
        : absUrl(`${parseApi}${encodeURIComponent(directUrl)}`);
      return { parse: 0, jx: 0, url: jump, playId: jump, header: { 'User-Agent': SITE.ua, Referer: `${SITE.host}/` } };
    }
    // Resolve via external service
    let resolved = null;
    try {
      resolved = await resolveWbbbPlayerUrl(String(player.url || ''), nextUrl, title);
    } catch (_) {}
    // If we got a resolved URL, prefer direct media return for tvbox/非 sniff 宿主
    if (resolved && resolved.url) {
      const resolvedUrl = String(resolved.url || '').trim();
      const resolvedType = String(resolved.type || '').trim();
      const resolvedHeaders = buildPlayHeaders({ Referer: resolved.parsePageUrl || `${SITE.host}/` });
      OmniBox.log('info', `[wbbb][play][resolved] url=${redactSensitive(resolvedUrl)}, type=${resolvedType || 'unknown'}, parsePage=${redactSensitive(resolved.parsePageUrl || '')}`);
      if (isDirectMediaUrl(resolvedUrl, resolvedType)) {
        return { parse: 0, jx: 0, url: resolvedUrl, playId: resolvedUrl, header: resolvedHeaders };
      }
      if (typeof OmniBox.sniffVideo === 'function') {
        try {
          const sniffed = await OmniBox.sniffVideo(resolvedUrl, resolvedHeaders);
          if (sniffed?.url) {
            return { parse: 0, jx: 0, url: sniffed.url, playId: sniffed.url, header: sniffed.header || resolvedHeaders };
          }
        } catch (e) {
          await OmniBox.log('warn', `[wbbb][play] sdk sniff on resolved failed: ${e.message || e}`);
        }
      }
      // fallback on resolved URL
      return buildAppSniffFallback(resolvedUrl, resolvedHeaders);
    }
    // No resolved URL – final fallback on original id
    if (typeof OmniBox.sniffVideo === 'function') {
      try {
        const fallbackHeaders = buildPlayHeaders();
        const sniffed = await OmniBox.sniffVideo(id, fallbackHeaders);
        if (sniffed?.url) {
          return { parse: 0, jx: 0, url: sniffed.url, playId: sniffed.url, header: sniffed.header || fallbackHeaders };
        }
      } catch (e) {
        await OmniBox.log('warn', `[wbbb][play] final sdk sniff failed: ${e.message || e}`);
      }
    }
    const fallback = { parse: 0, jx: 0, url: id, playId: id, header: buildPlayHeaders() };
    OmniBox.log('info', `[wbbb][play][fallback] ${redactJson(fallback)}`);
    return fallback;
  } catch (e) {
    return { parse: 1, jx: 1, url: id, playId: id, error: e.message || String(e) };
  }
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);
