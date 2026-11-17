// @name 袋鼠影视
// @author 梦
// @description 影视站：https://dsystv.com ，支持首页、分类、详情、搜索与播放
// @dependencies cheerio
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/袋鼠影视.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = "https://dsystv.com";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const LIST_CACHE_TTL = Number(process.env.DAISHU_LIST_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.DAISHU_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.DAISHU_SEARCH_CACHE_TTL || 600);

const CATEGORY_CONFIG = [
  { id: "1", name: "电影" },
  { id: "2", name: "电视剧" },
  { id: "3", name: "综艺" },
  { id: "4", name: "动漫" },
];

const FILTERS = {
  "1": [
    { key: "tid", name: "类型", value: [{ name: "全部", value: "1" }, { name: "动作片", value: "5" }, { name: "喜剧片", value: "10" }, { name: "爱情片", value: "6" }, { name: "科幻片", value: "7" }, { name: "恐怖片", value: "8" }, { name: "战争片", value: "9" }, { name: "剧情片", value: "12" }, { name: "动画片", value: "41" }, { name: "纪录片", value: "11" }] },
    { key: "area", name: "地区", value: [{ name: "全部", value: "" }, { name: "大陆", value: "大陆" }, { name: "香港", value: "香港" }, { name: "台湾", value: "台湾" }, { name: "日本", value: "日本" }, { name: "韩国", value: "韩国" }, { name: "美国", value: "美国" }, { name: "英国", value: "英国" }, { name: "印度", value: "印度" }, { name: "法国", value: "法国" }, { name: "泰国", value: "泰国" }] },
    { key: "year", name: "年份", value: [{ name: "全部", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }, { name: "2024", value: "2024" }, { name: "2023", value: "2023" }, { name: "2022", value: "2022" }, { name: "2021", value: "2021" }, { name: "2020", value: "2020" }] },
  ],
  "2": [
    { key: "tid", name: "类型", value: [{ name: "全部", value: "2" }, { name: "国产剧", value: "13" }, { name: "港台剧", value: "14" }, { name: "欧美剧", value: "15" }, { name: "日韩剧", value: "16" }] },
    { key: "area", name: "地区", value: [{ name: "全部", value: "" }, { name: "大陆", value: "大陆" }, { name: "香港", value: "香港" }, { name: "台湾", value: "台湾" }, { name: "日本", value: "日本" }, { name: "韩国", value: "韩国" }, { name: "美国", value: "美国" }, { name: "英国", value: "英国" }] },
    { key: "year", name: "年份", value: [{ name: "全部", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }, { name: "2024", value: "2024" }, { name: "2023", value: "2023" }, { name: "2022", value: "2022" }] },
  ],
  "3": [
    { key: "area", name: "地区", value: [{ name: "全部", value: "" }, { name: "大陆", value: "大陆" }, { name: "日本", value: "日本" }, { name: "韩国", value: "韩国" }, { name: "美国", value: "美国" }] },
    { key: "year", name: "年份", value: [{ name: "全部", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }, { name: "2024", value: "2024" }] },
  ],
  "4": [
    { key: "area", name: "地区", value: [{ name: "全部", value: "" }, { name: "大陆", value: "大陆" }, { name: "日本", value: "日本" }, { name: "韩国", value: "韩国" }, { name: "美国", value: "美国" }] },
    { key: "year", name: "年份", value: [{ name: "全部", value: "" }, { name: "2026", value: "2026" }, { name: "2025", value: "2025" }, { name: "2024", value: "2024" }] },
  ],
};

const FILTER_DEF = {
  "1": { tid: "1", area: "", year: "" },
  "2": { tid: "2", area: "", year: "" },
  "3": { tid: "3", area: "", year: "" },
  "4": { tid: "4", area: "", year: "" },
};

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function requestText(url, options = {}, redirectCount = 0) {
  await OmniBox.log("info", `[袋鼠影视][request] ${options.method || "GET"} ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: options.referer || `${BASE_URL}/`,
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 20000,
  });
  const statusCode = Number(res?.statusCode || 0);
  if ([301, 302, 303, 307, 308].includes(statusCode) && redirectCount < 5) {
    const location = res?.headers?.location || res?.headers?.Location || res?.headers?.LOCATION;
    if (location) {
      const nextUrl = absoluteUrl(location);
      await OmniBox.log("info", `[袋鼠影视][redirect] ${url} -> ${nextUrl}`);
      return requestText(nextUrl, options, redirectCount + 1);
    }
  }
  if (!res || statusCode !== 200) {
    throw new Error(`HTTP ${statusCode || "unknown"} @ ${url}`);
  }
  return String(res.body || "");
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
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&emsp;/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePageCount($) {
  let max = 1;
  $(".hy-page a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/[?&]page=(\d+)/);
    if (match) max = Math.max(max, Number(match[1] || 1));
  });
  return max;
}

function dedupeVodList(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const key = String(item?.vod_id || item?.vod_name || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function parseCardFromThumb($, anchor) {
  const node = $(anchor);
  const href = node.attr("href") || "";
  const title = normalizeText(node.attr("title") || node.find("img").attr("alt") || node.closest(".item, dt").siblings(".title,.head").find("a,h3,h5").first().text());
  const pic = node.attr("data-original") || node.find("img").attr("data-original") || node.find("img").attr("src") || "";
  const remarks = normalizeText(node.find(".note").first().text() || node.closest("dt").find(".note").first().text() || node.closest(".item").find(".note").first().text());
  return {
    vod_id: absoluteUrl(href),
    vod_name: title,
    vod_pic: absoluteUrl(pic),
    vod_remarks: remarks,
  };
}

function parseHomeList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  $(".swiper-container.hy-slide a.videopic[href]").each((_, el) => {
    list.push(parseCardFromThumb($, el));
  });
  $(".hy-video-list .item a.videopic[href]").each((_, el) => {
    list.push(parseCardFromThumb($, el));
  });
  return dedupeVodList(list).filter((item) => item.vod_id && item.vod_name);
}

function parseCategoryList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  $(".hy-video-list .item a.videopic[href]").each((_, el) => {
    list.push(parseCardFromThumb($, el));
  });
  $(".hy-video-details .item dl.content").each((_, el) => {
    const box = $(el);
    const anchor = box.find("dt a.videopic[href]").first();
    const href = anchor.attr("href") || "";
    const title = normalizeText(box.find("dd .head a, dd .head h3, dd .head h5").first().text());
    const picStyle = anchor.attr("style") || "";
    const pic = anchor.attr("data-original") || anchor.find("img").attr("src") || ((picStyle.match(/url\(([^)]+)\)/) || [])[1] || "");
    const remarks = normalizeText(anchor.find(".note").first().text());
    list.push({
      vod_id: absoluteUrl(href),
      vod_name: title,
      vod_pic: absoluteUrl(pic.replace(/^['"]|['"]$/g, "")),
      vod_remarks: remarks,
      vod_actor: normalizeText(box.find("li:contains('主演')").first().text().replace(/^主演：/, "")),
      vod_director: normalizeText(box.find("li:contains('导演')").first().text().replace(/^导演：/, "")),
      vod_area: normalizeText(box.find("li:contains('地区')").first().text().replace(/^地区：/, "")),
      vod_lang: normalizeText(box.find("li:contains('语言')").first().text().replace(/^语言：/, "")),
      vod_year: normalizeText(box.find("li:contains('年份')").first().text().replace(/^年份：/, "")),
      vod_douban_score: normalizeText(box.find("li:contains('豆瓣')").first().text().replace(/^豆瓣：/, "")),
    });
  });
  return {
    list: dedupeVodList(list).filter((item) => item.vod_id && item.vod_name),
    pagecount: parsePageCount($),
  };
}

function parseSearchList(htmlText) {
  return parseCategoryList(htmlText);
}

function parseDetail(htmlText, detailUrl) {
  const $ = cheerio.load(htmlText);
  const title = normalizeText($("h1.h4, h1").first().text());
  const detailAnchor = $(".hy-video-details .content dt a.videopic").first();
  const pic = detailAnchor.find("img").attr("src") || detailAnchor.attr("data-original") || "";
  const remarks = normalizeText(detailAnchor.find(".note").first().text());
  const actor = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("主演：")).first();
  const director = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("导演：")).first();
  const year = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("年份：")).first();
  const area = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("地区：")).first();
  const typeLi = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("类型：")).first();
  const lang = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("语言：")).first();
  const alias = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("又名：")).first();
  const douban = $(".hy-video-details li").filter((_, el) => normalizeText($(el).text()).startsWith("豆瓣：")).first();
  const content = normalizeText($(".video-plot[data-video-plot]").html() || $("#list3 .plot").html() || $(".plot").html() || "");

  const playSources = [];
  $("#playlist .panel").each((_, panel) => {
    const sourceName = normalizeText($(panel).find("a.option").first().attr("title") || $(panel).find("a.option").first().clone().children().remove().end().text()) || `线路${playSources.length + 1}`;
    const episodes = [];
    $(panel).find(".playlist a[href]").each((__, a) => {
      const href = $(a).attr("href") || "";
      const epName = normalizeText($(a).attr("title") || $(a).text());
      if (!href || !epName) return;
      episodes.push({ name: epName, playId: absoluteUrl(href) });
    });
    if (episodes.length) playSources.push({ name: sourceName, episodes });
  });

  return {
    list: [{
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: absoluteUrl(pic),
      type_name: normalizeText(typeLi.text().replace(/^类型：/, "")),
      vod_remarks: remarks,
      vod_actor: normalizeText(actor.text().replace(/^主演：/, "")),
      vod_director: normalizeText(director.text().replace(/^导演：/, "")),
      vod_year: normalizeText(year.text().replace(/^年份：/, "")),
      vod_area: normalizeText(area.text().replace(/^地区：/, "")),
      vod_lang: normalizeText(lang.text().replace(/^语言：/, "")),
      vod_douban_score: normalizeText(douban.text().replace(/^豆瓣：/, "")),
      vod_content: content,
      vod_play_sources: playSources,
      other: normalizeText(alias.text().replace(/^又名：/, "")),
    }],
  };
}

function buildCategoryUrl(categoryId, page, filters = {}) {
  const baseFilter = FILTER_DEF[String(categoryId)] || { tid: String(categoryId) };
  const merged = { ...baseFilter, ...(filters || {}) };
  const tid = String(merged.tid || categoryId || "1");
  const params = new URLSearchParams({ searchtype: "5", tid, page: String(page || 1) });
  if (merged.area) params.set("area", String(merged.area));
  if (merged.year) params.set("year", String(merged.year));
  return `${BASE_URL}/search.php?${params.toString()}`;
}

async function home(params, context) {
  try {
    const html = await getCachedText("daishu:home", LIST_CACHE_TTL, async () => requestText(`${BASE_URL}/`));
    return {
      class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })),
      filters: FILTERS,
      list: parseHomeList(html),
    };
  } catch (e) {
    await OmniBox.log("error", `[袋鼠影视][home] ${e.message}`);
    return { class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })), filters: FILTERS, list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = String(params.categoryId || params.type_id || "1");
    const page = Math.max(1, Number(params.page || 1));
    const filters = params.extend || params.filters || params.ext || {};
    const url = buildCategoryUrl(categoryId, page, filters);
    const html = await getCachedText(`daishu:category:${url}`, LIST_CACHE_TTL, async () => requestText(url));
    const parsed = parseCategoryList(html);
    const pagecount = parsed.pagecount || (parsed.list.length >= 20 ? page + 1 : page);
    return {
      page,
      pagecount,
      total: pagecount * Math.max(parsed.list.length, 1),
      list: parsed.list,
    };
  } catch (e) {
    await OmniBox.log("error", `[袋鼠影视][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || "").trim();
    if (!videoId) return { list: [] };
    const url = /^https?:\/\//.test(videoId) ? videoId : absoluteUrl(videoId);
    const html = await getCachedText(`daishu:detail:${url}`, DETAIL_CACHE_TTL, async () => requestText(url));
    return parseDetail(html, url);
  } catch (e) {
    await OmniBox.log("error", `[袋鼠影视][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const wd = String(params.keyword || params.wd || params.key || "").trim();
    const page = Math.max(1, Number(params.page || 1));
    if (!wd) return { page, pagecount: 0, total: 0, list: [] };
    const body = `searchword=${encodeURIComponent(wd)}`;
    const html = await getCachedText(`daishu:search:${wd}:${page}`, SEARCH_CACHE_TTL, async () => requestText(`${BASE_URL}/search.php?page=${page}`, {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      referer: `${BASE_URL}/search.php`,
    }));
    const parsed = parseSearchList(html);
    const totalMatch = html.match(/相关的.{0,40}“(\d+)”.{0,20}条结果/);
    const total = totalMatch ? Number(totalMatch[1] || 0) : parsed.list.length;
    return {
      page,
      pagecount: parsed.pagecount || page,
      total,
      list: parsed.list,
    };
  } catch (e) {
    await OmniBox.log("error", `[袋鼠影视][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params.playId || params.id || "").trim();
    if (!playId) return { parse: 1, url: "", urls: [], header: {} };
    const url = absoluteUrl(playId);
    const html = await requestText(url, { referer: url });
    const match = html.match(/var\s+now\s*=\s*"([^"]+)"/);
    const directUrl = match ? String(match[1] || "").trim() : "";
    if (directUrl) {
      return {
        parse: 0,
        url: directUrl,
        urls: [{ name: "播放", url: directUrl }],
        header: {
          "User-Agent": UA,
          Referer: url,
        },
      };
    }
    return {
      parse: 1,
      url,
      urls: [{ name: "播放页", url }],
      header: {
        "User-Agent": UA,
        Referer: url,
      },
    };
  } catch (e) {
    await OmniBox.log("error", `[袋鼠影视][play] ${e.message}`);
    return { parse: 1, url: String(params.playId || params.id || ""), urls: [], header: {} };
  }
}
