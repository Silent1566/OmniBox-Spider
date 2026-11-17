// @name HDmoli
// @version 1.0.8
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/HDmoli.js
// @dependencies cheerio

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = (process.env.HDMOLI_HOST || "https://www.hdmoli.me").replace(/\/$/, "");
const USER_AGENT = process.env.HDMOLI_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const REQUEST_TIMEOUT = Number(process.env.HDMOLI_TIMEOUT || 20000);

const CLASS_LIST = [
  { type_id: "1", type_name: "电影", url: "/show/1-----------.html" },
  { type_id: "2", type_name: "剧集", url: "/show/2-----------.html" },
  { type_id: "4", type_name: "动画", url: "/show/4-----------.html" },
  { type_id: "3", type_name: "综艺", url: "/show/3-----------.html" },
  { type_id: "5", type_name: "纪录片", url: "/show/5-----------.html" },
  { type_id: "6", type_name: "动作", url: "/show/6-----------.html" },
  { type_id: "7", type_name: "喜剧", url: "/show/7-----------.html" },
  { type_id: "8", type_name: "爱情", url: "/show/8-----------.html" },
  { type_id: "9", type_name: "科幻", url: "/show/9-----------.html" },
  { type_id: "10", type_name: "剧情", url: "/show/10-----------.html" },
  { type_id: "11", type_name: "悬疑", url: "/show/11-----------.html" },
  { type_id: "12", type_name: "惊悚", url: "/show/12-----------.html" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function request(url, extra = {}, redirectCount = 0) {
  const finalUrl = url.startsWith("http") ? url : `${BASE_URL}${url}`;
  const headers = {
    "User-Agent": USER_AGENT,
    Referer: BASE_URL + "/",
    ...extra.headers,
  };

  await OmniBox.log("info", `[request] ${finalUrl}`);
  const res = await OmniBox.request(finalUrl, {
    method: extra.method || "GET",
    headers,
    timeout: REQUEST_TIMEOUT,
  });

  const statusCode = Number(res.statusCode || 0);
  const responseHeaders = res.headers || {};
  const location = responseHeaders.location || responseHeaders.Location || responseHeaders["LOCATION"] || "";
  if ([301, 302, 303, 307, 308].includes(statusCode)) {
    if (redirectCount >= 5) throw new Error(`重定向次数过多 @ ${finalUrl}`);
    if (!location) throw new Error(`HTTP ${statusCode} 未返回 Location @ ${finalUrl}`);
    const nextUrl = absoluteUrl(location, finalUrl);
    await OmniBox.log("info", `[redirect] ${finalUrl} -> ${nextUrl}`);
    return request(nextUrl, extra, redirectCount + 1);
  }

  if (statusCode !== 200) throw new Error(`HTTP ${statusCode} @ ${finalUrl}`);

  return res.body || "";
}

function getClassById(categoryId) {
  return CLASS_LIST.find(item => item.type_id === String(categoryId));
}

function buildPageUrl(basePath, page = 1) {
  if (!basePath) return "/";
  if (page <= 1) return basePath;
  return basePath.replace(/-{11}\.html$/, `--------${page}---.html`);
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(url, currentUrl = BASE_URL) {
  if (!url) return "";
  const value = String(url).trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  try {
    return new URL(value, currentUrl).toString();
  } catch {
    return `${BASE_URL}${value.startsWith("/") ? "" : "/"}${value}`;
  }
}

function extractIdFromPath(path) {
  const match = String(path || "").match(/\/([a-z]+)\/index(\d+)\.html/i);
  if (!match) return "";
  return `${match[1]}:${match[2]}`;
}

function splitVideoId(videoId) {
  const [prefix, id] = String(videoId || "").split(":");
  return { prefix: prefix || "movie", id: id || "" };
}

function buildDetailUrlFromPlay(playUrl) {
  const match = String(playUrl || "").match(/\/play\/(\d+)-(\d+)-(\d+)\.html/i);
  if (!match) return BASE_URL + "/";
  return `${BASE_URL}/movie/index${match[1]}.html`;
}

function mapListItem($, el) {
  const box = $(el);
  const linkEl = box.find("a.myui-vodlist__thumb").first();
  const titleEl = box.find("h4.title a").first();
  const href = linkEl.attr("href") || titleEl.attr("href") || "";
  const pic = linkEl.attr("data-original") || linkEl.find("img").attr("data-original") || linkEl.attr("src") || linkEl.find("img").attr("src") || "";
  const remarks = normalizeText(linkEl.find(".pic-text").first().text() || box.find(".pic-text").first().text());
  const score = normalizeText(linkEl.find(".pic-tag-right").first().text());
  const meta = normalizeText(box.find("p.text").first().text());
  const looksLikeMetadata = /^[0-9]{4}\s*\//.test(meta);
  let parts = looksLikeMetadata ? meta.split("/").map(s => normalizeText(s)).filter(Boolean) : [];

  if (!parts.length) {
    const info = normalizeText(box.find("p").filter((_, p) => $(p).text().includes("分类：")).first().text());
    const typeMatch = info.match(/分类：([^地]*?)地区：/);
    const areaMatch = info.match(/地区：([^年]*?)年份：/);
    const yearMatch = info.match(/年份：([0-9]{4})/);
    parts = [
      yearMatch ? yearMatch[1] : "",
      areaMatch ? areaMatch[1].trim() : "",
      typeMatch ? typeMatch[1].trim() : "",
    ].filter(Boolean);
  }

  return {
    vod_id: extractIdFromPath(href),
    vod_name: normalizeText(titleEl.text() || linkEl.attr("title")),
    vod_pic: absoluteUrl(pic),
    vod_remarks: remarks || score,
    vod_year: parts[0] || "",
    vod_area: parts[1] || "",
    type_name: parts.slice(2).join("/") || "",
    vod_douban_score: score.replace(/分$/, ""),
  };
}

function parseListPage(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const list = [];
  // 针对该站点的 col- 布局和 myui-vodlist 混合结构进行匹配
  $("ul.myui-vodlist li, ul.myui-vodlist__bd li, #searchList li, li[class*='col-'], li.clearfix").each((_, el) => {
    const box = $(el);
    // 必须包含链接和标题，且不是广告或菜单项
    if (box.find("a[href*='/movie/index']").length > 0 || box.find("a[href*='/juji/index']").length > 0) {
        const item = mapListItem($, el);
        if (item.vod_id && item.vod_name) list.push(item);
    }
  });
  // 去重
  const seen = new Set();
  return list.filter(item => {
    if (seen.has(item.vod_id)) return false;
    seen.add(item.vod_id);
    return true;
  });
}

function parsePageCount(html) {
  const nums = new Set();
  const regex = /--------(\d+)---\.html/g;
  let match;
  while ((match = regex.exec(html))) {
    nums.add(Number(match[1]));
  }
  const maxPage = Math.max(1, ...nums);
  return Number.isFinite(maxPage) ? maxPage : 1;
}

function decodeHexString(input) {
  const hex = String(input || "").replace(/[^0-9a-f]/gi, "");
  if (!hex || hex.length % 2 !== 0) return "";
  try {
    return Buffer.from(hex, "hex").toString("utf8");
  } catch {
    return "";
  }
}

function decodePlayerUrl(rawUrl, encrypt) {
  let value = String(rawUrl || "").trim();
  if (!value) return "";

  if (encrypt === 1) {
    try { value = unescape(value); } catch {}
    try { value = decodeURIComponent(value); } catch {}
    return value;
  }

  if (encrypt === 2) {
    try {
      value = Buffer.from(value, "base64").toString("utf8");
    } catch {}
    try { value = unescape(value); } catch {}
    try { value = decodeURIComponent(value); } catch {}
    return value;
  }

  if (encrypt === 3) {
    const hexDecoded = decodeHexString(value);
    if (hexDecoded) value = hexDecoded;
    try { value = unescape(value); } catch {}
    try { value = decodeURIComponent(value); } catch {}
    return value;
  }

  return value;
}

function parsePlaySources($) {
  const tabs = [];
  $(".nav-tabs li a[href^='#playlist']").each((index, el) => {
    const tab = $(el);
    tabs.push({
      target: tab.attr("href") || `#playlist${index + 1}`,
      name: normalizeText(tab.text()) || `线路${index + 1}`,
    });
  });

  if (!tabs.length) {
    $("div[id^='playlist']").each((index, el) => {
      tabs.push({ target: `#${$(el).attr("id")}`, name: `线路${index + 1}` });
    });
  }

  return tabs.map(tab => {
    const episodes = [];
    $(tab.target).find(".myui-content__list a").each((_, a) => {
      const node = $(a);
      const href = node.attr("href") || "";
      const name = normalizeText(node.text()) || "播放";
      if (!href) return;
      episodes.push({
        name,
        playId: JSON.stringify({
          source: tab.name,
          playUrl: absoluteUrl(href),
          referer: buildDetailUrlFromPlay(absoluteUrl(href)),
        }),
      });
    });
    return { name: tab.name, episodes };
  }).filter(item => item.episodes.length > 0);
}

function parseDownloadLinks($) {
  const links = [];
  $(".myui-panel_bd p.text-muted a[title]").each((_, el) => {
    const node = $(el);
    const href = node.attr("href") || "";
    const title = normalizeText(node.closest("p").find("b").text()).replace(/[:：]/g, "") || normalizeText(node.attr("title"));
    if (/pan\.quark\.cn|pan\.baidu\.com|drive\.uc\.cn/i.test(href)) {
      links.push({ name: title || "网盘", url: href });
    }
  });
  return links;
}

function filterOutDriveSources(playSources = []) {
  const driveKeywordRegex = /(夸克|百度|阿里|UC|网盘|迅雷盘|115|123云盘|天翼)/i;
  return playSources.filter(source => {
    const sourceName = String(source?.name || "");
    if (driveKeywordRegex.test(sourceName)) return false;
    const episodes = Array.isArray(source?.episodes) ? source.episodes : [];
    const hasDriveEpisode = episodes.some(ep => {
      const rawPlayId = String(ep?.playId || "");
      return /pan\.quark\.cn|pan\.baidu\.com|drive\.uc\.cn/i.test(rawPlayId);
    });
    return !hasDriveEpisode;
  });
}

async function home(params, context) {
  try {
    await OmniBox.log("info", `[home] from=${context?.from || "web"}`);
    const html = await request("/");
    const list = parseListPage(html).slice(0, 24);
    await OmniBox.log("info", `[home] list=${list.length}`);
    return { class: CLASS_LIST.map(({ type_id, type_name }) => ({ type_id, type_name })), list };
  } catch (error) {
    await OmniBox.log("error", `[home] ${error.message}`);
    return { class: CLASS_LIST.map(({ type_id, type_name }) => ({ type_id, type_name })), list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = String(params?.categoryId || "1");
    const page = Number(params?.page || 1) || 1;
    const category = getClassById(categoryId);
    if (!category) return { page, pagecount: 0, total: 0, list: [] };

    const url = buildPageUrl(category.url, page);
    await OmniBox.log("info", `[category] categoryId=${categoryId} page=${page} url=${url}`);
    const html = await request(url);
    const list = parseListPage(html);
    const pagecount = Math.max(page, parsePageCount(html));
    await OmniBox.log("info", `[category] list=${list.length} pagecount=${pagecount}`);
    return {
      page,
      pagecount,
      total: pagecount * Math.max(list.length, 24),
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[category] ${error.message}`);
    return { page: Number(params?.page || 1) || 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const { prefix, id } = splitVideoId(params?.videoId);
    if (!id) return { list: [] };

    const detailUrl = `/${prefix}/index${id}.html`;
    await OmniBox.log("info", `[detail] videoId=${params?.videoId} url=${detailUrl}`);
    const html = await request(detailUrl);
    const $ = cheerio.load(html, { decodeEntities: false });

    const title = normalizeText($(".myui-content__detail h1.title").clone().children().remove().end().text() || $("title").text().replace(/\s*-\s*HDmoli.*$/, ""));
    const remarks = normalizeText($(".myui-content__detail h1.title font").text());
    const pic = absoluteUrl($(".myui-content__thumb img").attr("data-original") || $(".myui-content__thumb img").attr("src"));
    const score = normalizeText($("#rating .branch").text()).replace(/分$/, "");
    const content = normalizeText($(".myui-panel p.text-muted").first().text().replace(/^剧情简介：/, ""));

    let vodArea = "";
    let vodYear = "";
    let vodActor = "";
    let vodDirector = "";
    let typeName = "";

    $(".myui-content__detail p.data").each((_, el) => {
      const text = normalizeText($(el).text());
      if (text.startsWith("分类：")) typeName = text.replace(/^分类：/, "").split("地区：")[0].trim();
      if (text.includes("地区：")) {
        const m = text.match(/地区：([^\s]+)/);
        if (m) vodArea = m[1].trim();
      }
      if (text.includes("年份：")) {
        const m = text.match(/年份：([^\s]+)/);
        if (m) vodYear = m[1].trim();
      }
      if (text.startsWith("演员：")) vodActor = text.replace(/^演员：/, "").trim();
      if (text.startsWith("导演：")) vodDirector = text.replace(/^导演：/, "").trim();
    });

    let vod_play_sources = parsePlaySources($);
    const downloadLinks = parseDownloadLinks($);

    if (downloadLinks.length) {
      await OmniBox.log("info", `[detail] hide drive links=${downloadLinks.length}`);
    }

    vod_play_sources = filterOutDriveSources(vod_play_sources);

    await OmniBox.log("info", `[detail] sources=${vod_play_sources.length}`);
    return {
      list: [{
        vod_id: `${prefix}:${id}`,
        vod_name: title,
        vod_pic: pic,
        vod_content: content,
        vod_actor: vodActor,
        vod_director: vodDirector,
        vod_area: vodArea,
        vod_year: vodYear,
        vod_remarks: remarks,
        vod_douban_score: score,
        type_name: typeName,
        vod_play_sources,
      }],
    };
  } catch (error) {
    await OmniBox.log("error", `[detail] ${error.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params?.keyword || params?.wd || "").trim();
    const page = Number(params?.page || 1) || 1;
    if (!keyword) return { page: 1, pagecount: 0, total: 0, list: [] };

    let url = `/search/-------------.html?wd=${encodeURIComponent(keyword)}`;
    if (page > 1) {
      url = `/search/----------${page}---.html?wd=${encodeURIComponent(keyword)}`;
    }
    await OmniBox.log("info", `[search] keyword=${keyword} page=${page} url=${url}`);
    const html = await request(url);
    const list = parseListPage(html);
    const pagecount = Math.max(page, parsePageCount(html));
    await OmniBox.log("info", `[search] list=${list.length} pagecount=${pagecount}`);
    return {
      page,
      pagecount,
      total: pagecount * Math.max(list.length, 20),
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[search] ${error.message}`);
    return { page: Number(params?.page || 1) || 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const raw = String(params?.playId || "");
    if (!raw) throw new Error("playId 不能为空");

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { directUrl: raw, source: params?.flag || "play" };
    }

    if (payload.directUrl) {
      const directUrl = String(payload.directUrl || "").trim();
      const sniff = !/\.(m3u8|mp4|flv)(\?|$)/i.test(directUrl);
      await OmniBox.log("info", `[play] direct source=${payload.source} sniff=${sniff} url=${directUrl}`);
      return {
        urls: [{ name: payload.source || "播放", url: directUrl }],
        header: {},
        parse: sniff ? 1 : 0};
    }

    if (payload.sniffUrl) {
      const sniffHeaders = {
        Referer: payload.referer || BASE_URL + "/",
        "User-Agent": USER_AGENT,
      };
      await OmniBox.log("info", `[play] sdk sniff source=${payload.source} sniffUrl=${payload.sniffUrl}`);
      try {
        const sniffed = await OmniBox.sniffVideo(payload.sniffUrl, sniffHeaders);
        const sniffedUrl = String(sniffed?.url || "").trim();
        if (sniffedUrl) {
          await OmniBox.log("info", `[play] sdk sniff success url=${sniffedUrl}`);
          return {
            urls: [{ name: payload.source || "播放", url: sniffedUrl }],
            header: sniffed?.header || {},
            parse: 0};
        }
      } catch (sniffError) {
        await OmniBox.log("warn", `[play] sdk sniff failed: ${sniffError.message}`);
      }

      return {
        urls: [{ name: payload.source || "播放", url: payload.sniffUrl }],
        header: sniffHeaders,
        parse: 1};
    }

    if (!payload.playUrl) throw new Error("缺少 playUrl");

    await OmniBox.log("info", `[play] source=${payload.source} playUrl=${payload.playUrl}`);
    const html = await request(payload.playUrl, {
      headers: {
        Referer: payload.referer || BASE_URL + "/",
      },
    });

    const match = html.match(/var\s+player_aaaa\s*=\s*(\{.*?\})\s*<\/script>/s);
    if (!match) throw new Error("未找到 player_aaaa");

    const player = JSON.parse(match[1]);
    const encrypt = Number(player.encrypt || 0);
    const finalUrl = decodePlayerUrl(player.url || "", encrypt);

    if (!finalUrl) throw new Error("播放器未给出 url");

    const isDirectMedia = /\.(m3u8|mp4|flv)(\?|$)/i.test(finalUrl);
    const finalHeaders = {};
    if (player.from && !isDirectMedia) {
      finalHeaders.Referer = payload.playUrl;
      finalHeaders["User-Agent"] = USER_AGENT;
    }

    await OmniBox.log("info", `[play] from=${player.from} encrypt=${encrypt} direct=${isDirectMedia} sniff=${!isDirectMedia} url=${finalUrl}`);

    if (!isDirectMedia) {
      try {
        const sniffed = await OmniBox.sniffVideo(payload.playUrl, {
          Referer: payload.referer || BASE_URL + "/",
          "User-Agent": USER_AGENT,
        });
        const sniffedUrl = String(sniffed?.url || "").trim();
        if (sniffedUrl) {
          await OmniBox.log("info", `[play] sdk sniff success from player page url=${sniffedUrl}`);
          return {
            urls: [{ name: payload.source || player.from || "播放", url: sniffedUrl }],
            header: sniffed?.header || {},
            parse: 0};
        }
      } catch (sniffError) {
        await OmniBox.log("warn", `[play] sdk sniff from player page failed: ${sniffError.message}`);
      }

      return {
        urls: [{ name: payload.source || player.from || "播放", url: payload.playUrl }],
        header: {
          Referer: payload.referer || BASE_URL + "/",
          "User-Agent": USER_AGENT
        },
        parse: 1};
    }

    return {
      urls: [{ name: payload.source || player.from || "播放", url: finalUrl }],
      header: finalHeaders,
      parse: 0};
  } catch (error) {
    await OmniBox.log("error", `[play] ${error.message}`);
    return {
      urls: [],
      header: {},
      parse: 0};
  }
}
