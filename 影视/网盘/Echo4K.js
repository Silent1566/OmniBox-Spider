// @name Echo4K
// @author 梦
// @description 影视站：echo4k.net，蓝光原盘/4K资源；支持首页、分类、搜索、详情、网盘/磁力链接提取、刮削、弹幕；Cookie 支持环境变量配置
// @version 1.1.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/Echo4K.js
// @dependencies cheerio

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const BASE_URL = process.env.ECHO4K_HOST || "https://www.echo4k.net";
const SITE_COOKIE = String(process.env.ECHO4K_COOKIE || "").trim();
const LOGIN_TOKEN = String(process.env.ECHO4K_LOGIN_TOKEN || "7c2481cb40873e364a7a5ebf32013868").trim();
const USER_ID = String(process.env.ECHO4K_USER_ID || "5763").trim();
const UA = process.env.ECHO4K_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const POSTER_PATH = "https://static.echo4k.net/movie_posters/";
const AUTH_ENDPOINT = BASE_URL + "/user/auth.php";
const SESSION_COOKIE_KEY = "echo4k:phpsessid";
const SESSION_CACHE_TTL = 3600;

const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "quark;uc;115");
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");
const DRIVE_ORDER = splitConfigList(process.env.DRIVE_ORDER || "115;quark;uc;baidu;tianyi;xunlei;ali;123pan").map((s) => s.toLowerCase());

const VIDEO_EXTENSIONS = [
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v", ".mpg", ".mpeg", ".rmvb", ".ts", ".m2ts", ".webm", ".iso",
];

const CLASS_LIST = [
  { type_id: "首页", type_name: "首页" },
  { type_id: "电影", type_name: "电影" },
  { type_id: "剧集", type_name: "剧集" },
  { type_id: "动漫", type_name: "动漫" },
  { type_id: "纪录片", type_name: "纪录片" },
  { type_id: "演唱会", type_name: "演唱会" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function splitConfigList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function getHeaders(referer, extra) {
  const h = {
    "User-Agent": UA,
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "X-Requested-With": "XMLHttpRequest",
    Referer: referer || BASE_URL + "/",
    Origin: BASE_URL,
  };
  if (SITE_COOKIE) h["Cookie"] = SITE_COOKIE;
  if (LOGIN_TOKEN) h["Login-Token"] = LOGIN_TOKEN;
  if (USER_ID) h["User-Id"] = USER_ID;
  return Object.assign(h, extra || {});
}
function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFileSize(size) {
  const n = Number(size || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return n + "B";
  if (n < 1024 ** 2) return (n / 1024).toFixed(2) + "KB";
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(2) + "MB";
  if (n < 1024 ** 4) return (n / 1024 ** 3).toFixed(2) + "GB";
  return (n / 1024 ** 4).toFixed(2) + "TB";
}

function encodePlayMeta(meta) {
  try {
    return Buffer.from(JSON.stringify(meta || {}), "utf8").toString("base64");
  } catch (_) {
    return "";
  }
}

function decodePlayMeta(meta) {
  try {
    return JSON.parse(Buffer.from(String(meta || ""), "base64").toString("utf8") || "{}");
  } catch (_) {
    return {};
  }
}

function resolvePosterUrl(rawPath) {
  const path = String(rawPath || "").trim();
  if (!path) return "";
  if (/^(data:|https?:)?\/\//i.test(path)) return path;
  return POSTER_PATH + path.replace(/^\/+/, "");
}

function extractSize(t) {
  if (!t) return 0;
  const gbMatch = t.match(/(?:\[|【)(\d+(?:\.\d+)?)\s*(GB|G)(?:\]|】)/i);
  if (gbMatch) return parseFloat(gbMatch[1]) * 1024;
  const mbMatch = t.match(/(?:\[|【)(\d+(?:\.\d+)?)\s*MB(?:\]|】)/i);
  if (mbMatch) return parseFloat(mbMatch[1]);
  const tbMatch = t.match(/(?:\[|【)?(\d+(?:\.\d+)?)\s*TB(?:\]|】)?/i);
  if (tbMatch) return parseFloat(tbMatch[1]) * 1024 * 1024;
  const plainGbMatch = t.match(/(\d+(?:\.\d+)?)\s*(GB|G)/i);
  if (plainGbMatch) return parseFloat(plainGbMatch[1]) * 1024;
  const plainMbMatch = t.match(/(\d+(?:\.\d+)?)\s*MB/i);
  if (plainMbMatch) return parseFloat(plainMbMatch[1]);
  return 0;
}

function inferDriveType(url) {
  const value = String(url || "").toLowerCase();
  if (!value) return "";
  if (value.includes("115cdn.com") || value.includes("115.com/s")) return "115";
  if (value.includes("pan.quark.cn") || value.includes("drive-h.quark.cn")) return "quark";
  if (value.includes("pan.baidu.com")) return "baidu";
  if (value.includes("alipan.com") || value.includes("aliyundrive.com")) return "aliyun";
  if (value.includes("cloud.189.cn")) return "tianyi";
  if (value.includes("123684.com") || value.includes("123865.com") || value.includes("123pan.com")) return "123pan";
  if (value.startsWith("magnet:")) return "magnet";
  return "";
}

function driveTypeToDisplayName(driveType) {
  const t = String(driveType || "").toLowerCase();
  if (t === "115") return "115网盘";
  if (t === "quark") return "夸克网盘";
  if (t === "baidu") return "百度网盘";
  if (t === "aliyun") return "阿里云盘";
  if (t === "tianyi") return "天翼网盘";
  if (t === "123pan") return "123网盘";
  if (t === "magnet") return "磁力链接";
  return "网盘";
}

function inferDriveTypeFromSourceName(name) {
  const raw = String(name || "").toLowerCase();
  if (raw.includes("百度")) return "baidu";
  if (raw.includes("天翼")) return "tianyi";
  if (raw.includes("夸克")) return "quark";
  if (raw === "uc" || raw.includes("uc网盘")) return "uc";
  if (raw.includes("115")) return "115";
  if (raw.includes("迅雷")) return "xunlei";
  if (raw.includes("阿里")) return "ali";
  if (raw.includes("123")) return "123pan";
  return raw;
}

function sortPlaySourcesByDriveOrder(playSources) {
  if (!Array.isArray(playSources) || playSources.length <= 1 || DRIVE_ORDER.length === 0) return playSources;
  const orderMap = new Map(DRIVE_ORDER.map((name, index) => [name, index]));
  return [...playSources].sort((a, b) => {
    const aOrder = orderMap.has(inferDriveTypeFromSourceName(a?.name || "")) ? orderMap.get(inferDriveTypeFromSourceName(a?.name || "")) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(inferDriveTypeFromSourceName(b?.name || "")) ? orderMap.get(inferDriveTypeFromSourceName(b?.name || "")) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
}

function canUseServerProxy(context) {
  const baseURL = String(context?.baseURL || "").trim();
  if (!baseURL) return false;
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
    if (/^(10\.|192\.168\.|169\.254\.)/.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)) return true;
    return false;
  } catch (_) { return false; }
}

function resolveCallerSource(params, context) {
  return String(context?.from || params?.source || "").toLowerCase();
}

function filterSourceNamesForCaller(sourceNames, callerSource, context) {
  let filtered = Array.isArray(sourceNames) ? [...sourceNames] : [];
  const allowServerProxy = canUseServerProxy(context);
  if (callerSource === "web") filtered = filtered.filter((n) => n !== "本地代理");
  else if (callerSource === "emby") {
    filtered = allowServerProxy ? filtered.filter((n) => n === "服务端代理") : filtered.filter((n) => n !== "服务端代理");
  } else if (callerSource === "uz") filtered = filtered.filter((n) => n !== "本地代理");
  if (!allowServerProxy) filtered = filtered.filter((n) => n !== "服务端代理");
  return filtered.length > 0 ? filtered : ["直连"];
}

function resolveRouteType(flag, callerSource, context) {
  const allowServerProxy = canUseServerProxy(context);
  let routeType = "直连";
  if (callerSource === "web" || callerSource === "emby") routeType = allowServerProxy ? "服务端代理" : "直连";
  if (flag) {
    if (flag.includes("-")) { const parts = flag.split("-"); routeType = parts[parts.length - 1]; }
    else routeType = flag;
  }
  const valid = new Set(["本地代理", "服务端代理", "直连"]);
  if (!valid.has(routeType)) routeType = "直连";
  if (!allowServerProxy && routeType === "服务端代理") routeType = "直连";
  if (callerSource === "uz" && routeType === "本地代理") routeType = "直连";
  return routeType;
}
function isVideoFile(file) {
  const name = String(file?.file_name || file?.name || "").toLowerCase();
  if (!name) return false;
  return VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function isFolderLike(file) {
  if (file?.is_dir === 1 || file?.dir === 1 || file?.folder === 1 || file?.is_folder === 1) return true;
  const type = String(file?.type || file?.obj_type || file?.category || "").toLowerCase();
  return type.includes("dir") || type.includes("folder");
}

async function getAllVideoFiles(shareURL, files, depth, seen) {
  if (!Array.isArray(files) || !files.length || depth > 8) return [];
  const videos = [];
  for (const file of files) {
    const fid = String(file?.fid || file?.file_id || file?.id || "").trim();
    if (!fid) continue;
    if (isVideoFile(file)) {
      videos.push({ fid, file_name: String(file?.file_name || file?.name || fid), size: Number(file?.size || file?.file_size || 0) });
      continue;
    }
    if (isFolderLike(file)) {
      const key = shareURL + "|" + fid;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const subFileList = await OmniBox.getDriveFileList(shareURL, fid);
        const subFiles = Array.isArray(subFileList?.files) ? subFileList.files : Array.isArray(subFileList) ? subFileList : [];
        if (subFiles.length) {
          const nested = await getAllVideoFiles(shareURL, subFiles, depth + 1, seen);
          if (nested.length) videos.push(...nested);
        }
      } catch (e) {
        await OmniBox.log("warn", "[Echo4K][detail] 读取子目录失败: " + e.message);
      }
    }
  }
  return videos;
}

function dedupeEpisodes(episodes) {
  const seen = new Set();
  const result = [];
  for (const ep of episodes) {
    const key = ep.playId + "@@" + ep.name;
    if (!ep.playId || seen.has(key)) continue;
    seen.add(key);
    result.push(ep);
  }
  return result;
}

function buildScrapedFileName(scrapeData, mapping, originalFileName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) return originalFileName;
  if (!scrapeData || !scrapeData.title) return originalFileName;
  if (scrapeData.type === "tv" || mapping.seasonNumber) {
    const sn = mapping.seasonNumber || 1;
    const en = mapping.episodeNumber || 1;
    const y = scrapeData.seasonAirYear || "";
    let name = scrapeData.title;
    if (y) name += "." + y;
    name += ".S" + String(sn).padStart(2, "0") + "E" + String(en).padStart(2, "0");
    return name;
  }
  return scrapeData.title || originalFileName;
}

function normalizeEpisodeName(episodeName) {
  return String(episodeName || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/第\s*([0-9一二三四五六七八九十百千零〇两]+)\s*[集话期]/g, "E$1")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  const title = cleanText(vodName || "");
  const episode = normalizeEpisodeName(episodeTitle || "");
  if (!title) return episode;
  if (!episode || title.includes(episode)) return title;
  return title + " " + episode;
}

async function ensureSessionCookie() {
  if (SITE_COOKIE) return SITE_COOKIE;
  if (!LOGIN_TOKEN || !USER_ID) return "is_human=1";
  try {
    const cached = await OmniBox.getCache(SESSION_COOKIE_KEY);
    if (cached) return "is_human=1; PHPSESSID=" + String(cached);
  } catch (_) {}
  try {
    const res = await OmniBox.request(AUTH_ENDPOINT + "?action=profile", {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Referer": BASE_URL + "/user/index.html",
        "Origin": BASE_URL,
        "Cookie": "is_human=1",
      },
      body: JSON.stringify({ user_id: USER_ID, login_token: LOGIN_TOKEN }),
      timeout: 15000,
    });
    const text = getBodyText(res);
    const setCookieHeader = String(res?.headers?.["set-cookie"] || res?.headers?.["Set-Cookie"] || "");
    const phpsessidMatch = setCookieHeader.match(/PHPSESSID=([^;]+)/);
    if (phpsessidMatch) {
      const sid = phpsessidMatch[1];
      try { await OmniBox.setCache(SESSION_COOKIE_KEY, sid, SESSION_CACHE_TTL); } catch (_) {}
      await OmniBox.log("info", "[Echo4K][session] got PHPSESSID=" + sid);
      return "is_human=1; PHPSESSID=" + sid;
    }
    await OmniBox.log("warn", "[Echo4K][session] no PHPSESSID in response, set-cookie=" + setCookieHeader.substring(0, 200));
  } catch (e) {
    await OmniBox.log("warn", "[Echo4K][session] auth request failed: " + e.message);
  }
  return "is_human=1";
}

let _sessionCookie = null;
async function getCookieWithSession() {
  if (SITE_COOKIE) return SITE_COOKIE;
  if (!_sessionCookie) _sessionCookie = await ensureSessionCookie();
  return _sessionCookie;
}

async function apiRequest(url, options) {
  options = options || {};
  const cookie = await getCookieWithSession();
  const headers = getHeaders(options.referer, options.headers);
  headers["Cookie"] = cookie;
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: headers,
    timeout: options.timeout || 20000,
    body: options.body,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  if (statusCode < 200 || statusCode >= 400) {
    await OmniBox.log("error", "[Echo4K][api] HTTP " + statusCode + " url=" + url + " body=" + text.substring(0, 300));
    throw new Error("HTTP " + statusCode + " @ " + url);
  }
  if (/Fatal error|security_bootstrap/i.test(text.substring(0, 200))) {
    _sessionCookie = null;
    await OmniBox.log("error", "[Echo4K][api] PHP error, will refresh session url=" + url);
    throw new Error("Server PHP error @ " + url);
  }
  let data;
  try { data = JSON.parse(text); } catch (_) {
    _sessionCookie = null;
    await OmniBox.log("error", "[Echo4K][api] JSON parse error url=" + url + " body=" + text.substring(0, 500));
    throw new Error("JSON parse error @ " + url);
  }
  if (data.code === 401 || data.code === 403) {
    _sessionCookie = null;
    const msg = data.message || data.msg || ("API error code=" + data.code);
    await OmniBox.log("error", "[Echo4K][api] " + msg + " url=" + url);
    throw new Error(msg);
  }
  if (data.code === 200 && data.data !== undefined) return data.data;
  throw new Error(data.message || "API error code=" + data.code);
}

function normalizeMovieItem(item) {
  const id = String(item.id || item.storage_id || "").trim();
  const title = cleanText(item.title || item.name || "");
  const poster = resolvePosterUrl(item.poster_file || item.poster || item.cover || item.image || "");
  const label = cleanText(item.label || "");
  const score = String(item.score || item.douban_score || item.rating || "").trim();
  const year = String(item.year || "").trim();
  const type = String(item.type || item.sub_types || "").trim();
  return { id, title, poster, label, score, year, type };
}

function normalizeDownloads(downloads) {
  const group115 = [];
  const magnet = [];
  for (const it of downloads || []) {
    const link = String(typeof it === "string" ? it : (it.link || it.url || it.download_url || it.magnet || "")).trim();
    const label = String(typeof it === "string" ? "下载地址" : (it.label || it.name || "下载地址")).trim();
    const rawSize = typeof it === "string" ? "" : (it.sz || it.size || it.zsize || "");
    const normalizedSize = typeof rawSize === "number" ? rawSize : extractSize(String(rawSize));
    const size = normalizedSize || extractSize(label) || extractSize(link);
    const itemPayload = { label, link, sz: size };
    if (link.includes("115") || link.includes("anxia")) {
      group115.push(itemPayload);
    } else {
      magnet.push(itemPayload);
    }
  }
  return {
    group115: group115.sort((a, b) => b.sz - a.sz),
    groupMagnet: magnet.sort((a, b) => b.sz - a.sz),
  };
}
async function home(params, context) {
  try {
    const data = await apiRequest(BASE_URL + "/api/get_recent_movies.php?t=" + Date.now());
    const list = (Array.isArray(data?.list) ? data.list : []).map(normalizeMovieItem).slice(0, 24);
    return { class: CLASS_LIST, filters: {}, list: list };
  } catch (e) {
    await OmniBox.log("error", "[Echo4K][home] " + e.message);
    return { class: CLASS_LIST, filters: {}, list: [] };
  }
}

async function category(params, context) {
  try {
    const type = String(params.categoryId || params.type_id || "首页");
    const page = Math.max(1, parseInt(params.page || 1, 10));
    const qs = new URLSearchParams({ type: type, page: String(page), page_size: "15", t: String(Date.now()) });
    const data = await apiRequest(BASE_URL + "/api/get_movies.php?" + qs);
    const list = (Array.isArray(data?.list) ? data.list : []).map(normalizeMovieItem);
    const totalPage = Number(data?.total_page || 1);
    return { page: page, pagecount: totalPage, total: totalPage * Math.max(list.length, 1), list: list };
  } catch (e) {
    await OmniBox.log("error", "[Echo4K][category] " + e.message);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    const page = Math.max(1, parseInt(params.page || 1, 10));
    if (!keyword) return { page: page, pagecount: 0, total: 0, list: [] };
    const qs = new URLSearchParams({ keyword: keyword, t: String(Date.now()) });
    const data = await apiRequest(BASE_URL + "/api/search_movies.php?" + qs);
    const list = (Array.isArray(data?.list) ? data.list : []).map(normalizeMovieItem);
    return { page: page, pagecount: 1, total: list.length, list: list };
  } catch (e) {
    await OmniBox.log("error", "[Echo4K][search] " + e.message);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "").trim();
    if (!videoId) return { list: [] };

    const source = resolveCallerSource(params, context);
    const qs = new URLSearchParams({ movie_id: videoId, t: String(Date.now()) });
    const data = await apiRequest(BASE_URL + "/api/get_movie_detail.php?" + qs);

    const title = cleanText(data.title || "");
    const pic = resolvePosterUrl(data.poster_file || data.poster || data.cover || data.image || "");
    const desc = cleanText(data.description || data.sub_types || "");
    const score = String(data.score || data.douban_score || data.rating || "").trim();
    const label = cleanText(data.label || "");

    const meta = String(data.meta || "").trim();
    const metaParts = meta.split("/").map((s) => s.trim()).filter(Boolean);
    let vod_year = "";
    let vod_area = "";
    let vod_director = "";
    let vod_actor = "";
    for (const part of metaParts) {
      if (/^导演[：:]/.test(part)) vod_director = part.replace(/^导演[：:]/, "").trim();
      else if (/^主演[：:]/.test(part)) vod_actor = part.replace(/^主演[：:]/, "").trim();
      else if (/^\d{4}$/.test(part)) vod_year = part;
    }
    if (!vod_year && data.year) vod_year = String(data.year).slice(0, 4);

    const downloads = Array.isArray(data.downloads) ? data.downloads : [];
    const { group115, groupMagnet } = normalizeDownloads(downloads);

    const playSources = [];
    const filesForScraping = [];
    const driveTypeCountMap = {};
    const driveTypeCurrentIndexMap = {};

    for (const item of group115) {
      const shareURL = item.link;
      if (!shareURL || shareURL.includes("...")) continue;
      const dt = inferDriveType(shareURL);
      let displayName = driveTypeToDisplayName(dt);
      driveTypeCountMap[displayName] = (driveTypeCountMap[displayName] || 0) + 1;
    }

    for (const item of group115) {
      const shareURL = item.link;
      if (!shareURL || shareURL.includes("...")) continue;
      if (shareURL.startsWith("magnet:")) continue;

      const dt = inferDriveType(shareURL);
      let displayName = driveTypeToDisplayName(dt);
      const totalCount = driveTypeCountMap[displayName] || 0;
      if (totalCount > 1) {
        driveTypeCurrentIndexMap[displayName] = (driveTypeCurrentIndexMap[displayName] || 0) + 1;
        displayName = displayName + driveTypeCurrentIndexMap[displayName];
      }

      let allVideoFiles = [];
      try {
        const rootFileList = await OmniBox.getDriveFileList(shareURL, "0");
        const rootFiles = Array.isArray(rootFileList?.files) ? rootFileList.files : Array.isArray(rootFileList) ? rootFileList : [];
        allVideoFiles = await getAllVideoFiles(shareURL, rootFiles, 0, new Set());
      } catch (e) {
        await OmniBox.log("warn", "[Echo4K][detail] 扫描网盘失败: " + e.message);
      }

      if (!allVideoFiles.length) {
        playSources.push({
          name: displayName,
          episodes: [{ name: item.label || "打开网盘", playId: "share|||" + encodeURIComponent(shareURL) }],
        });
        continue;
      }

      const dtLower = dt.toLowerCase();
      let sourceNames = [displayName];
      if (DRIVE_TYPE_CONFIG.includes(dtLower)) {
        sourceNames = filterSourceNamesForCaller(SOURCE_NAMES_CONFIG, source, context);
      }

      for (const sourceName of sourceNames) {
        const lineName = DRIVE_TYPE_CONFIG.includes(dtLower) ? (displayName + "-" + sourceName) : displayName;
        const episodes = dedupeEpisodes(allVideoFiles.map((file) => {
          const sizeText = formatFileSize(file.size);
          const episodeName = cleanText(String(file.file_name || "资源").replace(/\.[^.]+$/, "")) || "资源";
          const displayFileName = sizeText ? "[" + sizeText + "] " + file.file_name : file.file_name;
          const playMeta = encodePlayMeta({ sid: videoId, t: title, e: episodeName });
          const formattedFileId = shareURL + "|" + file.fid;
          if (file.fid && !filesForScraping.some((f) => f.fid === formattedFileId)) {
            filesForScraping.push({ file_name: episodeName, fid: formattedFileId, file_id: formattedFileId });
          }
          return {
            name: displayFileName,
            playId: playMeta ? (shareURL + "|" + file.fid + "|" + playMeta) : (shareURL + "|" + file.fid),
          };
        }));
        if (episodes.length) playSources.push({ name: lineName, episodes: episodes });
      }
    }

    if (groupMagnet.length) {
      const magnetEpisodes = groupMagnet.filter((m) => m.link && !m.link.includes("...")).map((m) => {
        const sizeText = m.sz ? formatFileSize(m.sz) : "";
        const epName = m.label || "磁力链接";
        const dn = sizeText ? "[" + sizeText + "] " + epName : epName;
        return { name: dn, playId: "magnet|||" + encodeURIComponent(m.link) };
      });
      if (magnetEpisodes.length) {
        playSources.push({ name: "磁力链接", episodes: magnetEpisodes });
      }
    }

    if (!playSources.length) {
      playSources.push({ name: "详情页", episodes: [{ name: "打开详情页", playId: "page|||" + encodeURIComponent(BASE_URL + "/") }] });
    }

    let sortedPlaySources = playSources;
    if (playSources.length > 1) sortedPlaySources = sortPlaySourcesByDriveOrder(playSources);

    const vodItem = {
      vod_id: videoId,
      vod_name: title,
      vod_pic: pic,
      vod_content: desc,
      vod_year: vod_year,
      vod_area: vod_area,
      vod_director: vod_director,
      vod_actor: vod_actor,
      vod_douban_score: score,
      vod_play_sources: sortedPlaySources,
    };

    if (filesForScraping.length > 0) {
      try {
        await OmniBox.processScraping(videoId, title, title, filesForScraping);
        const metadata = await OmniBox.getScrapeMetadata(videoId);
        const scrapeData = metadata?.scrapeData || null;
        const videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
        if (scrapeData || videoMappings.length > 0) {
          for (const src of vodItem.vod_play_sources || []) {
            for (const episode of src.episodes || []) {
              const playIdParts = String(episode.playId || "").split("|");
              const formattedId = String(playIdParts[0] || "") + "|" + String(playIdParts[1] || "");
              const matchedMapping = videoMappings.find((m) => m && m.fileId === formattedId);
              if (matchedMapping && scrapeData) {
                const newName = buildScrapedFileName(scrapeData, matchedMapping, String(episode.name || ""));
                if (newName && newName !== episode.name) episode.name = newName;
              }
            }
          }
          if (scrapeData) {
            if (scrapeData.title) vodItem.vod_name = scrapeData.title;
            if (scrapeData.posterPath) vodItem.vod_pic = "https://image.tmdb.org/t/p/w500" + scrapeData.posterPath;
            if (scrapeData.overview) vodItem.vod_content = scrapeData.overview;
            if (scrapeData.releaseDate) vodItem.vod_year = String(scrapeData.releaseDate).slice(0, 4);
            if (scrapeData.voteAverage) vodItem.vod_douban_score = Number(scrapeData.voteAverage).toFixed(1);
          }
        }
      } catch (error) {
        await OmniBox.log("warn", "[Echo4K][detail] 刮削失败: " + error.message);
      }
    }

    await OmniBox.log("info", "[Echo4K][detail] id=" + videoId + " title=" + title + " downloads=" + downloads.length + " sources=" + sortedPlaySources.length);
    return { list: [vodItem] };
  } catch (e) {
    await OmniBox.log("error", "[Echo4K][detail] " + e.message);
    return { list: [] };
  }
}
async function play(params, context) {
  try {
    const playId = String(params.playId || params.url || params.input || "").trim();
    const flag = String(params.flag || "").trim();
    const source = resolveCallerSource(params, context);

    if (!playId) return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };

    if (playId.startsWith("magnet|||")) {
      const magnetUrl = decodeURIComponent(playId.slice("magnet|||".length));
      const header = getHeaders(BASE_URL + "/");
      return { parse: 1, jx: 0, url: magnetUrl, urls: [{ name: "磁力链接", url: magnetUrl }], header: header, headers: header };
    }

    if (playId.startsWith("page|||")) {
      const pageUrl = decodeURIComponent(playId.slice("page|||".length));
      const header = getHeaders(pageUrl);
      return { parse: 1, jx: 0, url: pageUrl, urls: [{ name: "详情页", url: pageUrl }], header: header, headers: header };
    }

    if (playId.startsWith("share|||")) {
      const shareUrl = decodeURIComponent(playId.slice("share|||".length));
      const header = getHeaders(BASE_URL + "/");
      return { parse: 1, jx: 0, url: shareUrl, urls: [{ name: "打开网盘", url: shareUrl }], header: header, headers: header };
    }

    const idParts = playId.split("|");
    const shareURL = idParts[0] || "";
    let fileId = idParts[1] || "";
    const playMeta = idParts.length >= 3 ? decodePlayMeta(idParts[2] || "") : {};

    if (!shareURL) throw new Error("播放参数缺少分享链接");

    const routeType = resolveRouteType(flag, source, context);

    if (!fileId) {
      const rootFileList = await OmniBox.getDriveFileList(shareURL, "0");
      const rootFiles = Array.isArray(rootFileList?.files) ? rootFileList.files : Array.isArray(rootFileList) ? rootFileList : [];
      const files = await getAllVideoFiles(shareURL, rootFiles, 0, new Set());
      if (files.length) fileId = files[0].fid;
    }

    if (!fileId) {
      const header = getHeaders(BASE_URL + "/");
      return { parse: 1, jx: 0, url: shareURL, urls: [{ name: "打开网盘", url: shareURL }], header: header, headers: header };
    }

    const metadataPromise = (async () => {
      const result = { danmakuList: [], episodeName: playMeta.e || params.episodeName || "" };
      const vodId = String(playMeta.sid || params.vodId || params.videoId || "").trim();
      if (!vodId) return result;
      try {
        const metadata = await OmniBox.getScrapeMetadata(vodId);
        if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) return result;
        const formattedId = shareURL + "|" + fileId;
        const matchedMapping = metadata.videoMappings.find((m) => m && m.fileId === formattedId);
        const scrapeData = metadata.scrapeData || {};
        if (!matchedMapping) return result;
        if (matchedMapping.episodeName && !result.episodeName) result.episodeName = matchedMapping.episodeName;
        const fileName = buildScrapedFileName(scrapeData, matchedMapping, result.episodeName || "") || buildFileNameForDanmu(scrapeData.title || playMeta.t || "", result.episodeName || "");
        if (fileName) {
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
          if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) result.danmakuList = matchedDanmaku;
        }
      } catch (error) {
        await OmniBox.log("warn", "[Echo4K][play] 弹幕匹配失败: " + error.message);
      }
      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([
      OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType),
      metadataPromise,
    ]);

    if (playInfoResult.status !== "fulfilled") {
      throw new Error((playInfoResult.reason && playInfoResult.reason.message) || "网盘直链解析失败");
    }

    const playInfo = playInfoResult.value;
    if (!playInfo || !Array.isArray(playInfo.url) || !playInfo.url.length) {
      throw new Error("网盘直链解析结果为空");
    }

    const urls = playInfo.url.map((item) => ({ name: item.name || "播放", url: item.url }));

    let danmakuList = Array.isArray(playInfo.danmaku) ? playInfo.danmaku : [];
    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList?.length ? metadataResult.value.danmakuList : danmakuList;
    }

    const header = playInfo.header || {};

    await OmniBox.log("info", "[Echo4K][play] route=" + routeType + " share=" + shareURL + " fileId=" + fileId + " urls=" + urls.length);

    return {
      urls: urls,
      header: header,
      parse: 0,
      jx: 0,
      danmaku: danmakuList};
  } catch (e) {
    await OmniBox.log("error", "[Echo4K][play] " + e.message);
    return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
  }
}