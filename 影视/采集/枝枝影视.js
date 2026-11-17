// @name 枝枝影视
// @description 页面解析：https://zzoc.cc，支持CF处理、首页、筛选分类、搜索、详情、多线路播放和嗅探兜底；依赖 axios
// @version 1.1.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/枝枝影视.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const axios = require("axios");
// ==================== CF 盾绕过配置 ====================
// 项目地址：https://github.com/FlareSolverr/FlareSolverr
// 优先读取站点专用变量，其次回退通用 FLARESOLVERR_URL；设置 ZHIZHI_CF_AUTO=0 可关闭自动处理。
const ZHIZHI_CF_COOKIE = process.env.ZHIZHI_CF_COOKIE || process.env.ZHIZHI_COOKIE || "";
const ZHIZHI_CF_AUTO = process.env.ZHIZHI_CF_AUTO !== "0";
const ZHIZHI_CF_CACHE_KEY = process.env.ZHIZHI_CF_CACHE_KEY || "zhizhi:cf_clearance";
const ZHIZHI_CF_MAX_AGE_SECONDS = parseInt(process.env.ZHIZHI_CF_MAX_AGE_SECONDS || "21600", 10) || 21600;
const ZHIZHI_CF_TIMEOUT_MS = parseInt(process.env.ZHIZHI_CF_TIMEOUT_MS || "45000", 10) || 45000;
const ZHIZHI_FLARESOLVERR_URL = process.env.ZHIZHI_FLARESOLVERR_URL || process.env.FLARESOLVERR_URL || "http://192.168.50.50:8191/v1";
const ZHIZHI_FLARESOLVERR_SESSION = process.env.ZHIZHI_FLARESOLVERR_SESSION || "";
const ZHIZHI_FLARESOLVERR_TIMEOUT_MS = parseInt(process.env.ZHIZHI_FLARESOLVERR_TIMEOUT_MS || String(ZHIZHI_CF_TIMEOUT_MS), 10) || ZHIZHI_CF_TIMEOUT_MS;
const ZHIZHI_CHROMIUM_BIN = process.env.ZHIZHI_CHROMIUM_BIN || "";
const ZHIZHI_BROWSER_DEBUGGING = process.env.ZHIZHI_BROWSER_DEBUGGING === "1";
let ZHIZHI_BROWSER_UA = text(process.env.ZHIZHI_BROWSER_UA || "");
const { promisify } = require("util");
const execFileAsync = promisify(require("child_process").execFile);

const HOST = String(process.env.ZHIZHI_HOST || "https://zzoc.cc").replace(/\/+$/, "");
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Referer: `${HOST}/`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Upgrade-Insecure-Requests": "1",
};
const CLASS_LIST = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "电视剧" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "4", type_name: "动漫" },
];
const FILTER_VALUES = [
  {
    key: "area",
    name: "地区",
    value: ["", "大陆", "香港", "台湾", "美国", "日本", "韩国"]
      .map((value) => ({ name: value || "全部", value })),
  },
  {
    key: "year",
    name: "年份",
    value: ["", "2026", "2025", "2024", "2023", "2022", "2021", "2020"]
      .map((value) => ({ name: value || "全部", value })),
  },
];
const FILTERS = Object.fromEntries(CLASS_LIST.map((item) => [item.type_id, FILTER_VALUES]));

module.exports = { home, category, search, detail, play };
runner.run(module.exports);

function getBodyText(response) {
  const body = response && typeof response === "object"
    ? ("body" in response ? response.body : ("data" in response ? response.data : response))
    : response;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function cookiesFromSetCookie(values) {
  return (Array.isArray(values) ? values : [values])
    .map((item) => String(item || "").split(";")[0])
    .filter(Boolean);
}

function mergeCookies(current, incoming) {
  const map = new Map();
  const append = (value) => {
    String(value || "").split(/;\s*/).forEach((pair) => {
      const index = pair.indexOf("=");
      if (index <= 0) return;
      map.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    });
  };
  append(current);
  append(incoming);
  return [...map.entries()].filter(([, value]) => value).map(([key, value]) => `${key}=${value}`).join("; ");
}

function text(value) {
  return String(value ?? "").trim();
}

function buildCookieHeader(cookie = "") {
  const value = text(cookie);
  return value ? { Cookie: value } : {};
}

function cookiesArrayToString(cookies = []) {
  return (Array.isArray(cookies) ? cookies : [])
    .map((item) => ({ name: text(item?.name || ""), value: text(item?.value || "") }))
    .filter((item) => item.name && item.value)
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

async function getCachedCfCookie() {
  if (text(ZHIZHI_CF_COOKIE)) return text(ZHIZHI_CF_COOKIE);
  try {
    return text((await OmniBox.getCache(ZHIZHI_CF_CACHE_KEY)) || "");
  } catch (error) {
    OmniBox.log("warn", `[cf] 读取缓存失败: ${error.message}`);
    return "";
  }
}

async function setCachedCfCookie(cookie) {
  const value = text(cookie);
  if (!value || text(ZHIZHI_CF_COOKIE)) return;
  try {
    await OmniBox.setCache(ZHIZHI_CF_CACHE_KEY, value, ZHIZHI_CF_MAX_AGE_SECONDS);
  } catch (error) {
    OmniBox.log("warn", `[cf] 写入缓存失败: ${error.message}`);
  }
}

async function requestWithFlareSolverr(targetUrl) {
  const endpoint = text(ZHIZHI_FLARESOLVERR_URL);
  if (!endpoint) throw new Error("未配置 FlareSolverr 地址");
  const payload = {
    cmd: "request.get",
    url: targetUrl,
    maxTimeout: ZHIZHI_FLARESOLVERR_TIMEOUT_MS,
  };
  if (text(ZHIZHI_FLARESOLVERR_SESSION)) payload.session = text(ZHIZHI_FLARESOLVERR_SESSION);
  const res = await axios.post(endpoint, payload, {
    timeout: ZHIZHI_FLARESOLVERR_TIMEOUT_MS + 5000,
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    validateStatus: () => true,
  });
  if (res.status !== 200 || !res.data || res.data.status !== "ok") {
    throw new Error(`FlareSolverr HTTP ${res.status}${res.data?.message ? `: ${res.data.message}` : ""}`);
  }
  const solution = res.data.solution || {};
  const cookies = Array.isArray(solution.cookies) ? solution.cookies : [];
  return {
    cookie: cookiesArrayToString(cookies),
    html: String(solution.response || ""),
    statusCode: Number(solution.status || 200),
    headers: solution.headers || {},
    userAgent: text(solution.userAgent || ""),
  };
}

async function fetchCfClearanceWithFlareSolverr(targetUrl = `${HOST}/`) {
  const solved = await requestWithFlareSolverr(targetUrl);
  if (!/cf_clearance=/.test(solved.cookie)) {
    throw new Error("FlareSolverr 未返回 cf_clearance");
  }
  return solved.cookie;
}

async function fetchCfClearanceWithBrowser(targetUrl = `${HOST}/`) {
  const script = String.raw`
const { execFile } = require("child_process");
const { promisify } = require("util");
const http = require("http");
const fs = require("fs");
const execFileAsync = promisify(execFile);
const BASE_URL = process.env.ZHIZHI_HOST;
const USER_AGENT = process.env.ZHIZHI_BROWSER_USER_AGENT;
const timeoutMs = Number(process.env.ZHIZHI_CF_TIMEOUT_MS || 45000);

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
      });
    }).on("error", reject);
  });
}

async function waitForDebugger(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const info = await getJson("http://127.0.0.1:" + port + "/json/version");
      if (info && info.webSocketDebuggerUrl) return info;
    } catch (_) {}
    await delay(500);
  }
  throw new Error("等待 Chromium 调试端口超时");
}

async function waitForCfCookie(wsUrl, baseUrl, deadline) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const host = new URL(baseUrl).hostname;
  try {
    while (Date.now() < deadline) {
      const cookies = (await send("Storage.getCookies", {})).result?.cookies || [];
      const hit = cookies.find((item) => item.name === "cf_clearance" && String(item.domain || "").includes(host));
      if (hit && hit.value) return "cf_clearance=" + hit.value;
      await delay(1200);
    }
    throw new Error("未在时限内获取到 cf_clearance");
  } finally {
    ws.close();
  }
}

(async () => {
  const port = 9400 + Math.floor(Math.random() * 200);
  const profile = (await execFileAsync("mktemp", ["-d", "/tmp/zhizhi-cf-XXXXXX"])).stdout.trim();
  const candidates = process.env.ZHIZHI_CHROMIUM_BIN
    ? [process.env.ZHIZHI_CHROMIUM_BIN]
    : ["/snap/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/chromium"];
  const bin = candidates.find((item) => item && fs.existsSync(item));
  if (!bin) throw new Error("未找到 Chromium，可设置 ZHIZHI_CHROMIUM_BIN");
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--user-data-dir=" + profile,
    "--remote-debugging-port=" + port,
    "--user-agent=" + USER_AGENT,
    BASE_URL + "/"
  ];
  if (process.env.ZHIZHI_BROWSER_DEBUGGING === "1") args.push("--remote-allow-origins=*");
  const child = execFile(bin, args, { stdio: "ignore" });
  try {
    const deadline = Date.now() + timeoutMs;
    const version = await waitForDebugger(port, deadline);
    process.stdout.write(await waitForCfCookie(version.webSocketDebuggerUrl, BASE_URL, deadline));
  } finally {
    try { child.kill("SIGKILL"); } catch (_) {}
  }
})().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});`;

  const { stdout, stderr } = await execFileAsync(process.execPath, ["-e", script], {
    timeout: ZHIZHI_CF_TIMEOUT_MS + 5000,
    env: {
      ...process.env,
      ZHIZHI_HOST: HOST,
      ZHIZHI_BROWSER_USER_AGENT: ZHIZHI_BROWSER_UA || UA,
      ZHIZHI_CF_TIMEOUT_MS: String(ZHIZHI_CF_TIMEOUT_MS),
      ZHIZHI_CHROMIUM_BIN: ZHIZHI_CHROMIUM_BIN,
      ZHIZHI_BROWSER_DEBUGGING: ZHIZHI_BROWSER_DEBUGGING ? "1" : "0",
    },
    maxBuffer: 1024 * 1024,
  });
  const cookie = text(stdout);
  if (!/^cf_clearance=/.test(cookie)) {
    throw new Error(text(stderr) || "未获取到 cf_clearance");
  }
  return cookie;
}

async function ensureCfCookie(forceRefresh = false, targetUrl = `${HOST}/`) {
  if (text(ZHIZHI_CF_COOKIE)) return text(ZHIZHI_CF_COOKIE);
  if (!forceRefresh) {
    const cached = await getCachedCfCookie();
    if (cached) return cached;
  }
  if (!ZHIZHI_CF_AUTO) return "";
  let cookie = "";
  try {
    OmniBox.log("info", `[cf] 开始通过 FlareSolverr 自动获取 cf_clearance`);
    cookie = await fetchCfClearanceWithFlareSolverr(targetUrl);
  } catch (error) {
    OmniBox.log("warn", `[cf] FlareSolverr 获取失败，回退 headless Chromium: ${error.message}`);
    cookie = await fetchCfClearanceWithBrowser(targetUrl);
  }
  if (cookie) {
    await setCachedCfCookie(cookie);
    OmniBox.log("info", `[cf] 已自动获取 cf_clearance，长度=${cookie.length}`);
  }
  return cookie;
}

function isBlockedHtml(body = "") {
  const lower = String(body || "").toLowerCase();
  return lower.includes("just a moment")
    || lower.includes("cf-browser-verification")
    || lower.includes("cf_chl_opt")
    || lower.includes("enable javascript and cookies to continue")
    || (lower.includes("captcha") && !lower.includes('name="cf-turnstile-response"'));
}

async function requestText(url, options = {}) {
  const referer = options.referer || options.headers?.Referer || `${HOST}/`;
  const cookie = await getCachedCfCookie();
  const headers = {
    ...HEADERS,
    ...(options.headers || {}),
    Referer: referer,
    ...buildCookieHeader(cookie),
  };
  const response = await OmniBox.request(url, {
    method: options.method || "GET",
    headers,
    timeout: options.timeout || 30000,
    body: options.body,
  });
  const statusCode = Number(response?.statusCode || 200);
  const body = getBodyText(response);
  if (statusCode >= 200 && statusCode < 400 && body && !isBlockedHtml(body)) return body;
  if (!ZHIZHI_CF_AUTO) throw new Error(`HTTP ${statusCode || "unknown"} @ ${url}`);

  OmniBox.log("warn", `[cf] ${url} 被CF盾拦截，尝试自动处理`);
  const solved = await requestWithFlareSolverr(url).catch(() => null);
  let solvedCookie = solved?.cookie || "";
  if (!solvedCookie && solved?.statusCode >= 200 && solved?.statusCode < 400 && solved?.html && !isBlockedHtml(solved.html)) {
    solvedCookie = mergeCookies(solvedCookie, cookiesFromSetCookie(solved.headers?.["set-cookie"]));
  }
  let solvedHtml = solved?.html || "";
  if ((!solvedHtml || isBlockedHtml(solvedHtml)) && ZHIZHI_FLARESOLVERR_URL) {
    OmniBox.log("warn", `[cf] FlareSolverr 结果无效，尝试刷新 cf_clearance`);
    const refreshed = await ensureCfCookie(true, url).catch(() => "");
    solvedCookie = refreshed;
    solvedHtml = "";
  }
  if (!solvedHtml && ZHIZHI_FLARESOLVERR_URL) {
    const retry = await requestWithFlareSolverr(url).catch(() => null);
    if (retry?.html && !isBlockedHtml(retry.html)) {
      solvedCookie = retry.cookie || solvedCookie;
      solvedHtml = retry.html;
    }
  }
  if (!solvedHtml && !ZHIZHI_FLARESOLVERR_URL) {
    const refreshed = await ensureCfCookie(true, url).catch(() => "");
    if (refreshed) {
      const retryResponse = await OmniBox.request(url, {
        method: options.method || "GET",
        headers: { ...headers, ...buildCookieHeader(refreshed) },
        timeout: options.timeout || 30000,
        body: options.body,
      });
      const retryStatus = Number(retryResponse?.statusCode || 200);
      const retryBody = getBodyText(retryResponse);
      if (retryStatus >= 200 && retryStatus < 400 && retryBody && !isBlockedHtml(retryBody)) {
        solvedCookie = refreshed;
        solvedHtml = retryBody;
      }
    }
  }
  if (solvedCookie) {
    await setCachedCfCookie(solvedCookie);
    const solvedUa = text(solved?.userAgent || "");
    if (solvedUa && !text(ZHIZHI_BROWSER_UA)) ZHIZHI_BROWSER_UA = solvedUa;
  }
  if (solvedHtml && !isBlockedHtml(solvedHtml)) return solvedHtml;
  throw new Error(`Cloudflare challenge unresolved @ ${url}`);
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(text) {
  return decodeHtml(
    String(text || "")
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function absUrl(url, base = HOST) {
  let value = decodeHtml(String(url || "").trim()).replace(/^['"]|['"]$/g, "").replace(/\\\//g, "/");
  if (!value || /^data:/i.test(value)) return "";
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    return new URL(value, base).toString();
  } catch (_) {
    return value;
  }
}

function getAttribute(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]).trim() : "";
}

function parseCards(html) {
  const parts = String(html || "").split(/<div\s+class=["']myui-vodbox-content["']>/i);
  const videos = [];
  const seen = new Set();

  for (const part of parts.slice(1)) {
    const idMatch = part.match(/href=["']\/voddetail\/(\d+)\.html["']/i);
    if (!idMatch || seen.has(idMatch[1])) continue;
    const videoId = idMatch[1];
    const block = part.slice(0, 5000);
    let name = cleanText((block.match(/\balt=["']([^"']+)["']/i) || [])[1] || "");
    if (!name) name = cleanText((block.match(/<div[^>]*class=["']title["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1] || "");
    if (!name) continue;

    let pic = String((block.match(/<img\b[^>]*src=["']([^"']+)["']/i) || [])[1] || "");
    if (/load\.gif/i.test(pic)) {
      pic = String((block.match(/<!--\s*<img\b[^>]*src=["']([^"']+)["']/i) || [])[1] || pic);
    }
    const remarkMatch = block.match(/<div[^>]*class=["'][^"']*tag[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)
      || block.match(/<div[^>]*class=["']score["'][^>]*>([\s\S]*?)<\/div>/i);

    seen.add(videoId);
    videos.push({
      vod_id: videoId,
      vod_name: name,
      vod_pic: absUrl(pic),
      vod_remarks: cleanText(remarkMatch ? remarkMatch[1] : ""),
    });
  }
  return videos;
}

function parsePageCount(html, currentPage) {
  const values = [];
  const patterns = [
    /\/vodshow\/\d+-[^"']*?(\d+)---\.html/gi,
    /\/vodsearch\/[^"']*?----------(\d+)---\.html/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(String(html || ""))) !== null) values.push(Number(match[1]) || 0);
  }
  return values.length ? Math.max(...values) : (currentPage + 1);
}

function normalizeFilters(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function extractMeta(html, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(new RegExp(`<meta[^>]*property=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"))
    || String(html || "").match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${escaped}["']`, "i"));
  return cleanText(match ? match[1] : "");
}

function extractField(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(new RegExp(`${escaped}\\s*[：:]\\s*([\\s\\S]*?)(?:<\\/div>|<\\/li>)`, "i"));
  return cleanText(match ? match[1] : "");
}

function extractNestedField(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(
    new RegExp(`<div[^>]*>[\\s\\S]*?<div[^>]*class=["']name["'][^>]*>\\s*${escaped}\\s*[：:]\\s*<\\/div>([\\s\\S]*?)<\\/div>`, "i"),
  );
  return cleanText(match ? match[1] : "");
}

function findPlaylistBlock(html, playlistId) {
  const text = String(html || "");
  const startMatch = text.match(new RegExp(`<div\\s+id=["']playlist${playlistId}["'][^>]*>`, "i"));
  if (!startMatch) return "";
  const start = startMatch.index;
  const rest = text.slice(start + startMatch[0].length);
  const next = rest.search(/<div\s+id=["']playlist\d+["']/i);
  return next >= 0 ? text.slice(start, start + startMatch[0].length + next) : text.slice(start, start + 20000);
}

function parsePlaySources(html) {
  const sources = [];
  const tabRegex = /<li[^>]*class=["'][^"']*player_name[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']#playlist(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = tabRegex.exec(String(html || ""))) !== null) {
    const playlistId = match[1];
    const name = cleanText(match[2]) || `线路${playlistId}`;
    const block = findPlaylistBlock(html, playlistId);
    const episodes = [];
    const episodeRegex = /<a\b[^>]*href=["']([^"']*\/vodplay\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let episodeMatch;
    while ((episodeMatch = episodeRegex.exec(block)) !== null) {
      const episodeName = cleanText(episodeMatch[2]) || "播放";
      const playId = absUrl(episodeMatch[1]);
      if (playId) episodes.push({ name: episodeName, playId });
    }
    if (episodes.length) sources.push({ name, episodes });
  }
  return sources;
}

function decodePlayerUrl(value, encrypt) {
  const raw = String(value || "").replace(/\\\//g, "/");
  if (!raw) return "";
  try {
    if (String(encrypt) === "2") return decodeURIComponent(Buffer.from(raw, "base64").toString("utf8"));
    if (String(encrypt) === "1") {
      const decoded = decodeURIComponent(raw);
      if (decoded !== raw || /^https?:\/\//i.test(decoded)) return decoded;
      if (/^[A-Za-z0-9+/=]+$/.test(raw)) return Buffer.from(raw, "base64").toString("utf8");
    }
  } catch (_) {}
  return raw;
}

function isDirectMedia(url) {
  return /\.(?:m3u8|mp4|flv|mkv|avi)(?:$|[?#])/i.test(String(url || ""));
}

function normalizeSniffUrls(result, defaultName) {
  const urls = [];
  const seen = new Set();
  const append = (item) => {
    const value = typeof item === "string" ? item : (item?.url || item?.playUrl || item?.src || "");
    const url = String(value || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push({ name: String(item?.name || defaultName || "嗅探线路"), url });
  };
  if (Array.isArray(result?.urls)) result.urls.forEach(append);
  if (!urls.length) append(result);
  return urls;
}

function directPlayResult(url, referer, name = "播放", extras = {}) {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return { parse: 0, jx: 0, url, urls: [{ name, url }], header, headers: header, ...extras };
}

function browserSniffResult(url, referer, name = "播放页") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return { parse: 1, jx: 1, url, urls: [{ name, url }], header, headers: header };
}

async function serverSniffOrBrowserFallback(targetUrl, referer, name = "播放") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  if (typeof OmniBox.sniffVideo === "function") {
    try {
      const sniffed = await OmniBox.sniffVideo(targetUrl, header);
      const urls = normalizeSniffUrls(sniffed, name);
      if (urls.length) {
        const playHeader = sniffed?.header || sniffed?.headers || header;
        await OmniBox.log("info", `[枝枝影视][play] 服务端嗅探成功 urls=${urls.length}`);
        return {
          parse: 0,
          jx: 0,
          url: urls[0].url,
          urls,
          header: playHeader,
          headers: playHeader,
          danmaku: sniffed?.danmaku || [],
        };
      }
      await OmniBox.log("warn", "[枝枝影视][play] 服务端嗅探无结果，转浏览器嗅探");
    } catch (error) {
      await OmniBox.log("warn", `[枝枝影视][play] 服务端嗅探失败，转浏览器嗅探: ${error.message}`);
    }
  }
  return browserSniffResult(targetUrl, referer, name);
}

async function resolveM3u8Child(url, referer) {
  try {
    const text = await requestText(url, { referer, timeout: 20000 });
    if (!text.includes("#EXTM3U") || !text.includes("#EXT-X-STREAM-INF")) return url;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].startsWith("#EXT-X-STREAM-INF")) continue;
      const child = lines.slice(index + 1).find((line) => !line.startsWith("#"));
      if (child) return absUrl(child, url);
    }
  } catch (_) {}
  return url;
}

async function home() {
  const results = await Promise.allSettled(CLASS_LIST.map((item) => requestText(`${HOST}/vodshow/${item.type_id}-----------.html`, { timeout: 30000 })));
  const list = [];
  const seen = new Set();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const video of parseCards(result.value)) {
      if (seen.has(video.vod_id)) continue;
      seen.add(video.vod_id);
      list.push(video);
    }
  }
  if (!list.length) {
    try {
      for (const video of parseCards(await requestText(`${HOST}/`))) {
        if (seen.has(video.vod_id)) continue;
        seen.add(video.vod_id);
        list.push(video);
      }
    } catch (error) {
      await OmniBox.log("error", `[枝枝影视][home] ${error.message}`);
    }
  }
  return { class: CLASS_LIST, filters: FILTERS, list: list.slice(0, 72) };
}

async function category(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  try {
    const categoryId = String(params.categoryId || params.type_id || "1").trim() || "1";
    const filters = normalizeFilters(params.extend || params.filters || params.ext);
    const area = String(filters.area || "").trim();
    const year = String(filters.year || "").trim();
    let url;
    if (area || year) {
      url = `${HOST}/vodshow/${categoryId}-${encodeURIComponent(area)}-------${page}---${encodeURIComponent(year)}.html`;
    } else {
      url = page === 1
        ? `${HOST}/vodshow/${categoryId}-----------.html`
        : `${HOST}/vodshow/${categoryId}--------${page}---.html`;
    }
    const html = await requestText(url);
    const list = parseCards(html);
    return { page, pagecount: parsePageCount(html, page), limit: list.length || 20, total: 999999, list };
  } catch (error) {
    await OmniBox.log("error", `[枝枝影视][category] ${error.message}`);
    return { page, pagecount: 0, limit: 0, total: 0, list: [] };
  }
}

async function detail(params) {
  try {
    const input = String(params.videoId || params.id || params.categoryId || "").trim();
    const idMatch = input.match(/\/voddetail\/(\d+)\.html/i) || input.match(/^(\d+)$/);
    const videoId = idMatch ? idMatch[1] : "";
    if (!videoId) return { list: [] };
    const html = await requestText(`${HOST}/voddetail/${videoId}.html`);
    let name = extractMeta(html, "og:title").replace(/-高清.*$/u, "").trim();
    if (!name) name = cleanText((html.match(/<title>([\s\S]*?)-/i) || [])[1] || "");
    let content = extractMeta(html, "og:description");
    if (content.includes("剧情介绍：")) content = content.split("剧情介绍：", 2)[1];
    const yearMatch = html.match(/<div[^>]*class=["']right["'][^>]*>\s*(\d{4})\s*<\/div>/i);
    const remarkMatch = html.match(/<div[^>]*class=["'][^"']*tag[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    return {
      list: [{
        vod_id: videoId,
        vod_name: name,
        vod_pic: absUrl(extractMeta(html, "og:image")),
        type_name: "",
        vod_year: yearMatch ? yearMatch[1] : "",
        vod_area: extractField(html, "地区"),
        vod_remarks: cleanText(remarkMatch ? remarkMatch[1] : ""),
        vod_actor: extractNestedField(html, "主演") || extractField(html, "主演"),
        vod_director: extractNestedField(html, "导演") || extractField(html, "导演"),
        vod_content: content || "暂无简介",
        vod_play_sources: parsePlaySources(html),
      }],
    };
  } catch (error) {
    await OmniBox.log("error", `[枝枝影视][detail] ${error.message}`);
    return { list: [] };
  }
}

async function search(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };
    const encoded = encodeURIComponent(keyword);
    const url = page === 1
      ? `${HOST}/vodsearch/${encoded}-------------.html`
      : `${HOST}/vodsearch/${encoded}----------${page}---.html`;
    const html = await requestText(url, { timeout: 60000 });
    const list = parseCards(html);
    return { page, pagecount: parsePageCount(html, page), limit: list.length || 20, total: 999999, list };
  } catch (error) {
    await OmniBox.log("error", `[枝枝影视][search] ${error.message}`);
    return { page, pagecount: 0, limit: 0, total: 0, list: [] };
  }
}

async function play(params) {
  const input = String(params.playId || params.id || params.url || params.input || "").trim();
  if (!input) return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
  const flag = String(params.flag || "");
  if (isDirectMedia(input)) return directPlayResult(absUrl(input), `${HOST}/`, flag || "播放");
  const playUrl = absUrl(input);

  let html = "";
  try {
    html = await requestText(playUrl, { referer: `${HOST}/`, timeout: 30000 });
  } catch (error) {
    await OmniBox.log("warn", `[枝枝影视][play] 播放页请求失败，尝试嗅探: ${error.message}`);
    return await serverSniffOrBrowserFallback(playUrl, playUrl, flag || "枝枝播放");
  }

  let realUrl = "";
  let jxFrom = "";
  const playerMatch = html.match(/var\s+player_[a-zA-Z0-9_$]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i)
    || html.match(/var\s+player_[a-zA-Z0-9_$]+\s*=\s*(\{[\s\S]*?\})\s*;/i);
  if (playerMatch) {
    try {
      const data = JSON.parse(playerMatch[1]);
      realUrl = decodePlayerUrl(data.url, data.encrypt);
      jxFrom = String(data.from || "");
    } catch (error) {
      await OmniBox.log("warn", `[枝枝影视][play] player 数据解析失败: ${error.message}`);
    }
  }

  let sniffTarget = playUrl;
  if (!realUrl) {
    const iframeMatch = html.match(/<iframe\b[^>]*src=["']([^"']+)["']/i);
    if (iframeMatch) {
      const iframeUrl = absUrl(iframeMatch[1], playUrl);
      sniffTarget = iframeUrl || playUrl;
      try {
        const iframeHtml = await requestText(iframeUrl, { referer: playUrl, timeout: 30000 });
        realUrl = String((iframeHtml.match(/["']url["']\s*:\s*["']([^"']+)["']/i) || [])[1] || "").replace(/\\\//g, "/");
        if (!realUrl) {
          realUrl = String((iframeHtml.match(/src=["']([^"']+\.(?:m3u8|mp4|flv)(?:\?[^"']*)?)["']/i) || [])[1] || "");
        }
      } catch (error) {
        await OmniBox.log("warn", `[枝枝影视][play] iframe 解析失败: ${error.message}`);
      }
    }
  }

  if (!realUrl) {
    const directMatch = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv|mkv|avi)(?:\?[^"']*)?)["']/i);
    realUrl = directMatch ? directMatch[1].replace(/\\\//g, "/") : "";
  }

  if (isDirectMedia(realUrl)) {
    const mediaUrl = /\.m3u8(?:$|[?#])/i.test(realUrl) ? await resolveM3u8Child(realUrl, playUrl) : realUrl;
    return directPlayResult(mediaUrl, playUrl, flag || "播放", jxFrom ? { jxFrom } : {});
  }
  if (realUrl) return await serverSniffOrBrowserFallback(absUrl(realUrl, playUrl), playUrl, flag || "枝枝播放");
  return await serverSniffOrBrowserFallback(sniffTarget, playUrl, flag || "枝枝播放");
}
