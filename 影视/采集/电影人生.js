// @name 电影人生
// @author 梦
// @description 页面解析：已接入；播放优先直解析，失败后 SDK 嗅探，再失败交给播放器嗅探
// @dependencies cheerio
// @version 1.1.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/电影人生.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = "https://www.dyrsok.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchText(url, options = {}) {
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      Referer: BASE_URL + "/",
      ...(options.headers || {}),
    },
    body: options.body,
    timeout: options.timeout || 20000,
  });

  if (!res || Number(res.statusCode) !== 200) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }

  return getBodyText(res);
}

function buildFilters() {
  const commonMovieTv = [
    { key: "class", name: "类型", init: "", value: [{ name: "全部", value: "" }, { name: "剧情", value: "剧情" }, { name: "喜剧", value: "喜剧" }, { name: "动作", value: "动作" }, { name: "爱情", value: "爱情" }, { name: "科幻", value: "科幻" }, { name: "恐怖", value: "恐怖" }, { name: "惊悚", value: "惊悚" }, { name: "悬疑", value: "悬疑" }, { name: "犯罪", value: "犯罪" }, { name: "战争", value: "战争" }, { name: "冒险", value: "冒险" }, { name: "动画", value: "动画" }, { name: "奇幻", value: "奇幻" }, { name: "武侠", value: "武侠" }, { name: "古装", value: "古装" }] },
    { key: "sort_field", name: "排序", init: "", value: [{ name: "默认", value: "" }, { name: "热度", value: "play_hot" }, { name: "更新时间", value: "update_time" }] },
  ];
  const commonDm = [
    { key: "class", name: "类型", init: "", value: [{ name: "全部", value: "" }, { name: "冒险", value: "冒险" }, { name: "热血", value: "热血" }, { name: "搞笑", value: "搞笑" }, { name: "少女", value: "少女" }, { name: "科幻", value: "科幻" }, { name: "魔幻", value: "魔幻" }] },
    { key: "sort_field", name: "排序", init: "", value: [{ name: "默认", value: "" }, { name: "热度", value: "play_hot" }, { name: "更新时间", value: "update_time" }] },
  ];
  const commonZy = [
    { key: "class", name: "类型", init: "", value: [{ name: "全部", value: "" }, { name: "真人秀", value: "真人秀" }, { name: "脱口秀", value: "脱口秀" }, { name: "选秀", value: "选秀" }, { name: "访谈", value: "访谈" }, { name: "音乐", value: "音乐" }] },
    { key: "sort_field", name: "排序", init: "", value: [{ name: "默认", value: "" }, { name: "热度", value: "play_hot" }, { name: "更新时间", value: "update_time" }] },
  ];

  return {
    class: [
      { type_id: "dianying", type_name: "电影" },
      { type_id: "dianshiju", type_name: "电视剧" },
      { type_id: "dongman", type_name: "动漫" },
      { type_id: "zongyi", type_name: "综艺" },
    ],
    filters: {
      dianying: commonMovieTv,
      dianshiju: commonMovieTv,
      dongman: commonDm,
      zongyi: commonZy,
    },
  };
}

function normalizeSearchKeyword(value) {
  return String(value || "")
    .replace(/[\s\-_—–·•:：,，.。!?！？'"“”‘’()（）\[\]【】{}]/g, "")
    .toLowerCase();
}

function buildSearchTokens(keyword) {
  const base = normalizeSearchKeyword(keyword);
  if (!base) return [];
  const tokens = new Set([base]);
  const digitStripped = base.replace(/\d+$/g, "");
  if (digitStripped && digitStripped !== base) tokens.add(digitStripped);
  const noYear = base.replace(/(19|20)\d{2}/g, "");
  if (noYear && noYear !== base) tokens.add(noYear);
  return [...tokens].filter(Boolean).sort((a, b) => b.length - a.length);
}

function scoreSearchResult(vodName, keyword) {
  const name = normalizeSearchKeyword(vodName);
  const tokens = buildSearchTokens(keyword);
  if (!name || !tokens.length) return 0;
  let score = 0;
  for (const token of tokens) {
    if (name === token) score = Math.max(score, 1000 + token.length);
    else if (name.startsWith(token)) score = Math.max(score, 800 + token.length);
    else if (name.includes(token)) score = Math.max(score, 600 + token.length);
  }
  return score;
}

function refineSearchResults(list, keyword) {
  const scored = list.map((item) => ({ item, score: scoreSearchResult(item.vod_name, keyword) }));
  const matched = scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.item.vod_name || "").localeCompare(String(b.item.vod_name || ""), "zh-Hans-CN"))
    .map((entry) => entry.item);
  return matched.length ? matched : list;
}

function parseVodCards(html) {
  const $ = cheerio.load(html);
  const list = [];
  const seen = new Set();

  $("a[data-url][title]").each((_, el) => {
    const $a = $(el);
    const href = $a.attr("href") || $a.attr("data-url") || "";
    const vodName = ($a.attr("title") || "").trim();
    if (!href || !vodName || !/\/dyrscom-/.test(href)) return;

    const vodId = href.replace(/^\//, "");
    if (seen.has(vodId)) return;
    seen.add(vodId);

    const parent = $a.parent();
    const img = $a.find("img[alt]").first();
    const vodPic = absUrl((img.attr("data-src") || img.attr("src") || "").replace(/\?type=swiper$/i, ""));
    const year = stripHtml(parent.find("div.items-center.flex.mt-1 span").first().text());
    const typeName = stripHtml(parent.find("div.items-center.flex.mt-1 span").last().text());
    const badge = stripHtml($a.find("div.text-\[10px\]").first().text()) || stripHtml(parent.find("div.text-\[10px\]").first().text());

    list.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: vodPic,
      vod_url: absUrl(href),
      type_id: "",
      type_name: typeName,
      vod_year: year,
      vod_remarks: badge,
    });
  });

  return list;
}

async function home(params, context) {
  try {
    const filters = buildFilters();
    const html = await fetchText(BASE_URL + "/");
    const list = parseVodCards(html).slice(0, 24);
    await OmniBox.log("info", `[电影人生][home] 推荐数: ${list.length}`);
    return {
      class: filters.class,
      filters: filters.filters,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[电影人生][home] ${e.message}`);
    const filters = buildFilters();
    return { class: filters.class, filters: filters.filters, list: [] };
  }
}

async function category(params, context) {
  try {
    const page = Number(params.page || 1) || 1;
    const categoryId = String(params.categoryId || params.type_id || "dianying");
    const filters = params.filters || {};
    const qs = new URLSearchParams();
    if (filters.class) qs.set("class", String(filters.class));
    if (filters.sort_field) qs.set("sort_field", String(filters.sort_field));
    if (page > 1) qs.set("page", String(page));
    const url = `${BASE_URL}/${categoryId}.html${qs.toString() ? "?" + qs.toString() : ""}`;

    await OmniBox.log("info", `[电影人生][category] ${url}`);
    const html = await fetchText(url);
    const list = parseVodCards(html);
    return {
      page,
      pagecount: page + (list.length >= 24 ? 1 : 0),
      total: page * 24 + list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[电影人生][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "").trim();
    if (!videoId) return { list: [] };
    const url = /^https?:\/\//i.test(videoId) ? videoId : `${BASE_URL}/${videoId.replace(/^\//, "")}`;
    const html = await fetchText(url);
    const $ = cheerio.load(html);

    const vod_name = $("h1, h2").first().text().trim() || $("title").text().split("_在线观看")[0].trim();
    const vod_pic = absUrl($("meta[property='og:image']").attr("content") || $("img[src*='/img/cover/'], img[data-src*='/img/cover/']").first().attr("src") || $("img[src*='/img/id/'], img[data-src*='/img/id/']").first().attr("data-src") || "");
    const metaDesc = $("meta[name='description']").attr("content") || "";
    const plotText = $("h3:contains('剧情简介')").parent().find("div.text-sm").first().text().replace(/\s+/g, " ").trim();
    const vod_content = plotText || metaDesc;

    const originalNameMatch = html.match(/原名：<\/span>\s*([^<\n]+)/);
    const vod_subtitle = originalNameMatch ? String(originalNameMatch[1]).trim() : "";

    function pickMetaValue(label) {
      const re = new RegExp(`${label}<\\/span>\\s*<span[^>]*>([^<]+)<\\/span>`);
      const m = html.match(re);
      return m ? String(m[1]).trim() : "";
    }

    const vod_year = pickMetaValue("年份");
    const vod_area = pickMetaValue("地区");
    const vod_lang = pickMetaValue("语言");
    const updateTime = pickMetaValue("更新时间");

    const director = [];
    $("h3:contains('导演')").parent().find("a span").each((_, el) => {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      if (txt) director.push(txt);
    });
    const actor = [];
    $("h3:contains('主演')").parent().find("a span").each((_, el) => {
      const txt = $(el).text().replace(/\s+/g, " ").trim();
      if (txt) actor.push(txt);
    });

    const tags = [];
    $("h3:contains('标签')").parent().find("a span").each((_, el) => {
      const txt = $(el).text().replace(/[#\s]+/g, "").trim();
      if (txt) tags.push(txt);
    });

    const originLinks = [];
    $("#originTabs a[href*='?origin='] button[data-origin]").each((_, el) => {
      const $btn = $(el);
      const origin = ($btn.attr("data-origin") || $btn.text() || "").trim();
      const href = $btn.closest("a").attr("href") || "";
      if (origin && href) originLinks.push({ origin, href: absUrl(href) });
    });

    const vod_play_sources = [];
    const remarks = [];

    for (const line of originLinks) {
      try {
        const lineHtml = line.href === url ? html : await fetchText(line.href, { headers: { Referer: url } });
        const $$ = cheerio.load(lineHtml);
        const episodes = [];
        $$(".seqlist a[href*='?origin=']").each((_, el) => {
          const $a = $$(el);
          const href = $a.attr("href") || "";
          const title = ($a.attr("data-title") || stripHtml($a.text()) || "播放").trim();
          const origin = ($a.attr("data-origin") || line.origin || "").trim();
          if (!href) return;
          const fullUrl = absUrl(href.replace(/&amp;/g, "&"));
          episodes.push({
            name: title,
            playId: JSON.stringify({
              title,
              origin,
              page: fullUrl,
              vodName: vod_name,
              pic: vod_pic,
            }),
          });
        });
        if (episodes.length) {
          vod_play_sources.push({ name: line.origin, episodes });
          remarks.push(`${line.origin}(${episodes.length})`);
        }
      } catch (e) {
        await OmniBox.log("warn", `[电影人生][detail] 线路 ${line.origin} 解析失败: ${e.message}`);
      }
    }

    await OmniBox.log("info", `[电影人生][detail] 线路数: ${vod_play_sources.length}`);
    return {
      list: [{
        vod_id: videoId.replace(/^\//, ""),
        vod_name,
        vod_pic,
        vod_content,
        vod_subtitle,
        vod_year,
        vod_area,
        vod_lang,
        vod_director: director.join(" / "),
        vod_actor: actor.join(" / "),
        type_name: tags.join(" / "),
        vod_remarks: "",
        vod_play_sources,
      }],
    };
  } catch (e) {
    await OmniBox.log("error", `[电影人生][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.key || params.wd || "").trim();
    const page = Number(params.page || 1) || 1;
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const qs = new URLSearchParams({ name: keyword });
    if (page > 1) qs.set("page", String(page - 1));
    const url = `${BASE_URL}/s.html?${qs.toString()}`;
    await OmniBox.log("info", `[电影人生][search] ${url}`);
    const html = await fetchText(url);
    const list = parseVodCards(html);
    const refinedList = refineSearchResults(list, keyword);
    await OmniBox.log("info", `[电影人生][search] raw=${list.length} refined=${refinedList.length} keyword=${keyword}`);
    return {
      page,
      pagecount: page + (refinedList.length >= 24 ? 1 : 0),
      total: page * 24 + refinedList.length,
      list: refinedList,
    };
  } catch (e) {
    await OmniBox.log("error", `[电影人生][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function resolveApiM3u8FinalUrl(apiUrl, headers) {
  let finalUrl = apiUrl;
  try {
    const probe = await OmniBox.request(apiUrl, {
      method: "GET",
      headers,
      timeout: 15000,
      redirect: 0,
    });
    const location = probe?.headers && (probe.headers.location || probe.headers.Location);
    if (location) {
      const redirected = absUrl(location);
      finalUrl = redirected;
      try {
        const playlistText = await fetchText(redirected, { headers: { Referer: BASE_URL + "/" } });
        const rawLine = playlistText.split(/\r?\n/).find((line) => /\/api\/m3u8\?id=.*raw=1/.test(line));
        if (rawLine) {
          finalUrl = absUrl(new URL(rawLine, redirected).toString());
        }
      } catch (error) {
        await OmniBox.log("warn", `[电影人生][play] 解析主清单失败: ${error.message}`);
      }
    }
  } catch (error) {
    await OmniBox.log("warn", `[电影人生][play] 探测重定向失败: ${error.message}`);
  }
  return finalUrl;
}

async function trySdkSniff(targetUrl, headers, meta) {
  if (!targetUrl || typeof OmniBox.sniffVideo !== "function") {
    return null;
  }
  try {
    await OmniBox.log("info", `[电影人生][play] SDK 嗅探开始 target=${targetUrl}`);
    const sniffResult = await OmniBox.sniffVideo(targetUrl, headers);
    const sniffUrl = sniffResult?.url || sniffResult?.playUrl || sniffResult?.src || sniffResult?.data?.url || "";
    if (sniffUrl) {
      await OmniBox.log("info", `[电影人生][play] SDK 嗅探成功 url=${sniffUrl}`);
      return {
        parse: 0,
        url: sniffUrl,
        urls: [{ name: meta.title || "播放页", url: sniffUrl }],
        header: headers,
        headers,
      };
    }
    await OmniBox.log("warn", `[电影人生][play] SDK 嗅探无可播地址 target=${targetUrl}`);
  } catch (error) {
    await OmniBox.log("warn", `[电影人生][play] SDK 嗅探失败: ${error?.message || String(error)}`);
  }
  return null;
}

function buildPlayerSniffFallback(targetUrl, headers, meta) {
  return {
    parse: 1,
    url: targetUrl,
    urls: [{ name: meta.title || "播放页", url: targetUrl }],
    header: headers,
    headers,
  };
}

function looksLikeDirectMedia(url) {
  return /\.(m3u8|mp4|m4v|flv|avi|mkv)(\?|$)/i.test(String(url || "")) || /\/api\/m3u8\?/i.test(String(url || ""));
}

async function play(params, context) {
  try {
    const raw = String(params.playId || params.play_id || "").trim();
    if (!raw) return { parse: 1, url: "", urls: [], header: {}, headers: {} };

    let meta = {};
    try {
      meta = JSON.parse(raw);
    } catch {
      meta = { page: raw, title: "播放" };
    }

    const pageUrl = meta.page || "";
    const safePageUrl = pageUrl ? encodeURI(pageUrl) : "";
    const headers = {
      "User-Agent": UA,
      Referer: safePageUrl || BASE_URL + "/",
      Origin: BASE_URL,
    };

    await OmniBox.log("info", `[电影人生][play] page=${safePageUrl}`);
    if (!safePageUrl) return { parse: 1, url: "", urls: [], header: headers, headers };

    const html = await fetchText(safePageUrl, { headers: { Referer: BASE_URL + "/" } });
    const match = html.match(/\/api\/m3u8\?origin=([^"'\\\s&]+|[^"'\\\s]+?)(&amp;|\\u0026|&)url=([a-zA-Z0-9]+)/);
    let directUrl = "";
    let origin = "";

    if (match) {
      origin = decodeURIComponent(match[1].replace(/&amp;/g, "&"));
      const urlId = match[3];
      const apiUrl = `${BASE_URL}/api/m3u8?origin=${encodeURIComponent(origin)}&url=${urlId}`;
      directUrl = await resolveApiM3u8FinalUrl(apiUrl, headers);
      await OmniBox.log("info", `[电影人生][play] 直解析候选 url=${directUrl}`);
    }

    if (directUrl && looksLikeDirectMedia(directUrl)) {
      const result = {
        parse: 0,
        url: directUrl,
        urls: [{ name: meta.title || "播放页", url: directUrl }],
        header: headers,
        headers,
      };
      await OmniBox.log("info", `[电影人生][play] 直返 ${directUrl}`);
      return result;
    }

    const sdkSniffTarget = directUrl || safePageUrl;
    if (sdkSniffTarget) {
      const sniffResult = await trySdkSniff(sdkSniffTarget, headers, meta);
      if (sniffResult) {
        return sniffResult;
      }
      await OmniBox.log("warn", `[电影人生][play] SDK 嗅探失败，回退播放器嗅探 target=${sdkSniffTarget}`);
      return buildPlayerSniffFallback(sdkSniffTarget, headers, meta);
    }

    return buildPlayerSniffFallback(safePageUrl, headers, meta);
  } catch (e) {
    await OmniBox.log("error", `[电影人生][play] ${e.message}`);
    return { parse: 1, url: "", urls: [], header: {}, headers: {} };
  }
}
