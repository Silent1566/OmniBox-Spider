// @name Auete影视
// @author 梦
// @description 刮削：不支持，弹幕：不支持，嗅探：不支持，支持站内直链播放
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/Auete影视.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = "https://auete.top";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const BASE_HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: `${HOST}/`,
};
const PLAY_HEADERS = {
  "User-Agent": UA,
  Referer: `${HOST}/`,
  Origin: HOST,
};

const CLASS_LIST = [
  { type_id: "Movie", type_name: "电影" },
  { type_id: "Tv", type_name: "电视剧" },
  { type_id: "Zy", type_name: "综艺" },
  { type_id: "Dm", type_name: "动漫" },
  { type_id: "qita", type_name: "其他" },
];

const FILTERS = {
  Movie: [
    {
      key: "cate",
      name: "类型",
      init: "",
      value: [
        { name: "全部", value: "" },
        { name: "喜剧片", value: "xjp" },
        { name: "动作片", value: "dzp" },
        { name: "爱情片", value: "aqp" },
        { name: "科幻片", value: "khp" },
        { name: "恐怖片", value: "kbp" },
        { name: "惊悚片", value: "jsp" },
        { name: "战争片", value: "zzp" },
        { name: "剧情片", value: "jqp" },
      ],
    },
  ],
};

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function logInfo(message, data = null) {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[Auete影视] ${output}`);
}

function logError(message, error) {
  OmniBox.log("error", `[Auete影视] ${message}: ${error?.message || error}`);
}

function buildUrl(path) {
  if (!path) return HOST;
  if (/^https?:\/\//i.test(path)) return path;
  return `${HOST}${path.startsWith("/") ? path : `/${path}`}`;
}

function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function requestHtml(url, extraHeaders = {}) {
  const finalUrl = buildUrl(url);
  logInfo("请求页面", { url: finalUrl });
  const response = await OmniBox.request(finalUrl, {
    method: "GET",
    headers: { ...BASE_HEADERS, ...extraHeaders },
  });
  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  return response.body || "";
}

function normalizePic(url) {
  const pic = String(url || "").trim();
  if (!pic) return "";
  if (/^https?:\/\//i.test(pic)) return pic;
  if (pic.startsWith("//")) return `https:${pic}`;
  return buildUrl(pic);
}

function getClassName(typeId) {
  return CLASS_LIST.find((item) => item.type_id === typeId)?.type_name || typeId;
}

function parseListItems(html, fallbackTypeId = "") {
  const list = [];
  const regex = /<li[^>]*class="[^"]*trans_3[^"]*"[^>]*>[\s\S]*?<a\s+href="([^"]+)"\s+class="pic"[\s\S]*?<img\s+src="([^"]+)"[^>]*alt="([^"]*)"[\s\S]*?<button\s+class="hdtag">([\s\S]*?)<\/button>[\s\S]*?<h2\s+class="title">[\s\S]*?<a[^>]*title="([^"]*)"[\s\S]*?<div\s+class="date_hits">[\s\S]*?<span\s+class="float-right">[\s\S]*?<\/i>\s*([\s\S]*?)<\/span>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const detailPath = match[1];
    const pic = normalizePic(match[2]);
    const altName = cleanText(match[3]);
    const remarks = cleanText(match[4]);
    const titleName = cleanText(match[5]) || altName;
    const score = cleanText(match[6]);
    const typeId = getTypeIdFromPath(detailPath) || fallbackTypeId;
    list.push({
      vod_id: detailPath,
      vod_name: titleName || altName,
      vod_pic: pic,
      vod_remarks: remarks || score,
      vod_douban_score: score,
      type_id: typeId,
      type_name: getClassName(typeId),
    });
  }
  return dedupeByVodId(list);
}

function dedupeByVodId(list) {
  const seen = new Set();
  return (list || []).filter((item) => {
    const key = item?.vod_id;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getTypeIdFromPath(path) {
  const match = String(path || "").match(/^\/(Movie|Tv|Zy|Dm|qita)\//i);
  return match ? match[1] : "";
}

function buildCategoryUrl(typeId, page, extend = {}) {
  const p = Number(page || 1);
  const cate = String(extend?.cate || "").trim();
  const prefix = cate ? `/${typeId}/${cate}` : `/${typeId}`;
  if (p <= 1) return `${prefix}/index.html`;
  return `${prefix}/index${p}.html`;
}

function extractPageCount(html, typeId, cate = "") {
  const prefix = cate ? `/${typeId}/${cate}/index` : `/${typeId}/index`;
  const regex = new RegExp(`${prefix}(\\d+)\\.html`, "gi");
  let maxPage = 1;
  let match;
  while ((match = regex.exec(html))) {
    const p = parseInt(match[1], 10);
    if (!Number.isNaN(p) && p > maxPage) maxPage = p;
  }
  return maxPage;
}

function encodePlayMeta(meta) {
  return Buffer.from(JSON.stringify(meta || {}), "utf8").toString("base64");
}

function decodePlayMeta(str) {
  try {
    return JSON.parse(Buffer.from(String(str || ""), "base64").toString("utf8") || "{}");
  } catch {
    return {};
  }
}

async function home(params, context) {
  try {
    const html = await requestHtml("/");
    const list = parseListItems(html);
    logInfo("首页解析完成", { classCount: CLASS_LIST.length, listCount: list.length });
    return {
      class: CLASS_LIST.map((item) => ({ ...item })),
      filters: FILTERS,
      list,
    };
  } catch (error) {
    logError("home 失败", error);
    return {
      class: CLASS_LIST.map((item) => ({ ...item })),
      filters: FILTERS,
      list: [],
    };
  }
}

async function category(params, context) {
  try {
    const typeId = String(params.type_id || params.tid || "Movie");
    const page = Number(params.page || 1);
    const extend = params.extend || {};
    const url = buildCategoryUrl(typeId, page, extend);
    const html = await requestHtml(url);
    const list = parseListItems(html, typeId);
    const pagecount = extractPageCount(html, typeId, String(extend?.cate || ""));
    logInfo("分类解析完成", { typeId, page, listCount: list.length, pagecount, extend });
    return {
      page,
      pagecount: Math.max(pagecount, page),
      total: Math.max(list.length, 1) * Math.max(pagecount, page),
      list,
    };
  } catch (error) {
    logError("category 失败", error);
    return {
      page: Number(params.page || 1),
      pagecount: Number(params.page || 1),
      total: 0,
      list: [],
    };
  }
}

async function detail(params, context) {
  try {
    const vodId = String(params.vod_id || params.videoId || params.id || "");
    if (!vodId) {
      throw new Error("缺少 vodId/videoId");
    }
    const html = await requestHtml(vodId);

    const titleMatch = html.match(/<h1 class="title break-all">([\s\S]*?)<\/h1>/i);
    const titleRaw = cleanText(titleMatch?.[1] || "");
    const coverMatch = html.match(/<div class="cover">[\s\S]*?<img\s+src="([^"]+)"/i);
    const vodPic = normalizePic(coverMatch?.[1] || "");
    const scoreMatch = html.match(/豆瓣评分:\s*<\/span><b>([^<]+)<\/b>/i);
    const remarksMatch = html.match(/状态:\s*<\/span><b>([^<]+)<\/b>/i);
    const summaryMatch = html.match(/◎影片简介:\s*<\/p>([\s\S]*?)(?:<div id="player_list"|<p class="border-top pt-2 mt-2">|<\/div><div class="card card-thread">)/i);

    const infoMap = {};
    const infoRegex = /◎影片([^:：<]+)[:：]\s*([\s\S]*?)<\/p>/gi;
    let infoMatch;
    while ((infoMatch = infoRegex.exec(html))) {
      infoMap[cleanText(infoMatch[1])] = cleanText(infoMatch[2]);
    }

    const sourceRegex = /<div id="player_list" class="clearfix mt-3">[\s\S]*?<h2 class="title[\s\S]*?』([^：]+)：[\s\S]*?<ul>([\s\S]*?)<\/ul>/gi;
    const vodPlaySources = [];
    let sourceMatch;
    while ((sourceMatch = sourceRegex.exec(html))) {
      const sourceName = cleanText(sourceMatch[1]);
      const ulHtml = sourceMatch[2] || "";
      const episodes = [];
      const episodeRegex = /<a[^>]+title="([^"]*)"[^>]+href="([^"]+play-\d+-\d+\.html)"[^>]*>([\s\S]*?)<\/a>/gi;
      let episodeMatch;
      while ((episodeMatch = episodeRegex.exec(ulHtml))) {
        const episodeTitle = cleanText(episodeMatch[1] || episodeMatch[3] || "播放");
        const playPath = episodeMatch[2];
        episodes.push({
          name: episodeTitle,
          playId: encodePlayMeta({
            playPath,
            source: sourceName,
            episodeName: episodeTitle,
            referer: buildUrl(vodId),
            vodName: infoMap["片名"] || titleRaw,
          }),
        });
      }
      if (episodes.length) {
        vodPlaySources.push({
          name: sourceName,
          episodes,
        });
      }
    }

    const vodName = infoMap["片名"] || titleRaw || cleanText(html.match(/<meta property="og:title" content="([^"]+)"/i)?.[1] || "");
    const vodYear = (infoMap["上映年份"] || "").match(/\d{4}/)?.[0] || "";
    const vodArea = infoMap["地区"] || "";
    const vodDirector = infoMap["导演"] || "";
    const vodActor = infoMap["主演"] || "";
    const vodContent = cleanText(summaryMatch?.[1] || "");
    const typeId = getTypeIdFromPath(vodId);
    const vodDetail = {
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: vodPic,
      type_id: typeId,
      type_name: getClassName(typeId),
      vod_year: vodYear,
      vod_area: vodArea,
      vod_director: vodDirector,
      vod_actor: vodActor,
      vod_remarks: remarksMatch ? cleanText(remarksMatch[1]) : (infoMap["备注"] || ""),
      vod_douban_score: scoreMatch ? cleanText(scoreMatch[1]) : "",
      vod_content: vodContent,
      vod_play_sources: vodPlaySources,
    };

    logInfo("详情解析完成", { vodId, sourceCount: vodPlaySources.length });
    return { list: [vodDetail] };
  } catch (error) {
    logError("detail 失败", error);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const wd = String(params.wd || params.keyword || params.key || "").trim();
    if (!wd) {
      return { page: 1, pagecount: 1, total: 0, list: [] };
    }
    const searchUrl = `/mipso.php?searchword=${encodeURIComponent(wd)}`;
    const html = await requestHtml(searchUrl, { Referer: `${HOST}/mipso.php` });
    const list = dedupeByVodId(parseSearchItems(html));
    logInfo("搜索解析完成", { wd, listCount: list.length });
    return {
      page: 1,
      pagecount: 1,
      total: list.length,
      list,
    };
  } catch (error) {
    logError("search 失败", error);
    return { page: 1, pagecount: 1, total: 0, list: [] };
  }
}

function parseSearchItems(html) {
  const list = [];
  const anchorRegex = /<a\s+href="((?:\/(?:Movie|Tv|Zy|Dm|qita)\/[^"]+\/))"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRegex.exec(html))) {
    const detailPath = match[1];
    const inner = match[2] || "";
    const titleAttr = inner.match(/title="([^"]+)"/i)?.[1] || "";
    const title = cleanText(titleAttr || inner);
    if (!detailPath || !title || /首页|电影|电视剧|综艺|动漫|其他|搜索|留言/.test(title)) continue;
    const windowStart = Math.max(0, match.index - 800);
    const windowEnd = Math.min(html.length, match.index + 1600);
    const snippet = html.slice(windowStart, windowEnd);
    const pic = normalizePic(snippet.match(/<img\s+src="([^"]+)"/i)?.[1] || "");
    const remarks = cleanText(snippet.match(/<button\s+class="hdtag">([\s\S]*?)<\/button>/i)?.[1] || "");
    const score = cleanText(snippet.match(/<span\s+class="float-right">[\s\S]*?<\/i>\s*([\s\S]*?)<\/span>/i)?.[1] || "");
    const typeId = getTypeIdFromPath(detailPath);
    list.push({
      vod_id: detailPath,
      vod_name: title,
      vod_pic: pic,
      vod_remarks: remarks || score,
      vod_douban_score: score,
      type_id: typeId,
      type_name: getClassName(typeId),
    });
  }
  return list;
}

async function play(params, context) {
  try {
    const meta = decodePlayMeta(params.play_id || params.playId || params.id || "");
    const playPath = meta.playPath || "";
    if (!playPath) {
      throw new Error("缺少 playPath");
    }
    const html = await requestHtml(playPath, {
      Referer: meta.referer || `${HOST}/`,
    });
    const pn = cleanText(html.match(/var\s+pn\s*=\s*"([^"]+)"/i)?.[1] || "");
    const encodedUrl = cleanText(html.match(/var\s+next\s*=\s*base64decode\("([^"]+)"\)/i)?.[1] || "");
    let directUrl = "";
    if (encodedUrl) {
      directUrl = Buffer.from(encodedUrl, "base64").toString("utf8");
    }
    if (!directUrl) {
      throw new Error(`未找到直链，pn=${pn}`);
    }

    const response = {
      parse: 0,
      header: PLAY_HEADERS,
      urls: [
        {
          name: meta.episodeName || "播放",
          url: directUrl
        },
      ]};
    logInfo("播放解析完成", { playPath, pn, hasDirectUrl: Boolean(directUrl) });
    return response;
  } catch (error) {
    logError("play 失败", error);
    return {
      parse: 0,
      urls: [],
    };
  }
}
