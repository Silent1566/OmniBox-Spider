// @name 4KMP
// @author 梦
// @description 4k-av.com：支持首页、分类、搜索、详情与直链播放，站点请求使用苹果 Safari UA
// @dependencies cheerio
// @version 1.0.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/4KMP.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = "https://4k-av.com";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15";
const REQUEST_TIMEOUT = Number(process.env.KMP_TIMEOUT || 20000);

const CLASS_LIST = [
  { type_id: "movie", type_name: "电影" },
  { type_id: "tv", type_name: "电视剧" },
];

const YEAR_VALUES = [
  { name: "全部", value: "" },
  { name: "2026", value: "2026" },
  { name: "2025", value: "2025" },
  { name: "2024", value: "2024" },
  { name: "2023", value: "2023" },
  { name: "2022", value: "2022" },
  { name: "2021", value: "2021" },
  { name: "2020", value: "2020" },
  { name: "2019", value: "2019" },
];

const TAG_VALUES = [
  { name: "全部", value: "" },
  { name: "动作", value: "动作" },
  { name: "剧情", value: "剧情" },
  { name: "冒险", value: "冒险" },
  { name: "喜剧", value: "喜剧" },
  { name: "科幻", value: "科幻" },
  { name: "悬疑", value: "悬疑" },
  { name: "惊悚", value: "惊悚" },
  { name: "恐怖", value: "恐怖" },
  { name: "战争", value: "战争" },
  { name: "犯罪", value: "犯罪" },
  { name: "动画", value: "动画" },
  { name: "纪录片", value: "纪录片" },
  { name: "国产剧", value: "国产剧" },
  { name: "美剧", value: "美剧" },
  { name: "韩剧", value: "韩剧" },
];

const FILTERS = {
  movie: [
    { key: "year", name: "年份", init: "", value: YEAR_VALUES },
    { key: "tag", name: "标签", init: "", value: TAG_VALUES },
  ],
  tv: [
    { key: "year", name: "年份", init: "", value: YEAR_VALUES },
    { key: "tag", name: "标签", init: "", value: TAG_VALUES },
  ],
};

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return String(body || "");
}

function cleanText(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#183;/g, "·")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value.replace(/^\.\//, "")}`;
}

function buildHeaders(referer = `${BASE_URL}/`, extra = {}) {
  return {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: referer || `${BASE_URL}/`,
    ...extra,
  };
}

function buildPlayHeaders(referer = `${BASE_URL}/`) {
  return {
    "User-Agent": UA,
    Referer: referer || `${BASE_URL}/`,
    Origin: BASE_URL,
  };
}

async function fetchText(url, options = {}) {
  const finalUrl = absUrl(url);
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    await OmniBox.log("info", `[4KMP][request] ${finalUrl}`);
    const res = await OmniBox.request(finalUrl, {
      method: options.method || "GET",
      headers: buildHeaders(options.referer, options.headers || {}),
      body: options.body,
      timeout: options.timeout || REQUEST_TIMEOUT,
    });
    const statusCode = Number(res?.statusCode || 0);
    if (res && statusCode === 200) return getBodyText(res);

    lastError = String(res?.statusCode || "unknown");
    await OmniBox.log("warn", `[4KMP][request] attempt ${attempt + 1} HTTP ${lastError} @ ${finalUrl}`);
  }
  throw new Error(`HTTP ${lastError} @ ${finalUrl}`);
}

function dedupeById(list) {
  const seen = new Set();
  return (list || []).filter((item) => {
    const key = item?.vod_id || item?.playId || item?.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectTypeId(href) {
  const value = String(href || "");
  if (/\/tv\//i.test(value)) return "tv";
  if (/\/movie\//i.test(value)) return "movie";
  return "";
}

function pickLabels($, $box) {
  const map = {};
  $box.find(".resyear label, #MainContent_videodetail label, #MainContent_videodetail span").each((_, el) => {
    const $el = $(el);
    const title = cleanText($el.attr("title") || "");
    const text = cleanText($el.text());
    if (title) map[title] = text.replace(new RegExp(`^${title}[:：]\\s*`), "");
    else if (/分辨率/.test(text)) map["分辨率"] = text.replace(/^分辨率[:：]\s*/, "");
    else if (/片长/.test(text)) map["片长"] = text.replace(/^片长[:：]\s*/, "");
    else if (/年份/.test(text)) map["年份"] = text.replace(/^年份[:：]\s*/, "");
  });
  return map;
}

function mapVodCard($, el) {
  const $box = $(el);
  const $titleLink = $box.find(".title a[href*='/movie/'], .title a[href*='/tv/'], a[href*='/movie/'], a[href*='/tv/']").first();
  const href = $titleLink.attr("href") || "";
  const name = cleanText($titleLink.attr("title") || $titleLink.find("h2").text() || $titleLink.text());
  if (!href || !name) return null;

  const labels = pickLabels($, $box);
  const tags = [];
  $box.find(".tags span").each((_, tag) => {
    const text = cleanText($(tag).text());
    if (text && text !== "标签:") tags.push(text);
  });

  const subtitle = cleanText($box.find(".info h3").first().text());
  const content = cleanText($box.find(".videodesc").first().text());
  const pic = absUrl(
    $box.find(".poster img").first().attr("src") ||
    $box.find(".poster img").first().attr("data-src") ||
    $box.find(".screenshot img").first().attr("src") ||
    $box.find("img").first().attr("src") ||
    ""
  );

  return {
    vod_id: absUrl(href),
    vod_name: name,
    vod_pic: pic,
    vod_url: absUrl(href),
    vod_remarks: labels["分辨率"] || "",
    vod_year: labels["年份"] || "",
    vod_subtitle: subtitle,
    vod_content: content,
    type_id: detectTypeId(href),
    type_name: tags.join(" / "),
  };
}

function parseVodList(html, selector = "#MainContent_newestlist .NTMitem") {
  const $ = cheerio.load(html || "", { decodeEntities: false });
  const list = [];
  $(selector).each((_, el) => {
    const item = mapVodCard($, el);
    if (item) list.push(item);
  });

  if (!list.length) {
    $("#recommlist .RTMitem").each((_, el) => {
      const item = mapVodCard($, el);
      if (item) list.push(item);
    });
  }

  return dedupeById(list);
}

function parsePageCount(html) {
  const textMatch = String(html || "").match(/页次\s*\d+\s*\/\s*(\d+)/);
  if (textMatch) {
    const count = Number(textMatch[1]);
    if (Number.isFinite(count) && count > 0) return count;
  }

  let maxPage = 1;
  const regex = /page-(\d+)\.html/gi;
  let match;
  while ((match = regex.exec(String(html || "")))) {
    const page = Number(match[1]);
    if (Number.isFinite(page) && page > maxPage) maxPage = page;
  }
  return maxPage;
}

function normalizeExtend(params) {
  return params?.extend || params?.filters || {};
}

function buildCategoryBasePath(typeId, extend = {}) {
  const year = String(extend.year || "").trim();
  const tag = String(extend.tag || "").trim();
  if (tag) return `/tag/${encodeURIComponent(tag)}/`;
  if (year) return `/${encodeURIComponent(year)}/`;

  const id = String(typeId || "movie").trim();
  if (id === "tv" || id === "movie") return `/${id}/`;
  if (/^\/.+\/$/.test(id)) return id;
  if (/^tag[:/]/i.test(id)) {
    const tagName = id.replace(/^tag[:/]/i, "").replace(/^\/|\/$/g, "");
    return `/tag/${encodeURIComponent(tagName)}/`;
  }
  if (/^(19|20)\d{2}$/.test(id)) return `/${id}/`;
  return "/movie/";
}

function buildPagedPath(basePath, sourcePage, pageCount) {
  const path = basePath.endsWith("/") ? basePath : `${basePath}/`;
  if (!sourcePage || sourcePage <= 1) return path;
  return `${path}page-${sourcePage}.html`;
}

function buildPlayId(meta) {
  return JSON.stringify(meta || {});
}

function parseMediaSources($, pageUrl) {
  const list = [];
  $("video source[src], source[src]").each((_, el) => {
    const $el = $(el);
    const src = $el.attr("src") || "";
    if (!src) return;
    const url = absUrl(src);
    const quality = cleanText($el.attr("label") || $el.attr("title") || "");
    list.push({
      name: quality || "直链",
      url,
      header: buildPlayHeaders(pageUrl),
    });
  });
  return dedupeById(list);
}

function extractDetailInfo(html, pageUrl) {
  const $ = cheerio.load(html || "", { decodeEntities: false });
  const labels = pickLabels($, $.root());
  const vodName = cleanText(
    $("#MainContent_titleh12 > div").first().attr("title") ||
    $("#MainContent_titleh12 > div").first().text() ||
    $("#tophead h1").first().attr("title") ||
    $("#tophead h1").first().text() ||
    $("title").first().text().split(" - ")[0]
  );
  const vodPic = absUrl(
    $("#MainContent_poster img").first().attr("src") ||
    $("#MainContent_poster a").first().attr("href") ||
    $("meta[property='og:image']").attr("content") ||
    ""
  );
  const vodSubtitle = cleanText($("#MainContent_titleh12 h2").first().text());
  const vodContent = cleanText($("#MainContent_videodesc .videodesc").first().text() || $("meta[name='description']").attr("content"));
  const tags = [];
  $("#MainContent_tags a").each((_, el) => {
    const text = cleanText($(el).text());
    if (text) tags.push(text);
  });

  const mediaSources = parseMediaSources($, pageUrl);
  const episodes = [];

  $("#rtlist li").each((_, el) => {
    const $li = $(el);
    const $a = $li.find("a[href*='/tv/'], a[href*='/movie/']").first();
    const href = $a.attr("href") || pageUrl;
    const title = cleanText(
      $li.find("span").first().text() ||
      $a.attr("title") ||
      $li.find("img").first().attr("title") ||
      $li.find("img").first().attr("alt") ||
      vodName
    );
    if (!href) return;
    const episodePage = absUrl(href);
    episodes.push({
      name: title || vodName || "播放",
      playId: buildPlayId({
        page: episodePage,
        title: title || vodName || "播放",
        vodName,
        pic: vodPic,
      }),
    });
  });

  if (!episodes.length) {
    episodes.push({
      name: labels["分辨率"] || "正片",
      playId: buildPlayId({
        page: pageUrl,
        title: labels["分辨率"] || "正片",
        direct: mediaSources[0]?.url || "",
        vodName,
        pic: vodPic,
      }),
    });
  }

  const playSources = [{
    name: "4KMP",
    episodes: dedupeById(episodes),
  }];

  return {
    vod_id: pageUrl,
    vod_name: vodName,
    vod_pic: vodPic,
    vod_content: vodContent,
    vod_subtitle: vodSubtitle,
    vod_year: labels["年份"] || "",
    vod_remarks: [labels["分辨率"], labels["片长"]].filter(Boolean).join(" / "),
    type_id: detectTypeId(pageUrl),
    type_name: tags.join(" / "),
    vod_play_sources: playSources,
  };
}

function normalizeKeyword(value) {
  return String(value || "")
    .replace(/[\s\-_—–·•:：,，.。!?！？'"“”‘’()（）\[\]【】{}]/g, "")
    .toLowerCase();
}

function scoreSearchResult(vodName, keyword) {
  const name = normalizeKeyword(vodName);
  const key = normalizeKeyword(keyword);
  if (!name || !key) return 0;
  if (name === key) return 1000 + key.length;
  if (name.startsWith(key)) return 800 + key.length;
  if (name.includes(key)) return 600 + key.length;
  if (key.includes(name) && name.length >= 2) return 400 + name.length;
  return 0;
}

function refineSearchResults(list, keyword) {
  const scored = (list || []).map((item, index) => ({
    item,
    index,
    score: scoreSearchResult(item.vod_name, keyword),
  }));
  const matched = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
  return matched.length ? matched : list;
}

function parseRawPlayId(raw) {
  const value = String(raw || "").trim();
  if (!value) return {};
  if (value.startsWith("{")) {
    try {
      return JSON.parse(value);
    } catch (_) {}
  }
  if (/^https?:\/\//i.test(value) || value.startsWith("/")) return { page: absUrl(value), title: "播放" };
  return { page: value, title: "播放" };
}

function looksLikeMedia(url) {
  return /\.(m3u8|mp4|m4v|mov|flv)(\?|#|$)/i.test(String(url || ""));
}

async function home(params, context) {
  try {
    const html = await fetchText(`${BASE_URL}/`);
    const list = parseVodList(html).slice(0, 36);
    await OmniBox.log("info", `[4KMP][home] list=${list.length}`);
    return {
      class: CLASS_LIST.map((item) => ({ ...item })),
      filters: FILTERS,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[4KMP][home] ${error.message}`);
    return { class: CLASS_LIST.map((item) => ({ ...item })), filters: FILTERS, list: [] };
  }
}

async function category(params, context) {
  const page = Math.max(1, Number(params?.page || params?.pg || 1) || 1);
  try {
    const typeId = params?.type_id || params?.categoryId || params?.tid || "movie";
    const extend = normalizeExtend(params);
    const basePath = buildCategoryBasePath(typeId, extend);
    const firstHtml = await fetchText(basePath);
    const pageCount = parsePageCount(firstHtml);
    const sourcePage = Math.max(1, pageCount - page + 1);
    const html = page <= 1 ? firstHtml : await fetchText(buildPagedPath(basePath, sourcePage, pageCount), { referer: absUrl(basePath) });
    const list = parseVodList(html);
    await OmniBox.log("info", `[4KMP][category] type=${typeId} page=${page} sourcePage=${sourcePage} list=${list.length}`);
    return {
      page,
      pagecount: pageCount,
      total: pageCount * Math.max(list.length, 24),
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[4KMP][category] ${error.message}`);
    return { page, pagecount: page, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const vodId = String(params?.vod_id || params?.videoId || params?.id || "").trim();
    if (!vodId) return { list: [] };
    const pageUrl = absUrl(vodId);
    const html = await fetchText(pageUrl);
    const info = extractDetailInfo(html, pageUrl);
    await OmniBox.log("info", `[4KMP][detail] ${info.vod_name} episodes=${info.vod_play_sources?.[0]?.episodes?.length || 0}`);
    return { list: [info] };
  } catch (error) {
    await OmniBox.log("error", `[4KMP][detail] ${error.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  const page = Math.max(1, Number(params?.page || params?.pg || 1) || 1);
  try {
    const keyword = String(params?.keyword || params?.key || params?.wd || "").trim();
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };
    const url = `${BASE_URL}/s?y=${encodeURIComponent(keyword)}`;
    const html = await fetchText(url);
    const list = refineSearchResults(parseVodList(html), keyword);
    await OmniBox.log("info", `[4KMP][search] keyword=${keyword} list=${list.length}`);
    return {
      page,
      pagecount: 1,
      total: list.length,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[4KMP][search] ${error.message}`);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const raw = String(params?.playId || params?.play_id || params?.id || "").trim();
    const meta = parseRawPlayId(raw);
    const pageUrl = meta.page ? absUrl(meta.page) : "";
    const direct = meta.direct ? absUrl(meta.direct) : "";
    const headers = buildPlayHeaders(pageUrl || `${BASE_URL}/`);

    if (direct && looksLikeMedia(direct)) {
      return {
        parse: 0,
        jx: 0,
        url: direct,
        urls: [{ name: meta.title || "直链", url: direct }],
        header: headers,
        headers};
    }

    if (!pageUrl) {
      return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
    }

    const html = await fetchText(pageUrl, { referer: `${BASE_URL}/` });
    const $ = cheerio.load(html || "", { decodeEntities: false });
    const mediaSources = parseMediaSources($, pageUrl);
    const firstUrl = mediaSources[0]?.url || "";
    if (firstUrl) {
      const playHeaders = buildPlayHeaders(pageUrl);
      return {
        parse: 0,
        jx: 0,
        url: firstUrl,
        urls: mediaSources.map((item) => ({ name: item.name, url: item.url })),
        header: playHeaders,
        headers: playHeaders};
    }

    if (typeof OmniBox.sniffVideo === "function") {
      try {
        const sniffed = await OmniBox.sniffVideo(pageUrl, headers);
        const sniffUrl = sniffed?.url || sniffed?.playUrl || sniffed?.src || "";
        if (sniffUrl) {
          return {
            parse: 0,
            jx: 0,
            url: sniffUrl,
            urls: [{ name: meta.title || "嗅探线路", url: sniffUrl }],
            header: sniffed.header || sniffed.headers || headers,
            headers: sniffed.header || sniffed.headers || headers};
        }
      } catch (error) {
        await OmniBox.log("warn", `[4KMP][play] sniffVideo failed: ${error.message}`);
      }
    }

    return {
      parse: 1,
      jx: 1,
      url: pageUrl,
      urls: [{ name: meta.title || "播放页", url: pageUrl }],
      header: headers,
      headers};
  } catch (error) {
    await OmniBox.log("error", `[4KMP][play] ${error.message}`);
    return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
  }
}
