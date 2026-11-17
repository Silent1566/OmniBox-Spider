// @name 玩偶
// @author
// @description 刮削：支持，弹幕：支持，播放记录：支持
// @dependencies: axios, cheerio
// @version 1.2.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/玩偶.js

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
// 网站地址(可以通过环境变量配置，支持多个域名用;分割)
const WEB_SITE_CONFIG = process.env.WEB_SITE_WOGG || "https://wogg.xxooo.cf;https://wogg.333232.xyz;https://www.wogg.net;";
const WEB_SITES = WEB_SITE_CONFIG.split(";")
  .map((url) => url.trim())
  .filter((url) => url);
// 读取环境变量：支持多个网盘类型，用分号分割
const DRIVE_TYPE_CONFIG = (process.env.DRIVE_TYPE_CONFIG || "quark;uc")
  .split(";")
  .map((t) => t.trim())
  .filter((t) => t);
// 读取环境变量：线路名称和顺序，用分号分割
const SOURCE_NAMES_CONFIG = (process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s);
// 读取环境变量：详情页播放线路的网盘排序顺序。仅作用于 detail() 里的播放线路，不作用于搜索结果。
const DRIVE_ORDER = (process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
// 详情链路缓存时间（秒），默认 12 小时
const WOGG_CACHE_EX_SECONDS = Number(process.env.WOGG_CACHE_EX_SECONDS || 43200);
const WOGG_VERBOSE_DETAIL = String(process.env.WOGG_VERBOSE_DETAIL || "0") === "1";
// ==================== CF 盾绕过配置（FlareSolverr）====================
// 项目地址：https://github.com/FlareSolverr/FlareSolverr
// 优先读取站点专用变量，其次回退通用 FLARESOLVERR_URL；仅在有值时才启用 CF 绕过逻辑。
const WOOG_FLARESOLVERR_URL = process.env.WOOG_FLARESOLVERR_URL || process.env.FLARESOLVERR_URL || "";
const WOOG_FLARESOLVERR_SESSION = process.env.WOOG_FLARESOLVERR_SESSION || "wogg";
const WOOG_FLARESOLVERR_TIMEOUT_MS = parseInt(process.env.WOOG_FLARESOLVERR_TIMEOUT_MS || "45000", 10) || 45000;
// 手动指定 cf_clearance cookie（设置后跳过自动获取）
const WOOG_CF_COOKIE = process.env.WOOG_CF_COOKIE || "";
// 是否启用自动 CF 绕过（设为 0 可关闭）
const WOOG_CF_AUTO = process.env.WOOG_CF_AUTO !== "0";
// CF cookie 缓存相关
const WOOG_CF_CACHE_KEY = process.env.WOOG_CF_CACHE_KEY || "wogg:cf_clearance";
const WOOG_CF_MAX_AGE_SECONDS = parseInt(process.env.WOOG_CF_MAX_AGE_SECONDS || "21600", 10) || 21600;

// 域名会话缓存（复用 FlareSolverr 的完整请求头 + cookie 绕过同一域名下其他 URL），默认 1800 秒
const WOOG_CF_SESSION_CACHE_TTL = parseInt(process.env.WOOG_CF_SESSION_CACHE_TTL || "1800", 10) || 1800;
const WOOG_CF_SESSION_CACHE_KEY_PREFIX = (process.env.WOOG_CF_SESSION_CACHE_KEY_PREFIX || "wogg:session:").trim();
// ==================== CF 盾绕过配置结束 ====================
// ==================== 配置区域结束 ====================

if (WEB_SITES.length === 0) {
  throw new Error("WEB_SITE 配置不能为空");
}

OmniBox.log("info", `配置了 ${WEB_SITES.length} 个域名: ${WEB_SITES.join(", ")}`);

const INSECURE_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false,
});

function buildCacheKey(prefix, value) {
  return `${prefix}:${value}`;
}

function logDetailDebug(message) {
  if (WOGG_VERBOSE_DETAIL) {
    OmniBox.log("info", message);
  }
}

function inferDriveTypeFromSourceName(name = "") {
  const raw = String(name || "").toLowerCase();
  if (raw.includes("百度")) return "baidu";
  if (raw.includes("天翼")) return "tianyi";
  if (raw.includes("夸克")) return "quark";
  if (raw === "uc" || raw.includes("uc")) return "uc";
  if (raw.includes("115")) return "115";
  if (raw.includes("迅雷")) return "xunlei";
  if (raw.includes("阿里")) return "ali";
  if (raw.includes("123")) return "123pan";
  return raw;
}

function sortPlaySourcesByDriveOrder(playSources = []) {
  if (!Array.isArray(playSources) || playSources.length <= 1 || DRIVE_ORDER.length === 0) {
    return playSources;
  }
  const orderMap = new Map(DRIVE_ORDER.map((name, index) => [name, index]));
  return [...playSources].sort((a, b) => {
    const aType = inferDriveTypeFromSourceName(a?.name || "");
    const bType = inferDriveTypeFromSourceName(b?.name || "");
    const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });
}

async function getCachedJSON(key) {
  try {
    return await OmniBox.getCache(key);
  } catch (error) {
    OmniBox.log("warn", `[cache] 读取缓存失败: key=${key}, err=${error.message}`);
    return null;
  }
}

async function setCachedJSON(key, value, exSeconds) {
  try {
    await OmniBox.setCache(key, value, exSeconds);
  } catch (error) {
    OmniBox.log("warn", `[cache] 写入缓存失败: key=${key}, err=${error.message}`);
  }
}

async function getDetailPageCached(videoId) {
  const cacheKey = buildCacheKey("wogg:detailHtml", videoId);
  let detailPage = await getCachedJSON(cacheKey);
  if (!detailPage) {
    detailPage = await requestWithFailover(videoId);
    if (detailPage && detailPage.response && detailPage.response.statusCode === 200 && detailPage.response.body) {
      await setCachedJSON(cacheKey, detailPage, WOGG_CACHE_EX_SECONDS);
    }
  }
  return detailPage;
}

async function getDriveInfoCached(shareURL) {
  const cacheKey = buildCacheKey("wogg:driveInfo", shareURL);
  let driveInfo = await getCachedJSON(cacheKey);
  if (!driveInfo) {
    driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
    await setCachedJSON(cacheKey, driveInfo, WOGG_CACHE_EX_SECONDS);
  }
  return driveInfo;
}

async function getRootFileListCached(shareURL) {
  const cacheKey = buildCacheKey("wogg:rootFiles", shareURL);
  let fileList = await getCachedJSON(cacheKey);
  if (!fileList) {
    fileList = await OmniBox.getDriveFileList(shareURL, "0");
    if (fileList && fileList.files && Array.isArray(fileList.files)) {
      await setCachedJSON(cacheKey, fileList, WOGG_CACHE_EX_SECONDS);
    }
  }
  return fileList;
}

async function getAllVideoFilesCached(shareURL, rootFiles) {
  const cacheKey = buildCacheKey("wogg:videoFiles", shareURL);
  let allVideoFiles = await getCachedJSON(cacheKey);
  if (!Array.isArray(allVideoFiles) || allVideoFiles.length === 0) {
    allVideoFiles = await getAllVideoFiles(shareURL, rootFiles, "0");
    if (Array.isArray(allVideoFiles) && allVideoFiles.length > 0) {
      await setCachedJSON(cacheKey, allVideoFiles, WOGG_CACHE_EX_SECONDS);
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
  const metadataCacheKey = buildCacheKey("wogg:metadata", videoId);
  const metadataRefreshLockKey = buildCacheKey("wogg:metadataRefreshLock", videoId);

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
    await setCachedJSON(metadataRefreshLockKey, { refreshing: true }, WOGG_CACHE_EX_SECONDS);

    try {
      logDetailDebug(`后台统一刷新元数据: ${videoId}`);
      await OmniBox.processScraping(videoId, vodName, vodName, mergedVideoFilesForScraping);
      const metadata = await OmniBox.getScrapeMetadata(videoId);
      await setCachedJSON(metadataCacheKey, {
        scrapeData: metadata?.scrapeData || null,
        videoMappings: metadata?.videoMappings || [],
        scrapeType: metadata?.scrapeType || "",
      }, WOGG_CACHE_EX_SECONDS);
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
      }, WOGG_CACHE_EX_SECONDS);
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

async function httpRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  // 携带已缓存的 CF cookie（首次请求时自动加载，重试时复用传入值）
  const currentCookie = options._cfCookie || (options._cfChecked ? "" : await getCachedCfCookie().catch(() => ""));
  const headers = {
    ...(options.headers || {}),
    ...(currentCookie ? { Cookie: currentCookie } : {}),
  };

  const response = await axios({
    url,
    method,
    headers,
    data: options.body,
    timeout: options.timeout,
    httpsAgent: INSECURE_HTTPS_AGENT,
    validateStatus: () => true,
  });

  let body = response.data;
  if (typeof body !== "string") {
    body = body === undefined || body === null ? "" : JSON.stringify(body);
  }

  // 检测 CF 盾拦截 → 直接调 FlareSolverr 绕过
  if (isBlockedHtml(body) && WOOG_FLARESOLVERR_URL) {
    OmniBox.log("warn", `[cf] ${url} 被CF盾拦截，通过 FlareSolverr 绕过`);
    try {
      const result = await fetchCfClearanceWithFlareSolverr(url);
      if (result && result.body) {
        OmniBox.log("info", `[cf] FlareSolverr 已返回页面内容: ${url}, status=${result.statusCode}, body长度=${result.body.length}`);
        return {
          statusCode: result.statusCode,
          body: result.body,
          headers: result.headers || {},
          _cfSource: "flaresolverr",
        };
      }
    } catch (err) {
      OmniBox.log("warn", `[cf] FlareSolverr 绕过失败: ${err.message}`);
    }
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
  return lower.includes("just a moment") || lower.includes("cf-browser-verification") || lower.includes("captcha") || lower.includes("访问验证");
}

// ==================== CF 盾辅助函数 ====================

function cookiesArrayToString(cookies = []) {
  return (Array.isArray(cookies) ? cookies : [])
    .map((item) => ({ name: String(item?.name || "").trim(), value: String(item?.value || "").trim() }))
    .filter((item) => item.name && item.value)
    .map((item) => `${item.name}=${item.value}`)
    .join("; ");
}

async function getCachedCfCookie() {
  if (WOOG_CF_COOKIE) return WOOG_CF_COOKIE;
  try {
    const cached = await OmniBox.getCache(WOOG_CF_CACHE_KEY);
    return String(cached || "").trim();
  } catch (error) {
    OmniBox.log("warn", `[cf] 读取缓存失败: ${error.message}`);
    return "";
  }
}

async function setCachedCfCookie(cookie) {
  const value = String(cookie || "").trim();
  if (!value || WOOG_CF_COOKIE) return;
  try {
    await OmniBox.setCache(WOOG_CF_CACHE_KEY, value, WOOG_CF_MAX_AGE_SECONDS);
  } catch (error) {
    OmniBox.log("warn", `[cf] 写入缓存失败: ${error.message}`);
  }
}

// ==================== 域名会话缓存辅助函数 ====================
function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

async function getCachedDomainContext(domain) {
  if (!domain) return null;
  try {
    const key = WOOG_CF_SESSION_CACHE_KEY_PREFIX + domain;
    return await OmniBox.getCache(key) || null;
  } catch (error) {
    OmniBox.log("warn", `[cf] 读取域名会话缓存失败: ${error.message}`);
    return null;
  }
}

async function setCachedDomainContext(domain, headers, ua, cookie) {
  if (!domain) return;
  try {
    const key = WOOG_CF_SESSION_CACHE_KEY_PREFIX + domain;
    const ctx = { headers: headers || {}, ua: String(ua || ""), cookie: String(cookie || "") };
    await OmniBox.setCache(key, ctx, WOOG_CF_SESSION_CACHE_TTL);
    OmniBox.log("info", `[cf] 已缓存域名会话: ${domain}, TTL=${WOOG_CF_SESSION_CACHE_TTL}s, ua=${(ctx.ua || "(无)").substring(0, 40)}, cookie长度=${ctx.cookie.length}`);
  } catch (error) {
    OmniBox.log("warn", `[cf] 写入域名会话缓存失败: ${error.message}`);
  }
}
// ==================== 域名会话缓存辅助函数结束 ====================

async function fetchCfClearanceWithFlareSolverr(targetUrl) {
  const endpoint = String(WOOG_FLARESOLVERR_URL || "").trim();
  if (!endpoint) {
    throw new Error("未配置 FlareSolverr 地址");
  }

  const payload = {
    cmd: "request.get",
    url: targetUrl,
    maxTimeout: WOOG_FLARESOLVERR_TIMEOUT_MS,
  };
  if (String(WOOG_FLARESOLVERR_SESSION || "").trim()) {
    payload.session = String(WOOG_FLARESOLVERR_SESSION).trim();
  }

  const res = await axios.post(endpoint, payload, {
    timeout: WOOG_FLARESOLVERR_TIMEOUT_MS + 5000,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    validateStatus: () => true,
  });

  if (res.status !== 200 || !res.data || res.data.status !== "ok") {
    throw new Error(`FlareSolverr HTTP ${res.status}`);
  }

  const solution = res.data.solution || {};
  const cookies = Array.isArray(solution.cookies) ? solution.cookies : [];
  const cookie = cookiesArrayToString(cookies);
  const cf = cookies.find((item) => String(item?.name) === "cf_clearance");

  if (!cf?.value) {
    throw new Error(`FlareSolverr 未返回 cf_clearance，message=${String(res.data.message || "").trim() || "unknown"}`);
  }

  const ua = String(solution.userAgent || "").trim();
  const cookiePreview = cookie.length > 80 ? cookie.substring(0, 80) + "..." : cookie;
  const execTime = solution.startTimestamp
    ? (new Date(solution.endTimestamp || Date.now()).getTime() - new Date(solution.startTimestamp).getTime()) + "ms"
    : "N/A";
  const flareBody = String(solution.response || "");
  OmniBox.log("info", `[cf] FlareSolverr 返回结果: status=${res.data.status || "?"}, cookies=${cookies.length}, cookie预览=${cookiePreview}, ua=${ua}, body长度=${flareBody.length}, message=${String(res.data.message || "").trim() || "(空)"}, 执行耗时=${execTime}`);
  return {
    cookie,
    body: flareBody,
    statusCode: solution.status || 200,
    headers: solution.headers || {},
    ua,
  };
}

async function ensureCfCookie(forceRefresh = false, targetUrl) {
  if (WOOG_CF_COOKIE) return { cookie: WOOG_CF_COOKIE, flareResult: null };
  if (!forceRefresh) {
    const cached = await getCachedCfCookie();
    if (cached) return { cookie: cached, flareResult: null };
  }
  if (!WOOG_CF_AUTO) return { cookie: "", flareResult: null };

  OmniBox.log("info", `[cf] 开始通过 FlareSolverr 自动获取 cf_clearance`);
  try {
    const flareResult = await fetchCfClearanceWithFlareSolverr(targetUrl);
    if (flareResult.cookie) {
      await setCachedCfCookie(flareResult.cookie);
      OmniBox.log("info", `[cf] 已自动获取 cf_clearance，长度=${flareResult.cookie.length}`);
    }
    return { cookie: flareResult.cookie, flareResult };
  } catch (error) {
    OmniBox.log("warn", `[cf] FlareSolverr 获取失败: ${error.message}`);
    return { cookie: "", flareResult: null };
  }
}

// ==================== CF 盾辅助函数结束 ====================

/**
 * 带容灾的请求函数
 * @param {string} path - 请求路径（相对路径）
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>} 返回响应对象，包含 response 和 baseUrl
 */
async function requestWithFailover(path, options = {}) {
  let lastError = null;
  const perDomainTimeout = Math.max(1000, Math.floor(30000 / WEB_SITES.length));

  for (let i = 0; i < WEB_SITES.length; i++) {
    const baseUrl = removeTrailingSlash(WEB_SITES[i]);
    const fullUrl = path.startsWith("http") ? path : baseUrl + path;

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

      // 如果不是最后一个域名，继续尝试下一个
      if (i < WEB_SITES.length - 1) {
        continue;
      }
    }
  }

  // 所有域名都失败
  throw lastError || new Error("所有域名请求均失败");
}

/**
 * 获取可用的基础 URL（用于构建完整图片链接等）
 * @returns {string} 第一个配置的域名
 */
function getBaseUrl() {
  return removeTrailingSlash(WEB_SITES[0]);
}

/**
 * 移除 URL 末尾的斜杠
 */
function removeTrailingSlash(url) {
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

/**
 * 判断是否为视频文件
 */
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

/**
 * 递归获取所有视频文件
 */
async function getAllVideoFiles(shareURL, files, errors = []) {
  if (!files || !Array.isArray(files)) {
    return [];
  }

  const tasks = files.map(async (file) => {
    if (file.file && isVideoFile(file)) {
      return [file];
    } else if (file.dir) {
      try {
        const subFileList = await OmniBox.getDriveFileList(shareURL, file.fid);
        if (subFileList?.files && Array.isArray(subFileList.files)) {
          return await getAllVideoFiles(shareURL, subFileList.files, errors);
        }
        return [];
      } catch (error) {
        const errorInfo = {
          path: file.name || file.fid,
          fid: file.fid,
          message: error.message,
          timestamp: new Date().toISOString(),
        };
        errors.push(errorInfo);
        OmniBox.log("warn", `获取子目录失败: ${JSON.stringify(errorInfo)}`);
        return [];
      }
    }
    return [];
  });

  const results = await Promise.all(tasks);
  return results.flat();
}

/**
 * 格式化文件大小
 */
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

/**
 * 获取首页数据
 */
async function home(params) {
  try {
    OmniBox.log("info", "获取首页数据");

    let classes = [];
    let list = [];

    try {
      // 使用容灾请求
      const { response, baseUrl } = await requestWithFailover("/");

      if (response.statusCode === 200 && response.body) {
        const $ = cheerio.load(response.body);

        // 从导航菜单中提取分类
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

        // 提取首页影片列表
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

    const currentFilters = await getDynamicFilters();
    return {
      class: classes,
      list: list,
      filters: currentFilters, // 使用动态获取的过滤器 [1]
    };
  } catch (error) {
    OmniBox.log("error", `获取首页数据失败: ${error.message}`);
  }
}

/**
 * 获取分类数据
 */
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

    // 构建请求 URL
    const area = filters?.area || "";
    const sort = filters?.sort || "";
    const cls = filters?.class || "";
    const letter = filters?.letter || "";
    const year = filters?.year || "";

    const url = `/vodshow/${categoryId}-${area}-${sort}-${cls}--${letter}---${page}---${year}.html`;

    // 使用容灾请求
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

    // 解析 HTML
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

    return {
      list: videos,
      page: page,
      pagecount: 0,
      total: videos.length,
    };
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

/**
 * 构建刮削后的文件名
 * @param {Object} scrapeData - TMDB刮削数据
 * @param {Object} mapping - 视频映射关系
 * @param {string} originalFileName - 原始文件名
 * @returns {string} 刮削后的文件名
 */
function buildScrapedFileName(scrapeData, mapping, originalFileName) {
  // 如果无法解析集号(EpisodeNumber == 0)或置信度很低(< 0.5),使用原始文件名
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalFileName;
  }

  // 优先使用 scrapeData.episodes 中的正式剧集标题
  if (scrapeData && scrapeData.episodes && Array.isArray(scrapeData.episodes)) {
    for (const episode of scrapeData.episodes) {
      if (episode.episodeNumber === mapping.episodeNumber && episode.seasonNumber === mapping.seasonNumber) {
        if (episode.name) {
          return `${mapping.episodeNumber}.${episode.name}`;
        }
        break;
      }
    }
  }

  // 其次使用 mapping 自身带回的剧集标题
  if (mapping.episodeName) {
    return `${mapping.episodeNumber}.${mapping.episodeName}`;
  }

  // 最后至少补上集号,避免仍然只是 01.mkv / 02.mkv 这种原样返回
  return `${mapping.episodeNumber}.${originalFileName}`;
}

/**
 * 获取视频详情
 */
async function detail(params) {
  try {
    const videoId = params.videoId || "";

    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    const source = params.source || "";
    OmniBox.log("info", `获取视频详情: videoId=${videoId}, source=${source}`);

    const { response, baseUrl } = await getDetailPageCached(videoId);

    if (response.statusCode !== 200 || !response.body) {
      throw new Error(`请求失败: HTTP ${response.statusCode}`);
    }

    const $ = cheerio.load(response.body);

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

    const panUrls = [];
    const items = $(".module-row-info");
    for (const item of items) {
      const shareUrl = $(item).find("p")[0]?.children?.[0]?.data;
      if (shareUrl) {
        panUrls.push(shareUrl.trim());
      }
    }

    OmniBox.log("info", `解析完成,找到 ${panUrls.length} 个网盘链接`);

    let playSources = [];
    const driveTypeCountMap = await collectDriveTypeCountMap(panUrls);
    const driveTypeCurrentIndexMap = {};

    const panUrlTasks = panUrls.map(async (shareURL) => {
      try {
        OmniBox.log("info", `处理网盘链接: ${shareURL}`);

        const driveInfo = await getDriveInfoCached(shareURL);
        let displayName = driveInfo.displayName || "未知网盘";

        const totalCount = driveTypeCountMap[displayName] || 0;
        if (totalCount > 1) {
          driveTypeCurrentIndexMap[displayName] = (driveTypeCurrentIndexMap[displayName] || 0) + 1;
          displayName = `${displayName}${driveTypeCurrentIndexMap[displayName]}`;
        }

        OmniBox.log("info", `网盘类型: ${displayName}, driveType: ${driveInfo.driveType}`);

        const fileList = await getRootFileListCached(shareURL);
        if (!fileList || !fileList.files || !Array.isArray(fileList.files)) {
          OmniBox.log("warn", `获取文件列表失败: ${shareURL}`);
          return null;
        }

        OmniBox.log("info", `获取文件列表成功,文件数量: ${fileList.files.length}`);

        const allVideoFiles = await getAllVideoFilesCached(shareURL, fileList.files);
        if (allVideoFiles.length === 0) {
          OmniBox.log("warn", `未找到视频文件: ${shareURL}`);
          return null;
        }

        OmniBox.log("info", `递归获取视频文件完成,视频文件数量: ${allVideoFiles.length}`);

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

    for (const result of panUrlResults) {
      const { shareURL, displayName, driveInfo, allVideoFiles } = result;

      let sourceNames = [displayName];
      const targetDriveTypes = DRIVE_TYPE_CONFIG;
      const configSourceNames = SOURCE_NAMES_CONFIG;

      if (targetDriveTypes.includes(driveInfo.driveType)) {
        sourceNames = [...configSourceNames];
        OmniBox.log("info", `${displayName} 匹配成功,线路设置为: ${sourceNames.join(", ")}`);

        if (source === "web") {
          sourceNames = sourceNames.filter((name) => name !== "本地代理");
          OmniBox.log("info", `来源为网页端,已过滤线路`);
        }
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
                } else {
                  OmniBox.log("info", `刮削已命中但未改名: file=${file.file_name}, epNum=${mapping.episodeNumber ?? "N/A"}, epName=${mapping.episodeName || ""}, confidence=${mapping.confidence ?? "N/A"}, scrapeType=${scrapeType || "unknown"}`);
                }
                break;
              }
            }
          }

          let displayFileName = fileName;
          if (fileSize > 0) {
            const fileSizeStr = formatFileSize(fileSize);
            if (fileSizeStr) {
              displayFileName = `[${fileSizeStr}] ${fileName}`;
            }
          }

          const episode = {
            name: displayFileName,
            playId: `${shareURL}|${fileId}|${videoId}`,
            size: fileSize > 0 ? fileSize : undefined,
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

          episodes.push(episode);
        }

        if (scrapeData && episodes.length > 0) {
          const hasEpisodeNumber = episodes.some((ep) => ep._episodeNumber !== undefined);
          if (hasEpisodeNumber) {
            OmniBox.log("info", `检测到刮削数据,按 episodeNumber 排序剧集列表,共 ${episodes.length} 集`);
            episodes.sort((a, b) => {
              const seasonA = a._seasonNumber !== undefined ? a._seasonNumber : 0;
              const seasonB = b._seasonNumber !== undefined ? b._seasonNumber : 0;
              if (seasonA !== seasonB) {
                return seasonA - seasonB;
              }
              const episodeA = a._episodeNumber !== undefined ? a._episodeNumber : 0;
              const episodeB = b._episodeNumber !== undefined ? b._episodeNumber : 0;
              return episodeA - episodeB;
            });
          }
        }

        if (episodes.length > 0) {
          let finalSourceName = sourceName;
          if (targetDriveTypes.includes(driveInfo.driveType)) {
            finalSourceName = `${displayName}-${sourceName}`;
          }

          playSources.push({
            name: finalSourceName,
            episodes: episodes,
          });
        }
      }
    }

    if (scrapeData) {
      if (scrapeData.title) {
        vodName = scrapeData.title;
      }
      if (scrapeData.posterPath) {
        vodPic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
      }
      if (scrapeData.releaseDate) {
        vodYear = scrapeData.releaseDate.substring(0, 4) || vodYear;
      }
      if (scrapeData.overview) {
        vodContent = scrapeData.overview;
      }

      if (scrapeData.credits) {
        if (scrapeData.credits.cast && Array.isArray(scrapeData.credits.cast)) {
          const actors = scrapeData.credits.cast
            .slice(0, 5)
            .map((cast) => cast.name || "")
            .filter((name) => name)
            .join(",");
          if (actors) {
            vodActor = actors;
          }
        }
        if (scrapeData.credits.crew && Array.isArray(scrapeData.credits.crew)) {
          const directors = scrapeData.credits.crew.filter((crew) => crew.job === "Director" || crew.department === "Directing");
          if (directors.length > 0) {
            const directorNames = directors
              .slice(0, 3)
              .map((director) => director.name || "")
              .filter((name) => name)
              .join(",");
            if (directorNames) {
              vodDirector = directorNames;
            }
          }
        }
      }
    }

    OmniBox.log("info", `构建播放源完成,网盘数量: ${playSources.length}`);
    if (Array.isArray(playSources) && playSources.length > 1 && DRIVE_ORDER.length > 0) {
      playSources = sortPlaySourcesByDriveOrder(playSources);
      OmniBox.log("info", `[detail] 按 DRIVE_ORDER 排序后线路顺序: ${playSources.map((item) => item.name).join(" | ")}`);
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

    // 使用容灾请求
    const searchPath = `/vodsearch/-------------.html?wd=${keyword}`;
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

    // 解析 HTML
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

/**
 * 获取播放地址
 */
async function play(params, context) {
  try {
    const flag = params.flag || "";
    const playId = params.playId || "";
    const source = params.source || "";

    OmniBox.log("info", `获取播放地址: flag=${flag}, playId=${playId}`);

    if (!playId) {
      throw new Error("播放参数不能为空");
    }

    const parts = playId.split("|");
    if (parts.length < 2) {
      throw new Error("播放参数格式错误,应为:分享链接|文件ID");
    }
    const shareURL = parts[0] || "";
    const fileId = parts[1] || "";
    const videoId = parts[2] || "";

    if (!shareURL || !fileId) {
      throw new Error("分享链接或文件ID不能为空");
    }

    OmniBox.log("info", `解析参数: shareURL=${shareURL}, fileId=${fileId}`);

    let routeType = source === "web" ? "服务端代理" : "直连";
    if (flag && flag.includes("-")) {
      const flagParts = flag.split("-");
      routeType = flagParts[flagParts.length - 1];
    }

    OmniBox.log("info", `使用线路: ${routeType}`);

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
/**
 * 筛选配置
 */
async function getDynamicFilters() {
  return {
    "1": [
      {
        "key": "class",
        "name": "剧情",
        "init": "",
        "value": [
          {
            "name": "全部",
            "value": ""
          },
          {
            "name": "喜剧",
            "value": "喜剧"
          },
          {
            "name": "爱情",
            "value": "爱情"
          },
          {
            "name": "恐怖",
            "value": "恐怖"
          },
          {
            "name": "动作",
            "value": "动作"
          },
          {
            "name": "科幻",
            "value": "科幻"
          },
          {
            "name": "剧情",
            "value": "剧情"
          },
          {
            "name": "战争",
            "value": "战争"
          },
          {
            "name": "警匪",
            "value": "警匪"
          },
          {
            "name": "犯罪",
            "value": "犯罪"
          },
          {
            "name": "古装",
            "value": "古装"
          },
          {
            "name": "奇幻",
            "value": "奇幻"
          },
          {
            "name": "武侠",
            "value": "武侠"
          },
          {
            "name": "冒险",
            "value": "冒险"
          },
          {
            "name": "枪战",
            "value": "枪战"
          },
          {
            "name": "悬疑",
            "value": "悬疑"
          },
          {
            "name": "惊悚",
            "value": "惊悚"
          },
          {
            "name": "经典",
            "value": "经典"
          },
          {
            "name": "青春",
            "value": "青春"
          },
          {
            "name": "文艺",
            "value": "文艺"
          },
          {
            "name": "微电影",
            "value": "微电影"
          },
          {
            "name": "历史",
            "value": "历史"
          }
        ]
      },
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部",
            "value": ""
          },
          {
            "name": "中国大陆",
            "value": "中国大陆"
          },
          {
            "name": "中国香港",
            "value": "中国香港"
          },
          {
            "name": "中国台湾",
            "value": "中国台湾"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "德国",
            "value": "德国"
          },
          {
            "name": "印度",
            "value": "印度"
          },
          {
            "name": "意大利",
            "value": "意大利"
          },
          {
            "name": "加拿大",
            "value": "加拿大"
          },
          {
            "name": "其他",
            "value": "其他"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部",
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
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
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
            "name": "全部",
            "value": ""
          },
          {
            "name": "喜剧",
            "value": "喜剧"
          },
          {
            "name": "爱情",
            "value": "爱情"
          },
          {
            "name": "恐怖",
            "value": "恐怖"
          },
          {
            "name": "动作",
            "value": "动作"
          },
          {
            "name": "科幻",
            "value": "科幻"
          },
          {
            "name": "剧情",
            "value": "剧情"
          },
          {
            "name": "战争",
            "value": "战争"
          },
          {
            "name": "警匪",
            "value": "警匪"
          },
          {
            "name": "犯罪",
            "value": "犯罪"
          },
          {
            "name": "古装",
            "value": "古装"
          },
          {
            "name": "奇幻",
            "value": "奇幻"
          },
          {
            "name": "武侠",
            "value": "武侠"
          },
          {
            "name": "冒险",
            "value": "冒险"
          },
          {
            "name": "枪战",
            "value": "枪战"
          },
          {
            "name": "悬疑",
            "value": "悬疑"
          },
          {
            "name": "惊悚",
            "value": "惊悚"
          },
          {
            "name": "经典",
            "value": "经典"
          },
          {
            "name": "青春",
            "value": "青春"
          },
          {
            "name": "文艺",
            "value": "文艺"
          },
          {
            "name": "微电影",
            "value": "微电影"
          },
          {
            "name": "历史",
            "value": "历史"
          }
        ]
      },
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部",
            "value": ""
          },
          {
            "name": "中国大陆",
            "value": "中国大陆"
          },
          {
            "name": "中国香港",
            "value": "中国香港"
          },
          {
            "name": "中国台湾",
            "value": "中国台湾"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "德国",
            "value": "德国"
          },
          {
            "name": "印度",
            "value": "印度"
          },
          {
            "name": "意大利",
            "value": "意大利"
          },
          {
            "name": "加拿大",
            "value": "加拿大"
          },
          {
            "name": "其他",
            "value": "其他"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部",
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
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
            "value": "score"
          }
        ]
      }
    ],
    "44": [
      {
        "key": "class",
        "name": "剧情",
        "init": "",
        "value": [
          {
            "name": "全部",
            "value": ""
          },
          {
            "name": "喜剧",
            "value": "喜剧"
          },
          {
            "name": "爱情",
            "value": "爱情"
          },
          {
            "name": "恐怖",
            "value": "恐怖"
          },
          {
            "name": "动作",
            "value": "动作"
          },
          {
            "name": "科幻",
            "value": "科幻"
          },
          {
            "name": "剧情",
            "value": "剧情"
          },
          {
            "name": "战争",
            "value": "战争"
          },
          {
            "name": "警匪",
            "value": "警匪"
          },
          {
            "name": "犯罪",
            "value": "犯罪"
          },
          {
            "name": "古装",
            "value": "古装"
          },
          {
            "name": "奇幻",
            "value": "奇幻"
          },
          {
            "name": "武侠",
            "value": "武侠"
          },
          {
            "name": "冒险",
            "value": "冒险"
          },
          {
            "name": "枪战",
            "value": "枪战"
          },
          {
            "name": "悬疑",
            "value": "悬疑"
          },
          {
            "name": "惊悚",
            "value": "惊悚"
          },
          {
            "name": "经典",
            "value": "经典"
          },
          {
            "name": "青春",
            "value": "青春"
          },
          {
            "name": "文艺",
            "value": "文艺"
          },
          {
            "name": "微电影",
            "value": "微电影"
          },
          {
            "name": "历史",
            "value": "历史"
          }
        ]
      },
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部",
            "value": ""
          },
          {
            "name": "中国大陆",
            "value": "中国大陆"
          },
          {
            "name": "中国香港",
            "value": "中国香港"
          },
          {
            "name": "中国台湾",
            "value": "中国台湾"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "韩国",
            "value": "韩国"
          },
          {
            "name": "泰国",
            "value": "泰国"
          },
          {
            "name": "德国",
            "value": "德国"
          },
          {
            "name": "印度",
            "value": "印度"
          },
          {
            "name": "意大利",
            "value": "意大利"
          },
          {
            "name": "加拿大",
            "value": "加拿大"
          },
          {
            "name": "其他",
            "value": "其他"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部",
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
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
            "value": "score"
          }
        ]
      }
    ],
    "6": [
      {
        "key": "class",
        "name": "剧情",
        "init": "",
        "value": [
          {
            "name": "全部",
            "value": ""
          },
          {
            "name": "男频",
            "value": "男频"
          },
          {
            "name": "女频",
            "value": "女频"
          },
          {
            "name": "都市",
            "value": "都市"
          },
          {
            "name": "甜宠",
            "value": "甜宠"
          },
          {
            "name": "年代",
            "value": "年代"
          },
          {
            "name": "穿越",
            "value": "穿越"
          },
          {
            "name": "古装",
            "value": "古装"
          },
          {
            "name": "亲情",
            "value": "亲情"
          },
          {
            "name": "奇幻",
            "value": "奇幻"
          },
          {
            "name": "萌宝",
            "value": "萌宝"
          },
          {
            "name": "重生",
            "value": "重生"
          },
          {
            "name": "冒险",
            "value": "冒险"
          },
          {
            "name": "逆袭",
            "value": "逆袭"
          },
          {
            "name": "虐恋",
            "value": "虐恋"
          },
          {
            "name": "鉴宝",
            "value": "鉴宝"
          },
          {
            "name": "复仇",
            "value": "复仇"
          },
          {
            "name": "修仙",
            "value": "修仙"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部",
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
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
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
            "name": "全部",
            "value": ""
          },
          {
            "name": "情感",
            "value": "情感"
          },
          {
            "name": "科幻",
            "value": "科幻"
          },
          {
            "name": "热血",
            "value": "热血"
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
            "name": "萝莉",
            "value": "萝莉"
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
            "name": "全部",
            "value": ""
          },
          {
            "name": "中国大陆",
            "value": "中国大陆"
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
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "西班牙",
            "value": "西班牙"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "其他",
            "value": "其他"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部",
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
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
            "value": "score"
          }
        ]
      }
    ],
    "4": [
      {
        "key": "area",
        "name": "地区",
        "init": "",
        "value": [
          {
            "name": "全部",
            "value": ""
          },
          {
            "name": "中国大陆",
            "value": "中国大陆"
          },
          {
            "name": "中国台湾",
            "value": "中国台湾"
          },
          {
            "name": "美国",
            "value": "美国"
          },
          {
            "name": "法国",
            "value": "法国"
          },
          {
            "name": "英国",
            "value": "英国"
          },
          {
            "name": "日本",
            "value": "日本"
          },
          {
            "name": "韩国",
            "value": "韩国"
          }
        ]
      },
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部",
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
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
            "value": "score"
          }
        ]
      }
    ],
    "46": [
      {
        "key": "year",
        "name": "时间",
        "init": "",
        "value": [
          {
            "name": "全部",
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
          }
        ]
      },
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
            "value": "score"
          }
        ]
      }
    ],
    "5": [
      {
        "key": "letter",
        "name": "字母",
        "init": "",
        "value": [
          {
            "name": "全部",
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
            "name": "默认",
            "value": ""
          },
          {
            "name": "人气",
            "value": "hits"
          },
          {
            "name": "评分",
            "value": "score"
          }
        ]
      }
    ]
  };
}

// 导出接口
module.exports = {
  home,
  category,
  search,
  detail,
  play,
};

// 使用公共 runner 处理标准输入/输出
const runner = require("spider_runner");
runner.run(module.exports);
