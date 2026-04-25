// @name 威尔伯TV
// @author 梦
// @description 刮削：已接入，弹幕：未接入，嗅探：直接返回 play.modujx11.com 直链
// @dependencies cheerio
// @version 1.0.5
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/openclaw/影视/采集/威尔伯TV.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const HOST = "https://wei2bo.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Referer: `${HOST}/`,
  Origin: HOST,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};

const CATEGORY_MAP = [
  { type_id: "movie", type_name: "电影" },
  { type_id: "tv", type_name: "电视剧" },
  { type_id: "anime", type_name: "动漫" },
  { type_id: "variety", type_name: "综艺" },
];

const HOME_SECTION_MARKERS = {
  movie: 'href":"/video/movie"',
  tv: 'href":"/video/tv"',
  anime: 'href":"/video/anime"',
  variety: 'href":"/video/variety"',
};

const FILTERS = {
  movie: [{ key: "type", name: "按类型", init: "", value: [
    { name: "全部", value: "" },
    { name: "喜剧", value: "5" },
    { name: "爱情", value: "6" },
    { name: "动作", value: "7" },
    { name: "犯罪", value: "8" },
    { name: "科幻", value: "9" },
    { name: "灾难", value: "11" },
    { name: "恐怖", value: "12" },
    { name: "剧情", value: "13" },
    { name: "战争", value: "14" },
    { name: "悬疑", value: "15" },
    { name: "动画", value: "16" },
    { name: "其他", value: "28" },
  ] }],
  tv: [{ key: "type", name: "按类型", init: "", value: [
    { name: "全部", value: "" },
    { name: "国产剧", value: "17" },
    { name: "港台剧", value: "18" },
    { name: "日韩剧", value: "19" },
    { name: "欧美剧", value: "20" },
    { name: "其他剧", value: "21" },
  ] }],
  anime: [{ key: "type", name: "按类型", init: "", value: [
    { name: "全部", value: "" },
    { name: "国产动漫", value: "22" },
    { name: "日本动漫", value: "23" },
    { name: "欧美动漫", value: "29" },
  ] }],
  variety: [{ key: "type", name: "按类型", init: "", value: [
    { name: "全部", value: "" },
    { name: "国产综艺", value: "24" },
    { name: "港台综艺", value: "25" },
    { name: "日韩综艺", value: "26" },
    { name: "欧美综艺", value: "27" },
  ] }],
};

function buildFilters() {
  const result = {};
  for (const item of CATEGORY_MAP) {
    result[item.type_id] = FILTERS[item.type_id] || [];
  }
  return result;
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function log(level, message, data) {
  const suffix = typeof data === "undefined" ? "" : ` | ${JSON.stringify(data)}`;
  return OmniBox.log(level, `[威尔伯TV] ${message}${suffix}`);
}

function absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${HOST}${value}`;
  return `${HOST}/${value}`;
}

function clean(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeRsc(html) {
  return String(html || "").replace(/\\"/g, '"');
}

function fetchText(url, options = {}) {
  return OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      ...HEADERS,
      ...(options.headers || {}),
      Referer: options.referer || `${HOST}/`,
    },
    timeout: options.timeout || 20000,
    body: options.body,
  }).then((res) => {
    if (!res || Number(res.statusCode) < 200 || Number(res.statusCode) >= 400) {
      throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
    }
    return String(res.body || "");
  });
}

function extractCarouselList(html) {
  const text = decodeRsc(html);
  const list = [];
  const seen = new Set();
  const regex = /\{"id":(\d+),"vod":\{"id":(\d+),"vodName":"([^"]+)","vodPic":"([^"]+)","vodRemarks":"([^"]*)"/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const vodId = String(match[2] || "").trim();
    if (!vodId || seen.has(vodId)) continue;
    seen.add(vodId);
    list.push({
      vod_id: vodId,
      vod_name: clean(match[3]),
      vod_pic: absUrl(match[4]),
      vod_remarks: clean(match[5]),
      vod_content: "",
    });
  }
  return list;
}

function extractGridListFromText(text, urlPrefix) {
  const list = [];
  const seen = new Set();
  const pattern = /\{"id":(\d+),"vodName":"([^"]+)","vodPic":"([^"]+)","vodRemarks":"([^"]*)"/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const vodId = String(match[1] || "").trim();
    if (!vodId || seen.has(vodId)) continue;
    seen.add(vodId);
    list.push({
      vod_id: vodId,
      vod_name: clean(match[2]),
      vod_pic: absUrl(match[3]),
      vod_remarks: clean(match[4]),
      vod_url: `${HOST}${urlPrefix}/${vodId}`,
      vod_content: "",
    });
  }
  return list;
}

function extractSectionList(html, typeId) {
  const text = decodeRsc(html);
  const marker = HOME_SECTION_MARKERS[typeId];
  if (!marker) return [];
  const start = text.indexOf(marker);
  if (start < 0) return [];

  let nextStart = text.length;
  for (const [otherType, otherMarker] of Object.entries(HOME_SECTION_MARKERS)) {
    if (otherType === typeId) continue;
    const idx = text.indexOf(otherMarker, start + marker.length);
    if (idx >= 0 && idx < nextStart) nextStart = idx;
  }

  const sectionText = text.slice(start, nextStart);
  const urlPrefix = `/${typeId}`;
  return extractGridListFromText(sectionText, urlPrefix);
}

function mergeHomeSections(html) {
  const merged = [];
  const seen = new Set();
  for (const item of CATEGORY_MAP) {
    const sectionList = extractSectionList(html, item.type_id);
    for (const vod of sectionList) {
      if (!vod?.vod_id || seen.has(vod.vod_id)) continue;
      seen.add(vod.vod_id);
      merged.push(vod);
    }
  }
  return merged;
}

function pickTypeFromId(typeId) {
  return CATEGORY_MAP.find((item) => item.type_id === typeId)?.type_name || "";
}

function extractInfoTokens(text) {
  const match = text.match(/className":"text-gray-1 text-sm","children":\[(.*?)\]\}/);
  if (!match) return [];
  return [...match[1].matchAll(/"([^"]*)"/g)]
    .map((m) => clean(m[1]))
    .filter((item) => item && item !== "·");
}

function buildDetailResult(html, vodId, typeId) {
  const $ = cheerio.load(html);
  const text = decodeRsc(html);
  const title = clean($("title").text()).replace(/\s+在线观看.*$/, "") || clean($("meta[property='og:title']").attr("content"));
  const poster = absUrl($("meta[property='og:image']").attr("content"));
  const contentMatch = text.match(/"vodContent":"([^"]*)"/);
  const content = clean(contentMatch?.[1] || $("meta[property='og:description']").attr("content") || $("meta[name='description']").attr("content") || "");
  const directorMatch = text.match(/q=导演:([^"&]+)["&]/);
  const director = clean(directorMatch?.[1] || $("a[href*='google.com/search?q=导演:']").text() || "");
  const infoTokens = extractInfoTokens(text);
  const vodYear = infoTokens.find((item) => /^\d{4}$/.test(item)) || "";
  const maybeLang = infoTokens.filter((item) => !/^\d{4}$/.test(item));
  const typeName = maybeLang[0] || pickTypeFromId(typeId) || "";
  const lang = maybeLang[maybeLang.length - 1] || "";
  const infoLine = [typeName, vodYear, lang].filter(Boolean).join(" · ");

  const playUrlMatch = text.match(/https:\/\/play\.modujx11\.com\/[^"\s]+\.m3u8/);
  const episodeMatches = [...text.matchAll(/([^"\[]+)\$(https:\/\/play\.modujx11\.com\/[^"\s]+\.m3u8)/g)];
  const episodes = [];
  const seen = new Set();
  for (const item of episodeMatches) {
    const name = clean(item[1]);
    const url = item[2];
    if (!name || !url || seen.has(`${name}|${url}`)) continue;
    seen.add(`${name}|${url}`);
    episodes.push({ name, playId: url });
  }
  if (!episodes.length && playUrlMatch) {
    episodes.push({ name: "正片", playId: playUrlMatch[0] });
  }

  return {
    vod_id: String(vodId || ""),
    vod_name: title,
    vod_pic: poster,
    type_name: typeName,
    vod_year: vodYear,
    vod_content: content,
    vod_actor: "",
    vod_director: director || "",
    vod_remarks: infoLine,
    vod_play_sources: episodes.length ? [{ name: "正片", episodes }] : [],
  };
}

async function home(params, context) {
  await log("info", "home 开始", { params: params || {}, from: context?.from || "web" });
  try {
    const html = await fetchText(`${HOST}/`);
    const rawVodNameCount = (html.match(/vodName/g) || []).length;
    const rawUrlPrefixCount = (html.match(/urlPrefix/g) || []).length;
    const firstVodNameIdx = html.indexOf("vodName");
    await log("info", "home 抓取完成", {
      htmlLength: html.length,
      rawVodNameCount,
      rawUrlPrefixCount,
      firstVodNameIdx,
      firstVodNameSnippet: firstVodNameIdx >= 0 ? html.slice(Math.max(0, firstVodNameIdx - 80), firstVodNameIdx + 220) : "",
    });

    let list = extractCarouselList(html);
    await log("info", "home 轮播解析", { listCount: list.length, first: list[0] || null });
    if (!list.length) {
      list = mergeHomeSections(html).slice(0, 24);
      for (const item of CATEGORY_MAP) {
        const sectionList = extractSectionList(html, item.type_id);
        await log("info", "home 分区解析", { typeId: item.type_id, count: sectionList.length, first: sectionList[0] || null });
      }
    }

    const filters = buildFilters();
    await log("info", "home 解析完成", { listCount: list.length, first: list[0] || null, filterKeys: Object.keys(filters) });
    return { class: CATEGORY_MAP, filters, list };
  } catch (e) {
    await log("error", "home 失败", { error: e.message });
    return { class: CATEGORY_MAP, filters: buildFilters(), list: [] };
  }
}

async function category(params, context) {
  await log("info", "category 开始", { params: params || {}, from: context?.from || "web" });
  try {
    const typeId = String(params.categoryId || params.type_id || params.type || "movie").trim();
    const page = Math.max(1, parseInt(params.page || 1, 10));
    const subType = String((params.filters && params.filters.type) || params.type || "").trim();
    const path = subType ? `/video/${typeId}?type=${encodeURIComponent(subType)}` : `/video/${typeId}`;

    const categoryHtml = await fetchText(`${HOST}${path}`);
    await log("info", "category 页面抓取完成", {
      typeId,
      page,
      path,
      htmlLength: categoryHtml.length,
      rawVodNameCount: (categoryHtml.match(/vodName/g) || []).length,
      rawUrlPrefixCount: (categoryHtml.match(/urlPrefix/g) || []).length,
    });

    let list = extractSectionList(categoryHtml, typeId);
    await log("info", "category 页面解析结果", { typeId, page, listCount: list.length, first: list[0] || null });

    if (!list.length) {
      const homeHtml = await fetchText(`${HOST}/`);
      await log("info", "category 回退首页抓取完成", {
        typeId,
        homeHtmlLength: homeHtml.length,
        homeVodNameCount: (homeHtml.match(/vodName/g) || []).length,
        homeUrlPrefixCount: (homeHtml.match(/urlPrefix/g) || []).length,
      });
      list = extractSectionList(homeHtml, typeId);
      await log("info", "category 回退首页解析结果", { typeId, page, listCount: list.length, first: list[0] || null });
    }

    return {
      page,
      pagecount: page + (list.length >= 12 ? 1 : 0),
      total: list.length,
      filters: FILTERS[typeId] || [],
      list,
    };
  } catch (e) {
    await log("error", "category 失败", { error: e.message, params });
    return { page: 1, pagecount: 0, total: 0, filters: FILTERS[String(params?.categoryId || params?.type_id || params?.type || "movie").trim()] || [], list: [] };
  }
}

async function detail(params, context) {
  await log("info", "detail 开始", { params: params || {}, from: context?.from || "web" });
  try {
    const vodId = String(params.videoId || params.vod_id || params.id || "").trim();
    const typeId = String(params.type_id || params.type || "movie").trim();
    if (!vodId) return { list: [] };
    const url = `${HOST}/video/${typeId}/${vodId}`;
    await log("info", "detail 请求前", { url, vodId, typeId });
    const html = await fetchText(url);
    await log("info", "detail 请求后", { url, htmlLength: html.length, m3u8Count: (html.match(/play\.modujx11\.com/g) || []).length });
    const vod = buildDetailResult(html, vodId, typeId);
    await log("info", "detail 解析完成", {
      vodId,
      vodName: vod.vod_name,
      remarks: vod.vod_remarks,
      director: vod.vod_director,
      contentLength: (vod.vod_content || '').length,
      sourceCount: vod.vod_play_sources.length,
      episodeCount: vod.vod_play_sources.reduce((n, s) => n + (s.episodes || []).length, 0),
    });
    return { list: [vod] };
  } catch (e) {
    await log("error", "detail 失败", { error: e.message, params });
    return { list: [] };
  }
}

async function search(params, context) {
  await log("info", "search 开始", { params: params || {}, from: context?.from || "web" });
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    const page = Math.max(1, parseInt(params.page || 1, 10));
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const html = await fetchText(`${HOST}/search?wd=${encodeURIComponent(keyword)}`);
    const rawVodNameCount = (html.match(/vodName/g) || []).length;
    const idx = html.indexOf(keyword);
    await log("info", "search 请求后", {
      keyword,
      page,
      htmlLength: html.length,
      rawVodNameCount,
      keywordIndex: idx,
      keywordSnippet: idx >= 0 ? html.slice(Math.max(0, idx - 80), idx + 220) : "",
    });

    let list = extractSectionList(html, "movie");
    if (!list.length) {
      const homeHtml = await fetchText(`${HOST}/`);
      const merged = mergeHomeSections(homeHtml);
      list = merged.filter((item) => String(item.vod_name || '').includes(keyword)).slice(0, 24);
      await log("info", "search 首页兜底结果", { keyword, page, mergedCount: merged.length, listCount: list.length, first: list[0] || null });
    }

    await log("info", "search 解析结果", { keyword, page, listCount: list.length, first: list[0] || null });
    return { page, pagecount: page + (list.length >= 12 ? 1 : 0), total: list.length, list };
  } catch (e) {
    await log("error", "search 失败", { error: e.message, params });
    return { page: 1, pagecount: 0, total: 0, filters: FILTERS[String(params?.categoryId || params?.type_id || params?.type || "movie").trim()] || [], list: [] };
  }
}

async function play(params, context) {
  await log("info", "play 开始", { params: params || {}, from: context?.from || "web" });
  try {
    const playUrl = String(params.playId || params.url || "").trim();
    if (!playUrl) return { parse: 0, urls: [] };
    const result = {
      parse: 0,
      flag: String(params.flag || "威尔伯TV"),
      header: { Referer: HOST, Origin: HOST, "User-Agent": UA },
      urls: [{ name: String(params.name || "正片"), url: playUrl }],
    };
    await log("info", "play 完成", { parse: result.parse, urlCount: result.urls.length, first: result.urls[0] || null });
    return result;
  } catch (e) {
    await log("error", "play 失败", { error: e.message, params });
    return { parse: 0, urls: [] };
  }
}
