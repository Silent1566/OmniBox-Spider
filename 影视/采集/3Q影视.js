// @name 3Q影视
// @author W.Q, @wujiwanmei, @lucky_TJQ, tcxp, @shortai, 梦
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, crypto
// @version 1.1.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/3Q影视.js

/**
 * ============================================================================
 * 多多追剧 (https://duoduozhuiju.com/ 发布页)
 * 刮削：支持
 * 弹幕：支持
 * 嗅探：支持
 * 
 * 特色功能：
 * - WASM Protobuf 解码加密播放地址
 * - 支持站内蓝光线路 + 站外聚合线路
 * - 完整的筛选器配置（类型/地区/年份）
 * - 集成 TMDB 刮削元数据
 * - 自动匹配弹幕
 * ============================================================================
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const DUODUO_RELEASE_URL = 'https://duoduozhuiju.com';
const HOST_CANDIDATES = ['https://dduotv01.top', 'https://323433ssdfd.top', 'https://xds2435u23422342342u.top'];
const HOST_CACHE_KEY = 'duoduo:active_host';
const HOST_CACHE_TTL = 60 * 60 * 24 * 30;
const HOST_PROBE_TIMEOUT = 8000;
let ACTIVE_HOST = HOST_CANDIDATES[0];
let ensureActiveHostPromise = null;

const config = {
    wasmCacheFile: 'duoduo.wasm',
    headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'X-Client': '8f3d2a1c7b6e5d4c9a0b1f2e3d4c5b6a',
        'web-sign': 'ddtvf65f3a83d6d9ad6f',
        'accept-language': 'zh-CN,zh;q=0.9'
    }
};

// 弹幕 API 地址(优先使用环境变量)
const DANMU_API = process.env.DANMU_API || "";

// HTTP 客户端实例
const _http = axios.create({
    timeout: 15 * 1000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true }),
});

// 播放请求头
const PLAY_HEADERS = {
    "User-Agent": UA,
    "Referer": `${ACTIVE_HOST}/`,
    "Origin": ACTIVE_HOST
};

const normalizeHost = (url = "") => {
    const value = String(url || "").trim();
    if (!value) return "";
    const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
        const target = new URL(withProtocol);
        return `${target.protocol}//${target.host}`;
    } catch {
        return withProtocol.replace(/\/+$/, "");
    }
};

const isHttpUrl = (u) => u && (u.startsWith('http://') || u.startsWith('https://'));
const needsParser = (u) => /(iqiyi\.com|v\.qq\.com|youku\.com|mgtv\.com|bilibili\.com)/.test(String(u || ""));
const isDirectPlayable = (u) => /\.(m3u8|mp4|flv|avi|mkv|ts)(?:\?|#|$)/i.test(String(u || ""));
const shouldAppendSourceCode = (code, name) => {
    const sourceCode = String(code || "").trim();
    const sourceName = String(name || "").trim();
    if (!sourceCode) return false;
    if (!sourceName) return true;
    if (sourceCode.toLowerCase().startsWith("site")) return false;
    return sourceCode.toLowerCase() !== sourceName.toLowerCase();
};
const buildLineDisplayName = (name, code) => {
    const sourceName = String(name || "").trim() || String(code || "").trim() || "多多追剧";
    const sourceCode = String(code || "").trim();
    if (shouldAppendSourceCode(sourceCode, sourceName)) {
        return `${sourceName} (${sourceCode})`;
    }
    return sourceName;
};

async function requestTextAbsolute(url, options = {}) {
    const response = await _http.get(url, {
        timeout: options.timeout || HOST_PROBE_TIMEOUT,
        headers: options.headers || {},
        maxRedirects: options.maxRedirects || 3,
        responseType: options.responseType
    });
    return response.data;
}

async function fetchReleaseHosts() {
    const releaseHost = normalizeHost(DUODUO_RELEASE_URL);
    const found = [];
    const pushHost = (value) => {
        const normalized = normalizeHost(value);
        if (!normalized) return;
        const host = new URL(normalized).host;
        if (host === new URL(releaseHost).host) return;
        if (/duoduozhuiju\.com$|dduotv01\.top$|umm\.dduotv01\.top$/i.test(host)) return;
        found.push(normalized);
    };

    let html = "";
    try {
        html = await requestTextAbsolute(`${releaseHost}/`, {
            timeout: HOST_PROBE_TIMEOUT,
            hostForHeaders: releaseHost
        });
    } catch (error) {
        logInfo('读取发布页域名失败', { release: DUODUO_RELEASE_URL, error: error.message });
        return [];
    }

    const scriptSrcs = [...String(html).matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map((m) => m[1]);
    const configSrc = scriptSrcs.find((src) => /(?:^|\/)config(?:\.min)?\.js(?:[?#]|$)/i.test(src));
    if (configSrc) {
        const configUrl = configSrc.startsWith('http') ? configSrc : `${releaseHost}/${configSrc.replace(/^\/+/, '')}`;
        try {
            const configText = await requestTextAbsolute(configUrl, {
                timeout: HOST_PROBE_TIMEOUT,
                hostForHeaders: releaseHost
            });
            const hostRegex = /(?:host|domain)\s*:\s*['"]([^'"]+)['"]|lines\s*:\s*\[([\s\S]*?)\]/gi;
            let match;
            while ((match = hostRegex.exec(configText))) {
                pushHost(match[1] || "");
                (String(match[2] || '').match(/host\s*:\s*['"]([^'"]+)['"]/gi) || [])
                    .forEach((item) => pushHost(item.replace(/^.*host\s*:\s*['"]([^'"]+)['"].*$/i, '$1')));
            }
        } catch (error) {
            logInfo('发布页 config.js 获取失败', { url: configUrl, error: error.message });
        }
    }

    const domainRegex = /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?::\d+)?/g;
    const hrefRegex = /href=["']([^"']+)["']/g;
    let match;
    while ((match = domainRegex.exec(html))) pushHost(match[0]);
    while ((match = hrefRegex.exec(html))) {
        const href = String(match[1] || '').trim();
        if (/^https?:\/\//i.test(href)) pushHost(href);
    }

    const unique = found.filter((item, index, arr) => arr.indexOf(item) === index);
    logInfo('发布页候选域名', { count: unique.length, hosts: unique.slice(0, 12) });
    return unique;
}

async function probeHost(host) {
    try {
        const text = await requestTextAbsolute(`${host}/api.php/web/index/home`, {
            timeout: HOST_PROBE_TIMEOUT,
            hostForHeaders: host,
            headers: config.headers
        });
        const json = typeof text === 'string' ? JSON.parse(text) : text;
        if (json && json.data) return true;
        logInfo('域名探测返回非 JSON', { host });
        return false;
    } catch (error) {
        logInfo('域名探测失败', { host, error: error.message });
        return false;
    }
}

async function readActiveHostCache() {
    try {
        const cached = await OmniBox.getCache(HOST_CACHE_KEY);
        const normalized = normalizeHost(cached || "");
        if (normalized) {
            logInfo('命中域名缓存', { host: normalized });
            return normalized;
        }
    } catch (error) {
        logInfo('读取域名缓存失败', { error: error.message });
    }
    return "";
}

async function saveActiveHostCache(host) {
    const normalized = normalizeHost(host);
    if (!normalized) return;
    try {
        await OmniBox.setCache(HOST_CACHE_KEY, normalized, HOST_CACHE_TTL);
        logInfo('写入域名缓存', { host: normalized });
    } catch (error) {
        logInfo('写入域名缓存失败', { host: normalized, error: error.message });
    }
}

async function ensureActiveHost(preferredHost = "") {
    if (ensureActiveHostPromise) return ensureActiveHostPromise;
    ensureActiveHostPromise = (async () => {
        const preferred = normalizeHost(preferredHost);
        const cachedHost = await readActiveHostCache();
        const quickList = [preferred, cachedHost, getCurrentHost(), ...HOST_CANDIDATES]
            .filter(Boolean)
            .filter((item, index, arr) => arr.indexOf(item) === index);
        for (const host of quickList) {
            if (await probeHost(host)) {
                ACTIVE_HOST = host;
                await saveActiveHostCache(host);
                return ACTIVE_HOST;
            }
        }

        const releaseHosts = await fetchReleaseHosts();
        const ordered = [...releaseHosts, ...HOST_CANDIDATES]
            .filter(Boolean)
            .filter((item, index, arr) => arr.indexOf(item) === index);
        for (const host of ordered) {
            if (await probeHost(host)) {
                logInfo('发布页域名可用', { to: host });
                ACTIVE_HOST = host;
                await saveActiveHostCache(host);
                return ACTIVE_HOST;
            }
        }
        throw new Error(`未找到可用域名: ${[...quickList, ...ordered].join(', ')}`);
    })();
    try {
        return await ensureActiveHostPromise;
    } finally {
        ensureActiveHostPromise = null;
    }
}

function getCurrentHost() {
    return ACTIVE_HOST || HOST_CANDIDATES[0];
}

async function apiGet(url) {
    if (/^https?:\/\//i.test(url)) {
        const response = await _http.get(url, { headers: { ...config.headers, referer: `${getCurrentHost()}/` } });
        if (response?.data?.code === 408) {
            response.data = { code: 200, msg: response.data.msg || 'success', data: [] };
        }
        return response;
    }

    let lastError = null;
    for (const host of [getCurrentHost(), ...HOST_CANDIDATES]) {
        try {
            ACTIVE_HOST = normalizeHost(host);
            await ensureActiveHost(ACTIVE_HOST);
            const target = url.startsWith('/') ? `${ACTIVE_HOST}${url}` : `${ACTIVE_HOST}/${url}`;
            const response = await _http.get(target, { headers: { ...config.headers, referer: `${ACTIVE_HOST}/` } });
            if (response?.data?.code === 408) {
                response.data = { code: 200, msg: response.data.msg || 'success', data: [] };
            }
            return response;
        } catch (error) {
            lastError = error;
            logInfo('候选域名请求失败', { host, url, error: error.message });
        }
    }
    throw lastError || new Error(`请求失败: ${url}`);
}

async function sniffPlayUrl(playUrl) {
    try {
        const sniffed = await OmniBox.sniffVideo(playUrl);
        if (sniffed && sniffed.url) {
            return {
                url: sniffed.url,
                header: sniffed.header || PLAY_HEADERS,
            };
        }
    } catch (error) {
        logInfo(`嗅探失败，回退原始地址: ${error.message}`);
    }
    return null;
}

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[多多追剧] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[多多追剧] ${message}: ${error.message || error}`);
};

/**
 * 编码/解码元数据（用于透传参数）
 */
const encodeMeta = (obj) => {
    try {
        return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
    } catch {
        return "";
    }
};

const decodeMeta = (str) => {
    try {
        const raw = Buffer.from(str || "", "base64").toString("utf8");
        return JSON.parse(raw || "{}");
    } catch {
        return {};
    }
};

/**
 * Promise 超时包装，避免接口长时间阻塞
 * @param {Promise<any>} promise - 原始 Promise
 * @param {number} ms - 超时时间（毫秒）
 * @param {string} label - 超时标签
 * @returns {Promise<any>}
 */
const withTimeout = (promise, ms, label = "operation") =>
    Promise.race([
        promise,
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
        }),
    ]);

// ========== 筛选器配置 ==========

/**
 * 动态生成年份筛选器
 * @param {string} typeName - 分类名称（电影/剧集/动漫/综艺）
 * @returns {Array} 年份选项数组
 */
const generateYears = (typeName) => {
    const currentYear = new Date().getFullYear();
    const years = [{ "name": "全部", "value": "" }];

    if (typeName === '电影') {
        // 电影：当前年份到2016年，然后是年代区间
        for (let y = currentYear; y >= 2016; y--) {
            years.push({ "name": String(y), "value": String(y) });
        }
        ['2015-2011', '2010-2000', '90年代', '80年代', '更早'].forEach(i => {
            years.push({ "name": i, "value": i });
        });
    } else if (typeName === '剧集') {
        // 剧集：当前年份到2021年，然后是年代区间
        for (let y = currentYear; y >= 2021; y--) {
            years.push({ "name": String(y), "value": String(y) });
        }
        ['2020-2016', '2015-2011', '2010-2000', '更早'].forEach(i => {
            years.push({ "name": i, "value": i });
        });
    } else {
        // 动漫/综艺：当前年份到2011年
        for (let y = currentYear; y >= 2011; y--) {
            years.push({ "name": String(y), "value": String(y) });
        }
        years.push({ "name": "更早", "value": "更早" });
    }

    return years;
};

/**
 * 筛选器数据配置
 * 包含电影、剧集、动漫、综艺的类型、地区、年份筛选
 */
const filterData = {
    "电影": [
        {
            "key": "class",
            "name": "类型",
            "value": [
                { "name": "全部", "value": "" },
                ...["动作", "喜剧", "爱情", "科幻", "恐怖", "悬疑", "犯罪", "战争", "动画", "冒险", "历史", "灾难", "纪录", "剧情"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "area",
            "name": "地区",
            "value": [
                { "name": "全部", "value": "" },
                ...["大陆", "香港", "台湾", "美国", "日本", "韩国", "泰国", "印度", "英国", "法国", "德国", "加拿大", "西班牙", "意大利", "澳大利亚"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "year",
            "name": "年份",
            "value": generateYears('电影')
        }
    ],
    "剧集": [
        {
            "key": "class",
            "name": "类型",
            "value": [
                { "name": "全部", "value": "" },
                ...["爱情", "古装", "武侠", "历史", "家庭", "喜剧", "悬疑", "犯罪", "战争", "奇幻", "科幻", "恐怖"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "area",
            "name": "地区",
            "value": [
                { "name": "全部", "value": "" },
                ...["大陆", "香港", "台湾", "美国", "日本", "韩国", "泰国", "英国"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "year",
            "name": "年份",
            "value": generateYears('剧集')
        }
    ],
    "动漫": [
        {
            "key": "class",
            "name": "类型",
            "value": [
                { "name": "全部", "value": "" },
                ...["冒险", "奇幻", "科幻", "武侠", "悬疑"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "area",
            "name": "地区",
            "value": [
                { "name": "全部", "value": "" },
                ...["大陆", "日本", "欧美"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "year",
            "name": "年份",
            "value": generateYears('动漫')
        }
    ],
    "综艺": [
        {
            "key": "class",
            "name": "类型",
            "value": [
                { "name": "全部", "value": "" },
                ...["真人秀", "音乐", "脱口秀", "歌舞", "爱情"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "area",
            "name": "地区",
            "value": [
                { "name": "全部", "value": "" },
                ...["大陆", "香港", "台湾", "美国", "日本", "韩国"].map(i => ({ "name": i, "value": i }))
            ]
        },
        {
            "key": "year",
            "name": "年份",
            "value": generateYears('综艺')
        }
    ]
};

/**
 * 画质优先级配置
 * 用于多线路排序，优先显示高画质线路
 */
const QUALITY_PRIORITY = [
    { keywords: ['8K', '8k'], score: 200 },
    { keywords: ['4K', '4k', '超清4K'], score: 190 },
    { keywords: ['蓝光4K', '蓝光HDR'], score: 180 },
    { keywords: ['AE', '蓝光'], score: 170 },
    { keywords: ['1080P蓝光', '1080PHDR'], score: 160 },
    { keywords: ['1080P', '1080p', '超清'], score: 150 },
    { keywords: ['720P', '720p', '高清'], score: 140 },
    { keywords: ['480P', '480p', '标清'], score: 130 },
    { keywords: ['360P', '360p', '流畅'], score: 120 }
];

/**
 * 计算线路画质评分
 * @param {string} showCode - 线路代码
 * @param {string} lineName - 线路名称
 * @returns {number} 画质评分
 */
const calculateQualityScore = (showCode, lineName) => {
    const fullText = `${showCode}${lineName}`.toLowerCase();
    for (const rule of QUALITY_PRIORITY) {
        if (rule.keywords.some(k => fullText.includes(k.toLowerCase()))) {
            return rule.score;
        }
    }
    return 50; // 默认评分
};

/**
 * 转换视频数据为标准格式
 * @param {Array} arr - 原始视频数据数组
 * @returns {Array} 标准化后的视频数组
 */
const json2vods = (arr) => (arr || []).map(i => ({
    vod_id: i.vod_id.toString(),
    vod_name: i.vod_name,
    vod_pic: i.vod_pic,
    vod_remarks: i.vod_remarks,
    type_name: i.vod_class ? `${i.type_name},${i.vod_class}` : i.type_name,
    vod_year: i.vod_year.toString()
}));

// ============================================================
// WASM 解码模块 - 用于解密多多追剧加密播放地址
// 该模块使用 Protobuf + WASM 技术解码加密的视频 URL
// ============================================================

let wasmModule = null;
let wasmMemView = null;
let wasmD = 0;
const wasmTextEnc = new TextEncoder();
const wasmTextDec = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
const wasmExtTable = new Map();
let wasmExtCounter = 4;

/**
 * 获取 WASM 内存视图
 */
function wasmGetMem() {
    if (!wasmMemView || wasmMemView.byteLength === 0)
        wasmMemView = new Uint8Array(wasmModule.exports.memory.buffer);
    return wasmMemView;
}

/**
 * 从 WASM 内存读取字节数组
 */
function wasmReadBytes(p, l) {
    return wasmGetMem().subarray(p >>> 0, (p >>> 0) + l);
}

/**
 * 从 WASM 内存读取字符串
 */
function wasmReadStr(p, l) {
    return wasmTextDec.decode(wasmGetMem().subarray(p >>> 0, (p >>> 0) + l));
}

/**
 * 向 WASM 内存写入字节数组
 */
function wasmWriteBytes(data, malloc) {
    const p = malloc(data.length, 1) >>> 0;
    wasmGetMem().set(data, p);
    wasmD = data.length;
    return p;
}

/**
 * 向 WASM 内存写入字符串
 */
function wasmWriteStr(s, malloc, realloc) {
    if (!realloc) {
        const e = wasmTextEnc.encode(s);
        const p = malloc(e.length, 1) >>> 0;
        wasmGetMem().subarray(p, p + e.length).set(e);
        wasmD = e.length;
        return p;
    }
    let n = s.length, p = malloc(n, 1) >>> 0;
    const m = wasmGetMem();
    let o = 0;
    for (; o < n; o++) {
        const c = s.charCodeAt(o);
        if (c > 127) break;
        m[p + o] = c;
    }
    if (o !== n) {
        const r = s.slice(o);
        p = realloc(p, n, n = o + r.length * 3, 1) >>> 0;
        const sub = wasmGetMem().subarray(p + o, p + n);
        const res = wasmTextEnc.encodeInto(r, sub);
        o += res.written;
        p = realloc(p, n, o, 1) >>> 0;
    }
    wasmD = o;
    return p;
}

/**
 * WASM 外部引用表管理
 */
function wasmExtAlloc(v) {
    const i = wasmExtCounter++;
    wasmExtTable.set(i, v);
    return i;
}

function wasmExtGet(i) {
    return wasmExtTable.get(i);
}

function wasmExtDealloc(i) {
    const v = wasmExtTable.get(i);
    wasmExtTable.delete(i);
    return v;
}

/**
 * WASM 异常捕获包装器
 */
function wasmTryCatch(fn, args) {
    try {
        return fn.apply(null, args);
    } catch (e) {
        wasmModule.exports.__wbindgen_exn_store(wasmExtAlloc(e));
    }
}

/**
 * 构建 WASM 导入对象
 * 包含所有 WASM 模块需要的 JavaScript 绑定函数
 */
function wasmBuildImports() {
    return {
        "./web_app_wasm_bg.js": {
            __wbg___wbindgen_is_function_0095a73b8b156f76: (e) => typeof wasmExtGet(e) === 'function',
            __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: (e) => { const r = wasmExtGet(e); return typeof r === 'object' && r !== null; },
            __wbg___wbindgen_is_string_cd444516edc5b180: (e) => typeof wasmExtGet(e) === 'string',
            __wbg___wbindgen_is_undefined_9e4d92534c42d778: (e) => wasmExtGet(e) === undefined,
            __wbg___wbindgen_throw_be289d5034ed271b: (e, r) => { throw new Error(wasmReadStr(e, r)); },
            __wbg_call_389efe28435a9388: function () { return wasmTryCatch((e, r) => wasmExtAlloc(wasmExtGet(e).call(wasmExtGet(r))), arguments); },
            __wbg_call_4708e0c13bdc8e95: function () { return wasmTryCatch((e, r, n) => wasmExtAlloc(wasmExtGet(e).call(wasmExtGet(r), wasmExtGet(n))), arguments); },
            __wbg_crypto_86f2631e91b51511: (e) => wasmExtAlloc(crypto),
            __wbg_getRandomValues_b3f15fcbfabb0f8b: function () { return wasmTryCatch((e, r) => { crypto.randomFillSync(wasmExtGet(r)); }, arguments); },
            __wbg_length_32ed9a279acd054c: (e) => wasmExtGet(e).length,
            __wbg_msCrypto_d562bbe83e0d4b91: (e) => 0,
            __wbg_new_no_args_1c7c842f08d00ebb: (e, r) => wasmExtAlloc(new Function(wasmReadStr(e, r))),
            __wbg_new_with_length_a2c39cbe88fd8ff1: (e) => wasmExtAlloc(new Uint8Array(e >>> 0)),
            __wbg_node_e1f24f89a7336c2e: (e) => wasmExtAlloc(process),
            __wbg_now_a3af9a2f4bbaa4d1: () => Date.now(),
            __wbg_process_3975fd6c72f520aa: (e) => wasmExtAlloc(process),
            __wbg_prototypesetcall_bdcdcc5842e4d77d: (e, r, n) => { wasmReadBytes(e, r).set(wasmExtGet(n)); },
            __wbg_randomFillSync_f8c153b79f285817: function () { return wasmTryCatch((e, r) => { crypto.randomFillSync(wasmExtGet(r)); }, arguments); },
            __wbg_require_b74f47fc2d022fd6: function () { return wasmTryCatch(() => wasmExtAlloc(require), arguments); },
            __wbg_static_accessor_GLOBAL_12837167ad935116: () => wasmExtAlloc(global),
            __wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f: () => wasmExtAlloc(globalThis),
            __wbg_static_accessor_SELF_a621d3dfbb60d0ce: () => 0,
            __wbg_static_accessor_WINDOW_f8727f0cf888e0bd: () => 0,
            __wbg_subarray_a96e1fef17ed23cb: (e, r, n) => wasmExtAlloc(wasmExtGet(e).subarray(r >>> 0, n >>> 0)),
            __wbg_versions_4e31226f5e8dc909: (e) => wasmExtAlloc(process.versions),
            __wbindgen_cast_0000000000000001: (e, r) => wasmExtAlloc(wasmReadBytes(e, r)),
            __wbindgen_cast_0000000000000002: (e, r) => wasmExtAlloc(wasmReadStr(e, r)),
            __wbindgen_init_externref_table: () => {
                const t = wasmModule.exports.__wbindgen_externrefs;
                if (t && t.grow) {
                    const b = t.grow(4);
                    t.set(0, undefined); t.set(b, undefined);
                    t.set(b + 1, null); t.set(b + 2, true); t.set(b + 3, false);
                }
            }
        }
    };
}

let wasmReady = false;
let wasmInitPromise = null;

/**
 * 初始化 WASM 解码模块
 * 尝试从本地加载或从远程下载 WASM 文件
 * @returns {Promise<boolean>} 初始化是否成功
 */
async function initWasm() {
    if (wasmReady) return true;
    if (wasmInitPromise) return wasmInitPromise;

    wasmInitPromise = (async () => {
        try {
            // 尝试多个可能的 WASM 文件路径
            const possiblePaths = [
                path.join(__dirname, config.wasmCacheFile),
                '/www/wwwroot/vodspider/vod/routes/duoduo.wasm',
                '/tmp/duoduo.wasm'
            ];

            let wasmBuf = null;

            // 尝试从本地加载
            for (const p of possiblePaths) {
                try {
                    wasmBuf = fs.readFileSync(p);
                    logInfo(`WASM 文件从本地加载: ${p}`);
                    break;
                } catch (e) { }
            }

            // 如果本地没有，从远程下载
            if (!wasmBuf) {
                logInfo('本地未找到 WASM 文件，开始从远程下载...');
                await ensureActiveHost();
                wasmBuf = Buffer.from(await requestTextAbsolute(
                    `${ACTIVE_HOST}/assets/web_app_wasm_bg-Bxwbrgev.wasm`,
                    { timeout: 30000, responseType: 'arraybuffer' }
                ));
                try {
                    fs.writeFileSync(path.join(__dirname, config.wasmCacheFile), wasmBuf);
                    logInfo('WASM 文件已缓存到本地');
                } catch (e) {
                    logError('WASM 文件缓存失败', e);
                }
            }

            // 实例化 WASM 模块
            const { instance } = await WebAssembly.instantiate(wasmBuf, wasmBuildImports());
            wasmModule = instance;
            wasmMemView = null;

            // 启动 WASM 模块
            if (wasmModule.exports.__wbindgen_start) {
                wasmModule.exports.__wbindgen_start();
            }

            wasmReady = true;
            logInfo('WASM 解码模块加载成功');
            return true;
        } catch (e) {
            logError('WASM 初始化失败', e);
            wasmInitPromise = null;
            return false;
        }
    })();

    return wasmInitPromise;
}

/**
 * 创建解码请求数据（Protobuf 格式）
 * @param {string} url - 加密的播放地址
 * @param {string} vodFrom - 线路代码
 * @returns {Uint8Array} Protobuf 编码的请求数据
 */
function wasmCreateDecodeRequest(url, vodFrom) {
    const e = wasmModule.exports;
    const up = wasmWriteStr(url, e.__wbindgen_malloc, e.__wbindgen_realloc);
    const ul = wasmD;
    const fp = wasmWriteStr(vodFrom, e.__wbindgen_malloc, e.__wbindgen_realloc);
    const fl = wasmD;
    const r = e.create_decode_request(up, ul, fp, fl);
    const data = wasmGetMem().slice(r[0], r[0] + r[1]);
    e.__wbindgen_free(r[0], r[1], 1);
    return new Uint8Array(data);
}

/**
 * 解析解码响应数据（Protobuf 格式）
 * @param {Buffer} body - 响应体数据
 * @returns {Object} 解码结果 { code, data, msg }
 */
function wasmParseDecodeResponse(body) {
    const e = wasmModule.exports;
    const bp = wasmWriteBytes(body, e.__wbindgen_malloc);
    const bl = wasmD;
    const r = e.parse_decode_response(bp, bl);

    if (r[2]) throw wasmExtDealloc(r[1]) || new Error('parse failed');

    const ptr = r[0];
    const code = e.decoderesult_code(ptr);
    const dd = e.decoderesult_data(ptr);
    const data = dd[0] ? wasmReadStr(dd[0], dd[1]) : '';
    const dm = e.decoderesult_msg(ptr);
    const msg = dm[0] ? wasmReadStr(dm[0], dm[1]) : '';
    e.__wbg_decoderesult_free(ptr, 0);

    return { code, data, msg };
}

/**
 * 获取签名请求头
 * 用于 Protobuf API 请求的身份验证
 * @returns {Object} 签名请求头对象
 */
function wasmGetSignatureHeaders() {
    const e = wasmModule.exports;
    const r = e.get_signature_headers();

    const aid = e.signatureheaders_aid(r);
    const aidStr = aid[0] ? wasmReadStr(aid[0], aid[1]) : '';

    const ave = e.signatureheaders_ave(r);
    const aveStr = ave[0] ? wasmReadStr(ave[0], ave[1]) : '';

    const nonc = e.signatureheaders_nonc(r);
    const noncStr = nonc[0] ? wasmReadStr(nonc[0], nonc[1]) : '';

    const sign = e.signatureheaders_sign(r);
    const signStr = sign[0] ? wasmReadStr(sign[0], sign[1]) : '';

    const time = e.signatureheaders_time(r);
    const timeStr = time[0] ? wasmReadStr(time[0], time[1]) : '';

    e.__wbg_signatureheaders_free(r, 0);

    return {
        'X-App-Id': aidStr,
        'X-App-Ve': aveStr,
        'X-Nonc': noncStr,
        'X-Sign': signStr,
        'X-Time': timeStr
    };
}

/**
 * 发送 Protobuf POST 请求
 * @param {string} url - 请求 URL
 * @param {Uint8Array} data - Protobuf 数据
 * @param {Object} extraHeaders - 额外的请求头
 * @returns {Promise<Object>} 响应对象 { status, body }
 */
async function postProtobuf(url, data, extraHeaders = {}) {
    await ensureActiveHost();
    const target = url.startsWith('/') ? `${ACTIVE_HOST}${url}` : `${ACTIVE_HOST}/${url}`;
    const response = await _http.post(target, Buffer.from(data), {
        timeout: 10000,
        headers: {
            'Content-Type': 'application/x-protobuf',
            'Accept': 'application/x-protobuf',
            'User-Agent': UA,
            'Referer': `${ACTIVE_HOST}/`,
            'Origin': ACTIVE_HOST,
            ...extraHeaders
        },
        responseType: 'arraybuffer'
    });
    return { status: response.status, body: Buffer.from(response.data || []) };
}

/**
 * API GET 请求（使用 X-Client + web-sign 认证）
 * @param {string} url - 请求 URL
 * @returns {Promise} axios 响应对象
 */
/**
 * 使用 WASM 解码加密的播放地址
 * @param {string} rawUrl - 加密的 URL
 * @param {string} vodFrom - 线路代码
 * @returns {Promise<string|null>} 解密后的真实播放地址
 */
async function decodeEncryptedUrl(rawUrl, vodFrom) {
    // 确保 WASM 模块已初始化
    if (!wasmReady) {
        const ok = await initWasm();
        if (!ok) {
            logError('WASM 模块未就绪', new Error('初始化失败'));
            return null;
        }
    }

    try {
        // 1. 创建解码请求数据
        const reqData = wasmCreateDecodeRequest(rawUrl, vodFrom);

        // 2. 获取签名请求头
        const sigHeaders = wasmGetSignatureHeaders();

        // 3. 发送 Protobuf 请求
        const resp = await postProtobuf(
            `/api.php/web/decode/url`,
            reqData,
            sigHeaders
        );

        // 4. 检查响应状态
        if (resp.status !== 200) {
            logError('解码请求失败', new Error(`HTTP ${resp.status}`));
            return null;
        }

        // 5. 解析响应数据
        const result = wasmParseDecodeResponse(new Uint8Array(resp.body));

        // 6. 验证解码结果
        if (result.code === 1 && result.data && result.data.startsWith('http')) {
            logInfo(`解码成功: ${vodFrom} -> ${result.data.substring(0, 80)}...`);
            return result.data;
        }

        logError('解码失败', new Error(`code=${result.code}, msg=${result.msg}`));
        return null;
    } catch (e) {
        logError('解码过程异常', e);
        return null;
    }
}

// ========== 刮削和弹幕辅助函数 ==========

/**
 * 预处理标题，去掉常见干扰项
 * @param {string} title - 原始标题
 * @returns {string} 清理后的标题
 */
function preprocessTitle(title) {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]|1280x720|1920x1080/g, " ")
        .replace(/[hH]\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

/**
 * 将中文数字转换为阿拉伯数字
 * @param {string} cn - 中文数字
 * @returns {number|string} 阿拉伯数字或原值
 */
function chineseToArabic(cn) {
    const map = {
        '零': 0, '一': 1, '二': 2, '三': 3, '四': 4,
        '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
    };
    if (!isNaN(cn)) return parseInt(cn);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
}

/**
 * 从标题中提取集数数字
 * @param {string} title - 集数标题
 * @returns {string} 提取的集数数字
 */
function extractEpisode(title) {
    if (!title) return "";

    const processedTitle = preprocessTitle(title).trim();

    // 1. S01E03 格式
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];

    // 2. 中文格式：第XX集/话
    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));

    // 3. EP/E 格式
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];

    // 4. 括号格式 [03]
    const bracketMatch = processedTitle.match(/[\[\(【（](\d{1,3})[\]\)】）]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        // 排除常见分辨率
        if (!["720", "1080", "480"].includes(num)) return num;
    }

    // 5. 独立的数字 (排除常见的视频参数)
    const standaloneMatches = processedTitle.match(/(?:^|[\s\-\._\[\]])(\d{1,3})(?![0-9pP])/g);
    if (standaloneMatches) {
        const candidates = standaloneMatches
            .map(m => m.match(/\d+/)[0])
            .filter(num => {
                const n = parseInt(num);
                return n > 0 && n < 300 && !["720", "480", "264", "265"].includes(num);
            });

        if (candidates.length > 0) {
            // 优先取 1-99 之间的
            const normalEp = candidates.find(n => parseInt(n) < 100);
            return normalEp || candidates[0];
        }
    }

    return "";
}

/**
 * 构建用于弹幕匹配的文件名
 * @param {string} vodName - 视频名称
 * @param {string} episodeTitle - 集数标题
 * @returns {string} 标准化的文件名
 */
function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";

    // 如果没有集数信息，直接返回视频名（电影）
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
        return vodName;
    }

    // 提取集数
    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            // 构建标准格式：视频名 S01E01
            if (epNum < 10) {
                return `${vodName} S01E0${epNum}`;
            } else {
                return `${vodName} S01E${epNum}`;
            }
        }
    }

    // 无法提取集数，返回视频名
    return vodName;
}

/**
 * 构建刮削后的集数名称
 * @param {Object} scrapeData - 刮削数据
 * @param {Object} mapping - 集数映射
 * @param {string} originalName - 原始名称
 * @returns {string} 刮削后的名称
 */
const buildScrapedEpisodeName = (scrapeData, mapping, originalName) => {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return originalName;
    }
    if (mapping.episodeName) {
        const epName = mapping.episodeNumber + "." + mapping.episodeName;
        return epName;
    }
    if (scrapeData && Array.isArray(scrapeData.episodes)) {
        const hit = scrapeData.episodes.find(
            (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
        );
        if (hit?.name) {
            return `${hit.episodeNumber}.${hit.name}`;
        }
    }
    return originalName;
};

/**
 * 从映射中提取文件ID（兼容不同字段名）
 * @param {Object} mapping - 刮削映射对象
 * @returns {string} 文件ID
 */
const getMappingFileId = (mapping) => {
    if (!mapping || typeof mapping !== "object") return "";
    return String(mapping.fileId || mapping.file_id || mapping.fid || "");
};

/**
 * 从 fid 提取集索引（sid#line#epIndex -> epIndex）
 * @param {string} fid - 文件ID
 * @returns {string} 集索引
 */
const getFidEpisodeIndex = (fid) => {
    const parts = String(fid || "").split("#");
    if (parts.length < 3) return "";
    return String(parts[parts.length - 1] || "");
};

/**
 * 规范化集数名称
 * @param {string} name - 集数名称
 * @returns {string} 规范化后的名称
 */
const normalizeEpisodeName = (name) => String(name || "").trim().toLowerCase();

/**
 * 根据 fid 查找刮削映射（兼容 fileId/file_id/fid）
 * @param {Array} videoMappings - 映射数组
 * @param {string} fid - 文件ID
 * @param {string} fallbackEpisodeName - 备用集数名
 * @returns {Object|null} 匹配到的映射
 */
const findMappingByFid = (videoMappings, fid, fallbackEpisodeName = "") => {
    const target = String(fid || "");
    if (!target || !Array.isArray(videoMappings) || videoMappings.length === 0) {
        return null;
    }

    // 1. 优先按完整 fid 精确匹配
    const directMapping = videoMappings.find((m) => getMappingFileId(m) === target);
    if (directMapping) return directMapping;

    // 2. 兼容仅刮削首线路的情况：按 epIndex 回退匹配
    const targetEpisodeIndex = getFidEpisodeIndex(target);
    if (targetEpisodeIndex) {
        const indexMatched = videoMappings.find((m) => getFidEpisodeIndex(getMappingFileId(m)) === targetEpisodeIndex);
        if (indexMatched) return indexMatched;
    }

    // 3. 兜底：按集数名称匹配
    const normalizedName = normalizeEpisodeName(fallbackEpisodeName);
    if (normalizedName) {
        const nameMatched = videoMappings.find((m) => {
            const mappingEpisodeName = normalizeEpisodeName(m?.episodeName);
            const mappingFileName = normalizeEpisodeName(m?.file_name || m?.name);
            return mappingEpisodeName === normalizedName || mappingFileName === normalizedName;
        });
        if (nameMatched) return nameMatched;
    }

    return null;
};

/**
 * 构建刮削后的弹幕文件名
 * @param {Object} scrapeData - 刮削数据
 * @param {string} scrapeType - 刮削类型（movie/tv）
 * @param {Object} mapping - 集数映射
 * @param {string} fallbackVodName - 备用视频名
 * @param {string} fallbackEpisodeName - 备用集数名
 * @returns {string} 弹幕文件名
 */
const buildScrapedDanmuFileName = (scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) => {
    if (!scrapeData) {
        return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
    }
    if (scrapeType === "movie") {
        return scrapeData.title || fallbackVodName;
    }
    const title = scrapeData.title || fallbackVodName;
    const seasonAirYear = scrapeData.seasonAirYear || "";
    const seasonNumber = mapping?.seasonNumber || 1;
    const episodeNumber = mapping?.episodeNumber || 1;
    return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
};

/**
 * 匹配弹幕
 * @param {string} fileName - 文件名
 * @returns {Promise<Array>} 弹幕列表
 */
async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) {
        return [];
    }

    try {
        logInfo(`匹配弹幕: ${fileName}`);

        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({ fileName: fileName }),
        });

        if (response.statusCode !== 200) {
            logInfo(`弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body);

        // 检查是否匹配成功
        if (!matchData.isMatched) {
            logInfo("弹幕未匹配到");
            return [];
        }

        // 获取matches数组
        const matches = matchData.matches || [];
        if (matches.length === 0) {
            return [];
        }

        // 取第一个匹配项
        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";

        if (!episodeId) {
            return [];
        }

        // 构建弹幕名称
        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

        // 构建弹幕URL
        const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;

        logInfo(`弹幕匹配成功: ${danmakuName}`);

        return [
            {
                name: danmakuName,
                url: danmakuURL,
            },
        ];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
}

/**
 * 构建播放源（按线路分组）
 * @param {Array} lines - 线路数组
 * @param {string} vodName - 视频名称
 * @param {string} videoId - 视频ID
 * @returns {Array} vod_play_sources 格式数组
 */
const buildPlaySourcesFromLines = (lines, vodName, videoId = "") => {
    if (!Array.isArray(lines) || lines.length === 0) return [];

    return lines.map((line, lineIndex) => {
        const playLinks = (line.playUrls || "").split('#').filter(Boolean);
        const episodes = playLinks.map((link, epIndex) => {
            const parts = link.split('$');
            const episodeName = parts[0] || '正片';
            const actualUrl = parts[1] || parts[0];
            const fid = `${videoId}#${lineIndex}#${epIndex}`;
            const combinedId = `${actualUrl}|||${encodeMeta({
                sid: String(videoId || ""),
                fid,
                v: vodName || "",
                e: episodeName
            })}`;

            return {
                name: episodeName,
                playId: combinedId,
                _fid: fid,
                _rawName: episodeName,
            };
        }).filter(e => e.playId);

        return {
            name: line.lineName || '多多追剧',
            episodes
        };
    }).filter(source => source.episodes && source.episodes.length > 0);
};

// ========== 主要接口函数 ==========

/**
 * 首页 - 获取分类列表和筛选器
 * @param {Object} params - 参数对象
 * @returns {Promise<Object>} 返回分类和筛选器配置
 */
async function home(params) {
    logInfo("进入首页");

    try {
        // 请求首页获取分类数据
        const res = await apiGet(`/api.php/web/index/home`);
        const list = [];
        const homeData = res.data.data || {};

        const categories = Array.isArray(homeData.categories) ? homeData.categories : [];
        const classList = categories.map(i => ({
            type_id: i.type_name,
            type_name: i.type_name
        }));

        const recommendBuckets = [];
        if (Array.isArray(homeData.recommend)) recommendBuckets.push(...homeData.recommend);
        categories.forEach(i => {
            if (Array.isArray(i.videos)) recommendBuckets.push(...i.videos);
        });

        const seen = new Set();
        recommendBuckets.forEach(k => {
            const vodId = String(k.vod_id || "").trim();
            if (!vodId || seen.has(vodId)) return;
            seen.add(vodId);
            k.vod_id = vodId;
            list.push(k);
        });

        logInfo(`分类获取完成，共 ${classList.length} 个`);

        logInfo(`首页响应：${JSON.stringify(list)}`);

        return {
            class: classList,
            filters: filterData,
            list
        };
    } catch (e) {
        logError('首页获取失败', e);
        // 返回默认分类
        return {
            class: [
                { type_id: '电影', type_name: '电影' },
                { type_id: '剧集', type_name: '剧集' },
                { type_id: '动漫', type_name: '动漫' },
                { type_id: '综艺', type_name: '综艺' }
            ],
            filters: filterData
        };
    }
}

/**
 * 分类 - 获取分类视频列表
 * @param {Object} params - 参数对象 { categoryId, page, filters }
 * @returns {Promise<Object>} 返回视频列表和分页信息
 */
async function category(params) {
    const { categoryId, page, filters } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}, 筛选: ${JSON.stringify(filters || {})}`);

    try {
        const PAGE_SIZE = 24;

        // 构建请求 URL
        let url = `/api.php/web/filter/vod?type_name=${encodeURIComponent(categoryId)}&page=${pg}&limit=${PAGE_SIZE}`;

        // 添加筛选参数
        const extend = filters || {};
        if (extend.class) {
            url += `&class=${encodeURIComponent(extend.class)}`;
        }
        if (extend.area) {
            url += `&area=${encodeURIComponent(extend.area)}`;
        }
        if (extend.year) {
            url += `&year=${encodeURIComponent(extend.year)}`;
        }

        // 默认按人气排序
        url += `&sort=hits`;

        logInfo(`请求 URL: ${url}`);

        // 发送请求
        const res = await apiGet(url);
        const items = res.data.data || [];

        // API 的 pageCount 不可靠，根据返回数量判断是否有下一页
        const hasMore = items.length >= PAGE_SIZE;

        logInfo(`获取到 ${items.length} 个视频`);

        const list = json2vods(items);

        logInfo(`list: ${JSON.stringify(list)}`);

        return {
            list: list,
            page: pg,
            pagecount: hasMore ? pg + 1 : pg
        };
    } catch (e) {
        logError('分类请求失败', e);
        return {
            list: [],
            page: pg,
            pagecount: 0
        };
    }
}

/**
 * 详情 - 获取视频详细信息和播放源
 * @param {Object} params - 参数对象 { videoId }
 * @returns {Promise<Object>} 返回视频详情
 */
async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);

    try {
        // 请求详情数据
        const res = await apiGet(`/api.php/web/vod/get_detail?vod_id=${videoId}`);
        const data = res.data.data[0];
        const vodplayer = Array.isArray(res.data.vodplayer) ? res.data.vodplayer : [];

        // 构建基本信息
        const vod = {
            vod_id: data.vod_id.toString(),
            vod_name: data.vod_name,
            vod_pic: data.vod_pic,
            vod_remarks: data.vod_remarks,
            vod_content: data.vod_content,
            vod_year: data.vod_year.toString() || '',
            vod_area: Array.isArray(data.vod_area) ? data.vod_area.join(',') : (data.vod_area || ''),
            vod_actor: Array.isArray(data.vod_actor) ? data.vod_actor.join(',') : (data.vod_actor || ''),
            vod_director: Array.isArray(data.vod_director) ? data.vod_director.join(',') : (data.vod_director || ''),
            type_name: data.type_name || ''
        };
        logInfo(`视频标题: ${vod.vod_name}`);

        // 解析播放线路
        const rawShows = String(data.vod_play_from || '').split('$$$');
        const rawUrlsList = String(data.vod_play_url || '').split('$$$');
        const validLines = [];
        const pushLine = (lineName, playUrls, order, sourceCode = "") => {
            if (!playUrls) return;
            validLines.push({ lineName, playUrls, order, sourceCode: String(sourceCode || "").trim() });
        };

        const missingPlayerLines = [];
        rawShows.forEach((showCode, index) => {
            const rawUrls = String(rawUrlsList[index] || "");

            const playerInfo = vodplayer.find(p => p.from === showCode);
            if (!playerInfo) {
                if (rawUrls) missingPlayerLines.push({ showCode, rawUrls });
                return;
            }

            const lineName = buildLineDisplayName(playerInfo.show, showCode);

            const urls = rawUrls.split('#').map(urlItem => {
                if (urlItem.includes('$')) {
                    const [episode, url] = urlItem.split('$');
                    return `${episode}$${showCode}@${playerInfo.decode_status}@${url}`;
                }
                return null;
            }).filter(Boolean);

            if (urls.length > 0) {
                const order = 1000 + (rawShows.length - 1 - index);
                pushLine(lineName, urls.join('#'), order, showCode);
            }
        });

        // 新站偶发缺失 vodplayer 元数据，兼容按直连兜底解析播放线路
        if (validLines.length === 0 && missingPlayerLines.length > 0) {
            missingPlayerLines.forEach(({ showCode, rawUrls }, lineIndex) => {
                const urls = rawUrls.split('#').map(urlItem => {
                    if (!urlItem || !urlItem.includes('$')) return null;
                    const [episode, url] = urlItem.split('$');
                    return `${episode}$${showCode}@0@${url}`;
                }).filter(Boolean);

                if (urls.length > 0) {
                    pushLine(buildLineDisplayName(showCode, showCode), urls.join('#'), lineIndex, showCode);
                }
            });
        }

        try {
            const aggregateRes = await apiGet(`/api.php/web/internal/search_aggregate?vod_id=${videoId}`);
            const aggregateItems = Array.isArray(aggregateRes?.data?.data) ? aggregateRes.data.data : [];
            aggregateItems.forEach((item, idx) => {
                const rawPlayUrl = String(item?.vod_play_url || "").trim();
                if (!rawPlayUrl) return;
                const sourceKey = String(item?.site_key || item?.vod_play_from || `external_${idx}`).trim();
                const decodeStatus = String(item?.decode_status ?? '').trim();
                const sourceName = String(item?.site_name || item?.vod_play_from || sourceKey || `站外线路${idx + 1}`).trim();
                const lineName = buildLineDisplayName(sourceName, sourceKey);
                const urls = rawPlayUrl.split('#').map(urlItem => {
                    if (!urlItem || !urlItem.includes('$')) return null;
                    const [episode, url] = urlItem.split('$');
                    if (!episode || !url) return null;
                    return `${episode}$${sourceKey}@${decodeStatus}@${url}`;
                }).filter(Boolean);
                if (!urls.length) return;
                const sortScore = Number(item?.sort);
                const order = Number.isFinite(sortScore) ? sortScore : idx;
                pushLine(lineName, urls.join('#'), order, sourceKey);
            });
        } catch (aggregateError) {
            logInfo(`聚合线路获取失败: ${aggregateError.message}`);
        }

        if (validLines.length === 0) {
            logError('没有可用的播放线路', new Error('validLines is empty'));
            return { list: [] };
        }

        // 指定蓝光线路固定前置，其余线路保持原有顺序
        const priorityLineOrder = ["JD4K", "JD2K", "BBA", "YYNB", "NBY"];
        const getPriorityRank = (line) => {
            const code = String(line?.sourceCode || "").trim().toUpperCase();
            const idx = priorityLineOrder.indexOf(code);
            return idx >= 0 ? idx : priorityLineOrder.length;
        };
        validLines.sort((a, b) => {
            const rankA = getPriorityRank(a);
            const rankB = getPriorityRank(b);
            if (rankA !== rankB) return rankA - rankB;
            if (rankA < priorityLineOrder.length) return 0;
            return (a.order || 0) - (b.order || 0);
        });

        const seenLineNames = new Set();
        const dedupedLines = [];
        validLines.forEach((line) => {
            const key = `${line.lineName}:::${line.playUrls}`;
            if (seenLineNames.has(key)) return;
            seenLineNames.add(key);
            dedupedLines.push(line);
        });

        logInfo(`找到 ${dedupedLines.length} 条播放线路`, {
            lineOrder: dedupedLines.map((line) => line.lineName)
        });

        // 转换为标准格式（按线路分组）
        const videoIdForScrape = String(videoId || "");
        const playSources = buildPlaySourcesFromLines(dedupedLines, vod.vod_name, videoIdForScrape);

        // ========== 刮削处理 ==========
        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = "";
        const scrapeCandidates = [];

        // 准备刮削候选数据
        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                if (!ep._fid) continue;
                scrapeCandidates.push({
                    fid: ep._fid,
                    file_id: ep._fid,
                    file_name: ep._rawName || ep.name || "正片",
                    name: ep._rawName || ep.name || "正片",
                    format_type: "video",
                });
            }
        }

        // 执行刮削
        if (scrapeCandidates.length > 0) {
            logInfo("准备刮削候选", {
                candidateCount: scrapeCandidates.length,
                candidatePreview: scrapeCandidates.slice(0, 5).map((item) => `${item.file_id}=>${item.file_name}`)
            });
            try {
                // 先快速读取已有刮削缓存，避免阻塞详情页返回
                const metadata = await withTimeout(OmniBox.getScrapeMetadata(videoIdForScrape), 300, "getScrapeMetadata(cache)");
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || "";
                logInfo(`刮削缓存读取完成`, {
                    hasScrapeData: !!scrapeData,
                    mappingCount: videoMappings.length,
                    scrapeType,
                    mappingPreview: videoMappings.slice(0, 5).map((m) => `${getMappingFileId(m) || "<empty>"}=>${m?.episodeName || m?.file_name || m?.name || ""}`)
                });
            } catch (error) {
                logInfo(`刮削缓存读取失败: ${error.message}`);
            }

            // 后台触发完整刮削，不阻塞详情页
            OmniBox.processScraping(
                    videoIdForScrape,
                    vod.vod_name || "",
                    vod.vod_name || "",
                    scrapeCandidates
                )
                .then((scrapingResult) => {
                    logInfo(`后台刮削处理完成: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);
                    return OmniBox.getScrapeMetadata(videoIdForScrape);
                })
                .then((metadata) => {
                    logInfo("后台刮削元数据更新完成", {
                        hasScrapeData: !!metadata?.scrapeData,
                        mappingCount: (metadata?.videoMappings || []).length,
                        scrapeType: metadata?.scrapeType || "",
                        mappingPreview: (metadata?.videoMappings || []).slice(0, 5).map((m) => `${getMappingFileId(m) || "<empty>"}=>${m?.episodeName || m?.file_name || m?.name || ""}`)
                    });
                })
                .catch((bgError) => {
                    logInfo(`后台刮削失败: ${bgError.message}`);
                });
        }

        let renameCount = 0;
        let mappingHitCount = 0;
        const mappingMissPreview = [];

        // 应用刮削结果到集数名称
        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                const mapping = findMappingByFid(videoMappings, ep._fid, ep._rawName || ep.name || "");
                if (!mapping) {
                    if (mappingMissPreview.length < 5) {
                        mappingMissPreview.push({
                            fid: ep._fid,
                            episodeName: ep._rawName || ep.name || "",
                        });
                    }
                    continue;
                }

                mappingHitCount += 1;
                const oldName = ep.name;
                const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                if (newName && newName !== oldName) {
                    ep.name = newName;
                    renameCount += 1;
                    logInfo(`应用刮削后集数名: ${oldName} -> ${newName}`);
                }
                ep._seasonNumber = mapping.seasonNumber;
                ep._episodeNumber = mapping.episodeNumber;
            }

            // 按季数和集数排序
            const hasEpisodeNumber = (source.episodes || []).some(
                (ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null
            );
            if (hasEpisodeNumber) {
                source.episodes.sort((a, b) => {
                    const seasonA = a._seasonNumber || 0;
                    const seasonB = b._seasonNumber || 0;
                    if (seasonA !== seasonB) return seasonA - seasonB;
                    const episodeA = a._episodeNumber || 0;
                    const episodeB = b._episodeNumber || 0;
                    return episodeA - episodeB;
                });
            }
        }

        logInfo("详情刮削改名统计", {
            sourceCount: playSources.length,
            mappingCount: videoMappings.length,
            mappingHitCount,
            renameCount,
            mappingMissPreview,
        });

        // 构建最终的播放源数据
        vod.vod_play_sources = playSources.map((source) => ({
            name: source.name,
            episodes: (source.episodes || []).map((ep) => ({
                name: ep.name,
                playId: ep.playId,
            })),
        }));

        // 应用刮削元数据到视频信息
        if (scrapeData) {
            vod.vod_name = scrapeData.title || vod.vod_name;
            if (scrapeData.posterPath) {
                vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            }
            if (scrapeData.overview) {
                vod.vod_content = scrapeData.overview;
            }
            if (scrapeData.releaseDate) {
                vod.vod_year = String(scrapeData.releaseDate).substring(0, 4) || vod.vod_year;
            }

            // 演员信息
            const actors = (scrapeData.credits?.cast || [])
                .slice(0, 5)
                .map((c) => c?.name)
                .filter(Boolean)
                .join(",");
            if (actors) {
                vod.vod_actor = actors;
            }

            // 导演信息
            const directors = (scrapeData.credits?.crew || [])
                .filter((c) => c?.job === "Director" || c?.department === "Directing")
                .slice(0, 3)
                .map((c) => c?.name)
                .filter(Boolean)
                .join(",");
            if (directors) {
                vod.vod_director = directors;
            }
        }

        OmniBox.log("info", `详情处理完成，播放源数: ${JSON.stringify(vod)}`);

        return {
            list: [vod]
        };
    } catch (e) {
        logError('详情获取失败', e);
        return { list: [] };
    }
}

/**
 * 搜索 - 搜索视频
 * @param {Object} params - 参数对象 { keyword, page }
 * @returns {Promise<Object>} 返回搜索结果
 */
async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);

    try {
        const res = await apiGet(`/api.php/web/search/index?wd=${encodeURIComponent(wd)}&page=${pg}&limit=50`);
        const items = res.data.data || [];
        const hasMore = items.length >= 50;

        logInfo(`搜索到 ${items.length} 个结果`);

        return {
            list: json2vods(items),
            page: pg,
            pagecount: hasMore ? pg + 1 : pg
        };
    } catch (e) {
        logError('搜索失败', e);
        return {
            list: [],
            page: pg,
            pagecount: 0
        };
    }
}

/**
 * 播放 - 解析播放地址
 * @param {Object} params - 参数对象 { playId, flag, vodId, vodName, episodeName }
 * @returns {Promise<Object>} 返回播放信息
 */
async function play(params) {
    let playId = params.playId;
    const flag = params.flag || "";
    logInfo(`准备播放 ID: ${playId}, flag: ${flag}`);

    let vodName = "";
    let episodeName = "";
    let playMeta = {};

    // 解析透传参数
    if (playId && playId.includes("|||")) {
        const [mainPlayId, metaB64] = playId.split("|||");
        playId = mainPlayId;
        playMeta = decodeMeta(metaB64 || "");
        vodName = playMeta.v || "";
        episodeName = playMeta.e || "";
        logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    }

    // 读取刮削元数据（用于弹幕匹配）
    let scrapedDanmuFileName = "";
    try {
        const videoIdFromParam = params.vodId ? String(params.vodId) : "";
        const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid) : "";
        const videoIdForScrape = videoIdFromParam || videoIdFromMeta;

        if (videoIdForScrape) {
            const metadata = await withTimeout(OmniBox.getScrapeMetadata(videoIdForScrape), 1800, "getScrapeMetadata(play)");
            if (metadata && metadata.scrapeData) {
                const mapping = findMappingByFid(metadata.videoMappings || [], playMeta?.fid, playMeta?.e || episodeName || "");
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
        logInfo(`读取刮削元数据失败: ${error.message}`);
    }

    try {
        // 解析播放参数：线路代码@解码状态@URL
        const parts = playId.split('@');
        const play_from = parts[0];              // 线路代码 (NBY, BBA, YYNB, JD4K...)
        const decode_status = parts[1];          // 是否需要解码 (0=直连, 1=加密)
        const raw_url = parts.slice(2).join('@'); // URL 本身可能含 @

        logInfo(`播放参数 - 线路: ${play_from}, 解码状态: ${decode_status}, URL: ${raw_url.substring(0, 50)}...`);

        let finalUrl = raw_url;
        let parseFlag = 0;
        let playHeader = PLAY_HEADERS;

        // 1. 如果已经是 HTTP URL
        if (isHttpUrl(raw_url)) {
            finalUrl = raw_url;
            parseFlag = needsParser(raw_url) ? 1 : 0;
            logInfo(`直连 URL: ${finalUrl.substring(0, 80)}...`);
        }
        // 2. 如果是加密 URL，使用 WASM 解码
        else if (decode_status === '1' || !isHttpUrl(raw_url)) {
            const decoded = await decodeEncryptedUrl(raw_url, play_from);
            if (decoded && isHttpUrl(decoded)) {
                finalUrl = decoded;
                parseFlag = needsParser(decoded) ? 1 : 0;
                logInfo(`解码成功: ${play_from} -> ${finalUrl.substring(0, 80)}...`);
            } else {
                logError('解码失败', new Error(`无法解码 ${play_from}: ${raw_url.substring(0, 40)}...`));
                // 解码失败，返回空地址
                return {
                    urls: [{ name: "多多追剧", url: "" }],
                    parse: 0,
                    header: PLAY_HEADERS
                };
            }
        }

        // 3. 非直链尝试嗅探真实视频地址
        if (isHttpUrl(finalUrl) && !isDirectPlayable(finalUrl)) {
            const sniffed = await sniffPlayUrl(finalUrl);
            if (sniffed && sniffed.url) {
                finalUrl = sniffed.url;
                playHeader = sniffed.header || PLAY_HEADERS;
                parseFlag = 0;
                logInfo(`嗅探成功: ${finalUrl.substring(0, 80)}...`);
            } else if (!needsParser(finalUrl)) {
                parseFlag = 1;
            }
        }

        // 构建播放响应
        const playResponse = {
            urls: [{ name: "多多追剧", url: finalUrl }],
            parse: parseFlag,
            header: playHeader
        };

        // ========== 弹幕匹配 ========== 
        if (DANMU_API && (vodName || params.vodName)) {
            const finalVodName = vodName || params.vodName;
            const finalEpisodeName = episodeName || params.episodeName || '';

            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(finalVodName, finalEpisodeName);
            logInfo(`尝试匹配弹幕文件名: ${fileName}`);

            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList && danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                    logInfo(`弹幕匹配成功，共 ${danmakuList.length} 条`);
                }
            }
        }

        return playResponse;
    } catch (error) {
        logError("播放解析失败", error);
        return {
            urls: [{ name: "多多追剧", url: "" }],
            parse: 0,
            header: PLAY_HEADERS
        };
    }
}

// ========== 导出模块 ==========

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
