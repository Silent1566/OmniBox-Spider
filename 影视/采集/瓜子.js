/**
 * ============================================================================
 * 瓜子APP - OmniBox 爬虫脚本
 * ============================================================================
 * 
 * 功能说明:
 * - 提供瓜子视频APP源的 OmniBox 格式接口
 * - 支持分类浏览、搜索、详情、播放等功能
 * - 集成 RSA/AES 加密通信
 * - 搜索过滤功能，精准匹配搜索结果
 * 
 * 主要特性:
 * 1. 分类支持：电影、电视剧、动漫、综艺、短剧
 * 2. 筛选功能：支持年份、地区、排序等筛选条件
 * 3. 加密通信：RSA解密 + AES加解密 + MD5签名
 * 4. 缓存机制：提升请求性能
 * 5. 搜索过滤：精准匹配结果
 * 
 * 日期: 2025.02.27
 * ============================================================================
 */

const OmniBox = require("omnibox_sdk");
const crypto = require("crypto");
const axios = require("axios");
const https = require("https");

/**
 * 配置信息
 */
const config = {
    host: 'https://api.w32z7vtd.com',
    headers: {
        'Cache-Control': 'no-cache',
        'Version': '2406025',
        'PackageName': 'com.uf076bf0c246.qe439f0d5e.m8aaf56b725a.ifeb647346f',
        'Ver': '1.9.2',
        'Referer': 'https://api.w32z7vtd.com',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/3.12.0'
    },
    timeout: 10000
};
const DANMU_API = process.env.DANMU_API || "";

/**
 * 创建 HTTPS Agent (忽略 SSL 证书验证)
 */
const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 50,
    maxFreeSockets: 10,
    scheduling: 'lifo',
    rejectUnauthorized: false  // 忽略 SSL 证书验证
});

/**
 * 创建 Axios 实例
 */
const axiosInstance = axios.create({
    httpsAgent,
    timeout: config.timeout,
    headers: config.headers
});

/**
 * RSA 私钥
 */
const privateKey = `-----BEGIN PRIVATE KEY-----
MIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGAe6hKrWLi1zQmjTT1
ozbE4QdFeJGNxubxld6GrFGximxfMsMB6BpJhpcTouAqywAFppiKetUBBbXwYsYU
1wNr648XVmPmCMCy4rY8vdliFnbMUj086DU6Z+/oXBdWU3/b1G0DN3E9wULRSwcK
ZT3wj/cCI1vsCm3gj2R5SqkA9Y0CAwEAAQKBgAJH+4CxV0/zBVcLiBCHvSANm0l7
HetybTh/j2p0Y1sTXro4ALwAaCTUeqdBjWiLSo9lNwDHFyq8zX90+gNxa7c5EqcW
V9FmlVXr8VhfBzcZo1nXeNdXFT7tQ2yah/odtdcx+vRMSGJd1t/5k5bDd9wAvYdI
DblMAg+wiKKZ5KcdAkEA1cCakEN4NexkF5tHPRrR6XOY/XHfkqXxEhMqmNbB9U34
saTJnLWIHC8IXys6Qmzz30TtzCjuOqKRRy+FMM4TdwJBAJQZFPjsGC+RqcG5UvVM
iMPhnwe/bXEehShK86yJK/g/UiKrO87h3aEu5gcJqBygTq3BBBoH2md3pr/W+hUM
WBsCQQChfhTIrdDinKi6lRxrdBnn0Ohjg2cwuqK5zzU9p/N+S9x7Ck8wUI53DKm8
jUJE8WAG7WLj/oCOWEh+ic6NIwTdAkEAj0X8nhx6AXsgCYRql1klbqtVmL8+95KZ
K7PnLWG/IfjQUy3pPGoSaZ7fdquG8bq8oyf5+dzjE/oTXcByS+6XRQJAP/5ciy1b
L3NhUhsaOVy55MHXnPjdcTX0FaLi+ybXZIfIQ2P4rb19mVq1feMbCXhz+L1rG8oa
t5lYKfpe8k83ZA==
-----END PRIVATE KEY-----`;

const staticKeys = "Qmxi5ciWXbQzkr7o+SUNiUuQxQEf8/AVyUWY4T/BGhcXBIUz4nOyHBGf9A4KbM0iKF3yp9M7WAY0rrs5PzdTAOB45plcS2zZ0wUibcXuGJ29VVGRWKGwE9zu2vLwhfgjTaaDpXo4rby+7GxXTktzJmxvneOUdYeHi+PZsThlvPI=";
const token = '1be86e8e18a9fa18b2b8d5432699dad0.ac008ed650fd087bfbecf2fda9d82e9835253ef24843e6b18fcd128b10763497bcf9d53e959f5377cde038c20ccf9d17f604c9b8bb6e61041def86729b2fc7408bd241e23c213ac57f0226ee656e2bb0a583ae0e4f3bf6c6ab6c490c9a6f0d8cdfd366aacf5d83193671a8f77cd1af1ff2e9145de92ec43ec87cf4bdc563f6e919fe32861b0e93b118ec37d8035fbb3c.59dd05c5d9a8ae726528783128218f15fe6f2c0c8145eddab112b374fcfe3d79';

/**
 * 分类配置
 */
const CLASSES = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "电视剧" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "3", type_name: "综艺" },
    { type_id: "64", type_name: "短剧" }
];

/**
 * 筛选配置
 */
const FILTERS = {
    '1': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' },
                { name: '2021', value: '2021' },
                { name: '2020', value: '2020' },
                { name: '2019', value: '2019' },
                { name: '2018', value: '2018' },
                { name: '2017', value: '2017' },
                { name: '2016', value: '2016' },
                { name: '2015', value: '2015' },
                { name: '2014', value: '2014' },
                { name: '2013', value: '2013' },
                { name: '2012', value: '2012' },
                { name: '2011', value: '2011' },
                { name: '2010', value: '2010' },
                { name: '2009', value: '2009' },
                { name: '2008', value: '2008' },
                { name: '2007', value: '2007' },
                { name: '2006', value: '2006' },
                { name: '2005', value: '2005' },
                { name: '更早', value: '2004' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '香港', value: '香港' },
                { name: '台湾', value: '台湾' },
                { name: '美国', value: '美国' },
                { name: '韩国', value: '韩国' },
                { name: '日本', value: '日本' },
                { name: '英国', value: '英国' },
                { name: '法国', value: '法国' },
                { name: '泰国', value: '泰国' },
                { name: '印度', value: '印度' },
                { name: '其他', value: '其他' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '2': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' },
                { name: '2021', value: '2021' },
                { name: '2020', value: '2020' },
                { name: '2019', value: '2019' },
                { name: '2018', value: '2018' },
                { name: '2017', value: '2017' },
                { name: '2016', value: '2016' },
                { name: '2015', value: '2015' },
                { name: '2014', value: '2014' },
                { name: '2013', value: '2013' },
                { name: '2012', value: '2012' },
                { name: '2011', value: '2011' },
                { name: '2010', value: '2010' },
                { name: '2009', value: '2009' },
                { name: '2008', value: '2008' },
                { name: '2007', value: '2007' },
                { name: '2006', value: '2006' },
                { name: '2005', value: '2005' },
                { name: '更早', value: '2004' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '香港', value: '香港' },
                { name: '台湾', value: '台湾' },
                { name: '美国', value: '美国' },
                { name: '韩国', value: '韩国' },
                { name: '日本', value: '日本' },
                { name: '英国', value: '英国' },
                { name: '法国', value: '法国' },
                { name: '泰国', value: '泰国' },
                { name: '印度', value: '印度' },
                { name: '其他', value: '其他' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '4': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' },
                { name: '2021', value: '2021' },
                { name: '2020', value: '2020' },
                { name: '2019', value: '2019' },
                { name: '2018', value: '2018' },
                { name: '2017', value: '2017' },
                { name: '2016', value: '2016' },
                { name: '2015', value: '2015' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '日本', value: '日本' },
                { name: '美国', value: '美国' },
                { name: '其他', value: '其他' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '3': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' },
                { name: '2022', value: '2022' }
            ]
        },
        {
            key: 'area',
            name: '地区',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '大陆', value: '大陆' },
                { name: '台湾', value: '台湾' },
                { name: '韩国', value: '韩国' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ],
    '64': [
        {
            key: 'year',
            name: '年份',
            init: '0',
            value: [
                { name: '全部', value: '0' },
                { name: '2026', value: '2026' },
                { name: '2025', value: '2025' },
                { name: '2024', value: '2024' },
                { name: '2023', value: '2023' }
            ]
        },
        {
            key: 'sort',
            name: '排序',
            init: 'd_id',
            value: [
                { name: '最新', value: 'd_id' },
                { name: '最热', value: 'd_hits' },
                { name: '推荐', value: 'd_score' }
            ]
        }
    ]
};

/**
 * API 路径
 */
const API_PATHS = {
    INDEX_LIST: '/App/IndexList/indexList',
    PLAY_INFO: '/App/IndexPlay/playInfo',
    VURL_SHOW: '/App/Resource/Vurl/show',
    VURL_DETAIL: '/App/Resource/VurlDetail/showOne',
    FIND_MORE: '/App/Index/findMoreVod'
};

/**
 * 缓存管理
 */
const cache = {
    data: new Map(),
    ttl: {
        category: 300000,
        detail: 600000,
        play: 300000,
        search: 60000
    },
    get: (key) => {
        const item = cache.data.get(key);
        if (!item) return null;
        if (Date.now() > item.expire) {
            cache.data.delete(key);
            return null;
        }
        return item.data;
    },
    set: (key, data, type = 'category') => {
        cache.data.set(key, {
            data,
            expire: Date.now() + cache.ttl[type]
        });
        if (cache.data.size > 200) cache.data.clear();
    }
};

/**
 * RSA 解密工具
 */
const rsaTool = {
    decode: (data) => {
        if (!data) return null;
        try {
            const buffer = Buffer.from(data, 'base64');
            const blockSize = 256;
            let decryptedParts = [];

            for (let i = 0; i < buffer.length; i += blockSize) {
                const chunk = buffer.slice(i, i + blockSize);
                const decChunk = crypto.privateDecrypt({
                    key: privateKey,
                    padding: crypto.constants.RSA_NO_PADDING,
                }, chunk);

                let start = 0;
                while (start < decChunk.length && decChunk[start] === 0) start++;
                const realStart = decChunk.indexOf(0, 2);

                if (realStart !== -1) {
                    decryptedParts.push(decChunk.slice(realStart + 1));
                } else {
                    decryptedParts.push(decChunk.slice(start));
                }
            }
            return Buffer.concat(decryptedParts).toString('utf8').trim();
        } catch (e) {
            OmniBox.log('error', `[瓜子APP] RSA解密失败: ${e.message}`);
            return null;
        }
    }
};

/**
 * 加密工具
 */
const cryptoTool = {
    md5: (text) => crypto.createHash('md5').update(text).digest('hex'),
    
    aesEncrypt: (text) => {
        try {
            const key = Buffer.from('mvXBSW7ekreItNsT', 'utf8');
            const iv = Buffer.from('2U3IrJL8szAKp0Fj', 'utf8');
            const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return encrypted.toUpperCase();
        } catch (e) {
            OmniBox.log('error', `[瓜子APP] AES加密失败: ${e.message}`);
            return '';
        }
    },
    
    aesDecrypt: (text, keyStr, ivStr) => {
        try {
            const key = Buffer.from(keyStr, 'utf8');
            const iv = Buffer.from(ivStr, 'utf8');
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
            let decrypted = decipher.update(text, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            OmniBox.log('error', `[瓜子APP] AES解密失败: ${e.message}`);
            return '';
        }
    },
    
    generateSignature: (requestKey, timestamp) => {
        const signStr = `token_id=,token=${token},phone_type=1,request_key=${requestKey},app_id=1,time=${timestamp},keys=${staticKeys}*&zvdvdvddbfikkkumtmdwqppp?|4Y!s!2br`;
        return cryptoTool.md5(signStr);
    }
};

/**
 * 日志工具
 */
const logInfo = (message, data = null) => {
    if (data) {
        OmniBox.log("info", `[瓜子APP] ${message}: ${JSON.stringify(data)}`);
    } else {
        OmniBox.log("info", `[瓜子APP] ${message}`);
    }
};

const logError = (message, error) => {
    OmniBox.log("error", `[瓜子APP] ${message}: ${error.message || error}`);
};

const logWarn = (message) => {
    OmniBox.log("warn", `[瓜子APP] ${message}`);
};

/**
 * 弹幕工具函数
 */
const preprocessTitle = (title) => {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
};

const chineseToArabic = (cn) => {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
    if (!isNaN(cn)) return parseInt(cn, 10);
    if (cn.length === 1) return map[cn] || cn;
    if (cn.length === 2) {
        if (cn[0] === '十') return 10 + map[cn[1]];
        if (cn[1] === '十') return map[cn[0]] * 10;
    }
    if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
    return cn;
};

const extractEpisode = (title) => {
    if (!title) return "";
    const processedTitle = preprocessTitle(title).trim();

    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));

    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];

    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];

    const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!["720", "1080", "480"].includes(num)) return num;
    }

    return "";
};

const buildFileNameForDanmu = (vodName, episodeTitle) => {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;

    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            if (epNum < 10) return `${vodName} S01E0${epNum}`;
            return `${vodName} S01E${epNum}`;
        }
    }
    return vodName;
};

const buildScrapedDanmuFileName = (scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) => {
    if (!scrapeData) {
        return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
    }

    if (scrapeType === 'movie') {
        return scrapeData.title || fallbackVodName;
    }

    const title = scrapeData.title || fallbackVodName;
    const seasonAirYear = scrapeData.seasonAirYear || '';
    const seasonNumber = mapping?.seasonNumber || 1;
    const episodeNumber = mapping?.episodeNumber || 1;
    return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
};

const matchDanmu = async (fileName) => {
    if (!DANMU_API || !fileName) return [];

    try {
        logInfo(`匹配弹幕: ${fileName}`);
        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            body: JSON.stringify({ fileName }),
        });

        if (response.statusCode !== 200) {
            logInfo(`弹幕匹配失败: HTTP ${response.statusCode}`);
            return [];
        }

        const matchData = JSON.parse(response.body);
        if (!matchData.isMatched) return [];

        const matches = matchData.matches || [];
        if (matches.length === 0) return [];

        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";
        if (!episodeId) return [];

        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

        return [{
            name: danmakuName,
            url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`,
        }];
    } catch (e) {
        logWarn(`弹幕匹配失败: ${e.message}`);
        return [];
    }
};

const encodeMeta = (obj) => {
    try {
        return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
    } catch {
        return '';
    }
};

const decodeMeta = (str) => {
    try {
        const raw = Buffer.from(str, 'base64').toString('utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
};

const extractVodIdForApi = (rawVideoId) => {
    const text = String(rawVideoId || '').trim();
    if (!text) return '';

    const decoded = decodeURIComponent(text);
    const pathMatch = decoded.match(/\/id\/(\d+)\.html/i);
    if (pathMatch?.[1]) return pathMatch[1];

    const firstPart = decoded.split('/')[0];
    if (/^\d+$/.test(firstPart)) return firstPart;

    const numMatch = decoded.match(/(\d+)/);
    return numMatch?.[1] || decoded;
};

/**
 * API 请求函数
 */
const apiRequest = async (data, path, cacheType = 'category', retries = 1) => {
    const cacheKey = `${path}|${JSON.stringify(data)}`;

    if (cacheType !== 'none') {
        const cached = cache.get(cacheKey);
        if (cached) {
            logInfo('使用缓存数据', { path });
            return cached;
        }
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const requestKey = cryptoTool.aesEncrypt(JSON.stringify(data));
    if (!requestKey) {
        logError('AES加密失败', new Error('requestKey为空'));
        return null;
    }
    
    const signature = cryptoTool.generateSignature(requestKey, timestamp);

    const postBody = new URLSearchParams({
        token: token,
        token_id: '',
        phone_type: '1',
        time: timestamp,
        phone_model: 'xiaomi-22021211rc',
        keys: staticKeys,
        request_key: requestKey,
        signature,
        app_id: '1',
        ad_version: '1'
    }).toString();

    let lastError = null;
    for (let i = 0; i <= retries; i++) {
        try {
            logInfo(`发送API请求 (尝试 ${i + 1}/${retries + 1})`, { url: `${config.host}${path}` });
            
            // 使用 axios 发起请求
            const response = await axiosInstance.post(`${config.host}${path}`, postBody);

            if (response.status !== 200 || !response.data?.data) {
                throw new Error(`HTTP ${response.status}`);
            }

            // 🔍 添加：打印响应数据的结构
            logInfo('原始响应数据', {
                status: response.status,
                hasData: !!response.data,
                dataType: typeof response.data,
                dataKeys: response.data ? Object.keys(response.data) : [],
                hasDataData: !!response.data?.data,
                dataDataKeys: response.data?.data ? Object.keys(response.data.data) : []
            });

            const keysData = rsaTool.decode(response.data.data.keys);
            if (!keysData) {
                throw new Error("RSA解密失败");
            }

            const keys = JSON.parse(keysData);
            const decryptedData = cryptoTool.aesDecrypt(
                response.data.data.response_key,
                keys.key,
                keys.iv
            );

            if (!decryptedData) {
                throw new Error("AES解密失败");
            }

            // 🔍 添加：打印解密后的原始字符串（前200字符）
            logInfo('解密后的原始数据', {
                length: decryptedData.length,
                preview: decryptedData.substring(0, 200)
            });

            const result = JSON.parse(decryptedData);

            // 🔍 添加：打印解析后的数据结构
            logInfo('解析后的数据结构', {
                type: typeof result,
                keys: result ? Object.keys(result) : [],
                hasList: !!result?.list,
                listType: typeof result?.list,
                isArray: Array.isArray(result?.list)
            });

            if (cacheType !== 'none' && result) {
                cache.set(cacheKey, result, cacheType);
            }
            
            logInfo('API请求成功', { path });
            return result;
        } catch (e) {
            lastError = e;
            logWarn(`API请求失败 (尝试 ${i + 1}/${retries + 1}): ${e.message}`);
        }
    }
    
    logError('API请求最终失败', lastError);
    return null;
};

/**
 * 获取分辨率分数（用于排序）
 */
const getResolutionScore = (res) => {
    const r = res.toLowerCase().replace('p', '');
    if (r === '8k') return 100;
    if (r === '4k' || r === '2160') return 90;
    if (r === '1440') return 80;
    if (r === '1080') return 70;
    if (r === '720') return 60;
    if (r === '超清') return 50;
    if (r === '高清') return 40;
    if (r === '标清') return 30;
    return 10;
};

/* ============================================================================
 * OmniBox 接口实现
 * ============================================================================ */

/**
 * 获取首页数据
 */
async function home(params) {
    try {
        logInfo('处理首页请求');
        
        return {
            class: CLASSES,
            filters: FILTERS
        };
    } catch (error) {
        logError('获取首页数据失败', error);
        return {
            class: [],
            filters: {}
        };
    }
}

/**
 * 获取分类数据
 */
async function category(params) {
    try {
        const categoryId = params.categoryId;
        const page = params.page || 1;
        const filters = params.filters || {};

        if (!categoryId) {
            throw new Error("分类ID不能为空");
        }

        const area = filters.area || '0';
        const year = filters.year || '0';
        const sort = filters.sort || 'd_id';

        logInfo('获取分类列表', { categoryId, page, area, year, sort });

        const data = await apiRequest({
            area: area,
            year: year,
            pageSize: "20",
            sort: sort,
            page: page.toString(),
            tid: categoryId
        }, API_PATHS.INDEX_LIST, 'category');

        // 🔍 添加详细的数据结构日志
        logInfo('API返回的原始数据结构', {
            hasData: !!data,
            dataKeys: data ? Object.keys(data) : [],
            hasList: data ? !!data.list : false,
            listLength: data?.list ? data.list.length : 0,
            listType: data?.list ? typeof data.list : 'undefined',
            isArray: data?.list ? Array.isArray(data.list) : false,
            // 如果list存在，输出前2项看看结构
            firstItems: data?.list ? data.list.slice(0, 2) : []
        });

        if (!data || !data.list) {
            logWarn('分类列表数据为空');
            return { list: [], page: page, pagecount: 0 };
        }

        const totalPage = parseInt(data.totalPage || 0);

        const list = data.list.map(item => ({
            vod_id: `${item.vod_id}/${item.vod_continu || 0}`,
            vod_name: item.vod_name,
            vod_pic: item.vod_pic,
            vod_remarks: (item.vod_continu || 0) === 0 ? '电影' : `更新至${item.vod_continu}集`
        }));

        logInfo('分类列表获取成功', { count: list.length });

        return {
            list: list,
            page: parseInt(page),
            pagecount: totalPage === 0 ? 999 : totalPage
        };
    } catch (error) {
        logError('获取分类数据失败', error);
        return {
            page: 1,
            pagecount: 0,
            list: []
        };
    }
}

/**
 * 搜索视频
 */
async function search(params) {
    try {
        const keyword = params.keyword || params.wd || "";
        const page = params.page || 1;

        if (!keyword) {
            return {
                page: 1,
                pagecount: 0,
                list: []
            };
        }

        logInfo('执行搜索', { keyword, page });

        const data = await apiRequest({
            keywords: keyword,
            order_val: "1",
            page: page.toString()
        }, API_PATHS.FIND_MORE, 'search');

        if (!data || !data.list) {
            logWarn('搜索结果为空');
            return { list: [], page: page, pagecount: 0 };
        }

        const totalPage = parseInt(data.totalPage || 0);

        // 关键点：对 API 返回结果进行二次过滤，确保标题中包含关键词
        const filteredList = data.list
            .filter(item => item.vod_name && item.vod_name.toLowerCase().includes(keyword.toLowerCase()))
            .map(item => ({
                vod_id: `${item.vod_id}/${item.vod_continu || 0}`,
                vod_name: item.vod_name,
                vod_pic: item.vod_pic,
                vod_remarks: (item.vod_continu || 0) === 0 ? '电影' : `更新至${item.vod_continu}集`
            }));

        logInfo('搜索完成(已过滤)', { keyword, count: filteredList.length });

        return {
            list: filteredList,
            page: parseInt(page),
            pagecount: totalPage === 0 ? 1 : totalPage
        };
    } catch (error) {
        logError('搜索视频失败', error);
        return {
            page: 1,
            pagecount: 0,
            list: []
        };
    }
}

/**
 * 获取视频详情
 */
async function detail(params) {
    try {
        const videoId = params.videoId;

        if (!videoId) {
            throw new Error("视频ID不能为空");
        }

        logInfo('获取视频详情', { videoId });

        const ids = Array.isArray(videoId) ? videoId : [videoId];
        const results = [];

        await Promise.all(ids.map(async (idStr) => {
            try {
                const videoIdForScrape = String(idStr || '');
                const vodId = extractVodIdForApi(idStr);

                const [detailData, playData] = await Promise.all([
                    apiRequest({
                        token_id: "1649412",
                        vod_id: vodId,
                        mobile_time: Math.floor(Date.now() / 1000).toString(),
                        tokename: token
                    }, API_PATHS.PLAY_INFO, 'detail'),
                    apiRequest({
                        vurl_cloud_id: "2",
                        vod_d_id: vodId
                    }, API_PATHS.VURL_SHOW, 'detail')
                ]);

                if (!detailData?.vodInfo) {
                    logWarn(`视频${vodId}详情为空`);
                    return;
                }

                const vod = detailData.vodInfo;

                // 构建新格式的播放源
                const vodPlaySources = [];
                const scrapeCandidates = [];
                if (playData?.list) {
                    playData.list.forEach((item, index) => {
                        if (!item.play) return;

                        const resolutions = [];
                        const params = [];

                        for (const [key, val] of Object.entries(item.play)) {
                            if (val.param) {
                                resolutions.push(key);
                                params.push(val.param);
                            }
                        }

                        if (params.length > 0) {
                            resolutions.sort((a, b) => getResolutionScore(b) - getResolutionScore(a));
                            const playName = playData.list.length === 1 
                                ? (vod.vod_name || '正片') 
                                : (item.name || (index + 1).toString());
                            const playUrl = `${params[0]}||${resolutions.join('@')}`;
                            
                            // 只添加第一个线路，所有集数都在这个线路下
                            if (vodPlaySources.length === 0) {
                                vodPlaySources.push({
                                    name: '瓜子专线',
                                    episodes: []
                                });
                            }

                            const playIdForSource = `${playUrl}|||${encodeMeta({ v: vod.vod_name || '', e: playName, sid: `${videoIdForScrape}#${index}`, fid: `${videoIdForScrape}#${index}` })}`;

                            vodPlaySources[0].episodes.push({
                                name: playName,
                                playId: playIdForSource
                            });

                            scrapeCandidates.push({
                                fid: `${videoIdForScrape}#${index}`,
                                file_id: `${videoIdForScrape}#${index}`,
                                file_name: playName,
                                name: playName,
                                format_type: 'video'
                            });
                        }
                    });
                }

                let scrapeData = null;
                let videoMappings = [];
                if (scrapeCandidates.length > 0) {
                    try {
                        // 以视频ID作为刮削资源ID，保证同一条目下刮削结果稳定复用
                        const sourceId = `spider_source_${await OmniBox.getSourceId()}_${videoId}`;
                        const scrapingResult = await OmniBox.processScraping(sourceId, vod.vod_name || '', vod.vod_name || '', scrapeCandidates);
                        OmniBox.log('info', `[瓜子APP] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);
                        const metadata = await OmniBox.getScrapeMetadata(sourceId);
                        scrapeData = metadata?.scrapeData || null;
                        videoMappings = metadata?.videoMappings || [];
                        logInfo('刮削完成', { vodId, mappingCount: videoMappings.length, hasScrapeData: !!scrapeData });
                    } catch (e) {
                        logWarn(`刮削处理失败: ${e.message}`);
                    }
                }

                if (vodPlaySources.length > 0 && Array.isArray(vodPlaySources[0].episodes) && vodPlaySources[0].episodes.length > 0) {
                    vodPlaySources[0].episodes.forEach((ep) => {
                        const playIdRaw = ep.playId || '';
                        const metaRaw = playIdRaw.includes('|||') ? playIdRaw.split('|||')[1] : '';
                        const meta = decodeMeta(metaRaw || '');
                        const mapping = videoMappings.find((m) => m?.fileId === meta.fid);
                        if (mapping?.episodeName) {
                            const oldName = ep.name;
                            ep.name = mapping.episodeName;
                            if (oldName !== ep.name) {
                                OmniBox.log('info', `[瓜子APP] 应用刮削后源文件名: ${oldName} -> ${ep.name}`);
                            }
                        }
                    });

                    const hasEpisodeNumber = vodPlaySources[0].episodes.some((ep) => {
                        const playIdRaw = ep.playId || '';
                        const metaRaw = playIdRaw.includes('|||') ? playIdRaw.split('|||')[1] : '';
                        const meta = decodeMeta(metaRaw || '');
                        const mapping = videoMappings.find((m) => m?.fileId === meta.fid);
                        return mapping && mapping.episodeNumber !== undefined && mapping.episodeNumber !== null;
                    });

                    if (hasEpisodeNumber) {
                        vodPlaySources[0].episodes.sort((a, b) => {
                            const metaA = decodeMeta((a.playId || '').split('|||')[1] || '');
                            const metaB = decodeMeta((b.playId || '').split('|||')[1] || '');
                            const mapA = videoMappings.find((m) => m?.fileId === metaA.fid) || {};
                            const mapB = videoMappings.find((m) => m?.fileId === metaB.fid) || {};
                            const seasonA = mapA.seasonNumber || 0;
                            const seasonB = mapB.seasonNumber || 0;
                            if (seasonA !== seasonB) return seasonA - seasonB;
                            const epA = mapA.episodeNumber || 0;
                            const epB = mapB.episodeNumber || 0;
                            return epA - epB;
                        });
                    }
                }

                const video = {
                    vod_id: videoIdForScrape,
                    vod_name: scrapeData?.title || vod.vod_name,
                    vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : vod.vod_pic,
                    vod_year: scrapeData?.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : vod.vod_year,
                    vod_area: vod.vod_area,
                    vod_actor: (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(',') || vod.vod_actor,
                    vod_director: (scrapeData?.credits?.crew || []).filter((c) => c?.job === 'Director' || c?.department === 'Directing').slice(0, 3).map((c) => c?.name).filter(Boolean).join(',') || '',
                    vod_content: (scrapeData?.overview || vod.vod_use_content || '').trim(),
                    vod_play_sources: vodPlaySources.length > 0 ? vodPlaySources : undefined
                };

                results.push(video);
            } catch (e) {
                logError(`获取视频${idStr}详情失败`, e);
            }
        }));

        logInfo('详情获取成功', { count: results.length });

        return { list: results };
    } catch (error) {
        logError('获取视频详情失败', error);
        return { list: [] };
    }
}

/**
 * 获取播放地址
 */
async function play(params) {
    try {
        let playId = params.playId;
        let vodName = '';
        let episodeName = '';
        let playMeta = {};

        if (!playId) {
            throw new Error("播放地址ID不能为空");
        }

        if (playId.includes('|||')) {
            const [mainPlayId, metaB64] = playId.split('|||');
            playId = mainPlayId;
            playMeta = decodeMeta(metaB64 || '');
            vodName = playMeta.v || '';
            episodeName = playMeta.e || '';
        }

        // 统一使用 videoId 维度读取刮削元数据，与 detail 阶段保持一致
        let scrapedDanmuFileName = '';
        try {
            const videoIdFromParam = params.vodId ? String(params.vodId) : '';
            const videoIdFromMeta = playMeta?.sid ? String(playMeta.sid).split('#')[0] : '';
            const videoId = videoIdFromParam || videoIdFromMeta;
            const sourceIdByVod = videoId
                ? `spider_source_${await OmniBox.getSourceId()}_${videoId}`
                : '';

            let metadata = null;
            if (sourceIdByVod) {
                metadata = await OmniBox.getScrapeMetadata(sourceIdByVod);
            }

            if (metadata && metadata.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                scrapedDanmuFileName = buildScrapedDanmuFileName(metadata.scrapeData, metadata.scrapeType || '', mapping, vodName, episodeName);
                if (metadata.scrapeData.title) {
                    vodName = metadata.scrapeData.title;
                }
                if (mapping?.episodeName) {
                    episodeName = mapping.episodeName;
                }
            }
        } catch (e) {
            logWarn(`读取刮削元数据失败: ${e.message}`);
        }

        logInfo('获取播放地址', { playId: playId.substring(0, 50) + '...' });

        const parts = playId.split('||');
        let playResponse;
        if (parts.length < 2) {
            playResponse = {
                urls: [{ name: '播放', url: playId }],
                parse: 0 
            };
        } else {
            const paramStr = parts[0];
            const resolutions = parts[1].split('@');

            const requestParams = {};
            paramStr.split('&').forEach(pair => {
                const [k, v] = pair.split('=');
                if (k) requestParams[k] = v || '';
            });

            if (resolutions.length > 0) {
                resolutions.sort((a, b) => getResolutionScore(b) - getResolutionScore(a));
                requestParams.resolution = resolutions[0];
            }

            const data = await apiRequest(requestParams, API_PATHS.VURL_DETAIL, 'play');

            const playUrl = data?.url || '';
            
            logInfo('播放地址获取成功', { url: playUrl.substring(0, 50) + '...' });

            playResponse = {
                urls: [{ name: '播放', url: playUrl }],
                parse: 0
            };
        }

        if (DANMU_API && vodName) {
            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
            logInfo(`尝试匹配弹幕文件名: ${fileName}`);
            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                    logInfo('弹幕已添加到播放响应');
                }
            }
        } else if (!DANMU_API) {
            logInfo('DANMU_API 未配置，跳过弹幕匹配');
        }

        return playResponse;
    } catch (error) {
        logError('获取播放地址失败', error);
        return {
            urls: [],
            parse: 0
        };
    }
}

/* ============================================================================
 * 导出模块
 * ============================================================================ */

module.exports = {
    home,
    category,
    search,
    detail,
    play
};

// 使用 OmniBox runner
const runner = require("spider_runner");
runner.run(module.exports);
