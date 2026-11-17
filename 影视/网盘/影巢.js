// @name 影巢
// @author lampon
// @description
// @dependencies axios
// @version 1.1.17
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/影巢.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const axios = require("axios");

// ==================== 配置区域 ====================
// TMDB API Key（必填，优先使用 TMDB_API_KEY，其次兼容 TMDB_KEY）
const TMDB_API_KEY = process.env.TMDB_API_KEY || process.env.TMDB_KEY || "";
// Bearer token 模式（TMDB v3 亦可使用，curl 示例：Authorization: Bearer <token>）
// 你的 token 可能直接放到 TMDB_API_KEY 里（自动识别），也可以单独配置 TMDB_BEARER_TOKEN / TMDB_AUTH_TOKEN
const TMDB_BEARER_TOKEN =
  process.env.TMDB_BEARER_TOKEN ||
  process.env.TMDB_AUTH_TOKEN ||
  process.env.TMDB_ACCESS_TOKEN ||
  "";

// 强制认证模式（可选）："query" | "bearer"。不设置则自动判定。
const TMDB_AUTH_MODE = (process.env.TMDB_AUTH_MODE || "").toLowerCase();

// 语言/地区（用于接口返回的内容翻译；图片一般不受影响）
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || "zh-CN";
const TMDB_REGION = process.env.TMDB_REGION || "CN";

// TMDB API 基地址
const TMDB_API_BASE_URL =
  process.env.TMDB_API_BASE_URL || "https://api.tmdb.org/3";

// TMDB 图片基地址
const TMDB_IMAGE_BASE_URL =
  process.env.TMDB_IMAGE_BASE_URL || "https://image.tmdb.org/t/p";
const TMDB_IMAGE_POSTER_SIZE = process.env.TMDB_IMAGE_POSTER_SIZE || "w500"; // 海报

// 可选：代理图片是否走项目的 `/api/proxy/image`（当 context.baseURL 存在时自动走）
// HDHive 开放接口配置
const HDHIVE_API_BASE_URL =
  process.env.HDHIVE_API_BASE_URL || "https://hdhive.com/api/open";
// 新版认证支持应用密钥与 OAuth 用户令牌，可单独配置或同时配置
const HDHIVE_API_KEY = process.env.HDHIVE_API_KEY || "";
const HDHIVE_ACCESS_TOKEN = process.env.HDHIVE_ACCESS_TOKEN || "";
// 公共上游 HTTP 代理（可选，TMDB / HDHive 共用；示例：http://127.0.0.1:7890）
const UPSTREAM_HTTP_PROXY_URL = process.env.UPSTREAM_HTTP_PROXY_URL || process.env.HTTP_PROXY_URL || "";
// 兼容旧变量：若未配置公共代理，则 HDHive 仍可单独使用旧的 HDHIVE_PROXY_URL
const HDHIVE_PROXY_URL = process.env.HDHIVE_PROXY_URL || UPSTREAM_HTTP_PROXY_URL || "";
// PanCheck 配置（可选）
const PANCHECK_API = process.env.PANCHECK_API || "";
const PANCHECK_ENABLED = true;
const PANCHECK_PLATFORMS = process.env.PANCHECK_PLATFORMS || "quark";
// HDHive /resources/unlock 限流配置（接口级别）
// 默认：1 分钟窗口内最多 3 次；第 4 次起直接短路，不再实际请求。
const HDHIVE_UNLOCK_RATE_LIMIT_ENABLED = String(process.env.HDHIVE_UNLOCK_RATE_LIMIT_ENABLED || "true").toLowerCase() === "true";
const HDHIVE_UNLOCK_RATE_LIMIT_WINDOW_MS = Number(process.env.HDHIVE_UNLOCK_RATE_LIMIT_WINDOW_MS || 60 * 1000);
const HDHIVE_UNLOCK_RATE_LIMIT_MAX_CALLS = Number(process.env.HDHIVE_UNLOCK_RATE_LIMIT_MAX_CALLS || 3);
const HDHIVE_UNLOCK_RATE_LIMIT_CACHE_KEY = process.env.HDHIVE_UNLOCK_RATE_LIMIT_CACHE_KEY || "yingchao:hdhive:unlock-rate-limit";
// HDHive 任意接口 429 冷却配置（全局接口级别）
const HDHIVE_API_COOLDOWN_CACHE_KEY = process.env.HDHIVE_API_COOLDOWN_CACHE_KEY || "yingchao:hdhive:api-cooldown";
const HDHIVE_API_COOLDOWN_DEFAULT_SECONDS = Number(process.env.HDHIVE_API_COOLDOWN_DEFAULT_SECONDS || 300);
const HDHIVE_RESOURCES_CACHE_PREFIX = process.env.HDHIVE_RESOURCES_CACHE_PREFIX || "yingchao:hdhive:resources";
const HDHIVE_RESOURCES_CACHE_TTL_SECONDS = Number(process.env.HDHIVE_RESOURCES_CACHE_TTL_SECONDS || 24 * 60 * 60);
const HDHIVE_UNLOCK_CACHE_PREFIX = process.env.HDHIVE_UNLOCK_CACHE_PREFIX || "yingchao:hdhive:unlock";
const HDHIVE_UNLOCK_CACHE_TTL_SECONDS = Number(process.env.HDHIVE_UNLOCK_CACHE_TTL_SECONDS || 30 * 24 * 60 * 60);
// 读取环境变量：支持多个网盘类型，用分号分割；仅这些网盘类型启用多线路
const DRIVE_TYPE_CONFIG = (process.env.DRIVE_TYPE_CONFIG || "quark;uc")
  .split(";")
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean);
// 读取环境变量：线路名称和顺序，用分号分割
const SOURCE_NAMES_CONFIG = (process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
// 读取环境变量：详情页播放线路的网盘排序顺序。仅作用于 detail() 里的播放线路。
const DRIVE_ORDER = (process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan")
  .split(";")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
// ==================== 配置区域结束 ====================

let tmdbKeyCache = "";
let tmdbAuthCache = null;

function looksLikeBearerToken(value) {
  if (!value) return false;
  const s = String(value).trim();
  // Bearer token/jwt 通常包含 '.' 分段
  return s.includes(".") || s.startsWith("eyJ");
}

// 导出接口
module.exports = {
  home,
  category,
  search,
  // detail/play 先给出空实现，避免你先测试首页/分类就无法点播（后续你再指导细化）
  detail,
  play,
};

// 使用公共 runner 处理标准输入/输出
runner.run(module.exports);

async function getTMDBAuth() {
  // 返回 { mode: "query"|"bearer", value: string }
  if (tmdbAuthCache) return tmdbAuthCache;

  // OmniBox 脚本环境变量优先走 getEnv（后台“环境变量”表里配置）
  const fetchEnvCandidates = async (names) => {
    for (const name of names) {
      try {
        const v = await OmniBox.getEnv(name);
        if (v) return v;
      } catch {
        // ignore
      }
    }
    return "";
  };

  // 1) 强制模式优先
  if (TMDB_AUTH_MODE === "bearer") {
    const bearerFromProc = TMDB_BEARER_TOKEN || "";
    const bearerFromEnv = bearerFromProc
      ? ""
      : await fetchEnvCandidates([
          "TMDB_BEARER_TOKEN",
          "TMDB_AUTH_TOKEN",
          "TMDB_ACCESS_TOKEN",
          "TMDB_BEARER",
          "tmdb_bearer_token",
        ]);
    // bearer 兜底：允许你把 Bearer token 直接填到 TMDB_API_KEY 里
    const apiKeyOrTokenFromProc = TMDB_API_KEY || process.env.TMDB_KEY || "";
    const apiKeyOrTokenFromEnv = apiKeyOrTokenFromProc
      ? ""
      : await fetchEnvCandidates([
          "TMDB_API_KEY",
          "TMDB_KEY",
          "tmdb_api_key",
          "tmdb_api_key_v3",
        ]);
    const apiKeyOrToken = (
      apiKeyOrTokenFromProc ||
      apiKeyOrTokenFromEnv ||
      tmdbKeyCache ||
      ""
    )
      .toString()
      .trim();
    const bearer = (bearerFromProc || bearerFromEnv || apiKeyOrToken || "")
      .toString()
      .trim();
    if (bearer) {
      tmdbAuthCache = { mode: "bearer", value: bearer };
      return tmdbAuthCache;
    }
    throw new Error(
      "TMDB 认证模式=bearer 但未找到 Bearer token（请配置 TMDB_BEARER_TOKEN/TMDB_AUTH_TOKEN）。",
    );
  }

  if (TMDB_AUTH_MODE === "query") {
    const apiKeyFromProc = TMDB_API_KEY || "";
    const apiKeyFromEnv = apiKeyFromProc
      ? ""
      : await fetchEnvCandidates([
          "TMDB_API_KEY",
          "TMDB_KEY",
          "tmdb_api_key",
          "tmdb_api_key_v3",
        ]);
    const apiKey = (apiKeyFromProc || apiKeyFromEnv || tmdbKeyCache || "")
      .toString()
      .trim();
    if (apiKey) {
      tmdbAuthCache = { mode: "query", value: apiKey };
      return tmdbAuthCache;
    }
    throw new Error(
      "TMDB 认证模式=query 但未找到 api_key（请配置 TMDB_API_KEY/TMDB_KEY）。",
    );
  }

  // 2) 自动判定
  // 2.1 优先找 bearer token
  const bearerFromProc = (TMDB_BEARER_TOKEN || "").trim();
  const bearerFromEnv = bearerFromProc
    ? ""
    : await fetchEnvCandidates([
        "TMDB_BEARER_TOKEN",
        "TMDB_AUTH_TOKEN",
        "TMDB_ACCESS_TOKEN",
        "TMDB_BEARER",
        "tmdb_bearer_token",
      ]);
  const bearer = (bearerFromProc || bearerFromEnv).trim();
  if (bearer && looksLikeBearerToken(bearer)) {
    tmdbAuthCache = { mode: "bearer", value: bearer };
    return tmdbAuthCache;
  }

  // 2.2 再用 TMDB_API_KEY 做兜底，支持：它可能其实就是 bearer token
  let apiKeyOrToken = (TMDB_API_KEY || "").trim();
  if (!apiKeyOrToken) {
    apiKeyOrToken = (
      await fetchEnvCandidates([
        "TMDB_API_KEY",
        "TMDB_KEY",
        "tmdb_api_key",
        "tmdb_api_key_v3",
      ])
    ).trim();
  }
  if (!apiKeyOrToken) {
    // 不要泄露完整 key，只提示是否存在
    throw new Error(
      "TMDB Key/Token 未配置：请设置 TMDB_API_KEY（query 模式）或 TMDB_BEARER_TOKEN/TMDB_AUTH_TOKEN（bearer 模式）。",
    );
  }

  if (looksLikeBearerToken(apiKeyOrToken)) {
    tmdbAuthCache = { mode: "bearer", value: apiKeyOrToken };
  } else {
    tmdbAuthCache = { mode: "query", value: apiKeyOrToken };
  }
  return tmdbAuthCache;
}

function safeString(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s === "<nil>" ? "" : s;
}

function extractYear(dateStr) {
  const s = safeString(dateStr);
  const m = s.match(/^(\d{4})/);
  return m ? m[1] : "";
}

function buildPosterUrl(posterPath, size = TMDB_IMAGE_POSTER_SIZE) {
  const p = safeString(posterPath).trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  const normalizedPath = p.startsWith("/") ? p : `/${p}`;
  return `${TMDB_IMAGE_BASE_URL}/${size}${normalizedPath}`;
}

function takeFirstNonEmpty(...values) {
  for (const value of values) {
    const text = safeString(value).trim();
    if (text) return text;
  }
  return "";
}

function buildPeopleNames(items, limit = 5) {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) => takeFirstNonEmpty(item?.name, item?.original_name, item?.character))
    .filter(Boolean)
    .slice(0, limit)
    .join(",");
}

function buildDirectorNames(crew, limit = 3) {
  if (!Array.isArray(crew)) return "";
  return crew
    .filter(
      (person) => person?.job === "Director" || person?.department === "Directing",
    )
    .map((person) => takeFirstNonEmpty(person?.name, person?.original_name))
    .filter(Boolean)
    .slice(0, limit)
    .join(",");
}

function buildGenreNames(genres, limit = 4) {
  if (!Array.isArray(genres)) return "";
  return genres
    .map((genre) => takeFirstNonEmpty(genre?.name))
    .filter(Boolean)
    .slice(0, limit)
    .join("/");
}

function buildOriginNames(scrapeData, limit = 3) {
  if (!scrapeData || typeof scrapeData !== "object") return "";
  const countryCandidates = [
    ...(Array.isArray(scrapeData.productionCountries)
      ? scrapeData.productionCountries.map((item) => item?.name)
      : []),
    ...(Array.isArray(scrapeData.originCountry)
      ? scrapeData.originCountry
      : []),
    ...(Array.isArray(scrapeData.origin_country)
      ? scrapeData.origin_country
      : []),
  ];
  return countryCandidates
    .map((item) => safeString(item).trim())
    .filter(Boolean)
    .slice(0, limit)
    .join("/");
}

function buildLanguageNames(scrapeData, limit = 3) {
  if (!scrapeData || typeof scrapeData !== "object") return "";
  const languageCandidates = [
    ...(Array.isArray(scrapeData.spokenLanguages)
      ? scrapeData.spokenLanguages.map((item) => item?.name)
      : []),
    ...(Array.isArray(scrapeData.spoken_languages)
      ? scrapeData.spoken_languages.map((item) => item?.name)
      : []),
  ];
  return languageCandidates
    .map((item) => safeString(item).trim())
    .filter(Boolean)
    .slice(0, limit)
    .join("/");
}

function getSharedProxyUrl() {
  return safeString(UPSTREAM_HTTP_PROXY_URL).trim();
}

function buildAxiosProxyConfig(proxyUrl, logLabel = "上游") {
  const raw = safeString(proxyUrl).trim();
  if (!raw) {
    return { proxy: false, normalized: "" };
  }
  try {
    const parsedUrl = new URL(raw);
    const proxy = {
      protocol: parsedUrl.protocol.replace(":", ""),
      host: parsedUrl.hostname,
      port: parsedUrl.port
        ? Number(parsedUrl.port)
        : parsedUrl.protocol === "https:"
          ? 443
          : 80,
    };
    if (parsedUrl.username || parsedUrl.password) {
      proxy.auth = {
        username: decodeURIComponent(parsedUrl.username || ""),
        password: decodeURIComponent(parsedUrl.password || ""),
      };
    }
    const normalized = `${parsedUrl.protocol}//${parsedUrl.hostname}:${proxy.port}`;
    return { proxy, normalized };
  } catch (error) {
    throw new Error(`${logLabel}代理地址无效: ${error.message}`);
  }
}

function pickScrapeDetailFields(payload = {}, scrapeData = {}, fallback = {}) {
  const releaseDate = takeFirstNonEmpty(scrapeData?.releaseDate, scrapeData?.release_date);
  const voteAverageRaw =
    scrapeData?.voteAverage ?? scrapeData?.vote_average ?? fallback?.voteAverage ?? fallback?.vote_average;
  const actors = takeFirstNonEmpty(
    buildPeopleNames(scrapeData?.credits?.cast, 5),
    fallback?.vod_actor,
  );
  const directors = takeFirstNonEmpty(
    buildDirectorNames(scrapeData?.credits?.crew, 3),
    fallback?.vod_director,
  );
  const genres = takeFirstNonEmpty(
    buildGenreNames(scrapeData?.genres, 4),
    safeString(fallback?.type_name),
  );
  const area = takeFirstNonEmpty(buildOriginNames(scrapeData, 3), fallback?.vod_area);
  const language = takeFirstNonEmpty(
    buildLanguageNames(scrapeData, 3),
    fallback?.vod_lang,
  );

  let score = safeString(fallback?.vod_douban_score);
  if (!score && voteAverageRaw !== null && voteAverageRaw !== undefined && voteAverageRaw !== "") {
    const scoreNum = Number(voteAverageRaw);
    if (Number.isFinite(scoreNum) && scoreNum > 0) {
      score = scoreNum.toFixed(1);
    }
  }

  return {
    vodName: takeFirstNonEmpty(payload.title, scrapeData?.title, scrapeData?.name),
    vodPic: takeFirstNonEmpty(
      buildPosterUrl(payload.posterPath),
      buildPosterUrl(scrapeData?.posterPath),
      buildPosterUrl(scrapeData?.poster_path),
      fallback?.vod_pic,
    ),
    vodYear: takeFirstNonEmpty(payload.year, extractYear(releaseDate), fallback?.vod_year),
    vodContent: takeFirstNonEmpty(
      scrapeData?.overview,
      payload.remark,
      fallback?.vod_content,
    ),
    vodActor: actors,
    vodDirector: directors,
    vodArea: area,
    vodLang: language,
    typeName: genres,
    vodDoubanScore: score,
  };
}

function normalizeScrapeKeyword(keyword) {
  let s = safeString(keyword).trim();
  if (!s) return s;
  // 去除结尾年份，如：
  // "实习医生格蕾 (2005)" / "实习医生格蕾（2005）" / "Grey's Anatomy 2005"
  s = s
    .replace(/\s*[（(]\s*(19|20)\d{2}\s*[）)]\s*$/u, "")
    .replace(/\s+(19|20)\d{2}\s*$/u, "")
    .trim();
  return s;
}

function buildTmdbLink(mediaType, id) {
  if (!mediaType || !id) return "";
  if (mediaType === "movie") return `https://www.themoviedb.org/movie/${id}`;
  if (mediaType === "tv") return `https://www.themoviedb.org/tv/${id}`;
  return "";
}

function buildPoster(context, posterPath) {
  const p = safeString(posterPath);
  if (!p) return "";

  // 直接返回 TMDB 图片地址，不通过 `/api/proxy/image`。
  // 前端 `img` 组件通常不需要额外请求转发。
  return `${TMDB_IMAGE_BASE_URL}/${TMDB_IMAGE_POSTER_SIZE}${p}`;
}

function getArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [];
}

function asInt(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function getTypeNameByMediaType(mediaType) {
  return mediaType === "movie" ? "电影资源" : "剧集资源";
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
    const aBase = String(a?.baseSourceName || a?.name || "");
    const bBase = String(b?.baseSourceName || b?.name || "");
    const aType = inferDriveTypeFromSourceName(aBase);
    const bType = inferDriveTypeFromSourceName(bBase);
    const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });
}

function normalizeEpisodeKeyword(value) {
  return safeString(value)
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[【】\[\]()（）._\-]/g, "");
}

function pickBestEpisodeFile(files = [], episodeName = "") {
  if (!Array.isArray(files) || files.length === 0) return null;
  const keyword = normalizeEpisodeKeyword(episodeName);
  if (keyword) {
    const matched = files.find((file) =>
      normalizeEpisodeKeyword(file?.episodeName || file?.file_name).includes(keyword),
    );
    if (matched) return matched;
  }
  return files[0] || null;
}

function sanitizeLegacyPlayText(value) {
  return safeString(value).replace(/[#$]/g, " ").trim();
}

function buildLegacyPlayFields(playSources = []) {
  if (!Array.isArray(playSources) || playSources.length === 0) {
    return { vod_play_from: "", vod_play_url: "" };
  }

  const vodPlayFrom = [];
  const vodPlayUrl = [];

  for (const source of playSources) {
    const sourceName = sanitizeLegacyPlayText(source?.name || "默认线路") || "默认线路";
    const episodes = Array.isArray(source?.episodes) ? source.episodes : [];
    const episodeItems = episodes
      .map((episode, index) => {
        const epName = sanitizeLegacyPlayText(episode?.name || episode?.episodeName || `第${index + 1}集`) || `第${index + 1}集`;
        const playId = safeString(episode?.playId || "");
        if (!playId) return "";
        return `${epName}$${playId}`;
      })
      .filter(Boolean);

    if (episodeItems.length > 0) {
      vodPlayFrom.push(sourceName);
      vodPlayUrl.push(episodeItems.join("#"));
    }
  }

  return {
    vod_play_from: vodPlayFrom.join("$$$"),
    vod_play_url: vodPlayUrl.join("$$$"),
  };
}

function isVideoFile(file) {
  if (!file || !file.file_name) return false;
  const fileName = String(file.file_name).toLowerCase();
  const exts = [
    ".mp4",
    ".mkv",
    ".avi",
    ".flv",
    ".mov",
    ".wmv",
    ".m3u8",
    ".ts",
    ".webm",
    ".m4v",
  ];
  if (exts.some((ext) => fileName.endsWith(ext))) return true;

  if (file.format_type) {
    const t = String(file.format_type).toLowerCase();
    if (
      t.includes("video") ||
      t.includes("mpeg") ||
      t.includes("h264") ||
      t.includes("h265")
    )
      return true;
  }
  return false;
}

async function getAllVideoFiles(shareURL, files) {
  const result = [];
  for (const file of files || []) {
    if (file.file && isVideoFile(file)) {
      result.push(file);
      continue;
    }
    if (file.dir) {
      try {
        const sub = await OmniBox.getDriveFileList(shareURL, file.fid);
        if (sub && Array.isArray(sub.files)) {
          const subVideos = await getAllVideoFiles(shareURL, sub.files);
          result.push(...subVideos);
        }
      } catch (error) {
        await OmniBox.log("warn", `tmdb.js 获取子目录失败: ${error.message}`);
      }
    }
  }
  return result;
}

function formatFileSize(size) {
  if (!size || size <= 0) return "";
  const unit = 1024;
  const units = ["B", "K", "M", "G", "T"];
  let n = size;
  let idx = 0;
  while (n >= unit && idx < units.length - 1) {
    n /= unit;
    idx++;
  }
  if (n === Math.floor(n)) return `${Math.floor(n)}${units[idx]}`;
  return `${n.toFixed(2)}${units[idx]}`;
}

function parseTmdbFolderId(categoryId) {
  // 形如 tmdb_tv_154385 / tmdb_movie_550
  const m = safeString(categoryId).match(/^tmdb_(movie|tv)_(\d+)$/);
  if (!m) return null;
  return { mediaType: m[1], tmdbId: m[2] };
}

function parseHDHivePanFolderId(categoryId) {
  // 形如 hdhive_pan|movie|550|quark
  const s = safeString(categoryId);
  const parts = s.split("|");
  if (parts.length !== 4) return null;
  if (parts[0] !== "hdhive_pan") return null;
  const mediaType = safeString(parts[1]);
  const tmdbId = safeString(parts[2]);
  const panType = safeString(parts[3]);
  if (!mediaType || !tmdbId || !panType) return null;
  return { mediaType, tmdbId, panType };
}

const PAN_PICS = {
  aliyun:
    "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/ali.jpg",
  quark:
    "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/quark.png",
  uc: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/uc.png",
  pikpak:
    "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/pikpak.jpg",
  xunlei:
    "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/thunder.png",
  123: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/123.png",
  tianyi:
    "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/189.png",
  mobile:
    "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/139.jpg",
  115: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/115.jpg",
  baidu:
    "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/baidu.jpg",
};

const PAN_NAMES = {
  quark: "夸克网盘",
  uc: "UC网盘",
  pikpak: "PikPak",
  tianyi: "天翼网盘",
  mobile: "移动云盘",
  115: "115网盘",
  baidu: "百度网盘",
  aliyun: "阿里云盘",
  xunlei: "迅雷网盘",
  123: "123网盘",
  pan123: "123网盘",
  189: "天翼网盘",
};

function normalizePanType(rawPanType) {
  const raw = safeString(rawPanType).toLowerCase();
  if (!raw) return "";
  if (raw.includes("aliyun") || raw.includes("ali") || raw.includes("阿里"))
    return "aliyun";
  if (raw.includes("baidu") || raw.includes("百度")) return "baidu";
  if (raw.includes("tianyi") || raw.includes("天翼") || raw === "189")
    return "tianyi";
  if (raw.includes("quark") || raw.includes("夸克")) return "quark";
  if (raw === "uc" || raw.includes("uc")) return "uc";
  if (raw.includes("115")) return "115";
  if (raw.includes("xunlei") || raw.includes("迅雷")) return "xunlei";
  if (raw.includes("mobile") || raw.includes("cmcc") || raw.includes("139"))
    return "mobile";
  if (raw.includes("pan123") || raw === "123" || raw.includes("123"))
    return "123";
  return raw;
}

function getPanName(panType) {
  return PAN_NAMES[panType] || `${panType} 网盘`;
}

function getPanIcon(panType) {
  return PAN_PICS[panType] || "";
}

const TMDB_MOVIE_GENRES = {
  action: 28,
  adventure: 12,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  fantasy: 14,
  history: 36,
  horror: 27,
  music: 10402,
  mystery: 9648,
  romance: 10749,
  science_fiction: 878,
  tv_movie: 10770,
  thriller: 53,
  war: 10752,
  western: 37,
};

const TMDB_TV_GENRES = {
  action_adventure: 10759,
  animation: 16,
  comedy: 35,
  crime: 80,
  documentary: 99,
  drama: 18,
  family: 10751,
  kids: 10762,
  mystery: 9648,
  news: 10763,
  reality: 10764,
  sci_fi_fantasy: 10765,
  soap: 10766,
  talk: 10767,
  war_politics: 10768,
  western: 37,
};

const TMDB_REGION_MAP = {
  all: "",
  cn: "CN",
  us: "US",
  jp: "JP",
  kr: "KR",
  hk: "HK",
  tw: "TW",
  gb: "GB",
  fr: "FR",
  de: "DE",
  in: "IN",
  th: "TH",
};

function buildDiscoverSort(sortValue, mediaType) {
  if (sortValue === "score") return "vote_average.desc";
  if (sortValue === "time") {
    return mediaType === "movie" ? "release_date.desc" : "first_air_date.desc";
  }
  return "popularity.desc";
}

function buildDiscoverFilters(mediaType, filters = {}) {
  const q = {};
  const genre = safeString(filters.genre || "");
  const region = safeString(filters.region || "");
  const year = safeString(filters.year || "");
  const sort = safeString(filters.sort || "hot");

  if (genre) {
    const gid =
      mediaType === "movie"
        ? TMDB_MOVIE_GENRES[genre] || ""
        : TMDB_TV_GENRES[genre] || "";
    if (gid) q.with_genres = gid;
  }

  if (region) {
    const rc = TMDB_REGION_MAP[region] || "";
    if (rc) {
      q.with_origin_country = rc;
    }
  }

  if (year) {
    if (/^\d{4}$/.test(year)) {
      if (mediaType === "movie") q.primary_release_year = year;
      else q.first_air_date_year = year;
    } else if (/^\d{4}s$/.test(year)) {
      const startYear = year.slice(0, 4);
      const endYear = String(Number(startYear) + 9);
      if (mediaType === "movie") {
        q["primary_release_date.gte"] = `${startYear}-01-01`;
        q["primary_release_date.lte"] = `${endYear}-12-31`;
      } else {
        q["first_air_date.gte"] = `${startYear}-01-01`;
        q["first_air_date.lte"] = `${endYear}-12-31`;
      }
    }
  }

  q.sort_by = buildDiscoverSort(sort, mediaType);
  return q;
}

async function checkLinksWithPanCheck(links) {
  if (
    !PANCHECK_ENABLED ||
    !PANCHECK_API ||
    !Array.isArray(links) ||
    links.length === 0
  ) {
    return new Set();
  }

  try {
    const body = {
      links: links,
    };

    if (PANCHECK_PLATFORMS) {
      const platforms = PANCHECK_PLATFORMS.split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (platforms.length > 0) {
        body.selected_platforms = platforms;
      }
    }

    const apiUrl = PANCHECK_API.replace(/\/$/, "");
    const checkURL = `${apiUrl}/api/v1/links/check`;
    const response = await OmniBox.request(checkURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "OmniBox-TMDB-Spider/1.0",
      },
      body: JSON.stringify(body),
    });

    if (response.statusCode !== 200 || !response.body) {
      await OmniBox.log(
        "warn",
        `tmdb.js PanCheck 请求失败: status=${response.statusCode}`,
      );
      return new Set();
    }

    const data = JSON.parse(response.body);
    return new Set(getArray(data?.invalid_links));
  } catch (error) {
    await OmniBox.log("warn", `tmdb.js PanCheck 异常: ${error.message}`);
    return new Set();
  }
}

async function getHDHiveRateLimitState() {
  try {
    const raw = await OmniBox.getCache(HDHIVE_UNLOCK_RATE_LIMIT_CACHE_KEY);
    if (!raw) return { startedAt: Date.now(), count: 0 };
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const startedAt = Number(parsed?.startedAt || 0);
    const count = Number(parsed?.count || 0);
    if (!startedAt || Date.now() - startedAt >= HDHIVE_UNLOCK_RATE_LIMIT_WINDOW_MS) {
      return { startedAt: Date.now(), count: 0 };
    }
    return { startedAt, count };
  } catch (_) {
    return { startedAt: Date.now(), count: 0 };
  }
}

async function markHDHiveRateLimitHit() {
  const state = await getHDHiveRateLimitState();
  const next = { startedAt: state.startedAt, count: state.count + 1 };
  const ttlSeconds = Math.max(1, Math.ceil((HDHIVE_UNLOCK_RATE_LIMIT_WINDOW_MS - (Date.now() - next.startedAt)) / 1000));
  try {
    await OmniBox.setCache(HDHIVE_UNLOCK_RATE_LIMIT_CACHE_KEY, JSON.stringify(next), ttlSeconds);
  } catch (_) {
    // ignore
  }
  return next;
}

function toPositiveInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

async function getHDHiveApiCooldownState() {
  try {
    const raw = await OmniBox.getCache(HDHIVE_API_COOLDOWN_CACHE_KEY);
    if (!raw) return null;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const until = Number(parsed?.until || 0);
    if (!until || until <= Date.now()) {
      try {
        await OmniBox.deleteCache(HDHIVE_API_COOLDOWN_CACHE_KEY);
      } catch (_) {
        // ignore
      }
      return null;
    }
    return {
      until,
      retryAfterSeconds: toPositiveInt(parsed?.retryAfterSeconds, Math.ceil((until - Date.now()) / 1000)),
      path: safeString(parsed?.path),
      method: safeString(parsed?.method || "GET") || "GET",
      scope: safeString(parsed?.scope),
      code: safeString(parsed?.code),
      message: safeString(parsed?.message),
    };
  } catch (_) {
    return null;
  }
}

async function setHDHiveApiCooldown(info = {}) {
  const retryAfterSeconds = Math.max(
    1,
    toPositiveInt(info?.retryAfterSeconds, HDHIVE_API_COOLDOWN_DEFAULT_SECONDS),
  );
  const until = Date.now() + retryAfterSeconds * 1000;
  const payload = {
    until,
    retryAfterSeconds,
    path: safeString(info?.path),
    method: safeString(info?.method || "GET") || "GET",
    scope: safeString(info?.scope),
    code: safeString(info?.code),
    message: safeString(info?.message),
  };
  try {
    await OmniBox.setCache(
      HDHIVE_API_COOLDOWN_CACHE_KEY,
      JSON.stringify(payload),
      retryAfterSeconds,
    );
  } catch (_) {
    // ignore
  }
  return payload;
}

async function clearHDHiveApiCooldown() {
  try {
    await OmniBox.deleteCache(HDHIVE_API_COOLDOWN_CACHE_KEY);
  } catch (_) {
    // ignore
  }
}

function buildHDHiveCooldownMessage(state, fallbackPath = "") {
  const remainSeconds = Math.max(
    1,
    toPositiveInt(
      state?.retryAfterSeconds,
      Math.ceil((Number(state?.until || 0) - Date.now()) / 1000),
    ),
  );
  const scopeLabel = safeString(state?.scope) || "接口";
  const message = safeString(state?.message) || "HDHive 接口触发 429 冷却";
  const pathText = safeString(state?.path || fallbackPath);
  return `${message}，限制对象=${scopeLabel}，Retry-After=${remainSeconds}s${pathText ? `，跳过 ${pathText}` : ""}`;
}

async function buildHDHiveRateLimitedResult(state, fallbackPath = "") {
  const message = buildHDHiveCooldownMessage(state, fallbackPath);
  await OmniBox.log("warn", message);
  return {
    success: false,
    data: null,
    message,
    code: safeString(state?.code) || "429",
    rateLimited: true,
    retryAfterSeconds: Math.max(
      1,
      toPositiveInt(
        state?.retryAfterSeconds,
        Math.ceil((Number(state?.until || 0) - Date.now()) / 1000),
      ),
    ),
    limitScope: safeString(state?.scope),
  };
}

function buildHDHiveResourcesCacheKey(mediaType, tmdbId) {
  return `${HDHIVE_RESOURCES_CACHE_PREFIX}:${safeString(mediaType).toLowerCase()}:${safeString(tmdbId)}`;
}

function buildHDHiveUnlockCacheKey(slug) {
  return `${HDHIVE_UNLOCK_CACHE_PREFIX}:${safeString(slug)}`;
}

async function getHDHiveUnlockCached(slug) {
  const normalizedSlug = safeString(slug);
  if (!normalizedSlug) {
    throw new Error("HDHive unlock 缓存参数不完整");
  }

  const cacheKey = buildHDHiveUnlockCacheKey(normalizedSlug);
  try {
    const raw = await OmniBox.getCache(cacheKey);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      await OmniBox.log("info", `HDHive unlock 缓存命中: slug=${normalizedSlug}`);
      return {
        success: true,
        cached: true,
        ...(parsed && typeof parsed === "object" ? parsed : {}),
      };
    }
  } catch (error) {
    await OmniBox.log(
      "warn",
      `HDHive unlock 读缓存失败: slug=${normalizedSlug} error=${error.message}`,
    );
  }

  const resp = await requestHDHive("/resources/unlock", "POST", {
    slug: normalizedSlug,
  });

  if (resp?.rateLimited) return resp;

  const payload = {
    success: resp?.success !== false,
    data: resp?.data && typeof resp.data === "object" ? resp.data : {},
    message: safeString(resp?.message),
    code: safeString(resp?.code),
  };

  try {
    await OmniBox.setCache(
      cacheKey,
      JSON.stringify(payload),
      Math.max(1, toPositiveInt(HDHIVE_UNLOCK_CACHE_TTL_SECONDS, 30 * 24 * 60 * 60)),
    );
    await OmniBox.log("info", `HDHive unlock 已写缓存: slug=${normalizedSlug}`);
  } catch (error) {
    await OmniBox.log(
      "warn",
      `HDHive unlock 写缓存失败: slug=${normalizedSlug} error=${error.message}`,
    );
  }

  return {
    ...payload,
    cached: false,
  };
}

async function getHDHiveResourcesCached(mediaType, tmdbId) {
  const normalizedMediaType = safeString(mediaType).toLowerCase();
  const normalizedTmdbId = safeString(tmdbId);
  if (!normalizedMediaType || !normalizedTmdbId) {
    throw new Error("HDHive resources 缓存参数不完整");
  }

  const cacheKey = buildHDHiveResourcesCacheKey(
    normalizedMediaType,
    normalizedTmdbId,
  );

  try {
    const raw = await OmniBox.getCache(cacheKey);
    if (raw) {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      const resources = getArray(parsed?.data);
      const meta = parsed?.meta && typeof parsed.meta === "object" ? parsed.meta : {};
      await OmniBox.log(
        "info",
        `HDHive resources 缓存命中: mediaType=${normalizedMediaType} tmdbId=${normalizedTmdbId} count=${resources.length}`,
      );
      return {
        success: true,
        data: resources,
        meta,
        cached: true,
      };
    }
  } catch (error) {
    await OmniBox.log(
      "warn",
      `HDHive resources 读缓存失败: mediaType=${normalizedMediaType} tmdbId=${normalizedTmdbId} error=${error.message}`,
    );
  }

  const resp = await requestHDHive(
    `/resources/${normalizedMediaType}/${normalizedTmdbId}`,
    "GET",
  );

  if (resp?.rateLimited) return resp;

  const payload = {
    data: getArray(resp?.data),
    meta: resp?.meta && typeof resp.meta === "object" ? resp.meta : {},
  };

  try {
    await OmniBox.setCache(
      cacheKey,
      JSON.stringify(payload),
      Math.max(1, toPositiveInt(HDHIVE_RESOURCES_CACHE_TTL_SECONDS, 24 * 60 * 60)),
    );
    await OmniBox.log(
      "info",
      `HDHive resources 已写缓存: mediaType=${normalizedMediaType} tmdbId=${normalizedTmdbId} count=${payload.data.length}`,
    );
  } catch (error) {
    await OmniBox.log(
      "warn",
      `HDHive resources 写缓存失败: mediaType=${normalizedMediaType} tmdbId=${normalizedTmdbId} error=${error.message}`,
    );
  }

  return {
    success: true,
    data: payload.data,
    meta: payload.meta,
    cached: false,
  };
}

async function requestHDHive(path, method = "GET", bodyObj = null) {
  const apiKey = safeString(HDHIVE_API_KEY).trim();
  const accessToken = safeString(HDHIVE_ACCESS_TOKEN).trim();
  if (!apiKey && !accessToken) {
    throw new Error(
      "HDHive API Key/OAuth 用户令牌未配置：请设置 HDHIVE_API_KEY 或 HDHIVE_ACCESS_TOKEN",
    );
  }

  const cooldownState = await getHDHiveApiCooldownState();
  if (cooldownState) {
    return buildHDHiveRateLimitedResult(cooldownState, path);
  }

  if (path === "/resources/unlock" && HDHIVE_UNLOCK_RATE_LIMIT_ENABLED) {
    const rateState = await getHDHiveRateLimitState();
    if (rateState.count >= HDHIVE_UNLOCK_RATE_LIMIT_MAX_CALLS) {
      const message = `HDHive unlock 限流触发: ${Math.floor(HDHIVE_UNLOCK_RATE_LIMIT_WINDOW_MS / 1000)}秒内超过${HDHIVE_UNLOCK_RATE_LIMIT_MAX_CALLS}次，跳过请求 ${method} ${path}`;
      await OmniBox.log("warn", message);
      return { success: false, data: null, message, code: "429", rateLimited: true };
    }
    await markHDHiveRateLimitHit();
  }

  const url = `${HDHIVE_API_BASE_URL}${path}`;
  const headers = {
    Accept: "*/*",
    "Accept-Encoding": "gzip, deflate, br",
    Connection: "keep-alive",
    "User-Agent": "OmniBox-TMDB-Spider/1.0",
  };
  if (apiKey) headers["X-API-Key"] = apiKey;
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (method === "POST") headers["Content-Type"] = "application/json";

  await OmniBox.log("info", `HDHive 请求: ${method} ${path}`);
  const sharedProxyUrl = getSharedProxyUrl();
  const proxySource = safeString(UPSTREAM_HTTP_PROXY_URL).trim()
    ? "UPSTREAM_HTTP_PROXY_URL"
    : safeString(HDHIVE_PROXY_URL).trim()
      ? "HDHIVE_PROXY_URL"
      : "";
  // axios 代理配置（可选）
  let proxyConfig = false;
  if (sharedProxyUrl) {
    try {
      const parsedProxy = buildAxiosProxyConfig(sharedProxyUrl, "HDHive");
      proxyConfig = parsedProxy.proxy;
      await OmniBox.log(
        "info",
        `HDHive 启用代理: ${parsedProxy.normalized}${proxySource ? ` source=${proxySource}` : ""}`,
      );
    } catch (e) {
      await OmniBox.log(
        "warn",
        `${proxySource || "代理"} 无效，忽略代理: ${e.message}`,
      );
      proxyConfig = false;
    }
  }

  let resp;
  try {
    resp = await axios({
      url,
      method: method.toLowerCase(),
      headers,
      data: bodyObj || undefined,
      timeout: 20000,
      proxy: proxyConfig,
      // 让非2xx也返回响应体，便于统一打印日志与报错
      validateStatus: () => true,
      responseType: "text",
      maxRedirects: 5,
    });
  } catch (error) {
    throw new Error(`HDHive axios 请求失败: ${error.message}`);
  }

  const statusCode = Number(resp?.status || 0);
  const responseHeaders = resp?.headers || {};
  const contentType = safeString(
    responseHeaders["content-type"] || responseHeaders["Content-Type"],
  );
  const bodyStr =
    typeof resp?.data === "string"
      ? resp.data
      : JSON.stringify(resp?.data || "");
  const bodyPreview = bodyStr ? bodyStr.substring(0, 500) : "";

  await OmniBox.log(
    "info",
    `HDHive 响应: status=${statusCode}, contentType=${contentType || "unknown"}, bodyPreview=${JSON.stringify(bodyPreview)}`,
  );

  if (!bodyStr) {
    throw new Error(`HDHive 响应体为空: ${statusCode}`);
  }

  // 有些场景会返回 HTML（如被重定向到首页/拦截页），先做显式判断，便于快速定位
  if (/^\s*<!DOCTYPE\s+html/i.test(bodyStr) || /^\s*<html/i.test(bodyStr)) {
    throw new Error(`HDHive 返回了 HTML 页面（非 JSON），status=${statusCode}`);
  }

  let data;
  try {
    data = JSON.parse(bodyStr);
  } catch (e) {
    await OmniBox.log(
      "error",
      `HDHive JSON解析失败原文片段: ${JSON.stringify(bodyPreview)}`,
    );
    throw new Error(`HDHive JSON 解析失败: ${e.message}`);
  }

  if (statusCode === 429) {
    const retryAfterHeader =
      responseHeaders["retry-after"] || responseHeaders["Retry-After"];
    const retryAfterBody = data?.retry_after_seconds;
    const retryAfterSeconds = Math.max(
      1,
      toPositiveInt(retryAfterHeader, toPositiveInt(retryAfterBody, HDHIVE_API_COOLDOWN_DEFAULT_SECONDS)),
    );
    const limitScope = safeString(data?.limit_scope_label || data?.limit_scope || "");
    const code = safeString(data?.code || "429");
    const message = safeString(data?.message || data?.description || "HDHive 接口触发 429");
    const cooldown = await setHDHiveApiCooldown({
      retryAfterSeconds,
      path,
      method,
      scope: limitScope,
      code,
      message,
    });
    await OmniBox.log(
      "warn",
      `HDHive 429 冷却已写入: path=${path} retryAfter=${retryAfterSeconds}s scope=${limitScope || "unknown"} code=${code}`,
    );
    return buildHDHiveRateLimitedResult(cooldown, path);
  }

  await clearHDHiveApiCooldown();

  if (statusCode !== 200) {
    throw new Error(`HDHive HTTP ${statusCode}`);
  }
  if (data?.success === false) {
    throw new Error(`HDHive 业务失败: ${data?.message || "unknown"}`);
  }
  return data;
}

function encodeHDHiveVideoId(resource) {
  // detail 依赖 slug / mediaType / tmdbId / title / poster
  return JSON.stringify({
    source: "hdhive",
    slug: safeString(resource.slug),
    mediaType: safeString(resource.mediaType),
    tmdbId: safeString(resource.tmdbId),
    title: safeString(resource.title),
    posterPath: safeString(resource.posterPath),
    year: safeString(resource.year),
    remark: safeString(resource.remark),
  });
}

function buildHDHivePanFolderCategoryId(mediaType, tmdbId, panType) {
  return `hdhive_pan|${mediaType}|${tmdbId}|${panType}`;
}

function decodeHDHiveVideoId(videoId) {
  try {
    const parsed = JSON.parse(videoId);
    if (parsed && parsed.source === "hdhive" && parsed.slug) return parsed;
  } catch {
    // ignore
  }
  return null;
}

async function tmdbGet(path, queryParams = {}) {
  const tmdbAuth = await getTMDBAuth();

  const url = new URL(`${TMDB_API_BASE_URL}${path}`);
  // 支持两种认证：query api_key 或 header Authorization Bearer token
  if (tmdbAuth.mode === "query") {
    url.searchParams.set("api_key", tmdbAuth.value);
  }
  if (TMDB_LANGUAGE) url.searchParams.set("language", TMDB_LANGUAGE);
  if (TMDB_REGION) url.searchParams.set("region", TMDB_REGION);

  for (const [k, v] of Object.entries(queryParams)) {
    if (v === undefined || v === null || v === "") continue;
    url.searchParams.set(k, String(v));
  }

  // 记录关键请求信息（避免打印 api_key）
  try {
    const logParams = { ...(queryParams || {}) };
    // path/pageno/info 更利于定位
    await OmniBox.log(
      "info",
      `TMDB 请求: ${path} params=${JSON.stringify(logParams)} lang=${TMDB_LANGUAGE} region=${TMDB_REGION}`,
    );
  } catch {
    // 忽略日志异常
  }

  const sharedProxyUrl = getSharedProxyUrl();
  const axiosProxy = buildAxiosProxyConfig(sharedProxyUrl, "TMDB");
  if (axiosProxy.normalized) {
    await OmniBox.log("info", `TMDB 启用共享代理: ${axiosProxy.normalized}`);
  }

  let response;
  try {
    response = await axios({
      url: url.toString(),
      method: "get",
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
        ...(tmdbAuth.mode === "query"
          ? {}
          : { Authorization: `Bearer ${tmdbAuth.value}` }),
      },
      timeout: 20000,
      proxy: axiosProxy.proxy,
      responseType: "text",
      validateStatus: () => true,
      maxRedirects: 5,
    });
  } catch (error) {
    throw new Error(`TMDB axios 请求失败: ${error.message}`);
  }

  const bodyStr =
    typeof response.data === "string"
      ? response.data
      : String(response.data || "");
  if (!bodyStr) {
    throw new Error(`TMDB 响应体为空: ${response.status}`);
  }

  let data;
  try {
    data = JSON.parse(bodyStr);
  } catch (e) {
    throw new Error(`TMDB JSON解析失败: ${e.message}`);
  }

  if (response.status !== 200) {
    // TMDB 通常会有 status_message，如 Invalid API key / You must be granted access...
    const statusMessage = data?.status_message || "";
    try {
      await OmniBox.log(
        "warn",
        `TMDB 请求失败: ${path} http=${response.status} status_message=${statusMessage}`,
      );
    } catch {
      // ignore
    }
  }

  if (response.status !== 200) {
    const msg = data?.status_message || `HTTP ${response.status}`;
    throw new Error(`TMDB 请求失败: ${msg}`);
  }

  return data;
}

function toVodItem({
  context,
  mediaType,
  tmdbItem,
  groupTypeId,
  groupTypeName,
  remarks,
}) {
  const id = tmdbItem?.id;
  if (!id) return null;

  const vodName =
    mediaType === "movie"
      ? safeString(tmdbItem?.title)
      : safeString(tmdbItem?.name);
  const vodYear = extractYear(
    mediaType === "movie" ? tmdbItem?.release_date : tmdbItem?.first_air_date,
  );

  const voteAverage = tmdbItem?.vote_average;
  const vodScore =
    voteAverage === null || voteAverage === undefined
      ? ""
      : Number(voteAverage).toFixed(1);

  const tagline = safeString(tmdbItem?.tagline);
  const overview = safeString(tmdbItem?.overview);

  // subtitle：优先 tagline，避免 overview 太长
  let vodSubtitle = tagline;
  if (!vodSubtitle && overview) {
    vodSubtitle =
      overview.length > 45 ? `${overview.slice(0, 45).trim()}...` : overview;
  }

  return {
    vod_id: `tmdb_${mediaType}_${id}`,
    link: buildTmdbLink(mediaType, id),
    vod_name: vodName,
    vod_pic: buildPoster(context, tmdbItem?.poster_path),
    type_id: groupTypeId,
    type_name: groupTypeName,
    vod_remarks: safeString(remarks),
    vod_year: vodYear,
    vod_douban_score: vodScore,
    vod_subtitle: vodSubtitle || undefined,
  };
}

/**
 * 获取首页数据
 * @param {Object} params - 参数对象（空）
 * @param {Object} context - 请求上下文
 */
async function home(params, context) {
  try {
    const tmdbAuth = await getTMDBAuth();

    try {
      await OmniBox.log(
        "info",
        `tmdb.js home 开始：TMDB authMode=${tmdbAuth?.mode || "unknown"} keyLen=${tmdbAuth?.value ? tmdbAuth.value.length : 0}`,
      );
    } catch {
      // ignore
    }

    const classList = [
      { type_id: "movie_popular", type_name: "热门电影" },
      { type_id: "tv_popular", type_name: "热门电视剧" },
      { type_id: "movie_top_rated", type_name: "高分电影" },
      { type_id: "tv_top_rated", type_name: "高分电视剧" },
      { type_id: "movie_filter", type_name: "电影筛选" },
      { type_id: "tv_filter", type_name: "电视剧筛选" },
    ];

    const filters = {
      movie_filter: [
        {
          key: "genre",
          name: "类型",
          init: "",
          value: [
            { name: "全部", value: "" },
            { name: "动作", value: "action" },
            { name: "喜剧", value: "comedy" },
            { name: "爱情", value: "romance" },
            { name: "科幻", value: "science_fiction" },
            { name: "动画", value: "animation" },
            { name: "悬疑", value: "mystery" },
            { name: "犯罪", value: "crime" },
            { name: "惊悚", value: "thriller" },
            { name: "恐怖", value: "horror" },
            { name: "剧情", value: "drama" },
            { name: "纪录片", value: "documentary" },
          ],
        },
        {
          key: "region",
          name: "地区",
          init: "",
          value: [
            { name: "全部", value: "" },
            { name: "中国", value: "cn" },
            { name: "美国", value: "us" },
            { name: "日本", value: "jp" },
            { name: "韩国", value: "kr" },
            { name: "中国香港", value: "hk" },
            { name: "中国台湾", value: "tw" },
            { name: "英国", value: "gb" },
            { name: "法国", value: "fr" },
            { name: "德国", value: "de" },
            { name: "印度", value: "in" },
            { name: "泰国", value: "th" },
          ],
        },
        {
          key: "year",
          name: "年代",
          init: "",
          value: [
            { name: "全部", value: "" },
            { name: "2026", value: "2026" },
            { name: "2025", value: "2025" },
            { name: "2024", value: "2024" },
            { name: "2023", value: "2023" },
            { name: "2022", value: "2022" },
            { name: "2021", value: "2021" },
            { name: "2020s", value: "2020s" },
            { name: "2010s", value: "2010s" },
            { name: "2000s", value: "2000s" },
          ],
        },
        {
          key: "sort",
          name: "排序",
          init: "hot",
          value: [
            { name: "热度", value: "hot" },
            { name: "评分", value: "score" },
            { name: "时间", value: "time" },
          ],
        },
      ],
      tv_filter: [
        {
          key: "genre",
          name: "类型",
          init: "",
          value: [
            { name: "全部", value: "" },
            { name: "动作冒险", value: "action_adventure" },
            { name: "喜剧", value: "comedy" },
            { name: "悬疑", value: "mystery" },
            { name: "科幻奇幻", value: "sci_fi_fantasy" },
            { name: "动画", value: "animation" },
            { name: "真人秀", value: "reality" },
            { name: "脱口秀", value: "talk" },
            { name: "剧情", value: "drama" },
            { name: "犯罪", value: "crime" },
            { name: "纪录片", value: "documentary" },
          ],
        },
        {
          key: "region",
          name: "地区",
          init: "",
          value: [
            { name: "全部", value: "" },
            { name: "中国", value: "cn" },
            { name: "美国", value: "us" },
            { name: "日本", value: "jp" },
            { name: "韩国", value: "kr" },
            { name: "中国香港", value: "hk" },
            { name: "中国台湾", value: "tw" },
            { name: "英国", value: "gb" },
            { name: "法国", value: "fr" },
            { name: "德国", value: "de" },
            { name: "印度", value: "in" },
            { name: "泰国", value: "th" },
          ],
        },
        {
          key: "year",
          name: "年代",
          init: "",
          value: [
            { name: "全部", value: "" },
            { name: "2026", value: "2026" },
            { name: "2025", value: "2025" },
            { name: "2024", value: "2024" },
            { name: "2023", value: "2023" },
            { name: "2022", value: "2022" },
            { name: "2021", value: "2021" },
            { name: "2020s", value: "2020s" },
            { name: "2010s", value: "2010s" },
            { name: "2000s", value: "2000s" },
          ],
        },
        {
          key: "sort",
          name: "排序",
          init: "hot",
          value: [
            { name: "热度", value: "hot" },
            { name: "评分", value: "score" },
            { name: "时间", value: "time" },
          ],
        },
      ],
    };

    // 首页推荐：混合热度榜 + 热门 + 高分
    const [trendMovies, trendTV, popularMovies, popularTV] = await Promise.all([
      tmdbGet("/trending/movie/day", { page: 1 }),
      tmdbGet("/trending/tv/day", { page: 1 }),
      tmdbGet("/movie/popular", { page: 1 }),
      tmdbGet("/tv/popular", { page: 1 }),
    ]);

    try {
      await OmniBox.log(
        "info",
        `tmdb.js home 接收结果：trendMovies=${trendMovies?.results?.length || 0}, trendTV=${trendTV?.results?.length || 0}, popularMovies=${popularMovies?.results?.length || 0}, popularTV=${popularTV?.results?.length || 0}`,
      );
    } catch {
      // ignore
    }

    const list = [];

    // 6 热度电影 + 6 热度剧集 + 4 热门电影 + 4 热门剧集 = 20
    const pushBatch = (
      arr,
      mediaType,
      groupTypeId,
      groupTypeName,
      remarks,
      count,
    ) => {
      if (!Array.isArray(arr)) return;
      for (const item of arr.slice(0, count)) {
        const vod = toVodItem({
          context,
          mediaType,
          tmdbItem: item,
          groupTypeId,
          groupTypeName,
          remarks,
        });
        if (vod) {
          vod.vod_id = `tmdb_${mediaType}_${item.id}`;
          vod.vod_tag = "folder";
          list.push(vod);
        }
      }
    };

    pushBatch(
      trendMovies?.results,
      "movie",
      "movie_trending_day",
      "热度榜（电影）",
      "热度榜",
      6,
    );
    pushBatch(
      trendTV?.results,
      "tv",
      "tv_trending_day",
      "热度榜（剧集）",
      "热度榜",
      6,
    );
    pushBatch(
      popularMovies?.results,
      "movie",
      "movie_popular",
      "热门电影",
      "热门",
      4,
    );
    pushBatch(popularTV?.results, "tv", "tv_popular", "热门电视剧", "热门", 4);

    try {
      await OmniBox.log(
        "info",
        `tmdb.js home 返回：class=${classList.length} list=${list.length}`,
      );
    } catch {
      // ignore
    }

    return {
      class: classList,
      list,
      filters,
    };
  } catch (error) {
    try {
      await OmniBox.log(
        "error",
        `tmdb.js home 出错: ${error.message || String(error)}`,
      );
    } catch {
      // ignore
    }
    return {
      class: [],
      list: [],
    };
  }
}

/**
 * 获取分类数据
 * @param {Object} params - { categoryId, page, filters? }
 * @param {Object} context - 请求上下文
 */
async function category(params, context) {
  const categoryId = safeString(params?.categoryId);
  const page = Number(params?.page || 1) || 1;
  const filters = params?.filters || {};

  const categoryMap = {
    movie_popular: {
      mediaType: "movie",
      apiPath: "/movie/popular",
      typeName: "热门电影",
      remarks: "热门",
    },
    tv_popular: {
      mediaType: "tv",
      apiPath: "/tv/popular",
      typeName: "热门电视剧",
      remarks: "热门",
    },
    movie_top_rated: {
      mediaType: "movie",
      apiPath: "/movie/top_rated",
      typeName: "高分电影",
      remarks: "评分榜",
    },
    tv_top_rated: {
      mediaType: "tv",
      apiPath: "/tv/top_rated",
      typeName: "高分电视剧",
      remarks: "评分榜",
    },
    movie_trending_day: {
      mediaType: "movie",
      apiPath: "/trending/movie/day",
      typeName: "热度榜（电影）",
      remarks: "热度榜",
    },
    tv_trending_day: {
      mediaType: "tv",
      apiPath: "/trending/tv/day",
      typeName: "热度榜（剧集）",
      remarks: "热度榜",
    },
    movie_filter: {
      mediaType: "movie",
      apiPath: "/discover/movie",
      typeName: "电影筛选",
      remarks: "筛选",
      isDiscover: true,
    },
    tv_filter: {
      mediaType: "tv",
      apiPath: "/discover/tv",
      typeName: "电视剧筛选",
      remarks: "筛选",
      isDiscover: true,
    },
  };

  try {
    if (!categoryId) {
      try {
        await OmniBox.log(
          "warn",
          `tmdb.js category 未知 categoryId=${categoryId}`,
        );
      } catch {
        // ignore
      }
      return {
        page,
        pagecount: 0,
        total: 0,
        list: [],
      };
    }

    // 三级目录：hdhive_pan|movie|550|quark -> 返回对应网盘类型下的资源列表
    const panFolderInfo = parseHDHivePanFolderId(categoryId);
    if (panFolderInfo) {
      // 二/三级目录固定单页，防止 page=2 时重复数据
      if (page > 1) {
        return {
          page,
          pagecount: 1,
          total: 0,
          list: [],
        };
      }

      const hData = await getHDHiveResourcesCached(
        panFolderInfo.mediaType,
        panFolderInfo.tmdbId,
      );
      if (hData?.rateLimited) {
        await OmniBox.log(
          "warn",
          `tmdb.js category(HDHive-PanItems) 被限流短路: categoryId=${categoryId}`,
        );
        return {
          page: 1,
          pagecount: 1,
          total: 0,
          list: [],
        };
      }
      let resources = getArray(hData?.data).filter(
        (it) => normalizePanType(it?.pan_type) === panFolderInfo.panType,
      );

      // 参考 pansou.js 的 PanCheck 逻辑：对资源链接做可配置有效性检测
      if (PANCHECK_ENABLED && PANCHECK_API) {
        const links = resources
          .map((it) => safeString(it.media_url))
          .filter(Boolean);
        const invalidLinksSet = await checkLinksWithPanCheck(links);
        if (invalidLinksSet.size > 0) {
          resources = resources.filter((it) => {
            const link = safeString(it.media_url);
            return !link || !invalidLinksSet.has(link);
          });
          await OmniBox.log(
            "info",
            `tmdb.js category(HDHive-PanItems) PanCheck过滤后剩余=${resources.length}`,
          );
        }
      }
      const total = resources.length;

      const list = resources.map((it) => {
        const title =
          safeString(it.title) ||
          `${panFolderInfo.mediaType.toUpperCase()} ${panFolderInfo.tmdbId}`;
        const unlockPoints = asInt(it.unlock_points, 0);
        const isFree = unlockPoints === 0;
        const remarkParts = [];
        if (safeString(it.share_size))
          remarkParts.push(safeString(it.share_size));
        remarkParts.push(isFree ? "免费" : `${unlockPoints}积分`);
        if (safeString(it.pan_type))
          remarkParts.push(`网盘:${safeString(it.pan_type)}`);

        const subtitleParts = [];
        const resolutions = getArray(it.video_resolution)
          .map((x) => safeString(x))
          .filter(Boolean);
        const sources = getArray(it.source)
          .map((x) => safeString(x))
          .filter(Boolean);
        if (resolutions.length > 0) subtitleParts.push(resolutions.join("/"));
        if (sources.length > 0) subtitleParts.push(sources.join("/"));
        if (safeString(it.remark)) subtitleParts.push(safeString(it.remark));

        const encodedVodId = encodeHDHiveVideoId({
          slug: it.slug,
          mediaType: panFolderInfo.mediaType,
          tmdbId: panFolderInfo.tmdbId,
          title,
          posterPath: "",
          year: "",
          remark: safeString(it.remark),
        });

        return {
          vod_id: encodedVodId,
          vod_name: title,
          vod_pic: getPanIcon(panFolderInfo.panType) || "",
          type_id: categoryId,
          type_name: `${getPanName(panFolderInfo.panType)} 资源`,
          vod_remarks: remarkParts.join(" | "),
          vod_subtitle: subtitleParts.join(" | "),
        };
      });

      await OmniBox.log(
        "info",
        `tmdb.js category(HDHive-PanItems) 返回: categoryId=${categoryId} panType=${panFolderInfo.panType} list=${list.length}`,
      );
      return {
        page: 1,
        pagecount: 1,
        total,
        list,
      };
    }

    // 二级目录：tmdb_movie_550 / tmdb_tv_154385 -> 请求 HDHive 并先按 pan_type 分组为 folder
    const folderInfo = parseTmdbFolderId(categoryId);
    if (folderInfo) {
      // 二/三级目录固定单页，防止 page=2 时重复数据
      if (page > 1) {
        return {
          page,
          pagecount: 1,
          total: 0,
          list: [],
        };
      }

      const hdhiveType = folderInfo.mediaType === "movie" ? "movie" : "tv";
      const hData = await getHDHiveResourcesCached(
        hdhiveType,
        folderInfo.tmdbId,
      );
      if (hData?.rateLimited) {
        await OmniBox.log(
          "warn",
          `tmdb.js category(HDHive-PanFolders) 被限流短路: categoryId=${categoryId}`,
        );
        return {
          page: 1,
          pagecount: 1,
          total: 0,
          list: [],
        };
      }
      const resources = getArray(hData?.data);
      const total = asInt(hData?.meta?.total, resources.length);

      const panGroupMap = {};
      for (const item of resources) {
        const panType = normalizePanType(item?.pan_type);
        if (!panType) continue;
        if (!panGroupMap[panType]) {
          panGroupMap[panType] = {
            panType,
            count: 0,
            totalUnlockPoints: 0,
          };
        }
        panGroupMap[panType].count += 1;
        panGroupMap[panType].totalUnlockPoints += asInt(item?.unlock_points, 0);
      }

      const list = Object.values(panGroupMap).map((group) => {
        const panType = group.panType;
        const count = group.count;
        const paidCountHint = group.totalUnlockPoints > 0 ? "含付费" : "全免费";
        return {
          vod_id: buildHDHivePanFolderCategoryId(
            hdhiveType,
            folderInfo.tmdbId,
            panType,
          ),
          vod_name: getPanName(panType),
          vod_pic: getPanIcon(panType),
          type_id: categoryId,
          type_name: "网盘分组",
          vod_remarks: `${count} 条分享链接`,
          vod_subtitle: `${paidCountHint} | 点击进入`,
          vod_tag: "folder",
        };
      });

      await OmniBox.log(
        "info",
        `tmdb.js category(HDHive-PanFolders) 返回: categoryId=${categoryId} panFolders=${list.length} resources=${total}`,
      );
      return {
        page: 1,
        pagecount: 1,
        total: list.length,
        list,
      };
    }

    if (!categoryMap[categoryId]) {
      await OmniBox.log(
        "warn",
        `tmdb.js category 未知 categoryId=${categoryId}`,
      );
      return {
        page,
        pagecount: 0,
        total: 0,
        list: [],
      };
    }

    const cfg = categoryMap[categoryId];

    // 确保认证可用（并产生日志帮助定位）
    await getTMDBAuth();

    try {
      await OmniBox.log(
        "info",
        `tmdb.js category 开始：categoryId=${categoryId} page=${page}`,
      );
    } catch {
      // ignore
    }

    const discoverParams = cfg.isDiscover
      ? buildDiscoverFilters(cfg.mediaType, filters)
      : {};
    const data = await tmdbGet(cfg.apiPath, { page, ...discoverParams });

    const results = Array.isArray(data?.results) ? data.results : [];
    const total = Number(data?.total_results || 0);
    const pagecount = Number(data?.total_pages || 0);

    const list = [];
    for (const item of results) {
      const vod = toVodItem({
        context,
        mediaType: cfg.mediaType,
        tmdbItem: item,
        groupTypeId: categoryId,
        groupTypeName: cfg.typeName,
        remarks: cfg.remarks,
      });
      if (vod) {
        // 一级分类改为 folder，点击后进入二级（HDHive 资源列表）
        vod.vod_id = `tmdb_${cfg.mediaType}_${item.id}`;
        vod.vod_tag = "folder";
        list.push(vod);
      }
    }

    try {
      await OmniBox.log(
        "info",
        `tmdb.js category 返回：categoryId=${categoryId} list=${list.length} total=${total} pagecount=${pagecount}`,
      );
    } catch {
      // ignore
    }

    return {
      page,
      pagecount,
      total,
      list,
    };
  } catch (error) {
    try {
      await OmniBox.log(
        "error",
        `tmdb.js category 出错: ${error.message || String(error)}`,
      );
    } catch {
      // ignore
    }
    return {
      page,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }
}

/**
 * 查询接口（搜索）
 * @param {Object} params - { keyword, page?, quick? }
 * @param {Object} context - 请求上下文
 */
async function search(params, context) {
  const keyword = safeString(params?.keyword || params?.wd || "");
  const page = Number(params?.page || 1) || 1;

  if (!keyword) {
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }

  try {
    await getTMDBAuth();

    try {
      await OmniBox.log(
        "info",
        `tmdb.js search 开始：keyword="${keyword}" page=${page}`,
      );
    } catch {
      // ignore
    }

    const data = await tmdbGet("/search/multi", {
      query: keyword,
      page,
      include_adult: false,
    });

    const results = Array.isArray(data?.results) ? data.results : [];
    const total = Number(data?.total_results || 0);
    const pagecount = Number(data?.total_pages || 0);

    const list = [];
    for (const item of results) {
      const mediaType = safeString(item?.media_type);
      if (mediaType !== "movie" && mediaType !== "tv") continue;

      const typeName = mediaType === "movie" ? "电影" : "电视剧";
      const remarks = mediaType === "movie" ? "搜索" : "搜索";

      const vod = toVodItem({
        context,
        mediaType,
        tmdbItem: item,
        groupTypeId: mediaType,
        groupTypeName: typeName,
        remarks,
      });

      if (vod) {
        vod.vod_id = `tmdb_${mediaType}_${item.id}`;
        vod.vod_tag = "folder";
        list.push(vod);
      }
    }

    try {
      await OmniBox.log(
        "info",
        `tmdb.js search 返回：total=${total} list=${list.length} pagecount=${pagecount}`,
      );
    } catch {
      // ignore
    }

    return {
      page,
      pagecount,
      total,
      list,
    };
  } catch (error) {
    try {
      await OmniBox.log(
        "error",
        `tmdb.js search 出错: ${error.message || String(error)}`,
      );
    } catch {
      // ignore
    }
    return {
      page,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }
}

/**
 * 详情：通过 HDHive unlock 获取分享链接，再解析网盘视频列表
 */
async function detail(params, context) {
  try {
    const videoId = safeString(params?.videoId);
    if (!videoId) throw new Error("视频ID不能为空");

    const payload = decodeHDHiveVideoId(videoId);
    if (!payload || !payload.slug) {
      throw new Error("videoId 格式不正确，缺少 slug");
    }

    await OmniBox.log("info", `tmdb.js detail 开始: slug=${payload.slug}`);

    const unlockResp = await getHDHiveUnlockCached(payload.slug);
    if (unlockResp?.rateLimited) {
      await OmniBox.log("warn", `tmdb.js detail 被限流短路: slug=${payload.slug}`);
      return { list: [] };
    }
    await OmniBox.log(
      "info",
      `tmdb.js detail unlock来源: slug=${payload.slug} cached=${unlockResp?.cached === true}`,
    );
    const shareURL = safeString(
      unlockResp?.data?.full_url || unlockResp?.data?.url,
    );
    if (!shareURL) {
      throw new Error("HDHive unlock 未返回分享链接");
    }

    const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
    const sourceName = driveInfo?.displayName || "网盘";
    const fileList = await OmniBox.getDriveFileList(shareURL, "0");
    if (!fileList || !Array.isArray(fileList.files)) {
      throw new Error("获取网盘文件列表失败");
    }

    const allVideoFiles = await getAllVideoFiles(shareURL, fileList.files);
    if (allVideoFiles.length === 0) {
      throw new Error("分享链接中未找到视频文件");
    }

    // 参考 pansou.js：执行刮削 + 获取元数据
    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = payload.mediaType || "";
    try {
      const resourceId = videoId;
      const rawKeyword = safeString(payload.title || "");
      const keyword = normalizeScrapeKeyword(rawKeyword);
      const note = safeString(payload.remark || payload.title || "");

      const videoFilesForScraping = allVideoFiles.map((file) => {
        const fileId = safeString(file.fid || file.file_id);
        const formattedFileId = fileId ? `${shareURL}|${fileId}` : fileId;
        return {
          ...file,
          fid: formattedFileId,
          file_id: formattedFileId,
        };
      });

      await OmniBox.log(
        "info",
        `tmdb.js detail 刮削关键词: raw="${rawKeyword}" -> normalized="${keyword}"`,
      );
      await OmniBox.processScraping(
        resourceId,
        keyword,
        note,
        videoFilesForScraping,
      );
      const metadata = await OmniBox.getScrapeMetadata(resourceId);
      scrapeData = metadata?.scrapeData || null;
      videoMappings = metadata?.videoMappings || [];
      scrapeType = metadata?.scrapeType || scrapeType;
      await OmniBox.log(
        "info",
        `tmdb.js detail 刮削完成: scrapeType=${scrapeType}, mappings=${videoMappings.length}`,
      );
    } catch (error) {
      await OmniBox.log(
        "warn",
        `tmdb.js detail 刮削流程失败: ${error.message}`,
      );
    }

    const source = safeString(params?.source || "");
    let sourceNames = [sourceName];
    if (DRIVE_TYPE_CONFIG.includes(String(driveInfo?.driveType || "").toLowerCase())) {
      sourceNames = [...SOURCE_NAMES_CONFIG];
      if (source === "web") {
        sourceNames = sourceNames.filter((name) => name !== "本地代理");
      }
    }

    let playSources = [];
    for (const lineName of sourceNames) {
      const episodes = [];
      for (const file of allVideoFiles) {
        let fileName = safeString(file.file_name);
        const fileId = safeString(file.fid);
        if (!fileName || !fileId) continue;

        const formattedFileId = `${shareURL}|${fileId}`;
        const matchedMapping =
          videoMappings.find((m) => m && m.fileId === formattedFileId) || null;
        if (matchedMapping?.episodeName) {
          fileName =
            `${safeString(matchedMapping.episodeNumber || "")}.${safeString(matchedMapping.episodeName)}`.replace(
              /^\./,
              "",
            );
        }

        const size = asInt(file.size || file.file_size, 0);
        const epName = fileName;

        const episode = {
          name: epName,
          // 格式：shareURL|fileId|vodId(JSON字符串)
          playId: `${formattedFileId}|${videoId}`,
          size: size > 0 ? size : undefined,
        };

        if (matchedMapping) {
          if (matchedMapping.episodeName)
            episode.episodeName = matchedMapping.episodeName;
          if (matchedMapping.episodeOverview)
            episode.episodeOverview = matchedMapping.episodeOverview;
          if (matchedMapping.episodeAirDate)
            episode.episodeAirDate = matchedMapping.episodeAirDate;
          if (matchedMapping.episodeStillPath)
            episode.episodeStillPath = matchedMapping.episodeStillPath;
          if (
            matchedMapping.episodeVoteAverage !== undefined &&
            matchedMapping.episodeVoteAverage !== null
          ) {
            episode.episodeVoteAverage = matchedMapping.episodeVoteAverage;
          }
          if (
            matchedMapping.episodeRuntime !== undefined &&
            matchedMapping.episodeRuntime !== null
          ) {
            episode.episodeRuntime = matchedMapping.episodeRuntime;
          }
          if (matchedMapping.seasonNumber !== undefined)
            episode._seasonNumber = matchedMapping.seasonNumber;
          if (matchedMapping.episodeNumber !== undefined)
            episode._episodeNumber = matchedMapping.episodeNumber;
        }
        episodes.push(episode);
      }

      const hasEpisodeNo = episodes.some(
        (ep) => ep._episodeNumber !== undefined,
      );
      if (hasEpisodeNo) {
        episodes.sort((a, b) => {
          const sa = a._seasonNumber !== undefined ? a._seasonNumber : 0;
          const sb = b._seasonNumber !== undefined ? b._seasonNumber : 0;
          if (sa !== sb) return sa - sb;
          const ea = a._episodeNumber !== undefined ? a._episodeNumber : 0;
          const eb = b._episodeNumber !== undefined ? b._episodeNumber : 0;
          return ea - eb;
        });
      }

      if (episodes.length > 0) {
        const baseLineName = sourceName;
        const finalLineName =
          DRIVE_TYPE_CONFIG.includes(String(driveInfo?.driveType || "").toLowerCase())
            ? `${baseLineName}-${lineName}`
            : `${baseLineName}-网盘线路`;
        playSources.push({
          name: finalLineName,
          baseSourceName: baseLineName,
          episodes,
        });
      }
    }

    if (playSources.length > 1 && DRIVE_ORDER.length > 0) {
      playSources = sortPlaySourcesByDriveOrder(playSources).map((item) => ({
        name: item.name,
        episodes: item.episodes,
      }));
    }

    let tmdbTitle = payload.title || scrapeData?.title || "";
    let tmdbYear =
      payload.year ||
      (scrapeData?.releaseDate
        ? safeString(scrapeData.releaseDate).slice(0, 4)
        : "");
    let tmdbPic = payload.posterPath
      ? `${TMDB_IMAGE_BASE_URL}/${TMDB_IMAGE_POSTER_SIZE}${payload.posterPath}`
      : scrapeData?.posterPath
        ? `${TMDB_IMAGE_BASE_URL}/${TMDB_IMAGE_POSTER_SIZE}${safeString(scrapeData.posterPath)}`
        : "";
    let tmdbOverview = payload.remark || scrapeData?.overview || "";
    let tmdbScore = "";

    const detailFallbackFields = {
      vod_pic: buildPoster(context, payload.posterPath),
      vod_year: payload.year,
      vod_content: payload.remark,
      type_name: getTypeNameByMediaType(payload.mediaType || "movie"),
      vod_remarks: safeString(unlockResp?.message || "HDHive资源"),
    };

    // 尝试补齐 TMDB 元信息
    try {
      if (payload.mediaType && payload.tmdbId) {
        const tmdbDetail = await tmdbGet(
          `/${payload.mediaType}/${payload.tmdbId}`,
          {
            append_to_response: "credits",
          },
        );
        if (safeString(tmdbDetail?.title || tmdbDetail?.name)) {
          tmdbTitle = safeString(tmdbDetail?.title || tmdbDetail?.name);
        }
        const yearRaw =
          payload.mediaType === "movie"
            ? tmdbDetail?.release_date
            : tmdbDetail?.first_air_date;
        if (extractYear(yearRaw)) tmdbYear = extractYear(yearRaw);
        if (safeString(tmdbDetail?.poster_path)) {
          tmdbPic = `${TMDB_IMAGE_BASE_URL}/${TMDB_IMAGE_POSTER_SIZE}${safeString(tmdbDetail.poster_path)}`;
        }
        if (safeString(tmdbDetail?.overview))
          tmdbOverview = safeString(tmdbDetail.overview);
        if (
          tmdbDetail?.vote_average !== undefined &&
          tmdbDetail?.vote_average !== null
        ) {
          tmdbScore = Number(tmdbDetail.vote_average).toFixed(1);
        }
        scrapeData = {
          ...(scrapeData && typeof scrapeData === "object" ? scrapeData : {}),
          ...tmdbDetail,
          credits:
            tmdbDetail?.credits ||
            scrapeData?.credits ||
            (scrapeData && typeof scrapeData === "object" ? scrapeData.credits : undefined),
        };
        await OmniBox.log(
          "info",
          `tmdb.js detail TMDB补齐成功: title=${safeString(tmdbDetail?.title || tmdbDetail?.name)}, hasCredits=${Array.isArray(tmdbDetail?.credits?.cast) || Array.isArray(tmdbDetail?.credits?.crew)}`,
        );
      }
    } catch (e) {
      await OmniBox.log(
        "warn",
        `tmdb.js detail 补齐TMDB信息失败: ${e.message}`,
      );
    }

    const mergedDetailFields = pickScrapeDetailFields(
      payload,
      scrapeData || {},
      {
        ...detailFallbackFields,
        vod_pic: tmdbPic || detailFallbackFields.vod_pic,
        vod_year: tmdbYear || detailFallbackFields.vod_year,
        vod_content: tmdbOverview || detailFallbackFields.vod_content,
        vod_douban_score: tmdbScore,
      },
    );

    await OmniBox.log(
      "info",
      `tmdb.js detail 元数据回填结果: title=${mergedDetailFields.vodName || ""}, actor=${mergedDetailFields.vodActor || ""}, director=${mergedDetailFields.vodDirector || ""}, area=${mergedDetailFields.vodArea || ""}, lang=${mergedDetailFields.vodLang || ""}, type=${mergedDetailFields.typeName || ""}, overviewLen=${safeString(mergedDetailFields.vodContent).length}`,
    );

    const legacyPlayFields = buildLegacyPlayFields(playSources);

    return {
      list: [
        {
          vod_id: videoId,
          vod_name: mergedDetailFields.vodName || `资源 ${payload.slug}`,
          vod_pic: mergedDetailFields.vodPic,
          type_name:
            mergedDetailFields.typeName ||
            getTypeNameByMediaType(payload.mediaType || "movie"),
          vod_year: mergedDetailFields.vodYear,
          vod_area: mergedDetailFields.vodArea,
          vod_lang: mergedDetailFields.vodLang,
          vod_actor: mergedDetailFields.vodActor,
          vod_director: mergedDetailFields.vodDirector,
          vod_remarks: safeString(unlockResp?.message || "HDHive资源"),
          vod_content:
            mergedDetailFields.vodContent ||
            `HDHive 资源，共 ${episodes.length} 个视频文件`,
          vod_play_sources: playSources,
          vod_play_from: legacyPlayFields.vod_play_from,
          vod_play_url: legacyPlayFields.vod_play_url,
          vod_douban_score: mergedDetailFields.vodDoubanScore,
        },
      ],
    };
  } catch (error) {
    await OmniBox.log("error", `tmdb.js detail 出错: ${error.message}`);
    return { list: [] };
  }
}

/**
 * 播放：参考 pansou.js，使用网盘 SDK 获取可播放地址
 */
async function play(params, context) {
  try {
    const playId = safeString(params?.playId);
    const flag = safeString(params?.flag);
    if (!playId) throw new Error("playId 不能为空");

    const parts = playId.split("|");
    let shareURL = safeString(parts[0]);
    let fileId = safeString(parts[1]);
    // 第三段可能是 detail 透传过来的原始 vodId（JSON字符串）
    let rawVodIdFromPlayId =
      parts.length >= 3 ? safeString(parts.slice(2).join("|")) : "";

    if (!shareURL) throw new Error("分享链接为空");

    if (!fileId) {
      await OmniBox.log(
        "warn",
        `tmdb.js play 收到缺少 fileId 的 playId，尝试按 shareURL 兜底解析: ${playId}`,
      );
      const rootList = await OmniBox.getDriveFileList(shareURL, "0");
      const allVideoFiles = await getAllVideoFiles(shareURL, rootList?.files || []);
      const enrichedFiles = allVideoFiles.map((file) => ({
        ...file,
        fileId: safeString(file?.fid || file?.file_id),
        episodeName: safeString(file?.episodeName || params?.episodeName || ""),
      })).filter((file) => file.fileId);
      const matchedFile = pickBestEpisodeFile(enrichedFiles, params?.episodeName || "");
      if (!matchedFile || !matchedFile.fileId) {
        throw new Error(`playId 缺少文件ID且兜底未找到可播放文件: ${playId}`);
      }
      fileId = safeString(matchedFile.fileId);
      await OmniBox.log(
        "info",
        `tmdb.js play 兜底命中文件: ${safeString(matchedFile.file_name)} -> ${fileId}`,
      );
    }

    // 参考 pansou.js：匹配元数据用于弹幕
    let danmakuList = [];
    try {
      const resourceId = safeString(rawVodIdFromPlayId || params?.vodId || "");
      const metadata = await OmniBox.getScrapeMetadata(resourceId);
      if (metadata && metadata.scrapeData && metadata.videoMappings) {
        const formattedFileId = `${shareURL}|${fileId}`;
        const matchedMapping =
          metadata.videoMappings.find((m) => m.fileId === formattedFileId) ||
          null;
        if (matchedMapping) {
          const sData = metadata.scrapeData || {};

          let fileName = "";
          const sType = metadata.scrapeType || "";
          if (sType === "movie") {
            fileName = safeString(sData.title);
          } else {
            const title = safeString(sData.title);
            const seasonAirYear = safeString(sData.seasonAirYear);
            const seasonNumber = asInt(matchedMapping.seasonNumber, 1);
            const epNum = asInt(matchedMapping.episodeNumber, 1);
            fileName = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
          }
          if (fileName) {
            await OmniBox.log("info", `tmdb.js play 弹幕匹配 fileName=${fileName}`);
            danmakuList = await OmniBox.getDanmakuByFileName(fileName);
            await OmniBox.log("info", `tmdb.js play 弹幕匹配结果 count=${Array.isArray(danmakuList) ? danmakuList.length : 0}`);
          } else {
            await OmniBox.log("info", `tmdb.js play 弹幕匹配跳过: fileName 为空, shareURL=${shareURL}`);
          }
        } else {
          await OmniBox.log("info", `tmdb.js play 弹幕匹配未命中 mapping: fileId=${formattedFileId}`);
        }
      } else {
        await OmniBox.log("info", `tmdb.js play 弹幕匹配跳过: metadata 不完整`);
      }
    } catch (error) {
      await OmniBox.log(
        "warn",
        `tmdb.js play 元数据匹配失败: ${error.message}`,
      );
    }

    let routeType = safeString(flag);
    if (routeType && routeType.includes("-")) {
      const parts = routeType.split("-");
      routeType = safeString(parts[parts.length - 1]);
    }
    if (!routeType) {
      routeType = safeString(params?.source) === "web" ? "服务端代理" : "直连";
    }

    const playInfo = await OmniBox.getDriveVideoPlayInfo(
      shareURL,
      fileId,
      routeType,
    );
    if (
      !playInfo ||
      !Array.isArray(playInfo.url) ||
      playInfo.url.length === 0
    ) {
      throw new Error("未获取到播放地址");
    }

    const urls = playInfo.url
      .map((item) => ({
        name: safeString(item?.name) || "播放",
        url: safeString(item?.url),
      }))
      .filter((x) => x.url);

    const finalDanmaku =
      danmakuList && danmakuList.length > 0
        ? danmakuList
        : playInfo.danmaku || [];
    return {
      urls,
      header: playInfo.header || {},
      parse: 0,
      danmaku: finalDanmaku};
  } catch (error) {
    await OmniBox.log("error", `tmdb.js play 出错: ${error.message}`);
    return {
      urls: [],
      header: {},
      parse: 0,
      danmaku: []};
  }
}
