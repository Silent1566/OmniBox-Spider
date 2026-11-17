// @name 七味分组
// @author https://github.com/hjdhnx/drpy-node/blob/main/spider/js/%E4%B8%83%E5%91%B3%5B%E4%BC%98%5D.js
// @description 刮削：支持，弹幕：支持，嗅探：支持，仅保留七味网盘线路的分组版本
// @dependencies: axios, cheerio
// @version 1.6.23
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/七味分组.js

const axios = require("axios");
const cheerio = require("cheerio");
const crypto = require("crypto");
const OmniBox = require("omnibox_sdk");

const DANMU_API = process.env.DANMU_API || "";
const PANCHECK_API = process.env.PANCHECK_API || "";
const PANCHECK_ENABLED = String(process.env.PANCHECK_ENABLED || (PANCHECK_API ? "true" : "false")).toLowerCase() === "true";
const PANCHECK_PLATFORMS = process.env.PANCHECK_PLATFORMS || "quark,baidu,uc,pan123,tianyi,cmcc,aliyun,xunlei,115";
// 115 cookie 统一全局配置：与盘搜分组共用同一套环境变量
const GLOBAL_115_COOKIE = process.env.PAN_115_COOKIE || process.env.GLOBAL_115_COOKIE || process.env.QIWEI_115_COOKIE || process.env.WOOG_115_COOKIE || process.env['115_COOKIE'] || "";

function splitConfigList(value) {
    return String(value || "")
        .split(/[;,]/)
        .map((item) => item.trim())
        .filter(Boolean);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

const MAX_PAN_VALID_ROUTES = (() => {
    const raw = String(process.env.MAX_PAN_VALID_ROUTES || "3").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 3;
})();
const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "quark;uc");
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");
const EXTERNAL_SERVER_PROXY_ENABLED = String(process.env.EXTERNAL_SERVER_PROXY_ENABLED || "false").toLowerCase() === "true";
const DRIVE_ORDER = splitConfigList(process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").map((s) => s.toLowerCase());
const QIWEI_CACHE_EX_SECONDS = Number(process.env.QIWEI_CACHE_EX_SECONDS || 43200);
const GLOBAL_115_MAGNET_CACHE_EX_SECONDS = Number(process.env.GLOBAL_115_MAGNET_CACHE_EX_SECONDS || process.env.QIWEI_115_MAGNET_CACHE_EX_SECONDS || 2592000);
const QIWEI_PAN_CACHE_VERSION = "v4";
const PAN_ROUTE_NAMES = SOURCE_NAMES_CONFIG.slice(0, MAX_PAN_VALID_ROUTES);

const HOSTS = [
    "https://www.pcmp4.com",
    "https://www.qwnull.com",
    "https://www.qwmkv.com",
    "https://www.qwfilm.com",
    "https://www.qnmp4.com",
    "https://www.qnnull.com",
    "https://www.qnhot.com",
];

let currentHostIndex = 0;

const DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Connection": "keep-alive",
};

const CLASSES = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "剧集" },
    { type_id: "3", type_name: "综艺" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "30", type_name: "短剧" },
];

const FULL_TYPE_OPTIONS = [
    "剧情", "科幻", "动作", "喜剧", "爱情", "冒险", "儿童", "歌舞", "音乐", "奇幻", "动画", "恐怖", "惊悚", "丧尸", "战争", "传记", "纪录", "犯罪", "悬疑", "西部", "灾难", "古装", "武侠", "家庭", "短片", "校园", "文艺", "运动", "青春", "同性", "励志", "人性", "美食", "女性", "治愈", "历史",
];
const FULL_YEAR_OPTIONS = ["2026", "2025", "2024", "2023", "2022", "2021", "2020", "2019", "2018", "2017", "2016", "2015", "2014", "2013", "2012", "2011", "2010"];
const FULL_AREA_OPTIONS = ["大陆", "香港", "台湾", "日本", "韩国", "泰国", "美国", "英国", "法国", "德国", "印度", "丹麦", "瑞典", "荷兰", "加拿大", "俄罗斯", "意大利", "比利时", "西班牙", "澳大利亚", "其他"];
const FULL_LANG_OPTIONS = ["国语", "粤语", "英语", "法语", "日语", "韩语", "泰语", "德语", "俄语", "闽南语", "丹麦语", "波兰语", "瑞典语", "印地语", "挪威语", "意大利语", "西班牙语", "无对白", "其他"];
const FULL_SORT_OPTIONS = [
    { name: "按时间", value: "time" },
    { name: "按人气", value: "hits" },
    { name: "按评分", value: "score" },
];

function buildFilterOptionList(list = []) {
    return [{ name: "全部", value: "" }, ...list.map((item) => ({ name: item, value: item }))];
}

function buildCategoryFilters({ includeType = true, includeYear = true, includeArea = true, includeLang = true } = {}) {
    const filters = [
        {
            key: "sort",
            name: "排序",
            init: "time",
            value: FULL_SORT_OPTIONS,
        },
    ];
    if (includeType) {
        filters.push({
            key: "type",
            name: "类型",
            init: "",
            value: buildFilterOptionList(FULL_TYPE_OPTIONS),
        });
    }
    if (includeYear) {
        filters.push({
            key: "year",
            name: "年代",
            init: "",
            value: buildFilterOptionList(FULL_YEAR_OPTIONS),
        });
    }
    if (includeArea) {
        filters.push({
            key: "area",
            name: "地区",
            init: "",
            value: buildFilterOptionList(FULL_AREA_OPTIONS),
        });
    }
    if (includeLang) {
        filters.push({
            key: "lang",
            name: "语言",
            init: "",
            value: buildFilterOptionList(FULL_LANG_OPTIONS),
        });
    }
    return filters;
}

const FILTERS = {
    "1": buildCategoryFilters(),
    "2": buildCategoryFilters(),
    "3": buildCategoryFilters({ includeYear: false, includeArea: false, includeLang: false }),
    "4": buildCategoryFilters({ includeArea: false, includeLang: false }),
    "30": buildCategoryFilters({ includeArea: false, includeLang: false }),
};

const axiosInstance = axios.create({
    timeout: 15000,
    validateStatus: (status) => status >= 200 && status < 500,
    responseType: "text",
});

const panRouteCache = new Map();

function logInfo(message, data = null) {
    const suffix = data == null ? "" : `: ${JSON.stringify(data)}`;
    OmniBox.log("info", `[七味分组] ${message}${suffix}`);
}

function logWarn(message, data = null) {
    const suffix = data == null ? "" : `: ${JSON.stringify(data)}`;
    OmniBox.log("warn", `[七味分组] ${message}${suffix}`);
}

function logError(message, error) {
    OmniBox.log("error", `[七味分组] ${message}: ${error?.message || error}`);
}

function encodeMeta(obj) {
    try {
        return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
    } catch {
        return "";
    }
}

function decodeMeta(value) {
    try {
        return JSON.parse(Buffer.from(String(value || ""), "base64").toString("utf8"));
    } catch {
        return {};
    }
}

function safeJsonParse(text, fallback = {}) {
    try {
        return JSON.parse(text);
    } catch {
        return fallback;
    }
}

function getCurrentHost() {
    return HOSTS[currentHostIndex] || HOSTS[0];
}

function fixUrl(url, host = getCurrentHost()) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return `https:${value}`;
    if (value.startsWith("/")) return `${host}${value}`;
    return `${host}/${value.replace(/^\.\//, "")}`;
}

function normalizeImage(url, host = getCurrentHost()) {
    const fixed = fixUrl(url, host);
    if (!fixed) return "";
    return fixed.replace(/\s+/g, "%20");
}

function parsePage(value, defaultValue = 1) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : defaultValue;
}

function parseFilters(params = {}) {
    const merged = {};
    const candidates = [params.filters, params.extend, params.ext];
    for (const item of candidates) {
        if (!item) continue;
        if (typeof item === "object") {
            Object.assign(merged, item);
            continue;
        }
        if (typeof item === "string") {
            try {
                const parsed = JSON.parse(item);
                if (parsed && typeof parsed === "object") {
                    Object.assign(merged, parsed);
                }
            } catch {
                // ignore invalid filter json
            }
        }
    }
    const normalized = {};
    for (const [key, value] of Object.entries(merged)) {
        if (!["sort", "type", "area", "lang", "year"].includes(key)) continue;
        normalized[key] = String(value || "").trim();
    }
    if (!FULL_SORT_OPTIONS.some((item) => item.value === normalized.sort)) {
        normalized.sort = "time";
    }
    return normalized;
}

function buildCategoryPath(categoryId, page, filters = {}) {
    const area = encodeURIComponent(String(filters.area || "").trim());
    const sort = String(filters.sort || "time").trim() || "time";
    const type = encodeURIComponent(String(filters.type || "").trim());
    const lang = encodeURIComponent(String(filters.lang || "").trim());
    const year = encodeURIComponent(String(filters.year || "").trim());
    return `/ms/${categoryId}-${area}-${sort}-${type}-${lang}-------${year}.html?page=${page}`;
}

async function requestWithHost(host, path, options = {}) {
    const url = /^https?:\/\//i.test(path) ? path : `${host}${path}`;
    const response = await axiosInstance.get(url, {
        headers: {
            ...DEFAULT_HEADERS,
            Referer: `${host}/`,
            Origin: host,
            ...(options.headers || {}),
        },
    });
    if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}`);
    }
    return {
        html: typeof response.data === "string" ? response.data : JSON.stringify(response.data || {}),
        host,
        url,
    };
}

async function requestHtmlWithFailover(path, options = {}) {
    let lastError = null;
    for (let offset = 0; offset < HOSTS.length; offset++) {
        const index = (currentHostIndex + offset) % HOSTS.length;
        const host = HOSTS[index];
        try {
            const result = await requestWithHost(host, path, options);
            currentHostIndex = index;
            return result;
        } catch (error) {
            lastError = error;
            logWarn("站点请求失败，尝试切换镜像", { host, path, error: error.message || String(error) });
        }
    }
    throw lastError || new Error("全部镜像请求失败");
}

// ==================== 列表解析 ====================
function pickFirstText($root, selectors = []) {
    for (const selector of selectors) {
        const value = $root.find(selector).first().text().trim();
        if (value) {
            return value;
        }
    }
    return "";
}

function pickFirstAttr($root, selectors = [], attrName = "href") {
    for (const selector of selectors) {
        const value = $root.find(selector).first().attr(attrName);
        if (value) {
            return String(value).trim();
        }
    }
    return "";
}

function parsePosterItem($, element, host) {
    const $item = $(element);

    const title =
        pickFirstAttr($item, ["h3 a", ".title a", ".li-img a", "a"], "title") ||
        pickFirstText($item, ["h3 a", ".title a", "a"]);

    if (!title) {
        return null;
    }

    const desc = pickFirstText($item, [".tag", ".label", ".remark"]);
    const img = pickFirstAttr($item, [".li-img img", "img"], "src");
    const href = pickFirstAttr($item, ["h3 a", ".title a", ".li-img a", "a"], "href");

    if (!href) {
        return null;
    }

    return {
        vod_id: fixUrl(href, host),
        vod_name: title,
        vod_pic: normalizeImage(img, host),
        vod_remarks: desc || "",
    };
}

function parseVideoList(html, host) {
    const $ = cheerio.load(html || "");
    const nodes = $(".content-list li");
    const list = [];
    nodes.each((_, element) => {
        const item = parsePosterItem($, element, host);
        if (item) {
            list.push(item);
        }
    });
    return list;
}

function buildPanSearchEntryVod(video = {}, host = "") {
    const rawVideoId = extractVideoId(video?.vod_id || "");
    const folderVodId = buildPanRootFolderVodId(rawVideoId || video?.vod_id || "");
    return {
        vod_id: folderVodId,
        vod_name: String(video?.vod_name || "").trim(),
        vod_pic: normalizeImage(video?.vod_pic || "", host) || String(video?.vod_pic || "").trim(),
        vod_remarks: String(video?.vod_remarks || "点击查看网盘分组").trim() || "点击查看网盘分组",
        vod_tag: "folder",
        type_id: folderVodId,
        type_name: "剧集网盘分组",
    };
}

function paginateList(list = [], page = 1, pageSize = 20) {
    const normalizedPageSize = Math.max(1, parseInt(pageSize, 10) || 20);
    const normalizedPage = Math.max(1, parseInt(page, 10) || 1);
    const source = Array.isArray(list) ? list : [];
    const total = source.length;
    const pagecount = total > 0 ? Math.ceil(total / normalizedPageSize) : 1;
    const start = (normalizedPage - 1) * normalizedPageSize;
    return {
        page: normalizedPage,
        pagecount,
        total,
        list: source.slice(start, start + normalizedPageSize),
    };
}

function parseDetailInfo(html, host) {
    const $ = cheerio.load(html || "");
    const title =
        $(".main-ui-meta h1").first().clone().children("span").remove().end().text().trim() ||
        $(".detail-title").first().text().trim() ||
        "";

    let typeName = "";
    const typeBox = html.match(/<div><span>类型：<\/span>[\s\S]*?<\/div>/);
    if (typeBox && typeBox[0]) {
        const names = [...typeBox[0].matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
        typeName = [...new Set(names)].join("/");
    }

    let area = "";
    const areaBox = html.match(/<div><span>地区：<\/span>[\s\S]*?<\/div>/);
    if (areaBox && areaBox[0]) {
        const names = [...areaBox[0].matchAll(/<a[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
        area = [...new Set(names)].join("/");
    }

    const showContent = $(".movie-introduce .zkjj_a").first().text().replace(/\s*\[展开全部\]/g, "").trim();
    const hideContent = $(".movie-introduce .sqjj_a").first().text().replace(/\s*\[收起部分\]/g, "").trim();
    const directorMatch = html.match(/<div>[\s\S]*?导演：[\s\S]*?<\/div>/);
    const director = directorMatch?.[0]?.match(/<a[^>]*>([^<]+)<\/a>/)?.[1] || "";

    return {
        vod_name: title,
        type_name: typeName || $(".main-ui-meta div:nth-child(9) a").first().text().trim(),
        vod_pic: normalizeImage($(".img img").first().attr("src"), host),
        vod_content: hideContent || showContent || $(".detail-content").first().text().trim() || "",
        vod_remarks: $(".otherbox").first().text().trim() || "",
        vod_year: ($(".main-ui-meta h1 span.year").first().text() || "").replace(/[()]/g, "").trim(),
        vod_area: area || $(".main-ui-meta div:nth-child(11) a").first().text().trim(),
        vod_actor: ($(".main-ui-meta div.text-overflow").first().text() || "").replace(/^主演：/, "").trim(),
        vod_director: director,
    };
}

function normalizeCollectLineName(name = "") {
    return String(name || "")
        .replace(/[\u00a0\u2000-\u200f\u2028-\u202f\u205f\u3000]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^(?:collect|采集)\s*/iu, "")
        .replace(/^(?:线路|route)\s*/iu, "")
        .replace(/[：:：\-]+$/u, "")
        .replace(/\s+(\d+)$/u, "")
        .trim();
}

function extractVideoId(urlOrId) {
    const value = String(urlOrId || "");
    const match = value.match(/\/mv\/(\d+)\.html/);
    return match ? match[1] : value;
}

function isBlockedLineName(name) {
    if (!name) return false;
    return String(name).includes("磁力");
}

function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSeedType(type = "", link = "") {
    const t = String(type || "").trim().toLowerCase();
    const u = String(link || "").trim().toLowerCase();
    if (u.startsWith("magnet:")) return "magnet";
    if (u.startsWith("ed2k://")) return "ed2k";
    if (/\.torrent($|\?)/i.test(u)) return "torrent";
    if (t === "magnet" || t === "magnet_url" || t === "magnet_link") return "magnet";
    if (t === "ed2k" || t === "ed2k_url" || t === "ed2k_link") return "ed2k";
    if (t === "torrent") return "torrent";
    return t || "other";
}

function isDirectPlayableSeedType(seedType = "") {
    const t = String(seedType || "").toLowerCase();
    return t !== "magnet" && t !== "ed2k";
}

function extractEpisodeNumber(name = "") {
    const text = String(name || "");
    const patterns = [
        /S\d{1,2}E(\d{1,3})/i,
        /第\s*(\d{1,3})\s*[集话]/,
        /\[(\d{1,3})\s*[集话]\]/,
        /(?:^|[^A-Z0-9])E[P]?(\d{1,3})(?:[^A-Z0-9]|$)/i,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const episode = Number(match[1]);
        if (Number.isFinite(episode) && episode > 0) return episode;
    }
    return null;
}

function extractEpisodeRange(name = "") {
    const text = String(name || "");
    const patterns = [
        /\[第\s*(\d{1,3})\s*[-—~～至]\s*(\d{1,3})\s*[集话]\]/,
        /第\s*(\d{1,3})\s*[-—~～至]\s*(\d{1,3})\s*[集话]/,
        /\[(\d{1,3})\s*[-—~～至]\s*(\d{1,3})\s*[集话]\]/,
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (!match) continue;
        const start = Number(match[1]);
        const end = Number(match[2]);
        if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
            return { start, end };
        }
    }
    return null;
}

function formatEpisodeLabel(ep, fallbackTitle = "") {
    if (Number.isFinite(ep) && ep > 0) return `第${String(ep).padStart(2, "0")}集`;
    return fallbackTitle || "资源";
}

function formatEpisodeRangeLabel(range, fallbackTitle = "") {
    if (range && Number.isFinite(range.start) && Number.isFinite(range.end)) {
        return `第${String(range.start).padStart(2, "0")}-${String(range.end).padStart(2, "0")}集`;
    }
    return fallbackTitle || "资源";
}

function sortEpisodesByEpisodeNumber(episodes = []) {
    return [...episodes].sort((a, b) => {
        const aRangeStart = Number.isFinite(a?.episodeRangeStart) ? a.episodeRangeStart : null;
        const bRangeStart = Number.isFinite(b?.episodeRangeStart) ? b.episodeRangeStart : null;
        const aEpisode = Number.isFinite(a?.episodeNumber) ? a.episodeNumber : (aRangeStart ?? Number.MAX_SAFE_INTEGER);
        const bEpisode = Number.isFinite(b?.episodeNumber) ? b.episodeNumber : (bRangeStart ?? Number.MAX_SAFE_INTEGER);
        if (aEpisode !== bEpisode) return aEpisode - bEpisode;
        const aRangeEnd = Number.isFinite(a?.episodeRangeEnd) ? a.episodeRangeEnd : aEpisode;
        const bRangeEnd = Number.isFinite(b?.episodeRangeEnd) ? b.episodeRangeEnd : bEpisode;
        if (aRangeEnd !== bRangeEnd) return aRangeEnd - bRangeEnd;
        return String(a?.name || "").localeCompare(String(b?.name || ""), "zh-Hans-CN");
    });
}

function buildMagnetEpisode(item = {}, fallbackTitle = "", extra = {}) {
    const link = String(
        item?.link ||
        item?.zlink ||
        item?.magnet ||
        item?.magnet_url ||
        item?.magnet_link ||
        item?.ed2k ||
        item?.ed2k_url ||
        item?.ed2k_link ||
        item?.torrent ||
        extra.link ||
        ""
    ).trim();
    const seedType = normalizeSeedType(item?.type || extra.seedType || "", link);
    const rawTitle = normalizeText(item?.seed_name || item?.zname || item?.name || fallbackTitle || "资源");
    const quality = normalizeText(item?.zqxd || item?.definition_group || extra.quality || "");
    const size = normalizeText(item?.zsize || item?.size || extra.size || "");
    const createdAt = normalizeText(item?.created_at || item?.ezt || extra.createdAt || "");
    const remarkBits = [size, quality, createdAt].filter(Boolean);
    const episodeRange = extractEpisodeRange(rawTitle);
    const episodeNumber = episodeRange ? null : extractEpisodeNumber(rawTitle);
    const episodeLabel = (seedType === "magnet" || seedType === "ed2k" || seedType === "torrent")
        ? (episodeRange ? formatEpisodeRangeLabel(episodeRange, rawTitle) : formatEpisodeLabel(episodeNumber, rawTitle))
        : rawTitle;
    const displayName = remarkBits.length > 0 ? `${episodeLabel} [${remarkBits.join(" / ")}]` : episodeLabel;
    const simplePlayId = Boolean(extra.simplePlayId) && (seedType === "magnet" || seedType === "ed2k" || seedType === "torrent");
    const playMeta = {
        link,
        seedType,
        title: rawTitle,
        displayName,
        quality,
        size,
        createdAt,
        directPlayable: Boolean(extra.directPlayable ?? isDirectPlayableSeedType(seedType)),
    };
    return {
        name: episodeLabel,
        seedType,
        episodeNumber,
        episodeRangeStart: episodeRange?.start ?? null,
        episodeRangeEnd: episodeRange?.end ?? null,
        playId: simplePlayId ? link : JSON.stringify(playMeta),
        _displayName: displayName,
        _rawName: rawTitle,
    };
}

function formatFileSize(size) {
    if (!size || size <= 0) return "";
    const unit = 1024;
    const units = ["B", "K", "M", "G", "T", "P"];
    if (size < unit) return `${size}B`;
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

function cleanPlayLabel(value = "", fallback = "") {
    const cleaned = normalizeText(value)
        .replace(/[#$]+/g, " ")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned || fallback;
}

function stripEpisodeSerialSuffix(name = "", index = 0) {
    const value = cleanPlayLabel(name);
    const serial = String((parseInt(index, 10) || 0) + 1);
    if (!value || !serial) return value;
    const escaped = serial.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return value
        .replace(new RegExp(`([\\]】）)])\\s*${escaped}$`, "u"), "$1")
        .replace(new RegExp(`(\\[[^\\]]{1,24}\\])\\s*${escaped}$`, "u"), "$1")
        .trim();
}

const PLAY_EPISODE_NAME_MAX_LENGTH = 32;

function truncatePlayLabel(value = "", maxLength = PLAY_EPISODE_NAME_MAX_LENGTH) {
    const raw = cleanPlayLabel(value);
    const limit = Math.max(8, Number(maxLength) || PLAY_EPISODE_NAME_MAX_LENGTH);
    if (!raw || raw.length <= limit) return raw;
    return `${raw.slice(0, limit - 1)}…`;
}

function buildEpisodeButtonName(ep = {}, index = 0, defaultPrefix = "资源") {
    const raw = cleanPlayLabel(ep?._displayName || ep?.name || ep?.episodeName || ep?._rawName || ep?.fileName || ep?.file_name || ep?.title || "");
    const rangeStart = Number.isFinite(ep?._episodeRangeStart) ? ep._episodeRangeStart : (Number.isFinite(ep?.episodeRangeStart) ? ep.episodeRangeStart : null);
    const rangeEnd = Number.isFinite(ep?._episodeRangeEnd) ? ep._episodeRangeEnd : (Number.isFinite(ep?.episodeRangeEnd) ? ep.episodeRangeEnd : null);
    if (rangeStart && rangeEnd) return formatEpisodeRangeLabel({ start: rangeStart, end: rangeEnd }, raw);
    const episodeNumber = Number.isFinite(ep?._episodeNumber) ? ep._episodeNumber : (Number.isFinite(ep?.episodeNumber) ? ep.episodeNumber : extractEpisodeNumber(raw));
    if (episodeNumber) return formatEpisodeLabel(episodeNumber, raw);
    return truncatePlayLabel(cleanPlayLabel(raw, `${defaultPrefix}${index + 1}`));
}

function pickEpisodeDisplayName(ep = {}, defaultPrefix = "资源", index = 0) {
    return truncatePlayLabel(buildEpisodeButtonName(ep, index, defaultPrefix));
}

function build115ButtonName(index = 0) {
    return `115资源${(parseInt(index, 10) || 0) + 1}`;
}

function build115EpisodeDisplayName(ep = {}, index = 0) {
    const rawName = cleanPlayLabel(ep?._rawName || ep?.fileName || ep?.file_name || ep?._displayName || ep?.name || "");
    return rawName || build115ButtonName(index);
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
        s: String(meta.s || "").trim(),
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

function sanitizeLegacyPlayText(value) {
    return cleanPlayLabel(value).replace(/[#$]/g, " ").trim();
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
        const episodeItems = episodes.map((episode, index) => {
            const epName = sanitizeLegacyPlayText(stripEpisodeSerialSuffix(pickEpisodeDisplayName(episode, "第", index), index)) || `第${index + 1}集`;
            const playId = String(episode?.playId || "").trim();
            if (!playId) return "";
            return `${epName}$${playId}`;
        }).filter(Boolean);
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

function summarizePlaySourcesForLog(playSources = []) {
    return (Array.isArray(playSources) ? playSources : []).map((source) => {
        const episodes = Array.isArray(source?.episodes) ? source.episodes : [];
        return {
            name: source?.name || "",
            episodeCount: episodes.length,
            episodePreview: episodes.slice(0, 5).map((episode) => ({
                name: episode?.name || episode?.episodeName || episode?.title || "",
                playIdPreview: String(episode?.playId || "").slice(0, 160),
            })),
        };
    });
}

function summarizePlayResultForLog(result = {}) {
    const urls = Array.isArray(result?.urls) ? result.urls : [];
    return {
        keys: Object.keys(result || {}),
        parse: result?.parse,
        flag: result?.flag || "",
        urlCount: urls.length,
        urls: urls.map((item) => ({
            name: item?.name || "",
            urlPreview: String(item?.url || "").slice(0, 240),
        })),
        headerKeys: result?.header && typeof result.header === "object" ? Object.keys(result.header) : [],
        danmakuCount: Array.isArray(result?.danmaku) ? result.danmaku.length : 0,
    };
}

function buildCacheKey(prefix, value) {
    const normalizedPrefix = String(prefix || "").trim();
    const normalizedValue = String(value || "").trim();
    const directKey = `${normalizedPrefix}:${normalizedValue}`;
    if (Buffer.byteLength(directKey, "utf8") <= 256) {
        return directKey;
    }

    const digest = crypto.createHash("sha1").update(normalizedValue, "utf8").digest("hex");
    const compactKey = `${normalizedPrefix}:sha1:${digest}`;
    if (Buffer.byteLength(compactKey, "utf8") <= 256) {
        return compactKey;
    }

    return `qiwei-group:cache:sha1:${digest}`;
}

async function getCachedJSON(key) {
    try {
        return await OmniBox.getCache(key);
    } catch (error) {
        logWarn("读取缓存失败", { key, error: error.message || String(error) });
        return null;
    }
}

async function setCachedJSON(key, value, exSeconds) {
    try {
        await OmniBox.setCache(key, value, exSeconds);
    } catch (error) {
        logWarn("写入缓存失败", { key, error: error.message || String(error) });
    }
}

async function deleteCachedJSON(key) {
    if (!key || typeof OmniBox?.deleteCache !== "function") return false;
    try {
        await OmniBox.deleteCache(key);
        return true;
    } catch (error) {
        logWarn("删除缓存失败", { key, error: error.message || String(error) });
        return false;
    }
}

function build115MagnetCacheKey(magnet = "") {
    return buildCacheKey(`qiwei-group:115-magnet:${QIWEI_PAN_CACHE_VERSION}`, String(magnet || "").trim().toLowerCase());
}

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
    } catch {
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
    } else if (callerSource === "emby") {
        if (allowServerProxy) {
            filtered = filtered.filter((name) => name === "服务端代理");
        } else {
            filtered = filtered.filter((name) => name !== "服务端代理");
        }
    } else if (callerSource === "uz") {
        filtered = filtered.filter((name) => name !== "本地代理");
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

function hasValidPlayUrls(playInfo) {
    return Array.isArray(playInfo?.url) && playInfo.url.some((item) => item?.url);
}

function isDirectVideoUrl(url) {
    if (!url) {
        return false;
    }
    return /\.(m3u8|mp4|flv|avi|mkv|ts|mov|webm)(\?|$)/i.test(String(url));
}

function normalizeShareUrl(url = "") {
    let value = String(url || "").trim();
    if (!value) return "";
    value = value.replace(/[)）】》,，。]+$/g, "");
    value = value.replace(/&amp;/gi, "&");
    value = value.replace(/((?:https?:\/\/)?(?:pan\.quark\.cn|drive\.uc\.cn)\/s\/[^?&#\s/]+)&dn=[^#\s]*/i, "$1");
    try {
        const parsed = new URL(value);
        if (parsed.hostname.includes("cloud.189.cn")) {
            const code = parsed.searchParams.get("code") || parsed.searchParams.get("shareCode") || "";
            if (code) {
                return `https://cloud.189.cn/web/share?code=${encodeURIComponent(code)}`;
            }
        }
        parsed.hash = "";
        parsed.pathname = String(parsed.pathname || "").replace(/&dn=[^/]*$/i, "");
        if (parsed.searchParams.has("dn")) parsed.searchParams.delete("dn");
        if (parsed.searchParams.has("displayName")) parsed.searchParams.delete("displayName");
        if (parsed.searchParams.has("filename")) parsed.searchParams.delete("filename");
        if (parsed.searchParams.has("title")) parsed.searchParams.delete("title");

        if (parsed.hostname.includes("pan.baidu.com")) {
            const pwd = parsed.searchParams.get("pwd") || "";
            return `https://pan.baidu.com${parsed.pathname}${pwd ? `?pwd=${encodeURIComponent(pwd)}` : ""}`;
        }
        if (parsed.hostname.includes("pan.quark.cn")) {
            const shareId = extractPanShareId(parsed.pathname);
            return shareId ? `https://pan.quark.cn/s/${shareId}` : `https://pan.quark.cn${parsed.pathname}`;
        }
        if (parsed.hostname.includes("drive.uc.cn")) {
            const shareId = extractPanShareId(parsed.pathname);
            return shareId ? `https://drive.uc.cn/s/${shareId}` : `https://drive.uc.cn${parsed.pathname}`;
        }
        return parsed.toString();
    } catch (error) {
        return value.replace(/([?&])dn=[^&#]*/ig, "$1").replace(/[?&]$/g, "");
    }
}

function extractPanShareId(pathname = "") {
    const normalizedPath = String(pathname || "").trim();
    if (!normalizedPath) return "";
    const match = normalizedPath.match(/\/s\/([A-Za-z0-9_-]+)/i);
    return match ? match[1] : "";
}

function normalizeShareDisplayName(name = "") {
    let value = String(name || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!value) return "";

    value = value.replace(/\s*(?:最后更新于\s*)?(?:今天|昨天|前天|刚刚)\s*$/u, "").trim();
    value = value.replace(/\s*(?:最后更新于\s*)?\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}(?:日)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?\s*$/u, "").trim();
    value = value.replace(/\s*提取码[:：]?\s*[A-Za-z0-9]{0,8}\s*$/u, "").trim();
    value = value.replace(/[|｜、,，;；:：·•\-_]+$/u, "").trim();

    return value;
}

function cleanShareDisplayNameCandidate(name = "") {
    const value = normalizeShareDisplayName(name);
    if (!value) return "";

    const lower = value.toLowerCase();
    const invalidNames = new Set([
        "百度网盘",
        "夸克网盘",
        "uc网盘",
        "天翼云盘",
        "移动云盘",
        "阿里云盘",
        "123云盘",
        "迅雷网盘",
        "115网盘",
        "网盘下载",
        "点击下载",
        "立即下载",
        "复制链接",
        "下载",
        "baidu",
        "quark",
        "uc",
        "tianyi",
        "cmcc",
        "aliyun",
        "alipan",
        "123pan",
        "xunlei",
        "115",
    ]);
    if (invalidNames.has(lower)) {
        return "";
    }

    return value;
}

function scoreShareDisplayName(name = "") {
    const value = cleanShareDisplayNameCandidate(name);
    if (!value) return 0;

    let score = Math.min(value.length, 120);
    if (value.length <= 4) {
        score -= 24;
    } else if (value.length <= 8) {
        score -= 10;
    }
    if (/[【\[（(《]/u.test(value)) {
        score += 6;
    }
    if (/(4k|2160|1080|hdr|杜比|高码|全集|完结|更新|国语|中字|无水印|原盘|超前)/iu.test(value)) {
        score += 18;
    }
    if (/^(?:[\u4e00-\u9fa5]{2,6}|[a-z0-9 ._-]{2,12})$/iu.test(value)) {
        score -= 12;
    }

    return score;
}

function pickBetterShareDisplayName(...candidates) {
    let best = "";
    let bestScore = 0;

    for (const candidate of candidates) {
        const value = cleanShareDisplayNameCandidate(candidate);
        if (!value) continue;
        const score = scoreShareDisplayName(value);
        if (!best || score > bestScore || (score === bestScore && value.length > best.length)) {
            best = value;
            bestScore = score;
        }
    }

    return best;
}

function extractShareDisplayNameFromShareUrl(shareURL = "") {
    const raw = String(shareURL || "").trim().replace(/&amp;/gi, "&");
    if (!raw) return "";

    let value = "";
    try {
        const parsed = new URL(raw);
        value = parsed.searchParams.get("dn")
            || parsed.searchParams.get("displayName")
            || parsed.searchParams.get("filename")
            || parsed.searchParams.get("title")
            || "";
    } catch (error) {
        value = "";
    }

    if (!value) {
        const match = raw.match(/(?:[?&]dn=|[?&]displayName=|[?&]filename=|[?&]title=)([^&#]+)/i) || raw.match(/&dn=([^&#]+)/i);
        if (match) {
            value = match[1] || "";
        }
    }

    try {
        value = decodeURIComponent(value || "");
    } catch (error) {
        value = value || "";
    }

    return cleanShareDisplayNameCandidate(value);
}

function buildUniqueShareLinkMetas(links = []) {
    const rawLinks = Array.isArray(links) ? links : [];
    const hintMap = new Map();
    const seen = new Set();
    const metas = [];

    for (const rawLink of rawLinks) {
        const normalizedLink = normalizeShareUrl(rawLink);
        if (!normalizedLink) continue;
        const hint = extractShareDisplayNameFromShareUrl(rawLink);
        const betterHint = pickBetterShareDisplayName(hintMap.get(normalizedLink) || "", hint);
        if (betterHint) {
            hintMap.set(normalizedLink, betterHint);
        }
    }

    for (const rawLink of rawLinks) {
        const normalizedLink = normalizeShareUrl(rawLink);
        if (!normalizedLink || seen.has(normalizedLink)) continue;
        seen.add(normalizedLink);
        metas.push({
            shareURL: normalizedLink,
            rawShareURL: String(rawLink || "").trim(),
            shareNameHint: hintMap.get(normalizedLink) || "",
        });
    }

    return metas;
}

function extractDownloadSectionShareMetas($) {
    if (!$) return [];

    const metas = [];
    $(".down-link .down-list.tab-content li.down-list2").each((_, li) => {
        const row = $(li);
        const titleBlock = row.find("p.down-list3").first();
        const titleAnchor = titleBlock.find("a").first();
        const rowNameHint = pickBetterShareDisplayName(
            titleAnchor.attr("title") || "",
            titleAnchor.text() || "",
            titleBlock.text() || ""
        );
        const linkCandidates = row.find("a").toArray().flatMap((a) => {
            const anchor = $(a);
            return [
                anchor.attr("data-clipboard-text") || "",
                anchor.attr("href") || "",
            ];
        });

        for (const rawLink of linkCandidates) {
            if (!isPanUrl(rawLink)) continue;
            metas.push({
                url: rawLink,
                nameHint: rowNameHint,
            });
        }
    });

    return metas;
}

function isPanUrl(url = "") {
    return /(pan\.baidu\.com|pan\.quark\.cn|drive\.uc\.cn|cloud\.189\.cn|yun\.139\.com|alipan\.com|aliyundrive\.com|115\.com|115cdn\.com|123pan\.com|123684\.com|123865\.com|123912\.com|pan\.xunlei\.com)/i.test(String(url || ""));
}

function parsePanType(shareURL = "") {
    const key = parsePanTypeKey(shareURL);
    const names = {
        baidu: "百度网盘",
        quark: "夸克网盘",
        uc: "UC网盘",
        tianyi: "天翼云盘",
        cmcc: "移动云盘",
        aliyun: "阿里云盘",
        pan123: "123云盘",
        xunlei: "迅雷网盘",
        "115": "115网盘",
    };
    return names[key] || "其他";
}

function parsePanTypeKey(shareURL = "") {
    return inferDriveTypeFromShareURL(shareURL);
}

function extractDriveFiles(fileList) {
    if (Array.isArray(fileList)) return fileList;
    if (Array.isArray(fileList?.files)) return fileList.files;
    if (Array.isArray(fileList?.data?.files)) return fileList.data.files;
    if (Array.isArray(fileList?.list)) return fileList.list;
    if (Array.isArray(fileList?.data?.list)) return fileList.data.list;
    return [];
}

function getFileId(file = {}) {
    return String(file?.fid || file?.file_id || file?.fs_id || file?.id || "").trim();
}

function getFileName(file = {}) {
    return String(file?.file_name || file?.server_filename || file?.name || "").trim();
}

function getFileSize(file = {}) {
    return Number(file?.size || file?.file_size || file?.obj_size || "0") || 0;
}

function stripPanTypeSuffix(name = "") {
    const raw = String(name || "").trim();
    if (!raw) return "";
    const stripped = raw.replace(/\s*\[[^\]]*(?:网盘|夸克|百度|阿里|UC|115|天翼|迅雷|移动|123)[^\]]*\]\s*$/u, "").trim();
    return stripped || raw;
}

function isVideoFile(file = {}) {
    const name = getFileName(file).toLowerCase();
    const videoExtensions = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v", ".rmvb", ".mpg", ".mpeg"];
    if (name && videoExtensions.some((ext) => name.endsWith(ext))) {
        return true;
    }

    const type = [
        file?.format_type,
        file?.type,
        file?.mime,
        file?.mimetype,
        file?.category,
        file?.obj_category,
        file?.obj_type,
        file?.file_type,
    ].filter(Boolean).join(" ").toLowerCase();

    return type.includes("video") || type.includes("mpeg") || type.includes("h264") || type.includes("hevc");
}

function isDirectoryLike(file = {}) {
    if (
        file?.dir === true || file?.dir === 1 ||
        file?.is_dir === true || file?.is_dir === 1 ||
        file?.isdir === true || file?.isdir === 1 ||
        file?.folder === true || file?.folder === 1 ||
        file?.is_folder === true || file?.is_folder === 1
    ) {
        return true;
    }

    const type = String(file?.format_type || file?.type || file?.category || file?.obj_category || file?.obj_type || file?.file_type || "").toLowerCase();
    return type.includes("dir") || type.includes("folder");
}

async function getDriveInfoCached(shareURL) {
    const key = buildCacheKey("qiwei-group:driveInfo", shareURL);
    let driveInfo = await getCachedJSON(key);
    if (!driveInfo) {
        driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
        await setCachedJSON(key, driveInfo, QIWEI_CACHE_EX_SECONDS);
    }
    return driveInfo;
}

async function getRootFileListCached(shareURL) {
    const key = buildCacheKey("qiwei-group:rootFiles", shareURL);
    let fileList = await getCachedJSON(key);
    if (!fileList) {
        fileList = await OmniBox.getDriveFileList(shareURL, "0");
        if (Array.isArray(extractDriveFiles(fileList))) {
            await setCachedJSON(key, fileList, QIWEI_CACHE_EX_SECONDS);
        }
    }
    return fileList;
}

function extractShareDisplayName(fileList = {}, rootFiles = []) {
    const listTitle = cleanShareDisplayNameCandidate(String(fileList?.displayName || fileList?.display_name || "").trim());
    if (listTitle) return listTitle;

    const files = Array.isArray(rootFiles) ? rootFiles : extractDriveFiles(fileList);
    if (files.length === 1) {
        const singleName = cleanShareDisplayNameCandidate(getFileName(files[0]));
        if (singleName) return singleName;
    }

    const names = [...new Set(files.map((file) => cleanShareDisplayNameCandidate(getFileName(file))).filter(Boolean))];
    if (names.length === 1) {
        return names[0];
    }

    return "";
}

async function getShareDisplayNameCached(shareURL) {
    const key = buildShareNameCacheKey(shareURL);
    const cachedName = cleanShareDisplayNameCandidate(await getCachedJSON(key));
    if (cachedName) {
        return cachedName;
    }

    const urlHint = extractShareDisplayNameFromShareUrl(shareURL);
    if (urlHint) {
        await setCachedJSON(key, urlHint, QIWEI_CACHE_EX_SECONDS);
        return urlHint;
    }

    try {
        const fileList = await getRootFileListCached(shareURL);
        const rootFiles = extractDriveFiles(fileList);
        const shareName = cleanShareDisplayNameCandidate(extractShareDisplayName(fileList, rootFiles));
        if (shareName) {
            await setCachedJSON(key, shareName, QIWEI_CACHE_EX_SECONDS);
        }
        return shareName;
    } catch (error) {
        logWarn("读取分享名称失败", { shareURL, error: error.message || String(error) });
        return "";
    }
}

async function getAllVideoFiles(shareURL, files, depth = 0, seen = new Set()) {
    if (!Array.isArray(files) || files.length === 0 || depth > 8) {
        return [];
    }

    const result = [];
    for (const file of files || []) {
        const fileId = getFileId(file);
        if (isVideoFile(file)) {
            result.push(file);
            continue;
        }

        if (isDirectoryLike(file) && fileId) {
            const visitKey = `${shareURL}|${fileId}`;
            if (seen.has(visitKey)) continue;
            seen.add(visitKey);

            try {
                const subFileList = await OmniBox.getDriveFileList(shareURL, fileId);
                const subFiles = extractDriveFiles(subFileList);
                if (subFiles.length > 0) {
                    const subVideos = await getAllVideoFiles(shareURL, subFiles, depth + 1, seen);
                    result.push(...subVideos);
                }
            } catch (error) {
                logWarn("递归读取网盘子目录失败", { shareURL, fileId, error: error.message || String(error) });
            }
        }
    }
    return result;
}

async function getAllVideoFilesCached(shareURL, rootFiles = []) {
    const key = buildCacheKey("qiwei-group:videoFiles", shareURL);
    let videos = await getCachedJSON(key);
    if (!Array.isArray(videos) || videos.length === 0) {
        videos = await getAllVideoFiles(shareURL, rootFiles);
        if (Array.isArray(videos) && videos.length > 0) {
            await setCachedJSON(key, videos, QIWEI_CACHE_EX_SECONDS);
        }
    }
    return Array.isArray(videos) ? videos : [];
}

async function loadPanFiles(shareURL) {
    try {
        const driveInfo = await getDriveInfoCached(shareURL);
        const fileList = await getRootFileListCached(shareURL);
        const files = extractDriveFiles(fileList);
        const videos = await getAllVideoFilesCached(shareURL, files);
        const shareName = extractShareDisplayName(fileList, files);
        logInfo("读取网盘文件结果", {
            shareURL,
            driveType: String(driveInfo?.driveType || driveInfo?.type || ""),
            shareName,
            rootContainerKeys: fileList && typeof fileList === "object" && !Array.isArray(fileList) ? Object.keys(fileList).slice(0, 12) : [],
            rootCount: files.length,
            rootSample: files.slice(0, 3).map((file) => ({
                fileId: getFileId(file),
                fileName: getFileName(file),
                isDir: isDirectoryLike(file),
                isVideo: isVideoFile(file),
                keys: file && typeof file === "object" ? Object.keys(file).slice(0, 12) : [],
            })),
            videoCount: videos.length,
            sampleNames: videos.slice(0, 5).map((file) => getFileName(file)),
        });
        return { videos, driveInfo, rootFiles: files, shareName };
    } catch (error) {
        logWarn("读取网盘文件失败", { shareURL, error: error.message || String(error) });
        return null;
    }
}

async function detectValidPanRoutes(shareURL, videos = [], callerSource = "", context = {}, maxNeeded = MAX_PAN_VALID_ROUTES) {
    const routeLimit = Math.max(1, Math.min(MAX_PAN_VALID_ROUTES, parseInt(maxNeeded, 10) || MAX_PAN_VALID_ROUTES));
    const filteredCandidates = filterSourceNamesForCaller(PAN_ROUTE_NAMES.length > 0 ? PAN_ROUTE_NAMES : ["直连"], callerSource, context);
    const cacheKey = `${shareURL}::${callerSource || "default"}::${routeLimit}::${filteredCandidates.join(",")}`;
    if (panRouteCache.has(cacheKey)) {
        return panRouteCache.get(cacheKey);
    }

    const sample = (videos || []).find((x) => getFileId(x));
    if (!sample) {
        const fallback = filteredCandidates.length > 0 ? filteredCandidates : ["直连"];
        const result = fallback.slice(0, routeLimit);
        panRouteCache.set(cacheKey, result);
        return result;
    }

    const sampleFileId = getFileId(sample);
    const validRoutes = [];
    for (const routeName of filteredCandidates.slice(0, routeLimit)) {
        try {
            const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, sampleFileId, routeName);
            if (hasValidPlayUrls(playInfo)) {
                validRoutes.push(routeName);
            }
        } catch (error) {
            logWarn("网盘线路有效性检测失败", { shareURL, routeName, error: error.message || String(error) });
        }
    }

    const result = validRoutes.slice(0, routeLimit);
    panRouteCache.set(cacheKey, result);
    logInfo("网盘线路有效性检测完成", {
        shareURL,
        callerSource,
        candidates: filteredCandidates,
        validRoutes: result,
        routeLimit,
    });
    return result;
}

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
        const driveType = inferDriveTypeFromShareURL(link) || normalizeDriveType(OmniBox.getDriveInfoByShareURL(link)?.driveType || "");
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

async function checkLinksWithPanCheck(links = []) {
    if (!PANCHECK_ENABLED || !PANCHECK_API || links.length === 0) {
        return {
            invalidLinksSet: new Set(),
            stats: null,
        };
    }

    try {
        const normalizedLinks = [...new Set((Array.isArray(links) ? links : []).map((link) => normalizeShareUrl(link)).filter(Boolean))];
        if (normalizedLinks.length === 0) {
            return {
                invalidLinksSet: new Set(),
                stats: {
                    selectedPlatforms: getPanCheckSelectedPlatforms(),
                    inputPlatformStats: {},
                    checkedPlatformStats: {},
                    invalidPlatformStats: {},
                    validPlatformStats: {},
                    bypassPlatformStats: {},
                    totalInput: 0,
                    totalChecked: 0,
                    totalInvalid: 0,
                    totalValid: 0,
                    totalBypass: 0,
                    totalOutput: 0,
                },
            };
        }

        const { selectedPlatforms, linksToCheck, bypassLinks } = splitLinksByPanCheckPlatforms(normalizedLinks);
        const detectDriveType = (link) => inferDriveTypeFromShareURL(link) || normalizeDriveType(OmniBox.getDriveInfoByShareURL(link)?.driveType || "") || "unknown";
        const inputPlatformStats = {};

        for (const link of normalizedLinks) {
            const driveType = detectDriveType(link);
            inputPlatformStats[driveType] = (inputPlatformStats[driveType] || 0) + 1;
        }

        if (linksToCheck.length === 0) {
            logInfo("PanCheck 跳过：无命中待校验平台", {
                totalInput: normalizedLinks.length,
                selectedPlatforms,
                inputPlatformStats,
            });
            return {
                invalidLinksSet: new Set(),
                stats: {
                    selectedPlatforms,
                    inputPlatformStats,
                    checkedPlatformStats: {},
                    invalidPlatformStats: {},
                    validPlatformStats: {},
                    bypassPlatformStats: inputPlatformStats,
                    totalInput: normalizedLinks.length,
                    totalChecked: 0,
                    totalInvalid: 0,
                    totalValid: 0,
                    totalBypass: bypassLinks.length,
                    totalOutput: normalizedLinks.length,
                },
            };
        }

        const apiUrl = PANCHECK_API.replace(/\/$/, "");
        const checkURL = `${apiUrl}/api/v1/links/check`;
        const requestBody = { links: linksToCheck };
        if (selectedPlatforms.length > 0) {
            requestBody.selected_platforms = selectedPlatforms;
        }

        logInfo("PanCheck 请求开始", {
            checkURL,
            totalInput: normalizedLinks.length,
            totalChecked: linksToCheck.length,
            totalBypass: bypassLinks.length,
            selectedPlatforms,
            linksPreview: linksToCheck.slice(0, 5),
        });

        const response = await OmniBox.request(checkURL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": DEFAULT_HEADERS["User-Agent"],
            },
            body: JSON.stringify(requestBody),
        });

        if (response.statusCode !== 200) {
            logWarn("PanCheck API 响应错误", {
                statusCode: response.statusCode,
                checkURL,
                responseBodyPreview: String(response.body || "").slice(0, 500),
            });
            return {
                invalidLinksSet: new Set(),
                stats: null,
            };
        }

        const data = safeJsonParse(response.body || "{}", {});
        const invalidLinks = Array.isArray(data.invalid_links) ? data.invalid_links.map((link) => normalizeShareUrl(link)).filter(Boolean) : [];
        const validLinks = Array.isArray(data.valid_links) ? data.valid_links.map((link) => normalizeShareUrl(link)).filter(Boolean) : [];
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

        logInfo("PanCheck 请求完成", {
            checkURL,
            invalidCount: invalidLinks.length,
            validCount: validLinks.length,
            invalidPreview: invalidLinks.slice(0, 5),
        });

        return {
            invalidLinksSet,
            stats: {
                selectedPlatforms,
                inputPlatformStats,
                checkedPlatformStats,
                invalidPlatformStats,
                validPlatformStats,
                bypassPlatformStats,
                totalInput: normalizedLinks.length,
                totalChecked: linksToCheck.length,
                totalInvalid: invalidLinks.length,
                totalValid: validLinks.length,
                totalBypass: bypassLinks.length,
                totalOutput: normalizedLinks.length - invalidLinks.length,
            },
        };
    } catch (error) {
        logWarn("PanCheck 链接检测失败", { error: error.message || String(error), api: PANCHECK_API });
        return {
            invalidLinksSet: new Set(),
            stats: null,
        };
    }
}

function normalizeGroupedShareLinks(grouped = {}) {
    const normalizedGrouped = {};
    for (const [panTypeKey, links] of Object.entries(grouped || {})) {
        const normalizedLinks = [...new Set((Array.isArray(links) ? links : []).map((item) => normalizeShareUrl(item)).filter(Boolean))];
        if (normalizedLinks.length > 0) {
            normalizedGrouped[panTypeKey] = normalizedLinks;
        }
    }
    return normalizedGrouped;
}

function serializeGroupedShareLinks(grouped = {}) {
    const normalized = normalizeGroupedShareLinks(grouped);
    const sorted = {};
    for (const key of Object.keys(normalized).sort()) {
        sorted[key] = normalized[key].slice().sort();
    }
    return JSON.stringify(sorted);
}

async function filterGroupedShareLinksBeforeEntry(videoId, grouped = {}) {
    const normalizedGrouped = normalizeGroupedShareLinks(grouped);
    const uniqueLinks = [...new Set(Object.values(normalizedGrouped).flat())];

    if (!PANCHECK_ENABLED || !PANCHECK_API || uniqueLinks.length === 0) {
        return {
            grouped: normalizedGrouped,
            changed: serializeGroupedShareLinks(grouped) !== serializeGroupedShareLinks(normalizedGrouped),
            stats: null,
            beforeCount: uniqueLinks.length,
            afterCount: uniqueLinks.length,
        };
    }

    const { invalidLinksSet, stats } = await checkLinksWithPanCheck(uniqueLinks);
    const filteredGrouped = {};
    for (const [panTypeKey, links] of Object.entries(normalizedGrouped)) {
        const validLinks = links.filter((link) => !invalidLinksSet.has(link));
        if (validLinks.length > 0) {
            filteredGrouped[panTypeKey] = validLinks;
        }
    }

    const beforeCount = uniqueLinks.length;
    const afterCount = Object.values(filteredGrouped).flat().length;
    logInfo("进入网盘分组前 PanCheck 过滤完成", {
        videoId,
        beforeCount,
        afterCount,
        groupedBefore: Object.fromEntries(Object.entries(normalizedGrouped).map(([key, links]) => [key, Array.isArray(links) ? links.length : 0])),
        groupedAfter: Object.fromEntries(Object.entries(filteredGrouped).map(([key, links]) => [key, Array.isArray(links) ? links.length : 0])),
        stats,
    });

    return {
        grouped: filteredGrouped,
        changed: serializeGroupedShareLinks(normalizedGrouped) !== serializeGroupedShareLinks(filteredGrouped),
        stats,
        beforeCount,
        afterCount,
    };
}

function buildSearchResultDetailCacheKey(videoId = "") {
    return buildCacheKey(`qiwei-group:detail:search-result:${QIWEI_PAN_CACHE_VERSION}`, String(videoId || "").trim());
}

function buildPanGroupDirectoryCacheKey(videoId = "") {
    return buildCacheKey(`qiwei-group:detail:pan-group:${QIWEI_PAN_CACHE_VERSION}`, String(videoId || "").trim());
}

function buildShareNameCacheKey(shareURL = "") {
    const normalizedShareURL = normalizeShareUrl(shareURL);
    const driveType = normalizeDriveType(inferDriveTypeFromShareURL(normalizedShareURL) || "unknown");
    let compactValue = normalizedShareURL;

    if (driveType === "baidu") {
        try {
            const parsed = new URL(normalizedShareURL);
            const pwd = parsed.searchParams.get("pwd") || "";
            const path = String(parsed.pathname || "").trim();
            compactValue = `baidu:${path}${pwd ? `?pwd=${pwd}` : ""}`;
        } catch {
            compactValue = normalizedShareURL;
        }
    } else {
        const shareId = extractPanShareId(normalizedShareURL);
        if (shareId) {
            compactValue = `${driveType}:${shareId}`;
        }
    }

    return buildCacheKey(`qiwei-group:shareName:${QIWEI_PAN_CACHE_VERSION}`, compactValue);
}

function encodePanFolderMeta(meta = {}) {
    try {
        return Buffer.from(JSON.stringify(meta || {}), "utf8").toString("base64");
    } catch (error) {
        logWarn("编码网盘文件夹元数据失败", { error: error.message || String(error) });
        return "";
    }
}

function decodePanFolderMeta(value = "") {
    const raw = String(value || "").trim();
    if (!raw) return null;
    try {
        const json = Buffer.from(raw, "base64").toString("utf8");
        const data = safeJsonParse(json, null);
        return data && typeof data === "object" ? data : null;
    } catch (error) {
        return null;
    }
}

function buildPanRootFolderVodId(videoId = "") {
    const normalizedVideoId = String(videoId || "").trim();
    return encodePanFolderMeta({
        kind: "panroot",
        videoId: normalizedVideoId,
    });
}

function buildSourceFolderVodId(videoId = "", sourceType = "") {
    const normalizedVideoId = String(videoId || "").trim();
    const normalizedSourceType = String(sourceType || "").trim().toLowerCase();
    return encodePanFolderMeta({
        kind: "sourcefolder",
        videoId: normalizedVideoId,
        sourceType: normalizedSourceType,
    });
}

function buildSourceLineFolderVodId(videoId = "", sourceType = "", lineIndex = 0) {
    const normalizedVideoId = String(videoId || "").trim();
    const normalizedSourceType = String(sourceType || "").trim().toLowerCase();
    const normalizedLineIndex = parseInt(lineIndex, 10) || 0;
    return encodePanFolderMeta({
        kind: "sourceline",
        videoId: normalizedVideoId,
        sourceType: normalizedSourceType,
        lineIndex: normalizedLineIndex,
    });
}

function buildPanGroupFolderVodId(videoId = "", panTypeKey = "") {
    const normalizedVideoId = String(videoId || "").trim();
    const normalizedPanType = normalizeDriveType(panTypeKey || "");
    return `${normalizedPanType}|${normalizedVideoId}`;
}

function buildPanShareFolderVodId(videoId = "", panTypeKey = "", shareIndex = 0) {
    const normalizedVideoId = String(videoId || "").trim();
    const normalizedPanType = normalizeDriveType(panTypeKey || "");
    const normalizedShareIndex = parseInt(shareIndex, 10) || 0;
    return encodePanFolderMeta({
        kind: "panfolder",
        videoId: normalizedVideoId,
        panTypeKey: normalizedPanType,
        isShareEntry: true,
        shareIndex: normalizedShareIndex,
    });
}

function parsePanFolderVodId(vodId = "") {
    const decoded = decodePanFolderMeta(vodId);
    if (decoded?.kind === "panroot") {
        const result = {
            videoId: String(decoded.videoId || "").trim(),
            panTypeKey: "",
            sourceType: "",
            lineIndex: -1,
            isShareEntry: false,
            shareIndex: -1,
            hasPrefix: true,
            isEncoded: true,
            isRootFolder: true,
            isSourceFolder: false,
            isSourceLineFolder: false,
        };
        logInfo("解析网盘目录ID(根目录)", {
            rawLength: String(vodId || "").length,
            videoId: result.videoId,
        });
        return result;
    }

    if (decoded?.kind === "sourcefolder") {
        const result = {
            videoId: String(decoded.videoId || "").trim(),
            panTypeKey: "",
            sourceType: String(decoded.sourceType || "").trim().toLowerCase(),
            lineIndex: -1,
            isShareEntry: false,
            shareIndex: -1,
            hasPrefix: true,
            isEncoded: true,
            isRootFolder: false,
            isSourceFolder: true,
            isSourceLineFolder: false,
        };
        logInfo("解析目录ID(线路根目录)", {
            rawLength: String(vodId || "").length,
            videoId: result.videoId,
            sourceType: result.sourceType,
        });
        return result;
    }

    if (decoded?.kind === "sourceline") {
        const result = {
            videoId: String(decoded.videoId || "").trim(),
            panTypeKey: "",
            sourceType: String(decoded.sourceType || "").trim().toLowerCase(),
            lineIndex: parseInt(decoded.lineIndex, 10) || 0,
            isShareEntry: false,
            shareIndex: -1,
            hasPrefix: true,
            isEncoded: true,
            isRootFolder: false,
            isSourceFolder: false,
            isSourceLineFolder: true,
        };
        logInfo("解析目录ID(线路详情目录)", {
            rawLength: String(vodId || "").length,
            videoId: result.videoId,
            sourceType: result.sourceType,
            lineIndex: result.lineIndex,
        });
        return result;
    }

    if (decoded?.kind === "panfolder") {
        const result = {
            videoId: String(decoded.videoId || "").trim(),
            panTypeKey: normalizeDriveType(decoded.panTypeKey || ""),
            sourceType: "",
            lineIndex: -1,
            isShareEntry: decoded.isShareEntry === true,
            shareIndex: decoded.isShareEntry ? (parseInt(decoded.shareIndex, 10) || 0) : -1,
            hasPrefix: true,
            isEncoded: true,
            isRootFolder: false,
            isSourceFolder: false,
            isSourceLineFolder: false,
        };
        logInfo("解析网盘目录ID(编码)", {
            rawLength: String(vodId || "").length,
            videoId: result.videoId,
            panTypeKey: result.panTypeKey,
            isShareEntry: result.isShareEntry,
            shareIndex: result.shareIndex,
        });
        return result;
    }

    const raw = String(vodId || "").trim();
    const pipeParts = raw.split("|");
    if (pipeParts.length >= 2) {
        const panTypeKey = normalizeDriveType(pipeParts[0] || "");
        const videoId = String(pipeParts.slice(1).join("|") || "").trim();
        if (panTypeKey && videoId) {
            const result = {
                videoId,
                panTypeKey,
                sourceType: "",
                lineIndex: -1,
                isShareEntry: false,
                shareIndex: -1,
                hasPrefix: false,
                isEncoded: false,
                isRootFolder: false,
                isSourceFolder: false,
                isSourceLineFolder: false,
            };
            logInfo("解析网盘目录ID(一级文件夹)", {
                raw: raw.slice(0, 120),
                videoId: result.videoId,
                panTypeKey: result.panTypeKey,
            });
            return result;
        }
    }

    const parts = raw.split("||");
    const hasPrefix = parts[0] === "panfolder";
    const isShareEntry = hasPrefix ? parts[3] === "share" : parts[2] === "share";
    const result = {
        videoId: hasPrefix ? (parts[1] || "") : (parts[0] || ""),
        panTypeKey: hasPrefix ? (parts[2] || "") : (parts[1] || ""),
        sourceType: "",
        lineIndex: -1,
        isShareEntry,
        shareIndex: isShareEntry ? parseInt(hasPrefix ? (parts[4] || "0") : (parts[3] || "0"), 10) || 0 : -1,
        hasPrefix,
        isEncoded: false,
        isRootFolder: false,
        isSourceFolder: false,
        isSourceLineFolder: false,
    };
    if (raw.includes("||") || result.panTypeKey) {
        logInfo("解析网盘目录ID(兼容)", {
            raw: raw.slice(0, 120),
            videoId: result.videoId,
            panTypeKey: result.panTypeKey,
            isShareEntry: result.isShareEntry,
            shareIndex: result.shareIndex,
        });
    }
    return result;
}

function buildPanGroupEntries(video = {}, grouped = {}) {
    const entries = [];
    const collectGroups = Array.isArray(grouped?.collect) ? grouped.collect : [];
    const magnetGroups = Array.isArray(grouped?.magnet) ? grouped.magnet : [];

    if (collectGroups.length > 0) {
        entries.push({
            vod_id: buildSourceFolderVodId(video.vod_id, "collect"),
            vod_name: "采集",
            vod_pic: String(video?.vod_pic || "").trim(),
            type_id: "source_category",
            type_name: "采集分组",
            vod_remarks: `${collectGroups.length}条线路`,
            vod_tag: "folder",
            sourceType: "collect",
        });
    }

    if (magnetGroups.length > 0) {
        if (magnetGroups.length === 1) {
            const onlyMagnetGroup = magnetGroups[0] || {};
            const onlyMagnetLineIndex = onlyMagnetGroup?.lineIndex ?? 0;
            const onlyMagnetEpisodeCount = Array.isArray(onlyMagnetGroup?.episodes) ? onlyMagnetGroup.episodes.length : 0;
            entries.push({
                vod_id: buildSourceLineFolderVodId(video.vod_id, "magnet", onlyMagnetLineIndex),
                vod_name: String(onlyMagnetGroup?.name || "磁力").trim() || "磁力",
                vod_pic: String(video?.vod_pic || "").trim(),
                type_id: "source_line",
                type_name: "磁力线路",
                vod_remarks: `${onlyMagnetEpisodeCount}条资源`,
                vod_tag: "video",
                sourceType: "magnet",
            });
        } else {
            entries.push({
                vod_id: buildSourceFolderVodId(video.vod_id, "magnet"),
                vod_name: "磁力",
                vod_pic: String(video?.vod_pic || "").trim(),
                type_id: "source_category",
                type_name: "磁力分组",
                vod_remarks: `${magnetGroups.length}条线路`,
                vod_tag: "folder",
                sourceType: "magnet",
            });
        }
    }

    const panEntries = sortGroupResultsByDriveOrder(
        Object.entries(grouped)
            .filter(([panTypeKey]) => panTypeKey !== "collect" && panTypeKey !== "magnet")
            .map(([panTypeKey, links]) => {
                const uniqueLinks = buildUniqueShareLinkMetas(links).map((item) => item.shareURL);
                if (uniqueLinks.length === 0) return null;
                const panTypeName = parsePanType(uniqueLinks[0]);
                return {
                    vod_id: buildPanGroupFolderVodId(video.vod_id, panTypeKey),
                    vod_name: panTypeName,
                    vod_pic: String(video?.vod_pic || "").trim(),
                    type_id: "pan_category",
                    type_name: "网盘分类",
                    vod_remarks: `${uniqueLinks.length}条结果`,
                    vod_tag: "folder",
                    panType: panTypeKey,
                    shareCount: uniqueLinks.length,
                };
            })
            .filter(Boolean)
    );

    entries.push(...panEntries);

    logInfo("构建网盘分组目录项", {
        videoId: String(video?.vod_id || "").trim(),
        groupCount: entries.length,
        groups: entries.map((item) => ({
            vod_name: item.vod_name,
            panType: item.panType,
            sourceType: item.sourceType,
            type_id: item.type_id,
            vod_tag: item.vod_tag,
            vod_id_preview: String(item.vod_id || "").slice(0, 80),
        })),
    });
    return entries;
}

function buildSourceLineEntries(video = {}, sourceType = "", groups = []) {
    const normalizedSourceType = String(sourceType || "").trim().toLowerCase();
    return (Array.isArray(groups) ? groups : []).map((group, index) => {
        const lineName = String(group?.name || `${normalizedSourceType}线路${index + 1}`).trim();
        const episodeCount = Array.isArray(group?.episodes) ? group.episodes.length : 0;
        return {
            vod_id: buildSourceLineFolderVodId(video.vod_id, normalizedSourceType, group?.lineIndex ?? index),
            vod_name: lineName,
            vod_pic: String(video?.vod_pic || "").trim(),
            vod_remarks: normalizedSourceType === "magnet" ? `${episodeCount}条资源` : `${episodeCount}集`,
            vod_tag: normalizedSourceType === "magnet" ? "video" : "folder",
            type_id: "source_line",
            type_name: normalizedSourceType === "magnet" ? "磁力线路" : "采集线路",
            sourceType: normalizedSourceType,
        };
    });
}

async function buildPanShareEntries(video = {}, detailInfo = {}, panTypeKey = "", links = []) {
    const linkMetas = buildUniqueShareLinkMetas(links);
    return await Promise.all(linkMetas.map(async ({ shareURL, shareNameHint }, index) => {
        if (shareNameHint) {
            await setCachedJSON(buildShareNameCacheKey(shareURL), shareNameHint, QIWEI_CACHE_EX_SECONDS);
        }
        const shareName = cleanShareDisplayNameCandidate(shareNameHint || await getShareDisplayNameCached(shareURL));
        const fallbackShareName = `分享 ${index + 1}`;
        const displayShareName = String(shareName || fallbackShareName).trim();
        return {
            vod_id: buildPanShareFolderVodId(video.vod_id, panTypeKey, index),
            vod_name: displayShareName,
            vod_pic: String(detailInfo?.vod_pic || video?.vod_pic || "").trim(),
            vod_remarks: String(parsePanType(shareURL) || panTypeKey || "网盘分享").trim(),
            vod_tag: "video",
            panType: panTypeKey,
            shareIndex: index,
            shareURL,
        };
    }));
}

async function extractPanLinksFromDetail(videoId) {
    const normalizedVideoId = extractVideoId(videoId);
    if (!normalizedVideoId) {
        logWarn("提取详情网盘链接失败：videoId 为空", { videoId });
        return { detailInfo: {}, grouped: {} };
    }

    const path = `/mv/${normalizedVideoId}.html`;
    const { html, host } = await requestHtmlWithFailover(path);
    const detailInfo = parseDetailInfo(html, host);
    const $ = cheerio.load(html || "");
    const panRegex = /https?:\/\/(pan\.baidu\.com|pan\.quark\.cn|drive\.uc\.cn|cloud\.189\.cn|yun\.139\.com|alipan\.com|aliyundrive\.com|pan\.aliyun\.com|115\.com|115cdn\.com|123pan\.com|123684\.com|123865\.com|123912\.com|pan\.xunlei\.com)\/[^"'\s>]+/g;
    const htmlPanLinks = html.match(panRegex) || [];
    const rowPanLinks = extractDownloadSectionShareMetas($);
    const anchorPanLinks = $("a")
        .toArray()
        .flatMap((a) => {
            const links = [];
            const anchor = $(a);
            const href = anchor.attr("href") || "";
            const clipboard = anchor.attr("data-clipboard-text") || "";
            const rowTitle = anchor.closest("li.down-list2").find("p.down-list3").first();
            const nameHint = pickBetterShareDisplayName(
                rowTitle.find("a").first().attr("title") || "",
                rowTitle.text() || "",
                anchor.attr("title") || "",
                anchor.text() || ""
            );
            if (isPanUrl(href)) links.push({ url: href, nameHint });
            if (isPanUrl(clipboard)) links.push({ url: clipboard, nameHint });
            return links;
        });

    const collectGroups = [];
    const tabItems = $(".py-tabs li").toArray();
    const episodeContainers = $(".bd ul.player").toArray();
    const normalizedLineNames = tabItems.map((tab, index) => {
        const rawName = $(tab).text().trim();
        const normalizedName = normalizeCollectLineName(rawName);
        return normalizedName || `线路${index + 1}`;
    });
    const lineNameCounter = normalizedLineNames.reduce((acc, name) => {
        acc.set(name, (acc.get(name) || 0) + 1);
        return acc;
    }, new Map());
    const lineNameSeen = new Map();
    const lineCount = Math.min(tabItems.length, episodeContainers.length);
    for (let i = 0; i < lineCount; i++) {
        const baseLineName = normalizedLineNames[i] || `线路${i + 1}`;
        const duplicatedCount = lineNameCounter.get(baseLineName) || 0;
        const currentIndex = (lineNameSeen.get(baseLineName) || 0) + 1;
        lineNameSeen.set(baseLineName, currentIndex);
        const lineName = duplicatedCount > 1 ? `${baseLineName} ${currentIndex}` : baseLineName;
        if (isBlockedLineName(lineName)) continue;

        const episodes = [];
        $(episodeContainers[i])
            .find("a")
            .each((idx, node) => {
                const name = $(node).text().trim() || `第${idx + 1}集`;
                const fid = `${normalizedVideoId}#${i}#${idx}`;
                episodes.push({
                    name,
                    playId: `${normalizedVideoId}|${i}|${idx}|||${encodeMeta({ sid: String(normalizedVideoId || ""), fid, e: name })}`,
                    _fid: fid,
                    _rawName: name,
                });
            });

        if (episodes.length === 0) {
            const fid = `${normalizedVideoId}#${i}#0`;
            episodes.push({
                name: "正片",
                playId: `${normalizedVideoId}|${i}|0|||${encodeMeta({ sid: String(normalizedVideoId || ""), fid, e: "正片" })}`,
                _fid: fid,
                _rawName: "正片",
            });
        }

        collectGroups.push({
            lineIndex: i,
            name: lineName,
            episodes,
        });
    }

    const magnetGroups = [];
    const magnetMetaMap = new Map();
    const upsertMagnetMeta = (rawLink = "", meta = {}) => {
        const link = String(rawLink || "").trim();
        if (!/^(magnet:\?xt=urn:btih:|ed2k:\/\/|https?:\/\/[^\s]+\.torrent(?:$|\?))/i.test(link)) return;
        const previous = magnetMetaMap.get(link) || {};
        magnetMetaMap.set(link, {
            ...previous,
            ...meta,
            link,
            zname: pickBetterShareDisplayName(meta?.zname || meta?.name || "", previous?.zname || previous?.name || "") || previous?.zname || previous?.name || meta?.zname || meta?.name || "",
            zsize: String(meta?.zsize || previous?.zsize || "").trim(),
            zqxd: String(meta?.zqxd || previous?.zqxd || "").trim(),
            ezt: String(meta?.ezt || previous?.ezt || "").trim(),
            type: normalizeSeedType(meta?.type || previous?.type || "", link),
        });
    };
    html.replace(/magnet:\?xt=urn:btih:[A-Za-z0-9]+[^"'\s<]*/gi, (match) => {
        upsertMagnetMeta(match, {});
        return match;
    });
    html.replace(/ed2k:\/\/[^"'\s<]+/gi, (match) => {
        upsertMagnetMeta(match, {});
        return match;
    });
    html.replace(/https?:\/\/[^"'\s<]+\.torrent(?:\?[^"'\s<]*)?/gi, (match) => {
        upsertMagnetMeta(match, {});
        return match;
    });
    $("a").each((_, a) => {
        const anchor = $(a);
        const href = String(anchor.attr("href") || "").trim();
        const clipboard = String(anchor.attr("data-clipboard-text") || "").trim();
        const title = pickBetterShareDisplayName(anchor.attr("title") || "", anchor.text() || "");
        const meta = { zname: title };
        upsertMagnetMeta(href, meta);
        upsertMagnetMeta(clipboard, meta);
    });
    Array.from(magnetMetaMap.values()).forEach((item, index) => {
        const fallbackTitle = pickBetterShareDisplayName(item?.zname || item?.name || "", `磁力资源${index + 1}`);
        const episode = buildMagnetEpisode(item, fallbackTitle, { simplePlayId: true, directPlayable: true });
        magnetGroups.push({
            lineIndex: index,
            name: `磁力线路${index + 1}`,
            episodes: [{
                name: episode.name,
                playId: episode.playId,
                _fid: `magnet#${index}`,
                _rawName: episode._rawName || episode.name,
                _displayName: episode._displayName || episode.name,
                _seedType: episode.seedType,
                _episodeNumber: episode.episodeNumber,
                _episodeRangeStart: episode.episodeRangeStart,
                _episodeRangeEnd: episode.episodeRangeEnd,
            }],
        });
    });

    const shareMetaMap = new Map();
    const upsertShareMeta = (rawLink = "", nameHint = "") => {
        const shareURL = normalizeShareUrl(rawLink);
        if (!shareURL) return;
        const normalizedNameHint = pickBetterShareDisplayName(nameHint, extractShareDisplayNameFromShareUrl(rawLink));
        const prev = shareMetaMap.get(shareURL) || { shareURL, nameHint: "" };
        const betterNameHint = pickBetterShareDisplayName(prev.nameHint || "", normalizedNameHint || "");
        if (betterNameHint) {
            prev.nameHint = betterNameHint;
        }
        shareMetaMap.set(shareURL, prev);
    };

    for (const item of rowPanLinks) {
        upsertShareMeta(item?.url || "", item?.nameHint || "");
    }
    for (const rawLink of htmlPanLinks) {
        upsertShareMeta(rawLink);
    }
    for (const item of anchorPanLinks) {
        upsertShareMeta(item?.url || "", item?.nameHint || "");
    }

    const allPanLinks = Array.from(shareMetaMap.keys());
    const grouped = {};
    for (const [link, meta] of shareMetaMap.entries()) {
        const panTypeKey = parsePanTypeKey(link);
        if (!panTypeKey) continue;
        if (meta?.nameHint) {
            await setCachedJSON(buildShareNameCacheKey(link), meta.nameHint, QIWEI_CACHE_EX_SECONDS);
        }
        if (!grouped[panTypeKey]) grouped[panTypeKey] = [];
        grouped[panTypeKey].push(link);
    }

    if (collectGroups.length > 0) {
        grouped.collect = collectGroups;
    }
    if (magnetGroups.length > 0) {
        grouped.magnet = magnetGroups;
    }

    logInfo("提取详情网盘链接完成", {
        videoId: normalizedVideoId,
        detailName: detailInfo.vod_name || "",
        rowMatchCount: rowPanLinks.length,
        htmlMatchCount: htmlPanLinks.length,
        anchorMatchCount: anchorPanLinks.length,
        collectCount: collectGroups.length,
        magnetCount: magnetGroups.length,
        totalUnique: allPanLinks.length,
        shareNameHints: Array.from(shareMetaMap.values()).slice(0, 8).map((item) => ({
            shareURL: String(item?.shareURL || "").slice(0, 120),
            nameHint: item?.nameHint || "",
        })),
        groupedStats: Object.fromEntries(Object.entries(grouped).map(([key, links]) => [key, Array.isArray(links) ? links.length : 0])),
    });

    return { detailInfo, grouped };
}

async function buildAndCacheVideoPanDetail(video = {}) {
    const videoId = String(video?.vod_id || "").trim();
    if (!videoId) return null;

    const panData = await extractPanLinksFromDetail(videoId);
    const detailInfo = panData?.detailInfo || {};
    const groupedRaw = panData?.grouped || {};
    logInfo("构建剧集网盘缓存详情", {
        videoId,
        detailName: detailInfo?.vod_name || "",
        groupedKeys: Object.keys(groupedRaw),
        groupedStats: Object.fromEntries(Object.entries(groupedRaw).map(([key, links]) => [key, Array.isArray(links) ? links.length : 0])),
        panCheckEnabled: PANCHECK_ENABLED,
        panCheckApiConfigured: !!PANCHECK_API,
        scrapeEnabled: typeof OmniBox?.processScraping === "function" && typeof OmniBox?.getScrapeMetadata === "function",
        danmuEnabled: typeof OmniBox?.getDanmakuByFileName === "function" || !!DANMU_API,
    });
    const allLinks = [];
    for (const links of Object.values(groupedRaw)) {
        if (Array.isArray(links)) allLinks.push(...links);
    }
    const uniqueLinks = [...new Set(allLinks.map((item) => normalizeShareUrl(item)).filter(Boolean))];
    let validLinksSet = new Set(uniqueLinks);
    if (PANCHECK_ENABLED && PANCHECK_API && uniqueLinks.length > 0) {
        logInfo("构建缓存详情时触发 PanCheck", {
            videoId,
            totalLinks: uniqueLinks.length,
            platforms: getPanCheckSelectedPlatforms(),
            linksPreview: uniqueLinks.slice(0, 5),
        });
        const { invalidLinksSet, stats } = await checkLinksWithPanCheck(uniqueLinks);
        validLinksSet = new Set(uniqueLinks.filter((link) => !invalidLinksSet.has(link)));
        if (stats) {
            logInfo("PanCheck 分平台统计(七味分组详情)", stats);
        }
    } else {
        logWarn("构建缓存详情时未触发 PanCheck", {
            videoId,
            panCheckEnabled: PANCHECK_ENABLED,
            hasPanCheckApi: !!PANCHECK_API,
            totalLinks: uniqueLinks.length,
        });
    }

    const filteredGrouped = {};
    for (const [panTypeKey, links] of Object.entries(groupedRaw)) {
        if (panTypeKey === "collect" || panTypeKey === "magnet") {
            if (Array.isArray(links) && links.length > 0) {
                filteredGrouped[panTypeKey] = links;
            }
            continue;
        }
        const filteredLinks = (Array.isArray(links) ? links : [])
            .map((item) => normalizeShareUrl(item))
            .filter((item) => item && validLinksSet.has(item));
        if (filteredLinks.length > 0) {
            filteredGrouped[panTypeKey] = [...new Set(filteredLinks)];
        }
    }

    const payload = {
        video: {
            vod_id: videoId,
            vod_name: String(video?.vod_name || detailInfo?.vod_name || "").trim(),
            vod_pic: String(video?.vod_pic || detailInfo?.vod_pic || "").trim(),
            vod_remarks: String(video?.vod_remarks || detailInfo?.vod_remarks || "").trim(),
        },
        detailInfo,
        grouped: filteredGrouped,
    };

    await setCachedJSON(buildPanGroupDirectoryCacheKey(videoId), payload, QIWEI_CACHE_EX_SECONDS);
    await setCachedJSON(buildSearchResultDetailCacheKey(videoId), payload, QIWEI_CACHE_EX_SECONDS);
    return payload;
}

async function getCachedOrBuildVideoPanDetail(video = {}, options = {}) {
    const videoId = String(video?.vod_id || "").trim();
    if (!videoId) return null;
    const forceRefresh = options.forceRefresh === true;
    if (!forceRefresh) {
        let cached = await getCachedJSON(buildPanGroupDirectoryCacheKey(videoId));
        if (cached && cached.grouped) {
            return cached;
        }
        cached = await getCachedJSON(buildSearchResultDetailCacheKey(videoId));
        if (cached && cached.grouped) {
            await setCachedJSON(buildPanGroupDirectoryCacheKey(videoId), cached, QIWEI_CACHE_EX_SECONDS);
            return cached;
        }
    } else {
        logInfo("强制刷新详情分组缓存", { videoId, reason: options.reason || "force_refresh" });
    }
    return await buildAndCacheVideoPanDetail(video);
}

function buildScrapedEpisodeName(scrapeData, mapping, fallbackName, displayName = "") {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return fallbackName;
    }
    const scrapedEpisodeName = String(mapping?.episodeName || "").trim();
    const episodeNumber = Number(mapping?.episodeNumber);
    const fallbackText = cleanPlayLabel(displayName || fallbackName || "", fallbackName || "");
    const sizePrefix = (fallbackText.match(/^\[[^\]]+\]\s*/) || [""])[0];
    let episodeLabel = "";
    const range = extractEpisodeRange(fallbackText || fallbackName || "");
    if (range) {
        episodeLabel = formatEpisodeRangeLabel(range);
    } else if (Number.isFinite(episodeNumber) && episodeNumber > 0) {
        episodeLabel = formatEpisodeLabel(episodeNumber);
    } else {
        const fallbackEpisodeNumber = extractEpisodeNumber(fallbackText || fallbackName || "");
        if (Number.isFinite(fallbackEpisodeNumber) && fallbackEpisodeNumber > 0) episodeLabel = formatEpisodeLabel(fallbackEpisodeNumber);
    }
    if (scrapedEpisodeName) {
        return cleanPlayLabel(`${sizePrefix}${episodeLabel ? `${episodeLabel} ` : ""}${scrapedEpisodeName}`, fallbackName);
    }
    return fallbackText || fallbackName;
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName = "", fallbackEpisodeName = "") {
    const title = String(scrapeData?.title || fallbackVodName || "").trim();
    if (!title) return "";
    if (scrapeType === "movie") {
        return title;
    }
    const seasonAirYear = String(scrapeData?.seasonAirYear || "").trim();
    const seasonNumber = Number(mapping?.seasonNumber || 1);
    const episodeNumber = Number(mapping?.episodeNumber || 1);
    const episodeName = String(mapping?.episodeName || fallbackEpisodeName || "").trim();
    const prefix = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
    return episodeName ? `${prefix}.${episodeName}` : prefix;
}

function buildFileNameForDanmu(vodName = "", episodeName = "") {
    const title = String(vodName || "").trim();
    const ep = String(episodeName || "").trim();
    if (!title) return ep;
    return ep ? `${title}.${ep}` : title;
}

async function matchDanmu(fileName = "") {
    if (!DANMU_API || !fileName) {
        logWarn("跳过弹幕匹配", { fileName, hasDanmuApi: !!DANMU_API, reason: !fileName ? "empty_filename" : "missing_danmu_api" });
        return [];
    }
    try {
        const url = `${String(DANMU_API).replace(/\/$/, "")}/api/v1/match?keyword=${encodeURIComponent(fileName)}`;
        logInfo("开始弹幕匹配", { fileName, url });
        const response = await axiosInstance.get(url, { headers: DEFAULT_HEADERS });
        const data = typeof response.data === "string" ? safeJsonParse(response.data, {}) : response.data || {};
        const list = Array.isArray(data?.data) ? data.data : Array.isArray(data?.list) ? data.list : [];
        logInfo("弹幕匹配完成", { fileName, count: list.length });
        return list;
    } catch (error) {
        logWarn("弹幕匹配失败", { fileName, error: error.message || String(error) });
        return [];
    }
}

function rewritePlayIdMeta(playId = "", patchMeta = {}) {
    const raw = String(playId || "").trim();
    if (is115MagnetPlayId(raw, "115秒传")) {
        const data = decode115MagnetPlayMeta(raw);
        if (data?.kind === "115magnetplay") {
            return build115MagnetPlayId({ ...data, ...patchMeta });
        }
    }
    if (!raw.includes("|||")) return raw;
    const [main, metaB64] = raw.split("|||");
    const meta = decodeMeta(metaB64 || "");
    return `${main}|||${encodeMeta({ ...meta, ...patchMeta })}`;
}

function normalizeScrapeFileName(value = "") {
    return normalizeText(value)
        .split(/[\\/]/)
        .pop()
        .replace(/\.[a-z0-9]{2,5}$/i, "")
        .replace(/[._\-\[\]()【】（）]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function buildScrapeMappingByEpisode(metadata = {}) {
    const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
    const byEpisode = new Map();
    for (const mapping of mappings) {
        const ep = Number(mapping?.episodeNumber);
        if (!Number.isFinite(ep) || ep <= 0) continue;
        if (!byEpisode.has(ep)) byEpisode.set(ep, mapping);
    }
    return byEpisode;
}

function findScrapeMapping(metadata = {}, candidates = [], episodeNumber = null, rawName = "") {
    const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
    for (const key of candidates.map((item) => String(item || "").trim()).filter(Boolean)) {
        const mapping = mappings.find((item) => String(item?.fileId || "").trim() === key);
        if (mapping) return mapping;
    }
    const epNo = Number(episodeNumber);
    if (Number.isFinite(epNo) && epNo > 0) {
        const mapping = buildScrapeMappingByEpisode(metadata).get(epNo);
        if (mapping) return mapping;
    }
    const normalizedRawName = normalizeScrapeFileName(rawName);
    if (normalizedRawName) {
        const mapping = mappings.find((item) => {
            const mappingName = normalizeScrapeFileName(item?.fileName || item?.file_name || item?.name || item?.sourceFileName || item?.sourceName || "");
            return mappingName && (mappingName === normalizedRawName || mappingName.includes(normalizedRawName) || normalizedRawName.includes(mappingName));
        });
        if (mapping) return mapping;
    }
    return null;
}

async function getMergedMetadataCached(videoId, title, scrapeCandidates = []) {
    const cacheKey = buildCacheKey("qiwei-group:scrape", videoId);
    let cached = await getCachedJSON(cacheKey);
    if (cached && cached.scrapeData) {
        const cachedMappings = Array.isArray(cached.videoMappings) ? cached.videoMappings : [];
        const hasLegacyHashFileId = cachedMappings.some((item) => String(item?.fileId || "").includes("#"));
        if (hasLegacyHashFileId) {
            logWarn("刮削元数据缓存已过期，准备重建", {
                videoId,
                title,
                reason: "legacy_hash_fileId_format",
                mappingPreview: cachedMappings.slice(0, 3).map((item) => String(item?.fileId || "").slice(0, 160)),
            });
            try {
                await deleteCachedJSON(cacheKey);
            } catch (error) {
                logWarn("删除旧刮削元数据缓存失败", { videoId, cacheKey, error: error.message || String(error) });
            }
            cached = null;
        } else {
            logInfo("命中刮削元数据缓存", {
                videoId,
                title,
                candidateCount: Array.isArray(scrapeCandidates) ? scrapeCandidates.length : 0,
                mappingCount: cachedMappings.length,
                scrapeType: cached.scrapeType || "",
                mappingPreview: cachedMappings.slice(0, 3).map((item) => String(item?.fileId || "").slice(0, 160)),
            });
            return {
                scrapeData: cached.scrapeData || null,
                videoMappings: cachedMappings,
                scrapeType: cached.scrapeType || "",
            };
        }
    }

    if (!Array.isArray(scrapeCandidates) || scrapeCandidates.length === 0) {
        logWarn("跳过刮削元数据", { videoId, title, reason: "empty_scrape_candidates" });
        return { scrapeData: null, videoMappings: [], scrapeType: "" };
    }

    try {
        logInfo("开始刮削元数据", {
            videoId,
            title,
            candidateCount: scrapeCandidates.length,
            candidatePreview: scrapeCandidates.slice(0, 3).map((item) => ({
                fid: String(item?.fid || item?.file_id || "").slice(0, 120),
                file_name: item?.file_name || item?.name || "",
            })),
        });
        const scrapingResult = await OmniBox.processScraping(String(videoId || ""), title || "", title || "", scrapeCandidates);
        const metadata = await OmniBox.getScrapeMetadata(String(videoId || ""));
        const result = {
            scrapeData: metadata?.scrapeData || null,
            videoMappings: Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [],
            scrapeType: metadata?.scrapeType || "",
        };
        logInfo("刮削元数据完成", {
            videoId,
            hasScrapeData: !!result.scrapeData,
            mappingCount: result.videoMappings.length,
            scrapeType: result.scrapeType || "",
            title: result.scrapeData?.title || "",
            processResultKeys: scrapingResult && typeof scrapingResult === "object" ? Object.keys(scrapingResult).slice(0, 12) : [],
            mappingPreview: result.videoMappings.slice(0, 3).map((item) => ({
                fileId: String(item?.fileId || "").slice(0, 100),
                episodeNumber: item?.episodeNumber || null,
                episodeName: item?.episodeName || "",
            })),
        });
        await setCachedJSON(cacheKey, result, QIWEI_CACHE_EX_SECONDS);
        return result;
    } catch (error) {
        logWarn("刮削元数据失败", { videoId, title, error: error.message || String(error) });
        return { scrapeData: null, videoMappings: [], scrapeType: "" };
    }
}

async function ensureDetailCache(videoId, video = {}, options = {}) {
    const normalizedVideoId = String(videoId || video?.vod_id || "").trim();
    if (!normalizedVideoId) return null;
    const payload = await getCachedOrBuildVideoPanDetail({
        vod_id: normalizedVideoId,
        vod_name: video?.vod_name || "",
        vod_pic: video?.vod_pic || "",
        vod_remarks: video?.vod_remarks || "",
    }, options);
    if (!payload) return null;

    return {
        cacheValue: payload,
        cacheKey: buildPanGroupDirectoryCacheKey(normalizedVideoId),
        fromCache: options.forceRefresh === true ? false : true,
    };
}

async function home(params) {
    try {
        const { html, host } = await requestHtmlWithFailover("/");
        const list = parseVideoList(html, host).map((item) => buildPanSearchEntryVod(item, host)).filter((item) => item.vod_id && item.vod_name);
        logInfo("首页加载完成", { host, count: list.length });
        return { class: CLASSES, filters: FILTERS, list };
    } catch (error) {
        logError("首页加载失败", error);
        return { class: CLASSES, filters: FILTERS, list: [] };
    }
}

async function category(params, context = {}) {
    const categoryId = String(params.categoryId || params.type_id || "1").trim();
    const page = parsePage(params.page, 1);
    const filters = parseFilters(params);
    const parsed = parsePanFolderVodId(categoryId);
    const parsedVideoId = extractVideoId(parsed.videoId);
    const parsedPanType = normalizeDriveType(parsed.panTypeKey || "");
    const source = resolveCallerSource(params, context) || "category-folder";

    if (parsedVideoId && parsed.isRootFolder) {
        logInfo("分类命中剧集根文件夹", { categoryId, page, parsedVideoId, source });
        const ensuredDetailCache = await ensureDetailCache(parsedVideoId, { vod_id: parsedVideoId });
        const cachedDetail = ensuredDetailCache?.cacheValue || null;
        const grouped = cachedDetail?.grouped || {};
        const video = cachedDetail?.video || { vod_id: parsedVideoId };
        if (!cachedDetail || !Object.keys(grouped).length) {
            logWarn("根文件夹缓存构建失败", { categoryId, parsedVideoId, source });
            return { page, pagecount: page, total: 0, list: [] };
        }
        const list = buildPanGroupEntries(video, grouped);
        logInfo("分类返回剧集网盘分组文件夹页", {
            categoryId,
            videoId: parsedVideoId,
            page,
            count: list.length,
            source,
            listPreview: list.map((item) => ({
                vod_name: item.vod_name,
                type_id: item.type_id,
                vod_tag: item.vod_tag,
                panType: item.panType,
                sourceType: item.sourceType,
                vod_id_preview: String(item.vod_id || "").slice(0, 80),
            })),
        });
        return {
            page,
            pagecount: page,
            total: list.length,
            list,
        };
    }

    if (parsedVideoId && parsed.isSourceFolder) {
        logInfo("分类命中线路根分组", { categoryId, page, parsedVideoId, sourceType: parsed.sourceType, source });
        const ensuredDetailCache = await ensureDetailCache(parsedVideoId, { vod_id: parsedVideoId });
        const cachedDetail = ensuredDetailCache?.cacheValue || null;
        const sourceGroups = Array.isArray(cachedDetail?.grouped?.[parsed.sourceType]) ? cachedDetail.grouped[parsed.sourceType] : [];
        const video = cachedDetail?.video || { vod_id: parsedVideoId };
        if (!sourceGroups.length) {
            logWarn("线路根分组缓存构建失败", { categoryId, parsedVideoId, sourceType: parsed.sourceType, source });
            return { page, pagecount: page, total: 0, list: [] };
        }
        const fullList = buildSourceLineEntries(video, parsed.sourceType, sourceGroups);
        const paged = paginateList(fullList, page, 20);
        return {
            page: paged.page,
            pagecount: paged.page,
            total: paged.total,
            list: paged.list,
        };
    }

    if (parsedVideoId && parsed.isSourceLineFolder) {
        logInfo("分类命中线路详情目录，转详情链路", {
            categoryId,
            page,
            parsedVideoId,
            sourceType: parsed.sourceType,
            lineIndex: parsed.lineIndex,
            source,
        });
        return await detail({
            ...params,
            videoId: categoryId,
            page,
            source,
        }, context);
    }

    if (parsedVideoId && parsedPanType) {
        const forwardedVideoId = categoryId;
        logInfo("分类命中网盘目录，转详情链路", {
            categoryId,
            page,
            parsedVideoId,
            parsedPanType,
            isShareEntry: parsed.isShareEntry,
            source,
            forwardedVideoIdPreview: String(forwardedVideoId || "").slice(0, 120),
            mode: parsed.isShareEntry ? "share-detail" : "share-folder-list",
        });
        return await detail({
            ...params,
            videoId: forwardedVideoId,
            page,
            source,
        }, context);
    }

    try {
        const path = buildCategoryPath(categoryId, page, filters);
        logInfo("分类请求参数", { categoryId, page, filters, path });
        const { html, host } = await requestHtmlWithFailover(path);
        const list = parseVideoList(html, host).map((item) => buildPanSearchEntryVod(item, host)).filter((item) => item.vod_id && item.vod_name);
        logInfo("分类加载完成", { categoryId, page, host, count: list.length, filters });
        return {
            page,
            pagecount: list.length >= 20 ? page + 1 : page,
            total: list.length,
            list,
        };
    } catch (error) {
        logError("分类加载失败", error);
        return {
            page,
            pagecount: page,
            total: 0,
            list: [],
        };
    }
}

async function search(params) {
    const keyword = String(params.keyword || params.wd || "").trim();
    const page = parsePage(params.page, 1);
    logInfo("搜索入口", {
        keyword,
        page,
        source: params?.source || "",
        rawKeyword: params?.wd || params?.keyword || "",
    });

    if (!keyword) {
        return { page, pagecount: page, total: 0, list: [] };
    }

    try {
        const path = `/index.php/ajax/suggest?mid=1&limit=20&wd=${encodeURIComponent(keyword)}`;
        const { html, host } = await requestHtmlWithFailover(path, {
            headers: {
                Accept: "application/json, text/plain, */*",
                "X-Requested-With": "XMLHttpRequest",
                Referer: `${getCurrentHost()}/`,
            },
        });
        const data = safeJsonParse(html, {});
        const items = Array.isArray(data?.list) ? data.list : [];
        const list = items.map((item) => {
            const videoId = String(item?.id || "").trim();
            const folderVodId = buildPanRootFolderVodId(videoId);
            return {
                vod_id: folderVodId,
                vod_name: String(item?.name || "").trim(),
                vod_pic: normalizeImage(item?.pic || "", host),
                vod_remarks: "点击查看网盘分组",
                vod_tag: "folder",
                type_id: folderVodId,
                type_name: "剧集网盘分组",
            };
        }).filter((item) => item.vod_id && item.vod_name);
        const pageCount = Number(data?.pagecount) || (list.length >= 20 ? page + 1 : page);
        const total = Number(data?.total) || list.length;
        logInfo("搜索完成", { keyword, page, host, count: list.length, api: path, total, pageCount });
        return {
            page,
            pagecount: pageCount,
            total,
            list,
        };
    } catch (error) {
        logError("搜索失败", error);
        return {
            page,
            pagecount: page,
            total: 0,
            list: [],
        };
    }
}

async function detail(params, context = {}) {
    const rawVideoId = String(params.videoId || "").trim();
    const parsed = parsePanFolderVodId(rawVideoId);
    const videoId = extractVideoId(parsed.videoId || rawVideoId);
    const targetPanType = normalizeDriveType(parsed.panTypeKey || "");
    const sourceType = String(parsed.sourceType || "").trim().toLowerCase();
    const page = parsePage(params.page, 1);
    logInfo("详情入口", {
        rawVideoId,
        parsedVideoId: parsed.videoId || "",
        videoId,
        targetPanType,
        sourceType,
        lineIndex: parsed.lineIndex,
        isShareEntry: parsed.isShareEntry,
        isEncoded: parsed.isEncoded,
        page,
        source: params?.source || context?.from || "",
    });

    if (!videoId) {
        logWarn("详情请求缺少 videoId", { rawVideoId });
        return { list: [] };
    }

    const isFolderMode = !!targetPanType || !!sourceType;

    try {
        if (!isFolderMode) {
            const path = `/mv/${videoId}.html`;
            const { html, host } = await requestHtmlWithFailover(path);
            const detailInfo = parseDetailInfo(html, host);
            const video = {
                vod_id: videoId,
                vod_name: detailInfo.vod_name || "",
                vod_pic: detailInfo.vod_pic || "",
                vod_remarks: detailInfo.vod_remarks || "",
            };
            const payload = await getCachedOrBuildVideoPanDetail(video);
            const grouped = payload?.grouped || {};
            logInfo("剧集详情网盘分组原始数据", {
                videoId,
                groupKeys: Object.keys(grouped),
                groupSizes: Object.fromEntries(Object.entries(grouped).map(([key, links]) => [key, Array.isArray(links) ? links.length : 0])),
                detailName: detailInfo.vod_name || "",
            });
            const list = buildPanGroupEntries(video, grouped);
            logInfo("详情首层仅用于预热缓存，不返回文件夹页", {
                videoId,
                count: list.length,
                nextCategoryPreview: list.map((item) => ({
                    vod_name: item.vod_name,
                    type_id: item.type_id,
                    vod_tag: item.vod_tag,
                    panType: item.panType,
                    vod_id_preview: String(item.vod_id || "").slice(0, 80),
                })),
                nextRootFolderVodId: buildPanRootFolderVodId(videoId).slice(0, 80),
            });
            return { list: [] };
        }

        const ensuredDetailCache = await ensureDetailCache(videoId, { vod_id: videoId });
        const cachedDetail = ensuredDetailCache?.cacheValue || null;
        if (!cachedDetail || !cachedDetail.grouped) {
            logWarn("详情缓存构建失败", { videoId, targetPanType });
            return { list: [] };
        }

        const detailInfo = cachedDetail.detailInfo || {};
        const video = cachedDetail.video || { vod_id: videoId };

        if (sourceType) {
            const sourceGroups = Array.isArray(cachedDetail.grouped?.[sourceType]) ? cachedDetail.grouped[sourceType] : [];
            const targetGroup = sourceGroups.find((group, index) => (group?.lineIndex ?? index) === parsed.lineIndex);
            if (!targetGroup) {
                logWarn("详情未找到指定线路分组", { videoId, sourceType, lineIndex: parsed.lineIndex });
                return { list: [] };
            }
            const rawEpisodes = Array.isArray(targetGroup?.episodes) ? targetGroup.episodes : [];
            const magnetEpisodeCount = rawEpisodes.filter((ep) => String(ep?.playId || "").trim().startsWith("magnet:")).length;
            logInfo("磁力/采集线路详情分集统计", {
                videoId,
                sourceType,
                lineIndex: parsed.lineIndex,
                rawEpisodeCount: rawEpisodes.length,
                magnetEpisodeCount,
            });
            const normalizeSourceEpisodes = (episodes, defaultPrefix) => {
                let list = (Array.isArray(episodes) ? episodes : []).map((ep, index) => {
                    const displayName = pickEpisodeDisplayName(ep, defaultPrefix, index);
                    const rawName = normalizeText(ep?._rawName || ep?.fileName || ep?.file_name || ep?.name || displayName);
                    return {
                        name: displayName,
                        playId: String(ep?.playId || "").trim(),
                        _fid: String(ep?._fid || "").trim(),
                        _displayName: displayName,
                        _rawName: rawName || displayName,
                        _seedType: String(ep?._seedType || "").trim(),
                        _episodeNumber: Number.isFinite(ep?._episodeNumber) ? ep._episodeNumber : null,
                        _episodeRangeStart: Number.isFinite(ep?._episodeRangeStart) ? ep._episodeRangeStart : null,
                        _episodeRangeEnd: Number.isFinite(ep?._episodeRangeEnd) ? ep._episodeRangeEnd : null,
                    };
                }).filter((ep) => ep.playId);
                if (sourceType === "magnet") {
                    list = sortEpisodesByEpisodeNumber(list.map((ep) => ({
                        ...ep,
                        name: ep._displayName || ep.name,
                        episodeNumber: ep._episodeNumber,
                        episodeRangeStart: ep._episodeRangeStart,
                        episodeRangeEnd: ep._episodeRangeEnd,
                    }))).map(({ episodeNumber, episodeRangeStart, episodeRangeEnd, _displayName, _rawName, _seedType, _episodeNumber, _episodeRangeStart, _episodeRangeEnd, ...rest }) => ({
                        ...rest,
                        _displayName,
                        _rawName,
                        _seedType,
                        _episodeNumber: _episodeNumber ?? episodeNumber ?? null,
                        _episodeRangeStart: _episodeRangeStart ?? episodeRangeStart ?? null,
                        _episodeRangeEnd: _episodeRangeEnd ?? episodeRangeEnd ?? null,
                    }));
                }
                return list;
            };
            const rawSourceName = String(targetGroup?.name || (sourceType === "magnet" ? "磁力" : "采集线路")).trim();
            const normalizedPlaySources = [];
            if (sourceType === "magnet") {
                const convertedEpisodes = [];
                const convertFailures = [];
                logInfo("磁力线路开始同步秒传115", {
                    videoId,
                    lineIndex: parsed.lineIndex,
                    has115Cookie: !!GLOBAL_115_COOKIE,
                    magnetEpisodeCount,
                });
                for (const ep of rawEpisodes) {
                    const magnetPlayId = String(ep?.playId || "").trim();
                    if (!magnetPlayId.startsWith("magnet:")) {
                        convertFailures.push({ name: ep?.name || "", reason: "not_magnet_play_id" });
                        continue;
                    }
                    const converted = await build115EpisodesFromMagnet(magnetPlayId, ep?.name || "115资源");
                    if (converted?.episodes?.length) {
                        convertedEpisodes.push(...converted.episodes.map((item, itemIndex) => ({
                            ...item,
                            _originName: ep?.name || "",
                            _originDisplayName: ep?._displayName || ep?.name || "",
                            _originIndex: itemIndex,
                        })));
                    } else {
                        convertFailures.push({ name: ep?.name || "", reason: converted?.reason || converted?.state || "no_115_episodes" });
                    }
                }
                const normalized115Episodes = normalizeSourceEpisodes(convertedEpisodes, "115资源");
                if (normalized115Episodes.length > 0) {
                    logInfo("磁力线路已秒传并生成115线路", {
                        videoId,
                        lineIndex: parsed.lineIndex,
                        magnetEpisodeCount,
                        episodeCount: normalized115Episodes.length,
                        failureCount: convertFailures.length,
                        episodeNamePreview: normalized115Episodes.slice(0, 3).map((ep) => ep._displayName || ep.name),
                    });
                    normalizedPlaySources.push({
                        name: "115秒传",
                        episodes: normalized115Episodes.map((ep, index) => {
                            const episodeName = build115EpisodeDisplayName(ep, index);
                            return {
                                name: episodeName,
                                episodeName,
                                title: episodeName,
                                playId: ep.playId,
                                _fid: ep._fid,
                                _rawName: ep._rawName || ep.fileName || episodeName,
                                _episodeNumber: Number.isFinite(ep._episodeNumber) ? ep._episodeNumber : extractEpisodeNumber(ep._rawName || ep.fileName || episodeName),
                            };
                        }),
                    });
                } else {
                    logWarn("磁力线路秒传115失败，仅返回原磁力线路", {
                        videoId,
                        lineIndex: parsed.lineIndex,
                        magnetEpisodeCount,
                        has115Cookie: !!GLOBAL_115_COOKIE,
                        failures: convertFailures.slice(0, 5),
                    });
                }
            }
            const normalizedMagnetEpisodes = normalizeSourceEpisodes(rawEpisodes, "磁力资源");
            if (normalizedMagnetEpisodes.length > 0) {
                normalizedPlaySources.push({
                    name: sourceType === "magnet" ? "磁力" : rawSourceName,
                    episodes: normalizedMagnetEpisodes.map((ep) => ({
                        name: ep._displayName || ep.name,
                        playId: ep.playId,
                        _fid: ep._fid,
                        _rawName: ep._rawName || ep.name,
                    })),
                });
            }
            const baseVodName = stripPanTypeSuffix(detailInfo.vod_name || video.vod_name || "七味资源");
            const scrapeCandidates = [];
            const seenSourceScrapeIds = new Set();
            for (const source of normalizedPlaySources) {
                for (const ep of source.episodes || []) {
                    const fid = String(ep._fid || "").trim();
                    const rawName = normalizeText(ep._rawName || ep.name || ep.episodeName || "");
                    if (!fid || !rawName) continue;
                    const key = `${fid}|${rawName}`;
                    if (seenSourceScrapeIds.has(key)) continue;
                    seenSourceScrapeIds.add(key);
                    scrapeCandidates.push({
                        fid,
                        file_id: fid,
                        file_name: rawName,
                        name: rawName,
                        format_type: "video",
                    });
                }
            }
            const { scrapeData, videoMappings, scrapeType } = await getMergedMetadataCached(videoId, baseVodName, scrapeCandidates);
            const mappingPreview = (videoMappings || []).slice(0, 3).map((item) => `${String(item?.fileId || "").slice(0, 80)}=>${item?.episodeName || ""}`);
            const mappingEpisodePreview = (videoMappings || []).slice(0, 5).map((item) => ({
                fileId: String(item?.fileId || "").slice(0, 80),
                seasonNumber: item?.seasonNumber || null,
                episodeNumber: item?.episodeNumber || null,
                episodeName: item?.episodeName || "",
            }));
            logInfo("磁力/采集线路刮削映射统计", {
                videoId,
                sourceType,
                scrapeCandidateCount: scrapeCandidates.length,
                mappingCount: Array.isArray(videoMappings) ? videoMappings.length : 0,
                mappingPreview,
                mappingEpisodePreview,
                scrapeType,
            });
            for (const source of normalizedPlaySources) {
                for (const ep of source.episodes || []) {
                    const epNo = Number.isFinite(ep._episodeNumber) ? ep._episodeNumber : extractEpisodeNumber(ep._rawName || ep.name);
                    const mapping = findScrapeMapping({ videoMappings }, [ep._fid], epNo, ep._rawName || ep.name);
                    if (!mapping) {
                        if (ep._fid) {
                            logWarn("磁力/采集分集未命中刮削映射", {
                                videoId,
                                sourceName: source.name,
                                fid: String(ep._fid || "").slice(0, 120),
                                rawName: ep._rawName || ep.name,
                                episodeNumber: epNo || null,
                                mappingPreview,
                                mappingEpisodePreview,
                            });
                        }
                        continue;
                    }
                    const newName = buildScrapedEpisodeName(scrapeData, mapping, ep._rawName || ep.name, ep._displayName || ep.name);
                    if (newName) {
                        logInfo("磁力/采集分集应用刮削名", { sourceName: source.name, from: ep.name, to: newName, fid: String(ep._fid || "").slice(0, 120) });
                        ep.name = newName;
                        ep.episodeName = newName;
                        ep.title = newName;
                    }
                    ep._seasonNumber = mapping.seasonNumber;
                    ep._episodeNumber = mapping.episodeNumber;
                    ep.playId = rewritePlayIdMeta(ep.playId, {
                        sid: String(videoId || ""),
                        fid: ep._fid,
                        v: baseVodName,
                        e: newName || ep.name,
                        s: mapping.seasonNumber || "",
                        n: mapping.episodeNumber || "",
                    });
                }
            }
            const fallbackSourceName = normalizedPlaySources[0]?.name || rawSourceName;
            const legacyPlayFields = buildLegacyPlayFields(normalizedPlaySources);
            logInfo("磁力/采集线路详情返回格式", {
                videoId,
                sourceType,
                sourceCount: normalizedPlaySources.length,
                sources: summarizePlaySourcesForLog(normalizedPlaySources),
                legacyFrom: legacyPlayFields.vod_play_from,
                legacyUrlLength: legacyPlayFields.vod_play_url.length,
                legacyUrlPreview: legacyPlayFields.vod_play_url.slice(0, 500),
            });
            const vod = {
                vod_id: rawVideoId,
                vod_name: scrapeData?.title ? stripPanTypeSuffix(scrapeData.title) : baseVodName,
                vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : (detailInfo.vod_pic || video.vod_pic || ""),
                vod_content: scrapeData?.overview || detailInfo.vod_content || "",
                vod_remarks: detailInfo.vod_remarks || fallbackSourceName,
                type_name: detailInfo.type_name || fallbackSourceName,
                vod_year: scrapeData?.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : (detailInfo.vod_year || ""),
                vod_area: detailInfo.vod_area || "",
                vod_actor: detailInfo.vod_actor || "",
                vod_director: detailInfo.vod_director || "",
                vod_play_sources: normalizedPlaySources,
                vod_play_from: legacyPlayFields.vod_play_from,
                vod_play_url: legacyPlayFields.vod_play_url,
            };
            logInfo("磁力/采集线路详情最终输出", {
                topKeys: ["list"],
                listCount: 1,
                vodKeys: Object.keys(vod),
                vod_id: vod.vod_id,
                vod_name: vod.vod_name,
                vod_play_sources: summarizePlaySourcesForLog(vod.vod_play_sources),
                vod_play_from: vod.vod_play_from,
                vod_play_url_length: vod.vod_play_url.length,
                vod_play_url_preview: vod.vod_play_url.slice(0, 800),
            });
            return { list: [vod] };
        }

        const links = Array.isArray(cachedDetail.grouped?.[targetPanType]) ? cachedDetail.grouped[targetPanType] : [];
        if (links.length === 0) {
            logWarn("详情未找到指定网盘分组", { videoId, targetPanType });
            return { list: [] };
        }

        if (!parsed.isShareEntry) {
            const fullList = await buildPanShareEntries(video, detailInfo, targetPanType, links);
            const paged = paginateList(fullList, page, 20);
            logInfo("返回网盘分享文件夹页", {
                videoId,
                targetPanType,
                count: paged.list.length,
                total: paged.total,
                page: paged.page,
                listPreview: paged.list.map((item) => ({
                    vod_name: item.vod_name,
                    vod_remarks: item.vod_remarks,
                    vod_tag: item.vod_tag,
                    vod_id_preview: String(item.vod_id || "").slice(0, 80),
                })),
            });
            return {
                page: paged.page,
                pagecount: paged.page,
                total: paged.total,
                list: paged.list,
            };
        }

        const shareURL = normalizeShareUrl(links[parsed.shareIndex] || "");
        if (!shareURL || !isPanUrl(shareURL)) {
            logWarn("详情未找到指定分享链接", { videoId, targetPanType, shareIndex: parsed.shareIndex });
            return { list: [] };
        }

        const callerSource = resolveCallerSource(params, context);
        const panTypeName = parsePanType(shareURL);
        const playSources = [];
        const scrapeCandidates = [];
        const panInfo = await loadPanFiles(shareURL);
        const files = panInfo?.videos || [];
        if (!files.length) {
            logWarn("网盘分享未解析到有效视频文件", { videoId, targetPanType, shareURL });
            return { list: [] };
        }

        const sourceName = panTypeName;
        const panEpisodes = [];
        for (const file of files) {
            const fileId = getFileId(file);
            if (!fileId) continue;
            const fileName = getFileName(file) || sourceName;
            const fileSize = getFileSize(file);
            const formattedName = fileSize > 0 ? `[${formatFileSize(fileSize)}] ${fileName}` : fileName;
            const fid = `${shareURL}|${fileId}`;
            const combinedId = `${shareURL}|${fileId}|||${encodeMeta({ sid: String(videoId || ""), fid, e: fileName, v: detailInfo.vod_name || video.vod_name || "" })}`;
            panEpisodes.push({
                name: formattedName,
                playId: combinedId,
                _fid: fid,
                _rawName: fileName,
            });
            scrapeCandidates.push({
                fid,
                file_id: fid,
                file_name: fileName,
                name: fileName,
                format_type: "video",
            });
        }
        if (panEpisodes.length === 0) {
            logWarn("网盘分享视频文件缺少可用 fileId", { videoId, targetPanType, shareURL, files: files.length });
            return { list: [] };
        }

        const multiRouteEnabled = DRIVE_TYPE_CONFIG.includes(targetPanType);
        if (!multiRouteEnabled) {
            playSources.push({ name: sourceName, episodes: panEpisodes.map((ep) => ({ ...ep })) });
        } else {
            const validRoutes = await detectValidPanRoutes(shareURL, files, callerSource, context, Math.max(1, MAX_PAN_VALID_ROUTES));
            if (validRoutes.length === 0) {
                logWarn("网盘分享未检测到有效播放路线", { videoId, targetPanType, shareURL });
                return { list: [] };
            }
            for (const routeName of validRoutes.slice(0, Math.max(1, MAX_PAN_VALID_ROUTES))) {
                playSources.push({
                    name: `${sourceName} ${routeName}`,
                    episodes: panEpisodes.map((ep) => ({ ...ep })),
                });
            }
        }

        const uniqueScrapeCandidates = [];
        const seenScrapeIds = new Set();
        for (const item of scrapeCandidates) {
            const key = `${item.fid}|${item.file_name}`;
            if (seenScrapeIds.has(key)) continue;
            seenScrapeIds.add(key);
            uniqueScrapeCandidates.push(item);
        }

        const { scrapeData, videoMappings, scrapeType } = await getMergedMetadataCached(videoId, detailInfo.vod_name || video.vod_name || "", uniqueScrapeCandidates);
        const mappingKeys = new Set((videoMappings || []).map((item) => String(item?.fileId || "").trim()).filter(Boolean));
        logInfo("详情页刮削映射统计", {
            videoId,
            scrapeType,
            scrapeCandidateCount: uniqueScrapeCandidates.length,
            mappingCount: Array.isArray(videoMappings) ? videoMappings.length : 0,
            mappingPreview: Array.from(mappingKeys).slice(0, 3),
        });

        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                const mapping = (videoMappings || []).find((m) => m?.fileId === ep._fid);
                if (!mapping) {
                    logWarn("详情页未命中刮削映射", {
                        videoId,
                        expectedFileId: ep._fid,
                        expectedRawName: ep._rawName || ep.name,
                    });
                    continue;
                }
                const newName = buildScrapedEpisodeName(scrapeData, mapping, ep._rawName || ep.name);
                if (newName) ep.name = newName;
                ep._seasonNumber = mapping.seasonNumber;
                ep._episodeNumber = mapping.episodeNumber;
            }
            const hasEpisodeNumber = (source.episodes || []).some((ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null);
            if (hasEpisodeNumber) {
                source.episodes.sort((a, b) => {
                    const sa = a._seasonNumber || 0;
                    const sb = b._seasonNumber || 0;
                    if (sa !== sb) return sa - sb;
                    const ea = a._episodeNumber || 0;
                    const eb = b._episodeNumber || 0;
                    return ea - eb;
                });
            }
        }

        const normalizedPlaySources = sortPlaySourcesByDriveOrder(playSources).map((source) => ({
            name: source.name,
            episodes: (source.episodes || []).map((ep, index) => {
                const episodeName = pickEpisodeDisplayName(ep, "资源", index);
                return { name: episodeName, episodeName, title: episodeName, playId: ep.playId };
            }),
        }));
        const legacyPlayFields = buildLegacyPlayFields(normalizedPlaySources);

        const baseVodName = stripPanTypeSuffix(detailInfo.vod_name || video.vod_name || "七味资源");
        const vod = {
            vod_id: rawVideoId,
            vod_name: baseVodName,
            vod_pic: detailInfo.vod_pic || video.vod_pic || "",
            vod_content: detailInfo.vod_content || "",
            vod_remarks: detailInfo.vod_remarks || panTypeName,
            type_name: detailInfo.type_name || panTypeName,
            vod_year: detailInfo.vod_year || "",
            vod_area: detailInfo.vod_area || "",
            vod_actor: detailInfo.vod_actor || "",
            vod_director: detailInfo.vod_director || "",
            vod_play_sources: normalizedPlaySources,
            vod_play_from: legacyPlayFields.vod_play_from,
            vod_play_url: legacyPlayFields.vod_play_url,
        };

        if (scrapeData) {
            vod.vod_name = stripPanTypeSuffix(scrapeData.title || vod.vod_name);
            if (scrapeData.posterPath) {
                vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            }
            if (scrapeData.overview) {
                vod.vod_content = scrapeData.overview;
            }
            if (scrapeData.releaseDate) {
                vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || vod.vod_year || "";
            }
            const actors = (scrapeData.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(",");
            if (actors) vod.vod_actor = actors;
            const directors = (scrapeData.credits?.crew || [])
                .filter((c) => c?.job === "Director" || c?.department === "Directing")
                .slice(0, 3)
                .map((c) => c?.name)
                .filter(Boolean)
                .join(",");
            if (directors) vod.vod_director = directors;
            if (scrapeType && !vod.type_name) vod.type_name = scrapeType;
        }

        logInfo("网盘分享详情最终输出", {
            topKeys: ["list"],
            listCount: 1,
            vodKeys: Object.keys(vod),
            vod_id: vod.vod_id,
            vod_name: vod.vod_name,
            vod_play_sources: summarizePlaySourcesForLog(vod.vod_play_sources),
            vod_play_from: vod.vod_play_from,
            vod_play_url_length: vod.vod_play_url.length,
            vod_play_url_preview: vod.vod_play_url.slice(0, 800),
        });
        return { list: [vod] };
    } catch (error) {
        logError("分组详情解析失败", error);
        return { list: [] };
    }
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
    if (!normalizedMagnet.startsWith("magnet:")) {
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
            "User-Agent": DEFAULT_HEADERS["User-Agent"],
            "Cookie": cookie,
            "Origin": "https://115.com",
            "Referer": "https://115.com/web/lixian/",
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest"
        };
        const httpsAgent = new (require("https").Agent)({ rejectUnauthorized: false });
        const spaceRes = await axios.get("https://115.com/?ct=offline&ac=space", {
            headers: commonHeaders,
            timeout: 10000,
            httpsAgent
        });
        const spaceJson = spaceRes.data;
        if (!spaceJson.state) {
            logWarn("115秒传失败: 获取签名失败", spaceJson);
            return { ok: false, state: "space_failed", files: [], magnet: normalizedMagnet, raw: spaceJson };
        }
        const sign = spaceJson.sign;
        const reqTime = spaceJson.time;
        if (!sign || !reqTime) {
            logWarn("115秒传失败: 签名数据不完整");
            return { ok: false, state: "space_invalid", files: [], magnet: normalizedMagnet, raw: spaceJson };
        }
        const addTask = async () => {
            const addRes = await axios.post("https://115.com/web/lixian/?ct=lixian&ac=add_task_url",
                `url=${encodeURIComponent(normalizedMagnet)}&uid=${uid}&sign=${sign}&time=${reqTime}`,
                {
                    headers: {
                        ...commonHeaders,
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    },
                    timeout: 15000,
                    httpsAgent
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
        logWarn("115秒传失败", finalJson);
        return { ok: false, state: "add_failed", files, magnet: normalizedMagnet, raw: finalJson };
    } catch (error) {
        logError("115秒传异常", error);
        return { ok: false, state: "exception", files: [], magnet: normalizedMagnet, error: error.message || String(error) };
    }
}

async function build115EpisodesFromMagnet(magnet, baseName = "115资源") {
    const result = await pushMagnetTo115(magnet);
    if (!result?.ok) {
        logWarn("115秒传未生成剧集", {
            magnet: String(magnet || "").slice(0, 100),
            state: result?.state || "unknown",
            error: result?.error || "",
            fileCount: Array.isArray(result?.files) ? result.files.length : 0,
        });
        return { episodes: [], reason: result?.state || "push_failed", state: result?.state || "" };
    }
    if (!Array.isArray(result.files) || result.files.length === 0) {
        logWarn("115秒传成功但未返回文件列表", {
            magnet: String(magnet || "").slice(0, 100),
            state: result?.state || "",
            rawKeys: result?.raw && typeof result.raw === "object" ? Object.keys(result.raw).slice(0, 12) : [],
        });
        return { episodes: [], reason: "empty_files", state: result?.state || "" };
    }
    const episodes = result.files.map((file, index) => {
        const rawName = cleanPlayLabel(file.name, `${baseName}${index + 1}`);
        const formattedName = file.size > 0 ? `[${formatFileSize(file.size)}] ${rawName}` : rawName;
        const episodeRange = extractEpisodeRange(rawName);
        const episodeNumber = episodeRange ? null : extractEpisodeNumber(rawName);
        const shortName = build115ButtonName(index);
        const displayName = cleanPlayLabel(formattedName, rawName || shortName);
        const playMeta = encodeMeta({ type: "115_magnet", magnet, fileName: rawName, fileId: file.id, pickcode: file.pickcode });
        return {
            name: shortName,
            title: shortName,
            episodeName: shortName,
            playId: build115MagnetPlayId({ magnet, fileName: rawName, fileId: file.id, pickcode: file.pickcode }),
            _fid: `115magnet:${result.infoHash || crypto.createHash("sha1").update(String(magnet || "")).digest("hex")}:${file.id}`,
            _rawName: rawName,
            _displayName: displayName,
            _seedType: "115",
            _episodeNumber: episodeNumber,
            _episodeRangeStart: episodeRange?.start ?? null,
            _episodeRangeEnd: episodeRange?.end ?? null,
            fileName: rawName,
        };
    });
    logInfo("115秒传文件分集生成完成", {
        magnet: String(magnet || "").slice(0, 100),
        episodeCount: episodes.length,
        episodeNamePreview: episodes.slice(0, 3).map((ep) => ep._displayName || ep.name),
    });
    return { name: "115网盘", episodes, result };
}

function build115Headers() {
    return {
        "User-Agent": DEFAULT_HEADERS["User-Agent"],
        "Cookie": GLOBAL_115_COOKIE,
        "Origin": "https://115.com",
        "Referer": "https://115.com/",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "X-Requested-With": "XMLHttpRequest",
    };
}

function same115FileName(a = "", b = "") {
    const basename = (value) => String(value || "").split(/[\\/]/).pop().trim();
    return basename(a) && basename(a) === basename(b);
}

async function find115FileByName(fileName = "") {
    const targetName = String(fileName || "").trim();
    if (!targetName || !GLOBAL_115_COOKIE) return null;
    const key = buildCacheKey("qiwei-group:115-file", targetName);
    const cached = await getCachedJSON(key);
    if (cached?.fid || cached?.pickcode) {
        logInfo("115文件搜索缓存命中", { fileName: targetName, fid: cached.fid || "", pickcode: cached.pickcode || "" });
        return cached;
    }

    const keyword = targetName.split(/[\\/]/).pop().replace(/\.[a-z0-9]{2,5}$/i, "").slice(0, 80);
    const url = `https://webapi.115.com/files/search?search_value=${encodeURIComponent(keyword)}&format=json&type=4&limit=50`;
    const res = await axios.get(url, {
        headers: build115Headers(),
        timeout: 10000,
        httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
    });
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
    const urls = [
        `https://115.com/api/video/m3u8/${encodeURIComponent(pickcode)}.m3u8`,
        `https://webapi.115.com/files/video?pickcode=${encodeURIComponent(pickcode)}`,
    ];
    let lastError = null;
    for (const url of urls) {
        try {
            const res = await axios.get(url, {
                headers,
                timeout: 10000,
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
                httpsAgent: new (require("https").Agent)({ rejectUnauthorized: false }),
            });
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
    const data = typeof playId === "object" && playId
        ? playId
        : decode115MagnetPlayMeta(playId);
    const magnet = String(data.magnet || "").trim();
    const targetFileId = String(data.fileId || "").trim();
    const result = await pushMagnetTo115(magnet);
    const targetFile = (result.files || []).find((file) => String(file.id) === targetFileId) || (result.files || [])[0];
    if (!targetFile?.name) throw new Error("115秒传缓存未找到目标文件名");

    const realFile = await find115FileByName(targetFile.name);
    if (!realFile) throw new Error("115网盘内未搜索到真实文件");

    const metadataPromise = (async () => {
        const metaResult = {
            danmakuList: [],
            episodeNumber: data.n || null,
            episodeName: String(data.e || params.episodeName || "").trim(),
            mappingMatched: false,
            mappingFileId: "",
            danmuFileName: "",
        };
        const videoIdForScrape = String(params.vodId || data.sid || "").trim();
        if (!videoIdForScrape) {
            logWarn("115秒传弹幕跳过: 缺少视频ID", { fileId: targetFileId, fileName: targetFile.name || data.fileName || "" });
            return metaResult;
        }
        try {
            const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
            if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) {
                logWarn("115秒传弹幕跳过: 无刮削元数据", { videoId: videoIdForScrape, hasMetadata: !!metadata });
                return metaResult;
            }
            const infoHash = result.infoHash || crypto.createHash("sha1").update(String(magnet || "")).digest("hex");
            const syntheticFid = `115magnet:${infoHash}:${targetFile.id}`;
            const epNo = Number(data.n || extractEpisodeNumber(data.e || targetFile.name || data.fileName || ""));
            const mapping = findScrapeMapping(
                metadata,
                [data.fid, syntheticFid, targetFile._fid].filter(Boolean),
                Number.isFinite(epNo) && epNo > 0 ? epNo : null,
                targetFile.name || data.fileName || ""
            );
            if (!mapping) {
                logWarn("115秒传弹幕未命中刮削映射", {
                    videoId: videoIdForScrape,
                    fid: data.fid || syntheticFid,
                    fileId: targetFileId,
                    fileName: targetFile.name || data.fileName || "",
                    mappingPreview: metadata.videoMappings.slice(0, 3).map((item) => String(item?.fileId || "").slice(0, 120)),
                });
                return metaResult;
            }

            const scrapeData = metadata.scrapeData;
            metaResult.mappingMatched = true;
            metaResult.mappingFileId = String(mapping.fileId || "");
            if (mapping.episodeNumber) metaResult.episodeNumber = mapping.episodeNumber;
            if (mapping.episodeName) metaResult.episodeName = buildScrapedEpisodeName(scrapeData, mapping, targetFile.name || data.fileName || "", data.e || "") || mapping.episodeName;

            const fileName = buildScrapedDanmuFileName(
                scrapeData,
                metadata.scrapeType || "",
                mapping,
                String(params.vodName || data.v || scrapeData.title || "").trim(),
                metaResult.episodeName
            );
            metaResult.danmuFileName = fileName;
            if (fileName) {
                const matchedDanmaku = typeof OmniBox.getDanmakuByFileName === "function"
                    ? await OmniBox.getDanmakuByFileName(fileName)
                    : await matchDanmu(fileName);
                if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) {
                    metaResult.danmakuList = matchedDanmaku;
                }
                logInfo("115秒传弹幕匹配完成", {
                    videoId: videoIdForScrape,
                    fileName,
                    mappingFileId: metaResult.mappingFileId,
                    danmakuCount: metaResult.danmakuList.length,
                });
            }
        } catch (error) {
            logWarn("读取115秒传弹幕元数据失败", { error: error.message || String(error) });
        }
        return metaResult;
    })();

    const [playUrlResult, metadataResult] = await Promise.allSettled([
        get115VideoPlayUrl(realFile),
        metadataPromise,
    ]);
    if (playUrlResult.status !== "fulfilled") {
        throw playUrlResult.reason || new Error("115未返回可播放地址");
    }
    const playUrl = playUrlResult.value;
    const metadataValue = metadataResult.status === "fulfilled" ? metadataResult.value : null;
    const finalDanmaku = Array.isArray(metadataValue?.danmakuList) ? metadataValue.danmakuList : [];
    const playResult = {
        urls: [{ name: "115播放", url: playUrl }],
        flag: "115网盘",
        header: {
            "User-Agent": DEFAULT_HEADERS["User-Agent"],
            "Referer": "https://115.com/",
            "Cookie": GLOBAL_115_COOKIE,
        },
        parse: 0,
        danmaku: finalDanmaku,
    };
    logInfo("115磁力文件播放地址返回", {
        fid: realFile.fid || "",
        pickcode: realFile.pickcode || "",
        fileName: realFile.name || targetFile.name,
        mappingMatched: !!metadataValue?.mappingMatched,
        episodeNumber: metadataValue?.episodeNumber || data.n || null,
        danmakuCount: finalDanmaku.length,
        output: summarizePlayResultForLog(playResult),
    });
    return playResult;
}

async function play(params, context = {}) {
    let playId = String(params.playId || "").trim();
    const flag = String(params.flag || "").trim();
    const callerSource = resolveCallerSource(params, context);
    let playMeta = {};

    logInfo("开始播放解析", { playId, flag });

    if (!playId) {
        return {
            urls: [{ name: "解析失败", url: "" }],
            parse: 1,
            header: {
                ...DEFAULT_HEADERS,
                Referer: `${getCurrentHost()}/`,
            },
        };
    }

    if (playId.includes("|||")) {
        const [mainPlayId, metaB64] = playId.split("|||");
        playId = mainPlayId;
        playMeta = decodeMeta(metaB64 || "");
        logInfo("解析透传信息", { sid: playMeta.sid || "", fid: playMeta.fid || "", e: playMeta.e || "" });
    }

    if (is115MagnetPlayId(playId, flag)) {
        const magnetMeta = decode115MagnetPlayMeta(playId);
        try {
            logInfo("识别为115秒传播放，直接走115网盘解析", {
                flag,
                hasPrefix: playId.startsWith("115magnet:"),
                kind: magnetMeta.kind || "",
                fileName: magnetMeta.fileName || "",
                fileId: magnetMeta.fileId || "",
            });
            return await resolve115MagnetPlay(playId, flag, callerSource, context, params);
        } catch (error) {
            logWarn("115磁力播放失败，回退磁力", { error: error.message || String(error), fileName: magnetMeta.fileName || playMeta.fileName || "" });
            if (magnetMeta.magnet) playId = magnetMeta.magnet;
            else if (playMeta.magnet) playId = playMeta.magnet;
            else throw error;
        }
    }

    if (playId.startsWith("magnet:")) {
        const pushed = await pushMagnetTo115(playId);
        const displayName = pushed?.ok ? "磁力资源（已提交115）" : "磁力资源";
        return {
            urls: [{ name: displayName, url: playId }],
            parse: 0,
            header: {
                ...DEFAULT_HEADERS,
                Referer: `${getCurrentHost()}/`,
            },
        };
    }

    if (playId && playId.includes("|")) {
        const [rawShareURL, fileId] = playId.split("|");
        const shareURL = normalizeShareUrl(rawShareURL);
        if (shareURL && fileId && isPanUrl(shareURL)) {
            try {
                const routeType = resolveRouteType(flag, callerSource, context);
                logInfo("网盘播放路线解析", { shareURL, fileId, flag, callerSource, routeType });
                const playInfoPromise = OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);
                const metadataPromise = (async () => {
                    const result = {
                        danmakuList: [],
                        episodeName: String(params.episodeName || playMeta.e || "").trim(),
                    };

                    const videoIdForScrape = String(params.vodId || playMeta.sid || "").trim();
                    if (!videoIdForScrape) {
                        return result;
                    }

                    try {
                        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                        if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) {
                            return result;
                        }

                        const formattedFileId = `${shareURL}|${fileId}`;
                        const mapping = metadata.videoMappings.find((m) => m?.fileId === formattedFileId || m?.fileId === `${formattedFileId}|${videoIdForScrape}` || m?.fileId === playMeta.fid);
                        if (!mapping) {
                            return result;
                        }

                        const scrapeData = metadata.scrapeData;
                        if (mapping.episodeName && !result.episodeName) {
                            result.episodeName = mapping.episodeName;
                        }

                        const fileName = buildScrapedDanmuFileName(
                            scrapeData,
                            metadata.scrapeType || "",
                            mapping,
                            String(params.vodName || playMeta.v || scrapeData.title || "").trim(),
                            result.episodeName
                        );
                        if (fileName) {
                            const matchedDanmaku = typeof OmniBox.getDanmakuByFileName === "function"
                                ? await OmniBox.getDanmakuByFileName(fileName)
                                : await matchDanmu(fileName);
                            if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) {
                                result.danmakuList = matchedDanmaku;
                            }
                        }
                    } catch (error) {
                        logWarn("读取网盘弹幕元数据失败", { error: error.message || String(error) });
                    }

                    return result;
                })();

                const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);
                if (playInfoResult.status !== "fulfilled") {
                    throw playInfoResult.reason || new Error("无法获取播放地址");
                }

                const playInfo = playInfoResult.value;
                const urlList = Array.isArray(playInfo?.url) ? playInfo.url : [];
                logInfo("网盘播放信息返回", {
                    shareURL,
                    fileId,
                    flag,
                    callerSource,
                    routeType,
                    urlCount: urlList.length,
                    routeFlags: urlList.map((item) => item?.name || "播放").filter(Boolean),
                    hasHeader: !!playInfo?.header && Object.keys(playInfo.header || {}).length > 0,
                });
                const urlsResult = urlList.map((item) => ({
                    name: item.name || "播放",
                    url: item.url,
                }));
                if (urlsResult.length > 0) {
                    const header = playInfo?.header || {};
                    const metadataValue = metadataResult.status === "fulfilled" ? metadataResult.value : null;
                    const finalDanmaku = metadataValue?.danmakuList?.length ? metadataValue.danmakuList : (playInfo?.danmaku || []);

                    return {
                        urls: urlsResult,
                        header,
                        parse: 0,
                        danmaku: finalDanmaku};
                }
            } catch (error) {
                logWarn("网盘文件播放失败，回退 push", { shareURL, fileId, flag, callerSource, error: error.message || String(error) });
                const pushUrl = shareURL.startsWith("push://") ? shareURL : `push://${shareURL}`;
                return {
                    urls: [{ name: "网盘资源", url: pushUrl }],
                    parse: 0,
                    header: {},
                };
            }
        }
    }

    if (isPanUrl(playId)) {
        const pushUrl = playId.startsWith("push://") ? playId : `push://${playId}`;
        return {
            urls: [{ name: "网盘资源", url: pushUrl }],
            parse: 0,
            header: {},
        };
    }

    let resolvedPlayUrl = "";
    const parts = playId.split("|");
    if (parts.length === 3 && parts.every((x) => x !== "")) {
        const videoId = parts[0];
        const lineIndex = parseInt(parts[1], 10);
        const episodeIndex = parseInt(parts[2], 10);

        if (Number.isFinite(lineIndex) && Number.isFinite(episodeIndex)) {
            resolvedPlayUrl = `${getCurrentHost()}/py/${videoId}-${lineIndex + 1}-${episodeIndex + 1}.html`;
        }
    }

    if (!resolvedPlayUrl) {
        resolvedPlayUrl = fixUrl(playId, getCurrentHost());
    }

    const defaultHeader = {
        ...DEFAULT_HEADERS,
        Referer: `${getCurrentHost()}/`,
        Origin: getCurrentHost(),
    };

    if (isDirectVideoUrl(resolvedPlayUrl)) {
        logInfo("检测到直链视频，直接返回", { url: resolvedPlayUrl });
        return {
            urls: [{ name: "默认线路", url: resolvedPlayUrl }],
            parse: 0,
            header: defaultHeader,
        };
    }

    try {
        logInfo("检测到非视频格式，开始嗅探", { url: resolvedPlayUrl });
        const sniffed = await OmniBox.sniffVideo(resolvedPlayUrl);
        if (sniffed && sniffed.url) {
            logInfo("嗅探成功", { url: sniffed.url });

            let danmaku = [];
            if (DANMU_API) {
                let vodName = String(params.vodName || "").trim();
                let episodeName = String(params.episodeName || playMeta.e || "").trim();
                let scrapedDanmuFileName = "";

                try {
                    const videoIdFromParam = params.vodId ? String(params.vodId) : "";
                    const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : "";
                    const videoIdForScrape = videoIdFromParam || videoIdFromMeta;
                    if (videoIdForScrape) {
                        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                        if (metadata && metadata.scrapeData) {
                            const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                            scrapedDanmuFileName = buildScrapedDanmuFileName(
                                metadata.scrapeData,
                                metadata.scrapeType || "",
                                mapping,
                                vodName,
                                episodeName
                            );
                            if (metadata.scrapeData.title) {
                                vodName = metadata.scrapeData.title;
                            }
                            if (mapping?.episodeName) {
                                episodeName = mapping.episodeName;
                            }
                        }
                    }
                } catch (error) {
                    logWarn("读取刮削元数据失败", { error: error.message || String(error) });
                }

                const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
                if (fileName) {
                    danmaku = await matchDanmu(fileName);
                    if (danmaku.length > 0) {
                        logInfo("弹幕匹配成功", { count: danmaku.length, fileName });
                    }
                }
            }

            return {
                urls: [{ name: "嗅探线路", url: sniffed.url }],
                parse: 0,
                header: sniffed.header || defaultHeader,
                danmaku,
            };
        }
        logWarn("嗅探未返回有效直链，回退解析页", { url: resolvedPlayUrl });
    } catch (error) {
        logWarn("嗅探失败，回退解析页", { error: error.message || String(error) });
    }

    return {
        urls: [{ name: "默认线路", url: resolvedPlayUrl }],
        parse: 1,
        header: defaultHeader,
    };
}

module.exports = { home, category, search, detail, play };
const runner = require("spider_runner");
runner.run(module.exports);
