// @name 影猫仓库
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持，并发：安全
// @description 03 + 开心 + 真狼 (并发解析)
// @dependencies: axios, crypto, cheerio, http, https
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/影猫仓库.js

const axios = require("axios");
const cheerio = require("cheerio");
const OmniBox = require("omnibox_sdk");
const crypto = require("crypto");
const http = require("http");
const https = require("https");

// ==================== 全局配置 ====================
const HOST = "https://www.ymck.pro";
const PAGE_LIMIT = 20;
const DANMU_API = process.env.DANMU_API || "";

const DEFAULT_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
  "Referer": `${HOST}/`,
};

const axiosInstance = axios.create({ 
    timeout: 15000,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false })
});

// ==================== 日志工具 ====================
const logInfo = (message, data = null) => {
  OmniBox.log("info", `[影猫] ${message}${data ? ': ' + JSON.stringify(data) : ''}`);
};
const logWarn = (message, error = null) => {
  OmniBox.log("warn", `[影猫] ⚠️ ${message}${error ? ': ' + (error.message || error) : ''}`);
};
const logError = (message, error) => {
  OmniBox.log("error", `[影猫] ❌ ${message}: ${error?.message || error}`);
};

// ==================== 辅助工具函数 ====================
function d64(text) {
  try { return Buffer.from(String(text || ""), "base64").toString("utf8"); } catch { return ""; }
}

const encodeMeta = (obj) => {
  try { return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64"); } catch { return ""; }
};
const decodeMeta = (str) => {
  try { return JSON.parse(Buffer.from(str || "", "base64").toString("utf8")); } catch { return {}; }
};

function safeDecode(str) {
  try { return decodeURIComponent(str); } catch (e) { return unescape(str); }
}

function toAbsUrl(url, base = HOST) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  if (url.startsWith("//")) return "https:" + url;
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

async function fetchWithCookieRedirect(url, customHeaders = {}, timeoutMs = 4000) {
  let headers = { "User-Agent": DEFAULT_HEADERS["User-Agent"], ...customHeaders };
  
  let res = await axiosInstance.get(url, {
    headers: headers,
    timeout: timeoutMs,
    maxRedirects: 0,
    validateStatus: status => status >= 200 && status < 400
  });

  if (res.status === 301 || res.status === 302) {
    const cookies = res.headers['set-cookie'];
    const location = res.headers['location'];
    
    let baseUrl = url;
    try { baseUrl = new URL(url).origin; } catch (e) {}
    const nextUrl = location ? toAbsUrl(location, baseUrl) : url;
    
    if (cookies) {
      headers["Cookie"] = cookies.map(c => c.split(';')[0]).join('; ');
    }
    res = await axiosInstance.get(nextUrl, { headers: headers, timeout: timeoutMs, maxRedirects: 0 });
  }
  return res;
}

// ==================== 刮削与弹幕辅助模块 ====================
const RE_CLEAN_1 = /4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]|1280x720|1920x1080/g;
const RE_CLEAN_2 = /[hH]\.?26[45]/g;
const RE_CLEAN_3 = /BluRay|WEB-DL|HDR|REMUX/gi;
const RE_CLEAN_4 = /\.mp4|\.mkv|\.avi|\.flv/gi;
const RE_SE = /[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i;
const RE_CN = /第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/;
const RE_EP = /\b(?:EP|E)[-._\s]*(\d{1,3})\b/i;
const RE_STANDALONE = /(?:^|[\s\-\._\[\]])(\d{1,3})(?![0-9pP])/g;

function preprocessTitle(title) {
    if (!title) return "";
    return title
        .replace(RE_CLEAN_1, " ")
        .replace(RE_CLEAN_2, " ")
        .replace(RE_CLEAN_3, " ")
        .replace(RE_CLEAN_4, " ");
}

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

function extractEpisode(title) {
    if (!title) return "";
    const processedTitle = preprocessTitle(title).trim();
    const seMatch = processedTitle.match(RE_SE);
    if (seMatch) return seMatch[1];
    const cnMatch = processedTitle.match(RE_CN);
    if (cnMatch) return String(chineseToArabic(cnMatch[1]));
    const epMatch = processedTitle.match(RE_EP);
    if (epMatch) return epMatch[1];
    const standaloneMatches = processedTitle.match(RE_STANDALONE);
    if (standaloneMatches) {
        const candidates = standaloneMatches.map(m => m.match(/\d+/)[0]).filter(n => parseInt(n) > 0 && parseInt(n) < 300);
        if (candidates.length > 0) return candidates[0];
    }
    return "";
}

function extractSeason(title) {
    if (!title) return 1;
    const cnMatch = title.match(/第\s*([零一二三四五六七八九十0-9]+)\s*季/);
    if (cnMatch) return chineseToArabic(cnMatch[1]);
    const enMatch = title.match(/Season\s*(\d+)/i) || title.match(/S(\d+)/i);
    if (enMatch) return parseInt(enMatch[1]);
    return 1;
}

function buildFileNameForDanmu(vodName, episodeTitle, seasonNum, episodeNum) {
    if (!vodName) return "";
    if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;
    
    let s = seasonNum > 0 ? seasonNum : 1;
    let e = episodeNum;

    if (e === undefined || e === null) {
        const digits = extractEpisode(episodeTitle);
        if (digits) e = parseInt(digits, 10);
    }

    if (e > 0) {
        const sStr = s < 10 ? `S0${s}` : `S${s}`;
        const eStr = e < 10 ? `E0${e}` : `E${e}`;
        return `${vodName} ${sStr}${eStr}`;
    }
    return vodName;
}

const buildScrapedEpisodeName = (scrapeData, mapping, originalName) => {
    if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
        return originalName;
    }
    if (mapping.episodeName) {
        return `${mapping.episodeNumber}.${mapping.episodeName}`;
    }
    if (scrapeData && Array.isArray(scrapeData.episodes)) {
        const hit = scrapeData.episodes.find(
            ep => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
        );
        if (hit?.name) {
            return `${hit.episodeNumber}.${hit.name}`;
        }
    }
    return originalName;
};

async function matchDanmu(fileName) {
    if (!DANMU_API || !fileName) return [];
    try {
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
        return [{ name: danmakuName, url: `${DANMU_API}/api/v2/comment/${episodeId}?format=xml` }];
    } catch (error) {
        return [];
    }
}

// ==================== 详情页并发解析策略 ====================

async function parse03yySource(url) {
  const res = await fetchWithCookieRedirect(url, { "Referer": "https://www.03yy.live/" }, 4000);
  const $$ = cheerio.load(res.data);
  const tabs = [];
  const sources = [];
  $$("#playlist li").each((_, el) => { tabs.push($$(el).text().replace(/[\uE000-\uF8FF]/g, '').trim()); });

  $$(".play-box .play_list").each((index, el) => {
    const episodes = [];
    $$(el).find("ul li a").each((_, a) => {
      episodes.push({ name: $$(a).text().trim(), playId: toAbsUrl($$(a).attr("href"), "https://www.03yy.live") });
    });
    if (episodes.length > 0) sources.push({ name: `03影院 - ${tabs[index] || '线路'+(index+1)}`, episodes });
  });
  
  if (sources.length === 0) throw new Error("03yy未匹配到任何剧集");
  return { type: '03yy', sources };
}

// 【核心修复】增强版真狼解析器，增加 URL 去重，防止集数重复
async function parseZhenlangSource(url) {
  const res = await fetchWithCookieRedirect(url, { "Referer": "https://www.zhenlang.cc/" }, 4000);
  const $$ = cheerio.load(res.data);
  const sources = [];

  // 1. 尝试通用 MacCMS 结构抓取线路名称
  const tabs = [];
  $$(".nav-tabs li a, .stui-vodlist__head h3, .myui-panel__head h3, .module-tab-item, .play_source_tab a").each((_, el) => {
     let text = $$(el).text().replace(/[\uE000-\uF8FF]/g, '').trim();
     if (text) tabs.push(text);
  });

  // 2. 尝试通用 MacCMS 结构抓取播放列表
  const lists = $$(".stui-content__playlist, .myui-content__list, .module-play-list-content, .content_playlist, [id^='playlist']");
  lists.each((index, el) => {
    const episodes = [];
    const seenUrls = new Set(); // 【新增】用于记录已经提取过的链接，防止重复

    $$(el).find("a").each((_, a) => {
      const href = $$(a).attr("href");
      if (href && (href.includes("/play") || href.includes("/vodplay") || href.includes("vod-play"))) {
        const playId = toAbsUrl(href, "https://www.zhenlang.cc");
        
        // 【核心修复】如果这个链接还没被提取过，才加入列表
        if (!seenUrls.has(playId)) {
            seenUrls.add(playId);
            let epName = $$(a).text().trim() || "播放";
            // 清理可能存在的多余换行符
            epName = epName.replace(/\s+/g, ' '); 
            episodes.push({ name: epName, playId: playId });
        }
      }
    });
    
    if (episodes.length > 0) {
        let tabName = tabs[index] || `线路${index + 1}`;
        sources.push({ name: `真狼 - ${tabName}`, episodes });
    }
  });

  // 3. 尝试旧版结构兜底
  if (sources.length === 0) {
    $$(".play_list_box").each((index, el) => {
      let tabName = `线路${index + 1}`;
      const tipMatch = ($$(el).find(".player_infotip").text() || "").match(/当前资源由(.*?)提供/);
      if (tipMatch && tipMatch[1]) tabName = tipMatch[1].trim();

      const episodes = [];
      const seenUrls = new Set(); // 旧版结构也加上去重

      $$(el).find(".content_playlist a").each((_, a) => {
        const href = $$(a).attr("href");
        if (href) {
            const playId = toAbsUrl(href, "https://www.zhenlang.cc");
            if (!seenUrls.has(playId)) {
                seenUrls.add(playId);
                episodes.push({ name: $$(a).text().trim(), playId: playId });
            }
        }
      });
      if (episodes.length > 0) sources.push({ name: `真狼 - ${tabName}`, episodes });
    });
  }

  if (sources.length === 0) throw new Error("真狼网页结构变更，未匹配到任何剧集");
  
  return { type: 'zhenlang', sources };
}

async function parseKaixinSource(url) {
  const res = await axiosInstance.get(url, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }, timeout: 4000 });
  const $$ = cheerio.load(res.data);
  const tabs = [];
  const sources = [];
  
  $$("ul.nav-tabs li a").each((_, el) => {
    const tabName = $$(el).text().replace(/\s*\d+$/, '').trim();
    const targetId = $$(el).attr("href");
    if (tabName && targetId) tabs.push({ name: tabName, id: targetId });
  });

  tabs.forEach(tab => {
    if (!tab.id || !tab.id.startsWith('#')) return;
    try {
      const episodes = [];
      $$(tab.id).find(".btn-group a").each((_, a) => {
        episodes.push({ name: $$(a).text().trim(), playId: toAbsUrl($$(a).attr("href"), "https://www.kxyytv.com") });
      });
      if (episodes.length > 0) sources.push({ name: `开心 - ${tab.name}`, episodes });
    } catch (e) {}
  });
  
  if (sources.length === 0) throw new Error("开心未匹配到任何剧集");
  return { type: 'kaixin', sources };
}

// ==================== 核心接口 ====================

async function home(params) {
  const classes = [
    { type_id: "1", type_name: "电影" },
    { type_id: "2", type_name: "电视剧" },
    { type_id: "5", type_name: "综艺" },
    { type_id: "4", type_name: "动漫" },
    { type_id: "3", type_name: "纪录片" }
  ];
  
  const filters = {
    "1": [{ key: "cateId", name: "类型", value: [{ n: "最新", v: "1", name: "最新", value: "1" }, { n: "动作", v: "6", name: "动作", value: "6" }, { n: "喜剧", v: "7", name: "喜剧", value: "7" }, { n: "爱情", v: "8", name: "爱情", value: "8" }, { n: "科幻", v: "9", name: "科幻", value: "9" }, { n: "恐怖", v: "10", name: "恐怖", value: "10" }, { n: "剧情", v: "11", name: "剧情", value: "11" }, { n: "战争", v: "12", name: "战争", value: "12" }] }],
    "2": [{ key: "cateId", name: "类型", value: [{ n: "最新", v: "2", name: "最新", value: "2" }, { n: "国产剧", v: "13", name: "国产剧", value: "13" }, { n: "港台剧", v: "14", name: "港台剧", value: "14" }, { n: "日韩剧", v: "15", name: "日韩剧", value: "15" }, { n: "海外剧", v: "16", name: "海外剧", value: "16" }] }],
    "4": [{ key: "cateId", name: "类型", value: [{ n: "最新", v: "4", name: "最新", value: "4" }, { n: "国产动漫", v: "24", name: "国产动漫", value: "24" }, { n: "日韩动漫", v: "25", name: "日韩动漫", value: "25" }, { n: "港台动漫", v: "26", name: "港台动漫", value: "26" }, { n: "欧美动漫", v: "27", name: "欧美动漫", value: "27" }] }],
    "5": [{ key: "cateId", name: "类型", value: [{ n: "最新", v: "5", name: "最新", value: "5" }, { n: "大陆综艺", v: "17", name: "大陆综艺", value: "17" }, { n: "港台综艺", v: "18", name: "港台综艺", value: "18" }, { n: "日韩综艺", v: "20", name: "日韩综艺", value: "20" }, { n: "欧美综艺", v: "21", name: "欧美综艺", value: "21" }] }],
    "3": [{ key: "cateClass", name: "类型", value: [{ n: "最新", v: "", name: "最新", value: "" }, { n: "记录", v: "记录", name: "记录", value: "记录" }, { n: "传记", v: "传记", name: "传记", value: "传记" }, { n: "历史", v: "历史", name: "历史", value: "历史" }, { n: "音乐", v: "音乐", name: "音乐", value: "音乐" }, { n: "运动", v: "运动", name: "运动", value: "运动" }, { n: "犯罪", v: "犯罪", name: "犯罪", value: "犯罪" }, { n: "情", v: "情", name: "情", value: "情" }, { n: "战争", v: "战争", name: "战争", value: "战争" }, { n: "冒险", v: "冒险", name: "冒险", value: "冒险" }, { n: "灾难", v: "灾难", name: "灾难", value: "灾难" }] }]
  };

  try {
    const url = `${HOST}/api.php/xiao/vod?page=1&limit=20`;
    const res = await axiosInstance.get(url, { 
        headers: { ...DEFAULT_HEADERS, "X-Requested-With": "XMLHttpRequest" } 
    });
    
    let list = [];
    if (res.data && res.data.list) {
        list = res.data.list.map(item => ({
            vod_id: item.vod_id.toString(),
            vod_name: item.vod_name,
            vod_pic: item.vod_pic,
            vod_remarks: parseFloat(item.vod_score) > 0 ? item.vod_score.toString() : ""
        }));
    }
    
    return { class: classes, filters: filters, list: list, page: 1, pagecount: res.data.pagecount || 99, limit: 20, total: res.data.total || 999 };
  } catch (e) { 
    return { class: classes, filters: filters, list: [], page: 1, pagecount: 1 }; 
  }
}


async function category(params) {
  let tid = params?.categoryId || params?.id || "1";
  const pg = params?.page || 1;
  let filterClass = "";

  if (params?.filters) {
      if (params.filters.cateId) {
          tid = params.filters.cateId;
      }
      if (params.filters.cateClass) {
          filterClass = encodeURIComponent(params.filters.cateClass);
      }
  }

  try {
    let url = `${HOST}/api.php/xiao/vod?type=${tid}&page=${pg}&limit=20`;
    if (filterClass) {
        url += `&class=${filterClass}`;
    }

    const res = await axiosInstance.get(url, { 
        headers: { 
            ...DEFAULT_HEADERS, 
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "X-Requested-With": "XMLHttpRequest" 
        } 
    });
    
    const data = res.data;
    let list = [];
    
    if (data && data.list) {
        list = data.list.map(item => ({
            vod_id: item.vod_id.toString(),
            vod_name: item.vod_name,
            vod_pic: item.vod_pic,
            vod_remarks: parseFloat(item.vod_score) > 0 ? item.vod_score.toString() : ""
        }));
    }

    return { 
        list: list, 
        page: parseInt(data.page || pg), 
        pagecount: parseInt(data.pagecount || 99), 
        limit: 20, 
        total: parseInt(data.total || 999) 
    };
  } catch (e) { 
    return { list: [], page: 1, pagecount: 1 }; 
  }
}

async function search(params) {
  const wd = params?.keyword || params?.wd || "";
  const pg = params?.page || 1;
  
  if (pg > 1) return { list: [], page: pg, pagecount: 1 };

  try {
    const apiUrl = `${HOST}/API/v2.php?q=${encodeURIComponent(wd)}&size=50`;
    const apiRes = await axiosInstance.get(apiUrl, { headers: { ...DEFAULT_HEADERS, "Accept": "*/*" } });
    
    let apiData = [];
    try {
        const parsed = JSON.parse(d64(apiRes.data));
        apiData = Array.isArray(parsed) ? parsed : (parsed.data || []);
    } catch (e) {
        logWarn("搜索API数据解析失败", e);
    }

    const groups = {};
    for (let i = 0; i < apiData.length; i++) {
        const item = apiData[i];
        if (typeof item === 'object' && item.text && item.url) {
            const title = item.text.trim();
            if (!groups[title]) {
                groups[title] = {
                    vod_id: `search_${title}`, 
                    vod_name: title,
                    vod_pic: "https://www.ymck.pro/upload/site/20230825-1/5c00fbcfb4ff0737d3c8320d30b2d1de.png", 
                    vod_remarks: "全网聚合"
                };
            }
        }
    }

    const list = Object.values(groups);
    return { list: list, page: 1, pagecount: 1, limit: 50, total: list.length };
  } catch (e) { 
    return { list: [], page: 1, pagecount: 1 }; 
  }
}

async function detail(params) {
  const t0 = Date.now();
  const id = params?.videoId || params?.id || "";
  if (!id) return { list: [] };

  try {
    let vodName = "";
    let vodPic = "";
    let vodContent = "";
    let vodYear = "";
    let vodActor = "";
    let vodDirector = "";

    if (id.startsWith("search_")) {
        vodName = id.replace("search_", "");
        vodPic = "https://www.ymck.pro/upload/site/20230825-1/5c00fbcfb4ff0737d3c8320d30b2d1de.png";
        vodContent = "全网聚合搜索结果，正在通过 TMDB 刮削获取详细信息...";
    } else {
        let targetUrl = id;
        if (/^\d+$/.test(id)) {
            targetUrl = `${HOST}/movie/${id}.html`;
        } else if (!id.startsWith("http")) {
            targetUrl = toAbsUrl(id);
        }

        const res = await axiosInstance.get(targetUrl, { headers: DEFAULT_HEADERS });
        const $ = cheerio.load(res.data);

        vodName = $(".movie-title").first().text().trim().replace(/影片信息$/, "").trim();
        if (!vodName) return { list: [] };
        
        vodPic = toAbsUrl($(".poster img").attr("src"));
        vodContent = $(".summary.detailsTxt").last().text().replace("简介：", "").trim();
    }

    let playSources = [];
    let parsedFlags = { '03yy': false, 'zhenlang': false, 'kaixin': false };

    const tApi = Date.now();
    const apiUrl = `${HOST}/API/v2.php?q=${encodeURIComponent(vodName)}&size=50`;
    try {
      const apiRes = await axiosInstance.get(apiUrl, { headers: { ...DEFAULT_HEADERS, "Accept": "*/*" } });
      
      let apiData = [];
      try {
          const parsed = JSON.parse(d64(apiRes.data));
          apiData = Array.isArray(parsed) ? parsed : (parsed.data || []);
      } catch (e) {
          logWarn("聚合API数据解析失败", e);
      }

      const target03yy = apiData.find(item => item && item.url && item.url.includes("03yy.live"));
      const targetZhenlang = apiData.find(item => item && item.url && item.url.includes("zhenlang.cc"));
      const targetKaixin = apiData.find(item => item && item.url && item.url.includes("kxyytv.com"));

      const tSource = Date.now();
      const tasks = [];

      const wrapTask = async (name, taskPromise) => {
          const tStart = Date.now();
          try {
              const res = await taskPromise;
              return { name, status: '成功', time: Date.now() - tStart, data: res };
          } catch (e) {
              return { name, status: '失败', time: Date.now() - tStart };
          }
      };

      if (target03yy) tasks.push(wrapTask('03影院', parse03yySource(target03yy.url)));
      if (targetZhenlang) tasks.push(wrapTask('真狼', parseZhenlangSource(targetZhenlang.url)));
      if (targetKaixin) tasks.push(wrapTask('开心', parseKaixinSource(targetKaixin.url)));

      if (tasks.length > 0) {
        const results = await Promise.all(tasks);
        
        let logDetails = [];
        results.forEach(r => {
            // 【核心修复】必须确保 sources 里面真的有数据，才算真正成功
            if (r.status === '成功' && r.data && r.data.sources && r.data.sources.length > 0) {
                logDetails.push(`${r.name}:成功(${r.time}ms)`);
                playSources.push(...r.data.sources);
                parsedFlags[r.data.type] = true;
            } else {
                logDetails.push(`${r.name}:无数据/失败(${r.time}ms)`);
            }
        });
        logInfo(`源站解析完成, 耗时: ${Date.now() - tSource}ms, 详情: [ ${logDetails.join(' | ')} ]`);
      }

      const fallbackEpisodes = [];
      for (let i = 0; i < apiData.length; i++) {
        const item = apiData[i];
        if (item && item.website && item.url) {
          if (parsedFlags['03yy'] && item.url.includes("03yy.live")) continue;
          if (parsedFlags['zhenlang'] && item.url.includes("zhenlang.cc")) continue;
          if (parsedFlags['kaixin'] && item.url.includes("kxyytv.com")) continue;
          fallbackEpisodes.push({ name: `${item.website} (需嗅探)`, playId: item.url });
        }
      }
      if (fallbackEpisodes.length > 0) playSources.push({ name: "全网聚合备用源", episodes: fallbackEpisodes });

    } catch (e) {
      logWarn("聚合API请求失败", e);
    }

    // ================= 2. 刮削处理 =================
    const tScrape = Date.now();
    let scrapeData = null;
    let videoMappings = [];
    const scrapeCandidates = [];

    const currentSeason = extractSeason(vodName);
    const sStr = currentSeason < 10 ? `S0${currentSeason}` : `S${currentSeason}`;

    playSources.forEach((source, sIdx) => {
        source.episodes.forEach((ep, eIdx) => {
            const fid = `${id}_${sIdx}_${eIdx}`;
            ep._fid = fid; 
            
            const epNumStr = extractEpisode(ep.name);
            let fileNameForScrape = `${vodName} ${ep.name}`; 
            
            if (epNumStr) {
                const epNum = parseInt(epNumStr, 10);
                const eStr = epNum < 10 ? `E0${epNum}` : `E${epNum}`;
                fileNameForScrape = `${vodName} ${sStr}${eStr}`;
            }

            scrapeCandidates.push({
                fid: fid, 
                file_id: fid, 
                file_name: fileNameForScrape, 
                name: ep.name, 
                format_type: "video"
            });
        });
    });

    if (scrapeCandidates.length > 0) {
        try {
            await OmniBox.processScraping(id, vodName, vodName, scrapeCandidates);
            const metadata = await OmniBox.getScrapeMetadata(id);
            scrapeData = metadata?.scrapeData || null;
            videoMappings = metadata?.videoMappings || [];
            
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

            playSources.forEach(source => {
                source.episodes.forEach(ep => {
                    let meta = { fid: ep._fid, v: vodName, e: ep.name };
                    const mapping = videoMappings.find(m => m?.fileId === ep._fid);
                    
                    if (mapping) {
                        const newName = buildScrapedEpisodeName(scrapeData, mapping, ep.name);
                        if (newName && newName !== ep.name) ep.name = newName;
                        meta.s = mapping.seasonNumber;
                        meta.n = mapping.episodeNumber;
                        meta.e = ep.name;
                        
                        ep._s = mapping.seasonNumber;
                        ep._n = mapping.episodeNumber;
                    }
                    ep.playId = `${ep.playId}|||${encodeMeta(meta)}`;
                });

                const hasEpisodeNumber = source.episodes.some(ep => ep._n !== undefined);
                
                if (hasEpisodeNumber) {
                    source.episodes.sort((a, b) => {
                        const seasonA = a._s || 0;
                        const seasonB = b._s || 0;
                        if (seasonA !== seasonB) return seasonA - seasonB;
                        const episodeA = a._n || 0;
                        const episodeB = b._n || 0;
                        return episodeA - episodeB;
                    });
                }
            });
        } catch (e) {}
    }

    logInfo(`详情页加载完成, 影片: ${vodName}, 刮削耗时: ${Date.now() - tScrape}ms, 总耗时: ${Date.now() - t0}ms`);

    return { 
        list: [{ 
            vod_id: id, vod_name: vodName, vod_pic: vodPic, vod_content: vodContent, 
            vod_year: vodYear, vod_actor: vodActor, vod_director: vodDirector,
            vod_play_sources: playSources 
        }] 
    };
  } catch (e) { 
    return { list: [] }; 
  }
}

// ==================== 播放页策略模式解析器 ====================

async function play03yy(url, baseResult) {
  try {
    logInfo(`[03影院] 开始解析播放页: ${url}`);
    const res = await fetchWithCookieRedirect(url, { "Referer": "https://www.03yy.live/" }, 5000);
    const html = res.data;

    const nowMatch = html.match(/var now=base64decode\("([^"]+)"\)/);
    const pnMatch = html.match(/var pn="([^"]+)"/);

    if (nowMatch && nowMatch[1]) {
      const nowStr = d64(nowMatch[1]);
      const pn = pnMatch ? pnMatch[1] : "未知";
      
      logInfo(`[03影院] 提取参数成功 -> pn: ${pn}, now: ${nowStr}`);

      if (pn === "btiyikk" || pn === "03yyhd") {
        logInfo(`[03影院] 匹配为【高速线路】(${pn}), 准备请求 btiyikk 接口...`);
        const apiUrl = `https://www.03yy.live/api/btiyikk.php?url=${encodeURIComponent(nowStr)}&ref=${encodeURIComponent(url)}`;
        const apiRes = await fetchWithCookieRedirect(apiUrl, { "Referer": url }, 5000);
        const videoMatch = apiRes.data.match(/const videoUrl\s*=\s*"([^"]+)"/);
        
        if (videoMatch && videoMatch[1]) {
          const finalUrl = videoMatch[1].replace(/\\\//g, '/');
          logInfo(`[03影院] 高速线路解析成功: ${finalUrl}`);
          baseResult.urls = [{ name: "03高速直链", url: finalUrl }];
          return baseResult;
        }
      } 
            else if (pn === "qq") {
        logInfo(`[03影院] 匹配为【高清备用】(${pn}), 准备请求 playlink 接口...`);
        const apiUrl = `https://www.03yy.live/api/playlink.php?url=${encodeURIComponent(nowStr)}`;
        const apiRes = await fetchWithCookieRedirect(apiUrl, { "Referer": url }, 5000);
        const videoMatch = apiRes.data.match(/const videoUrl\s*=\s*"([^"]+)"/);
        
        if (videoMatch && videoMatch[1]) {
          const finalUrl = videoMatch[1].replace(/\\\//g, '/');
          logInfo(`[03影院] 高清备用解析成功: ${finalUrl}`);
          baseResult.urls = [{ name: "03高清备用", url: finalUrl }];
          baseResult.header = { "Referer": "https://www.03yy.live/", "User-Agent": DEFAULT_HEADERS["User-Agent"] };
          return baseResult;
        }
      }
      else if (pn === "1080zyk") {
        logInfo(`[03影院] 匹配为【普通线路】(${pn}), 准备请求 e1080 接口...`);
        const apiUrl = `https://www.03yy.live/api/e1080.php?url=${encodeURIComponent(nowStr)}`;
        const apiRes = await fetchWithCookieRedirect(apiUrl, { "Referer": url }, 5000);
        const videoMatch = apiRes.data.match(/var videoUrl\s*=\s*"([^"]+)"/);
        
        if (videoMatch && videoMatch[1]) {
          const finalUrl = videoMatch[1].replace(/\\\//g, '/');
          logInfo(`[03影院] 普通线路解析成功: ${finalUrl}`);
          baseResult.urls = [{ name: "03普线直链", url: finalUrl }];
          baseResult.header = { "Referer": "https://www.03yy.live/", "User-Agent": DEFAULT_HEADERS["User-Agent"] };
          return baseResult;
        }
      } 
      else {
        logInfo(`[03影院] 未知的线路标识 pn: ${pn}，尝试原生直链兜底`);
      }

      if (nowStr.includes(".m3u8") || nowStr.includes(".mp4")) {
        logInfo(`[03影院] 触发原生直链兜底成功: ${nowStr}`);
        baseResult.urls = [{ name: "03原生直链", url: nowStr }];
        return baseResult;
      }
    } else {
      logWarn(`[03影院] 网页源码中未找到 now 变量，可能网页结构已改变`);
    }
  } catch (e) {
    logWarn(`[03影院] 播放解析发生代码异常: ${e.message}`);
  }
  
  logInfo(`[03影院] 所有直链尝试均失败，交由外层嗅探器处理`);
  return null; 
}

async function playKaixin(url, baseResult) {
  try {
    const res = await axiosInstance.get(url, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }, timeout: 5000 });
    const playerMatch = res.data.match(/var player_data\s*=\s*(\{[\s\S]+?\})\s*;?\s*</);
    if (playerMatch && playerMatch[1]) {
      const playerObj = JSON.parse(playerMatch[1]);
      let targetUrl = playerObj.url;
      let encrypt = playerObj.encrypt || 0;
      if (encrypt === 1) targetUrl = safeDecode(targetUrl);
      else if (encrypt === 2) targetUrl = safeDecode(Buffer.from(targetUrl, "base64").toString("utf8"));
      if (targetUrl) {
        baseResult.urls = [{ name: "直链秒播", url: targetUrl }];
        return baseResult;
      }
    }
  } catch (e) {}
  return null;
}

async function playZhenlang(url, baseResult) {
  try {
    const res = await axiosInstance.get(url, { headers: { "User-Agent": DEFAULT_HEADERS["User-Agent"] }, timeout: 5000 });
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
      
      if (targetUrl.includes(".m3u8") || targetUrl.includes(".mp4")) {
        baseResult.urls = [{ name: "直链秒播", url: targetUrl }];
        return baseResult;
      }

      try {
        const sniffUrl = `https://super.playr.top/?url=${encodeURIComponent(targetUrl)}`;
        const playerRes = await axiosInstance.get(sniffUrl, { headers: { "Referer": "https://www.zhenlang.cc/" }, timeout: 5000 });
        const keyMatch = playerRes.data.match(/var\s+precomputedKey\s*=\s*['"]([^'"]+)['"]/);
        const ivMatch = playerRes.data.match(/var\s+precomputedIv\s*=\s*['"]([^'"]+)['"]/);
        
        if (keyMatch && ivMatch) {
          const dynamicKey = keyMatch[1];
          const dynamicIv = ivMatch[1];
          const tokenRes = await axiosInstance.get(`https://super.playr.top/token.php?url=${encodeURIComponent(targetUrl)}`, { headers: { "Referer": "https://www.zhenlang.cc/" }, timeout: 5000 });
          if (tokenRes.data && tokenRes.data.code === 0) {
            const apiRes = await axiosInstance.get(`https://super.playr.top/api.php?url=${encodeURIComponent(targetUrl)}&token=${tokenRes.data.token}&t=${tokenRes.data.t}`, { headers: { "Referer": "https://www.zhenlang.cc/" }, timeout: 5000 });
            if (apiRes.data && apiRes.data.e === 1 && apiRes.data.d) {
              const decipher = crypto.createDecipheriv("aes-128-cbc", Buffer.from(dynamicKey), Buffer.from(dynamicIv));
              let decrypted = decipher.update(apiRes.data.d, "base64", "utf8");
              decrypted += decipher.final("utf8");
              const parsedData = JSON.parse(decrypted);
              if (parsedData.url) {
                baseResult.urls = [{ name: "逆向秒播", url: parsedData.url }];
                return baseResult;
              }
            } else if (apiRes.data && apiRes.data.url) {
              baseResult.urls = [{ name: "逆向秒播", url: apiRes.data.url }];
              return baseResult;
            }
          }
        }
      } catch (crackErr) {}

      const sniffUrl = `https://super.playr.top/?url=${encodeURIComponent(targetUrl)}`;
      const sniffResult = await OmniBox.sniffVideo(sniffUrl);
      if (sniffResult && sniffResult.url) {
          baseResult.urls = [{ name: "嗅探线路", url: sniffResult.url }];
          baseResult.header = sniffResult.header || DEFAULT_HEADERS;
          return baseResult;
      }
    }
  } catch (e) {}
  return null;
}

async function play(params) {
  const t0 = Date.now();
  const playId = params?.playId || params?.id || "";
  if (!playId) return { urls: [] };

  let rawPlayId = playId;
  let playMeta = {};
  if (playId.includes('|||')) {
      const parts = playId.split('|||');
      rawPlayId = parts[0];
      playMeta = decodeMeta(parts[1] || "");
  }

  let playResult = { urls: [], parse: 0, header: DEFAULT_HEADERS };

  let danmakuPromise = Promise.resolve([]);
  if (DANMU_API) {
      let vodName = params.vodName || playMeta.v || "";
      let episodeName = params.episodeName || playMeta.e || "";
      const fileName = buildFileNameForDanmu(vodName, episodeName, playMeta.s, playMeta.n);
      if (fileName) danmakuPromise = matchDanmu(fileName).catch(() => []);
  }

  let specificResultPromise = Promise.resolve(null);
  if (rawPlayId.includes("03yy.live")) specificResultPromise = play03yy(rawPlayId, playResult);
  else if (rawPlayId.includes("kxyytv.com")) specificResultPromise = playKaixin(rawPlayId, playResult);
  else if (rawPlayId.includes("zhenlang.cc")) specificResultPromise = playZhenlang(rawPlayId, playResult);

  const [specificResult, danmakuList] = await Promise.all([specificResultPromise, danmakuPromise]);

  if (danmakuList && danmakuList.length > 0) {
      if (specificResult) specificResult.danmaku = danmakuList;
      playResult.danmaku = danmakuList;
  }

  if (specificResult && specificResult.urls.length > 0) {
      logInfo(`播放解析完成 (直链), 耗时: ${Date.now() - t0}ms`);
      return specificResult;
  }

  try {
    const sniffResult = await OmniBox.sniffVideo(rawPlayId);
    if (sniffResult && sniffResult.url) {
      playResult.urls = [{ name: "嗅探线路", url: sniffResult.url }];
      playResult.header = sniffResult.header || DEFAULT_HEADERS;
      logInfo(`播放解析完成 (嗅探), 耗时: ${Date.now() - t0}ms`);
      return playResult;
    }
  } catch (e) {}

  playResult.urls = [{ name: "网页解析", url: rawPlayId }];
  playResult.parse = 1;
  logInfo(`播放解析完成 (交由播放器), 耗时: ${Date.now() - t0}ms`);
  return playResult;
}

module.exports = { home, category, detail, search, play };
const runner = require("spider_runner");
runner.run(module.exports);
