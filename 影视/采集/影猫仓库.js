// @name 影猫仓库
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @description 03 + 开心 + 真狼
// @dependencies: axios, crypto, cheerio
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/影猫仓库.js

const axios = require("axios");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");
const crypto = require("crypto");

// ==================== 全局配置 ====================
const HOST = "https://www.ymck.pro";
const PAGE_LIMIT = 20;
// 弹幕 API 地址 (优先读取环境变量)
const DANMU_API = process.env.DANMU_API || "";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  "Referer": `${HOST}/`,
};

const axiosInstance = axios.create({
  timeout: 15000, 
});

let global03yyCookie = "";

// ==================== 日志工具 ====================
const logInfo = (message, data = null) => {
  if (data) {
    OmniBox.log("info", `[影猫] ${message}: ${JSON.stringify(data)}`);
  } else {
    OmniBox.log("info", `[影猫] ${message}`);
  }
};

const logError = (message, error) => {
  OmniBox.log("error", `[影猫] ${message}: ${error?.message || error}`);
};

// ==================== 辅助工具函数 ====================
function d64(text) {
  try { return Buffer.from(String(text || ""), "base64").toString("utf8"); } catch { return ""; }
}

function safeDecode(str) {
  try { return decodeURIComponent(str); } 
  catch (e) { return unescape(str); }
}

function toAbsUrl(url, base = HOST) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function fetchWithCookieRedirect(url, customHeaders = {}) {
  let headers = { "User-Agent": DEFAULT_HEADERS["User-Agent"], ...customHeaders };
  if (global03yyCookie) headers["Cookie"] = global03yyCookie;

  let res = await axiosInstance.get(url, {
    headers: headers,
    maxRedirects: 0,
    validateStatus: status => status >= 200 && status < 400
  });

  if (res.status === 301 || res.status === 302) {
    const cookies = res.headers['set-cookie'];
    const location = res.headers['location'];
    const nextUrl = location ? toAbsUrl(location, "https://www.03yy.live") : url;
    if (cookies) global03yyCookie = cookies.map(c => c.split(';')[0]).join('; ');
    
    headers["Cookie"] = global03yyCookie;
    res = await axiosInstance.get(nextUrl, { headers: headers, maxRedirects: 0 });
  }
  return res;
}

// ==================== 刮削与弹幕辅助模块 (源自 3Q影视) ====================

/**
 * 预处理标题，去掉常见干扰项
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
 * 中文数字转阿拉伯数字
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
 * 提取集数
 */
function extractEpisode(title) {
    if (!title) return "";
    const processedTitle = preprocessTitle(title).trim();
    const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
    if (seMatch) return seMatch[1];
    const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));
    const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
    if (epMatch) return epMatch[1];
    const standaloneMatches = processedTitle.match(/(?:^|[\s\-\._\[\]])(\d{1,3})(?![0-9pP])/g);
    if (standaloneMatches) {
        const candidates = standaloneMatches.map(m => m.match(/\d+/)[0]).filter(n => parseInt(n) > 0 && parseInt(n) < 300);
        if (candidates.length > 0) return candidates[0];
    }
    return "";
}

/**
 * 构建弹幕文件名
 */
function buildFileNameForDanmu(vodName, episodeTitle) {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;
    const digits = extractEpisode(episodeTitle);
    if (digits) {
        const epNum = parseInt(digits, 10);
        if (epNum > 0) return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
    }
    return vodName;
}

/**
 * 构建刮削后的集数名称
 */
const buildScrapedEpisodeName = (scrapeData, mapping, originalName) => {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) return originalName;
    if (mapping.episodeName) return mapping.episodeName;
    if (scrapeData && Array.isArray(scrapeData.episodes)) {
        const hit = scrapeData.episodes.find(ep => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber);
        if (hit?.name) return `${hit.episodeNumber}.${hit.name}`;
    }
    return originalName;
};

/**
 * 匹配弹幕
 */
async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) return [];
    try {
        logInfo(`匹配弹幕: ${fileName}`);
        const matchUrl = `${DANMU_API}/api/v2/match`;
        const response = await OmniBox.request(matchUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": DEFAULT_HEADERS["User-Agent"] },
            body: JSON.stringify({ fileName: fileName }),
        });
        if (response.statusCode !== 200) return [];
        const matchData = JSON.parse(response.body);
        if (!matchData.isMatched || !matchData.matches || matchData.matches.length === 0) return [];
        
        const firstMatch = matchData.matches[0];
        const episodeId = firstMatch.episodeId;
        const danmakuName = firstMatch.animeTitle && firstMatch.episodeTitle ? `${firstMatch.animeTitle} - ${firstMatch.episodeTitle}` : (firstMatch.animeTitle || firstMatch.episodeTitle || "弹幕");
        
        if (!episodeId) return [];
        logInfo(`弹幕匹配成功: ${danmakuName}`);
        return [{ name: danmakuName, url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml` }];
    } catch (error) {
        logInfo(`弹幕匹配失败: ${error.message}`);
        return [];
    }
}

function parseYmckList(html) {
  const $ = cheerio.load(html || "");
  const list = [];
  $(".movie-list-item").each((_, el) => {
    const $a = $(el).find("a").first();
    const href = $a.attr("href") || "";
    let title = $(el).find(".movie-title").attr("title") || $(el).find(".movie-title").text().trim();
    title = title.replace(/影片信息$/, "").trim();
    const pic = $(el).find(".movie-post-lazyload").attr("data-original") || "";
    const match = href.match(/\/movie\/(\d+)\.html/);
    const id = match ? match[1] : href;
    if (title && id) {
      list.push({ vod_id: id, vod_name: title, vod_pic: toAbsUrl(pic), vod_remarks: "" });
    }
  });
  return list;
}

// ==================== 核心接口 ====================

async function home(params) {
  const classes = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "电视剧" },
    { type_id: "5", type_name: "综艺" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "3", type_name: "纪录片" },
  ];
  try {
    const res = await axiosInstance.get(`${HOST}/show/1-----------.html`, { headers: DEFAULT_HEADERS });
    return { class: classes, filters: {}, list: parseYmckList(res.data), page: 1, pagecount: 99, limit: PAGE_LIMIT, total: 999 };
  } catch (e) { 
    logError("首页获取失败", e);
    return { class: classes, list: [], page: 1, pagecount: 1 }; 
  }
}

async function category(params) {
  const tid = params?.categoryId || params?.id || "1";
  const pg = params?.page || 1;
  try {
    const res = await axiosInstance.get(`${HOST}/show/${tid}--------${pg}---.html`, { headers: DEFAULT_HEADERS });
    const list = parseYmckList(res.data);
    return { list: list, page: parseInt(pg), pagecount: list.length > 0 ? parseInt(pg) + 1 : parseInt(pg), limit: PAGE_LIMIT, total: list.length > 0 ? 999 : 0 };
  } catch (e) { 
    logError("分类页获取失败", e);
    return { list: [], page: 1, pagecount: 1 }; 
  }
}

async function search(params) {
  const wd = encodeURIComponent(params?.keyword || params?.wd || "");
  const pg = params?.page || 1;
  try {
    const res = await axiosInstance.get(`${HOST}/search.html?wd=${wd}&page=${pg}`, { headers: DEFAULT_HEADERS });
    const list = parseYmckList(res.data);
    return { list: list, page: parseInt(pg), pagecount: list.length > 0 ? parseInt(pg) + 1 : parseInt(pg), limit: PAGE_LIMIT, total: list.length > 0 ? 999 : 0 };
  } catch (e) { 
    logError("搜索获取失败", e);
    return { list: [], page: 1, pagecount: 1 }; 
  }
}

async function detail(params) {
  const id = params?.videoId || params?.id || "";
  if (!id) return { list: [] };

  try {
    const targetUrl = id.includes("http") ? id : `${HOST}/movie/${id}.html`;
    logInfo("开始请求主站详情页", targetUrl);
    
    const res = await axiosInstance.get(targetUrl, { headers: DEFAULT_HEADERS });
    const $ = cheerio.load(res.data);

    let vodName = $(".movie-title").first().text().trim().replace(/影片信息$/, "").trim();
    if (!vodName) {
      logError("未获取到影片名称，可能网站结构改变");
      return { list: [] };
    }
    
    logInfo("成功获取影片名称", vodName);

    let vodPic = toAbsUrl($(".poster img").attr("src"));
    let vodContent = $(".summary.detailsTxt").last().text().replace("简介：", "").trim();
    let vodYear = "";
    let vodActor = "";
    let vodDirector = "";
    
    let playSources = [];
    let parsed03yy = false;
    let parsedZhenlang = false;
    let parsedKaixin = false;

    // ================= 1. 请求聚合 API =================
    const apiUrl = `${HOST}/API/v2.php?q=${encodeURIComponent(vodName)}&size=50`;
    logInfo("请求聚合API", apiUrl);
    
    try {
      const apiRes = await axiosInstance.get(apiUrl, { headers: { ...DEFAULT_HEADERS, "Accept": "*/*" } });
      const apiData = JSON.parse(d64(apiRes.data));
      logInfo(`聚合API返回数据条数`, apiData.length);

      // 尝试解析 03影院
      const target03yy = apiData.find(item => item && item.url && item.url.includes("03yy.live"));
      if (target03yy) {
        logInfo("发现 03影院 源，开始直析");
        try {
          const res03 = await fetchWithCookieRedirect(target03yy.url, { "Referer": "https://www.03yy.live/" });
          const $$ = cheerio.load(res03.data);
          const tabs = [];
          $$("#playlist li").each((_, el) => {
            tabs.push($$(el).text().replace(/[\uE000-\uF8FF]/g, '').trim());
          });

          $$(".play-box .play_list").each((index, el) => {
            const episodes = [];
            $$(el).find("ul li a").each((_, a) => {
              episodes.push({ name: $$(a).text().trim(), playId: toAbsUrl($$(a).attr("href"), "https://www.03yy.live") });
            });
            if (episodes.length > 0) {
              playSources.push({ name: `03影院 - ${tabs[index] || '线路'+(index+1)}`, episodes });
              parsed03yy = true;
            }
          });
        } catch (e) { logError("03影院直析失败", e); }
      }

      // 尝试解析 真狼影视
      const targetZhenlang = apiData.find(item => item && item.url && item.url.includes("zhenlang.cc"));
      if (targetZhenlang) {
        logInfo("发现 真狼影视 源，开始直析");
        try {
          const resZl = await axiosInstance.get(targetZhenlang.url, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] } });
          const $$ = cheerio.load(resZl.data);

          $$(".play_list_box").each((index, el) => {
            let tabName = `线路${index + 1}`;
            const tipText = $$(el).find(".player_infotip").text() || "";
            const tipMatch = tipText.match(/当前资源由(.*?)提供/);
            if (tipMatch && tipMatch[1]) {
              tabName = tipMatch[1].trim();
            }

            const episodes = [];
            $$(el).find(".content_playlist li a").each((_, a) => {
              episodes.push({ name: $$(a).text().trim(), playId: toAbsUrl($$(a).attr("href"), "https://www.zhenlang.cc") });
            });
            if (episodes.length > 0) {
              playSources.push({ name: `真狼 - ${tabName}`, episodes });
              parsedZhenlang = true;
            }
          });
        } catch (e) { logError("真狼直析失败", e); }
      }

      // 尝试解析 开心影院
      const targetKaixin = apiData.find(item => item && item.url && item.url.includes("kxyytv.com"));
      if (targetKaixin) {
        logInfo("发现 开心影院 源，开始直析");
        try {
          const resKx = await axiosInstance.get(targetKaixin.url, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] } });
          const $$ = cheerio.load(resKx.data);
          const tabs = [];
          
          $$("ul.nav-tabs li a").each((_, el) => {
            const tabName = $$(el).text().replace(/\s*\d+$/, '').trim();
            const targetId = $$(el).attr("href");
            if (tabName && targetId) {
              tabs.push({ name: tabName, id: targetId });
            }
          });

          tabs.forEach(tab => {
            const episodes = [];
            $$(tab.id).find(".btn-group a").each((_, a) => {
              episodes.push({ name: $$(a).text().trim(), playId: toAbsUrl($$(a).attr("href"), "https://www.kxyytv.com") });
            });
            if (episodes.length > 0) {
              playSources.push({ name: `开心 - ${tab.name}`, episodes });
              parsedKaixin = true;
            }
          });
        } catch (e) { logError("开心影院直析失败", e); }
      }

      // 兜底：全网聚合备用源
      const fallbackEpisodes = [];
      for (let i = 1; i < apiData.length; i++) {
        const item = apiData[i];
        if (item && item.website && item.url) {
          if (parsed03yy && item.url.includes("03yy.live")) continue;
          if (parsedZhenlang && item.url.includes("zhenlang.cc")) continue;
          if (parsedKaixin && item.url.includes("kxyytv.com")) continue;
          fallbackEpisodes.push({ name: `${item.website} (需嗅探)`, playId: item.url });
        }
      }
      if (fallbackEpisodes.length > 0) playSources.push({ name: "全网聚合备用源", episodes: fallbackEpisodes });

    } catch (e) { logError("聚合API解析失败", e); }

    // ================= 2. 刮削处理 (NEW) =================
    let scrapeData = null;
    let videoMappings = [];
    const scrapeCandidates = [];

    // 准备刮削候选数据，并为每个集数分配唯一 FID
    playSources.forEach((source, sIdx) => {
        source.episodes.forEach((ep, eIdx) => {
            const fid = `${id}_${sIdx}_${eIdx}`; // 生成唯一 FID
            ep._fid = fid; 
            scrapeCandidates.push({
                fid: fid,
                file_id: fid,
                file_name: ep.name,
                name: ep.name,
                format_type: "video"
            });
        });
    });

    if (scrapeCandidates.length > 0) {
        try {
            // 执行刮削
            await OmniBox.processScraping(id, vodName, vodName, scrapeCandidates);
            // 获取元数据
            const metadata = await OmniBox.getScrapeMetadata(id);
            scrapeData = metadata?.scrapeData || null;
            videoMappings = metadata?.videoMappings || [];
            
            logInfo(`刮削完成`, { hasData: !!scrapeData, mappings: videoMappings.length });

            // 更新视频信息
            if (scrapeData) {
                vodName = scrapeData.title || vodName;
                if (scrapeData.posterPath) vodPic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
                if (scrapeData.overview) vodContent = scrapeData.overview;
                if (scrapeData.releaseDate) vodYear = String(scrapeData.releaseDate).substring(0, 4);
                
                const actors = (scrapeData.credits?.cast || []).slice(0, 5).map(c => c?.name).filter(Boolean).join(",");
                if (actors) vodActor = actors;
                
                const directors = (scrapeData.credits?.crew || []).filter(c => c?.job === "Director").slice(0, 3).map(c => c?.name).filter(Boolean).join(",");
                if (directors) vodDirector = directors;
            }

            // 更新集数名称
            playSources.forEach(source => {
                source.episodes.forEach(ep => {
                    const mapping = videoMappings.find(m => m?.fileId === ep._fid);
                    if (mapping) {
                        const newName = buildScrapedEpisodeName(scrapeData, mapping, ep.name);
                        if (newName && newName !== ep.name) {
                            ep.name = newName;
                        }
                    }
                });
            });

        } catch (e) { logError("刮削处理失败", e); }
    }

    logInfo('详情获取成功', { name: vodName, sourcesCount: playSources.length });

    return { 
        list: [{ 
            vod_id: id, 
            vod_name: vodName, 
            vod_pic: vodPic, 
            vod_content: vodContent, 
            vod_year: vodYear,
            vod_actor: vodActor,
            vod_director: vodDirector,
            vod_play_sources: playSources 
        }] 
    };
  } catch (e) { 
    logError("详情页整体解析抛出异常", e);
    return { list: [] }; 
  }
}

async function play(params) {
  const playId = params?.playId || params?.id || "";
  if (!playId) return { urls: [] };

  logInfo("准备播放", playId);

  // ================= 弹幕匹配 (NEW) =================
  let danmakuList = [];
  try {
      if (DANMU_API) {
          let vodName = params.vodName || "";
          let episodeName = params.episodeName || "";
          
          // 尝试获取刮削元数据以构建更准确的文件名
          const vodId = params.vodId; // 通常 APP 会传 vodId
          if (vodId) {
              const metadata = await OmniBox.getScrapeMetadata(vodId);
              if (metadata && metadata.scrapeData) {
                  vodName = metadata.scrapeData.title || vodName;
                  // 这里无法精确知道当前 playId 对应的 fid，只能依赖 params.episodeName
                  // 或者如果 playId 包含特征，可以尝试反查，但这里简化处理
              }
          }

          const fileName = buildFileNameForDanmu(vodName, episodeName);
          if (fileName) {
              danmakuList = await matchDanmu(fileName);
          }
      }
  } catch (e) { logError("弹幕匹配异常", e); }

  // 构造基础返回对象
  let playResult = { urls: [], parse: 0, header: DEFAULT_HEADERS };
  if (danmakuList.length > 0) {
      playResult.danmaku = danmakuList;
  }

  // ================= 03影院 秒播逻辑 =================
  if (playId.includes("03yy.live")) {
    try {
      const res = await fetchWithCookieRedirect(playId, { "Referer": "https://www.03yy.live/" });
      const nowMatch = res.data.match(/var now=base64decode\("([^"]+)"\)/);
      if (nowMatch && nowMatch[1]) {
        const nowStr = d64(nowMatch[1]);
        const apiUrl = `https://www.03yy.live/api/btiyikk.php?url=${nowStr}&ref=${encodeURIComponent(playId)}`;
        const apiRes = await fetchWithCookieRedirect(apiUrl, { "Referer": playId });
        const videoMatch = apiRes.data.match(/const videoUrl = "([^"]+)"/);
        if (videoMatch && videoMatch[1]) {
          const finalUrl = videoMatch[1].replace(/\\\//g, '/');
          logInfo("🎉 03影院秒播成功! 真实链接", finalUrl);
          playResult.urls = [{ name: "直析秒播", url: finalUrl }];
          return playResult;
        }
      }
    } catch (e) { logError("03影院秒播失败", e); }
  }

  // ================= 开心影院 秒播逻辑 =================
  if (playId.includes("kxyytv.com")) {
    try {
      const res = await axiosInstance.get(playId, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] } });
      const playerMatch = res.data.match(/var player_data\s*=\s*(\{[\s\S]+?\})\s*;?\s*</);
      
      if (playerMatch && playerMatch[1]) {
        const playerObj = JSON.parse(playerMatch[1]);
        let targetUrl = playerObj.url;
        let encrypt = playerObj.encrypt || 0;

        if (encrypt === 1) targetUrl = safeDecode(targetUrl);
        else if (encrypt === 2) targetUrl = safeDecode(Buffer.from(targetUrl, "base64").toString("utf8"));

        if (targetUrl) {
          logInfo("🎉 开心影院直链秒播成功! 真实链接", targetUrl);
          playResult.urls = [{ name: "直链秒播", url: targetUrl }];
          return playResult;
        }
      }
    } catch (e) { logError("开心影院解析失败", e); }
  }

  // ================= 真狼影视 动态AES秒播逻辑 =================
  if (playId.includes("zhenlang.cc")) {
    try {
      const res = await axiosInstance.get(playId, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] } });
      
      let targetUrl = "";
      let encrypt = 0;
      
      const playerMatch = res.data.match(/var player_aaaa\s*=\s*(\{[\s\S]+?\})\s*;?\s*</);
      if (playerMatch && playerMatch[1]) {
        try {
          const playerObj = JSON.parse(playerMatch[1]);
          targetUrl = playerObj.url;
          encrypt = playerObj.encrypt;
        } catch (e) {
          const uMatch = playerMatch[1].match(/"url":"([^"]+)"/);
          const eMatch = playerMatch[1].match(/"encrypt":(\d)/);
          if (uMatch) targetUrl = uMatch[1];
          if (eMatch) encrypt = parseInt(eMatch[1]);
        }
      }
      
      if (targetUrl) {
        if (encrypt === 1) targetUrl = safeDecode(targetUrl);
        else if (encrypt === 2) targetUrl = safeDecode(Buffer.from(targetUrl, "base64").toString("utf8"));
        
        logInfo("真狼底层地址", targetUrl);

        if (targetUrl.includes(".m3u8") || targetUrl.includes(".mp4")) {
          logInfo("🎉 真狼直链秒播成功! 真实链接", targetUrl);
          playResult.urls = [{ name: "直链秒播", url: targetUrl }];
          return playResult;
        }

        // 尝试动态破解 super.playr.top
        try {
          const sniffUrl = `https://super.playr.top/?url=${encodeURIComponent(targetUrl)}`;
          
          const playerRes = await axiosInstance.get(sniffUrl, { headers: { "Referer": "https://www.zhenlang.cc/" }});
          const keyMatch = playerRes.data.match(/var\s+precomputedKey\s*=\s*['"]([^'"]+)['"]/);
          const ivMatch = playerRes.data.match(/var\s+precomputedIv\s*=\s*['"]([^'"]+)['"]/);
          
          if (keyMatch && ivMatch) {
            const dynamicKey = keyMatch[1];
            const dynamicIv = ivMatch[1];
            logInfo("成功获取动态解密密钥", { key: dynamicKey, iv: dynamicIv });

            const tokenRes = await axiosInstance.get(`https://super.playr.top/token.php?url=${encodeURIComponent(targetUrl)}`, { headers: { "Referer": "https://www.zhenlang.cc/" }});
            if (tokenRes.data && tokenRes.data.code === 0) {
              
              const apiRes = await axiosInstance.get(`https://super.playr.top/api.php?url=${encodeURIComponent(targetUrl)}&token=${tokenRes.data.token}&t=${tokenRes.data.t}`, { headers: { "Referer": "https://www.zhenlang.cc/" }});
              
              if (apiRes.data && apiRes.data.e === 1 && apiRes.data.d) {
                const decipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(dynamicKey), Buffer.from(dynamicIv));
                let decrypted = decipher.update(apiRes.data.d, "base64", "utf8");
                decrypted += decipher.final("utf8");
                const parsedData = JSON.parse(decrypted);
                
                if (parsedData.url) {
                  logInfo("🎉 真狼动态AES破解秒播成功! 真实链接", parsedData.url);
                  playResult.urls = [{ name: "逆向秒播", url: parsedData.url }];
                  return playResult;
                }
              } else if (apiRes.data && apiRes.data.url) {
                logInfo("🎉 真狼获取直链成功! 真实链接", apiRes.data.url);
                playResult.urls = [{ name: "逆向秒播", url: apiRes.data.url }];
                return playResult;
              }
            }
          } else {
            logInfo("未找到动态密钥，降级为嗅探");
          }
        } catch (crackErr) { logError("真狼AES破解失败", crackErr); }

        const sniffUrl = `https://super.playr.top/?url=${encodeURIComponent(targetUrl)}`;
        const sniffResult = await OmniBox.sniffVideo(sniffUrl);
        if (sniffResult && sniffResult.url) {
            playResult.urls = [{ name: "嗅探线路", url: sniffResult.url }];
            playResult.header = sniffResult.header || DEFAULT_HEADERS;
            return playResult;
        }
      }
    } catch (e) { logError("真狼解析失败", e); }
  }

  // ================= 兜底：全网聚合备用源嗅探 =================
  try {
    const sniffResult = await OmniBox.sniffVideo(playId);
    if (sniffResult && sniffResult.url) {
      logInfo("主动嗅探成功", sniffResult.url);
      playResult.urls = [{ name: "嗅探线路", url: sniffResult.url }];
      playResult.header = sniffResult.header || DEFAULT_HEADERS;
      return playResult;
    }
  } catch (e) { logInfo("主动嗅探失败，降级为 WebView"); }

  playResult.urls = [{ name: "网页解析", url: playId }];
  playResult.parse = 1;
  return playResult;
}

module.exports = { home, category, detail, search, play };
const runner = require("spider_runner");
runner.run(module.exports);
