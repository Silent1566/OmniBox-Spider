// @name 盘搜分组
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持，只支持tvbox接口
// @dependencies: crypto, axios
// @version 1.5.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/盘搜分组.js

/**
* OmniBox 网盘爬虫脚本 - 分组版本
*
* 此脚本在原有盘搜模板基础上，增加了网盘分组功能
* 搜索时先展示各个网盘的分类，点击后再展示该网盘的具体搜索结果
*
* 配置说明:
* 1. 配置盘搜API地址到环境变量 PANSOU_API 中,或直接修改下面的 PANSOU_API 常量
* 2. (可选)配置盘搜频道到环境变量 PANSOU_CHANNELS 中
* 3. (可选)配置盘搜插件到环境变量 PANSOU_PLUGINS 中
* 4. (可选)配置网盘类型过滤到环境变量 PANSOU_CLOUD_TYPES 中(支持逗号/分号分隔,如:baidu,aliyun,quark 或 baidu;aliyun;quark)
* 5. (可选)配置 PanCheck API 地址到环境变量 PANCHECK_API 中,用于过滤无效链接
* 6. (可选)配置 PanCheck 是否启用到环境变量 PANCHECK_ENABLED 中(true/false,默认:如果配置了 PANCHECK_API 则启用)
* 7. (可选)配置 PanCheck 选择的平台到环境变量 PANCHECK_PLATFORMS 中(支持逗号/分号分隔,如:baidu,aliyun,quark 或 baidu;aliyun;quark)
* 8. (可选)配置 PANSOU_FILTER 中(如:{"include":["合集","全集"],"exclude":["预告"]})
*/

const axios = require("axios");
const crypto = require("crypto");
const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
const PANSOU_API = process.env.PANSOU_API || "";
const PANSOU_CHANNELS = process.env.PANSOU_CHANNELS || "";
const PANSOU_PLUGINS = process.env.PANSOU_PLUGINS || "";
const PANSOU_CLOUD_TYPES = process.env.PANSOU_CLOUD_TYPES || "";
const PANSOU_FILTER = process.env.PANSOU_FILTER || { "include": [""], "exclude": [] };
const PANCHECK_API = process.env.PANCHECK_API || "";
const PANCHECK_ENABLED = true;
const PANCHECK_PLATFORMS = process.env.PANCHECK_PLATFORMS || "quark,baidu,uc,pan123,tianyi,cmcc";

// 115 cookie 统一全局配置：与七味分组共用同一套环境变量
const GLOBAL_115_COOKIE = process.env.PAN_115_COOKIE || process.env.GLOBAL_115_COOKIE || process.env.QIWEI_115_COOKIE || process.env.WOOG_115_COOKIE || process.env['115_COOKIE'] || "";
const GLOBAL_115_MAGNET_CACHE_EX_SECONDS = Number(process.env.GLOBAL_115_MAGNET_CACHE_EX_SECONDS || process.env.QIWEI_115_MAGNET_CACHE_EX_SECONDS || 2592000);

const RAPID_TRANSFER_ENABLED = String(process.env.RAPID_TRANSFER_ENABLED || "true").toLowerCase() !== "false";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function splitConfigList(value) {
    return String(value || "")
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

// 网盘类型匹配配置: 支持逗号/分号分隔，例如 quark;uc 或 quark,uc
const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "quark;uc;aliyun");
// 线路名称配置: 支持逗号/分号分隔，例如 本地代理;服务端代理;直连
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");
// 是否开启外网服务器代理（默认关闭）
const EXTERNAL_SERVER_PROXY_ENABLED = String(process.env.EXTERNAL_SERVER_PROXY_ENABLED || "false").toLowerCase() === "true";
// 详情页播放线路和搜索分组的网盘排序顺序
const DRIVE_ORDER = splitConfigList(process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").map((s) => s.toLowerCase());
// 详情链路缓存时间（秒），默认 12 小时
const PANSOU_GROUP_CACHE_EX_SECONDS = Number(process.env.PANSOU_GROUP_CACHE_EX_SECONDS || 43200);
// 是否异步刮削，默认 true。仅当明确配置为 false 时才走同步刮削。
const ASYNC_SCRAPING = String(process.env.ASYNC_SCRAPING || "false").toLowerCase() !== "false";
// ==================== 配置区域结束 ====================  

function inferDriveTypeFromSourceName(name = "") {
    const raw = String(name || "").toLowerCase();
    if (raw.includes("百度")) return "baidu";
    if (raw.includes("天翼")) return "tianyi";
    if (raw.includes("夸克")) return "quark";
    if (raw === "uc" || raw.includes("uc")) return "uc";
    if (raw.includes("115")) return "115";
    if (raw.includes("迅雷")) return "xunlei";
    if (raw.includes("阿里")) return "aliyun";
    if (raw.includes("移动") || raw.includes("139") || raw.includes("cmcc")) return "cmcc";
    if (raw.includes("123")) return "pan123";
    return raw;
}

function normalizeDriveType(driveType = "") {
    const raw = String(driveType || "").toLowerCase();
    if (raw.includes("aliyun") || raw === "ali" || raw.includes("阿里")) return "aliyun";
    if (raw.includes("baidu") || raw.includes("百度")) return "baidu";
    if (raw.includes("tianyi") || raw.includes("天翼")) return "tianyi";
    if (raw.includes("quark") || raw.includes("夸克")) return "quark";
    if (raw === "uc" || raw.includes("uc")) return "uc";
    if (raw.includes("115")) return "115";
    if (raw.includes("xunlei") || raw.includes("迅雷")) return "xunlei";
    if (raw.includes("cmcc") || raw.includes("mobile") || raw.includes("139") || raw.includes("移动")) return "cmcc";
    if (raw.includes("pan123") || raw === "123" || raw.includes("123")) return "pan123";
    return raw;
}

function inferDriveTypeFromShareURL(shareURL = "") {
    const raw = String(shareURL || "").toLowerCase();
    if (!raw) return "";
    if (raw.includes("pan.quark.cn") || raw.includes("drive.quark.cn")) return "quark";
    if (raw.includes("drive.uc.cn") || raw.includes("fast.uc.cn")) return "uc";
    if (raw.includes("pan.baidu.com")) return "baidu";
    if (raw.includes("cloud.189.cn")) return "tianyi";
    if (raw.includes("yun.139.com")) return "cmcc";
    if (raw.includes("www.aliyundrive.com") || raw.includes("www.alipan.com") || raw.includes("aliyundrive.com") || raw.includes("alipan.com")) return "aliyun";
    if (raw.includes("pan.xunlei.com")) return "xunlei";
    if (raw.includes("115.com")) return "115";
    if (raw.includes("123684.com") || raw.includes("123865.com") || raw.includes("123912.com") || raw.includes("123pan.com")) return "pan123";
    return "";
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
            const parts = flag.split("-");
            routeType = parts[parts.length - 1];
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
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        return 0;
    });
}

function sortGroupResultsByDriveOrder(results = []) {
    if (!Array.isArray(results) || results.length <= 1 || DRIVE_ORDER.length === 0) {
        return results;
    }

    const orderMap = new Map(DRIVE_ORDER.map((name, index) => [name, index]));
    return [...results].sort((a, b) => {
        const aType = normalizeDriveType(a?.panType || a?.vod_id || a?.vod_name || "");
        const bType = normalizeDriveType(b?.panType || b?.vod_id || b?.vod_name || "");
        const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
        const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        return 0;
    });
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

function buildCacheKey(prefix, value) {
    return `${prefix}:${value}`;
}


function isMagnetUrl(value = "") {
    return /^magnet:\?xt=urn:btih:/i.test(String(value || "").trim());
}

function normalizeMagnetTitle(name = "") {
    const raw = String(name || "").trim();
    if (!raw) return "磁力资源";
    return raw
        .replace(/\s*\|\s*/g, " ")
        .replace(/\$/g, " ")
        .replace(/#/g, " ")
        .trim() || "磁力资源";
}


function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanPlayLabel(value = "", fallback = "") {
    return String(value || fallback || "").replace(/[$#\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

function extractEpisodeNumber(name = "") {
    const text = String(name || "");
    const baseName = text.split(/[\\/]/).pop() || text;
    const basenamePatterns = [
        /^(\d{1,3})(?=\.(?!\d{3,4}p\b)|[._\-\s\[【])/i,
        /(?:^|[\s._\-【\[])(\d{1,3})(?=\.\d{3,4}p\b)/i,
    ];
    for (const pattern of basenamePatterns) {
        const match = baseName.match(pattern);
        if (!match) continue;
        const episode = Number(match[1]);
        if (Number.isFinite(episode) && episode > 0 && episode <= 300) return episode;
    }
    const patterns = [/S\d{1,2}E(\d{1,3})/i, /第\s*(\d{1,3})\s*[集话]/, /\[(\d{1,3})\s*[集话]\]/, /(?:^|[^A-Z0-9])E[P]?(\d{1,3})(?:[^A-Z0-9]|$)/i];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const episode = Number(match[1]);
        if (Number.isFinite(episode) && episode > 0 && episode <= 300) return episode;
    }
    return null;
}

function formatEpisodeLabel(ep, fallbackTitle = "") {
    if (Number.isFinite(ep) && ep > 0) return `第${String(ep).padStart(2, "0")}集`;
    return fallbackTitle || "资源";
}

function getScrapedEpisodeTitle(scrapeData, mapping = {}) {
    const episodeNumber = Number(mapping?.episodeNumber);
    if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) return "";
    const seasonNumber = Number(mapping?.seasonNumber || 1);
    const episodes = Array.isArray(scrapeData?.episodes) ? scrapeData.episodes : [];
    const episode = episodes.find((item) => {
        const itemEp = Number(item?.episodeNumber ?? item?.episode_number ?? item?.episode);
        const itemSeason = Number(item?.seasonNumber ?? item?.season_number ?? 1);
        return itemEp === episodeNumber && (!Number.isFinite(seasonNumber) || seasonNumber <= 0 || itemSeason === seasonNumber || !item?.seasonNumber);
    });
    return String(episode?.name || episode?.title || episode?.episodeName || episode?.overviewTitle || "").trim();
}

function buildScrapedEpisodeName(scrapeData, mapping, fallbackName, displayName = "") {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) return fallbackName;
    const scrapedEpisodeName = String(mapping?.episodeName || "").trim() || getScrapedEpisodeTitle(scrapeData, mapping);
    const episodeNumber = Number(mapping?.episodeNumber);
    const fallbackText = cleanPlayLabel(displayName || fallbackName || "", fallbackName || "");
    const sizePrefix = (fallbackText.match(/^\[[^\]]+\]\s*/) || [""])[0];
    const episodeLabel = Number.isFinite(episodeNumber) && episodeNumber > 0 ? formatEpisodeLabel(episodeNumber) : "";
    if (scrapedEpisodeName) return cleanPlayLabel(`${sizePrefix}${episodeLabel ? `${episodeLabel} ` : ""}${scrapedEpisodeName}`, fallbackName);
    return fallbackText || fallbackName;
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName = "", fallbackEpisodeName = "") {
    const title = String(scrapeData?.title || fallbackVodName || "").trim();
    if (!title) return "";
    if (scrapeType === "movie") return title;
    const seasonAirYear = String(scrapeData?.seasonAirYear || "").trim();
    const seasonNumber = Number(mapping?.seasonNumber || 1);
    const episodeNumber = Number(mapping?.episodeNumber || 1);
    const episodeName = String(mapping?.episodeName || "").trim() || getScrapedEpisodeTitle(scrapeData, mapping) || String(fallbackEpisodeName || "").trim();
    const prefix = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
    return episodeName ? `${prefix}.${episodeName}` : prefix;
}

function applyScrapeInfoToVod(vod = {}, scrapeData = {}, fallbackContent = "") {
    if (!scrapeData || typeof scrapeData !== "object") return vod;
    if (scrapeData.title) vod.vod_name = scrapeData.title;
    if (scrapeData.posterPath) vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
    if (scrapeData.releaseDate) vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || vod.vod_year || "";
    if (scrapeData.overview) vod.vod_content = scrapeData.overview;
    else if (!vod.vod_content) vod.vod_content = fallbackContent || "";
    if (scrapeData.voteAverage) vod.vod_douban_score = Number(scrapeData.voteAverage).toFixed(1);
    if (scrapeData.credits) {
        if (Array.isArray(scrapeData.credits.cast)) {
            vod.vod_actor = scrapeData.credits.cast.slice(0, 8).map((cast) => cast.name || cast.character || "").filter(Boolean).join(",");
        }
        if (Array.isArray(scrapeData.credits.crew)) {
            const directors = scrapeData.credits.crew.filter((crew) => crew.job === "Director" || crew.department === "Directing" || crew.known_for_department === "Directing");
            vod.vod_director = directors.slice(0, 5).map((director) => director.name || "").filter(Boolean).join(",");
        }
    }
    return vod;
}

function normalizeScrapeFileName(value = "") {
    return normalizeText(value).split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[._\-\[\]()【】（）]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeMappingEpisode(mapping = {}) {
    const rawEpisode = Number(mapping?.episodeNumber);
    const fileEpisode = extractEpisodeNumber(mapping?.fileName || mapping?.file_name || mapping?.name || mapping?.sourceFileName || mapping?.sourceName || "");
    if (Number.isFinite(fileEpisode) && fileEpisode > 0 && fileEpisode <= 300) return fileEpisode;
    if (Number.isFinite(rawEpisode) && rawEpisode > 0 && rawEpisode <= 300) return rawEpisode;
    return null;
}

function patchScrapeMappingEpisode(mapping = {}, correctedEpisode = null) {
    const ep = Number(correctedEpisode);
    if (!mapping || !Number.isFinite(ep) || ep <= 0) return mapping;
    if (Number(mapping.episodeNumber) === ep) return mapping;
    return { ...mapping, originalEpisodeNumber: mapping.episodeNumber || null, episodeNumber: ep };
}

function findScrapeMapping(metadata = {}, candidates = [], episodeNumber = null, rawName = "") {
    const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
    const rawEpisode = extractEpisodeNumber(rawName);
    for (const key of candidates.map((item) => String(item || "").trim()).filter(Boolean)) {
        const mapping = mappings.find((item) => String(item?.fileId || "").trim() === key);
        if (mapping) return patchScrapeMappingEpisode(mapping, rawEpisode || normalizeMappingEpisode(mapping));
    }
    const epNo = Number(rawEpisode || episodeNumber);
    if (Number.isFinite(epNo) && epNo > 0 && epNo <= 300) {
        const mapping = mappings.find((item) => normalizeMappingEpisode(item) === epNo);
        if (mapping) return patchScrapeMappingEpisode(mapping, epNo);
    }
    const normalizedRawName = normalizeScrapeFileName(rawName);
    if (normalizedRawName) {
        const mapping = mappings.find((item) => {
            const mappingName = normalizeScrapeFileName(item?.fileName || item?.file_name || item?.name || item?.sourceFileName || item?.sourceName || "");
            return mappingName && (mappingName === normalizedRawName || mappingName.includes(normalizedRawName) || normalizedRawName.includes(mappingName));
        });
        if (mapping) return patchScrapeMappingEpisode(mapping, rawEpisode || normalizeMappingEpisode(mapping));
    }
    return null;
}

async function getMergedMetadataCached(videoId = "", title = "", scrapeCandidates = []) {
    const metadataCacheKey = buildCacheKey("pansou-group:metadata", videoId);
    const cached = await getCachedJSON(metadataCacheKey);
    if (cached && cached.scrapeData) return { scrapeData: cached.scrapeData || null, videoMappings: Array.isArray(cached.videoMappings) ? cached.videoMappings : [], scrapeType: cached.scrapeType || "" };
    if (!Array.isArray(scrapeCandidates) || scrapeCandidates.length === 0 || typeof OmniBox?.processScraping !== "function") return { scrapeData: null, videoMappings: [], scrapeType: "" };
    try {
        logInfo("开始刮削元数据", { videoId, title, candidateCount: scrapeCandidates.length, candidatePreview: scrapeCandidates.slice(0, 3).map((item) => ({ fid: item.fid || item.file_id || "", file_name: item.file_name || item.name || "" })) });
        const scrapingResult = await OmniBox.processScraping(String(videoId || ""), title || "", title || "", scrapeCandidates);
        const metadata = await OmniBox.getScrapeMetadata(String(videoId || ""));
        const result = { scrapeData: metadata?.scrapeData || null, videoMappings: Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [], scrapeType: metadata?.scrapeType || "" };
        await setCachedJSON(metadataCacheKey, result, PANSOU_GROUP_CACHE_EX_SECONDS);
        logInfo("刮削元数据完成", { videoId, mappingCount: result.videoMappings.length, scrapeType: result.scrapeType || "", processResultKeys: scrapingResult && typeof scrapingResult === "object" ? Object.keys(scrapingResult).slice(0, 12) : [] });
        return result;
    } catch (error) { logWarn("刮削元数据失败", { videoId, title, error: error.message || String(error) }); return { scrapeData: null, videoMappings: [], scrapeType: "" }; }
}

function logInfo(message, data) {
    OmniBox.log("info", data === undefined ? message : `${message}: ${JSON.stringify(data)}`);
}

function logWarn(message, data) {
    OmniBox.log("warn", data === undefined ? message : `${message}: ${JSON.stringify(data)}`);
}

function logError(message, error) {
    const text = error && error.message ? error.message : String(error || "未知错误");
    OmniBox.log("error", `${message}: ${text}`);
}

function safeJsonParse(text, fallback = {}) {
    try {
        return JSON.parse(String(text || ""));
    } catch (_) {
        return fallback;
    }
}

function getDefaultHeaders() {
    return {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
    };
}

function build115MagnetCacheKey(magnet = "") {
    const hash = crypto.createHash("sha1").update(String(magnet || "").trim().toLowerCase()).digest("hex");
    return `pansou-group:115-magnet:${hash}`;
}

function build115FileCacheKey(fileName = "") {
    const hash = crypto.createHash("sha1").update(String(fileName || "").trim()).digest("hex");
    return `pansou-group:115-file:${hash}`;
}

function build115MagnetPlayId(meta = {}) {
    return Buffer.from(JSON.stringify({
        kind: "115magnetplay",
        magnet: String(meta.magnet || "").trim(),
        fileName: String(meta.fileName || "").trim(),
        fileId: String(meta.fileId || "").trim(),
        pickcode: String(meta.pickcode || "").trim(),
        sid: String(meta.sid || "").trim(),
        fid: String(meta.fid || "").trim(),
        v: String(meta.v || "").trim(),
        e: String(meta.e || "").trim(),
        n: meta.n || "",
    }), "utf8").toString("base64");
}

function decode115MagnetPlayMeta(playId) {
    const raw = String(playId || "").trim();
    if (!raw) return {};
    const base64 = raw.replace(/^115magnet:/, "");
    try {
        const decoded = Buffer.from(base64, "base64").toString("utf8");
        const data = safeJsonParse(decoded, {}) || {};
        return data && typeof data === "object" ? data : {};
    } catch (_) {
        return {};
    }
}

function is115MagnetPlayId(playId, flag = "") {
    if (String(playId || "").trim().startsWith("115magnet:")) return true;
    if (String(flag || "").trim() === "115秒传") return true;
    return decode115MagnetPlayMeta(playId)?.kind === "115magnetplay";
}

function normalize115OfflineFiles(files = []) {
    return (Array.isArray(files) ? files : [])
        .map((file, index) => ({
            id: String(file?.id || file?.fid || file?.file_id || file?.pickcode || file?.pick_code || index).trim(),
            name: String(file?.name || file?.file_name || file?.server_filename || `115文件${index + 1}`).trim(),
            size: Number(file?.size || file?.file_size || 0) || 0,
            pickcode: String(file?.pickcode || file?.pick_code || "").trim(),
        }))
        .filter((file) => file.id && file.name);
}

async function cache115MagnetResult(magnet, result) {
    const normalizedMagnet = String(magnet || "").trim();
    if (!normalizedMagnet || !result || !Array.isArray(result.files) || result.files.length === 0) return;
    await setCachedJSON(build115MagnetCacheKey(normalizedMagnet), result, GLOBAL_115_MAGNET_CACHE_EX_SECONDS);
}

async function pushMagnetTo115(magnet, options = {}) {
    const cookie = GLOBAL_115_COOKIE;
    const normalizedMagnet = String(magnet || "").trim();
    const useCache = options.useCache !== false;
    const pollIntervalMs = Number(options.pollIntervalMs || 1500);
    const pollMaxAttempts = Number(options.pollMaxAttempts || 4);
    if (!cookie) {
        logWarn("115秒传跳过: 未配置 GLOBAL_115_COOKIE");
        return { ok: false, state: "no_cookie", files: [], magnet: normalizedMagnet };
    }
    if (!isMagnetUrl(normalizedMagnet)) {
        logWarn("115秒传跳过: 无效磁力链接");
        return { ok: false, state: "invalid_magnet", files: [], magnet: normalizedMagnet };
    }
    const cacheKey = build115MagnetCacheKey(normalizedMagnet);
    if (useCache) {
        const cached = await getCachedJSON(cacheKey);
        if (cached && Array.isArray(cached.files) && cached.files.length > 0) {
            logInfo("115秒传缓存命中", { magnet: normalizedMagnet.substring(0, 80), fileCount: cached.files.length });
            return { ...cached, ok: true, state: cached.state || "cached", magnet: normalizedMagnet, cached: true };
        }
    }
    try {
        const uidMatch = cookie.match(/UID=(\d+)/);
        const uid = uidMatch ? uidMatch[1] : "";
        if (!uid) {
            logWarn("115秒传失败: 无法从 cookie 提取 UID");
            return { ok: false, state: "missing_uid", files: [], magnet: normalizedMagnet };
        }
        const commonHeaders = {
            ...getDefaultHeaders(),
            "Cookie": cookie,
            "Origin": "https://115.com",
            "Referer": "https://115.com/web/lixian/",
            "X-Requested-With": "XMLHttpRequest",
        };
        const httpsAgent = new (require("https").Agent)({ rejectUnauthorized: false });
        const spaceRes = await axios.get("https://115.com/?ct=offline&ac=space", { headers: commonHeaders, timeout: 10000, httpsAgent });
        const spaceJson = spaceRes.data || {};
        if (!spaceJson.state || !spaceJson.sign || !spaceJson.time) {
            logWarn("115秒传失败: 签名数据不完整", { state: spaceJson.state, hasSign: !!spaceJson.sign, hasTime: !!spaceJson.time });
            return { ok: false, state: "space_invalid", files: [], magnet: normalizedMagnet, raw: spaceJson };
        }
        const addTask = async () => {
            const addRes = await axios.post(
                "https://115.com/web/lixian/?ct=lixian&ac=add_task_url",
                `url=${encodeURIComponent(normalizedMagnet)}&uid=${uid}&sign=${spaceJson.sign}&time=${spaceJson.time}`,
                {
                    headers: { ...commonHeaders, "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
                    timeout: 15000,
                    httpsAgent,
                }
            );
            return addRes.data || {};
        };
        const pollTaskUntilFiles = async (firstJson) => {
            let currentJson = firstJson || {};
            for (let attempt = 0; attempt < pollMaxAttempts; attempt++) {
                const currentFiles = normalize115OfflineFiles(currentJson?.files || []);
                if (currentFiles.length > 0) return { json: currentJson, files: currentFiles, attempts: attempt };
                await sleep(pollIntervalMs);
                currentJson = await addTask();
                const nextFiles = normalize115OfflineFiles(currentJson?.files || []);
                if (nextFiles.length > 0) return { json: currentJson, files: nextFiles, attempts: attempt + 1 };
                if (currentJson?.errcode === 10008) return { json: currentJson, files: nextFiles, attempts: attempt + 1 };
            }
            return { json: currentJson, files: normalize115OfflineFiles(currentJson?.files || []), attempts: pollMaxAttempts };
        };
        const addJson = await addTask();
        let files = normalize115OfflineFiles(addJson?.files || []);
        let finalJson = addJson;
        let pollAttempts = 0;
        if ((addJson.state || addJson.errcode === 0 || addJson.errcode === 10008) && files.length === 0) {
            const polled = await pollTaskUntilFiles(addJson);
            finalJson = polled.json || addJson;
            files = polled.files || [];
            pollAttempts = polled.attempts || 0;
        }
        if (finalJson.state || finalJson.errcode === 0 || finalJson.errcode === 10008) {
            const result = {
                ok: true,
                state: finalJson.errcode === 10008 ? "exists" : (files.length > 0 ? "submitted" : "submitted_waiting"),
                magnet: normalizedMagnet,
                infoHash: String(finalJson.info_hash || "").trim(),
                files,
                raw: finalJson,
            };
            logInfo(finalJson.errcode === 10008 ? "115任务已存在" : (files.length > 0 ? "115秒传成功" : "115秒传提交后轮询中"), {
                magnet: normalizedMagnet.substring(0, 80),
                fileCount: files.length,
                attempts: pollAttempts,
            });
            if (files.length > 0) await cache115MagnetResult(normalizedMagnet, result);
            return result;
        }
        logWarn("115秒传失败", { state: finalJson.state, errcode: finalJson.errcode, message: finalJson.error_msg || finalJson.msg || "" });
        return { ok: false, state: "add_failed", files, magnet: normalizedMagnet, raw: finalJson };
    } catch (error) {
        logError("115秒传异常", error);
        return { ok: false, state: "exception", files: [], magnet: normalizedMagnet, error: error.message || String(error) };
    }
}

async function build115EpisodesFromMagnet(magnet, baseName = "115资源", detailMeta = {}) {
    const result = await pushMagnetTo115(magnet);
    if (!result?.ok || !Array.isArray(result.files) || result.files.length === 0) { logWarn("115秒传未生成剧集", { magnet: String(magnet || "").slice(0, 100), state: result?.state || "unknown", fileCount: Array.isArray(result?.files) ? result.files.length : 0 }); return { name: "115秒传", episodes: [], result }; }
    const infoHash = result.infoHash || crypto.createHash("sha1").update(String(magnet || "")).digest("hex");
    const episodes = result.files.map((file, index) => {
        const rawName = cleanPlayLabel(file.name || `${baseName}${index + 1}`, `${baseName}${index + 1}`);
        const sizePrefix = file.size > 0 ? `[${formatFileSize(file.size)}] ` : "";
        const displayName = `${sizePrefix}${rawName}`;
        const epNo = extractEpisodeNumber(rawName);
        const displayTitle = displayName || rawName || `${baseName}${index + 1}`;
        const fid = `115magnet:${infoHash}:${file.id}`;
        return { name: displayTitle, title: displayTitle, episodeName: displayTitle, playId: build115MagnetPlayId({ magnet, fileName: rawName, fileId: file.id, pickcode: file.pickcode, sid: detailMeta.sid || "", fid, v: detailMeta.v || "", e: displayTitle, n: Number.isFinite(epNo) && epNo > 0 ? epNo : "" }), size: file.size > 0 ? file.size : undefined, _fid: fid, _rawName: rawName, _displayName: displayName, fileName: rawName, _episodeNumber: Number.isFinite(epNo) && epNo > 0 ? epNo : undefined };
    });
    logInfo("115秒传文件分集生成完成", { magnet: String(magnet || "").slice(0, 100), episodeCount: episodes.length, episodeNamePreview: episodes.slice(0, 3).map((ep) => ep._displayName || ep.name) });
    return { name: "115秒传", episodes, result };
}

function build115Headers() {
    return {
        ...getDefaultHeaders(),
        "Cookie": GLOBAL_115_COOKIE,
        "Origin": "https://115.com",
        "Referer": "https://115.com/",
        "X-Requested-With": "XMLHttpRequest",
    };
}

function same115FileName(a = "", b = "") {
    const basename = (value) => String(value || "").split(/[\\/]/).pop().trim();
    return basename(a) && basename(a) === basename(b);
}

async function checkRapidTransferAvailable(shareURL) {
    if (!RAPID_TRANSFER_ENABLED) return { available: false, targets: [] };
    try {
        const result = await OmniBox.checkRapidTransfer(shareURL);
        if (result && result.available) {
            return { available: true, targets: Array.isArray(result.targetDrives) ? result.targetDrives : [], sourceDrive: result.sourceDrive || "" };
        }
    } catch (error) {
        logWarn("秒传可用性检查失败", { error: error.message || String(error) });
    }
    return { available: false, targets: [] };
}

async function rapidTransferPlay(shareURL, fileId, targetDrive, flag, context) {
    const result = await OmniBox.rapidTransferPlay(shareURL, fileId, targetDrive, flag || "直连");
    if (!result || !result.success) {
        throw new Error("秒传未命中: " + ((result && result.error) || "未知错误"));
    }
    const urls = Array.isArray(result.url) ? result.url : (result.url ? [{ name: "播放", url: result.url }] : []);
    return {
        urls: urls.map((item) => ({ name: item.name || "播放", url: item.url })),
        header: result.header || {},
        parse: 0,
        danmaku: result.danmaku || [],
    };
}

async function find115FileByName(fileName = "") {
    const targetName = String(fileName || "").trim();
    if (!targetName || !GLOBAL_115_COOKIE) return null;
    const key = build115FileCacheKey(targetName);
    const cached = await getCachedJSON(key);
    if (cached?.fid || cached?.pickcode) {
        logInfo("115文件搜索缓存命中", { fileName: targetName, fid: cached.fid || "", pickcode: cached.pickcode || "" });
        return cached;
    }
    const keyword = targetName.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 80);
    const url = `https://webapi.115.com/files/search?search_value=${encodeURIComponent(keyword)}&format=json&type=4&limit=50`;
    const res = await axios.get(url, { headers: build115Headers(), timeout: 10000, httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }) });
    const json = res.data || {};
    const list = Array.isArray(json?.data) ? json.data : (Array.isArray(json?.data?.list) ? json.data.list : (Array.isArray(json?.files) ? json.files : []));
    const normalized = list.map((item) => ({
        fid: String(item.fid || item.file_id || item.id || item.cid || "").trim(),
        name: String(item.n || item.name || item.file_name || item.server_filename || "").trim(),
        pickcode: String(item.pc || item.pickcode || item.pick_code || "").trim(),
        size: Number(item.s || item.size || item.file_size || 0) || 0,
    })).filter((item) => item.name && (item.fid || item.pickcode));
    const matched = normalized.find((item) => same115FileName(item.name, targetName)) || normalized[0] || null;
    logInfo("115文件搜索结果", { keyword, targetName, resultCount: normalized.length, matched: matched?.name || "" });
    if (matched) await setCachedJSON(key, matched, GLOBAL_115_MAGNET_CACHE_EX_SECONDS);
    return matched;
}

async function get115VideoPlayUrl(file) {
    const pickcode = String(file?.pickcode || file?.pc || "").trim();
    if (!pickcode) throw new Error("115真实文件缺少 pickcode，无法解析播放地址");
    const headers = build115Headers();
    const urls = [`https://115.com/api/video/m3u8/${encodeURIComponent(pickcode)}.m3u8`, `https://webapi.115.com/files/video?pickcode=${encodeURIComponent(pickcode)}`];
    let lastError = null;
    for (const url of urls) {
        try {
            const res = await axios.get(url, { headers, timeout: 10000, maxRedirects: 0, validateStatus: (status) => status >= 200 && status < 400, httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }) });
            const location = res.headers?.location || "";
            if (location) return location;
            if (typeof res.data === "string" && res.data.includes("#EXTM3U")) return url;
            const data = res.data || {};
            const candidate = data?.data?.video_url || data?.data?.url || data?.video_url || data?.url || data?.data?.m3u8 || data?.m3u8 || "";
            if (candidate) return candidate;
        } catch (error) {
            lastError = error;
            logWarn("115视频地址解析尝试失败", { pickcode, url, error: error.message || String(error) });
        }
    }
    throw lastError || new Error("115未返回可播放地址");
}

async function resolve115MagnetPlay(playId, flag, callerSource, context, params = {}) {
    const data = typeof playId === "object" && playId ? playId : decode115MagnetPlayMeta(playId);
    const magnet = String(data.magnet || "").trim();
    const targetFileId = String(data.fileId || "").trim();
    const result = await pushMagnetTo115(magnet);
    const targetFile = (result.files || []).find((file) => String(file.id) === targetFileId) || (result.files || [])[0];
    if (!targetFile?.name) throw new Error("115秒传缓存未找到目标文件名");
    const realFile = await find115FileByName(targetFile.name);
    if (!realFile) throw new Error("115网盘内未搜索到真实文件");
    const metadataPromise = (async () => {
        const metaResult = { danmakuList: [], episodeNumber: data.n || null, episodeName: String(data.e || params.episodeName || "").trim(), mappingMatched: false, mappingFileId: "", danmuFileName: "" };
        const videoIdForScrape = String(params.vodId || data.sid || "").trim();
        if (!videoIdForScrape) { logWarn("115秒传弹幕跳过: 缺少视频ID", { fileId: targetFileId, fileName: targetFile.name || data.fileName || "" }); return metaResult; }
        try {
            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) { logWarn("115秒传弹幕跳过: 无刮削元数据", { videoId: videoIdForScrape, hasMetadata: !!metadata }); return metaResult; }
            const infoHash = result.infoHash || crypto.createHash("sha1").update(String(magnet || "")).digest("hex");
            const syntheticFid = `115magnet:${infoHash}:${targetFile.id}`;
            const epNo = Number(data.n || extractEpisodeNumber(data.e || targetFile.name || data.fileName || ""));
            const mapping = findScrapeMapping(metadata, [data.fid, syntheticFid, targetFile._fid].filter(Boolean), Number.isFinite(epNo) && epNo > 0 ? epNo : null, targetFile.name || data.fileName || "");
            if (!mapping) { logWarn("115秒传弹幕未命中刮削映射", { videoId: videoIdForScrape, fid: data.fid || syntheticFid, fileId: targetFileId, fileName: targetFile.name || data.fileName || "", mappingPreview: metadata.videoMappings.slice(0, 3).map((item) => String(item?.fileId || "").slice(0, 120)) }); return metaResult; }
            const scrapeData = metadata.scrapeData;
            metaResult.mappingMatched = true; metaResult.mappingFileId = String(mapping.fileId || "");
            if (mapping.episodeNumber) metaResult.episodeNumber = mapping.episodeNumber;
            const scrapedEpisodeDisplayName = buildScrapedEpisodeName(scrapeData, mapping, targetFile.name || data.fileName || "", data.e || "");
            if (scrapedEpisodeDisplayName) metaResult.episodeName = scrapedEpisodeDisplayName;
            const fileName = buildScrapedDanmuFileName(scrapeData, metadata.scrapeType || "", mapping, String(params.vodName || data.v || scrapeData.title || "").trim(), metaResult.episodeName);
            metaResult.danmuFileName = fileName;
            if (fileName && typeof OmniBox.getDanmakuByFileName === "function") { const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName); if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) metaResult.danmakuList = matchedDanmaku; logInfo("115秒传弹幕匹配完成", { videoId: videoIdForScrape, fileName, mappingFileId: metaResult.mappingFileId, danmakuCount: metaResult.danmakuList.length }); }
        } catch (error) { logWarn("读取115秒传弹幕元数据失败", { error: error.message || String(error) }); }
        return metaResult;
    })();
    const [playUrlResult, metadataResult] = await Promise.allSettled([get115VideoPlayUrl(realFile), metadataPromise]);
    if (playUrlResult.status !== "fulfilled") throw playUrlResult.reason || new Error("115未返回可播放地址");
    const playUrl = playUrlResult.value;
    const metadataValue = metadataResult.status === "fulfilled" ? metadataResult.value : null;
    const finalDanmaku = Array.isArray(metadataValue?.danmakuList) ? metadataValue.danmakuList : [];
    const playResult = { urls: [{ name: "115播放", url: playUrl }], flag: "115网盘", header: { "User-Agent": getDefaultHeaders()["User-Agent"], "Referer": "https://115.com/", "Cookie": GLOBAL_115_COOKIE }, parse: 0, danmaku: finalDanmaku };
    logInfo("115磁力文件播放地址返回", { fid: realFile.fid || "", pickcode: realFile.pickcode || "", fileName: realFile.name || targetFile.name, outputUrlCount: playResult.urls.length, danmakuCount: finalDanmaku.length, episodeNumber: metadataValue?.episodeNumber || data.n || null, episodeName: metadataValue?.episodeName || data.e || "" });
    return playResult;
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

// 网盘类型映射
const PAN_TYPES = {
    quark: "quark",
    uc: "uc",
    pikpak: "pikpak",
    tianyi: "tianyi",
    mobile: "mobile",
    "115": "115",
    baidu: "baidu",
    aliyun: "aliyun",
    xunlei: "xunlei",
    "123": "123"
};

// 网盘图标
const PAN_PICS = {
    aliyun: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/ali.jpg",
    quark: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/quark.png",
    uc: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/uc.png",
    pikpak: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/pikpak.jpg",
    xunlei: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/thunder.png",
    "123": "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/123.png",
    tianyi: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/189.png",
    mobile: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/139.jpg",
    "115": "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/115.jpg",
    baidu: "https://gh-proxy.org/https://github.com//power721/alist-tvbox/raw/refs/heads/master/web-ui/public/baidu.jpg"
};

// 网盘名称
const PAN_NAMES = {
    quark: "夸克网盘",
    uc: "UC网盘",
    pikpak: "PikPak",
    tianyi: "天翼网盘",
    mobile: "移动云盘",
    "115": "115网盘",
    baidu: "百度网盘",
    aliyun: "阿里云盘",
    xunlei: "迅雷网盘",
    "123": "123网盘"
};

// 画质关键词（按优先级排序）
const QUALITY_KEYWORDS = [
    'HDR', '杜比视界', 'DV',
    'REMUX', 'HQ', "臻彩", '高码', '高画质',
    '60FPS', '60帧', '高帧率', '60HZ',
    "4K", "2160P",
    "SDR", "1080P", "HD", "高清",
    "720P", "标清"
];

// 完结关键词
const COMPLETED_KEYWORDS = ["完结", "全集", "已完成", "全"];

/**
* 发送 HTTP 请求到盘搜API
*/
async function requestPansouAPI(params = {}) {
    if (!PANSOU_API) {
        throw new Error("请配置盘搜API地址(PANSOU_API 环境变量)");
    }

    const url = new URL(`${PANSOU_API}/api/search`);
    const body = {};
    body.kw = params.keyword || "";
    body.refresh = false;
    body.res = "merge";
    body.src = "all";

    if (PANSOU_CHANNELS) {
        body.channels = PANSOU_CHANNELS.split(',');
    }
    if (PANSOU_PLUGINS) {
        body.plugins = PANSOU_PLUGINS.split(',');
    }
    if (params.cloud_types) {
        body.cloud_types = params.cloud_types;
    } else if (PANSOU_CLOUD_TYPES) {
        body.cloud_types = splitConfigList(PANSOU_CLOUD_TYPES);
    }
    if (PANSOU_FILTER) {
        body.filter = PANSOU_FILTER;
    }

    OmniBox.log("info", `请求盘搜API: ${JSON.stringify(body)}`);

    try {
        const response = await OmniBox.request(url.toString(), {
            method: "POST",
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: body
        });

        if (response.statusCode !== 200) {
            throw new Error(`HTTP ${response.statusCode}: ${response.body?.substring(0, 200) || ""}`);
        }

        if (!response.body) {
            throw new Error("盘搜API返回空响应");
        }

        const data = JSON.parse(response.body);
        return data;
    } catch (error) {
        OmniBox.log("error", `请求盘搜API失败: ${error.message}`);
        throw error;
    }
}

/**
* 调用 PanCheck API 检测链接有效性
*/
function getPanCheckSelectedPlatforms() {
    return splitConfigList(PANCHECK_PLATFORMS)
        .map((p) => normalizeDriveType(p))
        .filter(Boolean);
}

function splitLinksByPanCheckPlatforms(links = []) {
    const allLinks = Array.isArray(links) ? links.filter(Boolean) : [];
    const selectedPlatforms = getPanCheckSelectedPlatforms();

    if (selectedPlatforms.length === 0) {
        return {
            selectedPlatforms: [],
            linksToCheck: allLinks,
            bypassLinks: [],
        };
    }

    const selectedPlatformSet = new Set(selectedPlatforms);
    const linksToCheck = [];
    const bypassLinks = [];

    for (const link of allLinks) {
        const inferredByUrl = inferDriveTypeFromShareURL(link);
        const inferredBySdk = normalizeDriveType(OmniBox.getDriveInfoByShareURL(link)?.driveType || "");
        const driveType = inferredByUrl || inferredBySdk;
        if (selectedPlatformSet.has(driveType)) {
            linksToCheck.push(link);
        } else {
            bypassLinks.push(link);
        }
    }

    return {
        selectedPlatforms,
        linksToCheck,
        bypassLinks,
    };
}

async function checkLinksWithPanCheck(links) {
    if (!PANCHECK_ENABLED || !PANCHECK_API || links.length === 0) {
        return {
            invalidLinksSet: new Set(),
            stats: null,
        };
    }

    try {
        const { selectedPlatforms, linksToCheck, bypassLinks } = splitLinksByPanCheckPlatforms(links);
        const detectDriveType = (link) => inferDriveTypeFromShareURL(link) || normalizeDriveType(OmniBox.getDriveInfoByShareURL(link)?.driveType || "") || "unknown";
        const inputPlatformStats = {};

        for (const link of links) {
            const driveType = detectDriveType(link);
            inputPlatformStats[driveType] = (inputPlatformStats[driveType] || 0) + 1;
        }

        if (linksToCheck.length === 0) {
            OmniBox.log("info", `PanCheck 跳过: 未命中待校验平台, 跳过链接数量: ${bypassLinks.length}`);
            return {
                invalidLinksSet: new Set(),
                stats: {
                    selectedPlatforms,
                    inputPlatformStats,
                    checkedPlatformStats: {},
                    invalidPlatformStats: {},
                    validPlatformStats: {},
                    bypassPlatformStats: inputPlatformStats,
                    totalInput: links.length,
                    totalChecked: 0,
                    totalInvalid: 0,
                    totalValid: 0,
                    totalBypass: bypassLinks.length,
                    totalOutput: links.length,
                },
            };
        }

        OmniBox.log("info", `开始调用 PanCheck 检测链接, 总链接: ${links.length}, 待校验: ${linksToCheck.length}, 跳过: ${bypassLinks.length}, 平台: ${selectedPlatforms.join(",") || "全部"}`);

        const requestBody = { links: linksToCheck };

        if (selectedPlatforms.length > 0) {
            requestBody.selected_platforms = selectedPlatforms;
        }

        const apiUrl = PANCHECK_API.replace(/\/$/, "");
        const checkURL = `${apiUrl}/api/v1/links/check`;

        const response = await OmniBox.request(checkURL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify(requestBody),
        });

        if (response.statusCode !== 200) {
            OmniBox.log("warn", `PanCheck API 响应错误: ${response.statusCode}`);
            return {
                invalidLinksSet: new Set(),
                stats: null,
            };
        }

        const data = JSON.parse(response.body);
        const invalidLinks = data.invalid_links || [];
        const validLinks = data.valid_links || [];
        const invalidLinksSet = new Set(invalidLinks);
        const checkedPlatformStats = {};
        const invalidPlatformStats = {};
        const validPlatformStats = {};
        const bypassPlatformStats = {};

        for (const link of linksToCheck) {
            const driveType = detectDriveType(link);
            checkedPlatformStats[driveType] = (checkedPlatformStats[driveType] || 0) + 1;
            if (invalidLinksSet.has(link)) {
                invalidPlatformStats[driveType] = (invalidPlatformStats[driveType] || 0) + 1;
            } else {
                validPlatformStats[driveType] = (validPlatformStats[driveType] || 0) + 1;
            }
        }

        for (const link of bypassLinks) {
            const driveType = detectDriveType(link);
            bypassPlatformStats[driveType] = (bypassPlatformStats[driveType] || 0) + 1;
        }

        OmniBox.log("info", `PanCheck 检测完成,有效链接: ${validLinks.length}, 无效链接: ${invalidLinks.length}, 未校验直出: ${bypassLinks.length}`);

        return {
            invalidLinksSet,
            stats: {
                selectedPlatforms,
                inputPlatformStats,
                checkedPlatformStats,
                invalidPlatformStats,
                validPlatformStats,
                bypassPlatformStats,
                totalInput: links.length,
                totalChecked: linksToCheck.length,
                totalInvalid: invalidLinks.length,
                totalValid: validLinks.length,
                totalBypass: bypassLinks.length,
                totalOutput: (links.length - invalidLinks.length),
            },
        };
    } catch (error) {
        OmniBox.log("warn", `PanCheck 链接检测失败: ${error.message}`);
        return {
            invalidLinksSet: new Set(),
            stats: null,
        };
    }
}

/**
* 从盘搜结果中提取所有链接
*/
function extractLinksFromSearchData(data) {
    const links = [];

    if (!data || !data.data) {
        return links;
    }

    const mergedByType = data.data.merged_by_type || {};

    for (const [driveType, driveResults] of Object.entries(mergedByType)) {
        if (!Array.isArray(driveResults)) {
            continue;
        }

        for (const item of driveResults) {
            if (typeof item !== "object" || item === null) {
                continue;
            }

            const shareURL = String(item.url || item.URL || "");
            if (shareURL) {
                links.push(shareURL);
            }
        }
    }

    return links;
}

/**
* 计算画质得分
*/
function getQualityScore(name) {
    const upper = name.toUpperCase();
    let score = 0, cnt = 0;
    for (let i = 0; i < QUALITY_KEYWORDS.length; i++) {
        if (upper.includes(QUALITY_KEYWORDS[i].toUpperCase())) {
            score += QUALITY_KEYWORDS.length - i;
            cnt++;
        }
    }
    return score + cnt;
}

/**
* 计算关键词数量
*/
function getCount(name, arr) {
    const upper = name.toUpperCase();
    let c = 0;
    for (const kw of arr) {
        if (upper.includes(kw.toUpperCase())) c++;
    }
    return c;
}

/**
* 格式化盘搜结果（分组模式）
*/
async function formatDriveSearchResultsGrouped(data, keyword, validLinksSet) {
    OmniBox.log("info", `开始格式化盘搜结果（分组模式）`);

    if (!data || !data.data) {
        return [];
    }

    const mergedByType = data.data.merged_by_type || {};
    const panCounts = {};

    // 统计每个网盘的有效结果数量
    for (const [driveType, driveResults] of Object.entries(mergedByType)) {
        if (!Array.isArray(driveResults)) {
            continue;
        }

        const count = driveResults.filter(item =>
            validLinksSet.has(String(item.url || item.URL || ""))
        ).length;

        if (count > 0) {
            panCounts[driveType] = count;
        }
    }

    const results = [];

    // 生成网盘分类列表
    for (const [driveType, count] of Object.entries(panCounts)) {
        const pic = PAN_PICS[driveType] || "";
        const name = PAN_NAMES[driveType] || driveType;

        results.push({
            vod_id: `${driveType}|${keyword}`,
            vod_name: name,
            vod_pic: pic,
            type_id: "pan_category",
            type_name: "网盘分类",
            vod_remarks: `${count}条结果`,
            vod_tag: "folder",
            panType: driveType,
        });
    }

    const sortedResults = sortGroupResultsByDriveOrder(results);
    if (sortedResults.length > 1) {
        OmniBox.log("info", `分组按 DRIVE_ORDER 排序后顺序: ${sortedResults.map((item) => item.panType || item.vod_name || "未知").join(" | ")}`);
    }

    OmniBox.log("info", `格式化完成（分组模式）,分类数量: ${sortedResults.length}`);
    return sortedResults;
}

/**
* 格式化盘搜结果（具体网盘）
*/
async function formatDriveSearchResultsSpecific(data, keyword, targetPanType, validLinksSet) {
    OmniBox.log("info", `开始格式化盘搜结果（具体网盘: ${targetPanType}）`);

    if (!data || !data.data) {
        return [];
    }

    const mergedByType = data.data.merged_by_type || {};
    const driveResults = mergedByType[targetPanType] || [];

    if (!Array.isArray(driveResults)) {
        return [];
    }

    const results = [];
    const pic = PAN_PICS[targetPanType] || "";

    for (const item of driveResults) {
        if (typeof item !== "object" || item === null) {
            continue;
        }

        const shareURL = String(item.url || item.URL || "");
        const note = String(item.note || item.Note || "");
        const datetime = String(item.datetime || item.Datetime || "");
        const source = item.source ? String(item.source).replace(/plugin:/gi, "plg:") : "";

        if (!shareURL) {
            continue;
        }

        // 只保留有效链接
        if (!validLinksSet.has(shareURL)) {
            continue;
        }

        const driveInfo = isMagnetUrl(shareURL)
            ? { displayName: "磁力", iconUrl: pic, driveType: "magnet" }
            : await OmniBox.getDriveInfoByShareURL(shareURL);

        // 构建时间显示
        let timeDisplay = "";
        if (datetime) {
            try {
                const date = new Date(datetime);
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const year = String(date.getFullYear()).slice(-2);
                timeDisplay = `${month}${day}${year}`;
            } catch (e) {
                timeDisplay = "";
            }
        }

        const vodId = `${shareURL}|${keyword || ""}|${note}`;
        const vodName = note || shareURL;
        const remarks = source ? `${source} | ${timeDisplay}` : timeDisplay;

        results.push({
            vod_id: vodId,
            vod_name: vodName,
            vod_pic: pic || driveInfo.iconUrl,
            type_id: targetPanType,
            type_name: driveInfo.displayName,
            vod_remarks: remarks,
            vod_time: datetime,
            _datetime: datetime, // 用于排序
        });
    }

    // 排序逻辑
    results.sort((a, b) => {
        // 1. 按画质得分排序
        const qa = getQualityScore(a.vod_name);
        const qb = getQualityScore(b.vod_name);
        if (qa !== qb) return qb - qa;

        // 2. 按完结关键词排序
        const ca = getCount(a.vod_name, COMPLETED_KEYWORDS);
        const cb = getCount(b.vod_name, COMPLETED_KEYWORDS);
        if (ca !== cb) return cb - ca;

        // 3. 按画质关键词数量排序
        const qa2 = getCount(a.vod_name, QUALITY_KEYWORDS);
        const qb2 = getCount(b.vod_name, QUALITY_KEYWORDS);
        if (qa2 !== qb2) return qb2 - qa2;

        // 4. 按时间排序
        const timeA = a._datetime ? new Date(a._datetime).getTime() : 0;
        const timeB = b._datetime ? new Date(b._datetime).getTime() : 0;
        if (timeB !== timeA) return timeB - timeA;

        return 0;
    });

    // 移除临时排序字段
    results.forEach(item => delete item._datetime);

    OmniBox.log("info", `格式化完成（具体网盘）,结果数量: ${results.length}`);
    return results;
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
async function getAllVideoFiles(shareURL, files, pdirFid) {
    const videoFiles = [];

    for (const file of files) {
        if (file.file && isVideoFile(file)) {
            videoFiles.push(file);
        } else if (file.dir) {
            try {
                const subFileList = await OmniBox.getDriveFileList(shareURL, file.fid);
                if (subFileList && subFileList.files && Array.isArray(subFileList.files)) {
                    const subVideoFiles = await getAllVideoFiles(shareURL, subFileList.files, file.fid);
                    videoFiles.push(...subVideoFiles);
                }
            } catch (error) {
                OmniBox.log("warn", `获取子目录文件失败: ${error.message}`);
            }
        }
    }

    return videoFiles;
}

/**
* 构建刮削后的文件名
*/
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

/**
* 首页
*/
async function home(params) {
    try {
        const classes = [
            {
                type_id: "history",
                type_name: "最近观看",
            },
            {
                type_id: "favorite",
                type_name: "我的收藏",
            },
        ];

        try {
            const tags = await OmniBox.getSourceFavoriteTags();
            for (const tag of tags) {
                if (tag) {
                    classes.push({
                        type_id: tag,
                        type_name: tag,
                    });
                }
            }
        } catch (error) {
            OmniBox.log("warn", `获取收藏标签失败: ${error.message}`);
        }

        let list = [];
        try {
            const categoryData = await OmniBox.getSourceCategoryData("favorite", 1, 20);
            if (categoryData && categoryData.list && Array.isArray(categoryData.list)) {
                list = categoryData.list.map((item) => ({
                    vod_id: item.vod_id || item.VodID || "",
                    vod_name: item.vod_name || item.VodName || "",
                    vod_pic: item.vod_pic || item.VodPic || "",
                    type_id: item.type_id || item.TypeID || "",
                    type_name: item.type_name || item.TypeName || "",
                    vod_year: item.vod_year || item.VodYear || "",
                    vod_remarks: item.vod_remarks || item.VodRemarks || "",
                    vod_time: item.vod_time || item.VodTime || "",
                    vod_play_from: item.vod_play_from || item.VodPlayFrom || "",
                    vod_play_url: item.vod_play_url || item.VodPlayURL || "",
                    vod_douban_score: item.vod_douban_score || item.VodDoubanScore || "",
                }));
            }
        } catch (error) {
            OmniBox.log("warn", `获取收藏数据失败: ${error.message}`);
        }

        return {
            class: classes,
            list: list,
        };
    } catch (error) {
        OmniBox.log("error", `首页接口失败: ${error.message}`);
        return {
            class: [],
            list: [],
        };
    }
}

/**
* 分类
*/
async function category(params) {
    try {
        const categoryType = params.categoryId || params.type_id || "";
        const page = parseInt(params.page || "1", 10);
        const pageSize = 20;

        OmniBox.log("info", `分类接口调用,categoryType: ${categoryType}, page: ${page}`);

        // 检查是否是网盘分类的ID (格式: panType|keyword)
        if (categoryType.includes('|')) {
            const [panType, keyword] = categoryType.split('|');
            OmniBox.log("info", `检测到网盘分类跳转: panType=${panType}, keyword=${keyword}`);

            // 调用搜索接口，但指定特定网盘类型
            return await searchSpecificPan(keyword, page, panType);
        }

        if (!categoryType) {
            OmniBox.log("warn", "分类类型为空");
            return {
                list: [],
                page: 1,
                pagecount: 0,
                total: 0,
            };
        }

        const categoryData = await OmniBox.getSourceCategoryData(categoryType, page, pageSize);

        if (!categoryData || !categoryData.list || !Array.isArray(categoryData.list)) {
            return {
                list: [],
                page: page,
                pagecount: categoryData?.pageCount || 0,
                total: categoryData?.total || 0,
            };
        }

        const list = categoryData.list.map((item) => {
            const vodId = item.vod_id || "";
            const shareURL = vodId;
            const playFrom = shareURL;
            const playURL = "";

            return {
                vod_id: vodId,
                vod_name: item.vod_name || "",
                vod_pic: item.vod_pic || "",
                type_id: categoryType,
                type_name: item.type_name || "网盘资源",
                vod_year: item.vod_year || "",
                vod_remarks: item.vod_remarks || "",
                vod_play_from: playFrom,
                vod_play_url: playURL,
            };
        });

        return {
            list: list,
            page: page,
            pagecount: categoryData.pageCount || 0,
            total: categoryData.total || 0,
        };
    } catch (error) {
        OmniBox.log("error", `分类接口失败: ${error.message}`);
        return {
            list: [],
            page: 1,
            pagecount: 0,
            total: 0,
        };
    }
}

/**
* 搜索特定网盘
*/
async function searchSpecificPan(keyword, page, panType) {
    try {
        if (!PANSOU_API) {
            throw new Error("请配置盘搜API地址(PANSOU_API 环境变量)");
        }

        // 只在第一页时进行搜索，其他页返回空列表
        if (page > 1) {
            return {
                list: [],
                page: page,
                pagecount: 1,
                total: 0,
            };
        }

        OmniBox.log("info", `搜索特定网盘: panType=${panType}, keyword=${keyword}`);

        const pancheckCacheKey = buildCacheKey("pansou-group:pancheck", keyword);
        const cachedValidLinks = await getCachedJSON(pancheckCacheKey);
        let validLinksSet = null;

        if (cachedValidLinks && Array.isArray(cachedValidLinks.validLinks) && PANCHECK_ENABLED && PANCHECK_API) {
            validLinksSet = new Set(cachedValidLinks.validLinks);
            OmniBox.log("info", `PanCheck 缓存命中, 有效链接数: ${validLinksSet.size}, 跳过重复检测`);
        }

        // 调用盘搜API，指定网盘类型
        const response = await requestPansouAPI({
            keyword: keyword,
            cloud_types: [panType]
        });

        if (!validLinksSet) {
            const links = extractLinksFromSearchData(response);
            OmniBox.log("info", `PanCheck 缓存未命中, 提取到链接数量: ${links.length}`);

            validLinksSet = new Set(links);
            if (PANCHECK_ENABLED && PANCHECK_API && links.length > 0) {
                try {
                    const { invalidLinksSet, stats } = await checkLinksWithPanCheck(links);
                    validLinksSet = new Set(links.filter(link => !invalidLinksSet.has(link)));
                    if (stats) {
                        OmniBox.log("info", `PanCheck 分平台统计(${panType}): 输入=${JSON.stringify(stats.inputPlatformStats)}, 校验=${JSON.stringify(stats.checkedPlatformStats)}, 过滤=${JSON.stringify(stats.invalidPlatformStats)}, 剩余=${JSON.stringify(stats.validPlatformStats)}, 跳过=${JSON.stringify(stats.bypassPlatformStats)}`);
                        OmniBox.log("info", `PanCheck 总统计(${panType}): 总输入=${stats.totalInput}, 总校验=${stats.totalChecked}, 总过滤=${stats.totalInvalid}, 总剩余=${stats.totalOutput}, 其中直出=${stats.totalBypass}`);
                    }
                    OmniBox.log("info", `链接检测完成,有效链接: ${validLinksSet.size}, 无效链接: ${invalidLinksSet.size}`);
                } catch (error) {
                    OmniBox.log("warn", `PanCheck 处理失败: ${error.message}`);
                }
            }
        }

        // 格式化结果（具体网盘模式）
        const list = await formatDriveSearchResultsSpecific(response, keyword, panType, validLinksSet);

        return {
            list: list,
            page: page,
            pagecount: 1,
            total: list.length,
        };
    } catch (error) {
        OmniBox.log("error", `搜索特定网盘失败: ${error.message}`);
        return {
            list: [],
            page: 1,
            pagecount: 0,
            total: 0,
        };
    }
}

/**
* 搜索
*/
async function search(params) {
    try {
        OmniBox.log("info", `搜索接口调用,参数: ${JSON.stringify(params)}`);

        const keyword = params.keyword || "";
        const page = parseInt(params.page || "1", 10);

        // 只在第一页时进行搜索，其他页返回空列表
        if (page > 1) {
            return {
                list: [],
                page: page,
                pagecount: 1,
                total: 0,
            };
        }

        if (!keyword) {
            return {
                list: [],
                page: page,
                pagecount: 0,
                total: 0,
            };
        }

        if (!PANSOU_API) {
            throw new Error("请配置盘搜API地址(PANSOU_API 环境变量)");
        }

        // 调用盘搜API
        const response = await requestPansouAPI({ keyword });

        // 提取链接并进行检测
        const links = extractLinksFromSearchData(response);
        OmniBox.log("info", `提取到链接数量: ${links.length}`);

        let validLinksSet = new Set(links);
        if (PANCHECK_ENABLED && PANCHECK_API && links.length > 0) {
            try {
                const { invalidLinksSet, stats } = await checkLinksWithPanCheck(links);
                validLinksSet = new Set(links.filter(link => !invalidLinksSet.has(link)));
                if (stats) {
                    OmniBox.log("info", `PanCheck 分平台统计(分组搜索): 输入=${JSON.stringify(stats.inputPlatformStats)}, 校验=${JSON.stringify(stats.checkedPlatformStats)}, 过滤=${JSON.stringify(stats.invalidPlatformStats)}, 剩余=${JSON.stringify(stats.validPlatformStats)}, 跳过=${JSON.stringify(stats.bypassPlatformStats)}`);
                    OmniBox.log("info", `PanCheck 总统计(分组搜索): 总输入=${stats.totalInput}, 总校验=${stats.totalChecked}, 总过滤=${stats.totalInvalid}, 总剩余=${stats.totalOutput}, 其中直出=${stats.totalBypass}`);
                }
                OmniBox.log("info", `链接检测完成,有效链接: ${validLinksSet.size}, 无效链接: ${invalidLinksSet.size}`);

                const pancheckCacheKey = buildCacheKey("pansou-group:pancheck", keyword);
                await setCachedJSON(pancheckCacheKey, { validLinks: [...validLinksSet] }, PANSOU_GROUP_CACHE_EX_SECONDS);
                OmniBox.log("info", `PanCheck 结果已缓存, key=${pancheckCacheKey}, 有效链接数: ${validLinksSet.size}`);
            } catch (error) {
                OmniBox.log("warn", `PanCheck 处理失败: ${error.message}`);
            }
        }

        // 格式化结果（分组模式 - 显示网盘分类列表）
        const list = await formatDriveSearchResultsGrouped(response, keyword, validLinksSet);

        return {
            list: list,
            page: page,
            pagecount: 1,
            total: list.length,
        };
    } catch (error) {
        OmniBox.log("error", `搜索接口失败: ${error.message}`);
        return {
            list: [],
            page: 1,
            pagecount: 0,
            total: 0,
        };
    }
}

/**
* 详情
*/
async function detail(params, context) {
    try {
        OmniBox.log("info", `详情接口调用,参数: ${JSON.stringify(params)}`);

        const videoId = params.videoId || "";
        if (!videoId) {
            throw new Error("视频ID不能为空");
        }

        const source = resolveCallerSource(params, context);

        const parts = videoId.split("|");
        const shareURL = parts[0] || "";
        const keyword = parts[1] || "";
        const note = parts[2] || "";

        if (!shareURL) {
            throw new Error("分享链接不能为空");
        }

        OmniBox.log("info", `解析参数: shareURL=${shareURL}, keyword=${keyword}, note=${note}`);

        if (isMagnetUrl(shareURL)) {
            const episodeName = normalizeMagnetTitle(note || keyword || shareURL);
            OmniBox.log("info", `检测到磁力详情，跳过网盘 SDK 文件列表解析: keyword=${keyword}, title=${episodeName}`);
            const playSources = [];
            let magnetScrapeData = null;
            if (GLOBAL_115_COOKIE) {
                OmniBox.log("info", `磁力线路开始同步秒传115: has115Cookie=true, magnet=${shareURL.substring(0, 80)}`);
                try {
                    const pan115 = await build115EpisodesFromMagnet(shareURL, "115资源", { sid: videoId, v: keyword || episodeName });
                    if (Array.isArray(pan115.episodes) && pan115.episodes.length > 0) {
                        const scrapeCandidates = pan115.episodes.map((ep, index) => ({ fid: ep._fid || `115magnet:${index}`, file_id: ep._fid || `115magnet:${index}`, file_name: ep._rawName || ep.fileName || ep.name || `115资源${index + 1}`, name: ep._rawName || ep.fileName || ep.name || `115资源${index + 1}`, format_type: "video" }));
                        const metadata = await getMergedMetadataCached(videoId, keyword || episodeName, scrapeCandidates);
                        magnetScrapeData = metadata.scrapeData || null;
                        logInfo("磁力/115线路刮削映射统计", { videoId, scrapeCandidateCount: scrapeCandidates.length, mappingCount: Array.isArray(metadata.videoMappings) ? metadata.videoMappings.length : 0, scrapeEpisodeCount: Array.isArray(metadata.scrapeData?.episodes) ? metadata.scrapeData.episodes.length : 0, hasDetailInfo: !!magnetScrapeData, title: magnetScrapeData?.title || "", year: magnetScrapeData?.releaseDate ? String(magnetScrapeData.releaseDate).substring(0, 4) : "", mappingPreview: (metadata.videoMappings || []).slice(0, 3).map((item) => `${String(item?.fileId || "").slice(0, 80)}=>${item?.episodeName || getScrapedEpisodeTitle(metadata.scrapeData, patchScrapeMappingEpisode(item, normalizeMappingEpisode(item))) || ""}`) });
                        for (const ep of pan115.episodes) {
                            const epNo = Number.isFinite(ep._episodeNumber) ? ep._episodeNumber : extractEpisodeNumber(ep._rawName || ep.name);
                            const mapping = findScrapeMapping(metadata, [ep._fid], epNo, ep._rawName || ep.fileName || ep.name || "");
                            if (!mapping) continue;
                            const from = ep.name;
                            const scrapedName = buildScrapedEpisodeName(metadata.scrapeData, mapping, ep.name, ep._displayName || ep._rawName || ep.name);
                            ep.name = scrapedName || ep.name; ep.title = ep.name; ep.episodeName = ep.name;
                            ep.playId = build115MagnetPlayId({ ...decode115MagnetPlayMeta(ep.playId), fid: ep._fid, sid: videoId, v: keyword || episodeName, e: ep.name, n: mapping.episodeNumber || epNo || "" });
                            logInfo("115秒传分集应用刮削名", { from, to: ep.name, fid: ep._fid, episodeNumber: mapping.episodeNumber || null, originalEpisodeNumber: mapping.originalEpisodeNumber || null });
                        }
                        pan115.episodes.sort((a, b) => {
                            const aEp = Number(a._episodeNumber || extractEpisodeNumber(a._rawName || a.name || ""));
                            const bEp = Number(b._episodeNumber || extractEpisodeNumber(b._rawName || b.name || ""));
                            const aValid = Number.isFinite(aEp) && aEp > 0 && aEp <= 300;
                            const bValid = Number.isFinite(bEp) && bEp > 0 && bEp <= 300;
                            if (aValid && bValid && aEp !== bEp) return aEp - bEp;
                            if (aValid !== bValid) return aValid ? -1 : 1;
                            return String(a._rawName || a.name || "").localeCompare(String(b._rawName || b.name || ""), "zh-Hans-CN", { numeric: true });
                        });
                        playSources.push({ name: "115秒传", episodes: pan115.episodes });
                        OmniBox.log("info", `磁力线路已秒传并生成115线路: episodeCount=${pan115.episodes.length}, sortedPreview=${pan115.episodes.slice(0, 5).map((ep) => ep.name).join(" | ")}`);
                    } else {
                        OmniBox.log("warn", `磁力线路秒传115未返回可用文件，仅返回原磁力线路: state=${pan115.result?.state || "unknown"}`);
                    }
                } catch (error) {
                    OmniBox.log("warn", `磁力线路秒传115失败，仅返回原磁力线路: ${error.message}`);
                }
            } else {
                OmniBox.log("warn", "磁力线路跳过115秒传: 未配置 GLOBAL_115_COOKIE/PAN_115_COOKIE");
            }
            playSources.push({ name: "磁力", episodes: [{ name: episodeName, playId: shareURL }] });
            const magnetVod = applyScrapeInfoToVod({
                vod_id: videoId,
                vod_name: keyword || episodeName || "磁力资源",
                vod_pic: "",
                type_name: "磁力",
                vod_year: "",
                vod_area: "",
                vod_remarks: playSources.some((item) => item.name === "115秒传") ? "115秒传/磁力" : "磁力资源",
                vod_actor: "",
                vod_director: "",
                vod_content: note || `磁力资源: ${shareURL}`,
                vod_play_sources: playSources,
                vod_douban_score: "",
            }, magnetScrapeData, note || `磁力资源: ${shareURL}`);
            logInfo("磁力详情刮削信息回填完成", {
                hasScrapeData: !!magnetScrapeData,
                vodName: magnetVod.vod_name || "",
                year: magnetVod.vod_year || "",
                hasPic: !!magnetVod.vod_pic,
                actorCount: magnetVod.vod_actor ? magnetVod.vod_actor.split(",").filter(Boolean).length : 0,
                directorCount: magnetVod.vod_director ? magnetVod.vod_director.split(",").filter(Boolean).length : 0,
                contentLength: String(magnetVod.vod_content || "").length,
            });
            return { list: [magnetVod] };
        }

        const driveInfoCacheKey = buildCacheKey("pansou-group:driveInfo", shareURL);
        const rootFilesCacheKey = buildCacheKey("pansou-group:rootFiles", shareURL);
        const videoFilesCacheKey = buildCacheKey("pansou-group:videoFiles", shareURL);

        let driveInfo = await getCachedJSON(driveInfoCacheKey);
        if (!driveInfo) {
            driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
            await setCachedJSON(driveInfoCacheKey, driveInfo, PANSOU_GROUP_CACHE_EX_SECONDS);
        }
        const displayName = driveInfo.displayName;

        let fileList = await getCachedJSON(rootFilesCacheKey);
        if (!fileList) {
            fileList = await OmniBox.getDriveFileList(shareURL, "0");
            if (fileList && fileList.files && Array.isArray(fileList.files)) {
                await setCachedJSON(rootFilesCacheKey, fileList, PANSOU_GROUP_CACHE_EX_SECONDS);
            }
        }

        if (!fileList || !fileList.files || !Array.isArray(fileList.files)) {
            throw new Error("获取文件列表失败");
        }

        if (fileList && fileList.files && Array.isArray(fileList.files)) {
            OmniBox.log("info", `详情文件列表数量: ${fileList.files.length}`);
        }

        let allVideoFiles = await getCachedJSON(videoFilesCacheKey);
        if (!Array.isArray(allVideoFiles) || allVideoFiles.length === 0) {
            allVideoFiles = await getAllVideoFiles(shareURL, fileList.files, "0");
            if (Array.isArray(allVideoFiles) && allVideoFiles.length > 0) {
                await setCachedJSON(videoFilesCacheKey, allVideoFiles, PANSOU_GROUP_CACHE_EX_SECONDS);
            }
        }

        if (allVideoFiles.length === 0) {
            throw new Error("未找到视频文件");
        }

        OmniBox.log("info", `递归获取视频文件完成,视频文件数量: ${allVideoFiles.length}`);

        const metadataCacheKey = buildCacheKey("pansou-group:metadata", shareURL);
        const metadataRefreshLockKey = buildCacheKey("pansou-group:metadataRefreshLock", shareURL);

        let scrapingSuccess = false;
        let scrapeData = null;
        let videoMappings = [];
        let cachedMetadata = await getCachedJSON(metadataCacheKey);

        if (cachedMetadata) {
            scrapeData = cachedMetadata.scrapeData || null;
            videoMappings = cachedMetadata.videoMappings || [];
        }

        const refreshMetadataInBackground = async () => {
            const refreshLock = await getCachedJSON(metadataRefreshLockKey);
            if (refreshLock) {
                return;
            }
            await setCachedJSON(metadataRefreshLockKey, { refreshing: true }, PANSOU_GROUP_CACHE_EX_SECONDS);

            try {
                const videoFilesForScraping = allVideoFiles.map((file) => {
                    const fileId = file.fid || file.file_id || "";
                    const formattedFileId = fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : fileId;
                    return {
                        ...file,
                        fid: formattedFileId,
                        file_id: formattedFileId,
                    };
                });

                await OmniBox.processScraping(shareURL, keyword, note, videoFilesForScraping);
                const metadata = await OmniBox.getScrapeMetadata(shareURL);
                await setCachedJSON(metadataCacheKey, {
                    scrapeData: metadata?.scrapeData || null,
                    videoMappings: metadata?.videoMappings || [],
                }, PANSOU_GROUP_CACHE_EX_SECONDS);
            } catch (error) {
                OmniBox.log("warn", `后台刷新元数据失败: ${error.message}`);
            }
        };

        const tryReloadMetadataOnce = async () => {
            try {
                const metadata = await OmniBox.getScrapeMetadata(shareURL);
                if (metadata) {
                    scrapeData = metadata.scrapeData || scrapeData;
                    videoMappings = metadata.videoMappings || videoMappings;
                }
            } catch (error) {
                OmniBox.log("warn", `补读元数据失败: ${error.message}`);
            }
        };

        if (!cachedMetadata) {
            if (ASYNC_SCRAPING) {
                OmniBox.log("info", `未命中元数据缓存，按异步模式后台刷新: ${shareURL}`);
                refreshMetadataInBackground().catch((error) => {
                    OmniBox.log("warn", `异步刷新元数据失败: ${error.message}`);
                });
            } else {
                try {
                    const videoFilesForScraping = allVideoFiles.map((file) => {
                        const fileId = file.fid || file.file_id || "";
                        const formattedFileId = fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : fileId;
                        return {
                            ...file,
                            fid: formattedFileId,
                            file_id: formattedFileId,
                        };
                    });

                    await OmniBox.processScraping(shareURL, keyword, note, videoFilesForScraping);
                    scrapingSuccess = true;
                    const metadata = await OmniBox.getScrapeMetadata(shareURL);
                    scrapeData = metadata.scrapeData || null;
                    videoMappings = metadata.videoMappings || [];
                    await setCachedJSON(metadataCacheKey, {
                        scrapeData,
                        videoMappings,
                    }, PANSOU_GROUP_CACHE_EX_SECONDS);
                } catch (error) {
                    OmniBox.log("error", `同步获取元数据失败: ${error.message}`);
                }
            }
        } else {
            refreshMetadataInBackground().catch((error) => {
                OmniBox.log("warn", `异步刷新元数据失败: ${error.message}`);
            });
        }

        await tryReloadMetadataOnce();

        const playSources = [];

        // 确定播放源列表
        let sourceNames = ["直连"];
        const targetDriveTypes = DRIVE_TYPE_CONFIG;
        const configSourceNames = SOURCE_NAMES_CONFIG;

        if (targetDriveTypes.includes(driveInfo.driveType)) {
            sourceNames = [...configSourceNames];
            OmniBox.log("info", `${displayName} 匹配 DRIVE_TYPE_CONFIG，初始线路设置为: ${sourceNames.join(", ")}`);
            sourceNames = filterSourceNamesForCaller(sourceNames, source, context);
            OmniBox.log("info", `来源=${source || "unknown"}，最终线路设置为: ${sourceNames.join(", ")}`);
        }

        for (const sourceName of sourceNames) {
            const episodes = [];

            for (const file of allVideoFiles) {
                let fileName = file.file_name || "";
                const fileId = file.fid || "";
                const fileSize = file.size || file.file_size || 0;

                const formattedFileId = fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : "";

                let matchedMapping = null;
                if (scrapeData && videoMappings && Array.isArray(videoMappings) && videoMappings.length > 0) {
                    for (const mapping of videoMappings) {
                        if (mapping && mapping.fileId === formattedFileId) {
                            matchedMapping = mapping;
                            const newFileName = buildScrapedFileName(scrapeData, mapping, fileName);
                            if (newFileName && newFileName !== fileName) {
                                fileName = newFileName;
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
                    playId: fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : "",
                    size: fileSize > 0 ? fileSize : undefined,
                };

                if (matchedMapping) {
                    if (matchedMapping.seasonNumber !== undefined && matchedMapping.seasonNumber !== null) {
                        episode._seasonNumber = matchedMapping.seasonNumber;
                    }
                    if (matchedMapping.episodeNumber !== undefined && matchedMapping.episodeNumber !== null) {
                        episode._episodeNumber = matchedMapping.episodeNumber;
                    }

                    if (matchedMapping.episodeName) episode.episodeName = matchedMapping.episodeName;
                    if (matchedMapping.episodeOverview) episode.episodeOverview = matchedMapping.episodeOverview;
                    if (matchedMapping.episodeAirDate) episode.episodeAirDate = matchedMapping.episodeAirDate;
                    if (matchedMapping.episodeStillPath) episode.episodeStillPath = matchedMapping.episodeStillPath;
                    if (matchedMapping.episodeVoteAverage !== undefined) episode.episodeVoteAverage = matchedMapping.episodeVoteAverage;
                    if (matchedMapping.episodeRuntime !== undefined) episode.episodeRuntime = matchedMapping.episodeRuntime;
                }

                if (episode.name && episode.playId) {
                    episodes.push(episode);
                }
            }

            if (scrapeData && episodes.length > 0) {
                const hasEpisodeNumber = episodes.some((ep) => ep._episodeNumber !== undefined);
                if (hasEpisodeNumber) {
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
                if (DRIVE_TYPE_CONFIG.includes(driveInfo.driveType)) {
                    finalSourceName = `${displayName}-${sourceName}`;
                }

                playSources.push({
                    name: finalSourceName,
                    episodes: episodes,
                });
            }
        }

        if (Array.isArray(playSources) && playSources.length > 1 && DRIVE_ORDER.length > 0) {
            const sortedPlaySources = sortPlaySourcesByDriveOrder(playSources);
            playSources.length = 0;
            playSources.push(...sortedPlaySources);
            OmniBox.log("info", `按 DRIVE_ORDER 排序后线路顺序: ${playSources.map((item) => item.name).join(" | ")}`);
        }

        if (RAPID_TRANSFER_ENABLED) {
            try {
                const rapidInfo = await checkRapidTransferAvailable(shareURL);
                if (rapidInfo.available && Array.isArray(rapidInfo.targets) && rapidInfo.targets.length > 0) {
                    OmniBox.log("info", `秒传可用, 目标网盘: ${rapidInfo.targets.map((t) => t.routeName || t.name).join(", ")}`);
                    for (const target of rapidInfo.targets) {
                        const sourceName = target.routeName || ("秒传" + (target.name || target.driveType));
                        const episodes = [];
                        for (const file of allVideoFiles) {
                            let fileName = file.file_name || "";
                            const fileId = file.fid || "";
                            const fileSize = file.size || file.file_size || 0;
                            const formattedFileId = fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : "";
                            let matchedMapping = null;
                            if (scrapeData && videoMappings && Array.isArray(videoMappings) && videoMappings.length > 0) {
                                for (const mapping of videoMappings) {
                                    if (mapping && mapping.fileId === formattedFileId) {
                                        matchedMapping = mapping;
                                        const newFileName = buildScrapedFileName(scrapeData, mapping, fileName);
                                        if (newFileName && newFileName !== fileName) fileName = newFileName;
                                        break;
                                    }
                                }
                            }
                            let displayFileName = fileName;
                            if (fileSize > 0) {
                                const fileSizeStr = formatFileSize(fileSize);
                                if (fileSizeStr) displayFileName = `[${fileSizeStr}] ${fileName}`;
                            }
                            const episode = {
                                name: displayFileName,
                                playId: formattedFileId,
                                size: fileSize > 0 ? fileSize : undefined,
                                _rapidTarget: target.driveType,
                            };
                            if (matchedMapping) {
                                if (matchedMapping.episodeNumber !== undefined && matchedMapping.episodeNumber !== null) {
                                    episode._episodeNumber = matchedMapping.episodeNumber;
                                }
                                if (matchedMapping.episodeName) episode.episodeName = matchedMapping.episodeName;
                            }
                            if (episode.name && episode.playId) episodes.push(episode);
                        }
                        if (episodes.length > 0) {
                            playSources.push({ name: sourceName, episodes, rapidTransfer: true });
                            OmniBox.log("info", `已添加秒传线路: ${sourceName}, 剧集数: ${episodes.length}`);
                        }
                    }
                }
            } catch (error) {
                logWarn("秒传线路检测/添加失败", { error: error.message || String(error) });
            }
        }

        const displayNameFromFileList = fileList.displayName || fileList.display_name || "";
        let vodName = displayNameFromFileList || note || keyword || shareURL;
        let vodPic = "";
        let vodYear = "";
        let vodArea = "";
        let vodActor = "";
        let vodDirector = "";
        let vodContent = `网盘资源,共${allVideoFiles.length}个视频文件`;
        let vodDoubanScore = "";

        if (scrapeData) {
            if (scrapeData.title) vodName = scrapeData.title;
            if (scrapeData.posterPath) vodPic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            if (scrapeData.releaseDate) vodYear = scrapeData.releaseDate.substring(0, 4) || "";
            if (scrapeData.overview) vodContent = scrapeData.overview;
            if (scrapeData.voteAverage) vodDoubanScore = scrapeData.voteAverage.toFixed(1);

            if (scrapeData.credits) {
                if (scrapeData.credits.cast && Array.isArray(scrapeData.credits.cast)) {
                    vodActor = scrapeData.credits.cast
                        .slice(0, 5)
                        .map((cast) => cast.name || cast.character || "")
                        .filter((name) => name)
                        .join(",");
                }
                if (scrapeData.credits.crew && Array.isArray(scrapeData.credits.crew)) {
                    const directors = scrapeData.credits.crew.filter((crew) => crew.job === "Director" || crew.department === "Directing");
                    if (directors.length > 0) {
                        vodDirector = directors
                            .slice(0, 3)
                            .map((director) => director.name || "")
                            .filter((name) => name)
                            .join(",");
                    }
                }
            }
        }

        return {
            list: [
                {
                    vod_id: videoId,
                    vod_name: vodName,
                    vod_pic: vodPic,
                    type_name: displayName,
                    vod_year: vodYear,
                    vod_area: vodArea,
                    vod_remarks: displayName,
                    vod_actor: vodActor,
                    vod_director: vodDirector,
                    vod_content: vodContent,
                    vod_play_sources: playSources,
                    vod_douban_score: vodDoubanScore,
                },
            ],
        };
    } catch (error) {
        OmniBox.log("error", `详情接口失败: ${error.message}`);
        return {
            list: [],
        };
    }
}

/**
* 播放
*/
async function play(params, context) {
    try {
        let flag = params.flag || "";
        let playId = params.playId || "";
        const source = resolveCallerSource(params, context);

        if (!playId) {
            throw new Error("播放参数不能为空");
        }

        if (is115MagnetPlayId(playId, flag)) {
            const magnetMeta = decode115MagnetPlayMeta(playId);
            try {
                OmniBox.log("info", `识别为115秒传播放，直接走115网盘解析: fileName=${magnetMeta.fileName || ""}, fileId=${magnetMeta.fileId || ""}`);
                return await resolve115MagnetPlay(playId, flag, source, context, params);
            } catch (error) {
                OmniBox.log("warn", `115磁力播放失败，回退磁力: ${error.message}`);
                if (magnetMeta.magnet) {
                    playId = magnetMeta.magnet;
                } else {
                    throw error;
                }
            }
        }

        if (flag && String(flag).startsWith("秒传")) {
            const targetDrive = String(flag).replace(/^秒传/, "").trim();
            const driveMap = { "阿里": "aliyun", "115": "115", "aliyun": "aliyun" };
            const resolvedDrive = driveMap[targetDrive] || targetDrive;
            const parts = playId.split("|");
            if (parts.length >= 2) {
                const shareURL = decodeURIComponent(parts[0]);
                const fileId = parts[1];
                OmniBox.log("info", `秒传播放: targetDrive=${resolvedDrive}, shareURL=${shareURL.substring(0, 80)}, fileId=${fileId}`);
                try {
                    return await rapidTransferPlay(shareURL, fileId, resolvedDrive, flag, context);
                } catch (error) {
                    OmniBox.log("warn", `秒传播放失败，回退原始线路: ${error.message}`);
                }
            }
        }

        if (isMagnetUrl(playId)) {
            const episodeName = normalizeMagnetTitle(params.episodeName || params.title || "磁力资源");
            OmniBox.log("info", `检测到磁力播放，直接返回磁力链接: title=${episodeName}`);
            return {
                urls: [{ name: episodeName || "磁力资源", url: playId }],
                header: {},
                parse: 0,
                danmaku: []};
        }

        const parts = playId.split("|");
        if (parts.length < 2) {
            throw new Error("播放参数格式错误,应为:分享链接|文件ID");
        }
        let shareURL = parts[0] || "";
        const fileId = parts[1] || "";
        shareURL=decodeURIComponent(shareURL);

        if (!shareURL || !fileId) {
            throw new Error("分享链接或文件ID不能为空");
        }

        let danmakuList = [];
        try {
            const metadata = await OmniBox.getScrapeMetadata(shareURL);
            if (metadata && metadata.scrapeData && metadata.videoMappings) {
                const formattedFileId = fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : "";

                let matchedMapping = null;
                for (const mapping of metadata.videoMappings) {
                    if (mapping.fileId === formattedFileId) {
                        matchedMapping = mapping;
                        break;
                    }
                }

                if (matchedMapping && metadata.scrapeData) {
                    const scrapeData = metadata.scrapeData;

                    let fileName = "";
                    const scrapeType = metadata.scrapeType || "";
                    if (scrapeType === "movie") {
                        fileName = scrapeData.title || "";
                    } else {
                        const title = scrapeData.title || "";
                        const seasonAirYear = scrapeData.seasonAirYear || "";
                        const seasonNumber = matchedMapping.seasonNumber || 1;
                        const epNum = matchedMapping.episodeNumber || 1;
                        fileName = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
                    }

                    if (fileName) {
                        danmakuList = await OmniBox.getDanmakuByFileName(fileName);
                    }
                }
            }
        } catch (error) {
            OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
        }

        // 线路解析: 默认 web/emby 走服务端代理，其它直连；若 flag 含前缀，取最后一段
        const routeType = resolveRouteType(flag, source, context);

        const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);

        OmniBox.log("info", `使用线路: ${routeType}`);

        if (!playInfo || !playInfo.url || !Array.isArray(playInfo.url) || playInfo.url.length === 0) {
            throw new Error("无法获取播放地址");
        }

        const urlList = playInfo.url || [];

        let urlsResult = [];
        for (const item of urlList) {
            urlsResult.push({
                name: item.name || "播放",
                url: item.url,
            });
        }

        let header = playInfo.header || {};

        let finalDanmakuList = danmakuList && danmakuList.length > 0 ? danmakuList : playInfo.danmaku || [];

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
