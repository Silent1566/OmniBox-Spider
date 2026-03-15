// @name 樱花动漫
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/动漫/樱花动漫.js
/**
* ============================================================================
* 樱花动漫资源 - OmniBox 爬虫脚本（添加弹幕支持）
* ============================================================================
*/
// @version 1.0.1
const axios = require("axios");
const http = require("http");
const https = require("https");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const yinghuaConfig = {
    host: "https://www.dmvvv.com",
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.dmvvv.com/",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    }
};

const PAGE_LIMIT = 36;

// 弹幕API配置
const DANMU_API = process.env.DANMU_API || "";

const axiosInstance = axios.create({
    timeout: 15000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false, family: 4 }),
    httpAgent: new http.Agent({ keepAlive: true }),
});

/**
* 日志工具函数
*/
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[樱花动漫-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[樱花动漫-DEBUG] ${message}: ${error.message || error}`);
};

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

// ========== 弹幕相关函数 ==========

/**
* 预处理标题，去掉常见干扰项
*/
function preprocessTitle(title) {
    if (!title) return "";
    return title
        .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
        .replace(/[hH]\.?26[45]/g, " ")
        .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
        .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

/**
* 将中文数字转换为阿拉伯数字
*/
function chineseToArabic(cn) {
    const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
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
*/
function extractEpisode(title) {
    if (!title) return "";

    const processedTitle = preprocessTitle(title).trim();

    // 1. 中文格式：第XX集/话
    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));

    // 2. S01E03 格式
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];

    // 3. EP/E 格式
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];

    // 4. 括号格式 [03]
    const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
    if (bracketMatch) {
        const num = bracketMatch[1];
        if (!["720", "1080", "480"].includes(num)) return num;
    }

    return "";
}

/**
* 构建用于弹幕匹配的文件名
*/
function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";

    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
        return vodName;
    }

    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) {
            if (epNum < 10) {
                return `${vodName} S01E0${epNum}`;
            } else {
                return `${vodName} S01E${epNum}`;
            }
        }
    }

    return vodName;
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return originalName;
    }
    if (mapping.episodeName) {
        return mapping.episodeName;
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
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
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
}

/**
* 匹配弹幕
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

        if (!matchData.isMatched) {
            logInfo("弹幕未匹配到");
            return [];
        }

        const matches = matchData.matches || [];
        if (matches.length === 0) {
            return [];
        }

        const firstMatch = matches[0];
        const episodeId = firstMatch.episodeId;
        const animeTitle = firstMatch.animeTitle || "";
        const episodeTitle = firstMatch.episodeTitle || "";

        if (!episodeId) {
            return [];
        }

        let danmakuName = "弹幕";
        if (animeTitle && episodeTitle) {
            danmakuName = `${animeTitle} - ${episodeTitle}`;
        } else if (animeTitle) {
            danmakuName = animeTitle;
        } else if (episodeTitle) {
            danmakuName = episodeTitle;
        }

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

// ========== 辅助函数 ==========

/**
* 解析首页列表
*/
const parseHomeList = (html) => {
    const list = [];
    const $ = cheerio.load(html);

    $('li').each((i, item) => {
        const $item = $(item);
        const $link = $item.find('a');
        const href = $link.attr('href');
        const title = $link.attr('title');
        const pic = $item.find('img').data('original') || $item.find('img').attr('src');
        const remarks = $item.find('p').text().trim();

        if (href && href.includes('/detail/') && title) {
            list.push({
                vod_id: href,
                vod_name: title.trim(),
                vod_pic: pic || '',
                vod_remarks: remarks || ''
            });
        }
    });

    return list;
};

/**
* 解析总页数
*/
const parsePageCount = (html, tid) => {
    const $ = cheerio.load(html);
    let maxPage = 1;

    if (tid) {
        const pattern = new RegExp(`/type/${tid}/(\\d+)/`, 'g');
        let match;
        while ((match = pattern.exec(html)) !== null) {
            maxPage = Math.max(maxPage, parseInt(match[1]));
        }
    }

    const pattern2 = /\/type\/[^/]+\/(\d+)\//g;
    let match2;
    while ((match2 = pattern2.exec(html)) !== null) {
        maxPage = Math.max(maxPage, parseInt(match2[1]));
    }

    const pattern3 = /[?&]page(?:no)?=(\d+)/g;
    let match3;
    while ((match3 = pattern3.exec(html)) !== null) {
        maxPage = Math.max(maxPage, parseInt(match3[1]));
    }

    return maxPage;
};

/**
* 解析播放源字符串为结构化数组（支持透传参数）
*/
const parsePlaySources = (fromStr, urlStr, vodName, videoId = "") => {
    logInfo("开始解析播放源字符串", { from: fromStr, url: urlStr });
    const playSources = [];
    if (!fromStr || !urlStr) return playSources;

    const froms = fromStr.split('$$$');
    const urls = urlStr.split('$$$');

    for (let i = 0; i < froms.length; i++) {
        const sourceName = froms[i] || `线路${i + 1}`;
        const sourceItems = urls[i] ? urls[i].split('#') : [];

        const episodes = sourceItems.map((item, epIndex) => {
            const parts = item.split('$');
            const episodeName = parts[0] || '正片';
            const actualUrl = parts[1] || parts[0];
            const fid = `${videoId}#${i}#${epIndex}`;
            const combinedId = `${actualUrl}|||${encodeMeta({ sid: videoId, fid, v: vodName || "", e: episodeName })}`;

            return {
                name: episodeName,
                playId: combinedId,
                _fid: fid,
                _rawName: episodeName,
            };
        }).filter(e => e.playId);

        if (episodes.length > 0) {
            playSources.push({
                name: sourceName,
                episodes: episodes
            });
        }
    }
    logInfo("播放源解析结果", playSources);
    return playSources;
};

// ========== 接口实现 ==========

/**
* 首页接口
*/
async function home(params) {
    logInfo("进入首页");

    try {
        const url = yinghuaConfig.host + "/";
        const response = await axiosInstance.get(url, { headers: yinghuaConfig.headers });
        const html = response.data;

        const list = parseHomeList(html);

        const seen = new Set();
        const uniqueList = list.filter(item => {
            if (seen.has(item.vod_id)) {
                return false;
            }
            seen.add(item.vod_id);
            return true;
        });

        logInfo(`获取到 ${uniqueList.length} 个首页推荐`);

        return {
            class: [
                { 'type_id': 'guoman', 'type_name': '国产动漫' },
                { 'type_id': 'riman', 'type_name': '日本动漫' },
                { 'type_id': 'oman', 'type_name': '欧美动漫' },
                { 'type_id': 'dmfilm', 'type_name': '动漫电影' }
            ],
            list: uniqueList.slice(0, 20)
        };
    } catch (e) {
        logError("首页获取失败", e);
        return {
            class: [
                { 'type_id': 'guoman', 'type_name': '国产动漫' },
                { 'type_id': 'riman', 'type_name': '日本动漫' },
                { 'type_id': 'oman', 'type_name': '欧美动漫' },
                { 'type_id': 'dmfilm', 'type_name': '动漫电影' }
            ],
            list: []
        };
    }
}

/**
* 分类接口
*/
async function category(params) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);

    try {
        let url;
        if (pg <= 1) {
            url = `${yinghuaConfig.host}/type/${categoryId}/`;
        } else {
            url = `${yinghuaConfig.host}/type/${categoryId}/${pg}/`;
        }

        const response = await axiosInstance.get(url, { headers: yinghuaConfig.headers });
        const html = response.data;

        const list = parseHomeList(html);
        const maxPage = parsePageCount(html, categoryId) || (list.length >= PAGE_LIMIT ? pg + 1 : pg);

        logInfo(`分类 ${categoryId} 第 ${pg} 页获取到 ${list.length} 个项目`);

        return {
            list: list,
            page: pg,
            pagecount: maxPage
        };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 1 };
    }
}

/**
* 详情接口
*/
async function detail(params) {
    const videoId = params.videoId;
    logInfo(`请求详情 ID: ${videoId}`);

    try {
        const detailUrl = videoId.startsWith('http') ? videoId : yinghuaConfig.host + videoId;

        const response = await axiosInstance.get(detailUrl, { headers: yinghuaConfig.headers });
        const html = response.data;
        const $ = cheerio.load(html);

        let vod_name = '';
        const titleMatch = html.match(/<div class="detail">.*?<h2>([^<]+)<\/h2>/s);
        if (titleMatch) {
            vod_name = titleMatch[1].trim();
        } else {
            const titleMatch2 = html.match(/<title>([^<]+)/);
            if (titleMatch2) {
                vod_name = titleMatch2[1].split('-')[0].trim();
            }
        }

        let vod_pic = '';
        const coverMatch = html.match(/<div class="cover">\s*<img[^>]+data-original="([^"]+)"/);
        if (coverMatch) {
            vod_pic = coverMatch[1];
        }

        const getInfo = (label, useEm = true) => {
            const pattern = useEm
                ? new RegExp(`<span>${label}:<\\/span><em>([^<]+)<\\/em>`)
                : new RegExp(`<span>${label}:<\\/span>([^<]+)`);
            const match = html.match(pattern);
            return match ? match[1].trim() : '';
        };

        const vod_remarks = getInfo('状态', true);
        const vod_year = getInfo('年份', false);
        const vod_area = getInfo('地区', false);
        const vod_type = getInfo('类型', false);
        const vod_actor = getInfo('主演', false);

        let vod_content = '';
        const descMatch = html.match(/class="blurb"[^>]*>.*?<span>[^<]+<\/span>(.*?)<\/li>/s);
        if (descMatch) {
            vod_content = descMatch[1].replace(/<[^>]+>/g, '').trim();
        }

        let totalEpisodes = 0;
        if (vod_remarks) {
            const epMatch = vod_remarks.match(/[共全更新至第]*(\d+)[集话章]/);
            if (epMatch) {
                totalEpisodes = parseInt(epMatch[1]);
            }
        }
        if (totalEpisodes === 0) {
            totalEpisodes = 24;
        }

        const vodId = videoId.replace(/^\/+|\/+$/g, '').split('/').pop();

        const sourceNames = ['高清', 'ikun', '非凡', '量子'];
        const playmap = {};
        const playLines = [];

        for (let sourceIdx = 1; sourceIdx <= 4; sourceIdx++) {
            try {
                const testUrl = `${yinghuaConfig.host}/play/${vodId}-${sourceIdx}-1/`;
                await axiosInstance.get(testUrl, {
                    headers: yinghuaConfig.headers,
                    timeout: 5000
                });

                const episodes = [];
                for (let epIdx = 1; epIdx <= totalEpisodes; epIdx++) {
                    const epName = epIdx < 10 ? `第0${epIdx}集` : `第${epIdx}集`;
                    const epUrl = `/play/${vodId}-${sourceIdx}-${epIdx}/`;
                    episodes.push(`${epName}$${epUrl}`);
                }

                if (episodes.length > 0) {
                    const lineName = sourceNames[sourceIdx - 1];
                    playmap[lineName] = episodes;
                    playLines.push(lineName);
                }
            } catch (err) {
                logInfo(`线路 ${sourceNames[sourceIdx - 1]} 不可用`);
                continue;
            }
        }

        const vod_play_from = playLines.join('$$$');
        const vod_play_url = playLines.map(line => playmap[line].join('#')).join('$$$');

        // 传入视频名
        const videoIdForScrape = String(videoId || "");
        const playSources = parsePlaySources(vod_play_from, vod_play_url, vod_name, videoIdForScrape);

        // 刮削处理
        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = "";
        const scrapeCandidates = [];

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

        if (scrapeCandidates.length > 0) {
            try {
                const scrapingResult = await OmniBox.processScraping(videoIdForScrape, vod_name || "", vod_name || "", scrapeCandidates);
                OmniBox.log("info", `[樱花动漫-DEBUG] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);
                const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || "";
                logInfo("刮削元数据读取完成", { mappingCount: videoMappings.length, hasScrapeData: !!scrapeData, scrapeType });
            } catch (error) {
                logError("刮削处理失败", error);
            }
        }

        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                const mapping = videoMappings.find((m) => m?.fileId === ep._fid);
                if (!mapping) continue;
                const oldName = ep.name;
                const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
                if (newName && newName !== oldName) {
                    ep.name = newName;
                    OmniBox.log("info", `[樱花动漫-DEBUG] 应用刮削后源文件名: ${oldName} -> ${newName}`);
                }
                ep._seasonNumber = mapping.seasonNumber;
                ep._episodeNumber = mapping.episodeNumber;
            }

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

        const normalizedPlaySources = playSources.map((source) => ({
            name: source.name,
            episodes: (source.episodes || []).map((ep) => ({
                name: ep.name,
                playId: ep.playId,
            })),
        }));

        logInfo("详情获取成功", { vod_name, sources: playSources.length });

        return {
            list: [{
                vod_id: videoIdForScrape,
                vod_name: scrapeData?.title || vod_name,
                vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : vod_pic,
                vod_content: scrapeData?.overview || vod_content,
                vod_play_sources: normalizedPlaySources,
                vod_year: scrapeData?.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : vod_year,
                vod_area: vod_area,
                vod_actor: (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(',') || vod_actor,
                vod_remarks: vod_remarks,
                type_name: vod_type,
                vod_director: (scrapeData?.credits?.crew || []).filter((c) => c?.job === 'Director' || c?.department === 'Directing').slice(0, 3).map((c) => c?.name).filter(Boolean).join(',') || ""
            }]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

/**
* 搜索接口
*/
async function search(params) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);

    try {
        const encodedKeyword = encodeURIComponent(wd);
        let url;
        if (pg <= 1) {
            url = `${yinghuaConfig.host}/search/?wd=${encodedKeyword}`;
        } else {
            url = `${yinghuaConfig.host}/search/?wd=${encodedKeyword}&pageno=${pg}`;
        }

        const response = await axiosInstance.get(url, { headers: yinghuaConfig.headers });
        const html = response.data;

        const list = [];

        const liPattern = /<li>\s*<a class="cover".*?<\/li>/gs;
        const lis = html.match(liPattern) || [];

        lis.forEach(li => {
            const hrefMatch = li.match(/<a class="cover" href="(\/detail\/\d+\/)"/);
            const titleMatch = li.match(/title="([^"]+)"/);
            const coverMatch = li.match(/data-original="([^"]+)"/);
            const remarksMatch = li.match(/<div class="item"><span>状态:<\/span>([^<]*)/);

            if (hrefMatch && titleMatch) {
                list.push({
                    vod_id: hrefMatch[1],
                    vod_name: titleMatch[1].trim(),
                    vod_pic: coverMatch ? coverMatch[1].trim() : '',
                    vod_remarks: remarksMatch ? remarksMatch[1].trim() : ''
                });
            }
        });

        let maxPage = pg;
        const totalMatch = html.match(/找到\s*<em>(\d+)<\/em>/);
        if (totalMatch) {
            const totalCount = parseInt(totalMatch[1]);
            maxPage = Math.ceil(totalCount / 12);
        } else {
            const pagenoPattern = /pageno=(\d+)/g;
            let match;
            while ((match = pagenoPattern.exec(html)) !== null) {
                maxPage = Math.max(maxPage, parseInt(match[1]));
            }
            if (maxPage === pg && list.length >= 12) {
                maxPage = pg + 1;
            }
        }

        logInfo(`搜索 "${wd}" 找到 ${list.length} 个结果`);

        return {
            list: list,
            page: pg,
            pagecount: maxPage
        };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 1 };
    }
}

/**
* 播放接口
*/
async function play(params) {
    let playUrl = params.playId;
    logInfo(`准备播放 URL: ${playUrl}`);

    let vodName = "";
    let episodeName = "";
    let playMeta = {};

    // 解析透传参数
    if (playUrl && playUrl.includes('|||')) {
        const [mainPlayUrl, metaB64] = playUrl.split('|||');
        playUrl = mainPlayUrl;
        playMeta = decodeMeta(metaB64 || "");
        vodName = playMeta.v || "";
        episodeName = playMeta.e || "";
        logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    } else if (playUrl && playUrl.includes('|')) {
        // 兼容旧格式
        const parts = playUrl.split('|');
        playUrl = parts[0];
        vodName = parts[1] || "";
        episodeName = parts[2] || "";
        logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    }

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
        logInfo(`读取刮削元数据失败: ${error.message}`);
    }

    try {
        if (playUrl && !playUrl.startsWith('http')) {
            playUrl = playUrl.startsWith('/')
                ? yinghuaConfig.host + playUrl
                : yinghuaConfig.host + '/' + playUrl;
        }

        logInfo(`处理后的播放URL: ${playUrl}`);

        const response = await axiosInstance.get(playUrl, { headers: yinghuaConfig.headers });
        const html = response.data;

        let playResponse = {
            urls: [{ name: "默认线路", url: playUrl }],
            parse: 0,
            header: {
                "User-Agent": yinghuaConfig.headers["User-Agent"],
                "Referer": yinghuaConfig.host + "/"
            }
        };

        const urlMatch = html.match(/url:\s*'(https?:\/\/[^']+)'/);
        if (urlMatch) {
            logInfo(`找到播放地址: ${urlMatch[1]}`);
            playResponse.urls = [{ name: "默认线路", url: urlMatch[1] }];
        } else {
            const m3u8Match = html.match(/(https?:\/\/[^\s'"]+\.m3u8(?:\?[^\s'">]*)?)/);
            if (m3u8Match) {
                logInfo(`找到m3u8地址: ${m3u8Match[1]}`);
                playResponse.urls = [{ name: "默认线路", url: m3u8Match[1] }];
            }
        }

        // 弹幕匹配
        if (DANMU_API && vodName) {
            const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
            logInfo(`尝试匹配弹幕文件名: ${fileName}`);

            if (fileName) {
                const danmakuList = await matchDanmu(fileName);
                if (danmakuList && danmakuList.length > 0) {
                    playResponse.danmaku = danmakuList;
                    logInfo(`弹幕已添加到播放响应`);
                }
            }
        }

        return playResponse;
    } catch (e) {
        logError("播放地址解析失败", e);
        return {
            urls: [{ name: "默认线路", url: playUrl }],
            parse: 0,
            header: yinghuaConfig.headers
        };
    }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
