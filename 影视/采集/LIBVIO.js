// @name LIBVIO
// @author 梦
// @description 刮削：已接入，弹幕：已接入，嗅探：不需要（直链优先，支持网盘线路展开）
// @dependencies
// @version 1.5.8
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/LIBVIO.js

const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST_CANDIDATES = [
    "https://www.libvio.lat",
    "https://www.libvios.com",
    "https://libvio.run",
    "https://www.libvio.mov",
    "https://www.libhd.com",
].map((item) => normalizeHost(item)).filter(Boolean);
const LIBVIO_RELEASE_URL = "https://www.libvio.app";
const HOST_CACHE_KEY = "libvio:active_host";
const HOST_CACHE_TTL = 60 * 60 * 24 * 30;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
let ACTIVE_HOST = HOST_CANDIDATES[0];

const DEFAULT_PAGE_SIZE = 12;
const HOME_CACHE_TTL = 60 * 15;
const CATEGORY_CACHE_TTL = 60 * 10;
const SEARCH_CACHE_TTL = 60 * 10;
const DETAIL_CACHE_TTL = 60 * 20;
const FILTER_CACHE_TTL = 60 * 20;
const PAN_SHARE_CACHE_TTL = 60 * 60;
const PLAY_CACHE_TTL = 60 * 3;
const DRIVE_TYPE_CONFIG = (process.env.DRIVE_TYPE_CONFIG || "quark;uc").split(";").map((t) => t.trim().toLowerCase()).filter(Boolean);
const SOURCE_NAMES_CONFIG = (process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连").split(";").map((s) => s.trim()).filter(Boolean);
const DRIVE_ORDER = (process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").split(";").map((s) => s.trim().toLowerCase()).filter(Boolean);
const panShareCache = new Map();

// 分类映射（根据实际页面结构更新）
const CLASS_LIST = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "电视剧" }, // 原 "剧集" → "电视剧" 兼容新版页面
    { type_id: "4", type_name: "动漫" },
    { type_id: "15", type_name: "日韩剧" },
    { type_id: "16", type_name: "欧美剧" }
];

const FILTERS = {
    "1": {
        genre: ["喜剧", "爱情", "恐怖", "动作", "科幻", "剧情", "战争", "警匪", "犯罪", "动画", "奇幻", "武侠", "冒险", "枪战", "悬疑", "惊悚", "经典", "青春", "文艺", "微电影", "古装", "历史", "运动", "农村", "儿童", "网络电影"],
        area: ["大陆", "香港", "台湾", "美国", "法国", "英国", "日本", "韩国", "德国", "泰国", "印度", "意大利", "西班牙", "加拿大", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "2": {
        genre: ["喜剧", "科幻", "悬疑", "欧美", "剧情", "奇幻", "古装", "动作", "犯罪", "冒险", "惊悚", "恐怖", "历史", "爱情", "音乐", "家庭", "国产", "运动", "动画", "西部", "战争", "传记", "灾难", "纪录片", "短片", "海外", "真人秀"],
        area: ["美国", "韩国", "英国", "日本", "大陆", "台湾", "德国", "哥伦比亚", "意大利", "西班牙", "丹麦", "挪威", "法国", "香港", "泰国", "其它"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "4": {
        genre: ["情感", "科幻", "热血", "推理", "搞笑", "冒险", "萝莉", "校园", "动作", "机战", "运动", "战争", "少年", "少女", "社会", "原创", "亲子", "益智", "励志", "其他"],
        area: ["中国大陆", "日本", "欧美", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "15": {
        genre: ["悬疑", "爱情", "科幻", "青春", "偶像", "喜剧", "古装", "武侠", "家庭", "犯罪", "动作", "奇幻", "剧情", "历史", "经典", "乡村", "情景", "商战", "网剧", "其他"],
        area: ["韩国", "日本", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    },
    "16": {
        genre: ["悬疑", "科幻", "青春", "偶像", "喜剧", "犯罪", "动作", "奇幻", "剧情", "历史", "经典", "乡村", "情景", "商战", "网剧", "其他"],
        area: ["美国", "英国", "泰国", "其他"],
        lang: ["国语", "英语", "粤语", "闽南语", "韩语", "日语", "其它"]
    }
};

const SORT_OPTIONS = [
    { name: "最新", value: "time" },
    { name: "人气", value: "hits" },
    { name: "评分", value: "score" }
];

function normalizeHost(url = "") {
    const value = String(url || "").trim();
    if (!value) return "";
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
        const target = new URL(withProtocol);
        return `${target.protocol}//${target.host}`;
    } catch {
        return withProtocol.replace(/\/+$/, "");
    }
}

function getCurrentHost() {
    return ACTIVE_HOST || HOST_CANDIDATES[0];
}

async function saveActiveHostCache(host) {
    const normalized = normalizeHost(host);
    if (!normalized) return;
    try {
        await OmniBox.setCache(HOST_CACHE_KEY, normalized, HOST_CACHE_TTL);
        logInfo("写入域名缓存", { host: normalized, ttl: HOST_CACHE_TTL });
    } catch (error) {
        logInfo("写入域名缓存失败", { host: normalized, error: error.message });
    }
}

async function readActiveHostCache() {
    try {
        const cached = await OmniBox.getCache(HOST_CACHE_KEY);
        const normalized = normalizeHost(cached || "");
        if (normalized) {
            logInfo("命中域名缓存", { host: normalized });
            return normalized;
        }
    } catch (error) {
        logInfo("读取域名缓存失败", { error: error.message });
    }
    return "";
}

async function fetchReleaseHosts() {
    const html = await requestTextAbsolute(LIBVIO_RELEASE_URL, {
        timeout: 12000,
        hostForHeaders: normalizeHost(LIBVIO_RELEASE_URL),
    });
    const found = [];
    const pushHost = (value) => {
        const normalized = normalizeHost(value);
        if (!normalized) return;
        if (/libvio\.app$/i.test(new URL(normalized).host)) return;
        found.push(normalized);
    };

    const domainRegex = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?/g;
    const hrefRegex = /href=["']([^"']+)["']/g;

    let m;
    while ((m = domainRegex.exec(html))) pushHost(m[0]);
    while ((m = hrefRegex.exec(html))) {
        const href = String(m[1] || "").trim();
        if (/^https?:\/\//i.test(href)) pushHost(href);
    }

    const unique = found.filter((item, idx, arr) => arr.indexOf(item) === idx);
    logInfo("发布页候选域名", { release: LIBVIO_RELEASE_URL, count: unique.length, hosts: unique.slice(0, 12) });
    return unique;
}

function buildHeadersForHost(host, extra = {}) {
    return {
        "User-Agent": UA,
        "Referer": `${host}/`,
        "Origin": host,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        ...extra,
    };
}

async function requestTextAbsolute(url, options = {}) {
    const target = new URL(url);
    const lib = target.protocol === "https:" ? https : http;
    const hostForHeaders = normalizeHost(options.hostForHeaders || `${target.protocol}//${target.host}`);
    const headers = buildHeadersForHost(hostForHeaders, options.headers || {});

    return await new Promise((resolve, reject) => {
        const req = lib.request(target, {
            method: options.method || "GET",
            headers,
            timeout: options.timeout || 15000,
        }, (res) => {
            const chunks = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const body = Buffer.concat(chunks).toString("utf8");
                const statusCode = Number(res.statusCode || 0);
                if (statusCode < 200 || statusCode >= 400) {
                    reject(new Error(`请求失败: ${statusCode} ${target.href}`));
                    return;
                }
                resolve(body);
            });
        });

        req.on("error", reject);
        req.on("timeout", () => {
            req.destroy(new Error(`请求超时: ${target.href}`));
        });
        req.end();
    });
}

async function probeHost(host) {
    try {
        await requestTextAbsolute(`${host}/`, { timeout: 8000, hostForHeaders: host });
        return true;
    } catch (error) {
        logInfo("域名探测失败", { host, error: error.message });
        return false;
    }
}

async function ensureActiveHost(preferredHost = "") {
    const preferred = normalizeHost(preferredHost);
    const cachedHost = await readActiveHostCache();

    let releaseHosts = [];
    try {
        releaseHosts = await fetchReleaseHosts();
    } catch (error) {
        logInfo("读取发布页域名失败", { release: LIBVIO_RELEASE_URL, error: error.message });
    }

    const ordered = [
        preferred,
        cachedHost,
        getCurrentHost(),
        ...releaseHosts,
        ...HOST_CANDIDATES,
    ].filter(Boolean).filter((item, idx, arr) => arr.indexOf(item) === idx);

    for (const host of ordered) {
        if (await probeHost(host)) {
            if (ACTIVE_HOST !== host) {
                logInfo("切换可用域名", { from: ACTIVE_HOST, to: host });
            }
            ACTIVE_HOST = host;
            await saveActiveHostCache(host);
            return ACTIVE_HOST;
        }
    }
    throw new Error(`未找到可用域名: ${ordered.join(", ")}`);
}

async function requestText(url, options = {}) {
    const raw = String(url || "").trim();
    if (!raw) throw new Error("请求地址为空");

    if (/^https?:\/\//i.test(raw)) {
        return await requestTextAbsolute(raw, options);
    }

    const hosts = [getCurrentHost(), ...HOST_CANDIDATES].filter(Boolean).filter((item, idx, arr) => arr.indexOf(item) === idx);
    let lastError = null;
    for (const host of hosts) {
        try {
            await ensureActiveHost(host);
            const absoluteUrl = raw.startsWith("/") ? `${ACTIVE_HOST}${raw}` : `${ACTIVE_HOST}/${raw}`;
            return await requestTextAbsolute(absoluteUrl, { ...options, hostForHeaders: ACTIVE_HOST });
        } catch (error) {
            lastError = error;
            logInfo("候选域名请求失败", { host, url: raw, error: error.message });
        }
    }
    throw lastError || new Error(`请求失败: ${raw}`);
}

function md5Short(input = "") {
    return crypto.createHash("md5").update(String(input || "")).digest("hex").slice(0, 16);
}

function buildCacheKey(prefix = "", ...parts) {
    const rawParts = parts
        .flat()
        .map((item) => item === undefined || item === null ? "" : String(item))
        .filter((item) => item !== "");
    const raw = rawParts.join("|");
    const short = raw ? md5Short(raw) : "empty";
    return `${prefix}:${short}`;
}

async function getCachedText(cacheKey, ttl, producer) {
    try {
        const cached = await OmniBox.getCache(cacheKey);
        if (cached) return String(cached);
    } catch (error) {
        logInfo("读取文本缓存失败", { cacheKey, error: error.message });
    }
    const text = String(await producer());
    try {
        await OmniBox.setCache(cacheKey, text, ttl);
    } catch (error) {
        logInfo("写入文本缓存失败", { cacheKey, error: error.message });
    }
    return text;
}

async function getCachedJson(cacheKey, ttl, producer) {
    try {
        const cached = await OmniBox.getCache(cacheKey);
        if (cached) return JSON.parse(String(cached));
    } catch (error) {
        logInfo("读取 JSON 缓存失败", { cacheKey, error: error.message });
    }
    const value = await producer();
    try {
        await OmniBox.setCache(cacheKey, JSON.stringify(value), ttl);
    } catch (error) {
        logInfo("写入 JSON 缓存失败", { cacheKey, error: error.message });
    }
    return value;
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function logInfo(message, data = null) {
    OmniBox.log("info", `[LIBVIO] ${data ? `${message}: ${safeJson(data)}` : message}`);
}

function logError(message, error) {
    OmniBox.log("error", `[LIBVIO] ${message}: ${error?.message || error}`);
}

function safeJson(data) {
    try {
        return JSON.stringify(data);
    } catch {
        return String(data);
    }
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function stripTags(text = "") {
    return String(text)
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeText(text = "") {
    return stripTags(String(text || ""))
        .normalize("NFKC")
        .replace(/[【】\[\]()（）]/g, " ")
        .replace(/[·•・]/g, " ")
        .replace(/[：:]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildMappingPreview(mappings = [], limit = 3) {
    return ensureArray(mappings)
        .slice(0, limit)
        .map((item) => `${item?.fileId || "<empty>"}=>${item?.episodeName || item?.name || "<empty>"}`)
        .join(" | ");
}

function buildScrapedEpisodeName(scrapeData, mapping, fallbackName = "") {
    const fallback = normalizeText(fallbackName || "") || String(fallbackName || "").trim() || "正片";
    if (!mapping) return fallback;
    const seasonNumber = mapping.seasonNumber;
    const episodeNumber = mapping.episodeNumber;
    const rawEpisodeName = normalizeText(mapping.episodeName || "");
    const title = normalizeText(scrapeData?.title || "");
    const episodeTitle = rawEpisodeName && rawEpisodeName !== title ? rawEpisodeName : "";

    if (episodeNumber !== undefined && episodeNumber !== null && episodeNumber !== "") {
        const epLabel = `第${episodeNumber}集`;
        if (episodeTitle) {
            return seasonNumber ? `S${seasonNumber}E${episodeNumber} ${episodeTitle}` : `${epLabel} ${episodeTitle}`;
        }
        return seasonNumber ? `S${seasonNumber}E${episodeNumber}` : epLabel;
    }

    if (episodeTitle) return episodeTitle;
    return fallback;
}

function buildDanmakuFileName(vodName = "", episodeName = "") {
    const title = normalizeText(vodName || "");
    if (!title) return "";
    const episode = normalizeText(episodeName || "");
    return episode ? `${title} ${episode}` : title;
}

function sortEpisodesByMeta(episodes = []) {
    if (!Array.isArray(episodes) || episodes.length <= 1) return episodes;
    const items = episodes.map((ep, index) => {
        const meta = decodePlayId(String(ep?.playId || "").split("|||")[1] || "");
        const season = Number(meta?.s);
        const episode = Number(meta?.n);
        return {
            ep,
            index,
            hasSeason: Number.isFinite(season) && season > 0,
            hasEpisode: Number.isFinite(episode) && episode > 0,
            season: Number.isFinite(season) ? season : Number.MAX_SAFE_INTEGER,
            episode: Number.isFinite(episode) ? episode : Number.MAX_SAFE_INTEGER,
        };
    });
    const hasSortable = items.some((item) => item.hasEpisode);
    if (!hasSortable) return episodes;
    items.sort((a, b) => {
        if (a.hasEpisode !== b.hasEpisode) return a.hasEpisode ? -1 : 1;
        if (a.season !== b.season) return a.season - b.season;
        if (a.episode !== b.episode) return a.episode - b.episode;
        return a.index - b.index;
    });
    return items.map((item) => item.ep);
}

function fixUrl(url = "") {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith("//")) return `https:${url}`;
    const host = getCurrentHost();
    return url.startsWith("/") ? `${host}${url}` : `${host}/${url}`;
}

function encodePlayId(payload) {
    return Buffer.from(JSON.stringify(payload || {}), "utf8").toString("base64");
}

function decodePlayId(playId = "") {
    const input = String(playId || "").trim();
    if (!input) return {};

    // 1) 标准 base64 JSON
    try {
        const text = Buffer.from(input, "base64").toString("utf8").trim();
        if (text.startsWith("{") && text.endsWith("}")) {
            return JSON.parse(text);
        }
    } catch {}

    // 2) URL-safe base64 JSON（-/_）
    try {
        const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
        const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
        const text = Buffer.from(padded, "base64").toString("utf8").trim();
        if (text.startsWith("{") && text.endsWith("}")) {
            return JSON.parse(text);
        }
    } catch {}

    // 3) 直接 JSON 字符串
    try {
        if (input.startsWith("{") && input.endsWith("}")) {
            return JSON.parse(input);
        }
    } catch {}

    return {};
}

function resolveCollectPlayPageUrl(rawPlayId = "", meta = {}) {
    const raw = String(rawPlayId || "").trim();

    // 优先用编码后的 meta.url
    const metaUrl = fixUrl(String(meta?.url || "").trim());
    if (/^https?:\/\//i.test(metaUrl)) return metaUrl;

    // raw 已是绝对/相对路径
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^\//.test(raw)) return fixUrl(raw);
    if (/^[^\s]+\.html?(\?.*)?$/i.test(raw)) return fixUrl(`/${raw}`);

    // raw 可能本身是 base64/json 打包过的 playId
    const nested = decodePlayId(raw);
    const nestedUrl = fixUrl(String(nested?.url || "").trim());
    if (/^https?:\/\//i.test(nestedUrl)) return nestedUrl;

    return "";
}

function buildFilterList(categoryId) {
    const preset = FILTERS[String(categoryId)] || {};
    const list = [];
    if (preset.genre?.length) {
        list.push({
            key: "genre",
            name: "剧情",
            init: "",
            value: [{ name: "全部", value: "" }, ...preset.genre.map((item) => ({ name: item, value: item }))]
        });
    }
    if (preset.area?.length) {
        list.push({
            key: "area",
            name: "地区",
            init: "",
            value: [{ name: "全部", value: "" }, ...preset.area.map((item) => ({ name: item, value: item }))]
        });
    }
    list.push({
        key: "year",
        name: "年份",
        init: "",
        value: [{ name: "全部", value: "" }, ...buildYearOptions()]
    });
    if (preset.lang?.length) {
        list.push({
            key: "lang",
            name: "语言",
            init: "",
            value: [{ name: "全部", value: "" }, ...preset.lang.map((item) => ({ name: item, value: item }))]
        });
    }
    list.push({
        key: "sort",
        name: "排序",
        init: "time",
        value: SORT_OPTIONS.map((item) => ({ name: item.name, value: item.value }))
    });
    return list;
}

function buildFilterListFromHtml(html = "", categoryId = "") {
    const groups = parseFilterGroups(html);
    const list = [];
    for (const group of groups) {
        const key = mapFilterTitleToKey(group.title);
        if (!key || !Array.isArray(group.items) || !group.items.length) continue;
        const title = String(group.title || "").replace(/^按/, "").replace(/[：:]\s*$/u, "").trim();
        const values = group.items.map((item) => ({
            name: item.name,
            value: item.name,
        })).filter((item) => item.name);
        if (!values.length) continue;
        list.push({
            key,
            name: title,
            init: key === "sort" ? "time" : "",
            value: key === "sort" ? SORT_OPTIONS.map((item) => ({ name: item.name, value: item.value })) : values,
        });
    }
    return list.length ? list : buildFilterList(categoryId);
}

function buildYearOptions() {
    const current = new Date().getFullYear();
    const list = [];
    for (let year = current; year >= 1998; year -= 1) {
        list.push({ name: String(year), value: String(year) });
    }
    return list;
}

function getCategoryBasePath(categoryId, page = 1) {
    const cid = encodeURIComponent(String(categoryId));
    return page > 1 ? `/type/${cid}-${page}.html` : `/type/${cid}.html`;
}

function parseFilterGroups(html = "") {
    const groups = [];
    const text = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
    const ulRegex = /<ul class="clearfix">([\s\S]*?)<\/ul>/g;
    let match;
    while ((match = ulRegex.exec(text))) {
        const block = match[1] || "";
        const title = stripTags(block.match(/<li[^>]*>\s*<span[^>]*>\s*([\s\S]*?)\s*<\/span>\s*<\/li>/)?.[1] || "")
            .replace(/[：:]\s*$/u, "")
            .trim();
        if (!title) continue;
        const items = [...block.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map((item) => ({
            name: stripTags(item[2]),
            href: fixUrl(item[1]),
        })).filter((item) => item.name && item.href);
        if (items.length) groups.push({ title, items });
    }
    return groups;
}

function mapFilterTitleToKey(title = "") {
    const text = String(title || "").trim();
    if (text.includes("剧情") || text.includes("类型")) return "genre";
    if (text.includes("地区")) return "area";
    if (text.includes("年份")) return "year";
    if (text.includes("语言")) return "lang";
    if (text.includes("排序") || text.includes("时间") || text.includes("人气") || text.includes("评分")) return "sort";
    return "";
}

function normalizeFilterValue(key, value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    if (key === "sort") {
        if (["最新", "时间", "time"].includes(raw)) return "time";
        if (["人气", "热门", "hits"].includes(raw)) return "hits";
        if (["评分", "高分", "score"].includes(raw)) return "score";
    }
    return raw;
}

function resolveFilterHref(groups, key, value) {
    const normalizedValue = normalizeFilterValue(key, value);
    const targetNames = new Set();
    if (!normalizedValue) {
        targetNames.add("全部");
        if (key === "sort") {
            targetNames.add("时间");
            targetNames.add("最新");
        }
    } else if (key === "sort") {
        if (normalizedValue === "time") {
            targetNames.add("时间");
            targetNames.add("最新");
        } else if (normalizedValue === "hits") {
            targetNames.add("人气");
            targetNames.add("热门");
        } else if (normalizedValue === "score") {
            targetNames.add("评分");
            targetNames.add("高分");
        }
    } else {
        targetNames.add(normalizedValue);
    }

    for (const group of groups) {
        if (mapFilterTitleToKey(group.title) !== key) continue;
        const found = group.items.find((item) => targetNames.has(item.name));
        if (found?.href) return found.href;
    }
    return "";
}

function parseObjectParam(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    const text = String(value || "").trim();
    if (!text) return {};
    try {
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function pickFilterValue(source = {}, keys = []) {
    for (const key of keys) {
        const value = source?.[key];
        if (value === 0 || value === "0") return "0";
        if (typeof value === "string" && value.trim()) return value.trim();
        if (value !== undefined && value !== null && value !== "" && typeof value !== "object") {
            return String(value).trim();
        }
    }
    return "";
}

function normalizeCategoryFilters(params = {}) {
    const merged = {
        ...parseObjectParam(params?.ext),
        ...parseObjectParam(params?.filter),
        ...parseObjectParam(params?.extend),
        ...parseObjectParam(params?.filters),
    };
    return {
        genre: normalizeFilterValue("genre", pickFilterValue(merged, ["genre", "class", "type", "cate", "subType", "subtype", "剧情", "类型"])),
        area: normalizeFilterValue("area", pickFilterValue(merged, ["area", "region", "地区"])),
        year: normalizeFilterValue("year", pickFilterValue(merged, ["year", "年份"])),
        lang: normalizeFilterValue("lang", pickFilterValue(merged, ["lang", "language", "语言"])),
        sort: normalizeFilterValue("sort", pickFilterValue(merged, ["sort", "by", "order", "排序"])),
    };
}

function findCategoryPageHref(html = "", targetPage = 1) {
    const text = String(html || "");
    if (targetPage <= 1) return "";
    const exact = text.match(new RegExp(`<a[^>]*href="([^"]+)"[^>]*>\\s*${targetPage}\\s*<\\/a>`, "i"))?.[1];
    if (exact) return fixUrl(exact);
    return "";
}

async function resolveCategoryPageUrl(baseUrl, targetPage = 1) {
    if (targetPage <= 1) return fixUrl(baseUrl);
    let currentUrl = fixUrl(baseUrl);
    let currentPage = 1;
    while (currentPage < targetPage) {
        const html = await fetchHtml(currentUrl, { ttl: FILTER_CACHE_TTL });
        const directHref = findCategoryPageHref(html, targetPage);
        if (directHref) return directHref;
        const nextHref = findCategoryPageHref(html, currentPage + 1)
            || (targetPage === currentPage + 1 ? fixUrl(html.match(/<a[^>]*href="([^"]+)"[^>]*>\s*下一页\s*<\/a>/)?.[1] || "") : "");
        if (!nextHref || nextHref === currentUrl) {
            logInfo("category 分页到达末页", { baseUrl: currentUrl.replace(getCurrentHost(), ""), targetPage, currentPage });
            return "";
        }
        currentUrl = nextHref;
        currentPage += 1;
    }
    return currentUrl;
}

async function resolveCategoryUrl(categoryId, page, filters = {}) {
    const normalizedFilters = normalizeCategoryFilters({ filters });
    const filterKey = buildCacheKey("libvio:category-filter-url", categoryId, page, JSON.stringify(normalizedFilters));
    return await getCachedText(filterKey, FILTER_CACHE_TTL, async () => {
        let currentUrl = fixUrl(getCategoryBasePath(categoryId, 1));
        const order = ["genre", "area", "year", "lang", "sort"];

        for (const key of order) {
            if (!normalizedFilters[key]) continue;
            const html = await fetchHtml(currentUrl, { ttl: FILTER_CACHE_TTL });
            const groups = parseFilterGroups(html);
            const targetHref = resolveFilterHref(groups, key, normalizedFilters[key]);
            if (targetHref) currentUrl = targetHref;
        }

        return await resolveCategoryPageUrl(currentUrl, page);
    });
}

function buildSearchPath(keyword, page = 1) {
    const pageSeg = page > 1 ? String(page) : "";
    return `/search/------------${pageSeg}---.html?wd=${encodeURIComponent(keyword)}`;
}

async function fetchHtml(url, options = {}) {
    const ttl = Number(options?.ttl || 0);
    if (ttl > 0) {
        const cacheKey = buildCacheKey("libvio:html", url);
        return await getCachedText(cacheKey, ttl, async () => String(await requestText(url, options)));
    }
    return String(await requestText(url, options));
}

function parseVodList(html = "") {
    const text = String(html || "");
    const candidates = [];

    const patterns = [
        /<li[^>]*>[\s\S]*?<a[^>]*href="([^"]*\/detail\/\d+\.html)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?<\/li>/g,
        /<a[^>]*href="([^"]*\/detail\/\d+\.html)"[^>]*title="([^"]+)"[^>]*>[\s\S]*?(?:<\/a>)/g,
    ];

    for (const regex of patterns) {
        let match;
        while ((match = regex.exec(text))) {
            const whole = match[0] || "";
            const href = fixUrl(match[1] || "");
            const title = stripTags(match[2] || "");
            if (!href || !title) continue;
            const pic = fixUrl(
                whole.match(/data-original="([^"]+)"/)?.[1]
                || whole.match(/data-src="([^"]+)"/)?.[1]
                || whole.match(/src="([^"]+)"/)?.[1]
                || ""
            );
            const remark = stripTags(
                whole.match(/<span class="pic-text[^>]*">([\s\S]*?)<\/span>/)?.[1]
                || whole.match(/<span class="jidi[^>]*">([\s\S]*?)<\/span>/)?.[1]
                || whole.match(/<p class="remarks[^>]*">([\s\S]*?)<\/p>/)?.[1]
                || ""
            );
            const score = stripTags(
                whole.match(/<span class="pic-tag[^>]*">([\s\S]*?)<\/span>/)?.[1]
                || whole.match(/<span class="score[^>]*">([\s\S]*?)<\/span>/)?.[1]
                || ""
            );
            candidates.push({
                vod_id: href,
                vod_name: title,
                vod_pic: pic,
                vod_remarks: remark || score,
                vod_score: score,
            });
        }
        if (candidates.length >= 12) break;
    }

    const dedup = [];
    const seen = new Set();
    for (const item of candidates) {
        const key = `${item.vod_id}@@${item.vod_name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dedup.push(item);
    }
    return dedup;
}

function normalizePanSourceName(name = "") {
    const text = stripTags(name);
    if (/UC/i.test(text)) return "UC网盘";
    if (/百度/i.test(text)) return "百度网盘";
    if (/夸克/i.test(text)) return "夸克网盘";
    if (/天翼/i.test(text)) return "天翼网盘";
    if (/115/i.test(text)) return "115网盘";
    if (/迅雷/i.test(text)) return "迅雷网盘";
    if (/阿里|ALi|Ali/i.test(text)) return "阿里网盘";
    if (/123/i.test(text)) return "123网盘";
    const match = text.match(/\(([^()]+)\)/);
    if (match?.[1]) return match[1].trim();
    return text.replace(/^视频下载\s*/u, "").trim() || text;
}

function splitNetdiskPanels(html = "") {
    const text = String(html || "");
    const panels = [];

    // LIBVIO 详情页常见结构：<div class="stui-vodlist__head"><h3>UC网盘</h3></div><ul>...</ul>
    // 标题与 ul 之间有 </div>，不能只匹配 h3 后紧跟 ul。
    const regex = /<div class="stui-vodlist__head"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?(?:网盘|视频下载)[\s\S]*?)<\/h3>[\s\S]*?<\/div>\s*<ul[^>]*>([\s\S]*?)<\/ul>/gi;
    let match;
    while ((match = regex.exec(text))) {
        panels.push(`<h3>${match[1] || "网盘"}</h3><ul>${match[2] || ""}</ul>`);
    }

    logInfo("detail 网盘面板提取", { count: panels.length, titles: panels.map((panel) => stripTags(panel.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] || "")).join(" | ") });
    return panels;
}

function isCollectPlayHref(url = "") {
    return /\/play\/[^/?#]+\.html(?:[?#].*)?$/i.test(String(url || "").trim());
}

function extractPlaylistSources(html = "", videoId = "", vodName = "") {
    const text = String(html || "");
    const sources = [];
    const seenSources = new Set();
    const patterns = [
        /<div class="stui-vodlist__head"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/div>\s*<ul class="stui-content__playlist[^"]*"[^>]*>([\s\S]*?)<\/ul>/g,
        /<div class="playlist-panel(?:\s+netdisk-panel)?"[^>]*>[\s\S]*?<h3[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/g,
        /<div class="module-tab-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div class="module-play-list[^"]*"[^>]*>([\s\S]*?)<\/div>/g,
    ];

    for (const regex of patterns) {
        let match;
        while ((match = regex.exec(text))) {
            const sourceName = stripTags(match[1] || "播放").replace(/^播放线路[：:]?/u, "").trim();
            if (!sourceName || /猜你喜欢|相关推荐/i.test(sourceName)) continue;
            const listHtml = match[2] || "";
            const episodes = [];
            const seenEpisodes = new Set();

            for (const item of listHtml.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
                const playUrl = fixUrl(item[1] || "");
                if (!isCollectPlayHref(playUrl)) continue;
                const episodeName = stripTags(item[2] || "") || `第${episodes.length + 1}集`;
                const dedupeKey = `${playUrl}@@${episodeName}`;
                if (seenEpisodes.has(dedupeKey)) continue;
                seenEpisodes.add(dedupeKey);
                const episodeIndex = episodes.length;
                const fid = `${videoId}#${sourceName}#${episodeIndex}`;
                const meta = {
                    mode: "collect",
                    url: playUrl,
                    flag: sourceName,
                    name: episodeName,
                    v: vodName,
                    e: episodeName,
                    sid: videoId,
                    fid,
                    t: sourceName,
                    i: episodeIndex,
                };
                episodes.push({
                    name: episodeName,
                    playId: `${playUrl}|||${encodePlayId(meta)}`,
                    _fid: fid,
                    _rawName: episodeName,
                });
            }

            if (!episodes.length) continue;
            const sourceKey = `${sourceName}@@${episodes.map((ep) => ep.playId).join("|")}`;
            if (seenSources.has(sourceKey)) continue;
            seenSources.add(sourceKey);
            sources.push({ name: sourceName, episodes });
        }
    }

    return sources;
}

function buildLegacyPlayFields(playSources = []) {
    const sourceNames = [];
    const sourceUrls = [];
    for (const source of playSources || []) {
        const episodes = Array.isArray(source?.episodes) ? source.episodes : [];
        if (!episodes.length) continue;
        sourceNames.push(String(source.name || "播放").trim() || "播放");
        sourceUrls.push(episodes.map((ep, index) => {
            const episodeName = String(ep?.name || `第${index + 1}集`).replace(/[#$]/g, " ").trim() || `第${index + 1}集`;
            const playId = String(ep?.playId || "").trim();
            return playId ? `${episodeName}$${playId}` : "";
        }).filter(Boolean).join("#"));
    }
    return {
        vod_play_from: sourceNames.join("$$$"),
        vod_play_url: sourceUrls.join("$$$"),
    };
}

function parseMetaItems(html = "") {
    return ensureArray(html.match(/<span class="meta-item">([\s\S]*?)<\/span>/g)).map((item) => stripTags(item));
}

function isPanUrl(url = "") {
    const u = String(url || "").toLowerCase();
    return u.includes("pan.baidu.com") || u.includes("quark.cn") || u.includes("pan.quark.cn") || u.includes("drive.uc.cn") || u.includes("aliyundrive.com") || u.includes("alipan.com") || u.includes("xunlei.com") || u.includes("cloud.189.cn") || u.includes("115.com") || u.includes("123pan.com");
}

function normalizeShareUrl(url = "") {
    let value = String(url || "").trim();
    if (value.startsWith("push://")) value = value.slice("push://".length);
    if (value.startsWith("push:")) value = value.slice("push:".length);
    return value.trim();
}

function isVideoFile(file) {
    if (!file) return false;
    const fileName = String(file.file_name || file.name || "").toLowerCase();
    const exts = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];
    if (exts.some((ext) => fileName.endsWith(ext))) return true;
    const formatType = String(file.format_type || "").toLowerCase();
    return formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264");
}

function getFileId(file) {
    return file?.fid || file?.file_id || "";
}

function getFileName(file) {
    return file?.file_name || file?.name || "";
}

async function getAllVideoFiles(shareURL, files) {
    const result = [];
    for (const file of files || []) {
        if (file?.file && isVideoFile(file)) {
            result.push(file);
            continue;
        }
        if (file?.dir) {
            try {
                const subFileId = getFileId(file);
                if (!subFileId) continue;
                const subFileList = await OmniBox.getDriveFileList(shareURL, subFileId);
                if (Array.isArray(subFileList?.files)) {
                    const subVideos = await getAllVideoFiles(shareURL, subFileList.files);
                    result.push(...subVideos);
                }
            } catch (error) {
                logInfo("获取网盘子目录失败", { shareURL, name: getFileName(file), error: error.message });
            }
        }
    }
    return result;
}

async function loadPanFiles(shareURL) {
    if (!shareURL) return null;
    if (panShareCache.has(shareURL)) return panShareCache.get(shareURL);
    const cacheKey = buildCacheKey("libvio:pan-share", shareURL);
    try {
        const result = await getCachedJson(cacheKey, PAN_SHARE_CACHE_TTL, async () => {
            const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
            const fileList = await OmniBox.getDriveFileList(shareURL, "0");
            const files = Array.isArray(fileList?.files) ? fileList.files : [];
            const videos = await getAllVideoFiles(shareURL, files);
            return { driveInfo, videos };
        });
        panShareCache.set(shareURL, result);
        return result;
    } catch (error) {
        logInfo("读取网盘文件失败", { shareURL, error: error.message });
        return null;
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
        return aOrder - bOrder;
    });
}

function buildPanEpisodePlayId(shareURL, fileId, meta = {}) {
    return `${shareURL}|${fileId}|||${encodePlayId(meta)}`;
}

function decodeCombinedPlayId(playId = "") {
    if (!String(playId).includes("|||")) return { main: String(playId || ""), meta: {} };
    const [main, metaB64] = String(playId).split("|||");
    return { main, meta: decodePlayId(metaB64 || "") };
}

function expandPanSourcesWithRoutes(playSources = [], from = "web") {
    const result = [];
    for (const source of playSources) {
        const driveType = inferDriveTypeFromSourceName(source?.name || "");
        const shouldExpandRoutes = DRIVE_TYPE_CONFIG.length === 0 || !driveType || DRIVE_TYPE_CONFIG.includes(driveType);

        if (!shouldExpandRoutes) {
            result.push(source);
            continue;
        }

        let routeNames = [...SOURCE_NAMES_CONFIG];
        if (from === "web") {
            routeNames = routeNames.filter((name) => name !== "本地代理");
        }
        if (!routeNames.length) {
            result.push(source);
            continue;
        }

        for (const routeName of routeNames) {
            result.push({
                name: `${source.name}-${routeName}`,
                episodes: (source.episodes || []).map((ep) => {
                    const decoded = decodeCombinedPlayId(ep.playId);
                    const baseMeta = decoded.meta || {};
                    const fileId = String(baseMeta.fileId || baseMeta.fid || "").trim();
                    const shareUrl = String(baseMeta.shareUrl || baseMeta.shareURL || "").trim();
                    const fid = shareUrl && fileId ? `${shareUrl}|${fileId}` : fileId;
                    const meta = { ...(decoded.meta || {}), routeType: routeName, flag: `${source.name}-${routeName}`, fid: fid || baseMeta.fid || "" };
                    return {
                        name: ep.name,
                        playId: `${decoded.main}|||${encodePlayId(meta)}`
                    };
                })
            });
        }
    }
    return result;
}

function decodePlayerUrl(url = "", encrypt = 0) {
    let value = String(url || "").trim();
    const mode = Number(encrypt || 0);
    if (!value) return "";
    try {
        if (mode === 1) {
            value = unescape(value);
        } else if (mode === 2) {
            value = unescape(Buffer.from(value, "base64").toString("utf8"));
        }
    } catch (error) {
        logError("播放地址解码失败", error);
    }
    return value.replace(/\\\//g, "/");
}

function buildPlayUrl(rawUrl = "") {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    if (value.startsWith("//")) return `https:${value}`;
    return fixUrl(value);
}

function isDirectMediaUrl(url = "") {
    const value = String(url || "").trim();
    if (!/^https?:\/\//i.test(value)) return false;
    try {
        const target = new URL(value);
        const pathname = target.pathname.toLowerCase();
        return /\.(m3u8|mp4|m4v|m4a|mp3|flv|avi|mkv|mov|webm)(?:$|\?)/i.test(pathname) || /\.(m3u8|mp4|m4v|m4a|mp3|flv|avi|mkv|mov|webm)$/i.test(value.toLowerCase());
    } catch {
        return /\.(m3u8|mp4|m4v|m4a|mp3|flv|avi|mkv|mov|webm)(?:$|\?)/i.test(value.toLowerCase());
    }
}

function buildProviderIframeUrl(player = {}) {
    const from = String(player?.from || '').trim();
    const rawUrl = String(player?.url || '').trim();
    const id = String(player?.id || '').trim();
    const nid = String(player?.nid || '').trim();
    const next = String(player?.link_next || '').trim();
    if (!from || !rawUrl) return "";

    if (from === 'ty_new1') {
        return `${getCurrentHost()}/vid/ty4.php?url=${encodeURIComponent(rawUrl)}&next=${encodeURIComponent(next)}&id=${encodeURIComponent(id)}&nid=${encodeURIComponent(nid)}`;
    }
    if (from === 'vr2') {
        return `${getCurrentHost()}/vid/plyr/vr2.php?url=${encodeURIComponent(rawUrl)}&next=${encodeURIComponent(next)}&id=${encodeURIComponent(id)}&nid=${encodeURIComponent(nid)}`;
    }
    return "";
}

function emptyPlay(flag = "LIBVIO") {
    return { parse: 0, urls: [] };
}

function emptyPage(page = 1) {
    return { page, pagecount: 0, total: 0, limit: DEFAULT_PAGE_SIZE, list: [] };
}

async function home(params, context) {
    try {
        logInfo("home 进入", { params, host: getCurrentHost(), from: context?.from || "web" });
        const html = await fetchHtml("/", { ttl: HOME_CACHE_TTL });
        let list = parseVodList(html).slice(0, 24);

        if (!list.length) {
            logInfo("home 主站首页解析为空，尝试分类页回退", { fallback: "/type/1.html" });
            const fallbackHtml = await fetchHtml("/type/1.html", { ttl: HOME_CACHE_TTL });
            list = parseVodList(fallbackHtml).slice(0, 24);
            logInfo("home 分类页回退完成", { fallbackListCount: list.length });
        }

        const classes = CLASS_LIST.map((item) => ({ ...item }));
        const filters = {};
        for (const item of classes) {
            filters[item.type_id] = buildFilterList(item.type_id);
        }
        logInfo("home 完成", { classCount: classes.length, listCount: list.length });
        return { class: classes, filters, list };
    } catch (error) {
        logError("home 失败", error);
        return { class: [], filters: {}, list: [] };
    }
}

async function category(params, context) {
    const categoryId = String(params?.categoryId || "1");
    const page = Number(params?.page || 1);
    const filters = normalizeCategoryFilters(params);
    try {
        const finalUrl = await resolveCategoryUrl(categoryId, page, filters);
        if (!finalUrl) {
            logInfo("category 无可用分页链接，返回空页", { categoryId, page });
            return { ...emptyPage(page - 1), filters: buildFilterList(categoryId) };
        }
        logInfo("category 请求", { categoryId, page, filters, rawFilters: { filters: params?.filters || {}, extend: params?.extend || {}, ext: params?.ext || {}, filter: params?.filter || {} }, host: getCurrentHost(), path: finalUrl.replace(getCurrentHost(), ""), from: context?.from || "web" });
        const html = await fetchHtml(finalUrl, { ttl: CATEGORY_CACHE_TTL });
        const list = parseVodList(html);
        const hasNext = Boolean(findCategoryPageHref(html, page + 1));
        const pagecount = list.length === DEFAULT_PAGE_SIZE && hasNext ? page + 1 : (page > 1 || list.length ? page : 0);
        logInfo("category 完成", { categoryId, page, listCount: list.length, pagecount });
        return {
            page,
            pagecount,
            total: pagecount ? pagecount * DEFAULT_PAGE_SIZE : list.length,
            limit: DEFAULT_PAGE_SIZE,
            filters: buildFilterList(categoryId),
            list
        };

    } catch (error) {


        logError("category 失败", error);
        return { ...emptyPage(page), filters: buildFilterList(categoryId) };
    }
}

async function detail(params, context) {
    const videoId = String(params?.videoId || "").trim();
    if (!videoId) return { list: [] };
    try {
        logInfo("detail 请求", { videoId, host: getCurrentHost(), from: context?.from || "web" });
        const html = await fetchHtml(videoId, { ttl: DETAIL_CACHE_TTL });
        const name = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || "");
        const poster = fixUrl(html.match(/class="lazyload"[^>]*data-original="([^"]+)"/)?.[1] || html.match(/data-original="([^"]+)"/)?.[1] || "");
        const intro = stripTags(html.match(/<span class="detail-content"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "");
        const score = stripTags(html.match(/<span class="score">([^<]+)<\/span>/)?.[1] || "");
        const metaItems = parseMetaItems(html);
        const typeName = metaItems[0] || "";
        const area = metaItems[1] || "";
        const year = metaItems[2]?.replace(/[^\d]/g, "") || "";
        const remarks = metaItems[5] || html.match(/<span class="pic-text[^>]*">([\s\S]*?)<\/span>/)?.[1] || "";
        const actor = metaItems.find((item) => item.startsWith("主演："))?.replace(/^主演：/, "") || "";
        const director = metaItems.find((item) => item.startsWith("导演："))?.replace(/^导演：/, "") || "";

        const allCollectSources = extractPlaylistSources(html, videoId, name);

        const netdiskPanels = splitNetdiskPanels(html);
        const netdiskSources = [];
        const processedHrefs = new Set();
        for (const panelHtml of netdiskPanels) {
            const rawSourceTitle = stripTags(panelHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1] || "网盘");
            if (!/(网盘|下载)/u.test(rawSourceTitle)) {
                logInfo("detail 跳过非网盘/下载线路", { sourceName: rawSourceTitle });
                continue;
            }
            const sourceName = normalizePanSourceName(rawSourceTitle);
            // 记录正在处理的网盘/下载线路（包括 UC）
            logInfo("detail 开始处理网盘线路", { sourceName, rawTitle: rawSourceTitle });
            const playLinks = [...panelHtml.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
            const episodes = [];
            for (const item of playLinks) {
                const href = fixUrl(item[1] || "");
                if (!/\/play\/[^\/]+\.html/i.test(href)) continue;
                if (processedHrefs.has(href)) continue;
                const label = stripTags(item[2] || "").trim() || "合集";
                const linkTextForPan = `${rawSourceTitle} ${label}`;
                if (!/(网盘|下载)/u.test(linkTextForPan)) continue;
                processedHrefs.add(href);
                const playPageHtml = await fetchHtml(href, { ttl: DETAIL_CACHE_TTL });
                const playerJson = playPageHtml.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})<\/script>/)?.[1];
                let episodeList = [];
                // 如果没有 playerJson 且是 UC 网盘，尝试直接用 href 作为分享链接解析
                if (!playerJson && /UC/i.test(sourceName)) {
                    // UC 的播放页本身不是网盘链接，尝试在页面源码里寻找真实的 UC 分享链接
                    const possibleUrls = [];
                    const ucUrlMatch = playPageHtml.match(/https?:\/\/[^\s'"<>]*drive\.uc\.cn[^\s'"<>]*/i);
                    if (ucUrlMatch) possibleUrls.push(ucUrlMatch[0]);
                    const ucAltMatch = playPageHtml.match(/https?:\/\/[^\s'"<>]*uc\.cn\/s\/[^\s'"<>]*/i);
                    if (ucAltMatch) possibleUrls.push(ucAltMatch[0]);
                    let found = false;
                    for (const shareUrl of possibleUrls) {
                        if (isPanUrl(shareUrl)) {
                            const panInfo = await loadPanFiles(shareUrl);
                            episodeList = Array.isArray(panInfo?.videos) ? panInfo.videos : [];
                            if (episodeList.length) {
                                logInfo("detail UC 网盘通过页面提取解析成功", { sourceName, href, shareUrl, episodeCount: episodeList.length });
                                found = true;
                                break;
                            } else {
                                logInfo("detail UC 网盘通过页面提取无文件", { sourceName, href, shareUrl });
                            }
                        }
                    }
                    if (!found) {
                        logInfo("detail UC 网盘未能提取有效分享链接", { sourceName, href });
                    }
                }
                if (playerJson) {
                    try {
                        const player = JSON.parse(playerJson);
                        const rawFrom = String(player.from || "").toLowerCase();
                        const isPan = rawFrom.includes("uc") || rawFrom.includes("pan") || rawFrom.includes("baidu") || rawFrom.includes("quark") || rawFrom.includes("ali");
                        if (isPan && player.url) {
                            const shareUrl = normalizeShareUrl(decodePlayerUrl(player.url, player.encrypt));
                            if (isPanUrl(shareUrl)) {
                                const panInfo = await loadPanFiles(shareUrl);
                                episodeList = Array.isArray(panInfo?.videos) ? panInfo.videos : [];
                            }
                        }
                    } catch (error) {
                        logInfo("detail 网盘播放页解析失败", { href, error: error.message });
                    }
                }

                if (episodeList.length > 0) {
                    for (const file of episodeList) {
                        const fileId = getFileId(file);
                        if (!fileId) continue;
                        const rawFileName = getFileName(file) || label || "网盘资源";
                        const episodeName = /第\d+集/.test(rawFileName) ? rawFileName : (rawFileName !== "合集" ? rawFileName : (remarks.match(/第\d+集/)?.[0] || rawFileName));
                        episodes.push({
                            name: episodeName,
                            playId: buildPanEpisodePlayId(normalizeShareUrl(decodePlayerUrl(playerJson ? JSON.parse(playerJson).url : "", playerJson ? JSON.parse(playerJson).encrypt : 0)), fileId, {
                                mode: "pan-file",
                                shareUrl: normalizeShareUrl(decodePlayerUrl(playerJson ? JSON.parse(playerJson).url : "", playerJson ? JSON.parse(playerJson).encrypt : 0)),
                                fileId,
                                flag: sourceName,
                                name: episodeName,
                                vodName: name,
                                vodId: String(videoId || "")
                            })
                        });
                    }
                } else {
                    // 没有展开到具体文件时，不要把“合集”当做一集；直接跳过这个网盘源
                    logInfo("detail 网盘线路无具体集数，跳过合集占位", { sourceName, href, label });
                }
            }
            if (episodes.length) {
                logInfo("detail 网盘线路解析完成", { sourceName, episodeCount: episodes.length });
                netdiskSources.push({ name: sourceName, episodes });
            } else {
                logInfo("detail 网盘线路解析失败，已排除", { sourceName, playLinkCount: playLinks.length });
            }
        }

        // 过滤掉已经展开的网盘线路以及 UC 网盘（目前不解析）
        const parsedNetdiskSourceNames = new Set(netdiskSources.map((source) => source.name));
        // 处理 UC 网盘可能被误放入 collectSources 的情况
        const ucCollectSources = allCollectSources.filter((src) => normalizePanSourceName(src?.name || "") === "UC网盘");
        for (const src of ucCollectSources) {
            const rawSourceTitle = src.name || "UC网盘";
            const sourceName = normalizePanSourceName(rawSourceTitle);
            logInfo("detail 开始处理 UC 网盘采集线路", { sourceName, rawSourceTitle });
            const episodes = [];
            for (const ep of src.episodes || []) {
                // ep.playId 在 collectSources 里是普通集合链接 (play page)
                const href = fixUrl((ep.playId || "").split("|||")[0] || "");
                if (!href) continue;
                const playPageHtml = await fetchHtml(href, { ttl: DETAIL_CACHE_TTL });
                // 首先尝试直接从 player_aaaa 中取分享链接（UC 典型）
                let resolvedShareUrl = "";
                try {
                    const playerJsonMatch = playPageHtml.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})<\/script>/);
                    if (playerJsonMatch) {
                        const player = JSON.parse(playerJsonMatch[1]);
                        if (player && typeof player.url === "string" && isPanUrl(player.url)) {
                            resolvedShareUrl = player.url;
                        }
                    }
                } catch (e) {
                    logInfo("detail UC 解析 player_aaaa 失败", { sourceName, href, error: e.message });
                }
                // 若未从 player_aaaa 取到，再尝试正则匹配普通 UC 分享链接
                const possibleUrls = [];
                if (resolvedShareUrl) {
                    possibleUrls.push(resolvedShareUrl);
                } else {
                    const ucUrlMatch = playPageHtml.match(/https?:\/\/[^\s'"<>]*drive\.uc\.cn[^\s'"<>]*/i);
                    if (ucUrlMatch) possibleUrls.push(ucUrlMatch[0]);
                    const ucAltMatch = playPageHtml.match(/https?:\/\/[^\s'"<>]*uc\.cn\/s\/[^\s'"<>]*/i);
                    if (ucAltMatch) possibleUrls.push(ucAltMatch[0]);
                }
                let found = false;
                for (const shareUrl of possibleUrls) {
                    if (!isPanUrl(shareUrl)) continue;
                    const panInfo = await loadPanFiles(shareUrl);
                    const videoList = panInfo?.videos || [];
                    if (videoList.length) {
                        for (const file of videoList) {
                            const fileId = getFileId(file);
                            const rawFileName = getFileName(file);
                            const episodeName = /第\d+集/.test(rawFileName) ? rawFileName : (rawFileName || ep.name);
                            episodes.push({
                                name: episodeName,
                                playId: buildPanEpisodePlayId(normalizeShareUrl(shareUrl), fileId, {
                                    mode: "pan-file",
                                    shareUrl: normalizeShareUrl(shareUrl),
                                    fileId,
                                    flag: sourceName,
                                    name: episodeName,
                                    vodName: name,
                                    vodId: videoId
                                })
                            });
                        }
                        logInfo("detail UC 网盘通过采集线路解析成功", { sourceName, href, shareUrl, episodeCount: videoList.length });
                        found = true;
                        break;
                    } else {
                        logInfo("detail UC 网盘通过采集线路解析无文件", { sourceName, href, shareUrl });
                    }
                }
                if (!found) {
                    logInfo("detail UC 网盘未能提取有效分享链接", { sourceName, href });
                }
            }
            if (episodes.length) {
                netdiskSources.push({ name: sourceName, episodes });
            } else {
                logInfo("detail UC 网盘解析失败，已排除", { sourceName });
            }
        }
        const collectSources = allCollectSources.filter((source) => {
            const normName = normalizePanSourceName(source?.name || "");
            // 已经在 netdiskSources 中的（已展开）
            if (parsedNetdiskSourceNames.has(normName)) return false;
            // 已经在 UC 处理后加入 netdiskSources 的也排除
            if (netdiskSources.some((s) => normalizePanSourceName(s.name) === normName)) return false;
            return true;
        });
        if (allCollectSources.length !== collectSources.length) {
            logInfo("detail 移除未展开或不支持的网盘线路", {
                videoId,
                removed: allCollectSources.length - collectSources.length,
                parsedNetdiskSources: Array.from(parsedNetdiskSourceNames).join(" | ")
            });
        }
        const sortedNetdiskSources = sortPlaySourcesByDriveOrder(netdiskSources);
        const expandedNetdiskSources = expandPanSourcesWithRoutes(sortedNetdiskSources, context?.from || "web");


        // --------- Unified scraping logic (replace previous per-source buckets) ---------
        // 1️⃣ 把所有已经展开的网盘线路（netdiskSources）和普通采集线路（collectSources）统一放进 allSources
        const allSources = [];
        // 2️⃣ 为每条 episode 计算唯一的 fid（shareUrl|fileId），并收集成一次性刮削候选列表
        const scrapeCandidates = [];
        // ---- 处理已展开的网盘线路 ----
        for (const src of netdiskSources) {
            if (Array.isArray(src?.episodes) && src.episodes.length) {
                src.episodes = src.episodes.map((ep) => {
                    const meta = decodeCombinedPlayId(ep.playId || "")?.meta || {};
                    const shareUrl = String(meta.shareUrl || meta.shareURL || "").trim();
                    const fileId = String(meta.fileId || meta.fid || "").trim();
                    const fid = shareUrl && fileId ? `${shareUrl}|${fileId}` : (fileId || ep.playId);
                    ep._fid = fid;
                    return ep;
                });
                allSources.push(src);
                for (const ep of src.episodes) {
                    if (!ep._fid) continue;
                    scrapeCandidates.push({
                        fid: ep._fid,
                        file_id: ep._fid,
                        file_name: ep.name || "正片",
                        name: ep.name || "正片",
                        format_type: "video",
                    });
                }
            }
        }
        // ---- 处理普通采集线路（如果有展开文件） ----
        for (const src of collectSources) {
            if (Array.isArray(src?.episodes) && src.episodes.length) {
                src.episodes = src.episodes.map((ep) => {
                    const meta = decodeCombinedPlayId(ep.playId || "")?.meta || {};
                    const shareUrl = String(meta.shareUrl || meta.shareURL || "").trim();
                    const fileId = String(meta.fileId || meta.fid || "").trim();
                    const fid = shareUrl && fileId ? `${shareUrl}|${fileId}` : (fileId || ep.playId);
                    ep._fid = fid;
                    return ep;
                });
                allSources.push(src);
                for (const ep of src.episodes) {
                    if (!ep._fid) continue;
                    scrapeCandidates.push({
                        fid: ep._fid,
                        file_id: ep._fid,
                        file_name: ep.name || "正片",
                        name: ep.name || "正片",
                        format_type: "video",
                    });
                }
            }
        }
        logInfo("detail 刮削候选", {
            videoId,
            count: scrapeCandidates.length,
            preview: scrapeCandidates.slice(0, 3).map((i) => `${String(i.fid || "").split("|").slice(-1)[0] || "unknown"}=>${i.file_name}`).join(" | ")
        });
        // --------- 一次统一刮削 ---------
        let scrapeData = null;
        let videoMappings = [];
        if (scrapeCandidates.length) {
            const keyword = normalizeText(name || "");
            try {
                await OmniBox.processScraping(videoId, keyword, keyword, scrapeCandidates);
                const metadata = await OmniBox.getScrapeMetadata(videoId);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
                logInfo("detail 刮削完成", { videoId, keyword, mappings: videoMappings.length });
            } catch (e) {
                logInfo("detail 刮削失败", { videoId, error: e.message });
            }
        } else {
            logInfo("detail 刮削候选为空，跳过刮削", { videoId });
        }
        // --------- 将刮削映射回填到每条 episode 上，并在回填后按集数排序 ---------
        const mappingMap = new Map();
        for (const mapping of videoMappings) {
            if (!mapping || typeof mapping !== "object") continue;
            const keys = [mapping.fileId, mapping.file_id, mapping.fid]
                .map((item) => String(item || "").trim())
                .filter(Boolean);
            for (const key of keys) {
                if (!mappingMap.has(key)) {
                    mappingMap.set(key, mapping);
                }
            }
        }
        for (const src of allSources) {
            for (const ep of src.episodes || []) {
                const fid = String(ep?._fid || "").trim();
                if (!fid) continue;
                const mapping = mappingMap.get(fid);
                const fidLog = fid.split("|").slice(-1)[0] || fid;
                if (!mapping) {
                    logInfo("detail 分集未命中刮削映射", { fid: fidLog, episodeName: ep.name });
                    continue;
                }
                const oldName = ep.name || "";
                const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                if (newName && newName !== oldName) {
                    ep.name = newName;
                    logInfo("detail 应用刮削分集名", { fid: fidLog, from: oldName, to: newName });
                }
                const decoded = decodeCombinedPlayId(ep.playId || "");
                const meta = decoded?.meta || {};
                meta.fid = fid;
                meta.e = ep.name;
                meta.sid = meta.sid || videoId;
                meta.vodId = meta.vodId || videoId;
                meta.vodName = meta.vodName || name;
                if (mapping.seasonNumber !== undefined && mapping.seasonNumber !== null) meta.s = mapping.seasonNumber;
                if (mapping.episodeNumber !== undefined && mapping.episodeNumber !== null) meta.n = mapping.episodeNumber;
                ep.playId = `${decoded?.main || ""}|||${encodePlayId(meta)}`;
            }
            if (Array.isArray(src.episodes)) {
                src.episodes = sortEpisodesByMeta(src.episodes);
            }
        }

        // --------- 合并并去重所有来源 ---------
        const mergedPlaySourcesMap = new Map();
        for (const src of allSources) {
            const sourceName = String(src?.name || "").trim();
            if (!sourceName) continue;
            if (!mergedPlaySourcesMap.has(sourceName)) {
                mergedPlaySourcesMap.set(sourceName, { name: sourceName, episodes: [] });
            }
            const target = mergedPlaySourcesMap.get(sourceName);
            const seen = new Set(target.episodes.map((e) => e.playId));
            for (const ep of src.episodes || []) {
                if (!ep.playId || seen.has(ep.playId)) continue;
                target.episodes.push(ep);
                seen.add(ep.playId);
            }
            target.episodes = sortEpisodesByMeta(target.episodes);
        }
        const vod_play_sources = Array.from(mergedPlaySourcesMap.values()).filter((s) => s.episodes && s.episodes.length);

        // --------- 排序并展开线路（保持原有的 drive 排序、路由逻辑） ---------
        const sortedFinalPlaySources = sortPlaySourcesByDriveOrder(vod_play_sources);
        const expandedFinalPlaySources = expandPanSourcesWithRoutes(sortedFinalPlaySources, context?.from || "web");

        // --------- 刮削详情回填 ---------
        let finalName = name;
        let finalPoster = poster;
        let finalTypeName = typeName;
        let finalYear = year;
        let finalArea = area;
        let finalActor = actor;
        let finalDirector = director;
        let finalIntro = intro;
        let finalScore = score.replace(/分$/, "");
        const finalRemarks = stripTags(remarks);
        let finalVodClass = "";

        if (scrapeData && typeof scrapeData === "object") {
            if (scrapeData.title) {
                finalName = String(scrapeData.title).trim() || finalName;
            }
            if (scrapeData.posterPath) {
                finalPoster = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            }
            const releaseDate = String(scrapeData.releaseDate || scrapeData.release_date || scrapeData.firstAirDate || scrapeData.first_air_date || scrapeData.seasonAirYear || "").trim();
            if (releaseDate) {
                finalYear = releaseDate.slice(0, 4) || finalYear;
            }
            if (scrapeData.overview) {
                finalIntro = String(scrapeData.overview).trim() || finalIntro;
            }
            const voteAverage = Number(scrapeData.voteAverage ?? scrapeData.vote_average);
            if (Number.isFinite(voteAverage) && voteAverage > 0) {
                finalScore = voteAverage.toFixed(1);
            }
            const genreNames = Array.isArray(scrapeData.genres)
                ? scrapeData.genres.map((item) => item?.name).filter(Boolean)
                : [];
            if (genreNames.length) {
                finalTypeName = genreNames.join("/") || finalTypeName;
                finalVodClass = genreNames.join(",");
            }
            const actorNames = Array.isArray(scrapeData.credits?.cast)
                ? scrapeData.credits.cast.slice(0, 5).map((item) => item?.name || item?.character || "").filter(Boolean)
                : [];
            if (actorNames.length) {
                finalActor = actorNames.join(",");
            } else if (scrapeData.actors) {
                finalActor = String(scrapeData.actors).trim() || finalActor;
            }
            const directorNames = Array.isArray(scrapeData.credits?.crew)
                ? scrapeData.credits.crew
                    .filter((item) => item?.job === "Director" || item?.department === "Directing")
                    .slice(0, 3)
                    .map((item) => item?.name || "")
                    .filter(Boolean)
                : [];
            if (directorNames.length) {
                finalDirector = directorNames.join(",");
            } else if (scrapeData.director) {
                finalDirector = String(scrapeData.director).trim() || finalDirector;
            }
            const areaNames = [
                ...(Array.isArray(scrapeData.productionCountries) ? scrapeData.productionCountries.map((item) => item?.name) : []),
                ...(Array.isArray(scrapeData.originCountry) ? scrapeData.originCountry : []),
                ...(Array.isArray(scrapeData.origin_country) ? scrapeData.origin_country : []),
            ].map((item) => String(item || "").trim()).filter(Boolean);
            if (areaNames.length) {
                finalArea = Array.from(new Set(areaNames)).slice(0, 3).join("/");
            }
        }

        // --------- 构建最终返回结构（不再使用 _play_sources_for_scrape） ---------
        const result = {
            list: [{
                vod_id: videoId,
                vod_name: finalName,
                vod_pic: finalPoster,
                type_name: finalTypeName,
                vod_class: finalVodClass,
                vod_year: finalYear,
                vod_area: finalArea,
                vod_actor: finalActor,
                vod_director: finalDirector,
                vod_content: finalIntro,
                vod_douban_score: finalScore,
                vod_remarks: finalRemarks,
                vod_play_sources: expandedFinalPlaySources
            }]
        };
        const vod = result.list?.[0];
        if (vod) {
            Object.assign(vod, buildLegacyPlayFields(vod.vod_play_sources || []));
        }
        logInfo("detail 完成", {
            videoId,
            sourceCount: vod_play_sources.length,
            episodeCount: vod_play_sources.reduce((n, item) => n + item.episodes.length, 0),
            scraped: !!scrapeData,
            actor: finalActor,
            director: finalDirector
        });
        return result;
    } catch (error) {
        logError("detail 失败", error);
        return { list: [] };
    }
}

async function search(params, context) {
    const keyword = String(params?.keyword || "").trim();
    const page = Number(params?.page || 1);
    if (!keyword) return emptyPage(page);
    try {
        const path = buildSearchPath(keyword, page);
        logInfo("search 请求", { keyword, page, host: getCurrentHost(), path, quick: params?.quick ? 1 : 0, from: context?.from || "web" });
        const html = await fetchHtml(path, { ttl: SEARCH_CACHE_TTL });
        const list = parseVodList(html);
        const pagecount = list.length === DEFAULT_PAGE_SIZE ? page + 1 : page;
        logInfo("search 完成", { keyword, page, listCount: list.length, pagecount });
        return {
            page,
            pagecount,
            total: list.length + (pagecount > page ? DEFAULT_PAGE_SIZE : 0),
            limit: DEFAULT_PAGE_SIZE,
            list
        };
    } catch (error) {
        logError("search 失败", error);
        return emptyPage(page);
    }
}

async function play(params, context) {
    const flag = String(params?.flag || "LIBVIO");
    const playId = String(params?.playId || "").trim();
    if (!playId) return emptyPlay(flag);
    try {
        const { main: rawPlayId, meta } = decodeCombinedPlayId(playId);
        const playPageUrl = resolveCollectPlayPageUrl(rawPlayId, meta);
        const playFlag = String(meta.flag || flag || "LIBVIO");
        if (!playPageUrl) {
            logInfo("play 无法解析播放页地址", { rawPlayId, flag: playFlag, meta });
            return emptyPlay(playFlag);
        }

        if (meta.mode === "pan-file") {
            const shareURL = normalizeShareUrl(meta.shareUrl || "");
            const fileId = String(meta.fileId || "");
            const routeType = String(meta.routeType || "").trim() || (context?.from === "web" ? "服务端代理" : "直连");
            if (shareURL && fileId) {
                const playInfoPromise = OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);
                const metadataPromise = (async () => {
                    const result = {
                        danmakuList: [],
                        scrapeTitle: "",
                        episodeName: meta?.name || meta?.e || "",
                    };
                    if (!meta?.fid || typeof OmniBox.getScrapeMetadata !== "function") {
                        logInfo("play 网盘增强链路跳过", { shareURL, fid: meta?.fid || "" });
                        return result;
                    }
                    try {
                        const metadata = await OmniBox.getScrapeMetadata(String(meta.sid || meta.vodId || ""));
                        if (!metadata || !metadata.scrapeData) {
                            logInfo("play 网盘增强链路跳过: metadata 不完整", { shareURL, vodId: meta.sid || meta.vodId || "" });
                            return result;
                        }
                        result.scrapeTitle = metadata.scrapeData.title || "";
                        const mappings = Array.isArray(metadata.videoMappings) ? metadata.videoMappings : [];
                        const mapping = mappings.find((item) => item?.fileId === meta.fid);
                        if (mapping) {
                            result.episodeName = buildScrapedEpisodeName(metadata.scrapeData, mapping, result.episodeName || meta.name || "");
                        }
                        const fileName = buildDanmakuFileName(result.scrapeTitle || meta.vodName || "", result.episodeName || meta.name || "");
                        if (fileName && typeof OmniBox.getDanmakuByFileName === "function") {
                            const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
                            if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) {
                                result.danmakuList = matchedDanmaku;
                            }
                            logInfo("play 网盘弹幕匹配", { fileName, count: Array.isArray(matchedDanmaku) ? matchedDanmaku.length : 0 });
                        }
                    } catch (error) {
                        logInfo("play 网盘增强链路失败", { shareURL, error: error.message });
                    }
                    return result;
                })();
                const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);
                if (playInfoResult.status === "fulfilled") {
                    const playInfo = playInfoResult.value || {};
                    const urlList = Array.isArray(playInfo?.url) ? playInfo.url : [];
                    const metadataValue = metadataResult.status === "fulfilled" ? metadataResult.value : {};
                    const danmakuList = metadataValue?.danmakuList?.length ? metadataValue.danmakuList : (playInfo?.danmaku || []);
                    return {
                        urls: urlList.map((item) => ({ name: item.name || meta.name || "播放", url: item.url })),
                        header: playInfo?.header || {},
                        parse: 0,
                        danmaku: danmakuList};
                }
                logInfo("play 网盘直取失败", { shareURL, fileId, routeType, error: playInfoResult.reason?.message || String(playInfoResult.reason || "") });
                return {
                    parse: 0,
                    urls: [{ name: meta.name || "网盘资源", url: `push://${shareURL}` }]
                };
            }
        }

        const sniffHeaders = {
            Referer: `${getCurrentHost()}/`,
            Origin: getCurrentHost(),
            "User-Agent": UA
        };
        const playInfoPromise = (async () => {
            const cacheKey = buildCacheKey("libvio:play", playPageUrl, playFlag, context?.from || "web");
            return await getCachedJson(cacheKey, PLAY_CACHE_TTL, async () => {
                logInfo("play 请求", { playPageUrl, flag: playFlag, from: context?.from || "web" });
                const html = await fetchHtml(playPageUrl, { ttl: PLAY_CACHE_TTL });
                const playerJson = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})<\/script>/)?.[1];
                if (!playerJson) {
                    logInfo("play 未找到 player_aaaa", { playPageUrl });
                    return {
                        parse: 1,
                        header: sniffHeaders,
                        urls: [{ name: meta.name || "播放", url: playPageUrl }],
                        danmaku: []
                    };
                }

                const player = JSON.parse(playerJson);
                const realUrl = buildPlayUrl(decodePlayerUrl(player.url, player.encrypt));
                if (realUrl && isDirectMediaUrl(realUrl)) {
                    logInfo("play 直链完成", { playPageUrl, from: player.from, finalUrl: realUrl });
                    return {
                        parse: 0,
                        header: sniffHeaders,
                        urls: [{ name: meta.name || "播放", url: realUrl }],
                        danmaku: []
                    };
                }

                const iframeUrl = buildProviderIframeUrl(player);
                const sniffTarget = iframeUrl || playPageUrl;
                try {
                    const sniffResult = await OmniBox.sniffVideo(sniffTarget, sniffHeaders);
                    const sniffUrls = Array.isArray(sniffResult?.urls) ? sniffResult.urls.filter((item) => item?.url) : [];
                    if (!sniffUrls.length && sniffResult?.url) {
                        sniffUrls.push({ name: meta.name || "播放", url: sniffResult.url });
                    }
                    if (sniffUrls.length) {
                        logInfo("play SDK嗅探完成", { playPageUrl, from: player.from, sniffTarget, sniffCount: sniffUrls.length, first: sniffUrls[0] || null });
                        return {
                            parse: 0,
                            header: sniffResult?.header || sniffHeaders,
                            urls: sniffUrls.map((item) => ({ name: item.name || meta.name || "播放", url: item.url })),
                            danmaku: sniffResult?.danmaku || []
                        };
                    }
                    logInfo("play SDK嗅探无结果", { playPageUrl, from: player.from, sniffTarget, sniffResult: sniffResult || null });
                } catch (sniffError) {
                    logInfo("play SDK嗅探失败", { playPageUrl, from: player.from, sniffTarget, error: sniffError.message });
                }

                logInfo("play 使用嗅探兜底", { playPageUrl, decodedUrl: realUrl, iframeUrl, sniffTarget });
                return {
                    parse: 1,
                    header: sniffHeaders,
                    urls: [{ name: meta.name || "播放", url: sniffTarget }],
                    danmaku: []
                };
            });
        })();

        const metadataPromise = (async () => {
            const result = {
                danmakuList: [],
                scrapeTitle: "",
                episodeName: meta?.e || meta?.name || "",
            };
            if (!meta?.fid || !meta?.sid || typeof OmniBox.getScrapeMetadata !== "function") {
                logInfo("play 播放增强链路跳过", { fid: meta?.fid || "", sid: meta?.sid || "" });
                return result;
            }
            try {
                const metadata = await OmniBox.getScrapeMetadata(String(meta.sid || ""));
                if (!metadata || !metadata.scrapeData) {
                    logInfo("play 播放增强链路跳过: metadata 不完整", { videoId: meta.sid || "" });
                    return result;
                }
                result.scrapeTitle = metadata.scrapeData.title || "";
                const mappings = Array.isArray(metadata.videoMappings) ? metadata.videoMappings : [];
                logInfo("play 播放增强元数据", { videoId: meta.sid || "", mappings: mappings.length, fid: meta.fid });
                const mapping = mappings.find((item) => item?.fileId === meta.fid);
                if (mapping) {
                    result.episodeName = buildScrapedEpisodeName(metadata.scrapeData, mapping, result.episodeName || meta.name || "");
                } else if (mappings.length > 0) {
                    logInfo("play 播放增强未命中 mapping", { expected: meta.fid, preview: mappings.slice(0, 2).map((item) => `${item?.fileId || "<empty>"}=>${item?.episodeName || ""}`).join(" | ") });
                }
                const fileName = buildDanmakuFileName(result.scrapeTitle || meta.v || "", result.episodeName || meta.name || "");
                if (fileName && typeof OmniBox.getDanmakuByFileName === "function") {
                    const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
                    const count = Array.isArray(matchedDanmaku) ? matchedDanmaku.length : 0;
                    logInfo("play 弹幕匹配", { fileName, count });
                    if (count > 0) {
                        result.danmakuList = matchedDanmaku;
                    }
                }
            } catch (error) {
                logInfo("play 读取刮削元数据失败", { error: error.message, videoId: meta.sid || "" });
            }
            return result;
        })();

        const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);
        if (playInfoResult.status !== "fulfilled") {
            throw playInfoResult.reason || new Error("播放主链路失败");
        }
        const playResult = playInfoResult.value || { urls: [], parse: 0, header: {} };
        let danmakuList = [];
        if (metadataResult.status === "fulfilled" && metadataResult.value) {
            danmakuList = metadataResult.value.danmakuList || [];
        } else if (metadataResult.status === "rejected") {
            logInfo("play 播放增强链路失败(不影响播放)", { error: metadataResult.reason?.message || String(metadataResult.reason || "") });
        }
        if (danmakuList.length > 0) {
            playResult.danmaku = danmakuList;
        }
        return playResult;
    } catch (error) {
        logError("play 失败", error);
        return emptyPlay(flag);
    }
}
