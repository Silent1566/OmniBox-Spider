// @name 蜗牛4K
// @author @Tao_XG
// @description 刮削：支持，弹幕：支持，嗅探：支持。站点：zmi.kdns.fr（MacCMS mxone 模板，主推 115 分享）
// @dependencies: axios, cheerio
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/蜗牛4K.js

// 引入 OmniBox SDK
const OmniBox = require("omnibox_sdk");
// 引入 cheerio(用于 HTML 解析)
let cheerio;
try {
  cheerio = require("cheerio");
} catch (error) {
  throw new Error("cheerio 模块未找到,请先安装:npm install cheerio");
}
let axios;
try {
  axios = require("axios");
} catch (error) {
  throw new Error("axios 模块未找到,请先安装:npm install axios");
}
const http = require("http");
const https = require("https");
const fs = require("fs");

// ==================== 配置区域 ====================
function splitConfigList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 网站地址(可以通过环境变量配置,支持多个域名用逗号/分号分割)
const WEB_SITE_CONFIG = process.env.WEB_SITE_WONIU4K || "https://zmi.kdns.fr";
const WEB_SITES = splitConfigList(WEB_SITE_CONFIG);
// 读取环境变量:支持多个网盘类型,用逗号/分号分割（蜗牛主推 115）
const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "115;quark;uc");
// 读取环境变量:线路名称和顺序,用逗号/分号分割
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");
// 是否开启外网服务器代理（默认关闭）
const EXTERNAL_SERVER_PROXY_ENABLED = String(process.env.EXTERNAL_SERVER_PROXY_ENABLED || "false").toLowerCase() === "true";
// 读取环境变量:详情页播放线路的网盘排序顺序。仅作用于 detail() 里的播放线路，不作用于搜索结果。
const DRIVE_ORDER = splitConfigList(process.env.DRIVE_ORDER || "115;quark;uc;baidu;tianyi;xunlei;ali;123pan").map(s => s.toLowerCase());
// 详情链路缓存时间（秒），默认 12 小时
const WONIU_CACHE_EX_SECONDS = Number(process.env.WONIU4K_CACHE_EX_SECONDS || process.env.WONIU_CACHE_EX_SECONDS || 43200);
const WONIU_VERBOSE_DETAIL = String(process.env.WONIU4K_VERBOSE_DETAIL || process.env.MUOU_VERBOSE_DETAIL || "0") === "1";
// 站点上游代理（部分出口直连 SSL 失败时可配置）
const UPSTREAM_PROXY_URL = String(
  process.env.WONIU4K_PROXY || process.env.PROXY_HTTP || process.env.HTTP_PROXY || process.env.http_proxy || ""
).trim();
const SITE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
// 网盘 API 请求限流（毫秒），避免触发风控
const DRIVE_API_DELAY_MS = Math.max(0, parseInt(process.env.WONIU4K_DRIVE_DELAY || "1500", 10));
// 静态分类（mxone 模板）
const STATIC_CLASSES = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "连续剧" },
  { type_id: "3", type_name: "综艺" },
  { type_id: "4", type_name: "动漫" },
];
// 登录配置
const LOGIN_USERNAME = String(process.env.WONIU4K_USERNAME || process.env.WONIU4K_USER || "").trim();
const LOGIN_PASSWORD = String(process.env.WONIU4K_PASSWORD || process.env.WONIU4K_PASS || "").trim();
// Cookie 登录：浏览器 F12 → Application → Cookies → 复制 Cookie 字符串
const WONIU4K_COOKIE = String(process.env.WONIU4K_COOKIE || process.env.WONIU4K_COOKIES || "").trim();
// 验证码识别服务地址（POST /ocr/ {"data":"<base64图片>"}）
const CAPTCHA_SERVICE_URL = String(process.env.DDDDOCR_API || "").replace(/\/+$/, "");
// PanCheck 网盘链接有效性检测（参考盘搜分组.js，POST {PANCHECK_API}/api/v1/links/check）
const PANCHECK_API = String(process.env.PANCHECK_API || "").trim().replace(/\/+$/, "");
const PANCHECK_ENABLED = true;
const PANCHECK_PLATFORMS = splitConfigList(process.env.PANCHECK_PLATFORMS || "115,quark,baidu,uc,pan123,tianyi,cmcc")
  .map((p) => String(p).toLowerCase().trim())
  .filter(Boolean);
// ==================== 配置区域结束 ====================

/**
 * 作用: 从线路名推断网盘类型，用于 detail 播放线路排序。
 * 注意: 这里只识别常见网盘关键字，不改变原脚本其他业务逻辑。
 */
function inferDriveTypeFromSourceName(name = "") {
  const raw = String(name || '').toLowerCase();
  if (raw.includes('百度')) return 'baidu';
  if (raw.includes('天翼')) return 'tianyi';
  if (raw.includes('夸克')) return 'quark';
  if (raw === 'uc' || raw.includes('uc')) return 'uc';
  if (raw.includes('115')) return '115';
  if (raw.includes('迅雷')) return 'xunlei';
  if (raw.includes('阿里')) return 'ali';
  if (raw.includes('123')) return '123pan';
  return raw;
}

/**
 * 作用: 仅对 detail() 中已构建完成的 playSources 做排序。
 * 规则: 按 DRIVE_ORDER 优先级排序；未命中的线路保持在后面。
 */
function sortPlaySourcesByDriveOrder(playSources = []) {
  if (!Array.isArray(playSources) || playSources.length <= 1 || DRIVE_ORDER.length === 0) {
    return playSources;
  }
  const orderMap = new Map(DRIVE_ORDER.map((name, index) => [name, index]));
  return [...playSources].sort((a, b) => {
    const aType = inferDriveTypeFromSourceName(a?.name || '');
    const bType = inferDriveTypeFromSourceName(b?.name || '');
    const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });
}

function resolveCallerSource(params = {}, context = {}) {
  return String(context?.from || params?.source || "").toLowerCase();
}

function getBaseURLHost(context = {}) {
  const baseURL = String(context?.baseURL || "").trim();
  if (!baseURL) return "";
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch (error) {
    return baseURL.toLowerCase();
  }
}

function isPrivateHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal") || host.endsWith(".intra")) return true;
  if (host.includes(":")) return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  return false;
}

function canUseServerProxy(context = {}) {
  if (EXTERNAL_SERVER_PROXY_ENABLED) return true;
  return isPrivateHost(getBaseURLHost(context));
}

function filterSourceNamesForCaller(sourceNames = [], callerSource = "", context = {}) {
  let filtered = Array.isArray(sourceNames) ? [...sourceNames] : [];
  const allowServerProxy = canUseServerProxy(context);

  if (callerSource === "web") {
    filtered = filtered.filter((name) => name !== "本地代理");
    OmniBox.log("info", "来源为网页端，已过滤掉\"本地代理\"线路");
  } else if (callerSource === "emby") {
    if (allowServerProxy) {
      filtered = filtered.filter((name) => name === "服务端代理");
      OmniBox.log("info", "来源为 emby，网盘多线路仅保留\"服务端代理\"");
    } else {
      filtered = filtered.filter((name) => name !== "服务端代理");
      OmniBox.log("info", "来源为 emby 但当前为外网环境且未开启外网代理，已屏蔽\"服务端代理\"线路");
    }
  } else if (callerSource === "uz") {
    filtered = filtered.filter((name) => name !== "本地代理");
    OmniBox.log("info", "来源为 uz，已屏蔽\"本地代理\"线路");
  }

  if (!allowServerProxy) {
    filtered = filtered.filter((name) => name !== "服务端代理");
  }

  return filtered.length > 0 ? filtered : ["直连"];
}

function resolveRouteType(flag = "", callerSource = "", context = {}) {
  const allowServerProxy = canUseServerProxy(context);
  const validRouteTypes = new Set(["本地代理", "服务端代理", "直连"]);
  let routeType = "直连";

  if (callerSource === "web" || callerSource === "emby") {
    routeType = allowServerProxy ? "服务端代理" : "直连";
  }

  if (flag) {
    if (flag.includes("-")) {
      const flagParts = flag.split("-");
      routeType = flagParts[flagParts.length - 1];
    } else {
      routeType = flag;
    }
  }

  if (!validRouteTypes.has(routeType)) {
    routeType = "直连";
  }

  if (!allowServerProxy && routeType === "服务端代理") {
    routeType = "直连";
  }

  if (callerSource === "uz" && routeType === "本地代理") {
    routeType = "直连";
  }

  return routeType;
}

if (WEB_SITES.length === 0) {
  throw new Error("WEB_SITE 配置不能为空");
}

OmniBox.log("info", `配置了 ${WEB_SITES.length} 个域名: ${WEB_SITES.join(', ')}`);

const INSECURE_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
});
const KEEP_ALIVE_HTTP_AGENT = new http.Agent({ keepAlive: true });
const AXIOS_PROXY = parseAxiosProxy(UPSTREAM_PROXY_URL);

// 简易 Cookie Jar
let cookieStore = {};

function setCookiesFromHeaders(setCookieHeaders, baseUrl) {
  if (!setCookieHeaders || !Array.isArray(setCookieHeaders) && typeof setCookieHeaders !== "string") return;
  const list = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const domain = (() => { try { return new URL(baseUrl).hostname; } catch { return ""; } })();
  if (!domain) return;
  if (!cookieStore[domain]) cookieStore[domain] = {};
  for (const raw of list) {
    const parts = raw.split(";")[0];
    const idx = parts.indexOf("=");
    if (idx < 0) continue;
    const key = parts.substring(0, idx).trim();
    const val = parts.substring(idx + 1).trim();
    if (key) cookieStore[domain][key] = val;
  }
}

function setCookiesFromString(cookieStr, domain) {
  if (!cookieStr) return;
  const parts = cookieStr.split(/[;,]/);
  if (!domain) {
    domain = (() => { try { return new URL(WEB_SITES[0]).hostname; } catch { return ""; } })();
  }
  if (!domain) return;
  if (!cookieStore[domain]) cookieStore[domain] = {};
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.substring(0, idx).trim();
    const val = part.substring(idx + 1).trim();
    if (key) cookieStore[domain][key] = val;
  }
}

function getCookieHeader(baseUrl) {
  const domain = (() => { try { return new URL(baseUrl).hostname; } catch { return ""; } })();
  if (!domain || !cookieStore[domain]) return "";
  const entries = Object.entries(cookieStore[domain]).filter(([, v]) => v);
  return entries.map(([k, v]) => `${k}=${v}`).join("; ");
}

function clearCookies() {
  cookieStore = {};
}

function hasAuthCookies() {
  for (const domain of Object.keys(cookieStore)) {
    const c = cookieStore[domain] || {};
    if (c.user_id || c.user_name || c.user_check) return true;
  }
  return false;
}

// 启动时自动注入环境变量中的 Cookie
if (WONIU4K_COOKIE) {
  setCookiesFromString(WONIU4K_COOKIE);
  OmniBox.log("info", "蜗牛4K 已从 WONIU4K_COOKIE 加载 Cookie");
}

async function httpRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const baseHost = (() => {
    try {
      return new URL(url).origin + "/";
    } catch (_) {
      return getBaseUrl() + "/";
    }
  })();

  const cookieHeader = getCookieHeader(url);
  const headers = {
    "User-Agent": SITE_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: baseHost,
    ...(options.headers || {}),
  };
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }

  const response = await axios({
    url,
    method,
    headers,
    data: options.body,
    timeout: options.timeout || 25000,
    proxy: AXIOS_PROXY || false,
    maxRedirects: 5,
    httpAgent: KEEP_ALIVE_HTTP_AGENT,
    httpsAgent: INSECURE_HTTPS_AGENT,
    validateStatus: () => true,
    responseType: "text",
  });

  const setCookie = response.headers["set-cookie"];
  if (setCookie) {
    setCookiesFromHeaders(setCookie, url);
  }

  let body = response.data;
  if (typeof body !== "string") {
    body = body === undefined || body === null ? "" : JSON.stringify(body);
  }

  return {
    statusCode: response.status,
    body,
    headers: response.headers || {},
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadImageBase64(url, timeout = 10000) {
  const headers = {
    "User-Agent": SITE_UA,
    "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
    Referer: getBaseUrl() + "/",
  };
  const cookieHeader = getCookieHeader(url);
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }
  try {
    const response = await axios({
      url,
      method: "GET",
      headers,
      timeout,
      proxy: AXIOS_PROXY || false,
      maxRedirects: 5,
      httpAgent: KEEP_ALIVE_HTTP_AGENT,
      httpsAgent: INSECURE_HTTPS_AGENT,
      validateStatus: () => true,
      responseType: "arraybuffer",
    });
    if (response.status !== 200 || !response.data || !Buffer.isBuffer(response.data) || response.data.length === 0) {
      return "";
    }
    return response.data.toString("base64");
  } catch (error) {
    OmniBox.log("warn", `下载验证码图片失败: ${url} - ${error.message}`);
    return "";
  }
}

async function solveCaptchaByUrl(verifyUrl) {
  if (!verifyUrl || !CAPTCHA_SERVICE_URL) {
    return "";
  }
  try {
    const b64 = await downloadImageBase64(verifyUrl);
    if (!b64) {
      OmniBox.log("warn", "蜗牛4K 验证码图片下载为空");
      return "";
    }
    const ocrRes = await axios({
      url: CAPTCHA_SERVICE_URL + "/ocr/",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({ data: b64 }),
      timeout: 30000,
      validateStatus: () => true,
      responseType: "text",
    });
    let parsed;
    try {
      parsed = JSON.parse(ocrRes.data || "{}");
    } catch {
      parsed = {};
    }
    if (parsed.status === 0 && parsed.data) {
      const code = String(parsed.data.code ?? parsed.data.result ?? parsed.data.text ?? "").trim();
      if (code) {
        OmniBox.log("info", `蜗牛4K 验证码识别成功: ${code}`);
        return code;
      }
    }
    OmniBox.log("warn", `蜗牛4K 验证码识别无结果: ${ocrRes.status} ${String(parsed.msg || ocrRes.data || "").slice(0, 120)}`);
    return "";
  } catch (error) {
    OmniBox.log("warn", `蜗牛4K 验证码识别服务不可用(${CAPTCHA_SERVICE_URL}): ${error.message}`);
    return "";
  }
}

function isBlockedHtml(body = "") {
  if (!body || typeof body !== "string") {
    return false;
  }
  const lower = body.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("captcha") ||
    lower.includes("访问验证")
  );
}

function buildCacheKey(prefix, value) {
  return `${prefix}:${value}`;
}

function logDetailDebug(message) {
  if (WONIU_VERBOSE_DETAIL) {
    OmniBox.log("info", message);
  }
}

function parseAxiosProxy(raw) {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    const out = {
      protocol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: Number(u.port || (u.protocol === "https:" ? 443 : 80)),
    };
    if (u.username) {
      out.auth = {
        username: decodeURIComponent(u.username),
        password: decodeURIComponent(u.password || ""),
      };
    }
    return out;
  } catch (_) {
    return false;
  }
}

function absUrl(url, baseUrl = "") {
  const base = removeTrailingSlash(baseUrl || getBaseUrl());
  if (!url) return "";
  if (/^\/\//.test(url)) return "https:" + url;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) return base + url;
  return base + "/" + String(url).replace(/^\/+/, "");
}

function getIdFromHref(href) {
  const s = String(href || "");
  let m = s.match(/\/voddetail\/(\d+)\/?/i);
  if (m) return m[1];
  m = s.match(/\/vodplay\/(\d+)-\d+-\d+\/?/i);
  if (m) return m[1];
  m = s.match(/\/vod\/detail\/id\/(\d+)\.html/i);
  if (m) return m[1];
  m = s.match(/\/index\.php\/vod\/detail\/id\/(\d+)\.html/i);
  return m ? m[1] : "";
}

function normalizeVideoId(videoId = "") {
  const raw = String(videoId || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw) || raw.startsWith("/")) {
    const id = getIdFromHref(raw);
    return id || raw;
  }
  return raw;
}

function buildCategoryPath(categoryId, page = 1) {
  const tid = String(categoryId || "").trim();
  const pg = Math.max(1, parseInt(page || "1", 10) || 1);
  if (pg <= 1) return `/vodtype/${tid}/`;
  return `/vodtype/${tid}-${pg}/`;
}

function buildSearchPath(keyword, page = 1) {
  const enc = encodeURIComponent(String(keyword || "").trim());
  const pg = Math.max(1, parseInt(page || "1", 10) || 1);
  if (pg <= 1) return `/vodsearch/${enc}-------------/`;
  return `/vodsearch/${enc}----------${pg}---/`;
}

function buildDetailPath(videoId) {
  const id = normalizeVideoId(videoId);
  if (/^https?:\/\//i.test(id)) return id;
  if (String(id).startsWith("/")) return id;
  return `/voddetail/${id}/`;
}

function normalizeShareUrl(url) {
  let u = String(url || "").trim().replace(/&amp;/g, "&");
  if (!u) return "";
  u = u.replace(/^https?:\/\/(?:www\.)?115cdn\.com\//i, "https://115.com/");
  u = u.replace(/^https?:\/\/(?:www\.)?anxia\.com\//i, "https://115.com/");
  return u.replace(/[),.;]+$/, "");
}

function extractPanUrl(raw) {
  const s = String(raw || "").replace(/&amp;/g, "&").trim();
  const m = s.match(/https?:\/\/[^\s"'<>]+/i);
  return m ? normalizeShareUrl(m[0]) : "";
}

function isPanShareUrl(url = "") {
  return /115|quark|aliyun|alipan|baidu|uc\.cn|123pan|189\.cn|xunlei|anxia/i.test(String(url || ""));
}

function cleanContent(s) {
  return String(s || "")
    .replace(/收起|展开全部|内详/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePageCount(html, current = 1) {
  const $ = cheerio.load(html || "");
  let max = Math.max(1, parseInt(current || "1", 10) || 1);
  $("a[href*='/vodtype/'],a[href*='/vodsearch/']").each((_, a) => {
    const href = $(a).attr("href") || "";
    let m = href.match(/\/vodtype\/\d+-(\d+)\/?/i);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 1);
    m = href.match(/\/vodsearch\/[^/]*?----------+(\d+)---+\/?/i);
    if (m) max = Math.max(max, parseInt(m[1], 10) || 1);
  });
  return max || 1;
}

function parseListFromHtml(html, baseUrl = "") {
  const $ = cheerio.load(html || "");
  const seen = new Set();
  const list = [];

  // mxone 模板
  $(".module-item,.module-search-item").each((_, el) => {
    let a = $(el).find('a[href*="/voddetail/"]').first();
    if (!a.length) a = $(el).find('a[href*="/vodplay/"]').first();
    const href = a.attr("href") || "";
    const id = getIdFromHref(href);
    if (!id || seen.has(id)) return;
    seen.add(id);

    const img = $(el).find("img").first();
    let title = (
      a.attr("title") ||
      $(el).find(".module-poster-item-title").text() ||
      $(el).find(".module-item-title").text() ||
      $(el).find(".video-name").text() ||
      $(el).find("h3,h4").first().text() ||
      ""
    )
      .replace(/\s+/g, " ")
      .replace(/^立刻播放|^下载/g, "")
      .trim();
    if (!title) return;

    let pic = img.attr("data-src") || img.attr("data-original") || img.attr("src") || "";
    if (pic.includes("loading.gif")) {
      pic = img.attr("data-src") || img.attr("data-original") || "";
    }
    const note =
      $(el).find(".module-item-note").text().trim() ||
      $(el).find(".module-poster-item-note").text().trim() ||
      $(el).find(".video-serial").text().trim() ||
      $(el).find(".module-item-caption").text().trim() ||
      $(el).find(".module-item-text").text().trim() ||
      "";

    list.push({
      vod_id: id,
      vod_name: title,
      vod_pic: absUrl(pic, baseUrl),
      type_id: "",
      type_name: "",
      vod_remarks: note.replace(/\s+/g, " ").trim(),
    });
  });

  // panlian_dark 模板
  $("a.video-card").each((_, el) => {
    const href = $(el).attr("href") || "";
    const id = getIdFromHref(href);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const title = (
      $(el).attr("title") ||
      $(el).find(".video-title").text() ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return;
    const img = $(el).find("img").first();
    let pic = img.attr("data-src") || img.attr("data-original") || img.attr("src") || "";
    if (pic.includes("loading.gif")) {
      pic = img.attr("data-src") || img.attr("data-original") || "";
    }
    const note = $(el).find(".video-episode").text().trim() || "";
    list.push({
      vod_id: id,
      vod_name: title,
      vod_pic: absUrl(pic, baseUrl),
      type_id: "",
      type_name: "",
      vod_remarks: note.replace(/\s+/g, " ").trim(),
    });
  });

  return list;
}

async function getCachedJSON(key) {
  try {
    return await OmniBox.getCache(key);
  } catch (error) {
    OmniBox.log("warn", `读取缓存失败: key=${key}, error=${error.message}`);
    return null;
  }
}

async function setCachedJSON(key, value, exSeconds) {
  try {
    await OmniBox.setCache(key, value, exSeconds);
  } catch (error) {
    OmniBox.log("warn", `写入缓存失败: key=${key}, error=${error.message}`);
  }
}

/**
 * 带容灾的请求函数
 */
async function requestWithFailover(path, options = {}) {
  let lastError = null;
  const perDomainTimeout = Math.max(1000, Math.floor(30000 / WEB_SITES.length));

  for (let i = 0; i < WEB_SITES.length; i++) {
    const baseUrl = removeTrailingSlash(WEB_SITES[i]);
    const fullUrl = path.startsWith('http') ? path : baseUrl + path;

    try {
      OmniBox.log("info", `尝试请求域名 ${i + 1}/${WEB_SITES.length}: ${fullUrl}, timeout=${options.timeout ?? perDomainTimeout}ms`);

      const response = await httpRequest(fullUrl, {
        ...options,
        method: options.method || "GET",
        headers: {
          "User-Agent": SITE_UA,
          ...(options.headers || {}),
        },
        timeout: options.timeout ?? Math.max(perDomainTimeout, 15000),
      });

      if (response.statusCode !== 200) {
        OmniBox.log("warn", `域名 ${baseUrl} 返回非200状态码: ${response.statusCode}`);
        lastError = new Error(`HTTP ${response.statusCode}`);
        continue;
      }
      if (!response.body) {
        OmniBox.log("warn", `域名 ${baseUrl} 返回200但内容为空`);
        lastError = new Error("内容为空");
        continue;
      }
      if (isBlockedHtml(response.body)) {
        OmniBox.log("warn", `域名 ${baseUrl} 命中风控页,切换下一个域名`);
        lastError = new Error("命中风控页面");
        continue;
      }
      OmniBox.log("info", `域名 ${baseUrl} 请求成功`);
      return { response, baseUrl };
    } catch (error) {
      OmniBox.log("warn", `域名 ${baseUrl} 请求失败: ${error.message}`);
      lastError = error;

      if (i < WEB_SITES.length - 1) {
        continue;
      }
    }
  }

  throw lastError || new Error("所有域名请求均失败");
}

function getBaseUrl() {
  return removeTrailingSlash(WEB_SITES[0]);
}

function removeTrailingSlash(url) {
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

// ==================== 自动筛选提取 ====================
const FILTER_KEY_NAME_MAP = {
  class: "类型",
  area: "地区",
  lang: "语言",
  year: "年份",
  letter: "字母",
  by: "排序",
  sort: "排序",
  id: "分类"
};

let autoFiltersCache = {
  data: null,
  expiresAt: 0,
};

function normalizeFilterValueItem(item) {
  if (!item) return null;
  const name = String(item.n || item.name || "").trim();
  const value = String(item.v ?? item.value ?? "").trim();
  if (!name && !value) return null;
  return { name, value };
}

function normalizeFilterGroup(group) {
  if (!group) return null;
  const key = String(group.key || "").trim();
  const name = String(group.n || group.name || "").trim();
  const valuesRaw = Array.isArray(group.v) ? group.v : (Array.isArray(group.value) ? group.value : []);
  const values = valuesRaw.map(normalizeFilterValueItem).filter(Boolean);
  if (!key || values.length === 0) return null;

  return {
    key,
    name: name || FILTER_KEY_NAME_MAP[key] || key,
    init: String(group.init ?? ""),
    value: values,
  };
}

function extractFilterKeyFromHref(href = "") {
  if (!href) return null;
  const raw = String(href);
  for (const key of Object.keys(FILTER_KEY_NAME_MAP)) {
    if (raw.includes(`${key}/`) || raw.includes(`/${key}/`)) {
      return key;
    }
  }
  // mxone 伪静态：/vodshow/1-----------/ 或 show 路径
  if (raw.includes("id/") || /\/vodtype\/\d+/i.test(raw) || /\/vodshow\//i.test(raw)) {
    return "id";
  }
  return null;
}

function extractFilterValueFromHref(href = "", key = "") {
  if (!href || !key) return "";
  const raw = String(href);
  const marker = `${key}/`;
  const idx = raw.indexOf(marker);
  if (idx >= 0) {
    const rest = raw.substring(idx + marker.length);
    return decodeURIComponent((rest.split('/')[0] || "").split('.')[0] || "");
  }
  // mxone: /vodtype/1/ 取分类 id
  if (key === "id") {
    const m = raw.match(/\/vodtype\/(\d+)/i) || raw.match(/\/id\/(\d+)/i);
    if (m) return m[1];
  }
  return "";
}

function parseFiltersFromHtml(html = "") {
  if (!html) return [];
  const $ = cheerio.load(html);
  const groups = [];

  const libraryBoxes = $(".library-box.scroll-box").slice(1);
  libraryBoxes.each((_, element) => {
    const links = $(element).find(".library-list a");
    if (!links || links.length === 0) return;

    const firstHref = links.first().attr("href") || "";
    const key = extractFilterKeyFromHref(firstHref);
    if (!key) return;

    const values = [{ name: "全部", value: "" }];
    const dedupe = new Set(["__ALL__"]);

    links.each((__, a) => {
      const href = $(a).attr("href") || "";
      if (!href) return;
      const value = extractFilterValueFromHref(href, key);
      const name = ($(a).text() || "").trim();
      const dedupeKey = `${name}::${value}`;
      if (!name && !value) return;
      if (dedupe.has(dedupeKey)) return;
      dedupe.add(dedupeKey);
      values.push({ name, value });
    });

    if (values.length > 1) {
      groups.push({
        key,
        name: FILTER_KEY_NAME_MAP[key] || key,
        init: "",
        value: values,
      });
    }
  });

  return groups;
}

async function getAutoFiltersByCategory(categoryId) {
  if (!categoryId) return [];
  try {
    // mxone 优先伪静态分类页，失败再回退 show
    const paths = [
      `/vodtype/${categoryId}/`,
      `/index.php/vod/show/id/${categoryId}.html`,
      `/index.php/vod/type/id/${categoryId}.html`,
    ];
    for (const path of paths) {
      try {
        const { response } = await requestWithFailover(path);
        if (response.statusCode === 200 && response.body) {
          const groups = parseFiltersFromHtml(response.body);
          if (groups.length > 0) return groups;
          // 主路径已返回有效内容但没有筛选，说明站点无筛选，不再尝试 fallback
          if (path === paths[0]) {
            return [];
          }
        }
      } catch (_) {
        // try next
      }
    }
    return [];
  } catch (error) {
    OmniBox.log("warn", `自动提取分类筛选失败: categoryId=${categoryId}, err=${error.message}`);
    return [];
  }
}

function normalizeStaticFilters(rawFilters) {
  const result = {};
  if (!rawFilters || typeof rawFilters !== "object") return result;

  for (const typeId of Object.keys(rawFilters)) {
    const groups = Array.isArray(rawFilters[typeId]) ? rawFilters[typeId] : [];
    const normalizedGroups = groups.map(normalizeFilterGroup).filter(Boolean);
    if (normalizedGroups.length > 0) {
      result[typeId] = normalizedGroups;
    }
  }
  return result;
}

async function getPreferredFilters(classes = []) {
  const now = Date.now();
  if (autoFiltersCache.data && now < autoFiltersCache.expiresAt) {
    return autoFiltersCache.data;
  }

  const staticFilters = normalizeStaticFilters(await getDynamicFilters());

  let merged = staticFilters;

  // 静态配置为空时才执行自动抓取
  if (Object.keys(staticFilters).length === 0) {
    const autoFilters = {};
    for (const cls of classes) {
      const typeId = String(cls?.type_id || "").trim();
      if (!typeId) continue;
      const groups = await getAutoFiltersByCategory(typeId);
      if (groups.length > 0) {
        autoFilters[typeId] = groups;
      }
    }

    if (Object.keys(autoFilters).length > 0) {
      OmniBox.log("info", `静态配置为空，自动提取筛选成功: ${Object.keys(autoFilters).length} 个分类`);
      merged = autoFilters;
    } else {
      OmniBox.log("warn", "静态配置和自动提取筛选均为空");
    }
  } else {
    OmniBox.log("info", `使用静态配置筛选: ${Object.keys(staticFilters).length} 个分类`);
  }

  autoFiltersCache = {
    data: merged,
    expiresAt: now + 10 * 60 * 1000,
  };

  return merged;
}

function isVideoFile(file) {
  if (!file || !file.file_name) {
    return false;
  }

  const fileName = file.file_name.toLowerCase();
  const videoExtensions = [
    ".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v",
    ".mpg", ".mpeg", ".vob", ".mts", ".m2ts", ".rm", ".rmvb", ".iso", ".3gp", ".ogv",
    ".ogm", ".asf", ".f4v", ".dat", ".tp", ".trp", ".ifo",
  ];
  for (const ext of videoExtensions) {
    if (fileName.endsWith(ext)) {
      return true;
    }
  }

  if (file.format_type) {
    const formatType = String(file.format_type).toLowerCase();
    if (formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264") || formatType.includes("iso")) {
      return true;
    }
  }

  return false;
}

async function getAllVideoFiles(shareURL, files, errors = []) {
  if (!files || !Array.isArray(files)) {
    return [];
  }

  const results = [];
  let dirIndex = 0;
  for (const file of files) {
    if (file.file && isVideoFile(file)) {
      results.push([file]);
      continue;
    }
    if (!file.dir) continue;

    dirIndex++;
    const startTime = performance.now();

    try {
      if (dirIndex > 1 && DRIVE_API_DELAY_MS > 0) {
        await sleep(DRIVE_API_DELAY_MS);
      }

      const subFileList = await callDriveApiWithRetry(() => OmniBox.getDriveFileList(shareURL, file.fid));
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);

      OmniBox.log("info", `获取目录 [${file.name || file.fid}] 耗时: ${duration}ms`);

      if (subFileList?.files && Array.isArray(subFileList.files)) {
        const sub = await getAllVideoFiles(shareURL, subFileList.files, errors);
        results.push(sub);
      }
    } catch (error) {
      const endTime = performance.now();
      const duration = (endTime - startTime).toFixed(2);

      const errorInfo = {
        path: file.name || file.fid,
        fid: file.fid,
        message: error.message,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString()
      };
      errors.push(errorInfo);
      OmniBox.log("warn", `获取子目录失败 [${file.name || file.fid}] 耗时: ${duration}ms, 错误: ${error.message}`);
    }
  }

  return results.flat();
}

function formatFileSize(size) {
  if (!size || size <= 0) {
    return "";
  }

  const unit = 1024;
  const units = ["B", "K", "M", "G", "T", "P"];

  if (size < unit) {
    return `${size}B`;
  }

  let exp = 0;
  let sizeFloat = size;
  while (sizeFloat >= unit && exp < units.length - 1) {
    sizeFloat /= unit;
    exp++;
  }

  if (sizeFloat === Math.floor(sizeFloat)) {
    return `${Math.floor(sizeFloat)}${units[exp]}`;
  }
  return `${sizeFloat.toFixed(2)}${units[exp]}`;
}

async function home(params) {
  try {
    OmniBox.log("info", "蜗牛4K 获取首页数据");

    let classes = [...STATIC_CLASSES];
    let list = [];

    try {
      const { response, baseUrl } = await requestWithFailover("/");

      if (response.statusCode === 200 && response.body) {
        const $ = cheerio.load(response.body);

        const navClasses = [];
        $(".module-tab-items .module-tab-item, .nav-menu-item a, .nav-menu a, .nav-link").each((_, element) => {
          const $item = $(element);
          const href = $item.attr("href") || "";
          const typeId = $item.attr("data-id") || (href.match(/\/vodtype\/(\d+)/i) || [])[1];
          const typeName = ($item.attr("data-name") || $item.text() || "").replace(/\s+/g, " ").trim();
          if (typeId && typeId !== "0" && typeName && !/首页|最近|排行|专题|求片|留言/.test(typeName)) {
            navClasses.push({ type_id: String(typeId), type_name: typeName });
          }
        });
        if (navClasses.length > 0) {
          const seen = new Set();
          classes = navClasses.filter((c) => {
            if (seen.has(c.type_id)) return false;
            seen.add(c.type_id);
            return true;
          });
        }

        list = parseListFromHtml(response.body, baseUrl);
        OmniBox.log("info", `蜗牛4K 首页分类=${classes.length}, 影片=${list.length}`);
      }
    } catch (error) {
      OmniBox.log("warn", `蜗牛4K 从首页提取数据失败: ${error.message}`);
    }

    if (classes.length === 0) {
      classes = [...STATIC_CLASSES];
    }

    const currentFilters = await getPreferredFilters(classes);
    const wrappedList = (list || []).map(wrapMovieAsGroupItem);
    return {
      class: classes,
      list: wrappedList,
      filters: currentFilters,
    };
  } catch (error) {
    OmniBox.log("error", `蜗牛4K 获取首页数据失败: ${error.message}`);
    return {
      class: STATIC_CLASSES,
      list: [],
      filters: {},
    };
  }
}

async function category(params) {
  try {
    const categoryId = params.categoryId || params.type_id || "";
    const page = parseInt(params.page || "1", 10);
    const filters = params.filters || {};

    OmniBox.log("info", `蜗牛4K 获取分类数据: categoryId=${categoryId}, page=${page}`);

    if (!categoryId) {
      OmniBox.log("warn", "分类ID为空");
      return {
        list: [],
        page: 1,
        pagecount: 0,
        total: 0,
      };
    }

    // 影片分组跳转: 格式 "mvg:videoId", 返回该片所有网盘分组(当前列表页就地显示)
    if (String(categoryId).startsWith("mvg:")) {
      const vid = String(categoryId).slice(4);
      OmniBox.log("info", `蜗牛4K 影片分组(category): videoId=${vid}`);
      return await getMovieDriveGroups(vid);
    }

    // 影片网盘分组跳转: 格式 "mv:网盘类型:videoId", 返回该片该类型下过滤后的链接列表
    const movieGroup = parseMovieGroupVodId(categoryId);
    if (movieGroup) {
      OmniBox.log("info", `蜗牛4K 影片分组(category): driveType=${movieGroup.driveType}, videoId=${movieGroup.videoId}`);
      return await searchLinksByDriveForMovie(movieGroup.videoId, movieGroup.driveType);
    }

    // 网盘分类跳转: 格式 "网盘类型|关键词"
    const panGroup = parsePanGroupVodId(categoryId);
    if (panGroup) {
      OmniBox.log("info", `蜗牛4K 网盘分类跳转: driveType=${panGroup.driveType}, keyword=${panGroup.keyword}`);
      return await searchVideosByDrive(panGroup.keyword, page, panGroup.driveType);
    }

    // mxone 伪静态优先；有筛选时回退 show 路径
    let url = buildCategoryPath(categoryId, page);
    const hasFilter = filters.area || filters.class || filters.lang || filters.letter || filters.year || filters.sort || filters.by || filters.tid || filters.id;
    if (hasFilter) {
      url = "/index.php/vod/show";
      if (filters.area) url += `/area/${encodeURIComponent(filters.area)}`;
      const sortValue = filters.sort || filters.by;
      if (sortValue) url += `/by/${encodeURIComponent(sortValue)}`;
      if (filters.class) url += `/class/${encodeURIComponent(filters.class)}`;
      if (filters.lang) url += `/lang/${encodeURIComponent(filters.lang)}`;
      if (filters.letter) url += `/letter/${encodeURIComponent(filters.letter)}`;
      if (filters.year) url += `/year/${encodeURIComponent(filters.year)}`;
      const tidValue = filters.tid || filters.id || categoryId;
      url += `/id/${tidValue}`;
      if (page > 1) url += `/page/${page}`;
      url += ".html";
    }

    const { response, baseUrl } = await requestWithFailover(url);

    if (response.statusCode !== 200 || !response.body) {
      OmniBox.log("error", `请求失败: HTTP ${response.statusCode}`);
      return {
        list: [],
        page: page,
        pagecount: 0,
        total: 0,
      };
    }

    const videos = parseListFromHtml(response.body, baseUrl).map((item) => ({
      ...item,
      type_id: categoryId,
    }));

    OmniBox.log("info", `蜗牛4K 分类解析完成,找到 ${videos.length} 个视频`);

    const autoFilters = parseFiltersFromHtml(response.body);
    let categoryFilters = autoFilters;

    if (categoryFilters.length === 0) {
      const preferredFilters = await getPreferredFilters([{ type_id: categoryId, type_name: "" }]);
      categoryFilters = preferredFilters[categoryId] || [];
    }

    const pagecount = parsePageCount(response.body, page);
    const result = {
      list: (videos || []).map(wrapMovieAsGroupItem),
      page: page,
      pagecount: pagecount,
      total: videos.length,
    };

    if (page === 1 && categoryFilters.length > 0) {
      result.filters = categoryFilters;
    }

    return result;
  } catch (error) {
    OmniBox.log("error", `蜗牛4K 获取分类数据失败: ${error.message}`);
    return {
      list: [],
      page: params.page || 1,
      pagecount: 0,
      total: 0,
    };
  }
}

function buildScrapedFileName(scrapeData, mapping, originalFileName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalFileName;
  }

  if (scrapeData && scrapeData.episodes && Array.isArray(scrapeData.episodes)) {
    for (const episode of scrapeData.episodes) {
      if (episode.episodeNumber === mapping.episodeNumber && episode.seasonNumber === mapping.seasonNumber) {
        if (episode.name) {
          return `${episode.episodeNumber}.${episode.name}`;
        }
        break;
      }
    }
  }

  return originalFileName;
}

function normalizeEpisodeName(name = "") {
  return String(name || "")
    .replace(/\.[^.]+$/g, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function encodePlayMeta(obj = {}) {
  try {
    const raw = JSON.stringify(obj || {});
    return Buffer.from(raw, "utf8").toString("base64");
  } catch {
    return "";
  }
}

function decodePlayMeta(str = "") {
  try {
    if (!str) return {};
    const raw = Buffer.from(str, "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

async function getDetailPageCached(videoId) {
  const authState = hasAuthCookies() ? "auth" : "guest";
  const detailCacheKey = buildCacheKey("woniu4k:detailHtml", `${videoId}:${authState}`);
  let detailPage = await getCachedJSON(detailCacheKey);
  if (!detailPage) {
    detailPage = await requestWithFailover(videoId);
    if (detailPage && detailPage.response && detailPage.response.statusCode === 200 && detailPage.response.body) {
      await setCachedJSON(detailCacheKey, detailPage, WONIU_CACHE_EX_SECONDS);
    }
  } else {
    logDetailDebug(`命中详情页缓存: ${videoId} (${authState})`);
  }
  return detailPage;
}

function isDriveRateLimitError(err) {
  const msg = String(err?.message || "");
  return /405|429|频率|风控|太快|频繁|rate.?limit|too many|too fast|超时|timeout|502|503/i.test(msg);
}

async function callDriveApiWithRetry(fn, options = {}) {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const baseDelay = Math.max(1000, options.baseDelay ?? DRIVE_API_DELAY_MS);
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const shouldRetry = isDriveRateLimitError(error) && attempt < maxRetries;
      if (!shouldRetry) throw error;
      const wait = baseDelay * Math.pow(2, attempt);
      OmniBox.log("warn", `网盘接口被限流(第${attempt + 1}次重试): ${error.message}, ${wait}ms 后重试`);
      await sleep(wait);
    }
  }
}

async function getDriveInfoCached(shareURL) {
  const cacheKey = buildCacheKey("woniu4k:driveInfo", shareURL);
  let driveInfo = await getCachedJSON(cacheKey);
  if (!driveInfo) {
    driveInfo = await callDriveApiWithRetry(() => OmniBox.getDriveInfoByShareURL(shareURL));
    await setCachedJSON(cacheKey, driveInfo, WONIU_CACHE_EX_SECONDS);
  }
  return driveInfo;
}

async function getRootFileListCached(shareURL) {
  const cacheKey = buildCacheKey("woniu4k:rootFiles", shareURL);
  let fileList = await getCachedJSON(cacheKey);
  if (!fileList) {
    fileList = await callDriveApiWithRetry(() => OmniBox.getDriveFileList(shareURL, "0"));
    if (fileList && fileList.files && Array.isArray(fileList.files)) {
      await setCachedJSON(cacheKey, fileList, WONIU_CACHE_EX_SECONDS);
    }
  } else {
    logDetailDebug(`命中根目录文件列表缓存: ${shareURL}`);
  }
  return fileList;
}

async function getAllVideoFilesCached(shareURL, rootFiles) {
  const cacheKey = buildCacheKey("woniu4k:videoFiles", shareURL);
  let allVideoFiles = await getCachedJSON(cacheKey);
  if (!Array.isArray(allVideoFiles) || allVideoFiles.length === 0) {
    allVideoFiles = await getAllVideoFiles(shareURL, rootFiles, "0");
    if (Array.isArray(allVideoFiles) && allVideoFiles.length > 0) {
      await setCachedJSON(cacheKey, allVideoFiles, WONIU_CACHE_EX_SECONDS);
    }
  } else {
    logDetailDebug(`命中视频文件缓存: ${shareURL}, 数量: ${allVideoFiles.length}`);
  }
  return allVideoFiles;
}

function buildMergedVideoFilesForScraping(panUrlResults, videoId) {
  const mergedVideoFilesForScraping = [];
  for (const result of panUrlResults) {
    const { shareURL, allVideoFiles } = result;
    for (const file of allVideoFiles) {
      const fileId = file.fid || file.file_id || "";
      const formattedFileId = fileId ? `${shareURL}|${fileId}|${videoId}` : fileId;
      mergedVideoFilesForScraping.push({
        ...file,
        fid: formattedFileId,
        file_id: formattedFileId,
        _shareURL: shareURL,
      });
    }
  }
  return mergedVideoFilesForScraping;
}

async function getMergedMetadataCached(videoId, vodName, mergedVideoFilesForScraping) {
  const metadataCacheKey = buildCacheKey("woniu4k:metadata", videoId);
  const metadataRefreshLockKey = buildCacheKey("woniu4k:metadataRefreshLock", videoId);

  let scrapeData = null;
  let videoMappings = [];
  let scrapeType = "";
  const cachedMetadata = await getCachedJSON(metadataCacheKey);

  if (cachedMetadata) {
    scrapeData = cachedMetadata.scrapeData || null;
    videoMappings = cachedMetadata.videoMappings || [];
    scrapeType = cachedMetadata.scrapeType || "";
    logDetailDebug(`命中统一元数据缓存: ${videoId}, 映射数量: ${videoMappings.length}`);
  }

  const refreshMetadataInBackground = async () => {
    const refreshLock = await getCachedJSON(metadataRefreshLockKey);
    if (refreshLock) return;
    await setCachedJSON(metadataRefreshLockKey, { refreshing: true }, WONIU_CACHE_EX_SECONDS);

    try {
      logDetailDebug(`后台统一刷新元数据: ${videoId}`);
      await OmniBox.processScraping(videoId, vodName, vodName, mergedVideoFilesForScraping);
      const metadata = await OmniBox.getScrapeMetadata(videoId);
      await setCachedJSON(metadataCacheKey, {
        scrapeData: metadata?.scrapeData || null,
        videoMappings: metadata?.videoMappings || [],
        scrapeType: metadata?.scrapeType || "",
      }, WONIU_CACHE_EX_SECONDS);
    } catch (error) {
      OmniBox.log("warn", `后台统一刷新元数据失败: ${error.message}`);
    }
  };

  if (!cachedMetadata && mergedVideoFilesForScraping.length > 0) {
    try {
      OmniBox.log("info", `未命中统一元数据缓存，开始同步刮削: ${videoId}, 文件数: ${mergedVideoFilesForScraping.length}`);
      await OmniBox.processScraping(videoId, vodName, vodName, mergedVideoFilesForScraping);
      const metadata = await OmniBox.getScrapeMetadata(videoId);
      scrapeData = metadata?.scrapeData || null;
      videoMappings = metadata?.videoMappings || [];
      scrapeType = metadata?.scrapeType || "";
      await setCachedJSON(metadataCacheKey, {
        scrapeData,
        videoMappings,
        scrapeType,
      }, WONIU_CACHE_EX_SECONDS);
      if (scrapeData) {
        OmniBox.log("info", `同步统一获取元数据成功, 标题: ${scrapeData.title || "未知"}, 映射数量: ${videoMappings.length}`);
      }
    } catch (error) {
      OmniBox.log("error", `同步统一获取元数据失败: ${error.message}`);
      if (error.stack) {
        OmniBox.log("error", `同步统一获取元数据错误堆栈: ${error.stack}`);
      }
    }
  } else if (cachedMetadata) {
    refreshMetadataInBackground().catch((error) => {
      OmniBox.log("warn", `异步统一刷新元数据失败: ${error.message}`);
    });
  }

  return {
    scrapeData,
    videoMappings,
    scrapeType,
    cachedMetadata,
  };
}

function parseVodBaseInfo($, baseUrl) {
  let vodName =
    $("h1").first().text().replace(/\s+/g, " ").trim() ||
    $(".page-title").first().text().replace(/\s+/g, " ").trim() ||
    $(".video-info-header h1").first().text().replace(/\s+/g, " ").trim() ||
    $(".module-info-heading h1").first().text().replace(/\s+/g, " ").trim() ||
    $(".mobile-detail-title").first().text().replace(/\s+/g, " ").trim() ||
    $(".premium-title").first().text().replace(/\s+/g, " ").trim() ||
    "";

  let vodPic =
    $(".module-item-pic img,.module-info-poster img,.video-cover img,img.lazyload,img.lazy,.premium-poster img")
      .first()
      .attr("data-src") ||
    $(".module-item-pic img,.module-info-poster img,.video-cover img,img.lazyload,img.lazy,.premium-poster img")
      .first()
      .attr("data-original") ||
    $(".module-item-pic img,.module-info-poster img,.video-cover img,img.lazyload,img.lazy,.premium-poster img")
      .first()
      .attr("src") ||
    $($(".mobile-play")).find(".lazyload")[0]?.attribs?.["data-src"] ||
    "";
  vodPic = absUrl(vodPic, baseUrl);

  let vodYear = "";
  let vodDirector = "";
  let vodActor = "";
  let vodContent = "";

  const videoItems = $(".video-info-itemtitle");
  for (const item of videoItems) {
    const key = $(item).text();
    const vItems = $(item).next().find("a");
    const value = vItems
      .map((i, el) => {
        const text = $(el).text().trim();
        return text ? text : null;
      })
      .get()
      .filter(Boolean)
      .join(", ");

    if (key.includes("剧情")) {
      vodContent = $(item).next().find("p").text().trim();
    } else if (key.includes("导演")) {
      vodDirector = value.trim();
    } else if (key.includes("主演")) {
      vodActor = value.trim();
    } else if (key.includes("年代") || key.includes("年份") || key.includes("上映")) {
      const yearText = $(item).next().text().trim() || value;
      const m = yearText.match(/(19|20)\d{2}/);
      if (m) vodYear = m[0];
    }
  }

  if (!vodContent) {
    vodContent = cleanContent(
      $(".vod_content,.module-info-introduction,.video-info-content,.module-info-main .module-info-item-content,.detail-desc-text,.premium-plot")
        .last()
        .text() || ""
    );
  }

  const infoText = $(".video-info,.module-info-main,.module-info,.premium-meta-grid,.detail-info-premium").text() || "";
  if (!vodYear) {
    const m = infoText.match(/(?:年代|年份|上映)[:：]?\s*(\d{4})/) || infoText.match(/\b(19|20)\d{2}\b/);
    if (m) vodYear = String(m[1] || m[0]).replace(/\D/g, "").slice(0, 4);
  }
  if (!vodDirector) {
    const m = infoText.match(/导演[:：]?\s*([^\n]+?)\s*(主演|年代|备注|剧情|$)/);
    if (m) vodDirector = m[1].replace(/^\/\s*/, "").trim();
  }
  if (!vodActor) {
    const m = infoText.match(/主演[:：]?\s*([^\n]+?)\s*(年代|备注|剧情|导演|$)/);
    if (m) vodActor = m[1].replace(/^\/\s*/, "").trim();
  }

  // panlian_dark: parse meta-grid items
  if (!vodDirector || !vodActor || !vodYear) {
    $(".premium-meta-grid .meta-item").each((_, el) => {
      const label = $(el).find(".m-label").text().trim();
      const val = $(el).find(".m-val").text().trim();
      if (!label || !val) return;
      if (!vodDirector && (label.includes("导演"))) vodDirector = val;
      if (!vodActor && (label.includes("主演"))) vodActor = val;
      if (!vodYear && (label.includes("年代") || label.includes("年份") || label.includes("上映"))) {
        const m = val.match(/(19|20)\d{2}/);
        if (m) vodYear = m[0];
      }
    });
  }

  // panlian_dark: parse year from tags
  if (!vodYear) {
    $(".premium-tags-top .p-tag").each((_, el) => {
      const txt = $(el).text().trim();
      const m = txt.match(/^(19|20)\d{2}$/);
      if (m) vodYear = m[0];
    });
  }

  return {
    vodName,
    vodPic,
    vodYear,
    vodDirector,
    vodActor,
    vodContent,
  };
}

function extractPanUrls($) {
  const panUrls = [];
  const seen = new Set();

  // mxone 模板
  $(".module-row-info").each((_, el) => {
    const candidates = [];
    $(el).find("[data-clipboard-text]").each((__, n) => candidates.push($(n).attr("data-clipboard-text")));
    $(el).find('a[href^="http"]').each((__, a) => candidates.push($(a).attr("href")));
    $(el).find("i,p,span").each((__, p) => candidates.push($(p).text().trim()));
    const firstP = $(el).find("p")[0]?.children?.[0]?.data;
    if (firstP) candidates.push(firstP);

    for (const raw of candidates) {
      const url = extractPanUrl(raw);
      if (!/^https?:\/\//i.test(url) || !isPanShareUrl(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      panUrls.push(url);
    }
  });

  // panlian_dark 模板
  $(".pan-link-item[data-pan-item]").each((_, el) => {
    const candidates = [];
    $(el).find("[data-copy]").each((__, n) => candidates.push($(n).attr("data-copy")));
    $(el).find('a[href^="http"]').each((__, a) => candidates.push($(a).attr("href")));
    $(el).find(".pan-link-meta").each((__, m) => candidates.push($(m).text().trim()));
    for (const raw of candidates) {
      const url = extractPanUrl(raw);
      if (!/^https?:\/\//i.test(url) || !isPanShareUrl(url)) continue;
      if (seen.has(url)) continue;
      seen.add(url);
      panUrls.push(url);
    }
  });

  // 兜底：整页扫描分享链接
  if (panUrls.length === 0) {
    const html = $.html() || "";
    const re =
      /https?:\/\/(?:115cdn\.com|115\.com|anxia\.com|pan\.quark\.cn|www\.aliyundrive\.com|www\.alipan\.com|pan\.baidu\.com|drive\.uc\.cn|cloud\.189\.cn|www\.123pan\.com|pan\.xunlei\.com)\/[^\s"'<>]+/gi;
    let m;
    while ((m = re.exec(html))) {
      const url = normalizeShareUrl(m[0]);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      panUrls.push(url);
    }
  }

  return panUrls;
}

function extractPanItems($) {
  const items = [];
  const seen = new Set();

  const pushUrl = (raw, name) => {
    const url = extractPanUrl(raw);
    if (!/^https?:\/\//i.test(url) || !isPanShareUrl(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    items.push({
      url,
      name: String(name || "")
        .replace(/https?:\/\/\S+/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
    });
  };

  // panlian_dark 模板
  $(".pan-link-item[data-pan-item]").each((_, el) => {
    const itemEl = $(el);
    const attrUrl = itemEl.attr("data-pan-item");
    let name = itemEl
      .find(".pan-link-title,.pan-link-label,.pan-link-name,.link-title,.title")
      .first()
      .text()
      .trim();
    if (!name) name = itemEl.find(".pan-link-meta").first().text().trim();
    if (attrUrl) pushUrl(attrUrl, name);
    itemEl.find("[data-copy]").each((__, n) => pushUrl($(n).attr("data-copy"), name));
    itemEl.find('a[href^="http"]').each((__, a) => pushUrl($(a).attr("href"), name));
  });

  // mxone 模板
  $(".module-row-info").each((_, el) => {
    const name = $(el).find(".module-row-title,.module-item-title").first().text().trim();
    $(el).find("[data-clipboard-text]").each((__, n) => pushUrl($(n).attr("data-clipboard-text"), name));
    $(el).find('a[href^="http"]').each((__, a) => pushUrl($(a).attr("href"), name));
  });

  // 兜底：整页扫描分享链接
  if (items.length === 0) {
    const html = $.html() || "";
    const re =
      /https?:\/\/(?:115cdn\.com|115\.com|anxia\.com|pan\.quark\.cn|www\.aliyundrive\.com|www\.alipan\.com|pan\.baidu\.com|drive\.uc\.cn|cloud\.189\.cn|www\.123pan\.com|pan\.xunlei\.com)\/[^\s"'<>]+/gi;
    let m;
    while ((m = re.exec(html))) {
      const url = normalizeShareUrl(m[0]);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      items.push({ url, name: "" });
    }
  }

  return items;
}

async function collectDriveTypeCountMap(panUrls = []) {
  const driveTypeCountMap = {};
  for (const shareURL of panUrls) {
    try {
      const driveInfo = await getDriveInfoCached(shareURL);
      const displayName = driveInfo?.displayName || "未知网盘";
      driveTypeCountMap[displayName] = (driveTypeCountMap[displayName] || 0) + 1;
    } catch (error) {
      OmniBox.log("warn", `统计网盘类型失败: ${shareURL}, error=${error.message}`);
    }
  }
  return driveTypeCountMap;
}

/**
 * 获取视频详情
 */
function parseMovieGroupVodId(raw = "") {
  const s = String(raw || "").trim();
  if (!s.startsWith("mv:")) return null;
  const parts = s.split(":");
  if (parts.length < 3) return null;
  const driveType = parts[1] || "";
  const videoId = parts.slice(2).join(":");
  if (!driveType || !videoId) return null;
  return { driveType, videoId };
}

function parseShareUrlWithTitle(raw = "") {
  const s = String(raw || "").trim();
  if (!s.includes("|")) return null;
  const idx = s.indexOf("|");
  const urlPart = s.slice(0, idx).trim();
  const title = s.slice(idx + 1).trim();
  if (!/^https?:\/\//i.test(urlPart) || !isPanShareUrl(urlPart)) return null;
  const shareURL = normalizeShareUrl(urlPart);
  if (!shareURL) return null;
  return { shareURL, title };
}

async function buildShareUrlDetail(shareURL, title = "") {
  const driveInfo = await getDriveInfoCached(shareURL);
  const displayName = driveInfo?.displayName || "网盘";
  const fileList = await getRootFileListCached(shareURL);
  const allVideoFiles = await getAllVideoFilesCached(shareURL, fileList?.files || []);
  const episodes = (allVideoFiles || []).map((file) => {
    const fileName = file.file_name || "";
    const fileId = file.fid || "";
    const fileSize = file.size || file.file_size || 0;
    const basePlayId = fileId ? `${shareURL}|${fileId}` : "";
    let displayFileName = fileName;
    if (fileSize > 0) {
      const fileSizeStr = formatFileSize(fileSize);
      if (fileSizeStr) displayFileName = `[${fileSizeStr}] ${fileName}`;
    }
    return {
      name: displayFileName,
      playId: basePlayId,
      size: fileSize > 0 ? fileSize : undefined,
      rawName: fileName,
    };
  }).filter((ep) => ep.name && ep.playId);
  return {
    list: [{
      vod_id: shareURL,
      vod_name: title || `${displayName}推送`,
      vod_pic: "",
      vod_content: shareURL,
      vod_play_sources: episodes.length > 0 ? [{ name: displayName, episodes }] : undefined,
      vod_remarks: title || "网盘推送",
    }],
  };
}

async function detail(params, context) {
  try {
    const rawVideoId = params.videoId || params.id || params.vod_id || "";

    // 影片分组跳转: 格式 "mvg:videoId"
    if (String(rawVideoId).startsWith("mvg:")) {
      const vid = String(rawVideoId).slice(4);
      OmniBox.log("info", `蜗牛4K 影片分组(detail): videoId=${vid}`);
      return await getMovieDriveGroups(vid);
    }

    // 影片网盘分组: 格式 "mv:网盘类型:videoId"
    const movieGroup = parseMovieGroupVodId(rawVideoId);
    if (movieGroup) {
      OmniBox.log("info", `蜗牛4K 影片分组链接: driveType=${movieGroup.driveType}, videoId=${movieGroup.videoId}`);
      return await searchLinksByDriveForMovie(movieGroup.videoId, movieGroup.driveType);
    }

    // 网盘分类单条链接项: 格式 "分享链接|剧名"
    const shareWithTitle = parseShareUrlWithTitle(rawVideoId);
    if (shareWithTitle) {
      OmniBox.log("info", `蜗牛4K 网盘单链接详情: 剧名=${shareWithTitle.title}`);
      return await buildShareUrlDetail(shareWithTitle.shareURL, shareWithTitle.title);
    }

    // 兼容网盘分类跳转: 格式 "网盘类型|关键词"
    const panGroup = parsePanGroupVodId(rawVideoId);
    if (panGroup) {
      OmniBox.log("info", `蜗牛4K 详情收到网盘分类ID,转分类处理: ${panGroup.driveType}/${panGroup.keyword}`);
      return await searchVideosByDrive(panGroup.keyword, 1, panGroup.driveType);
    }

    const videoId = normalizeVideoId(rawVideoId);

    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    // 支持直接推送网盘分享链接
    if (/^https?:\/\//i.test(String(videoId)) && isPanShareUrl(videoId)) {
      const shareURL = normalizeShareUrl(videoId);
      OmniBox.log("info", `蜗牛4K 网盘推送详情: ${shareURL}`);
      return await buildShareUrlDetail(shareURL, "");
    }

    const source = params.source || "";
    OmniBox.log("info", `蜗牛4K 获取视频详情: videoId=${videoId}, source=${source}`);

    // 未登录时尝试自动登录（已配置用户名密码时），确保能拿到完整网盘链接
    await ensureLogin();

    const detailPath = buildDetailPath(videoId);
    const detailPage = await getDetailPageCached(detailPath);
    const { response, baseUrl } = detailPage;

    if (response.statusCode !== 200 || !response.body) {
      throw new Error(`请求失败: HTTP ${response.statusCode}`);
    }

    const $ = cheerio.load(response.body);
    const {
      vodName,
      vodPic,
      vodYear,
      vodDirector,
      vodActor,
      vodContent,
    } = parseVodBaseInfo($, baseUrl);

    const panUrls = extractPanUrls($).map(normalizeShareUrl).filter(Boolean);
    logDetailDebug(`解析完成,网盘链接数=${panUrls.length}`);

    // 影片详情按网盘分组返回(避免一次性枚举全部链接触发风控); 正常流程影片走 category(mvg:...), 此处为兜底
    const driveGroupList = buildMovieDriveGroups(videoId, vodName, vodPic, panUrls);
    if (driveGroupList.length > 0) {
      OmniBox.log("info", `蜗牛4K 影片转网盘分组: ${driveGroupList.length}个分组`);
      return { list: driveGroupList, page: 1, pagecount: 1, total: driveGroupList.length };
    }

    // 未解析到任何网盘链接(如锁定页/未登录), 直接返回空, 不进入慢速枚举
    OmniBox.log("warn", `蜗牛4K 影片 ${videoId} 未解析到网盘链接`);
    return { list: [], page: 1, pagecount: 0, total: 0 };

    let playSources = [];

    const driveTypeCountMap = await collectDriveTypeCountMap(panUrls);
    const driveTypeCurrentIndexMap = {};

    // ==================== 串行处理网盘链接（带限流延迟，避免触发风控） ====================
    const panUrlResults = [];
    for (let pi = 0; pi < panUrls.length; pi++) {
      const shareURL = panUrls[pi];
      try {
        if (pi > 0 && DRIVE_API_DELAY_MS > 0) {
          await sleep(DRIVE_API_DELAY_MS);
        }

        logDetailDebug(`处理网盘链接 ${pi + 1}/${panUrls.length}: ${shareURL}`);

        const driveInfo = await getDriveInfoCached(shareURL);
        let displayName = driveInfo.displayName || "未知网盘";

        const totalCount = driveTypeCountMap[displayName] || 0;
        if (totalCount > 1) {
          driveTypeCurrentIndexMap[displayName] = (driveTypeCurrentIndexMap[displayName] || 0) + 1;
          displayName = `${displayName}${driveTypeCurrentIndexMap[displayName]}`;
        }

        logDetailDebug(`网盘类型: ${displayName}, driveType: ${driveInfo.driveType}`);

        const fileList = await getRootFileListCached(shareURL);

        if (!fileList || !fileList.files || !Array.isArray(fileList.files)) {
          OmniBox.log("warn", `获取文件列表失败: ${shareURL}`);
          continue;
        }

        logDetailDebug(`从分享链接 ${shareURL} 获取文件列表成功,文件数量: ${fileList.files.length}`);

        const allVideoFiles = await getAllVideoFilesCached(shareURL, fileList.files);

        if (!allVideoFiles || allVideoFiles.length === 0) {
          OmniBox.log("warn", `未找到视频文件: ${shareURL}`);
          continue;
        }

        logDetailDebug(`递归获取视频文件完成,视频文件数量: ${allVideoFiles.length}`);

        panUrlResults.push({
          shareURL,
          displayName,
          driveInfo,
          allVideoFiles,
        });
      } catch (error) {
        OmniBox.log("error", `处理网盘链接失败: ${shareURL}, 错误: ${error.message}`);
      }
    }
    OmniBox.log("info", `方案A: 有效网盘结果数量=${panUrlResults.length}`);

    const mergedVideoFilesForScraping = buildMergedVideoFilesForScraping(panUrlResults, videoId);
    OmniBox.log("info", `方案A: 合并用于刮削的视频文件数量=${mergedVideoFilesForScraping.length}`);

    const {
      scrapeData,
      videoMappings,
      scrapeType,
    } = await getMergedMetadataCached(videoId, vodName, mergedVideoFilesForScraping);
    logDetailDebug(`方案A: 当前统一元数据映射数量=${videoMappings.length}, scrapeType=${scrapeType || "unknown"}`);

    // 处理结果并构建播放源
    for (const result of panUrlResults) {
      const { shareURL, displayName, driveInfo, allVideoFiles } = result;

      let sourceNames = [displayName];
      const targetDriveTypes = DRIVE_TYPE_CONFIG;
      const configSourceNames = SOURCE_NAMES_CONFIG;

      if (targetDriveTypes.includes(driveInfo.driveType)) {
        sourceNames = [...configSourceNames];
        OmniBox.log("info", `${displayName} 匹配成功,初始线路设置为: ${sourceNames.join(", ")}`);
        sourceNames = filterSourceNamesForCaller(sourceNames, source, context);
        OmniBox.log("info", `来源=${source || "unknown"},最终线路设置为: ${sourceNames.join(", ")}`);
      }

      for (const sourceName of sourceNames) {
        const episodes = [];
        for (const file of allVideoFiles) {
          let fileName = file.file_name || "";
          const fileId = file.fid || "";
          const fileSize = file.size || file.file_size || 0;

          if (!fileName || !fileId) {
            continue;
          }

          const formattedFileId = fileId ? `${shareURL}|${fileId}|${videoId}` : "";

          let matchedMapping = null;
          if (scrapeData && videoMappings && Array.isArray(videoMappings) && videoMappings.length > 0) {
            for (const mapping of videoMappings) {
              if (mapping && mapping.fileId === formattedFileId) {
                matchedMapping = mapping;
                const newFileName = buildScrapedFileName(scrapeData, mapping, fileName);
                if (newFileName && newFileName !== fileName) {
                  fileName = newFileName;
                  OmniBox.log("info", `应用刮削文件名: ${file.file_name} -> ${fileName}`);
                }
                break;
              }
            }
          }

          const normalizedOriginalEpisodeName = normalizeEpisodeName(file.file_name || fileName);
          const playMeta = encodePlayMeta({
            sid: videoId,
            fid: fileId ? `${shareURL}|${fileId}` : "",
            v: vodName || "",
            t: vodName,
            e: normalizedOriginalEpisodeName,
          });
          const basePlayId = fileId ? `${shareURL}|${fileId}` : "";

          let displayFileName = fileName;
          if (fileSize > 0) {
            const fileSizeStr = formatFileSize(fileSize);
            if (fileSizeStr) {
              displayFileName = `[${fileSizeStr}] ${fileName}`;
            }
          }

          const episode = {
            name: displayFileName,
            playId: playMeta ? `${basePlayId}|${playMeta}` : basePlayId,
            size: fileSize > 0 ? fileSize : undefined,
            rawName: file.file_name || "",
          };

          if (matchedMapping) {
            if (matchedMapping.seasonNumber !== undefined && matchedMapping.seasonNumber !== null) {
              episode._seasonNumber = matchedMapping.seasonNumber;
            }
            if (matchedMapping.episodeNumber !== undefined && matchedMapping.episodeNumber !== null) {
              episode._episodeNumber = matchedMapping.episodeNumber;
            }
            if (matchedMapping.episodeName) {
              episode.episodeName = matchedMapping.episodeName;
            }
            if (matchedMapping.episodeOverview) {
              episode.episodeOverview = matchedMapping.episodeOverview;
            }
            if (matchedMapping.episodeAirDate) {
              episode.episodeAirDate = matchedMapping.episodeAirDate;
            }
            if (matchedMapping.episodeStillPath) {
              episode.episodeStillPath = matchedMapping.episodeStillPath;
            }
            if (matchedMapping.episodeVoteAverage !== undefined && matchedMapping.episodeVoteAverage !== null) {
              episode.episodeVoteAverage = matchedMapping.episodeVoteAverage;
            }
            if (matchedMapping.episodeRuntime !== undefined && matchedMapping.episodeRuntime !== null) {
              episode.episodeRuntime = matchedMapping.episodeRuntime;
            }
          }

          if (!episode.episodeName) {
            episode.episodeName = normalizedOriginalEpisodeName || file.file_name || fileName;
          }

          if (episode.name && episode.playId) {
            episodes.push(episode);
          }
        }

        if (scrapeData && episodes.length > 0) {
          const hasEpisodeNumber = episodes.some((ep) => ep._episodeNumber !== undefined);
          if (hasEpisodeNumber) {
            OmniBox.log("info", `检测到刮削数据，按 episodeNumber 排序剧集列表，共 ${episodes.length} 集`);
            episodes.sort((a, b) => {
              const seasonA = a._seasonNumber !== undefined ? a._seasonNumber : 0;
              const seasonB = b._seasonNumber !== undefined ? b._seasonNumber : 0;
              if (seasonA !== seasonB) return seasonA - seasonB;
              const episodeA = a._episodeNumber !== undefined ? a._episodeNumber : 0;
              const episodeB = b._episodeNumber !== undefined ? b._episodeNumber : 0;
              if (episodeA !== episodeB) return episodeA - episodeB;
              return a.name.localeCompare(b.name, 'zh-CN');
            });
          }
        }

        OmniBox.log("info", `方案A: shareURL=${shareURL}, sourceName=${sourceName}, episodes=${episodes.length}`);
        if (episodes.length > 0) {
          const lineName = targetDriveTypes.includes(driveInfo.driveType)
            ? `${displayName}-${sourceName}`
            : displayName;
          playSources.push({
            name: lineName,
            episodes,
          });
        }
      }
    }
    OmniBox.log("info", `方案A: 最终线路数=${playSources.length}`);
    if (Array.isArray(playSources) && playSources.length > 1 && DRIVE_ORDER.length > 0) {
      playSources = sortPlaySourcesByDriveOrder(playSources);
      OmniBox.log("info", `[detail] 按 DRIVE_ORDER 排序后线路顺序: ${playSources.map(item => item.name).join(' | ')}`);
    }

    const vodDetail = {
      vod_id: videoId,
      vod_name: vodName,
      vod_pic: vodPic,
      vod_year: vodYear,
      vod_director: vodDirector,
      vod_actor: vodActor,
      vod_content: vodContent || `网盘资源,共${panUrls.length}个网盘链接`,
      vod_play_sources: playSources.length > 0 ? playSources : undefined,
      vod_remarks: "",
    };

    return {
      list: [vodDetail],
    };
  } catch (error) {
    OmniBox.log("error", `获取视频详情失败: ${error.message}`);
    return {
      list: [],
    };
  }
}

// ==================== 网盘分组 ====================
const PAN_NAMES = {
  "115": "115网盘",
  quark: "夸克网盘",
  uc: "UC网盘",
  baidu: "百度网盘",
  tianyi: "天翼云盘",
  aliyun: "阿里云盘",
  xunlei: "迅雷网盘",
  pan123: "123云盘",
  cmcc: "移动云盘",
};

function inferDriveTypeFromShareURL(shareURL = "") {
  const raw = String(shareURL || "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("pan.quark.cn") || raw.includes("drive.quark.cn")) return "quark";
  if (raw.includes("drive.uc.cn") || raw.includes("fast.uc.cn")) return "uc";
  if (raw.includes("pan.baidu.com")) return "baidu";
  if (raw.includes("cloud.189.cn")) return "tianyi";
  if (raw.includes("yun.139.com")) return "cmcc";
  if (raw.includes("aliyundrive.com") || raw.includes("alipan.com")) return "aliyun";
  if (raw.includes("pan.xunlei.com")) return "xunlei";
  if (raw.includes("115.com") || raw.includes("115cdn.com") || raw.includes("anxia.com")) return "115";
  if (raw.includes("123pan.com") || raw.includes("123684.com") || raw.includes("123865.com") || raw.includes("123912.com")) return "pan123";
  return "";
}

const PANCHECK_PLATFORM_ALL = ["quark", "uc", "baidu", "tianyi", "pan123", "pan115", "aliyun", "xunlei", "cmcc"];

function toPanCheckPlatformName(driveType = "") {
  const t = String(driveType || "").toLowerCase().trim();
  if (t === "115" || t === "pan_115" || t === "pan115") return "pan115";
  if (PANCHECK_PLATFORM_ALL.includes(t)) return t;
  return "";
}

async function checkLinksWithPanCheck(links) {
  if (!PANCHECK_ENABLED || !PANCHECK_API || !Array.isArray(links) || links.length === 0) {
    return { invalidLinksSet: new Set(), stats: null };
  }
  try {
    const linksToCheck = links.filter(Boolean);
    const platforms = [];
    for (const link of linksToCheck) {
      const p = toPanCheckPlatformName(inferDriveTypeFromShareURL(link));
      if (p && !platforms.includes(p)) platforms.push(p);
    }
    const selectedPlatforms = platforms.length > 0 ? platforms : [...PANCHECK_PLATFORM_ALL];

    OmniBox.log("info", `开始调用 PanCheck 检测链接, 总链接: ${linksToCheck.length}, 平台: ${selectedPlatforms.join(",")}`);

    const requestBody = { links: linksToCheck, selected_platforms: selectedPlatforms };

    const response = await axios({
      url: `${PANCHECK_API}/api/v1/links/check`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      data: JSON.stringify(requestBody),
      timeout: 60000,
      validateStatus: () => true,
      responseType: "text",
    });

    const bodyText = String(response.data || "");
    if (response.status !== 200) {
      OmniBox.log("warn", `PanCheck API 响应错误: ${response.status}, body=${bodyText.slice(0, 300)}`);
      return { invalidLinksSet: new Set(), stats: null };
    }

    let data = {};
    try {
      data = JSON.parse(bodyText || "{}");
    } catch (e) {
      OmniBox.log("warn", `PanCheck 响应不是合法 JSON, body=${bodyText.slice(0, 500)}`);
      return { invalidLinksSet: new Set(), stats: null };
    }

    const invalidLinks = data.invalid_links || data.invalidLinks || [];
    return {
      invalidLinksSet: new Set(invalidLinks),
      stats: {
        submitted: linksToCheck.length,
        valid: (data.valid_links || data.validLinks || []).length,
        invalid: invalidLinks.length,
        pending: (data.pending_links || []).length,
        duration: data.total_duration != null ? Number(data.total_duration) : null,
        submissionId: data.submission_id != null ? data.submission_id : null,
      },
    };
  } catch (error) {
    OmniBox.log("warn", `PanCheck 链接检测失败: ${error.message}`);
    return { invalidLinksSet: new Set(), stats: null };
  }
}

async function getVideoDriveTypes(videoId) {
  try {
    const detailPath = buildDetailPath(videoId);
    const { response } = await getDetailPageCached(detailPath);
    if (!response || response.statusCode !== 200 || !response.body) return [];
    const $ = cheerio.load(response.body);
    const driveTypes = new Set();
    for (const url of extractPanUrls($)) {
      const t = inferDriveTypeFromShareURL(url);
      if (t) driveTypes.add(t);
    }
    return [...driveTypes];
  } catch (error) {
    OmniBox.log("warn", `获取视频网盘类型失败: ${videoId}, ${error.message}`);
    return [];
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function parsePanGroupVodId(vodId = "") {
  const raw = String(vodId || "").trim();
  if (!raw.includes("|")) return null;
  const idx = raw.indexOf("|");
  const driveType = raw.slice(0, idx).trim();
  const keyword = raw.slice(idx + 1).trim();
  if (!driveType || !keyword) return null;
  return { driveType, keyword };
}

async function getMovieDriveGroups(videoId) {
  const cacheKey = buildCacheKey("woniu4k:movieGroups", videoId);
  const cached = await getCachedJSON(cacheKey);
  if (cached && Array.isArray(cached.list)) {
    OmniBox.log("info", `命中影片分组缓存: ${videoId}`);
    return cached;
  }

  await ensureLogin();

  const detailPath = buildDetailPath(videoId);
  const detailPage = await getDetailPageCached(detailPath);
  const { response, baseUrl } = detailPage;
  if (response.statusCode !== 200 || !response.body) {
    return { list: [], page: 1, pagecount: 0, total: 0 };
  }

  const $ = cheerio.load(response.body);
  const { vodName, vodPic } = parseVodBaseInfo($, baseUrl);
  const panUrls = extractPanUrls($).map(normalizeShareUrl).filter(Boolean);
  const groups = buildMovieDriveGroups(videoId, vodName, vodPic, panUrls);

  const result = { list: groups, page: 1, pagecount: 1, total: groups.length };
  if (groups.length > 0) {
    OmniBox.log("info", `蜗牛4K 影片 ${videoId} 分组数量=${groups.length}`);
    await setCachedJSON(cacheKey, result, 3600);
  } else {
    OmniBox.log("warn", `蜗牛4K 影片 ${videoId} 未解析到网盘链接, 不缓存`);
  }
  return result;
}

function wrapMovieAsGroupItem(movie) {
  const vid = normalizeVideoId(movie.vod_id || movie.vod_name || "");
  if (!vid) return movie;
  return {
    vod_id: `mvg:${vid}`,
    vod_name: movie.vod_name || "",
    vod_pic: movie.vod_pic || "",
    vod_remarks: movie.vod_remarks || "",
    type_id: "pan_category",
    type_name: "网盘",
    vod_tag: "folder",
    panType: "mvg",
  };
}

function buildMovieDriveGroups(videoId, vodName, vodPic, panUrls) {
  const byType = {};
  let unknown = 0;
  for (const url of (panUrls || [])) {
    const t = inferDriveTypeFromShareURL(url);
    if (t) byType[t] = (byType[t] || 0) + 1;
    else unknown += 1;
  }
  const items = [];
  for (const [driveType, count] of Object.entries(byType)) {
    const panName = PAN_NAMES[driveType] || driveType;
    items.push({
      vod_id: `mv:${driveType}:${videoId}`,
      vod_name: panName,
      vod_pic: vodPic || "",
      type_id: "pan_category",
      type_name: "网盘分类",
      vod_remarks: `${count}条`,
      vod_tag: "folder",
      panType: driveType,
    });
  }
  if (unknown > 0) {
    items.push({
      vod_id: `mv:other:${videoId}`,
      vod_name: "其他网盘",
      vod_pic: vodPic || "",
      type_id: "pan_category",
      type_name: "网盘分类",
      vod_remarks: `${unknown}条`,
      vod_tag: "folder",
      panType: "other",
    });
  }
  if (items.length > 1) items.sort((a, b) => a.vod_name.localeCompare(b.vod_name, "zh-CN"));
  return items;
}

async function searchLinksByDriveForMovie(videoId, driveType) {
  const cacheKey = buildCacheKey("woniu4k:searchDrive", `mv:${driveType}:${videoId}`);
  const cached = await getCachedJSON(cacheKey);
  if (cached && Array.isArray(cached.list) && cached.list.length > 0) {
    OmniBox.log("info", `命中影片分组链接缓存: ${driveType}:${videoId}`);
    return cached;
  }

  await ensureLogin();

  const detailPath = buildDetailPath(videoId);
  const detailPage = await getDetailPageCached(detailPath);
  const { response, baseUrl } = detailPage;
  if (response.statusCode !== 200 || !response.body) {
    return { list: [], page: 1, pagecount: 0, total: 0 };
  }

  const $ = cheerio.load(response.body);
  const { vodName, vodPic } = parseVodBaseInfo($, baseUrl);
  const panName = PAN_NAMES[driveType] || "其他网盘";
  const linkItems = [];
  let index = 0;
  const seen = new Set();
  const noTypeFilter = !driveType || driveType === "other" || driveType === "all";
  for (const url of extractPanUrls($).map(normalizeShareUrl).filter(Boolean)) {
    if (!noTypeFilter && inferDriveTypeFromShareURL(url) !== driveType) continue;
    const shareURL = normalizeShareUrl(url);
    if (!shareURL || seen.has(shareURL)) continue;
    seen.add(shareURL);
    index += 1;
    const movieTitle = String(vodName || "").trim();
    linkItems.push({
      vod_id: movieTitle ? `${shareURL}|${movieTitle}` : shareURL,
      vod_name: `${panName} ${index}`,
      vod_pic: vodPic || "",
      type_id: driveType,
      type_name: panName,
      vod_remarks: vodName || panName,
      panUrl: shareURL,
    });
  }

  const result = { list: linkItems, page: 1, pagecount: 1, total: linkItems.length };
  if (linkItems.length > 0 && PANCHECK_API) {
    const { invalidLinksSet, stats } = await checkLinksWithPanCheck(linkItems.map((item) => item.panUrl));
    const before = linkItems.length;
    const validItems = linkItems.filter((item) => !invalidLinksSet.has(item.panUrl));
    const durStr = stats && stats.duration != null
      ? (stats.duration >= 1000 ? (stats.duration / 1000).toFixed(1) + "s" : stats.duration + "ms")
      : "-";
    OmniBox.log("info", `==== PanCheck 检测: 提交${stats ? stats.submitted : "-"}, 有效${stats ? stats.valid : "-"}, 失效${stats ? stats.invalid : "-"}, 待定${stats ? stats.pending : "-"}, 耗时${durStr}, id=${stats ? stats.submissionId : "-"} | 过滤: ${before}→${validItems.length} ====`);
    linkItems.length = 0;
    linkItems.push(...validItems);
    result.list = validItems;
    result.total = validItems.length;
  }

  if (result.list.length > 0) {
    OmniBox.log("info", `蜗牛4K 影片 ${driveType}:${videoId} 链接数量=${result.list.length}`);
    await setCachedJSON(cacheKey, result, 3600);
  } else {
    OmniBox.log("warn", `蜗牛4K 影片 ${driveType}:${videoId} 无有效链接, 不缓存`);
  }
  return result;
}

async function searchVideosByDrive(keyword, page, driveType) {
  const cacheKey = buildCacheKey("woniu4k:searchDrive", `v7:${driveType}:${keyword}:${page}`);
  const cached = await getCachedJSON(cacheKey);
  if (cached && Array.isArray(cached.list) && cached.list.length > 0) {
    OmniBox.log("info", `命中网盘分组结果缓存: ${driveType}:${keyword}:${page}`);
    return cached;
  }

  // 抓详情判断网盘类型前确保已登录(否则详情页是锁定版, 无网盘链接)
  await ensureLogin();

  const searchPath = buildSearchPath(keyword, page);
  const { response, baseUrl } = await requestWithFailover(searchPath);
  if (response.statusCode !== 200 || !response.body) {
    return { list: [], page: page, pagecount: 0, total: 0 };
  }

  const videos = parseListFromHtml(response.body, baseUrl);
  const panName = PAN_NAMES[driveType] || driveType;
  const linkItems = [];

  const results = await mapWithConcurrency(videos, 3, async (video) => {
    try {
      const detailPath = buildDetailPath(video.vod_id);
      const { response: detailResponse } = await getDetailPageCached(detailPath);
      if (!detailResponse || detailResponse.statusCode !== 200 || !detailResponse.body) return [];
      const $ = cheerio.load(detailResponse.body);
      return extractPanItems($).filter((item) => inferDriveTypeFromShareURL(item.url) === driveType);
    } catch (error) {
      OmniBox.log("warn", `获取视频 ${video.vod_id} 的网盘链接失败: ${error.message}`);
      return [];
    }
  });

  let globalIndex = 0;
  results.forEach((matched, vi) => {
    const video = videos[vi];
    matched.forEach((item) => {
      const shareURL = normalizeShareUrl(item.url);
      if (!shareURL) return;
      globalIndex += 1;
      const movieTitle = String(video.vod_name || "").trim();
      linkItems.push({
        vod_id: movieTitle ? `${shareURL}|${movieTitle}` : shareURL,
        vod_name: item.name || `${panName} ${globalIndex}`,
        vod_pic: video.vod_pic || "",
        type_id: driveType,
        type_name: panName,
        vod_remarks: video.vod_name || panName,
        panUrl: shareURL,
      });
    });
  });

  const result = { list: linkItems, page: page, pagecount: 1, total: linkItems.length };
  if (linkItems.length > 0) {
    // PanCheck 检测链接有效性, 失效的直接丢弃
    if (PANCHECK_API) {
      const { invalidLinksSet, stats } = await checkLinksWithPanCheck(linkItems.map((item) => item.panUrl));
      const before = linkItems.length;
      const validItems = linkItems.filter((item) => !invalidLinksSet.has(item.panUrl));
      const durStr = stats && stats.duration != null
        ? (stats.duration >= 1000 ? (stats.duration / 1000).toFixed(1) + "s" : stats.duration + "ms")
        : "-";
      OmniBox.log("info", `==== PanCheck 检测: 提交${stats ? stats.submitted : "-"}, 有效${stats ? stats.valid : "-"}, 失效${stats ? stats.invalid : "-"}, 待定${stats ? stats.pending : "-"}, 耗时${durStr}, id=${stats ? stats.submissionId : "-"} | 过滤: ${before}→${validItems.length} ====`);
      linkItems.length = 0;
      linkItems.push(...validItems);
      result.list = validItems;
      result.total = validItems.length;
    }
  }
  if (result.list.length > 0) {
    OmniBox.log("info", `蜗牛4K 网盘分组 ${driveType}:${keyword} 链接数量=${result.list.length}`);
    await setCachedJSON(cacheKey, result, 3600);
  } else {
    OmniBox.log("warn", `蜗牛4K 网盘分组 ${driveType}:${keyword} 无链接结果, 不缓存(下次点击会重新尝试)`);
  }
  return result;
}

async function buildDriveGroupedSearch(keyword, videos) {
  const grouped = {};
  const items = [];

  const results = await mapWithConcurrency(videos, 3, async (video) => {
    const drives = await getVideoDriveTypes(video.vod_id);
    return { video, drives };
  });

  for (const { video, drives } of results) {
    for (const driveType of drives) {
      if (!grouped[driveType]) grouped[driveType] = [];
      grouped[driveType].push(video);
    }
  }

  for (const [driveType, list] of Object.entries(grouped)) {
    items.push({
      vod_id: `${driveType}|${keyword}`,
      vod_name: PAN_NAMES[driveType] || driveType,
      vod_pic: "",
      type_id: "pan_category",
      type_name: "网盘分类",
      vod_remarks: `${list.length}部`,
      vod_tag: "folder",
      panType: driveType,
    });
  }

  items.sort((a, b) => {
    const ta = a.panType === "aliyun" ? "ali" : a.panType;
    const tb = b.panType === "aliyun" ? "ali" : b.panType;
    const ia = DRIVE_ORDER.indexOf(ta);
    const ib = DRIVE_ORDER.indexOf(tb);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  return items;
}
// ==================== 网盘分组结束 ====================

/**
 * 搜索视频
 */
async function search(params) {
  try {
    const keyword = params.keyword || params.wd || params.key || "";
    const page = parseInt(params.page || "1", 10);
    OmniBox.log("info", `蜗牛4K 搜索视频: keyword=${keyword}, page=${page}`);

    if (!keyword) {
      OmniBox.log("warn", "搜索关键词为空");
      return {
        list: [],
        page: 1,
        pagecount: 0,
        total: 0,
      };
    }

    // 支持直接搜索网盘链接
    if (/^https?:\/\//i.test(String(keyword)) && isPanShareUrl(keyword)) {
      return {
        list: [{
          vod_id: normalizeShareUrl(keyword),
          vod_name: "网盘推送",
          vod_pic: "",
          type_id: "",
          type_name: "",
          vod_remarks: "网盘推送",
        }],
        page: page,
        pagecount: 1,
        total: 1,
      };
    }

    const searchPath = buildSearchPath(keyword, page);
    const { response, baseUrl } = await requestWithFailover(searchPath);

    if (response.statusCode !== 200 || !response.body) {
      OmniBox.log("error", `请求失败: HTTP ${response.statusCode}`);
      return {
        list: [],
        page: page,
        pagecount: 0,
        total: 0,
      };
    }

    const videos = parseListFromHtml(response.body, baseUrl);
    const pagecount = parsePageCount(response.body, page);

    OmniBox.log("info", `蜗牛4K 搜索完成,找到 ${videos.length} 个结果`);

    // 按网盘分组: 先返回网盘分类列表, 点击分类后再返回该网盘下的视频
    if (videos.length > 0) {
      try {
        await ensureLogin();
        const groupCacheKey = buildCacheKey("woniu4k:searchGroup", keyword);
        let groupedList = await getCachedJSON(groupCacheKey);
        if (!groupedList) {
          groupedList = await buildDriveGroupedSearch(keyword, videos);
          if (groupedList.length > 0) {
            await setCachedJSON(groupCacheKey, groupedList, 3600);
          }
        }
        if (groupedList && groupedList.length > 0) {
          OmniBox.log("info", `蜗牛4K 搜索按网盘分组完成,分类数量=${groupedList.length}`);
          return {
            list: groupedList,
            page: page,
            pagecount: 1,
            total: groupedList.length,
          };
        }
      } catch (error) {
        OmniBox.log("warn", `蜗牛4K 搜索分组失败,回退原始列表: ${error.message}`);
      }
    }

    return {
      list: (videos || []).map(wrapMovieAsGroupItem),
      page: page,
      pagecount: pagecount,
      total: videos.length,
    };
  } catch (error) {
    OmniBox.log("error", `蜗牛4K 搜索视频失败: ${error.message}`);
    return {
      list: [],
      page: params.page || 1,
      pagecount: 0,
      total: 0,
    };
  }
}

async function play(params, context) {
  try {
    const flag = params.flag || "";
    const playId = params.playId || "";
    const source = resolveCallerSource(params, context);

    OmniBox.log("info", `获取播放地址: flag=${flag}, playId=${playId}`);

    if (!playId) {
      throw new Error("播放参数不能为空");
    }

    const idParts = playId.split("|");
    if (idParts.length < 2) {
      throw new Error("播放参数格式错误,应为:分享链接|文件ID");
    }

    let playMeta = {};
    let coreParts = [...idParts];
    if (coreParts.length >= 3) {
      const possibleMeta = coreParts[coreParts.length - 1] || "";
      try {
        playMeta = decodePlayMeta(possibleMeta);
        if (playMeta && typeof playMeta === "object" && (playMeta.v || playMeta.e || playMeta.fid || playMeta.sid || playMeta.t)) {
          coreParts = coreParts.slice(0, -1);
        } else {
          playMeta = {};
        }
      } catch (_) {
        playMeta = {};
      }
    }

    const shareURL = coreParts[0] || "";
    const fileId = coreParts[1] || "";
    const videoId = playMeta.sid || coreParts[2] || "";

    if (!shareURL || !fileId) {
      throw new Error("分享链接或文件ID不能为空");
    }

    OmniBox.log("info", `解析参数: shareURL=${shareURL}, fileId=${fileId}`);

    const routeType = resolveRouteType(flag, source, context);
    OmniBox.log("info", `使用线路: ${routeType}`);

    // 并行: 主链路(播放地址) + 辅链路(刮削元数据/弹幕)
    const playInfoPromise = OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);
    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
        scrapeTitle: "",
        scrapePic: "",
        episodeNumber: null,
        episodeName: params.episodeName || playMeta.e || "",
      };

      if (!videoId) return result;

      try {
        const metadata = await OmniBox.getScrapeMetadata(videoId);
        if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) {
          OmniBox.log("info", `蜗牛4K play 弹幕匹配跳过: metadata 不完整, videoId=${videoId}`);
          return result;
        }

        OmniBox.log("info", `蜗牛4K play 弹幕元数据读取成功: videoId=${videoId}, mappings=${metadata.videoMappings.length}, scrapeType=${metadata.scrapeType || "unknown"}`);

        const formattedFileId = `${shareURL}|${fileId}|${videoId}`;
        OmniBox.log("info", `蜗牛4K play 弹幕匹配 formattedFileId=${formattedFileId}`);
        const matchedMapping = metadata.videoMappings.find((mapping) => mapping && mapping.fileId === formattedFileId);
        if (!matchedMapping) {
          OmniBox.log("info", `蜗牛4K play 弹幕匹配未命中 mapping: formattedFileId=${formattedFileId}`);
          return result;
        }

        const scrapeData = metadata.scrapeData;
        result.scrapeTitle = scrapeData.title || "";
        if (scrapeData.posterPath) {
          result.scrapePic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
        }

        if (matchedMapping.episodeNumber) {
          result.episodeNumber = matchedMapping.episodeNumber;
        }
        if (matchedMapping.episodeName && !result.episodeName) {
          result.episodeName = matchedMapping.episodeName;
        }

        let fileName = "";
        const scrapeType = metadata.scrapeType || "";
        if (scrapeType === "movie") {
          fileName = scrapeData.title || "";
        } else {
          const title = scrapeData.title || "";
          const seasonAirYear = scrapeData.seasonAirYear || "";
          const seasonNumber = matchedMapping.seasonNumber || 1;
          const episodeNum = matchedMapping.episodeNumber || 1;
          fileName = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
        }

        if (fileName) {
          OmniBox.log("info", `蜗牛4K play 生成fileName用于弹幕匹配: ${fileName}`);
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
          const count = Array.isArray(matchedDanmaku) ? matchedDanmaku.length : 0;
          OmniBox.log("info", `蜗牛4K play 弹幕匹配结果: fileName=${fileName}, count=${count}`);
          if (count > 0) {
            result.danmakuList = matchedDanmaku;
            OmniBox.log("info", `蜗牛4K play 弹幕匹配成功,找到 ${count} 条弹幕`);
          }
        } else {
          OmniBox.log("info", `蜗牛4K play 弹幕匹配跳过: fileName 为空, formattedFileId=${formattedFileId}`);
        }
      } catch (error) {
        OmniBox.log("warn", `蜗牛4K play 弹幕匹配失败: ${error.message}`);
      }

      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);

    if (playInfoResult.status !== "fulfilled") {
      throw new Error(playInfoResult.reason && playInfoResult.reason.message ? playInfoResult.reason.message : "无法获取播放地址");
    }

    const playInfo = playInfoResult.value;
    if (!playInfo || !playInfo.url || !Array.isArray(playInfo.url) || playInfo.url.length === 0) {
      throw new Error("无法获取播放地址");
    }

    let danmakuList = [];
    let scrapeTitle = "";
    let scrapePic = "";
    let episodeNumber = null;
    let episodeName = params.episodeName || "";

    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
      scrapeTitle = metadataResult.value.scrapeTitle || "";
      scrapePic = metadataResult.value.scrapePic || "";
      episodeNumber = metadataResult.value.episodeNumber || null;
      episodeName = metadataResult.value.episodeName || episodeName;
    } else if (metadataResult.status === "rejected") {
      OmniBox.log("warn", `获取元数据失败(不影响播放): ${metadataResult.reason && metadataResult.reason.message ? metadataResult.reason.message : metadataResult.reason}`);
    }

    try {
      const sourceId = context.sourceId;
      if (sourceId) {
        const title = params.title || scrapeTitle || shareURL;
        const pic = params.pic || scrapePic || "";

        OmniBox.addPlayHistory({
          vodId: videoId,
          title: title,
          pic: pic,
          episode: playId,
          sourceId: sourceId,
          episodeNumber: episodeNumber,
          episodeName: episodeName,
        })
          .then((added) => {
            if (added) {
              OmniBox.log("info", `已添加观看记录: ${title}`);
            } else {
              OmniBox.log("info", `观看记录已存在,跳过添加: ${title}`);
            }
          })
          .catch((error) => {
            OmniBox.log("warn", `添加观看记录失败: ${error.message}`);
          });
      }
    } catch (error) {
      OmniBox.log("warn", `添加观看记录失败: ${error.message}`);
    }

    const urlList = playInfo.url || [];
    const urlsResult = [];
    for (const item of urlList) {
      urlsResult.push({
        name: item.name || "播放",
        url: item.url,
      });
    }

    let header = playInfo.header || {};
    const shareURLLower = String(shareURL || "").toLowerCase();
    const isUcDrive = shareURLLower.includes("drive.uc.cn") || shareURLLower.includes("pc-api.uc.cn") || shareURLLower.includes("uc.cn/s/");
    if (isUcDrive && routeType == "直连") {
      header = {};
      OmniBox.log("info", "蜗牛4K play 命中 UC 直连特判，返回空 header");
    }
    const finalDanmakuList = danmakuList && danmakuList.length > 0 ? danmakuList : playInfo.danmaku || [];

    OmniBox.log("info", `实际播放地址: ${JSON.stringify(urlsResult)}`);

    return {
      urls: urlsResult,
      header: header,
      parse: 0,
      danmaku: finalDanmakuList};
  } catch (error) {
    OmniBox.log("error", `播放接口失败: ${error.message}`);
    return {
      urls: [],
      header: {},
      danmaku: []};
  }
}

async function getDynamicFilters() {
  // 蜗牛 mxone 模板默认筛选较简，空配置时走自动抓取
  return {};
}

// ==================== 登录功能 ====================

async function ensureLogin() {
  if (hasAuthCookies()) {
    return true;
  }
  if (LOGIN_USERNAME && LOGIN_PASSWORD) {
    const result = await login({ autoCaptcha: true, maxAttempts: 2 });
    return result && result.code === 1;
  }
  return false;
}

async function login(params) {
  const username = String(params?.username || LOGIN_USERNAME || "").trim();
  const password = String(params?.password || LOGIN_PASSWORD || "").trim();
  const captchaCode = String(params?.captcha || params?.verify || "").trim();
  const autoCaptcha = params?.autoCaptcha !== false;
  const maxAttempts = Math.max(1, parseInt(params?.maxAttempts || "3", 10) || 3);

  if (!username || !password) {
    OmniBox.log("warn", "蜗牛4K 登录失败: 用户名或密码为空，请设置 WONIU4K_USERNAME / WONIU4K_PASSWORD");
    return { code: -1, msg: "用户名或密码未配置" };
  }

  OmniBox.log("info", "蜗牛4K 开始登录");

  let verifyUrl = "";
  let lastResult = { code: -1, msg: "登录未执行" };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // 获取登录页，建立 session、获取验证码
      const loginPage = await httpRequest(WEB_SITES[0] + "/user/login/", { timeout: 15000 });
      const $ = cheerio.load(loginPage.body || "");

      const verifySrc = $("#verify_img").attr("src") || $("#verify-img").attr("src") || "";
      verifyUrl = verifySrc ? absUrl(verifySrc, WEB_SITES[0]) : "";
      const hasVerify = verifyUrl.length > 0;

      // 优先用外部传入的验证码，否则自动识别
      let code = captchaCode;
      if (hasVerify && !code && autoCaptcha) {
        code = await solveCaptchaByUrl(verifyUrl);
        if (!code) {
          OmniBox.log("warn", `蜗牛4K 验证码识别失败(第${attempt}次), 换一张重试`);
          await sleep(800);
          continue;
        }
      }

      if (hasVerify && !code) {
        OmniBox.log("info", "蜗牛4K 登录需要验证码, 请通过 captcha 参数提供验证码");
        return {
          code: -2,
          msg: "需要验证码",
          verifyUrl,
          verifyImg: verifyUrl,
        };
      }

      // 构造 POST 数据
      const formData = new URLSearchParams();
      formData.append("user_name", username);
      formData.append("user_pwd", password);
      if (code) {
        formData.append("verify", code);
      }

      const loginResult = await httpRequest(WEB_SITES[0] + "/user/login.html", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Referer: WEB_SITES[0] + "/user/login/",
        },
        body: formData.toString(),
        timeout: 15000,
      });

      let result;
      try {
        result = JSON.parse(loginResult.body || "{}");
      } catch {
        result = { code: 0, msg: "登录响应解析失败" };
      }

      lastResult = result;

      if (result.code === 1) {
        OmniBox.log("info", "蜗牛4K 登录成功");
        return result;
      }

      const msg = String(result.msg || "");
      const needRetry = hasVerify && /验证码|verify/i.test(msg) && autoCaptcha;
      if (needRetry && attempt < maxAttempts) {
        OmniBox.log("warn", `蜗牛4K 验证码错误(第${attempt}次): ${msg}, 换一张重试`);
        await sleep(800);
        continue;
      }

      OmniBox.log("warn", `蜗牛4K 登录失败: ${msg || "未知错误"}`);
      return result;
    } catch (error) {
      lastResult = { code: -1, msg: error.message };
      OmniBox.log("error", `蜗牛4K 登录异常(第${attempt}次): ${error.message}`);
      if (attempt < maxAttempts) {
        await sleep(1000);
        continue;
      }
      return lastResult;
    }
  }

  return lastResult;
}

async function logout() {
  OmniBox.log("info", "蜗牛4K 退出登录");
  try {
    await httpRequest(WEB_SITES[0] + "/user/logout.html", { timeout: 10000 });
    clearCookies();
    OmniBox.log("info", "蜗牛4K 已退出登录并清除 Cookie");
    return { code: 1, msg: "已退出" };
  } catch (error) {
    OmniBox.log("warn", `蜗牛4K 退出登录失败: ${error.message}`);
    clearCookies();
    return { code: -1, msg: error.message };
  }
}

async function getLoginStatus() {
  try {
    const res = await httpRequest(WEB_SITES[0] + "/user/index.html", { timeout: 10000 });
    const $ = cheerio.load(res.body || "");
    const loggedIn = res.body.includes("退出登录") || $(".user-name, .user-info-name, .header-user-name").length > 0;
    if (loggedIn) {
      const username = $(".user-name, .user-info-name, .header-user-name").first().text().trim() || "已登录";
      return { loggedIn: true, username };
    }
    return { loggedIn: false, username: "" };
  } catch {
    return { loggedIn: false, username: "" };
  }
}

// ==================== 登录功能结束 ====================

module.exports = {
  home,
  category,
  search,
  detail,
  play,
  login,
  logout,
  getLoginStatus,
  setCookies: setCookiesFromString,
};

const runner = require("spider_runner");
runner.run(module.exports);
