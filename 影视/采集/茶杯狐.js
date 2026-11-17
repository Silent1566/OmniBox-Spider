// @name 茶杯狐
// @author 梦
// @description 影视站：支持首页、分类、详情、刮削、弹幕与播放；搜索受站点人机验证影响，失败时安全降级
// @dependencies cheerio
// @version 1.1.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/茶杯狐.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");
const crypto = require("crypto");
const https = require("https");
const http = require("http");

const BASE_URL = "https://www.cupfox.ai";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_3_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3.1 Mobile/15E148 Safari/604.1";
const LIST_CACHE_TTL = Number(process.env.CUPFOX_LIST_CACHE_TTL || 900);
const DETAIL_CACHE_TTL = Number(process.env.CUPFOX_DETAIL_CACHE_TTL || 1800);
const SEARCH_CACHE_TTL = Number(process.env.CUPFOX_SEARCH_CACHE_TTL || 600);

const CATEGORY_CONFIG = [
  { id: "1", name: "电影" },
  { id: "2", name: "剧集" },
  { id: "3", name: "综艺" },
  { id: "4", name: "动漫" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

async function requestText(url, options = {}, redirectCount = 0) {
  await OmniBox.log("info", `[茶杯狐][request] ${options.method || "GET"} ${url}`);
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: BASE_URL + "/",
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
  await OmniBox.log("info", `[茶杯狐][native-request] ${options.method || "GET"} ${url}`);
  return new Promise((resolve, reject) => {
    const requestUrl = new URL(url);
    const body = options.body == null ? "" : String(options.body);
    const headers = {
      "User-Agent": UA,
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: BASE_URL + "/",
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
        resolve({
          body: String(data || ""),
          headers: res.headers || {},
          statusCode,
        });
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

function createCookieJar() {
  return {};
}

function mergeSetCookie(cookieJar, setCookieHeaders = []) {
  const values = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const item of values) {
    const raw = String(item || "");
    const first = raw.split(";")[0];
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    const name = first.slice(0, idx).trim();
    const value = first.slice(idx + 1).trim();
    if (!name) continue;
    cookieJar[name] = value;
  }
}

function cookieHeader(cookieJar) {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function cupfoxFirewallEncrypt(input) {
  const staticchars = "PXhw7UT1B0a9kQDKZsjIASmOezxYG4CHo5Jyfg2b8FLpEvRr3WtVnlqMidu6cN";
  let encodechars = "";
  const text = String(input || "");
  for (let i = 0; i < text.length; i += 1) {
    const current = text[i];
    const num0 = staticchars.indexOf(current);
    const code = num0 === -1 ? current : staticchars[(num0 + 3) % 62];
    const num1 = Math.floor(Math.random() * 62);
    const num2 = Math.floor(Math.random() * 62);
    encodechars += staticchars[num1] + code + staticchars[num2];
  }
  return Buffer.from(encodechars, "utf8").toString("base64");
}

function extractFirewallToken(htmlText) {
  const html = String(htmlText || "");
  const match = html.match(/var\s+token\s*=\s*encrypt\("([^"]+)"\)/i);
  return match?.[1] || "";
}

async function requestTextWithFirewall(url, options = {}) {
  const cookieJar = createCookieJar();
  const mergedHeaders = {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: BASE_URL + "/",
    ...(options.headers || {}),
  };

  const first = await requestTextNative(url, {
    ...options,
    headers: mergedHeaders,
  });
  mergeSetCookie(cookieJar, first.headers?.["set-cookie"] || []);
  if (!/人机验证|verifyBox/.test(first.body || "")) {
    return first.body;
  }

  const tokenRaw = extractFirewallToken(first.body);
  if (!tokenRaw) {
    await OmniBox.log("warn", `[茶杯狐][firewall] 验证页缺少 token url=${url}`);
    return first.body;
  }

  const value = cupfoxFirewallEncrypt(url);
  const token = cupfoxFirewallEncrypt(tokenRaw);
  const verifyBody = `value=${encodeURIComponent(value)}&token=${encodeURIComponent(token)}`;
  const cookie = cookieHeader(cookieJar);
  await OmniBox.log("info", `[茶杯狐][firewall] solve url=${url} token=${tokenRaw}`);
  const verifyRes = await requestTextNative(`${BASE_URL}/robot.php`, {
    method: "POST",
    headers: {
      Referer: url,
      Origin: BASE_URL,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: verifyBody,
  });
  mergeSetCookie(cookieJar, verifyRes.headers?.["set-cookie"] || []);
  const solvedCookie = cookieHeader(cookieJar);
  const second = await requestTextNative(url, {
    ...options,
    headers: {
      ...mergedHeaders,
      ...(solvedCookie ? { Cookie: solvedCookie } : {}),
    },
  });
  return second.body;
}

async function getCachedText(cacheKey, ttl, producer, shouldCache = null) {
  try {
    const cached = await OmniBox.getCache(cacheKey);
    if (cached) return String(cached);
  } catch (_) {}
  const value = await producer();
  const textValue = String(value);
  const allowCache = typeof shouldCache === "function" ? shouldCache(textValue) : true;
  if (allowCache) {
    try {
      await OmniBox.setCache(cacheKey, textValue, ttl);
    } catch (_) {}
  }
  return textValue;
}

function absoluteUrl(url) {
  try {
    return new URL(url, BASE_URL).toString();
  } catch (_) {
    return String(url || "");
  }
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripHtml(value) {
  return normalizeText(String(value || "").replace(/&nbsp;/gi, " ").replace(/<br\s*\/?>(?=\s*)/gi, " ").replace(/<[^>]+>/g, " "));
}

function cleanDisplayText(value) {
  return normalizeText(
    decodeMaybeGarbled(
      String(value || "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&#160;/gi, " ")
        .replace(/<br\s*\/?>(?=\s*)/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function formatPeopleText(value) {
  const text = cleanDisplayText(value);
  if (!text) return "";
  if (/[\/、，,|]/.test(text)) {
    return text
      .split(/[\/、，,|]+/)
      .map((item) => normalizeText(item))
      .filter(Boolean)
      .join(" / ");
  }
  const parts = text.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  return parts.join(" / ");
}

function decodeMaybeGarbled(text) {
  const raw = String(text || "");
  if (!/[ÃÂÐÑ]/.test(raw) && !/ç|è|ä|å|æ|é|ê|ë|ï|î|ô|û|ù/.test(raw)) return raw;
  try {
    return Buffer.from(raw, "latin1").toString("utf8");
  } catch (_) {
    return raw;
  }
}

function categoryNameById(categoryId) {
  return CATEGORY_CONFIG.find((item) => item.id === String(categoryId))?.name || "影视";
}

function buildScrapeResourceId(detailUrl) {
  const raw = String(detailUrl || "").trim();
  const match = raw.match(/\/video\/(\d+)\.html/i);
  return String(match?.[1] || raw);
}

function encodeMeta(obj) {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch (_) {
    return "";
  }
}

function decodeMeta(str) {
  try {
    const raw = Buffer.from(String(str || ""), "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch (_) {
    return {};
  }
}

function extractEpisodeNumber(text) {
  const value = cleanDisplayText(text);
  if (!value) return null;
  const match = value.match(/第\s*(\d+)\s*[集话期]/) || value.match(/(?:EP|E)(\d{1,4})/i) || value.match(/^(\d{1,4})$/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function buildDanmakuFileName(vodName, episodeTitle) {
  const title = cleanDisplayText(vodName);
  if (!title) return "";
  const episode = cleanDisplayText(episodeTitle);
  if (!episode || episode === "正片" || episode === "播放") {
    return title;
  }
  const episodeNumber = extractEpisodeNumber(episode);
  if (episodeNumber) {
    return `${title} S01E${String(episodeNumber).padStart(2, "0")}`;
  }
  return title;
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  const prefix = mapping.episodeNumber ? `第${mapping.episodeNumber}集 ` : "";
  if (mapping.episodeName) {
    return `${prefix}${mapping.episodeName}`.trim();
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber,
    );
    if (hit?.name) {
      return `${prefix}${hit.name}`.trim();
    }
  }
  return originalName;
}

function base64Decode(str) {
  const safe = String(str || "").replace(/[\r\n\s]/g, "");
  if (!safe) return "";
  try {
    return Buffer.from(safe, "base64").toString("utf-8");
  } catch (_) {
    return "";
  }
}

function md5Hex(input) {
  return crypto.createHash("md5").update(String(input || "")).digest("hex");
}

const Decode1 = {
  sign(encodedStr) {
    try {
      const decodedRaw = this.customStrDecode(encodedStr);
      const parts = decodedRaw.split("/");
      if (parts.length < 3) return "";
      const mapStrB = parts[0];
      const mapStrA = parts[1];
      const path = parts.slice(2).join("/");
      const cipherMap = JSON.parse(base64Decode(mapStrA));
      const plainMap = JSON.parse(base64Decode(mapStrB));
      const decodedPath = base64Decode(path);
      return this.deString(cipherMap, plainMap, decodedPath);
    } catch (_) {
      return "";
    }
  },
  customStrDecode(str) {
    const firstDecode = base64Decode(str);
    const key = md5Hex("test");
    const len = key.length;
    let code = "";
    for (let i = 0; i < firstDecode.length; i += 1) {
      const k = i % len;
      code += String.fromCharCode(firstDecode.charCodeAt(i) ^ key.charCodeAt(k));
    }
    return base64Decode(code);
  },
  deString(cipherList, plainList, text) {
    let result = "";
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const isAlpha = /^[a-zA-Z]+$/.test(char);
      if (isAlpha && Array.isArray(plainList) && plainList.includes(char)) {
        const index = Array.isArray(cipherList) ? cipherList.indexOf(char) : -1;
        result += index !== -1 && plainList[index] ? plainList[index] : char;
      } else {
        result += char;
      }
    }
    return result;
  },
};

function decode2(encoded) {
  if (!encoded) return "";
  const dictStr = "PXhw7UT1B0a9kQDKZsjIASmOezxYG4CHo5Jyfg2b8FLpEvRr3WtVnlqMidu6cN";
  const dictLen = dictStr.length;
  const lookup = {};
  for (let i = 0; i < dictLen; i += 1) {
    lookup[dictStr[i]] = dictStr[(i + 59) % dictLen];
  }
  const raw = base64Decode(encoded);
  let res = "";
  for (let i = 1; i < raw.length; i += 3) {
    const char = raw[i];
    res += lookup[char] || char;
  }
  return res;
}

function extractPlayerData(htmlText) {
  const html = String(htmlText || "");
  const match = html.match(/player_aaaa\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch (_) {
    return null;
  }
}

function decodeCupfoxPlayUrl(apiData = {}) {
  const encryptedUrl = String(apiData.url || "");
  const urlMode = Number(apiData.urlmode || 0);
  if (!encryptedUrl) return "";
  if (urlMode === 1) return Decode1.sign(encryptedUrl) || "";
  if (urlMode === 2) return decode2(encryptedUrl) || "";
  return encryptedUrl;
}

function isCupfoxPlaceholderUrl(url) {
  const value = String(url || "").trim();
  if (!value) return true;
  if (!/^https?:\/\//i.test(value) && !/^\/\//.test(value) && !/^magnet:/i.test(value)) return true;
  return /baidu\.com\/404\.mp4/i.test(value)
    || /\/404\.mp4(?:$|[?#])/i.test(value)
    || /(?:^|[?&])code=403(?:$|&)/i.test(value)
    || /forbidden/i.test(value);
}

function mapVideoCard($, el) {
  const node = $(el);
  const href = node.find("a[href]").first().attr("href") || "";
  const title = decodeMaybeGarbled(normalizeText(node.find(".movie-title").first().text() || node.attr("title") || node.text()));
  const pic = node.find(".movie-post-lazyload").first().attr("data-original") || node.find("img").first().attr("src") || "";
  const year = decodeMaybeGarbled(normalizeText(node.find(".movie-item-score").first().text()));
  const remarks = decodeMaybeGarbled(normalizeText(node.find(".movie-item-note").first().text()));
  return {
    vod_id: absoluteUrl(href),
    vod_name: title,
    vod_pic: absoluteUrl(pic),
    vod_year: year,
    vod_remarks: remarks || year,
  };
}

function parseHomeList(htmlText) {
  const $ = cheerio.load(htmlText);
  const cards = $(".movie-list-body .movie-list-item, .movie-list-body2 .movie-list-item").toArray();
  const list = [];
  const seen = new Set();
  for (const el of cards) {
    const item = mapVideoCard($, el);
    if (!item.vod_id || !item.vod_name || seen.has(item.vod_id)) continue;
    seen.add(item.vod_id);
    list.push(item);
  }
  return list;
}

function parseSearchList(htmlText) {
  const $ = cheerio.load(htmlText);
  const list = [];
  const seen = new Set();
  $(".vod-search-list .box").each((_, el) => {
    const item = $(el);
    const link = item.find("a.cover-link").first();
    const href = link.attr("href") || "";
    const name = decodeMaybeGarbled(normalizeText(item.find(".movie-title").first().text()));
    const pic = item.find(".Lazy").first().attr("data-original") || item.find("img").first().attr("src") || "";
    const remarks = decodeMaybeGarbled(normalizeText(item.find(".movie-item-note").first().text() || item.find(".meta.getop").first().text()));
    const vodId = absoluteUrl(href);
    if (!vodId || !name || seen.has(vodId)) return;
    seen.add(vodId);
    list.push({
      vod_id: vodId,
      vod_name: name,
      vod_pic: absoluteUrl(pic),
      vod_remarks: remarks,
    });
  });
  return list;
}

function parseDetail(htmlText, detailUrl) {
  const $ = cheerio.load(htmlText);
  const title = cleanDisplayText($("h1.movie-title").first().text());
  const pic = absoluteUrl($(".poster img").first().attr("src") || "");
  const content = cleanDisplayText($(".summary.detailsTxt").first().html() || $(".summary.detailsTxt").first().text());
  const typeTags = $(".scroll-content a").toArray().map((el) => cleanDisplayText($(el).text())).filter(Boolean);
  const infoData = {};
  $(".info-data").each((_, el) => {
    const text = cleanDisplayText($(el).html() || $(el).text());
    const match = text.match(/^([^：:]+)[：:]\s*(.*)$/);
    if (match) infoData[match[1].trim()] = cleanDisplayText(match[2]);
  });

  const tabs = [];
  $(".play_source_tab .titleName").each((_, el) => {
    const name = cleanDisplayText($(el).contents().first().text() || $(el).text()).replace(/\s+/g, " ").trim();
    tabs.push(name || `线路${tabs.length + 1}`);
  });

      const playSources = [];
      $("#tagContent .play_list_box").each((idx, box) => {
        const tabName = tabs[idx] || `线路${idx + 1}`;
        const episodes = [];
        $(box).find("a.btn[href]").each((epIdx, a) => {
          const href = $(a).attr("href") || "";
          const name = cleanDisplayText($(a).text()) || `第${epIdx + 1}集`;
          if (!href) return;
          const fid = `${detailUrl}#${tabName}#${epIdx}`;
          const meta = {
            sid: detailUrl,
            fid,
            v: title || "",
            e: name,
            t: tabName,
            i: epIdx,
          };
          episodes.push({
            name,
            playId: `${absoluteUrl(href)}|||${encodeMeta(meta)}`,
            _fid: fid,
            _rawName: name,
          });
        });
        if (episodes.length) playSources.push({ name: tabName, episodes });
      });

      const normalizedPlaySources = playSources.map((source) => ({
        name: source.name,
        episodes: (source.episodes || []).map((ep) => ({ name: ep.name, playId: ep.playId })),
      }));

      return {
        list: [{
          vod_id: detailUrl,
          vod_name: title,
          vod_pic: pic,
          type_name: typeTags.join(" / "),
          vod_remarks: cleanDisplayText(infoData["状态"] || ""),
          vod_actor: formatPeopleText(infoData["演员"] || ""),
          vod_director: formatPeopleText(infoData["导演"] || ""),
          vod_content: content,
          vod_play_sources: normalizedPlaySources,
        }],
        _play_sources_for_scrape: playSources,
      };
}

async function home() {
  try {
    const html = await getCachedText("cupfox:home", LIST_CACHE_TTL, () => requestText(BASE_URL + "/"));
    const list = parseHomeList(html).slice(0, 40);
    await OmniBox.log("info", `[茶杯狐][home] list=${list.length}`);
    return {
      class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][home] ${e.message}`);
    return { class: CATEGORY_CONFIG.map((item) => ({ type_id: item.id, type_name: item.name })), list: [] };
  }
}

async function category(params = {}) {
  try {
    const categoryId = String(params.categoryId || params.type_id || params.id || "1");
    const page = Math.max(1, Number(params.page) || 1);
    const url = page === 1
      ? `${BASE_URL}/type/${categoryId}.html`
      : `${BASE_URL}/type/${categoryId}-${page}.html`;
    const html = await getCachedText(`cupfox:category:${categoryId}:${page}`, LIST_CACHE_TTL, () => requestText(url));
    const list = parseHomeList(html);
    await OmniBox.log("info", `[茶杯狐][category] category=${categoryId} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: list.length ? page + 1 : page,
      total: page * list.length + (list.length ? 1 : 0),
      list: list.map((item) => ({ ...item, type_name: categoryNameById(categoryId) })),
    };
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][category] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
  }
}

async function detail(params = {}) {
  try {
    const videoId = absoluteUrl(params.videoId || params.id || params.vod_id || "");
    if (!videoId) return { list: [] };
    const html = await getCachedText(`cupfox:detail:${videoId}`, DETAIL_CACHE_TTL, () => requestText(videoId));
    const result = parseDetail(html, videoId);
    const vod = result.list?.[0];
    const resourceId = buildScrapeResourceId(videoId);
    const scrapePlaySources = Array.isArray(result._play_sources_for_scrape) ? result._play_sources_for_scrape : vod?.vod_play_sources || [];
    if (vod && Array.isArray(scrapePlaySources) && scrapePlaySources.length > 0) {
      let scrapeData = null;
      let videoMappings = [];
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

      await OmniBox.log("info", `[茶杯狐][detail] 刮削候选 resourceId=${resourceId} count=${scrapeCandidates.length} preview=${scrapeCandidates.slice(0, 3).map((item) => `${item.fid}=>${item.file_name}`).join(" | ")}`);
      if (scrapeCandidates.length > 0 && typeof OmniBox.processScraping === "function" && typeof OmniBox.getScrapeMetadata === "function") {
        try {
          const scrapeKeyword = cleanDisplayText(vod.vod_name || "");
          const scrapingResult = await OmniBox.processScraping(resourceId, scrapeKeyword, scrapeKeyword, scrapeCandidates);
          await OmniBox.log("info", `[茶杯狐][detail] 刮削完成 resourceId=${resourceId} keyword=${scrapeKeyword} result=${JSON.stringify(scrapingResult || {}).slice(0, 200)}`);
          const metadata = await OmniBox.getScrapeMetadata(resourceId);
          scrapeData = metadata?.scrapeData || null;
          videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
          await OmniBox.log("info", `[茶杯狐][detail] 刮削元数据 resourceId=${resourceId} hasScrapeData=${!!scrapeData} mappings=${videoMappings.length} scrapeType=${metadata?.scrapeType || ""}`);
        } catch (error) {
          await OmniBox.log("warn", `[茶杯狐][detail] 刮削失败 resourceId=${resourceId}: ${error.message}`);
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

      for (const source of vod.vod_play_sources) {
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
            await OmniBox.log("info", `[茶杯狐][detail] 应用刮削分集名 ${oldName} -> ${newName}`);
          }
          meta.e = ep.name;
          meta.s = mapping.seasonNumber;
          meta.n = mapping.episodeNumber;
          ep.playId = `${parts[0]}|||${encodeMeta(meta)}`;
        }
      }
    }
    await OmniBox.log("info", `[茶杯狐][detail] id=${videoId} sources=${result.list?.[0]?.vod_play_sources?.length || 0}`);
    return result;
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params = {}) {
  try {
    const wd = normalizeText(params.wd || params.keyword || params.key || "");
    const page = Math.max(1, Number(params.page) || 1);
    if (!wd) return { list: [] };
    const searchPath = `/search/${encodeURIComponent(wd)}----------${page}---.html`;
    const html = await getCachedText(
      `cupfox:search:v2:${wd}:${page}`,
      SEARCH_CACHE_TTL,
      () => requestTextWithFirewall(BASE_URL + searchPath),
      (text) => !/人机验证|verifyBox/.test(String(text || "")),
    );
    if (/人机验证/.test(html) || /verifyBox/.test(html)) {
      await OmniBox.log("warn", `[茶杯狐][search] 命中人机验证 wd=${wd} page=${page} path=${searchPath}`);
      return { page, pagecount: page, total: 0, list: [] };
    }
    const list = parseSearchList(html);
    await OmniBox.log("info", `[茶杯狐][search] wd=${wd} page=${page} count=${list.length}`);
    return {
      page,
      pagecount: list.length ? page + 1 : page,
      total: page * list.length + (list.length ? 1 : 0),
      list,
    };
  } catch (e) {
    await OmniBox.log("warn", `[茶杯狐][search] ${e.message}`);
    return { page: Number(params.page) || 1, pagecount: Number(params.page) || 1, total: 0, list: [] };
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
      await OmniBox.log("info", `[茶杯狐][play] 解析透传信息 vod=${vodName} episode=${episodeName} fid=${playMeta.fid || ""}`);
    }

    const playId = absoluteUrl(rawPlayId);
    if (!playId) return { parse: 1, url: "", urls: [], header: {} };

    const pageHeaders = {
      "User-Agent": UA,
      Referer: BASE_URL + "/",
    };

    const playInfoPromise = (async () => {
      const html = await requestText(playId, { headers: pageHeaders });
      const playerData = extractPlayerData(html);
      const vid = String(playerData?.url || "").trim();
      await OmniBox.log(
        "info",
        `[茶杯狐][play] player data from=${playerData?.from || ""} server=${playerData?.server || ""} id=${playerData?.id || ""} sid=${playerData?.sid ?? ""} nid=${playerData?.nid ?? ""} encrypt=${playerData?.encrypt ?? ""} trysee=${playerData?.trysee ?? ""} points=${playerData?.points ?? ""} link=${playerData?.link || ""} vid=${vid.slice(0, 120)}`,
      );

      if (vid) {
        const muiplayerUrl = `${BASE_URL}/foxplay/muiplayer.php?vid=${encodeURIComponent(vid)}`;
        const apiBody = new URLSearchParams({ vid }).toString();
        await OmniBox.log("info", `[茶杯狐][play] foxplay request body=${apiBody}`);
        const apiRes = await requestTextNative(`${BASE_URL}/foxplay/api.php`, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            Referer: muiplayerUrl,
            Origin: BASE_URL,
            "X-Requested-With": "XMLHttpRequest",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "*/*",
          },
          body: apiBody,
        });

        const apiRaw = String(apiRes?.body || "");
        await OmniBox.log("info", `[茶杯狐][play] api raw=${apiRaw.slice(0, 1200)}`);

        let apiJson = null;
        try {
          apiJson = JSON.parse(apiRaw);
        } catch (parseError) {
          await OmniBox.log("warn", `[茶杯狐][play] api json parse failed: ${parseError.message}`);
        }

        if (apiJson) {
          await OmniBox.log(
            "info",
            `[茶杯狐][play] api parsed code=${apiJson.code} message=${apiJson.message || ""} dataKeys=${Object.keys(apiJson.data || {}).join(",")} unique=${apiJson?.data?.unique || ""} player=${apiJson?.data?.player || ""}`,
          );
          if (Number(apiJson.code) === 403 || /vid empty/i.test(String(apiJson.message || ""))) {
            await OmniBox.log(
              "warn",
              `[茶杯狐][play] api rejected request code=${apiJson.code} message=${apiJson.message || ""} unique=${apiJson?.data?.unique || ""} probable_cause=vid_format_or_signature_mismatch`,
            );
          }
        }

        if (apiJson?.data?.url) {
          const decodedUrl = decodeCupfoxPlayUrl(apiJson.data);
          await OmniBox.log(
            "info",
            `[茶杯狐][play] api decode detail mode=${apiJson.data.urlmode || 0} type=${apiJson.data.type || ""} encrypt=${apiJson.data.encrypt ?? ""} raw=${String(apiJson.data.url || "").slice(0, 300)} decoded=${String(decodedUrl || "").slice(0, 300)}`,
          );
          if (decodedUrl && !isCupfoxPlaceholderUrl(decodedUrl)) {
            const finalHeaders = {
              "User-Agent": UA,
              Referer: muiplayerUrl,
            };
            await OmniBox.log("info", `[茶杯狐][play] api decode success code=${apiJson.code} mode=${apiJson.data.urlmode || 0} type=${apiJson.data.type || ""} url=${decodedUrl}`);
            return {
              parse: 0,
              url: decodedUrl,
              urls: [{ name: "播放", url: decodedUrl }],
              header: finalHeaders,
              headers: finalHeaders};
          }
          await OmniBox.log("warn", `[茶杯狐][play] api decode invalid code=${apiJson.code} mode=${apiJson.data.urlmode || 0} type=${apiJson.data.type || ""} url=${String(decodedUrl || "").slice(0, 200)} raw=${String(apiJson.data.url || "").slice(0, 200)}`);
        } else {
          await OmniBox.log("warn", `[茶杯狐][play] api unexpected response=${apiRaw.slice(0, 1200)}`);
        }
        await OmniBox.log("warn", `[茶杯狐][play] foxplay api returned no direct url, fallback sniff vid=${vid}`);
      } else {
        await OmniBox.log("warn", `[茶杯狐][play] 未找到 player_aaaa.url，fallback sniff page`);
      }

      const sniffTargets = [];
      if (vid) {
        sniffTargets.push({
          name: "muiplayer",
          url: `${BASE_URL}/foxplay/muiplayer.php?vid=${encodeURIComponent(vid)}`,
          headers: {
            "User-Agent": UA,
            Referer: playId,
          },
        });
      }
      sniffTargets.push({
        name: "play-page",
        url: playId,
        headers: {
          "User-Agent": UA,
          Referer: playId,
        },
      });

      for (const target of sniffTargets) {
        try {
          await OmniBox.log("info", `[茶杯狐][play] sniff target=${target.name} url=${target.url}`);
          const sniffed = await OmniBox.sniffVideo(target.url, target.headers);
          if (sniffed?.url && !isCupfoxPlaceholderUrl(sniffed.url)) {
            await OmniBox.log("info", `[茶杯狐][play] sniff success target=${target.name} url=${sniffed.url}`);
            return {
              parse: 0,
              url: sniffed.url,
              urls: [{ name: "播放", url: sniffed.url }],
              header: sniffed.header || sniffed.headers || target.headers || {},
              headers: sniffed.header || sniffed.headers || target.headers || {}
  };
          }
          await OmniBox.log("warn", `[茶杯狐][play] sniff empty/invalid target=${target.name} url=${String(sniffed?.url || "")}`);
        } catch (sniffError) {
          await OmniBox.log("warn", `[茶杯狐][play] sniff failed target=${target.name}: ${sniffError.message}`);
        }
      }

      const fallbackHeaders = { "User-Agent": UA, Referer: playId };
      return {
        parse: 1,
        url: playId,
        urls: [{ name: "播放页", url: playId }],
        header: fallbackHeaders,
        headers: fallbackHeaders};
    })();

    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
        scrapeTitle: "",
        episodeName: episodeName || "",
      };

      if (!playMeta?.fid || !vodName || typeof OmniBox.getScrapeMetadata !== "function") {
        await OmniBox.log("info", `[茶杯狐][play] 播放增强链路跳过 fid=${playMeta?.fid || ""} vod=${vodName || ""}`);
        return result;
      }

      try {
        const resourceId = buildScrapeResourceId(playMeta.sid || playMeta.fid.split("#")[0] || "");
        const metadata = await OmniBox.getScrapeMetadata(resourceId);
        if (!metadata || !metadata.scrapeData) {
          await OmniBox.log("info", `[茶杯狐][play] 播放增强链路跳过: metadata 不完整 resourceId=${resourceId} sid=${playMeta.sid || ""}`);
          return result;
        }

        result.scrapeTitle = metadata.scrapeData.title || "";

        const mappings = Array.isArray(metadata.videoMappings) ? metadata.videoMappings : [];
        await OmniBox.log("info", `[茶杯狐][play] 播放增强元数据 resourceId=${resourceId} mappings=${mappings.length} fid=${playMeta.fid}`);
        const mapping = mappings.find((m) => m?.fileId === playMeta.fid);
        if (mapping) {
          if (mapping.episodeName) {
            result.episodeName = buildScrapedEpisodeName(metadata.scrapeData, mapping, result.episodeName || episodeName || "");
          }
        } else if (mappings.length > 0) {
          await OmniBox.log("info", `[茶杯狐][play] 播放增强未命中 mapping expected=${playMeta.fid} preview=${mappings.slice(0, 2).map((item) => `${item?.fileId || "<empty>"}=>${item?.episodeName || ""}`).join(" | ")}`);
        }

        vodName = result.scrapeTitle || vodName;
        episodeName = result.episodeName || episodeName;
        const danmakuFileName = buildDanmakuFileName(vodName, episodeName);
        if (danmakuFileName && typeof OmniBox.getDanmakuByFileName === "function") {
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(danmakuFileName);
          const count = Array.isArray(matchedDanmaku) ? matchedDanmaku.length : 0;
          await OmniBox.log("info", `[茶杯狐][play] 弹幕匹配 fileName=${danmakuFileName} count=${count}`);
          if (count > 0) {
            result.danmakuList = matchedDanmaku;
          }
        }
      } catch (error) {
        await OmniBox.log("info", `[茶杯狐][play] 读取刮削元数据失败: ${error.message}`);
      }

      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);
    if (playInfoResult.status !== "fulfilled") {
      throw playInfoResult.reason || new Error("播放主链路失败");
    }

    const playResult = playInfoResult.value || { urls: [], parse: 0, header: {} };
    let danmakuList = [];

    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
    } else if (metadataResult.status === "rejected") {
      await OmniBox.log("info", `[茶杯狐][play] 播放增强链路失败(不影响播放): ${metadataResult.reason?.message || metadataResult.reason}`);
    }

    if (danmakuList.length > 0) {
      playResult.danmaku = danmakuList;
    }
    return playResult;
  } catch (e) {
    await OmniBox.log("error", `[茶杯狐][play] ${e.message}`);
    return { parse: 1, url: "", urls: [], header: {} };
  }
}
