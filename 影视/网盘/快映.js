// @name 快映
// @author 
// @description 刮削：支持，弹幕：支持，播放记录：支持
// @dependencies: axios, cheerio
// @version 1.0.10
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/快映.js

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
const WEB_SITE_CONFIG = process.env.WEB_SITE_XIAOBAN || "http://38.76.197.172:12521;http://154.201.83.50:12512;http://xsayang.fun:12512";
const WEB_SITES = splitConfigList(WEB_SITE_CONFIG);
// 读取环境变量:支持多个网盘类型,用逗号/分号分割
const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "quark;uc");
// 读取环境变量:线路名称和顺序,用逗号/分号分割
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");
// 是否开启外网服务器代理（默认关闭）
const EXTERNAL_SERVER_PROXY_ENABLED = String(process.env.EXTERNAL_SERVER_PROXY_ENABLED || "false").toLowerCase() === "true";
// 读取环境变量:详情页播放线路的网盘排序顺序。仅作用于 detail() 里的播放线路，不作用于搜索结果。
const DRIVE_ORDER = splitConfigList(process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").map(s => s.toLowerCase());
// 详情链路缓存时间（秒），默认 12 小时
const MUOU_CACHE_EX_SECONDS = Number(process.env.MUOU_CACHE_EX_SECONDS || 43200);
const MUOU_VERBOSE_DETAIL = String(process.env.MUOU_VERBOSE_DETAIL || "0") === "1";
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
});

async function httpRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  const response = await axios({
    url,
    method,
    headers: options.headers || {},
    data: options.body,
    timeout: options.timeout,
    httpsAgent: INSECURE_HTTPS_AGENT,
    validateStatus: () => true,
  });

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
  if (MUOU_VERBOSE_DETAIL) {
    OmniBox.log("info", message);
  }
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
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...(options.headers || {}),
        },
        timeout: options.timeout ?? perDomainTimeout,
      });

      if (response.statusCode === 200 && response.body) {
        if (isBlockedHtml(response.body)) {
          OmniBox.log("warn", `域名 ${baseUrl} 命中风控页,切换下一个域名`);
          lastError = new Error("命中风控页面");
          continue;
        }
        OmniBox.log("info", `域名 ${baseUrl} 请求成功`);
        return { response, baseUrl };
      } else {
        OmniBox.log("warn", `域名 ${baseUrl} 返回非200状态码: ${response.statusCode}`);
        lastError = new Error(`HTTP ${response.statusCode}`);
      }
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
  for (const key of Object.keys(FILTER_KEY_NAME_MAP)) {
    if (href.includes(`${key}/`)) {
      return key;
    }
  }
  if (href.includes("id/")) {
    return "id";
  }
  return null;
}

function extractFilterValueFromHref(href = "", key = "") {
  if (!href || !key) return "";
  const marker = `${key}/`;
  const idx = href.indexOf(marker);
  if (idx < 0) return "";
  const rest = href.substring(idx + marker.length);
  return decodeURIComponent((rest.split('/')[0] || "").split('.')[0] || "");
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
    const path = `/index.php/vod/show/id/${categoryId}.html`;
    const { response } = await requestWithFailover(path);
    if (response.statusCode !== 200 || !response.body) {
      return [];
    }
    return parseFiltersFromHtml(response.body);
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
  const videoExtensions = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];

  for (const ext of videoExtensions) {
    if (fileName.endsWith(ext)) {
      return true;
    }
  }

  if (file.format_type) {
    const formatType = String(file.format_type).toLowerCase();
    if (formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264")) {
      return true;
    }
  }

  return false;
}

async function getAllVideoFiles(shareURL, files, errors = []) {
  if (!files || !Array.isArray(files)) {
    return [];
  }

  const tasks = files.map(async (file) => {
    if (file.file && isVideoFile(file)) {
      return [file];
    } else if (file.dir) {
      const startTime = performance.now();

      try {
        const subFileList = await OmniBox.getDriveFileList(shareURL, file.fid);
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        OmniBox.log("info", `获取目录 [${file.name || file.fid}] 耗时: ${duration}ms`);

        if (subFileList?.files && Array.isArray(subFileList.files)) {
          return await getAllVideoFiles(shareURL, subFileList.files, errors);
        }
        return [];
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
        return [];
      }
    }
    return [];
  });

  const results = await Promise.all(tasks);
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
    OmniBox.log("info", "获取首页数据");

    let classes = [];
    let list = [];

    try {
      const { response, baseUrl } = await requestWithFailover('/');

      if (response.statusCode === 200 && response.body) {
        const $ = cheerio.load(response.body);

        const tabItems = $(".module-tab-items .module-tab-item");
        tabItems.each((_, element) => {
          const $item = $(element);
          const typeId = $item.attr("data-id");
          const typeName = $item.attr("data-name");

          if (typeId && typeId !== "0" && typeName) {
            classes.push({
              type_id: typeId,
              type_name: typeName.trim(),
            });
          }
        });

        OmniBox.log("info", `从首页导航提取到 ${classes.length} 个分类`);

        const firstModule = $(".module");

        if (firstModule.length > 0) {
          const moduleItems = firstModule.find(".module-item");

          moduleItems.each((_, element) => {
            const $item = $(element);
            const href = $item.find(".module-item-pic a").attr("href") || $item.find(".module-item-title").attr("href");
            const vodName = $item.find(".module-item-pic img").attr("alt") || $item.find(".module-item-title").attr("title") || $item.find(".module-item-title").text().trim();

            let vodPic = $item.find(".module-item-pic img").attr("data-src") || $item.find(".module-item-pic img").attr("src");
            if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
              vodPic = baseUrl + vodPic;
            }

            const vodRemarks = $item.find(".module-item-text").text().trim();
            const vodYear = $item.find(".module-item-caption span").first().text().trim();

            if (href && vodName) {
              list.push({
                vod_id: href,
                vod_name: vodName,
                vod_pic: vodPic || "",
                type_id: "",
                type_name: "",
                vod_remarks: vodRemarks || "",
                vod_year: vodYear || "",
              });
            }
          });

          OmniBox.log("info", `从首页提取到 ${list.length} 个影片`);
        }
      }
    } catch (error) {
      OmniBox.log("warn", `从首页提取数据失败: ${error.message}`);
    }

    const currentFilters = await getPreferredFilters(classes);
    return {
      class: classes,
      list: list,
      filters: currentFilters,
    };
  } catch (error) {
    OmniBox.log("error", `获取首页数据失败: ${error.message}`);
  }
}

async function category(params) {
  try {
    const categoryId = params.categoryId || params.type_id || "";
    const page = parseInt(params.page || "1", 10);
    const filters = params.filters || {};

    OmniBox.log("info", `获取分类数据: categoryId=${categoryId}, page=${page}`);

    if (!categoryId) {
      OmniBox.log("warn", "分类ID为空");
      return {
        list: [],
        page: 1,
        pagecount: 0,
        total: 0,
      };
    }

    let url = '/index.php/vod/show';
    if (filters.area) {
      url += `/area/${filters.area}`;
    }
    const sortValue = filters.sort || filters.by;
    if (sortValue) {
      url += `/by/${sortValue}`;
    }
    if (filters.class) {
      url += `/class/${filters.class}`;
    }
    if (filters.lang) {
      url += `/lang/${filters.lang}`;
    }
    if (filters.letter) {
      url += `/letter/${filters.letter}`;
    }
    if (filters.year) {
      url += `/year/${filters.year}`;
    }
    const tidValue = filters.tid || filters.id;
    if (tidValue) {
      url += `/id/${tidValue}.html`;
    } else {
      url += `/id/${categoryId}/page/${page}.html`;
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

    const $ = cheerio.load(response.body);
    const videos = [];

    const vodItems = $("#main .module-item");
    vodItems.each((_, e) => {
      const $item = $(e);
      const href = $item.find(".module-item-pic a").attr("href");
      const vodName = $item.find(".module-item-pic img").attr("alt");
      let vodPic = $item.find(".module-item-pic img").attr("data-src");
      if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
        vodPic = baseUrl + vodPic;
      }
      const vodRemarks = $item.find(".module-item-text").text();
      const vodYear = $item.find(".module-item-caption span").first().text();

      if (href && vodName) {
        videos.push({
          vod_id: href,
          vod_name: vodName,
          vod_pic: vodPic || "",
          type_id: categoryId,
          type_name: "",
          vod_remarks: vodRemarks || "",
          vod_year: vodYear || "",
        });
      }
    });

    OmniBox.log("info", `解析完成,找到 ${videos.length} 个视频`);

    const autoFilters = parseFiltersFromHtml(response.body);
    let categoryFilters = autoFilters;

    if (categoryFilters.length === 0) {
      const preferredFilters = await getPreferredFilters([{ type_id: categoryId, type_name: "" }]);
      categoryFilters = preferredFilters[categoryId] || [];
    }

    const result = {
      list: videos,
      page: page,
      pagecount: 0,
      total: videos.length,
    };

    if (page === 1 && categoryFilters.length > 0) {
      result.filters = categoryFilters;
    }

    return result;
  } catch (error) {
    OmniBox.log("error", `获取分类数据失败: ${error.message}`);
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
  const detailCacheKey = buildCacheKey("muou:detailHtml", videoId);
  let detailPage = await getCachedJSON(detailCacheKey);
  if (!detailPage) {
    detailPage = await requestWithFailover(videoId);
    if (detailPage && detailPage.response && detailPage.response.statusCode === 200 && detailPage.response.body) {
      await setCachedJSON(detailCacheKey, detailPage, MUOU_CACHE_EX_SECONDS);
    }
  } else {
    logDetailDebug(`命中详情页缓存: ${videoId}`);
  }
  return detailPage;
}

async function getDriveInfoCached(shareURL) {
  const cacheKey = buildCacheKey("muou:driveInfo", shareURL);
  let driveInfo = await getCachedJSON(cacheKey);
  if (!driveInfo) {
    driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
    await setCachedJSON(cacheKey, driveInfo, MUOU_CACHE_EX_SECONDS);
  }
  return driveInfo;
}

async function getRootFileListCached(shareURL) {
  const cacheKey = buildCacheKey("muou:rootFiles", shareURL);
  let fileList = await getCachedJSON(cacheKey);
  if (!fileList) {
    fileList = await OmniBox.getDriveFileList(shareURL, "0");
    if (fileList && fileList.files && Array.isArray(fileList.files)) {
      await setCachedJSON(cacheKey, fileList, MUOU_CACHE_EX_SECONDS);
    }
  } else {
    logDetailDebug(`命中根目录文件列表缓存: ${shareURL}`);
  }
  return fileList;
}

async function getAllVideoFilesCached(shareURL, rootFiles) {
  const cacheKey = buildCacheKey("muou:videoFiles", shareURL);
  let allVideoFiles = await getCachedJSON(cacheKey);
  if (!Array.isArray(allVideoFiles) || allVideoFiles.length === 0) {
    allVideoFiles = await getAllVideoFiles(shareURL, rootFiles, "0");
    if (Array.isArray(allVideoFiles) && allVideoFiles.length > 0) {
      await setCachedJSON(cacheKey, allVideoFiles, MUOU_CACHE_EX_SECONDS);
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
  const metadataCacheKey = buildCacheKey("muou:metadata", videoId);
  const metadataRefreshLockKey = buildCacheKey("muou:metadataRefreshLock", videoId);

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
    await setCachedJSON(metadataRefreshLockKey, { refreshing: true }, MUOU_CACHE_EX_SECONDS);

    try {
      logDetailDebug(`后台统一刷新元数据: ${videoId}`);
      await OmniBox.processScraping(videoId, vodName, vodName, mergedVideoFilesForScraping);
      const metadata = await OmniBox.getScrapeMetadata(videoId);
      await setCachedJSON(metadataCacheKey, {
        scrapeData: metadata?.scrapeData || null,
        videoMappings: metadata?.videoMappings || [],
        scrapeType: metadata?.scrapeType || "",
      }, MUOU_CACHE_EX_SECONDS);
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
      }, MUOU_CACHE_EX_SECONDS);
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
  let vodName = $(".page-title")[0]?.children?.[0]?.data || "";
  let vodPic = $($(".mobile-play")).find(".lazyload")[0]?.attribs?.["data-src"] || "";
  if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
    vodPic = baseUrl + vodPic;
  }

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
    }
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
  const items = $(".module-row-info");
  for (const item of items) {
    const shareUrl = $(item).find("p")[0]?.children?.[0]?.data;
    if (shareUrl) {
      panUrls.push(shareUrl.trim());
    }
  }
  return panUrls;
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
async function detail(params, context) {
  try {
    const videoId = params.videoId || "";

    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    const source = params.source || "";
    OmniBox.log("info", `获取视频详情: videoId=${videoId}, source=${source}`);

    const detailPage = await getDetailPageCached(videoId);
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

    const panUrls = extractPanUrls($);
    logDetailDebug(`解析完成,网盘链接数=${panUrls.length}`);

    let playSources = [];

    const driveTypeCountMap = await collectDriveTypeCountMap(panUrls);
    const driveTypeCurrentIndexMap = {};

    // ==================== 并行处理网盘链接（方案 A：先收集所有文件，再统一刮削一次） ====================
    const panUrlTasks = panUrls.map(async (shareURL) => {
      try {
        logDetailDebug(`处理网盘链接: ${shareURL}`);

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
          return null;
        }

        logDetailDebug(`从分享链接 ${shareURL} 获取文件列表成功,文件数量: ${fileList.files.length}`);

        const allVideoFiles = await getAllVideoFilesCached(shareURL, fileList.files);

        if (!allVideoFiles || allVideoFiles.length === 0) {
          OmniBox.log("warn", `未找到视频文件: ${shareURL}`);
          return null;
        }

        logDetailDebug(`递归获取视频文件完成,视频文件数量: ${allVideoFiles.length}`);

        return {
          shareURL,
          displayName,
          driveInfo,
          allVideoFiles,
        };
      } catch (error) {
        OmniBox.log("error", `处理网盘链接失败: ${shareURL}, 错误: ${error.message}`);
        return null;
      }
    });

    const panUrlResults = (await Promise.all(panUrlTasks)).filter(Boolean);
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

/**
 * 搜索视频
 */
async function search(params) {
  try {
    const keyword = params.keyword || "";
    const page = parseInt(params.page || "1", 10);

    OmniBox.log("info", `搜索视频: keyword=${keyword}, page=${page}`);

    if (!keyword) {
      OmniBox.log("warn", "搜索关键词为空");
      return {
        list: [],
        page: 1,
        pagecount: 0,
        total: 0,
      };
    }

    const searchPath = `/index.php/vod/search/page/${page}/wd/${keyword}.html`;
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

    const $ = cheerio.load(response.body);
    const videos = [];

    const items = $(".module-search-item");
    for (const item of items) {
      const $item = $(item);
      const videoSerial = $item.find(".video-serial")[0];
      const vodPicImg = $item.find(".module-item-pic > img")[0];

      if (videoSerial && videoSerial.attribs) {
        const vodId = videoSerial.attribs.href || "";
        const vodName = videoSerial.attribs.title || "";
        let vodPic = vodPicImg?.attribs?.["data-src"] || "";
        if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
          vodPic = baseUrl + vodPic;
        }
        const vodRemarks = $($item.find(".video-serial")[0]).text() || "";

        if (vodId && vodName) {
          videos.push({
            vod_id: vodId,
            vod_name: vodName,
            vod_pic: vodPic,
            type_id: "",
            type_name: "",
            vod_remarks: vodRemarks,
          });
        }
      }
    }

    OmniBox.log("info", `搜索完成,找到 ${videos.length} 个结果`);

    return {
      list: videos,
      page: page,
      pagecount: 0,
      total: videos.length,
    };
  } catch (error) {
    OmniBox.log("error", `搜索视频失败: ${error.message}`);
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
      };

      if (!videoId) return result;

      try {
        const metadata = await OmniBox.getScrapeMetadata(videoId);
        if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) {
          return result;
        }

        const formattedFileId = `${shareURL}|${fileId}|${videoId}`;
        const matchedMapping = metadata.videoMappings.find((mapping) => mapping && mapping.fileId === formattedFileId);
        if (!matchedMapping) {
          return result;
        }

        const scrapeData = metadata.scrapeData;

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
          OmniBox.log("info", `生成fileName用于弹幕匹配: ${fileName}`);
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
          if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) {
            result.danmakuList = matchedDanmaku;
            OmniBox.log("info", `弹幕匹配成功,找到 ${matchedDanmaku.length} 条弹幕`);
          }
        }
      } catch (error) {
        OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
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

    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
    } else if (metadataResult.status === "rejected") {
      OmniBox.log("warn", `获取元数据失败(不影响播放): ${metadataResult.reason && metadataResult.reason.message ? metadataResult.reason.message : metadataResult.reason}`);
    }

    const urlList = playInfo.url || [];
    const urlsResult = [];
    for (const item of urlList) {
      urlsResult.push({
        name: item.name || "播放",
        url: item.url,
      });
    }

    const header = playInfo.header || {};
    const finalDanmakuList = danmakuList && danmakuList.length > 0 ? danmakuList : playInfo.danmaku || [];

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
  return {
    "30": [
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部地区",
            "value": ""
          },
          {
            "name": "大陆",
            "value": "大陆"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "香港",
            "value": "香港"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "台湾",
            "value": "台湾"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "意大利",
            "value": "意大利"
          },
          {
            "name": "德国",
            "value": "德国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "lang",
        "name": "语言",
        "init": "",
        "value": [
          {
            "name": "全部语言",
            "value": ""
          },
          {
            "name": "国语",
            "value": "国语"
          },
          {
            "name": "英语",
            "value": "英语"
          },
          {
            "name": "粤语",
            "value": "粤语"
          },
          {
            "name": "闽南语",
            "value": "闽南语"
          },
          {
            "name": "韩语",
            "value": "韩语"
          },
          {
            "name": "日语",
            "value": "日语"
          },
          {
            "name": "法语",
            "value": "法语"
          },
          {
            "name": "德语",
            "value": "德语"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "35": [
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部地区",
            "value": ""
          },
          {
            "name": "大陆",
            "value": "大陆"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "香港",
            "value": "香港"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "台湾",
            "value": "台湾"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "意大利",
            "value": "意大利"
          },
          {
            "name": "德国",
            "value": "德国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "lang",
        "name": "语言",
        "init": "",
        "value": [
          {
            "name": "全部语言",
            "value": ""
          },
          {
            "name": "国语",
            "value": "国语"
          },
          {
            "name": "英语",
            "value": "英语"
          },
          {
            "name": "粤语",
            "value": "粤语"
          },
          {
            "name": "闽南语",
            "value": "闽南语"
          },
          {
            "name": "韩语",
            "value": "韩语"
          },
          {
            "name": "日语",
            "value": "日语"
          },
          {
            "name": "法语",
            "value": "法语"
          },
          {
            "name": "德语",
            "value": "德语"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "36": [
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部地区",
            "value": ""
          },
          {
            "name": "大陆",
            "value": "大陆"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "香港",
            "value": "香港"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "台湾",
            "value": "台湾"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "意大利",
            "value": "意大利"
          },
          {
            "name": "德国",
            "value": "德国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "lang",
        "name": "语言",
        "init": "",
        "value": [
          {
            "name": "全部语言",
            "value": ""
          },
          {
            "name": "国语",
            "value": "国语"
          },
          {
            "name": "英语",
            "value": "英语"
          },
          {
            "name": "粤语",
            "value": "粤语"
          },
          {
            "name": "闽南语",
            "value": "闽南语"
          },
          {
            "name": "韩语",
            "value": "韩语"
          },
          {
            "name": "日语",
            "value": "日语"
          },
          {
            "name": "法语",
            "value": "法语"
          },
          {
            "name": "德语",
            "value": "德语"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "1": [
      {
        "key": "class",
        "name": "剧情",
        "init": "",
        "value": [
          {
            "name": "全部剧情",
            "value": ""
          },
          {
            "name": "喜剧",
            "value": "喜剧"
          },
          {
            "name": "动作",
            "value": "动作"
          },
          {
            "name": "爱情",
            "value": "爱情"
          },
          {
            "name": "惊悚",
            "value": "惊悚"
          },
          {
            "name": "犯罪",
            "value": "犯罪"
          },
          {
            "name": "冒险",
            "value": "冒险"
          },
          {
            "name": "科幻",
            "value": "科幻"
          },
          {
            "name": "悬疑",
            "value": "悬疑"
          },
          {
            "name": "剧情",
            "value": "剧情"
          },
          {
            "name": "动画",
            "value": "动画"
          },
          {
            "name": "武侠",
            "value": "武侠"
          },
          {
            "name": "战争",
            "value": "战争"
          },
          {
            "name": "歌舞",
            "value": "歌舞"
          },
          {
            "name": "奇幻",
            "value": "奇幻"
          },
          {
            "name": "传记",
            "value": "传记"
          },
          {
            "name": "警匪",
            "value": "警匪"
          },
          {
            "name": "历史",
            "value": "历史"
          },
          {
            "name": "运动",
            "value": "运动"
          },
          {
            "name": "伦理",
            "value": "伦理"
          },
          {
            "name": "灾难",
            "value": "灾难"
          },
          {
            "name": "西部",
            "value": "西部"
          },
          {
            "name": "魔幻",
            "value": "魔幻"
          },
          {
            "name": "枪战",
            "value": "枪战"
          },
          {
            "name": "恐怖",
            "value": "恐怖"
          },
          {
            "name": "记录",
            "value": "记录"
          }
        ]
      },
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部地区",
            "value": ""
          },
          {
            "name": "大陆",
            "value": "大陆"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "香港",
            "value": "香港"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "台湾",
            "value": "台湾"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "意大利",
            "value": "意大利"
          },
          {
            "name": "德国",
            "value": "德国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "lang",
        "name": "语言",
        "init": "",
        "value": [
          {
            "name": "全部语言",
            "value": ""
          },
          {
            "name": "国语",
            "value": "国语"
          },
          {
            "name": "英语",
            "value": "英语"
          },
          {
            "name": "粤语",
            "value": "粤语"
          },
          {
            "name": "闽南语",
            "value": "闽南语"
          },
          {
            "name": "韩语",
            "value": "韩语"
          },
          {
            "name": "日语",
            "value": "日语"
          },
          {
            "name": "法语",
            "value": "法语"
          },
          {
            "name": "德语",
            "value": "德语"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "2": [
      {
        "key": "class",
        "name": "剧情",
        "init": "",
        "value": [
          {
            "name": "全部剧情",
            "value": ""
          },
          {
            "name": "古装",
            "value": "古装"
          },
          {
            "name": "喜剧",
            "value": "喜剧"
          },
          {
            "name": "偶像",
            "value": "偶像"
          },
          {
            "name": "家庭",
            "value": "家庭"
          },
          {
            "name": "警匪",
            "value": "警匪"
          },
          {
            "name": "言情",
            "value": "言情"
          },
          {
            "name": "军事",
            "value": "军事"
          },
          {
            "name": "武侠",
            "value": "武侠"
          },
          {
            "name": "悬疑",
            "value": "悬疑"
          },
          {
            "name": "历史",
            "value": "历史"
          },
          {
            "name": "农村",
            "value": "农村"
          },
          {
            "name": "都市",
            "value": "都市"
          },
          {
            "name": "神话",
            "value": "神话"
          },
          {
            "name": "科幻",
            "value": "科幻"
          },
          {
            "name": "少儿",
            "value": "少儿"
          },
          {
            "name": "搞笑",
            "value": "搞笑"
          },
          {
            "name": "谍战",
            "value": "谍战"
          },
          {
            "name": "战争",
            "value": "战争"
          },
          {
            "name": "年代",
            "value": "年代"
          },
          {
            "name": "犯罪",
            "value": "犯罪"
          },
          {
            "name": "恐怖",
            "value": "恐怖"
          },
          {
            "name": "惊悚",
            "value": "惊悚"
          },
          {
            "name": "爱情",
            "value": "爱情"
          },
          {
            "name": "剧情",
            "value": "剧情"
          },
          {
            "name": "奇幻",
            "value": "奇幻"
          }
        ]
      },
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部地区",
            "value": ""
          },
          {
            "name": "大陆",
            "value": "大陆"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "香港",
            "value": "香港"
          },
          {
            "name": "台湾",
            "value": "台湾"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "新加坡",
            "value": "新加坡"
          },
          {
            "name": "其他",
            "value": "其他"
          },
          {
            "name": "香港地区",
            "value": "香港地区"
          }
        ]
      },
      {
        "key": "lang",
        "name": "语言",
        "init": "",
        "value": [
          {
            "name": "全部语言",
            "value": ""
          },
          {
            "name": "国语",
            "value": "国语"
          },
          {
            "name": "英语",
            "value": "英语"
          },
          {
            "name": "粤语",
            "value": "粤语"
          },
          {
            "name": "闽南语",
            "value": "闽南语"
          },
          {
            "name": "韩语",
            "value": "韩语"
          },
          {
            "name": "日语",
            "value": "日语"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "3": [
      {
        "key": "class",
        "name": "剧情",
        "init": "",
        "value": [
          {
            "name": "全部剧情",
            "value": ""
          },
          {
            "name": "真人秀",
            "value": "真人秀"
          },
          {
            "name": "访谈",
            "value": "访谈"
          },
          {
            "name": "情感",
            "value": "情感"
          },
          {
            "name": "选秀",
            "value": "选秀"
          },
          {
            "name": "旅游",
            "value": "旅游"
          },
          {
            "name": "美食",
            "value": "美食"
          },
          {
            "name": "口秀",
            "value": "口秀"
          },
          {
            "name": "曲艺",
            "value": "曲艺"
          },
          {
            "name": "搞笑",
            "value": "搞笑"
          },
          {
            "name": "游戏",
            "value": "游戏"
          },
          {
            "name": "歌舞",
            "value": "歌舞"
          },
          {
            "name": "生活",
            "value": "生活"
          },
          {
            "name": "音乐",
            "value": "音乐"
          },
          {
            "name": "时尚",
            "value": "时尚"
          },
          {
            "name": "益智",
            "value": "益智"
          },
          {
            "name": "职场",
            "value": "职场"
          },
          {
            "name": "少儿",
            "value": "少儿"
          },
          {
            "name": "纪实",
            "value": "纪实"
          },
          {
            "name": "盛会",
            "value": "盛会"
          }
        ]
      },
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部地区",
            "value": ""
          },
          {
            "name": "大陆",
            "value": "大陆"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "香港",
            "value": "香港"
          },
          {
            "name": "台湾",
            "value": "台湾"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "lang",
        "name": "语言",
        "init": "",
        "value": [
          {
            "name": "全部语言",
            "value": ""
          },
          {
            "name": "国语",
            "value": "国语"
          },
          {
            "name": "英语",
            "value": "英语"
          },
          {
            "name": "粤语",
            "value": "粤语"
          },
          {
            "name": "闽南语",
            "value": "闽南语"
          },
          {
            "name": "韩语",
            "value": "韩语"
          },
          {
            "name": "日语",
            "value": "日语"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "4": [
      {
        "key": "tid",
        "name": "类型",
        "init": "",
        "value": [
          {
            "name": "全部类型",
            "value": ""
          },
          {
            "name": "日本动漫",
            "value": "31"
          },
          {
            "name": "国产动漫",
            "value": "32"
          },
          {
            "name": "动漫电影",
            "value": "33"
          },
          {
            "name": "欧美动漫",
            "value": "34"
          }
        ]
      },
      {
        "key": "class",
        "name": "剧情",
        "init": "",
        "value": [
          {
            "name": "全部剧情",
            "value": ""
          },
          {
            "name": "热血",
            "value": "热血"
          },
          {
            "name": "科幻",
            "value": "科幻"
          },
          {
            "name": "推理",
            "value": "推理"
          },
          {
            "name": "搞笑",
            "value": "搞笑"
          },
          {
            "name": "冒险",
            "value": "冒险"
          },
          {
            "name": "校园",
            "value": "校园"
          },
          {
            "name": "动作",
            "value": "动作"
          },
          {
            "name": "机战",
            "value": "机战"
          },
          {
            "name": "运动",
            "value": "运动"
          },
          {
            "name": "战争",
            "value": "战争"
          },
          {
            "name": "少年",
            "value": "少年"
          },
          {
            "name": "少女",
            "value": "少女"
          },
          {
            "name": "社会",
            "value": "社会"
          },
          {
            "name": "原创",
            "value": "原创"
          },
          {
            "name": "亲子",
            "value": "亲子"
          },
          {
            "name": "益智",
            "value": "益智"
          },
          {
            "name": "励志",
            "value": "励志"
          },
          {
            "name": "其他",
            "value": "其他"
          }
        ]
      },
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部地区",
            "value": ""
          },
          {
            "name": "大陆",
            "value": "大陆"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "欧美",
            "value": "欧美"
          },
          {
            "name": "其他",
            "value": "其他"
          }
        ]
      },
      {
        "key": "lang",
        "name": "语言",
        "init": "",
        "value": [
          {
            "name": "全部语言",
            "value": ""
          },
          {
            "name": "国语",
            "value": "国语"
          },
          {
            "name": "英语",
            "value": "英语"
          },
          {
            "name": "粤语",
            "value": "粤语"
          },
          {
            "name": "闽南语",
            "value": "闽南语"
          },
          {
            "name": "韩语",
            "value": "韩语"
          },
          {
            "name": "日语",
            "value": "日语"
          },
          {
            "name": "其它",
            "value": "其它"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "5": [
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部时间",
            "value": ""
          },
          {
            "name": "2026",
            "value": "2026"
          },
          {
            "name": "2025",
            "value": "2025"
          },
          {
            "name": "2024",
            "value": "2024"
          },
          {
            "name": "2023",
            "value": "2023"
          },
          {
            "name": "2022",
            "value": "2022"
          },
          {
            "name": "2021",
            "value": "2021"
          },
          {
            "name": "2020",
            "value": "2020"
          },
          {
            "name": "2019",
            "value": "2019"
          },
          {
            "name": "2018",
            "value": "2018"
          },
          {
            "name": "2017",
            "value": "2017"
          },
          {
            "name": "2016",
            "value": "2016"
          },
          {
            "name": "2015",
            "value": "2015"
          },
          {
            "name": "2014",
            "value": "2014"
          },
          {
            "name": "2013",
            "value": "2013"
          },
          {
            "name": "2012",
            "value": "2012"
          },
          {
            "name": "2011",
            "value": "2011"
          },
          {
            "name": "2010",
            "value": "2010"
          },
          {
            "name": "2009",
            "value": "2009"
          },
          {
            "name": "2008",
            "value": "2008"
          },
          {
            "name": "2007",
            "value": "2007"
          },
          {
            "name": "2006",
            "value": "2006"
          },
          {
            "name": "2005",
            "value": "2005"
          },
          {
            "name": "2004",
            "value": "2004"
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ],
    "6": [
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "字母查找",
            "value": ""
          },
          {
            "name": "A",
            "value": "A"
          },
          {
            "name": "B",
            "value": "B"
          },
          {
            "name": "C",
            "value": "C"
          },
          {
            "name": "D",
            "value": "D"
          },
          {
            "name": "E",
            "value": "E"
          },
          {
            "name": "F",
            "value": "F"
          },
          {
            "name": "G",
            "value": "G"
          },
          {
            "name": "H",
            "value": "H"
          },
          {
            "name": "I",
            "value": "I"
          },
          {
            "name": "J",
            "value": "J"
          },
          {
            "name": "K",
            "value": "K"
          },
          {
            "name": "L",
            "value": "L"
          },
          {
            "name": "M",
            "value": "M"
          },
          {
            "name": "name",
            "value": "name"
          },
          {
            "name": "O",
            "value": "O"
          },
          {
            "name": "P",
            "value": "P"
          },
          {
            "name": "Q",
            "value": "Q"
          },
          {
            "name": "R",
            "value": "R"
          },
          {
            "name": "S",
            "value": "S"
          },
          {
            "name": "T",
            "value": "T"
          },
          {
            "name": "U",
            "value": "U"
          },
          {
            "name": "value",
            "value": "value"
          },
          {
            "name": "W",
            "value": "W"
          },
          {
            "name": "X",
            "value": "X"
          },
          {
            "name": "Y",
            "value": "Y"
          },
          {
            "name": "Z",
            "value": "Z"
          },
          {
            "name": "0-9",
            "value": "0-9"
          }
        ]
      },
      {
        "key": "sort",
        "name": "排序",
        "init": "",
        "value": [
          {
            "name": "时间排序",
            "value": ""
          },
          {
            "name": "人气排序",
            "value": "hits"
          },
          {
            "name": "评分排序",
            "value": "score"
          }
        ]
      }
    ]
  };
}

module.exports = {
  home,
  category,
  search,
  detail,
  play,
};

const runner = require("spider_runner");
runner.run(module.exports);
