// @name 枫叶4K
// @author 梦
// @description 影视站：支持首页、分类（VIP精选/类型筛选）、详情、搜索与播放，补齐刮削、弹幕，基于 https://www.cd-zj.com
// @dependencies cheerio
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/枫叶4K.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");
const https = require("https");
const http = require("http");

const BASE_URL = "https://www.cd-zj.com";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const JD_PARSER_HOST = "https://fgsrg.hzqingshan.com";
const PAGE_LIMIT = 20;
const LIST_CACHE_TTL = Number(process.env.FENGYE4K_LIST_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.FENGYE4K_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.FENGYE4K_SEARCH_CACHE_TTL || 600);

const CATEGORY_CONFIG = [
  { id: "1", name: "电影", path: "/cupfox-list/1-----------.html" },
  { id: "2", name: "电视剧", path: "/cupfox-list/2-----------.html" },
  { id: "3", name: "综艺", path: "/cupfox-list/3-----------.html" },
  { id: "4", name: "动漫", path: "/cupfox-list/4-----------.html" },
  { id: "5", name: "热门短剧", path: "/cupfox-list/5-----------.html" },
  { id: "qq", name: "腾讯VIP精选", path: "/label/qq.html" },
  { id: "youku", name: "优酷VIP精选", path: "/label/youku.html" },
  { id: "bli", name: "B站VIP精选", path: "/label/bli.html" },
];

const CLASS_FILTERS = {
  "1": ["喜剧", "爱情", "恐怖", "动作", "科幻", "剧情", "战争", "警匪", "犯罪", "动画", "奇幻", "武侠", "冒险", "枪战", "悬疑", "惊悚", "经典"],
  "2": ["古装", "战争", "青春偶像", "喜剧", "家庭", "犯罪", "动作", "奇幻", "剧情", "历史", "经典", "乡村", "情景", "商战", "网剧", "其他"],
  "3": ["选秀", "情感", "访谈", "播报", "旅游", "音乐", "美食", "纪实", "曲艺", "生活", "游戏互动", "财经", "求职"],
  "4": ["热血", "格斗", "恋爱", "美少女", "校园", "搞笑", "神魔", "机战", "科幻", "真人", "青春", "魔法", "经典", "冒险", "竞技", "亲子", "童话"],
};

function encodeMeta(meta = {}) {
  try {
    return Buffer.from(JSON.stringify(meta), "utf8").toString("base64url");
  } catch (_) {
    return "";
  }
}

function decodeMeta(encoded = "") {
  try {
    if (!encoded) return {};
    return JSON.parse(Buffer.from(String(encoded), "base64url").toString("utf8"));
  } catch (_) {
    return {};
  }
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  if (mapping.episodeName) {
    return `${mapping.episodeNumber}.${mapping.episodeName}`;
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber,
    );
    if (hit?.name) {
      return `${hit.episodeNumber}.${hit.name}`;
    }
  }
  return originalName;
}

function preprocessTitle(title) {
  if (!title) return "";
  return String(title)
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chineseToArabic(cn) {
  const map = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (!isNaN(cn)) return parseInt(cn, 10);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === "十") return 10 + map[cn[1]];
    if (cn[1] === "十") return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
}

function extractEpisode(title) {
  if (!title) return "";
  const processed = preprocessTitle(title);
  const cnMatch = processed.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));
  const seMatch = processed.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];
  const epMatch = processed.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];
  const bracketMatch = processed.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    if (!["720", "1080", "480"].includes(num)) return num;
  }
  return "";
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return "";
  if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") return vodName;
  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) {
      return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
    }
  }
  return vodName;
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
  if (!scrapeData) return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
  if (scrapeType === "movie") {
    return scrapeData.title || fallbackVodName;
  }
  const title = scrapeData.title || fallbackVodName;
  const seasonAirYear = scrapeData.seasonAirYear || "";
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function requestText(url, options = {}, redirectCount = 0) {
  await OmniBox.log("info", `[枫叶4K][request] ${options.method || "GET"} ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      Referer: BASE_URL + "/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 20000,
  });
  const statusCode = Number(res?.statusCode || 0);
  if ([301, 302, 303, 307, 308].includes(statusCode) && redirectCount < 5) {
    const location = res?.headers?.location || res?.headers?.Location || res?.headers?.LOCATION;
    if (location) return requestText(absoluteUrl(location), options, redirectCount + 1);
  }
  if (!res || statusCode !== 200) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  return String(res.body || "");
}

async function requestTextNative(url, options = {}) {
  await OmniBox.log("info", `[枫叶4K][native-request] ${options.method || "GET"} ${url}`);
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const body = options.body == null ? "" : String(options.body);
    const headers = {
      "User-Agent": UA,
      Referer: BASE_URL + "/",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...(options.headers || {}),
    };
    if (body && headers["Content-Length"] == null && headers["content-length"] == null) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    const transport = requestUrl.protocol === "http:" ? http : https;
    const req = transport.request({
      protocol: requestUrl.protocol,
      hostname: requestUrl.hostname,
      port: requestUrl.port || (requestUrl.protocol === "http:" ? 80 : 443),
      path: `${requestUrl.pathname}${requestUrl.search}`,
      method: options.method || "GET",
      headers,
      timeout: options.timeout || 20000,
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode !== 200) {
          reject(new Error(`HTTP ${statusCode} @ ${url}`));
          return;
        }
        resolve(String(data || ""));
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error(`timeout @ ${url}`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getCachedText(cacheKey, ttl, producer) {
  try {
    const cached = await OmniBox.getCache(cacheKey);
    if (cached) return String(cached);
  } catch (_) {}
  const value = String(await producer());
  try {
    await OmniBox.setCache(cacheKey, value, ttl);
  } catch (_) {}
  return value;
}

function absoluteUrl(url) {
  try {
    return new URL(String(url || ""), BASE_URL).toString();
  } catch (_) {
    return String(url || "");
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function categoryNameById(categoryId) {
  return CATEGORY_CONFIG.find((item) => item.id === String(categoryId))?.name || "影视";
}

function isLabelCategory(categoryId) {
  return ["qq", "youku", "bli"].includes(String(categoryId));
}

function buildFilters() {
  const result = {};
  for (const [cid, list] of Object.entries(CLASS_FILTERS)) {
    result[cid] = [
      {
        key: "class",
        name: "类型",
        value: [{ n: "全部", v: "" }, ...list.map((x) => ({ n: x, v: x }))],
      },
    ];
  }
  return result;
}

function withPageToCupfox(path, page) {
  if (!path || !/\/cupfox-list\//.test(path)) return path;
  if (page <= 1) return path;
  const m = path.match(/^\/cupfox-list\/(.+)\.html$/i);
  if (!m) return path;
  const slug = m[1];
  if (/^\d+-{11}$/.test(slug)) {
    return `/cupfox-list/${slug.replace(/-{11}$/, `--------${page}---`)}.html`;
  }
  return path;
}

function buildClassFilterPath(categoryId, cls) {
  if (!cls) return null;
  return `/cupfox-list/${categoryId}---${encodeURIComponent(cls)}--------.html`;
}

function extractVodId(href) {
  const match = String(href || "").match(/detail\/(.*?)\.html/i);
  return match?.[1] || "";
}

function extractPlayId(href) {
  const match = String(href || "").match(/play\/(.*?)\.html/i);
  return match?.[1] || "";
}

function buildVodCard($, el) {
  const box = $(el);
  const a = box.find(".public-list-exp").first();
  const href = a.attr("href") || "";
  const vodId = extractVodId(href);
  if (!vodId) return null;
  const pic = box.find("img").first().attr("data-src") || box.find("img").first().attr("src") || "";
  return {
    vod_id: vodId,
    vod_name: normalizeText(a.attr("title") || box.find(".time-title").first().text() || ""),
    vod_pic: absoluteUrl(pic),
    vod_remarks: normalizeText(box.find(".public-list-prb").first().text()),
  };
}

function parseHomeList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  const seen = new Set();
  $(".public-list-box").each((_, el) => {
    const item = buildVodCard($, el);
    if (!item?.vod_id || seen.has(item.vod_id)) return;
    seen.add(item.vod_id);
    list.push(item);
  });
  return list;
}

function parseSearchList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  const seen = new Set();
  $(".search-box").each((_, el) => {
    const box = $(el);
    const a = box.find(".public-list-exp").first();
    const href = a.attr("href") || "";
    const vodId = extractVodId(href);
    if (!vodId || seen.has(vodId)) return;
    seen.add(vodId);
    const pic = a.find("img").first().attr("data-src") || a.find("img").first().attr("src") || "";
    list.push({
      vod_id: vodId,
      vod_name: normalizeText(box.find(".thumb-txt a").first().text()),
      vod_pic: absoluteUrl(pic),
      vod_remarks: normalizeText(a.find(".public-list-prb").first().text()),
    });
  });
  return list;
}

function parseDetail(htmlText, videoId) {
  const $ = cheerio.load(htmlText);
  const vodName = normalizeText($(".slide-info-title").first().text() || $("h1").first().text());
  const vodPic = absoluteUrl($(".detail-pic img").first().attr("data-src") || $(".detail-pic img").first().attr("src") || "");
  const vodContent = normalizeText($("#height_limit").first().text() || $(".switch-box .text").first().text());

  const sourceNames = [];
  $(".anthology-tab a").each((_, el) => {
    const name = normalizeText($(el).text()).replace(/\s/g, "").replace(/\(\d+\)/g, "");
    if (name) sourceNames.push(name);
  });

  const playSources = [];
  $(".anthology-list-box").each((idx, el) => {
    const lineName = sourceNames[idx] || `线路${idx + 1}`;
    const episodes = [];
    $(el).find("ul li a").each((epIdx, a) => {
      const name = normalizeText($(a).text()) || `第${epIdx + 1}集`;
      const rawPlayId = extractPlayId($(a).attr("href") || "");
      if (!rawPlayId) return;
      const fid = `${videoId}#${lineName}#${epIdx}`;
      const meta = {
        sid: String(videoId || ""),
        fid,
        v: vodName || "",
        e: name,
        t: lineName,
        i: epIdx,
      };
      episodes.push({ name, playId: `${rawPlayId}|||${encodeMeta(meta)}`, _fid: fid, _rawName: name });
    });
    episodes.reverse();
    if (episodes.length) {
      playSources.push({ name: lineName, episodes });
    }
  });

  if (!playSources.length) {
    const episodes = [];
    $(".anthology-list-play a, .playlist a, .play-list a").each((epIdx, a) => {
      const name = normalizeText($(a).attr("title") || $(a).text()) || `第${epIdx + 1}集`;
      const rawPlayId = extractPlayId($(a).attr("href") || "");
      if (!rawPlayId) return;
      const fid = `${videoId}#播放列表#${epIdx}`;
      const meta = {
        sid: String(videoId || ""),
        fid,
        v: vodName || "",
        e: name,
        t: "播放列表",
        i: epIdx,
      };
      episodes.push({ name, playId: `${rawPlayId}|||${encodeMeta(meta)}`, _fid: fid, _rawName: name });
    });
    if (episodes.length) {
      playSources.push({ name: "播放列表", episodes });
    }
  }

  const normalizedPlaySources = playSources.map((source) => ({
    name: source.name,
    episodes: (source.episodes || []).map((ep) => ({ name: ep.name, playId: ep.playId })),
  }));

  return {
    list: [{
      vod_id: String(videoId || ""),
      vod_name: vodName,
      vod_pic: vodPic,
      vod_content: vodContent,
      vod_play_sources: normalizedPlaySources,
    }],
    _play_sources_for_scrape: playSources,
  };
}

function extractPlayerConfig(html) {
  const m = String(html || "").match(/(?:var\s+)?player_aaaa\s*=\s*(\{[\s\S]*?\})(?:\s*;|\s*$|\s*<\/script>)/i);
  if (!m || !m[1]) return null;
  try {
    return JSON.parse(m[1].replace(/\\\//g, "/"));
  } catch (_) {
    try {
      return Function(`"use strict";return (${m[1].replace(/\\\//g, "/")})`)();
    } catch (_) {
      return null;
    }
  }
}

function resolveMediaUrl(base, href) {
  try {
    return new URL(href, base).toString();
  } catch (_) {
    return href;
  }
}

async function expandMasterM3u8(url, referer) {
  const real = String(url || "").trim();
  if (!/\.m3u8(?:$|[?#])/i.test(real)) return real;
  try {
    const res = await requestTextNative(real, {
      headers: {
        "User-Agent": UA,
        Referer: referer || BASE_URL + "/",
      },
      timeout: 8000,
    });
    if (res && /#EXT-X-STREAM-INF/i.test(res)) {
      const lines = res.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      for (let i = 0; i < lines.length; i++) {
        if (/^#EXT-X-STREAM-INF/i.test(lines[i])) {
          for (let j = i + 1; j < lines.length; j++) {
            if (!lines[j].startsWith("#")) {
              const child = resolveMediaUrl(real, lines[j]);
              await OmniBox.log("info", `[枫叶4K][play] m3u8 master expanded ${real} -> ${child}`);
              return child;
            }
          }
        }
      }
    }
  } catch (e) {
    await OmniBox.log("warn", `[枫叶4K][play] m3u8 master expand failed: ${e.message}`);
  }
  return real;
}

async function resolveJdUrl(jdUrl, playPageUrl, playId = "") {
  const parserUrl = `${JD_PARSER_HOST}/player/?url=${encodeURIComponent(jdUrl)}`;
  await OmniBox.log("info", `[枫叶4K][play] JD parser request playId=${playId}`);
  const parserHtml = await requestTextNative(parserUrl, {
    headers: {
      "User-Agent": UA,
      Referer: playPageUrl,
      Origin: BASE_URL,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const direct = parserHtml.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv)[^"']*)["']/i);
  if (direct && direct[1]) {
    const real = direct[1].replace(/\\\//g, "/");
    await OmniBox.log("info", `[枫叶4K][play] JD parser direct url=${real}`);
    return real;
  }
  const tokenMatch = parserHtml.match(/data-te="([^"]+)"/);
  const urlMatch = parserHtml.match(/data-u="([^"]+)"/);
  const vMatch = parserHtml.match(/data-v="([^"]+)"/);
  const token = tokenMatch?.[1] || "";
  if (!token) throw new Error("JD parser token not found");
  const params = new URLSearchParams();
  params.set("url", urlMatch?.[1] || jdUrl);
  params.set("token", token);
  if (vMatch?.[1]) params.set("v", vMatch[1]);
  const apiRaw = await requestTextNative(`${JD_PARSER_HOST}/player/mplayer.php`, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: JD_PARSER_HOST,
      Referer: parserUrl,
    },
    body: params.toString(),
  });
  const apiJson = JSON.parse(apiRaw || "{}");
  const real = String((apiJson && (apiJson.url || apiJson.data || apiJson.playurl)) || "").replace(/\\\//g, "/");
  if (!real) throw new Error(`JD mplayer empty url: ${JSON.stringify(apiJson).slice(0, 200)}`);
  await OmniBox.log("info", `[枫叶4K][play] JD mplayer success url=${real}`);
  return real;
}

async function parsePlayPage(playUrl, html) {
  try {
    const config = extractPlayerConfig(html);
    if (config && config.url) {
      const rawUrl = String(config.url || "").replace(/\\\//g, "/");
      const from = String(config.from || "").toUpperCase();
      if (/^https?:\/\//i.test(rawUrl) && /\.(m3u8|mp4|flv)(\?|$)/i.test(rawUrl)) {
        await OmniBox.log("info", `[枫叶4K][play] player config direct url=${rawUrl}`);
        return { type: "direct", url: rawUrl };
      }
      if (/^JD-/i.test(rawUrl) || /JD4K|JD2K/i.test(from) || /JD/i.test(from)) {
        return { type: "jd", url: rawUrl, from };
      }
      if (/^https?:\/\//i.test(rawUrl)) {
        return { type: "direct", url: rawUrl };
      }
    }

    const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
    if (iframe && iframe[1]) return { type: "direct", url: absoluteUrl(iframe[1]) };

    const m3u8Patterns = [
      /["']((?:https?:)?\/\/[^"']+\.m3u8[^"']*)["']/gi,
      /["']((?:https?:)?\/\/[^"']+\.mp4[^"']*)["']/gi,
      /var\s+url\s*=\s*["']([^"']+)["']/i,
      /url\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    ];
    for (const pattern of m3u8Patterns) {
      const matches = html.match(pattern);
      if (!matches) continue;
      for (const match of matches) {
        const urlMatch = match.match(/["']?(https?:\/\/[^"']+\.(?:m3u8|mp4|flv)[^"']*)["']?/i);
        if (urlMatch?.[1]) {
          let realUrl = urlMatch[1];
          if (realUrl.startsWith("//")) realUrl = `https:${realUrl}`;
          await OmniBox.log("info", `[枫叶4K][play] regex found url=${realUrl}`);
          return { type: "direct", url: realUrl };
        }
      }
    }
    return null;
  } catch (error) {
    await OmniBox.log("warn", `[枫叶4K][play] parse play page failed: ${error.message}`);
    return null;
  }
}

async function home() {
  try {
    const html = await getCachedText("fengye4k:home", LIST_CACHE_TTL, () => requestText(`${BASE_URL}/`));
    const list = parseHomeList(html).slice(0, 40);
    await OmniBox.log("info", `[枫叶4K][home] list=${list.length}`);
    return {
      class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })),
      filters: buildFilters(),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[枫叶4K][home] ${e.message}`);
    return { class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })), filters: buildFilters(), list: [] };
  }
}

async function category(params = {}) {
  try {
    const categoryId = String(params.categoryId || params.type_id || params.id || "1");
    const page = Math.max(1, Number(params.page) || 1);
    const extend = params.extend || params.filters || {};
    const cls = String(extend.class || extend.cate || extend.type || "");

    const tab = CATEGORY_CONFIG.find((item) => item.id === categoryId);
    if (!tab) return { page, pagecount: page, total: 0, list: [] };

    let url;
    if (isLabelCategory(categoryId)) {
      url = `${BASE_URL}${tab.path}`;
    } else if (cls) {
      const base = buildClassFilterPath(categoryId, cls);
      url = `${BASE_URL}${base}`;
    } else {
      url = `${BASE_URL}${withPageToCupfox(tab.path, page)}`;
    }

    const cacheKey = `fengye4k:category:${categoryId}:${page}:${cls}`;
    const html = await getCachedText(cacheKey, LIST_CACHE_TTL, () => requestText(url));
    const list = parseHomeList(html);
    await OmniBox.log("info", `[枫叶4K][category] category=${categoryId} page=${page} class=${cls} count=${list.length}`);
    return {
      page,
      pagecount: list.length >= PAGE_LIMIT ? page + 1 : page,
      total: page * list.length + (list.length ? 1 : 0),
      list: list.map((item) => ({ ...item, type_name: tab.name })),
    };
  } catch (e) {
    await OmniBox.log("error", `[枫叶4K][category] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function search(params = {}) {
  try {
    const wd = normalizeText(params.wd || params.keyword || params.key || "");
    const page = Math.max(1, Number(params.page) || 1);
    if (!wd) return { list: [] };
    const url = `${BASE_URL}/cupfox-search/-------------.html?wd=${encodeURIComponent(wd)}&page=${page}`;
    const html = await getCachedText(`fengye4k:search:${wd}:${page}`, SEARCH_CACHE_TTL, () => requestText(url));
    const list = parseSearchList(html);
    await OmniBox.log("info", `[枫叶4K][search] wd=${wd} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: list.length >= PAGE_LIMIT ? page + 1 : page,
      total: list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("warn", `[枫叶4K][search] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function detail(params = {}) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "");
    if (!videoId) return { list: [] };
    const url = `${BASE_URL}/detail/${videoId}.html`;
    const html = await getCachedText(`fengye4k:detail:${videoId}`, DETAIL_CACHE_TTL, () => requestText(url));
    const result = parseDetail(html, videoId);
    const vod = result.list?.[0];
    const scrapePlaySources = Array.isArray(result._play_sources_for_scrape) ? result._play_sources_for_scrape : vod?.vod_play_sources || [];

    if (vod && Array.isArray(scrapePlaySources) && scrapePlaySources.length > 0 && typeof OmniBox.processScraping === "function" && typeof OmniBox.getScrapeMetadata === "function") {
      let scrapeData = null;
      let videoMappings = [];
      let scrapeType = "";
      const scrapeCandidates = [];

      for (const source of scrapePlaySources) {
        for (const ep of source.episodes || []) {
          const fid = ep._fid || decodeMeta(String(ep.playId || "").split("|||")[1] || "")?.fid || ep.playId;
          if (!fid) continue;
          scrapeCandidates.push({
            fid,
            file_id: fid,
            file_name: ep._rawName || ep.name || "正片",
            name: ep._rawName || ep.name || "正片",
            format_type: "video",
          });
        }
      }

      await OmniBox.log("info", `[枫叶4K][detail] 刮削候选 videoId=${videoId} count=${scrapeCandidates.length} preview=${scrapeCandidates.slice(0, 3).map((item) => `${item.fid}=>${item.file_name}`).join(" | ")}`);
      if (scrapeCandidates.length > 0) {
        try {
          const scrapeKeyword = normalizeText(vod.vod_name || "");
          const scrapingResult = await OmniBox.processScraping(videoId, scrapeKeyword, scrapeKeyword, scrapeCandidates);
          await OmniBox.log("info", `[枫叶4K][detail] 刮削完成 videoId=${videoId} keyword=${scrapeKeyword} result=${JSON.stringify(scrapingResult || {}).slice(0, 200)}`);
          const metadata = await OmniBox.getScrapeMetadata(videoId);
          scrapeData = metadata?.scrapeData || null;
          videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
          scrapeType = metadata?.scrapeType || "";
          await OmniBox.log("info", `[枫叶4K][detail] 刮削元数据 videoId=${videoId} hasScrapeData=${!!scrapeData} mappings=${videoMappings.length} scrapeType=${scrapeType}`);
        } catch (error) {
          await OmniBox.log("warn", `[枫叶4K][detail] 刮削失败 videoId=${videoId}: ${error.message}`);
        }
      }

      if (scrapeData) {
        vod.vod_name = scrapeData.title || vod.vod_name;
        if (scrapeData.posterPath) {
          vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
        }
        if (scrapeData.overview) {
          vod.vod_content = scrapeData.overview;
        }
      }

      for (const source of vod.vod_play_sources || []) {
        for (const ep of source.episodes || []) {
          const parts = String(ep.playId || "").split("|||");
          const meta = decodeMeta(parts[1] || "");
          const fid = meta?.fid;
          if (!fid) continue;
          const mapping = videoMappings.find((item) => item?.fileId === fid);
          if (!mapping) continue;
          const oldName = ep.name;
          const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
          if (newName && newName !== oldName) {
            ep.name = newName;
            await OmniBox.log("info", `[枫叶4K][detail] 应用刮削分集名 ${oldName} -> ${newName}`);
          }
          meta.e = ep.name;
          meta.s = mapping.seasonNumber;
          meta.n = mapping.episodeNumber;
          ep.playId = `${parts[0]}|||${encodeMeta(meta)}`;
        }
      }
    }

    await OmniBox.log("info", `[枫叶4K][detail] id=${videoId} sources=${result.list?.[0]?.vod_play_sources?.length || 0}`);
    return result;
  } catch (e) {
    await OmniBox.log("error", `[枫叶4K][detail] ${e.message}`);
    return { list: [] };
  }
}

async function play(params = {}, context = {}) {
  try {
    let rawPlayId = String(params.id || params.playId || "");
    let playMeta = {};
    let vodName = "";
    let episodeName = "";

    if (rawPlayId.includes("|||")) {
      const [mainPlayId, metaB64] = rawPlayId.split("|||");
      rawPlayId = mainPlayId;
      playMeta = decodeMeta(metaB64 || "");
      vodName = playMeta.v || "";
      episodeName = playMeta.e || "";
      await OmniBox.log("info", `[枫叶4K][play] 解析透传信息 vod=${vodName} episode=${episodeName} fid=${playMeta.fid || ""}`);
    }

    const playId = String(rawPlayId || "").replace(/^\//, "").replace(/\.html(?:[?#].*)?$/i, "").replace(/^play\//i, "");
    if (!playId) return { parse: 1, url: "", urls: [], header: {} };
    const playUrl = `${BASE_URL}/play/${playId}.html`;

    const playInfoPromise = (async () => {
      const html = await requestText(playUrl);
      const parsed = await parsePlayPage(playUrl, html);
      const finalHeaders = {
        "User-Agent": UA,
        Referer: `${BASE_URL}/`,
        Origin: BASE_URL,
      };

      if (parsed) {
        let real = parsed.url;
        if (parsed.type === "jd") {
          real = await resolveJdUrl(parsed.url, playUrl, playId);
          finalHeaders.Referer = `${JD_PARSER_HOST}/player/`;
          finalHeaders.Origin = JD_PARSER_HOST;
        }
        real = await expandMasterM3u8(real, playUrl);
        await OmniBox.log("info", `[枫叶4K][play] success playId=${playId} type=${parsed.type} url=${real}`);
        return {
          parse: 0,
          url: real,
          urls: [{ name: "播放", url: real }],
          header: finalHeaders,
          headers: finalHeaders,
          danmaku: []};
      }

      await OmniBox.log("warn", `[枫叶4K][play] no playable url found playId=${playId}`);
      return {
        parse: 1,
        url: playUrl,
        urls: [{ name: "播放页", url: playUrl }],
        header: finalHeaders,
        headers: finalHeaders,
        danmaku: []};
    })();

    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
        scrapeTitle: "",
        episodeName: episodeName || "",
        scrapeType: "",
        mapping: null,
      };

      const videoIdForScrape = String(playMeta?.sid || params.videoId || params.vod_id || "");
      if (!videoIdForScrape || typeof OmniBox.getScrapeMetadata !== "function") {
        await OmniBox.log("info", `[枫叶4K][play] 播放增强链路跳过 videoId=${videoIdForScrape || ""}`);
        return result;
      }

      try {
        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
        if (!metadata || !metadata.scrapeData) {
          await OmniBox.log("info", `[枫叶4K][play] 播放增强链路跳过: metadata 不完整 videoId=${videoIdForScrape}`);
          return result;
        }

        result.scrapeTitle = metadata.scrapeData.title || "";
        result.scrapeType = metadata.scrapeType || "";

        const mappings = Array.isArray(metadata.videoMappings) ? metadata.videoMappings : [];
        await OmniBox.log("info", `[枫叶4K][play] 读取刮削元数据成功 videoId=${videoIdForScrape} mappings=${mappings.length} scrapeType=${result.scrapeType || "unknown"}`);
        const mapping = mappings.find((item) => item?.fileId === playMeta?.fid);
        result.mapping = mapping || null;
        if (mapping) {
          if (mapping.episodeName) {
            result.episodeName = buildScrapedEpisodeName(metadata.scrapeData, mapping, result.episodeName || episodeName || "");
          }
        } else if (mappings.length > 0) {
          await OmniBox.log("info", `[枫叶4K][play] 播放增强链路未命中 mapping fid=${playMeta?.fid || ""}`);
        }

        vodName = result.scrapeTitle || vodName;
        episodeName = result.episodeName || episodeName;
        const fileName = buildScrapedDanmuFileName(metadata.scrapeData, result.scrapeType, mapping, vodName, episodeName);
        if (fileName && typeof OmniBox.getDanmakuByFileName === "function") {
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
          const count = Array.isArray(matchedDanmaku) ? matchedDanmaku.length : 0;
          await OmniBox.log("info", `[枫叶4K][play] 弹幕匹配结果 fileName=${fileName} count=${count}`);
          if (count > 0) {
            result.danmakuList = matchedDanmaku;
          }
        }
      } catch (error) {
        await OmniBox.log("warn", `[枫叶4K][play] 读取刮削元数据失败: ${error.message}`);
      }

      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);
    if (playInfoResult.status !== "fulfilled") {
      throw playInfoResult.reason || new Error("播放主链路失败");
    }

    const playResult = playInfoResult.value || { urls: [], parse: 0, header: {}, danmaku: [] };
    let danmakuList = [];
    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
    } else if (metadataResult.status === "rejected") {
      await OmniBox.log("warn", `[枫叶4K][play] 播放增强链路失败(不影响播放): ${metadataResult.reason?.message || metadataResult.reason}`);
    }

    playResult.danmaku = danmakuList.length > 0 ? danmakuList : (playResult.danmaku || []);

    return playResult;
  } catch (e) {
    await OmniBox.log("error", `[枫叶4K][play] ${e.message}`);
    return { parse: 1, url: "", urls: [], header: {}, danmaku: [] };
  }
}