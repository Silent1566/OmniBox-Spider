// @name 柯南影视
// @description 接口解析：https://www.knvod.com，支持首页、分类、搜索、详情与播放解析
// @version 1.0.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/柯南影视.js
// @dependencies crypto-js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const CryptoJS = require("crypto-js");

const HOST = "https://www.knvod.com";
const PARSER_HOST = "https://xn--ewr.211997.xyz";
const BFQ_HOST = "https://bfq.txnp.cn";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  Referer: `${HOST}/`,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Upgrade-Insecure-Requests": "1",
};

const siteCookies = new Map();

const CLASS_LIST = [
  { type_id: "1", type_name: "电影" },
  { type_id: "2", type_name: "电视剧" },
  { type_id: "3", type_name: "动漫" },
  { type_id: "4", type_name: "综艺" },
];

const UNSTABLE_LINES = new Set(["推荐", "推荐2", "超快③", "超快l", "超快I", "超快Ⅰ"]);

module.exports = { home, category, search, detail, play };
runner.run(module.exports);

function getBodyText(response) {
  const body = response && typeof response === "object"
    ? ("body" in response ? response.body : ("data" in response ? response.data : response))
    : response;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) || headers.get(name.toLowerCase());
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === wanted);
  return key ? headers[key] : undefined;
}

function mergeCookies(setCookie) {
  const items = Array.isArray(setCookie) ? setCookie : (setCookie ? [setCookie] : []);
  for (const item of items) {
    const pair = String(item || "").split(";", 1)[0].trim();
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    siteCookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  }
}

function currentCookie() {
  return [...siteCookies.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, options = {}) {
  const headers = {
    ...HEADERS,
    ...(options.headers || {}),
    Referer: options.referer || options.headers?.Referer || `${HOST}/`,
  };
  const attempts = Math.max(2, Number(options.retries === undefined ? 3 : Number(options.retries)) + 1);
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const cookie = currentCookie();
    const requestHeaders = cookie ? { ...headers, Cookie: cookie } : headers;
    try {
      const response = await OmniBox.request(url, {
        method: options.method || "GET",
        headers: requestHeaders,
        timeout: options.timeout || 30000,
        body: options.body,
      });
      mergeCookies(getHeader(response?.headers, "set-cookie"));
      const statusCode = Number(response?.statusCode || 200);
      if ((statusCode === 403 || statusCode === 429 || statusCode === 520) && attempt + 1 < attempts) {
        await delay(1100);
        continue;
      }
      if (statusCode < 200 || statusCode >= 400) {
        const error = new Error(`HTTP ${statusCode || "unknown"} @ ${url}`);
        error.retryable = false;
        throw error;
      }
      return getBodyText(response);
    } catch (error) {
      lastError = error;
      if (error?.retryable === false || attempt + 1 >= attempts) break;
    }
  }

  throw lastError || new Error(`请求失败 @ ${url}`);
}

function md5(text) {
  return CryptoJS.MD5(String(text || "")).toString();
}

async function apiVodList(body = {}, options = {}) {
  const time = Math.ceil(Date.now() / 1000);
  const payload = {
    type: "",
    class: "",
    area: "",
    lang: "",
    version: "",
    state: "",
    letter: "",
    ...body,
    page: Math.max(1, Number(body.page || options.page || 1) || 1),
    time,
    key: md5(`DS${time}DCC147D11943AF75`),
  };
  const encoded = Object.entries(payload)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value ?? ""))}`)
    .join("&");
  const text = await fetchText(`${HOST}/index.php/api/vod`, {
    ...options,
    method: "POST",
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      ...(options.headers || {}),
    },
    body: encoded,
  });
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    throw new Error(`API响应解析失败 @ ${HOST}/index.php/api/vod`);
  }
  if (Number(data.code) !== 1) throw new Error(`API错误 ${data.msg || data.code || "unknown"}`);
  const list = Array.isArray(data.list) ? data.list.map((item) => ({
    vod_id: String(item.vod_id || ""),
    vod_name: String(item.vod_name || "").trim(),
    vod_pic: fixPicUrl(item.vod_pic || item.vod_pic_thumb || ""),
    vod_remarks: String(item.vod_remarks || item.vod_serial || "").trim(),
  })).filter((item) => item.vod_id && item.vod_name) : [];
  return {
    list,
    page: Math.max(1, Number(data.page) || 1),
    pagecount: Math.max(0, Number(data.pagecount) || 0),
    total: Math.max(0, Number(data.total) || list.length),
  };
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(text) {
  return decodeHtml(String(text || "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(url, base = HOST) {
  let value = decodeHtml(String(url || "").trim()).replace(/^['"]|['"]$/g, "");
  if (!value || /^data:/i.test(value)) return "";
  if (value.startsWith("//")) value = `https:${value}`;
  try {
    return new URL(value, base).toString();
  } catch (_) {
    return value;
  }
}

function fixPicUrl(url) {
  let value = absUrl(url);
  const proxy = "https://xn--wcsw84d.921080.xyz/?url=";
  if (/^http:\/\//i.test(value)) value = value.replace(/^http:\/\//i, "https://");
  if (/\.(?:jpg|jpeg|png|webp|gif)(?:$|[?#])/i.test(value) && /(?:doubanio\.com|douban\.com)/i.test(value)) {
    return `${proxy}${encodeURIComponent(value)}`;
  }
  return value;
}

function getAttribute(attrs, name) {
  const match = String(attrs || "").match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? decodeHtml(match[2]).trim() : "";
}

function lastCaptured(text, pattern) {
  let value = "";
  let match;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  while ((match = regex.exec(text)) !== null) {
    value = match[1] || "";
    if (match[0] === "") regex.lastIndex += 1;
  }
  return value;
}

function extractVideos(html) {
  const text = String(html || "");
  const videos = [];
  const seen = new Set();
  const anchorRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorRegex.exec(text)) !== null) {
    const attrs = match[1] || "";
    if (!/\bpublic-list-exp\b/i.test(getAttribute(attrs, "class"))) continue;

    const href = getAttribute(attrs, "href");
    const idMatch = href.match(/\/vdetail\/(\d+)\.html/i);
    const vodId = idMatch ? idMatch[1] : "";
    if (!vodId || seen.has(vodId)) continue;

    const inner = match[2] || "";
    const before = text.slice(Math.max(0, match.index - 800), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 600);
    const context = `${before}${match[0]}${after}`;

    const stylePicPattern = /\bstyle\s*=\s*["'][^"']*url\(\s*["']?([^)'"\s]+)["']?\s*\)[^"']*["']/i;
    let vodPic = lastCaptured(inner, /\bdata-src\s*=\s*["']([^"']+)["']/i);
    if (!vodPic) vodPic = lastCaptured(inner, stylePicPattern);
    if (!vodPic) vodPic = lastCaptured(before, stylePicPattern);
    if (!vodPic) vodPic = lastCaptured(before, /\bdata-src\s*=\s*["']([^"']+)["']/i);
    if (!vodPic) vodPic = lastCaptured(context, /\bsrc\s*=\s*["']([^"']+)["']/i);

    let vodName = cleanText(getAttribute(attrs, "title"));
    if (!vodName) {
      const alt = lastCaptured(inner, /\balt\s*=\s*["']([^"']+)["']/i);
      vodName = cleanText(alt).replace(/封面图$/u, "").trim();
    }
    if (!vodName) continue;

    let vodRemarks = "";
    const remarkMatch = inner.match(/public-list-prb[^>]*>([\s\S]*?)<\/span>/i)
      || after.match(/public-list-prb[^>]*>([\s\S]*?)<\/span>/i);
    if (remarkMatch) vodRemarks = cleanText(remarkMatch[1]);

    seen.add(vodId);
    videos.push({
      vod_id: vodId,
      vod_name: vodName,
      vod_pic: fixPicUrl(vodPic),
      vod_remarks: vodRemarks,
    });
  }

  if (videos.length) return videos;

  const looseRegex = /href=["']\/vdetail\/(\d+)\.html["']/gi;
  while ((match = looseRegex.exec(text)) !== null) {
    const vodId = match[1];
    if (seen.has(vodId)) continue;
    const context = text.slice(Math.max(0, match.index - 500), match.index + 500);
    const title = lastCaptured(context, /\btitle\s*=\s*["']([^"']+)["']/i);
    const alt = lastCaptured(context, /\balt\s*=\s*["']([^"']+)["']/i);
    const pic = lastCaptured(context, /\bdata-src\s*=\s*["']([^"']+)["']/i)
      || lastCaptured(context, /url\(\s*["']?([^)'"\s]+)["']?\s*\)/i);
    const vodName = cleanText(title || alt).replace(/封面图$/u, "").trim();
    if (!vodName) continue;
    seen.add(vodId);
    videos.push({ vod_id: vodId, vod_name: vodName, vod_pic: fixPicUrl(pic), vod_remarks: "" });
  }

  return videos;
}

function parsePageCount(html, currentPage, listLength) {
  const match = String(html || "").match(/\d+\s*(?:&nbsp;|\s)*\/\s*(?:&nbsp;|\s)*(\d+)\s*页/i);
  if (match) return Math.max(1, Number(match[1]) || 1);
  return listLength > 0 ? currentPage + 1 : currentPage;
}

function extractLabeledBlock(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(html || "").match(
    new RegExp(`<(?:em|strong)[^>]*>\\s*${escaped}\\s*[：:]?\\s*<\\/(?:em|strong)>([\\s\\S]*?)(?:<\\/li>|<\\/div>)`, "i"),
  );
  return match ? match[1] : "";
}

function extractPeople(html, label) {
  const block = extractLabeledBlock(html, label);
  if (!block) return "";
  const people = [];
  const linkRegex = /<a\b[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(block)) !== null) {
    const name = cleanText(match[1]);
    if (name) people.push(name);
  }
  return people.length ? people.join(" ") : cleanText(block);
}

function parsePlaySources(html) {
  const text = String(html || "");
  const tabStart = text.search(/\banthology-tab\b/i);
  const listStart = tabStart >= 0 ? text.slice(tabStart).search(/\banthology-list\b/i) : -1;
  const tabHtml = tabStart >= 0 && listStart > 0 ? text.slice(tabStart, tabStart + listStart) : "";
  const sourceNames = [];
  const sourceRegex = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = sourceRegex.exec(tabHtml)) !== null) {
    if (!/\bswiper-slide\b/i.test(getAttribute(match[1], "class"))) continue;
    const withoutBadge = match[2].replace(/<span\b[^>]*class=["'][^"']*badge[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "");
    const name = cleanText(withoutBadge).replace(/\d+\s*集?$/u, "").trim();
    if (name) sourceNames.push(name);
  }

  const playSources = [];
  const nameCounts = new Map();
  const listRegex = /<ul\b[^>]*class=["'][^"']*anthology-list-play[^"']*["'][^>]*>([\s\S]*?)<\/ul>/gi;
  let index = 0;

  while ((match = listRegex.exec(text)) !== null) {
    const originalName = sourceNames[index] || `线路${index + 1}`;
    index += 1;
    if (UNSTABLE_LINES.has(originalName)) continue;

    const episodes = [];
    const episodeRegex = /<a\b[^>]*href=["'](\/vplay\/\d+-\d+-\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let episodeMatch;
    while ((episodeMatch = episodeRegex.exec(match[1])) !== null) {
      const name = cleanText(episodeMatch[2]);
      if (name) episodes.push({ name, playId: absUrl(episodeMatch[1]) });
    }
    if (!episodes.length) continue;
    episodes.reverse();

    const count = (nameCounts.get(originalName) || 0) + 1;
    nameCounts.set(originalName, count);
    const sourceName = count > 1 ? `${originalName}${count}` : originalName;
    playSources.push({ name: sourceName, episodes });
  }

  const rank = (name) => {
    if (name.startsWith("超稳")) return 0;
    if (name.startsWith("蓝光") || name.startsWith("移动")) return 1;
    return 2;
  };
  playSources.sort((a, b) => rank(a.name) - rank(b.name));
  return playSources;
}

function isDirectMedia(url) {
  return /\.(?:m3u8|mp4|flv|mkv)(?:$|[?#])/i.test(String(url || ""));
}

function isOfficialSource(url) {
  const value = String(url || "").toLowerCase();
  if (isDirectMedia(value)) return false;
  return [
    "mgtv.com", "youku.com", "iqiyi.com", "qiyi.com", "v.qq.com", "qq.com",
    "bilibili.com", "le.com", "sohu.com", "pptv.com", "1905.com",
  ].some((host) => value.includes(host));
}

function decodePlayerUrl(value, encrypt) {
  let url = String(value || "").replace(/\\\//g, "/");
  try {
    if (String(encrypt) === "1") return decodeURIComponent(url);
    if (String(encrypt) === "2") {
      url = Buffer.from(url, "base64").toString("utf8");
      return decodeURIComponent(url);
    }
  } catch (_) {}
  return url;
}

function decryptBfqResult(cipherText) {
  const value = String(cipherText || "");
  if (value.length <= 32) return null;
  try {
    const key = CryptoJS.enc.Utf8.parse(value.slice(-32, -16));
    const iv = CryptoJS.enc.Utf8.parse(value.slice(-16));
    const ciphertext = CryptoJS.enc.Base64.parse(value.slice(0, -32));
    const decrypted = CryptoJS.AES.decrypt({ ciphertext }, key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    }).toString(CryptoJS.enc.Utf8);
    return JSON.parse(decrypted);
  } catch (_) {
    return null;
  }
}

async function resolveM3u8Child(url, referer) {
  try {
    const text = await fetchText(url, { referer: referer || `${HOST}/`, timeout: 20000, retries: 0 });
    if (!text.includes("#EXTM3U") || !text.includes("#EXT-X-STREAM-INF")) return url;
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].startsWith("#EXT-X-STREAM-INF")) continue;
      const child = lines.slice(index + 1).find((line) => !line.startsWith("#"));
      if (child) return absUrl(child, url);
    }
  } catch (_) {}
  return url;
}

async function resolveOfficialSource(sourceUrl) {
  if (!isOfficialSource(sourceUrl)) return "";
  const encoded = encodeURIComponent(sourceUrl);
  const pageUrl = `${BFQ_HOST}/player?url=${encoded}`;
  const referer = `${BFQ_HOST}/excessive?url=${encoded}`;
  const html = await fetchText(pageUrl, { referer, timeout: 20000, retries: 0 });
  const match = html.match(/let\s+result\s*=\s*["']([^"']+)["']/i);
  const data = decryptBfqResult(match ? match[1] : "");
  let mediaUrl = String(data?.video_info?.video?.url || "").replace(/\\\//g, "/");
  if (mediaUrl && isDirectMedia(mediaUrl) && /\.m3u8(?:$|[?#])/i.test(mediaUrl)) {
    mediaUrl = await resolveM3u8Child(mediaUrl, pageUrl);
  }
  return isDirectMedia(mediaUrl) ? mediaUrl : "";
}

function buildParserUrl(playUrl, nextLink, title) {
  if (!playUrl) return "";
  let url = `${PARSER_HOST}/ppy.php?url=${playUrl}`;
  if (nextLink) {
    const next = String(nextLink);
    if (next.startsWith("//")) url += `&next=${next}`;
    else if (/^https?:\/\//i.test(next)) url += `&next=//${next.replace(/^https?:\/\//i, "")}`;
    else url += `&next=//www.knvod.com/${next.replace(/^\/+/, "")}`;
  }
  if (title) url += `&title=${encodeURIComponent(title)}`;
  return url;
}

function directPlayResult(url, referer) {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return {
    parse: 0,
    jx: 0,
    url,
    urls: [{ name: "播放", url }],
    header,
    headers: header,
  };
}

function sniffPlayResult(url, referer, name = "播放页") {
  const header = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  return {
    parse: 1,
    jx: 1,
    url,
    urls: [{ name, url }],
    header,
    headers: header,
  };
}

function normalizeSniffUrls(result, defaultName) {
  const urls = [];
  const seen = new Set();
  const append = (item) => {
    const value = typeof item === "string" ? item : (item?.url || item?.playUrl || item?.src || "");
    const url = String(value || "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push({ name: String(item?.name || defaultName || "嗅探线路"), url });
  };

  if (Array.isArray(result?.urls)) result.urls.forEach(append);
  if (!urls.length) append(result);
  return urls;
}

async function serverSniffOrBrowserFallback(targetUrl, referer, name = "播放") {
  const fallbackHeader = { "User-Agent": UA, Referer: referer || `${HOST}/` };
  if (typeof OmniBox.sniffVideo === "function") {
    try {
      const sniffed = await OmniBox.sniffVideo(targetUrl, fallbackHeader);
      const urls = normalizeSniffUrls(sniffed, name);
      if (urls.length) {
        const header = sniffed?.header || sniffed?.headers || fallbackHeader;
        await OmniBox.log("info", `[柯南影视][play] 服务端嗅探成功 sniffed=${JSON.stringify(sniffed)}`);
        return {
          parse: 0,
          jx: 0,
          url: urls[0].url,
          urls,
          header,
          headers: header,
          danmaku: sniffed?.danmaku || [],
        };
      }
      await OmniBox.log("warn", "[柯南影视][play] 服务端嗅探无结果，转浏览器嗅探");
    } catch (error) {
      await OmniBox.log("warn", `[柯南影视][play] 服务端嗅探失败，转浏览器嗅探: ${error.message}`);
    }
  }
  return sniffPlayResult(targetUrl, referer, name);
}

async function home() {
  const list = [];
  const seen = new Set();

  try {
    const pages = await Promise.allSettled([
      apiVodList({ page: 1 }),
      apiVodList({ page: 2 }),
      apiVodList({ page: 3 }),
    ]);
    for (const result of pages) {
      if (result.status === "fulfilled") list.push(...result.value.list);
    }
    if (!list.length && pages[0].status === "rejected") {
      await OmniBox.log("warn", `[柯南影视][home] api ${pages[0].reason.message}`);
    }
  } catch (error) {
    await OmniBox.log("warn", `[柯南影视][home] api ${error.message}`);
  }

  if (!list.length) {
    for (const item of CLASS_LIST) {
      try {
        const html = await fetchText(`${HOST}/vshow/${item.type_id}-----------.html`);
        for (const video of extractVideos(html)) {
          if (seen.has(video.vod_id)) continue;
          seen.add(video.vod_id);
          list.push(video);
        }
        if (list.length >= 72) break;
      } catch (error) {
        await OmniBox.log("warn", `[柯南影视][home] tid=${item.type_id} ${error.message}`);
      }
    }
  }

  if (!list.length) {
    try {
      const html = await fetchText(`${HOST}/`);
      for (const video of extractVideos(html)) {
        if (seen.has(video.vod_id)) continue;
        seen.add(video.vod_id);
        list.push(video);
      }
    } catch (error) {
      await OmniBox.log("warn", `[柯南影视][home] ${error.message}`);
    }
  }

  return { class: CLASS_LIST, filters: {}, list: list.slice(0, 72) };
}

async function category(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  try {
    const tid = String(params.categoryId || params.type_id || "1").trim();
    try {
      return await apiVodList({ type: tid, page });
    } catch (error) {
      await OmniBox.log("warn", `[柯南影视][category] api ${error.message}`);
    }
    const url = `${HOST}/vshow/${tid}--------${page}---.html`;
    const html = await fetchText(url);
    const list = extractVideos(html);
    return {
      page,
      pagecount: parsePageCount(html, page, list.length),
      total: list.length,
      list,
    };
  } catch (error) {
    await OmniBox.log("error", `[柯南影视][category] ${error.message}`);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params) {
  const page = Math.max(1, parseInt(params.page || 1, 10));
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };
    const url = `${HOST}/search/${encodeURIComponent(keyword)}-------------.html`;
    try {
      const html = await fetchText(url);
      const list = extractVideos(html);
      if (list.length) return { page, pagecount: 1, total: list.length, list };
    } catch (error) {
      await OmniBox.log("warn", `[柯南影视][search] page ${error.message}`);
    }
    try {
      return await apiVodList({ wd: keyword, tag: "", page });
    } catch (error) {
      await OmniBox.log("warn", `[柯南影视][search] api ${error.message}`);
    }
    const html = await fetchText(url);
    const list = extractVideos(html);
    return { page, pagecount: list.length ? 1 : 0, total: list.length, list };
  } catch (error) {
    await OmniBox.log("error", `[柯南影视][search] ${error.message}`);
    return { page, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params) {
  try {
    const input = String(params.videoId || params.id || params.categoryId || "").trim();
    const idMatch = input.match(/\/vdetail\/(\d+)\.html/i) || input.match(/^(\d+)$/);
    const vodId = idMatch ? idMatch[1] : "";
    if (!vodId) return { list: [] };

    const html = await fetchText(`${HOST}/vdetail/${vodId}.html`);
    const titleMatch = html.match(/<h3\b[^>]*class=["'][^"']*slide-info-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)
      || html.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i);
    const picMatch = html.match(/detail-pic[\s\S]*?<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i)
      || html.match(/slide-time-img2[\s\S]*?<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i);
    const contentMatch = html.match(/id=["']height_limit["'][^>]*>([\s\S]*?)<\/div>/i);
    const typeBlock = extractLabeledBlock(html, "类型");
    const areaBlock = extractLabeledBlock(html, "地区");
    const yearBlock = extractLabeledBlock(html, "年份");
    const playSources = parsePlaySources(html);

    return {
      list: [{
        vod_id: vodId,
        vod_name: cleanText(titleMatch ? titleMatch[1] : ""),
        vod_pic: fixPicUrl(picMatch ? picMatch[1] : ""),
        type_name: cleanText(typeBlock),
        vod_year: cleanText(yearBlock),
        vod_area: cleanText(areaBlock),
        vod_remarks: "",
        vod_actor: extractPeople(html, "主演"),
        vod_director: extractPeople(html, "导演"),
        vod_content: cleanText(contentMatch ? contentMatch[1] : ""),
        vod_play_sources: playSources,
      }],
    };
  } catch (error) {
    await OmniBox.log("error", `[柯南影视][detail] ${error.message}`);
    return { list: [] };
  }
}

async function play(params) {
  try {
    const input = String(params.playId || params.id || params.url || params.input || "").trim();
    if (!input) return { parse: 0, jx: 0, url: "", urls: [], header: {} };

    const playUrl = absUrl(input);
    if (isOfficialSource(playUrl)) {
      const officialUrl = await resolveOfficialSource(playUrl);
      if (officialUrl) return directPlayResult(officialUrl, `${BFQ_HOST}/`);
    }
    if (isDirectMedia(playUrl)) return directPlayResult(playUrl, `${HOST}/`);

    const html = await fetchText(playUrl, { referer: `${HOST}/`, timeout: 20000, retries: 0 });
    const iframeRegex = /<iframe\b[^>]*src=["']([^"']+)["']/gi;
    let iframeMatch;
    while ((iframeMatch = iframeRegex.exec(html)) !== null) {
      const iframeUrl = absUrl(iframeMatch[1], playUrl);
      if (isDirectMedia(iframeUrl)) return directPlayResult(iframeUrl, playUrl);
    }

    const playerMatch = html.match(/var\s+player_[a-zA-Z0-9_$]+\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/i)
      || html.match(/var\s+player_[a-zA-Z0-9_$]+\s*=\s*(\{[\s\S]*?\})\s*;/i);
    if (playerMatch) {
      let playerData;
      try {
        playerData = JSON.parse(playerMatch[1]);
      } catch (_) {
        playerData = null;
      }

      if (playerData) {
        let mediaUrl = decodePlayerUrl(playerData.url, playerData.encrypt);
        if (isDirectMedia(mediaUrl)) {
          if (/\.m3u8(?:$|[?#])/i.test(mediaUrl)) mediaUrl = await resolveM3u8Child(mediaUrl, playUrl);
          return directPlayResult(mediaUrl, `${HOST}/`);
        }
        if (isOfficialSource(mediaUrl)) {
          const officialUrl = await resolveOfficialSource(mediaUrl);
          if (officialUrl) return directPlayResult(officialUrl, `${BFQ_HOST}/`);
        }
        if (mediaUrl) {
          const parserUrl = buildParserUrl(mediaUrl, playerData.link_next, playerData.vod_data?.vod_name);
          return await serverSniffOrBrowserFallback(parserUrl, `${PARSER_HOST}/`, playerData.vod_data?.vod_name || "播放");
        }
      }
    }

    const directMatch = html.match(/["'](https?:\/\/[^"']+\.(?:m3u8|mp4|flv|mkv)(?:\?[^"']*)?)["']/i);
    if (directMatch) return directPlayResult(decodeHtml(directMatch[1]).replace(/\\\//g, "/"), `${HOST}/`);
    return await serverSniffOrBrowserFallback(playUrl, `${HOST}/`, "播放");
  } catch (error) {
    await OmniBox.log("error", `[柯南影视][play] ${error.message}`);
    return { parse: 0, jx: 0, url: "", urls: [], header: {} };
  }
}
