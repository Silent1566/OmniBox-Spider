// @name iKanBot
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios, cheerio
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/iKanBot.js


/**
 * ============================================================================
 * iKanBot资源 - OmniBox 爬虫脚本
 * ============================================================================
 */
const axios = require("axios");
const cheerio = require("cheerio");
const http = require("http");
const https = require("https");
const OmniBox = require("omnibox_sdk");

// ========== 全局配置 ==========
const ikanbotConfig = {
    host: "https://www1.ikanbot.com",
    headers: {
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1"
    }
};
const DANMU_API = process.env.DANMU_API || "";

const axiosInstance = axios.create({
    timeout: 15000,
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
    httpAgent: new http.Agent({ keepAlive: true })
});

const PAGE_LIMIT = 20;

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
    const output = data ? `${message}: ${JSON.stringify(data)}` : message;
    OmniBox.log("info", `[iKanBot-DEBUG] ${output}`);
};

const logError = (message, error) => {
    OmniBox.log("error", `[iKanBot-DEBUG] ${message}: ${error.message || error}`);
};

const encodeMeta = (obj) => {
    try {
        return Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64');
    } catch {
        return '';
    }
};

const decodeMeta = (str) => {
    try {
        const raw = Buffer.from(str || '', 'base64').toString('utf8');
        return JSON.parse(raw || '{}');
    } catch {
        return {};
    }
};

/**
 * 图像地址修复 - 保留原版复杂逻辑
 */
const fixImageUrl = (imageUrl, baseURL = "", referer = "") => {
    if (!imageUrl) return '';

    let url = '';

    if (imageUrl.startsWith('http')) {
        url = imageUrl;
    } else if (imageUrl.startsWith('//')) {
        url = 'https:' + imageUrl;
    } else if (imageUrl.startsWith('/')) {
        url = ikanbotConfig.host + imageUrl;
    } else {
        url = ikanbotConfig.host + '/' + imageUrl.replace(/^\.?\//, '');
    }

    const isExternalUrl = !url.includes(ikanbotConfig.host) && url.startsWith('http');
    const isDouban = url.includes('doubanio.com');

    if (isDouban) {
        try {
            const finalReferer = referer || 'https://movie.douban.com';
            const urlWithHeaders = `${url}@Referer=${finalReferer}`;
            const encodedUrl = encodeURIComponent(urlWithHeaders);
            const proxyUrl = `${baseURL}/api/proxy/image?url=${encodedUrl}`;
            // logInfo("图片分组: 豆瓣代理", { input: imageUrl, finalUrl: url, referer: finalReferer, result: proxyUrl });
            return proxyUrl;
        } catch (error) {
            logError("处理豆瓣图片失败", error);
            return url;
        }
    }

    if (isExternalUrl) {
        try {
            let finalReferer = referer;
            if (!finalReferer) {
                try {
                    const urlObj = new URL(url);
                    finalReferer = `${urlObj.protocol}//${urlObj.host}`;
                } catch {
                    finalReferer = ikanbotConfig.host;
                }
            }
            const urlWithHeaders = `${url}@Referer=${finalReferer}`;
            const encodedUrl = encodeURIComponent(urlWithHeaders);
            const proxyUrl = `${baseURL}/api/proxy/image?url=${encodedUrl}`;
            // logInfo("图片分组: 外部代理", { input: imageUrl, finalUrl: url, referer: finalReferer, result: proxyUrl });
            return proxyUrl;
        } catch (error) {
            logError("处理图片 URL 失败", error);
            return url;
        }
    }

    // logInfo("图片分组: 直连", { input: imageUrl, finalUrl: url, result: url });
    return url;
};

// ========== 弹幕工具函数 ==========
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

const buildScrapedEpisodeName = (scrapeData, mapping, originalName) => {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return originalName;
    }
    if (mapping.episodeName) {
        const epName = mapping.episodeNumber + "." + mapping.episodeName;
        return epName;
    }
    if (scrapeData && Array.isArray(scrapeData.episodes)) {
        const hit = scrapeData.episodes.find((ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber);
        if (hit?.name) {
            return `${hit.episodeNumber}.${hit.name}`;
        }
    }
    return originalName;
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
        if (!matchData.isMatched) {
            logInfo("弹幕未匹配到");
            return [];
        }

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
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
};

/**
 * 获取HTML内容
 */
const getHtml = async (url, headers = ikanbotConfig.headers) => {
    try {
        const response = await axiosInstance.get(url, { headers });
        return response.data;
    } catch (error) {
        logError(`获取HTML失败: ${url}`, error);
        return null;
    }
};

/**
 * 提取token逻辑 - 保留原版算法
 */
const extractToken = ($) => {
    const currentId = $('#current_id').val();
    let eToken = $('#e_token').val();
    if (!currentId || !eToken) return '';
    
    const idLength = currentId.length;
    const subId = currentId.substring(idLength - 4, idLength);
    let keys = [];
    
    for (let i = 0; i < subId.length; i++) {
        const curInt = parseInt(subId[i]);
        const splitPos = curInt % 3 + 1;
        keys[i] = eToken.substring(splitPos, splitPos + 8);
        eToken = eToken.substring(splitPos + 8, eToken.length);
    }
    
    return keys.join('');
};

/**
 * 解析播放源 - 适配 OmniBox 格式
 */
const parsePlaySourcesFromIkan = (playFrom, playList, vodName = '', videoId = '') => {
    // logInfo("开始解析iKanBot播放源", { from: playFrom, list: playList });
    
    const playSources = [];
    if (!playFrom || !playList) return playSources;
    
    const froms = playFrom.split('$$$');
    const urls = playList.split('$$$');
    
    for (let i = 0; i < froms.length; i++) {
        const sourceName = froms[i] || `线路${i + 1}`;
        const sourceItems = urls[i] ? urls[i].split('#') : [];
        
        const episodes = sourceItems.map((item, epIndex) => {
            const parts = item.split('$');
            const episodeName = parts[0] || '正片';
            const actualPlayId = parts[1] || parts[0];
            const fid = `${videoId}#${i}#${epIndex}`;
            return {
                name: episodeName,
                playId: `${actualPlayId}|||${encodeMeta({ sid: videoId, fid, v: vodName || '', e: episodeName })}`,
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
    
    // logInfo("播放源解析结果", playSources);
    return playSources;
};

// ========== 接口实现 ==========

/**
 * 首页
 */
async function home(params, context) {
    logInfo("进入首页");
    
    try {
        const baseURL = params?.context?.baseURL || params?.baseURL || "";
        // 获取分类
        const classes = [];
        
        // 电影分类
        const movieHtml = await getHtml(ikanbotConfig.host + "/hot/index-movie-热门.html");
        if (movieHtml) {
            const $ = cheerio.load(movieHtml);
            const title = $('title:first').text().split('-')[0].substring(2);
            classes.push({
                type_id: "/hot/index-movie-热门.html",
                type_name: title
            });
        }
        
        // 电视剧分类
        const tvHtml = await getHtml(ikanbotConfig.host + "/hot/index-tv-热门.html");
        if (tvHtml) {
            const $ = cheerio.load(tvHtml);
            const title = $('title:first').text().split('-')[0].substring(2);
            classes.push({
                type_id: "/hot/index-tv-热门.html",
                type_name: title
            });
        }
        
        // 获取首页推荐
        const html = await getHtml(ikanbotConfig.host);
        const list = [];
        
        if (html) {
            const $ = cheerio.load(html);
            const items = $('div.v-list a.item');
            
            items.each((_, item) => {
                const img = $(item).find('img:first');
                const imgSrc = img.attr('data-src') || img.attr('src') || '';
                
                list.push({
                    vod_id: $(item).attr('href'),
                    vod_name: img.attr('alt') || $(item).find('.title').text() || '未知标题',
                    vod_pic: fixImageUrl(imgSrc, context.baseURL),
                    vod_remarks: $(item).find('.label').text() || ''
                });
            });
        }
        
        return {
            class: classes,
            list: list.slice(0, 20)
        };
    } catch (e) {
        logError("首页获取失败", e);
        return { class: [], list: [] };
    }
}

/**
 * 分类列表
 */
async function category(params, context) {
    const { categoryId, page } = params;
    const pg = parseInt(page) || 1;
    const baseURL = context?.baseURL || params?.baseURL || "";
    
    logInfo(`请求分类: ${categoryId}, 页码: ${pg}`);
    
    try {
        const link = ikanbotConfig.host + categoryId.replace('.html', pg > 1 ? `-p-${pg}.html` : '.html');
        const html = await getHtml(link);
        
        if (!html) {
            return { list: [], page: pg, pagecount: 1 };
        }
        
        const $ = cheerio.load(html);
        const items = $('div.v-list a.item');
        const list = [];
        
        items.each((_, item) => {
            const img = $(item).find('img:first');
            const imgSrc = img.attr('data-src') || img.attr('src') || '';
            
            list.push({
                vod_id: $(item).attr('href'),
                vod_name: img.attr('alt') || $(item).text().trim(),
                vod_pic: fixImageUrl(imgSrc, baseURL),
                vod_remarks: $(item).find('.label').text() || ''
            });
        });
        
        return {
            list: list,
            page: pg,
            pagecount: list.length >= PAGE_LIMIT ? pg + 1 : pg
        };
    } catch (e) {
        logError("分类请求失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
 * 详情页
 */
async function detail(params, context) {
    const videoId = params.videoId;
    const baseURL = context?.baseURL || params?.baseURL || "";
    logInfo(`请求详情 ID: ${videoId}`);
    
    try {
        const html = await getHtml(ikanbotConfig.host + videoId);
        if (!html) return { list: [] };
        
        const $ = cheerio.load(html);
        const detail = $('div.detail');
        
        // 获取封面图片
        const coverImg = $('div.item-root > img');
        const coverSrc = coverImg.attr('data-src') || coverImg.attr('src') || '';
        
        // 提取token
        const token = extractToken($);
        const pureVideoId = videoId.substring(videoId.lastIndexOf('/') + 1);
        
        // 获取播放资源
        const resUrl = ikanbotConfig.host + '/api/getResN?videoId=' + pureVideoId + '&mtype=2&token=' + token;
        const resResponse = await axiosInstance.get(resUrl, {
            headers: {
                ...ikanbotConfig.headers,
                'Referer': ikanbotConfig.host
            }
        });
        
        const resData = resResponse.data;
        const apiList = resData.data?.list || [];
        
        let playlist = {};
        let arr = [];
        
        // 解析播放源
        for (const l of apiList) {
            try {
                const flagData = JSON.parse(l.resData);
                for (const f of flagData) {
                    const from = f.flag;
                    const urls = f.url;
                    if (!from || !urls) continue;
                    if (playlist[from]) continue;
                    playlist[from] = urls;
                }
            } catch (e) {
                logError('解析播放源失败', e);
            }
        }
        
        // 排序播放源
        for (const key in playlist) {
            if ('kuaikan' === key) {
                arr.push({ flag: '快看', url: playlist[key], sort: 1 });
            } else if ('bfzym3u8' === key) {
                arr.push({ flag: '暴风', url: playlist[key], sort: 2 });
            } else if ('ffm3u8' === key) {
                arr.push({ flag: '非凡', url: playlist[key], sort: 3 });
            } else if ('lzm3u8' === key) {
                arr.push({ flag: '量子', url: playlist[key], sort: 4 });
            } else {
                arr.push({ flag: key, url: playlist[key], sort: 5 });
            }
        }
        
        arr.sort((a, b) => a.sort - b.sort);
        
        // 获取影片基本信息
        const title = $(detail).find('h2').text().trim();
        const actor = $(detail).find('h3:nth-child(5)').text();
        const director = $(detail).find('h3:nth-child(4)').text() || '';

        const playFrom = arr.map(val => val.flag).join("$$$");
        const playList = arr.map(val => val.url).join("$$$");
        
        // 解析为 OmniBox 格式
        const playSources = parsePlaySourcesFromIkan(playFrom, playList, title, String(videoId || ''));

        // 刮削处理
        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = '';
        const scrapeCandidates = [];

        for (const source of playSources) {
            for (const ep of source.episodes || []) {
                if (!ep._fid) continue;
                scrapeCandidates.push({
                    fid: ep._fid,
                    file_id: ep._fid,
                    file_name: ep._rawName || ep.name || '正片',
                    name: ep._rawName || ep.name || '正片',
                    format_type: 'video',
                });
            }
        }

        if (scrapeCandidates.length > 0) {
            try {
                const videoIdForScrape = String(videoId || '');
                const scrapingResult = await OmniBox.processScraping(videoIdForScrape, title || '', title || '', scrapeCandidates);
                OmniBox.log('info', `[iKanBot-DEBUG] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);

                const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
                scrapeData = metadata?.scrapeData || null;
                videoMappings = metadata?.videoMappings || [];
                scrapeType = metadata?.scrapeType || '';
            } catch (e) {
                logError('刮削处理失败', e);
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
                    OmniBox.log('info', `[iKanBot-DEBUG] 应用刮削后源文件名: ${oldName} -> ${newName}`);
                }
                ep._seasonNumber = mapping.seasonNumber;
                ep._episodeNumber = mapping.episodeNumber;
            }

            const hasEpisodeNumber = (source.episodes || []).some((ep) => ep._episodeNumber !== undefined && ep._episodeNumber !== null);
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
        
        const fixedRemarks = '(线路利用网络爬虫技术获取,各线路的版本、清晰度、播放速度等存在差异请自行切换。建议避开晚上高峰时段。)';
        
        return {
            list: [{
                vod_id: videoId,
                vod_name: scrapeData?.title || title,
                vod_pic: scrapeData?.posterPath ? fixImageUrl(`https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`, baseURL) : fixImageUrl(coverSrc, baseURL),
                vod_content: fixedRemarks,
                vod_actor: (scrapeData?.credits?.cast || []).slice(0, 5).map((c) => c?.name).filter(Boolean).join(',') || actor,
                vod_director: (scrapeData?.credits?.crew || []).filter((c) => c?.job === 'Director' || c?.department === 'Directing').slice(0, 3).map((c) => c?.name).filter(Boolean).join(',') || director,
                vod_remarks: '',
                vod_play_sources: normalizedPlaySources
            }]
        };
    } catch (e) {
        logError("详情获取失败", e);
        return { list: [] };
    }
}

/**
 * 搜索 - 保留严格匹配逻辑
 */
async function search(params, context) {
    const wd = params.keyword || params.wd || "";
    const pg = parseInt(params.page) || 1;
    const baseURL = context?.baseURL || params?.baseURL || "";
    
    logInfo(`搜索关键词: ${wd}, 页码: ${pg}`);
    
    try {
        const link = pg === 1
            ? ikanbotConfig.host + '/search?q=' + encodeURIComponent(wd)
            : ikanbotConfig.host + '/search?q=' + encodeURIComponent(wd) + '&p=' + pg;
        
        const html = await getHtml(link);
        if (!html) return { list: [], page: pg, pagecount: 1 };
        
        const $ = cheerio.load(html);
        const items = $('div.media');
        
        // 获取所有结果
        const allResults = [];
        items.each((_, item) => {
            const a = $(item).find('a:first');
            const img = $(item).find('img:first');
            const imgSrc = img.attr('data-src') || img.attr('src') || '';
            const remarks = $(item).find('span.label').first().text().trim();
            const title = img.attr('alt') || a.text().trim();
            
            allResults.push({
                vod_id: a.attr('href'),
                vod_name: title,
                vod_pic: fixImageUrl(imgSrc, baseURL),
                vod_remarks: remarks || '',
                originalTitle: title
            });
        });
        
        // 严格过滤:检查标题是否包含完整的搜索关键字
        const lowerKeyword = wd.toLowerCase().trim();
        const filteredList = allResults.filter(item => {
            const lowerTitle = item.vod_name.toLowerCase();
            
            // 1. 完全包含关键字
            if (lowerTitle.includes(lowerKeyword)) {
                return true;
            }
            
            // 2. 处理可能的关键字分割
            if (lowerKeyword.length >= 2) {
                const cleanTitle = lowerTitle.replace(/[·\-_:()()《》【】\s]/g, '');
                const cleanKeyword = lowerKeyword.replace(/[·\-_:()()《》【】\s]/g, '');
                
                if (cleanTitle.includes(cleanKeyword)) {
                    return true;
                }
                
                // 如果是中文,尝试字符级别匹配
                if (/[\u4e00-\u9fa5]/.test(lowerKeyword)) {
                    const keywordChars = cleanKeyword.split('');
                    return keywordChars.every(char => cleanTitle.includes(char));
                }
            }
            
            return false;
        });
        
        // 移除用于过滤的字段
        const finalList = filteredList.map(({ originalTitle, ...rest }) => rest);
        
        return {
            list: finalList,
            page: pg,
            pagecount: finalList.length >= PAGE_LIMIT ? pg + 1 : pg
        };
    } catch (e) {
        logError("搜索失败", e);
        return { list: [], page: pg, pagecount: 0 };
    }
}

/**
 * 播放
 */
async function play(params) {
    let playId = params.playId;
    logInfo(`准备播放 ID: ${playId}`);
    let vodName = "";
    let episodeName = "";
    let playMeta = {};
    let scrapedDanmuFileName = "";

    if (playId && playId.includes('|||')) {
        const [mainPlayId, metaB64] = playId.split('|||');
        playId = mainPlayId || '';
        playMeta = decodeMeta(metaB64 || '');
        vodName = playMeta.v || '';
        episodeName = playMeta.e || '';
        logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    } else if (playId && playId.includes('|')) {
        const parts = playId.split('|');
        playId = parts.shift() || '';
        vodName = parts.shift() || '';
        episodeName = parts.join('|') || '';
        logInfo(`解析旧透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    }

    try {
        const sourceVideoId = String(params.vodId || playMeta.sid || '');
        if (sourceVideoId) {
            const metadata = await OmniBox.getScrapeMetadata(sourceVideoId);
            if (metadata && metadata.scrapeData) {
                const mapping = (metadata.videoMappings || []).find((m) => m?.fileId === playMeta?.fid);
                scrapedDanmuFileName = buildScrapedDanmuFileName(
                    metadata.scrapeData,
                    metadata.scrapeType || '',
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
    } catch (e) {
        logInfo(`读取刮削元数据失败: ${e.message}`);
    }
    
    // iKanBot 播放地址处理，支持嗅探
    let playUrl = playId;
    if (playUrl && !playUrl.startsWith('http')) {
        playUrl = playUrl.startsWith('/') ? ikanbotConfig.host + playUrl : ikanbotConfig.host + '/' + playUrl;
    }

    const isDirectPlayable = playUrl && playUrl.match(/\.(m3u8|mp4|flv|avi|mkv|ts)/i);
    let finalUrl = playUrl;
    let finalHeader = { ...ikanbotConfig.headers, Referer: ikanbotConfig.host };

    if (!isDirectPlayable && playUrl) {
        try {
            const sniffResult = await OmniBox.sniffVideo(playUrl);
            if (sniffResult && sniffResult.url) {
                finalUrl = sniffResult.url;
                finalHeader = sniffResult.header || finalHeader;
                logInfo("嗅探成功", { url: finalUrl });
            } else {
                logInfo("嗅探未返回有效地址");
            }
        } catch (e) {
            logInfo(`嗅探失败: ${e.message}`);
        }
    }

    const playResponse = {
        urls: [{ name: "默认", url: finalUrl }],
        parse: 0,
        header: finalHeader
    };

    if (DANMU_API && vodName) {
        const fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
        logInfo(`尝试匹配弹幕文件名: ${fileName}`);
        if (fileName) {
            const danmakuList = await matchDanmu(fileName);
            if (danmakuList.length > 0) {
                playResponse.danmaku = danmakuList;
                logInfo("弹幕已添加到播放响应");
            }
        }
    } else if (!DANMU_API) {
        logInfo("DANMU_API 未配置，跳过弹幕匹配");
    }

    return playResponse;
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
