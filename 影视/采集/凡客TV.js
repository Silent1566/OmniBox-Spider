// @name 凡客TV
// @author 梦
// @description 刮削：已接入，弹幕：未接入，嗅探：官方 playback_v2 直链优先（失败时页面回退）；适配新版 /ysapi 接口
// @dependencies crypto-js
// @version 1.4.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/凡客TV.js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const CryptoJS = require("crypto-js");
const https = require("https");

const BASE_URL = "https://fktv.me";
const API_BASE = `${BASE_URL}/ysapi`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0";
const API_KEY = "9ed1a661a6ab787a";
const DEVICE_ID = "57nTmEknMZ146xw4KXGHDCHk1MjshRyY";
const PAGE_SIZE = 32;

const CATEGORIES = [
  { type_id: "movie", type_name: "电影" },
  { type_id: "tv", type_name: "电视剧" },
  { type_id: "comic", type_name: "动漫" },
  { type_id: "zy", type_name: "综艺" },
  { type_id: "short_tv", type_name: "短剧" },
  { type_id: "jlp", type_name: "纪录片" },
  { type_id: "js", type_name: "电影解说" }
];
const POSITION_NAMES = Object.fromEntries(CATEGORIES.map((it) => [it.type_id, it.type_name]));
const LEGACY_POSITIONS = {
  "1": "movie",
  "2": "tv",
  "3": "zy",
  "4": "comic",
  "5": "tv",
  "6": "jlp",
  "7": "js",
  "8": "short_tv"
};

function _json(data) {
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

async function _log(level, message, extra) {
  const suffix = typeof extra === "undefined" ? "" : ` | ${_json(extra)}`;
  await OmniBox.log(level, `[FKTV] ${message}${suffix}`);
}

function _safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function _normalizePagination(page, pageSize, total, pagecount) {
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 100) : 20;
  const safeTotal = Number.isFinite(total) && total >= 0 ? total : 0;
  const safePagecount = Number.isFinite(pagecount) && pagecount > 0
    ? pagecount
    : (safeTotal > 0 ? Math.ceil(safeTotal / safePageSize) : (safePage > 1 ? safePage : 1));
  return { page: safePage, pagecount: safePagecount, limit: safePageSize, total: safeTotal };
}

function _apiTime() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

function _encryptPayload(data, referer) {
  const outer = {
    deviceId: DEVICE_ID,
    token: "",
    domain: "fktv.me",
    referer: referer || `${BASE_URL}/`,
    user_agent: UA,
    shareCode: "",
    channel: "",
    ip: "",
    data: data || {}
  };
  const key = CryptoJS.enc.Utf8.parse(API_KEY);
  return CryptoJS.AES.encrypt(JSON.stringify(outer), key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  }).toString();
}

function _decryptResponse(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("接口返回为空");
  if (value.startsWith("{") || value.startsWith("[")) return _safeJsonParse(value, null);
  const key = CryptoJS.enc.Utf8.parse(API_KEY);
  const plain = CryptoJS.AES.decrypt(value, key, {
    mode: CryptoJS.mode.ECB,
    padding: CryptoJS.pad.Pkcs7
  }).toString(CryptoJS.enc.Utf8);
  return _safeJsonParse(plain, null);
}

function _httpsPost(url, body, referer, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(body, "utf8");
    const req = https.request({
      hostname: u.hostname,
      port: u.port || 443,
      path: `${u.pathname}${u.search}`,
      method: "POST",
      rejectUnauthorized: false,
      timeout,
      headers: {
        "accept": "application/json, text/plain, */*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "content-type": "application/octet-stream",
        "content-length": String(data.length),
        "origin": BASE_URL,
        "referer": referer || `${BASE_URL}/`,
        "user-agent": UA,
        "deviceType": "pc",
        "version": "1.0",
        "time": _apiTime()
      }
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function _apiPost(endpoint, data = {}, referer = `${BASE_URL}/`) {
  const url = `${API_BASE}/${endpoint}`;
  const body = _encryptPayload(data, referer);
  let res;
  try {
    res = await _httpsPost(url, body, referer);
  } catch (e) {
    await _log("warn", "HTTPS 调用接口失败，回退 OmniBox.request", { endpoint, message: e.message });
    res = await OmniBox.request(url, {
      method: "POST",
      headers: {
        "accept": "application/json, text/plain, */*",
        "content-type": "application/octet-stream",
        "origin": BASE_URL,
        "referer": referer || `${BASE_URL}/`,
        "user-agent": UA,
        "deviceType": "pc",
        "version": "1.0",
        "time": _apiTime()
      },
      body,
      timeout: 20000
    });
    const raw = res && res.body ? res.body : res;
    res = { status: res?.statusCode || 200, body: Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "") };
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`接口 HTTP ${res.status}: ${endpoint}`);
  }
  const json = _decryptResponse(res.body);
  if (!json || json.status !== "y") {
    throw new Error(json?.error || `接口返回异常: ${endpoint}`);
  }
  return json.data;
}

function _normalizePosition(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (POSITION_NAMES[raw]) return raw;
  if (LEGACY_POSITIONS[raw]) return LEGACY_POSITIONS[raw];
  const lowered = raw.toLowerCase();
  if (POSITION_NAMES[lowered]) return lowered;
  return Object.entries(POSITION_NAMES).find(([, name]) => name === raw)?.[0] || "";
}

function _absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value}`;
}

function _movieDetailUrl(item) {
  const id = String(item?.id || item?.movie_id || "").trim();
  const slug = String(item?.seo_slug || item?.slug || "").trim();
  return slug ? `${BASE_URL}/movie/${id}/${slug}` : `${BASE_URL}/movie/detail/${id}`;
}

function _mapVod(item, typeId = "") {
  const id = String(item?.id || item?.movie_id || "").trim();
  const name = String(item?.name || item?.movie_name || "").trim();
  if (!id || !name) return null;
  const position = _normalizePosition(item.position || typeId);
  const pic = _absUrl(item.img_y_source || item.img_x_source || item.img_y || item.img_x || "");
  const remarks = [
    item.area,
    item.language,
    item.release_at,
    item.child_title || item.category || POSITION_NAMES[position]
  ].filter(Boolean).join(" | ");
  return {
    vod_id: id,
    vod_name: name,
    vod_pic: pic,
    vod_url: _absUrl(item.canonical_path) || _movieDetailUrl(item),
    type_id: position,
    type_name: POSITION_NAMES[position] || item.child_title || item.category || "",
    vod_remarks: remarks
  };
}

function _dedupVodList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((it) => {
    if (!it || !it.vod_id || seen.has(it.vod_id)) return false;
    seen.add(it.vod_id);
    return true;
  });
}

async function _fetchMovieList(payload, referer) {
  const data = await _apiPost("movie/search", payload, referer);
  const rows = Array.isArray(data?.data) ? data.data : [];
  return {
    list: _dedupVodList(rows.map((row) => _mapVod(row, payload.position))),
    total: Number(data?.total) || rows.length,
    page: Number(data?.current_page) || Number(payload.page) || 1,
    pagecount: Number(data?.last_page) || 0
  };
}

function _pickEpisodeName(item, index = 0) {
  return String(item?.name || item?.title || `第${index + 1}集`).trim() || `第${index + 1}集`;
}

function _encodePlayId(meta) {
  return JSON.stringify({
    movie_id: meta.movie_id || "",
    link_id: meta.link_id || "",
    line_id: meta.line_id || "",
    line_name: meta.line_name || "",
    episode_name: meta.episode_name || "",
    page: meta.page || ""
  });
}

function _normalizeLegacyLinks(links) {
  return (Array.isArray(links) ? links : []).map((item) => {
    const url = item?.m3u8_url || item?.preview_m3u8_url || "";
    if (!url) return null;
    return { name: item.name || item.id || "线路", url: _absUrl(url), lineId: item.id || "" };
  }).filter(Boolean);
}

function _normalizePlayback(playback) {
  if (!playback || playback.version !== 2) return [];
  const rows = Array.isArray(playback.video_lines) ? playback.video_lines : [];
  return rows.map((line) => {
    const media = line?.h264 || line?.hevc;
    const path = media?.url || playback.play_url;
    if (!path) return null;
    return {
      lineId: String(line.line || ""),
      name: String(line.name || line.line || "线路"),
      url: _absUrl(path)
    };
  }).filter((it) => it && it.url);
}

function _buildDirectResult(urls, referer) {
  const mapped = urls.map((it) => ({ name: it.name, url: it.url }));
  const headers = {
    "User-Agent": UA,
    "Referer": referer || `${BASE_URL}/`,
    "Origin": BASE_URL
  };
  return {
    parse: 0,
    url: mapped.length === 1 ? mapped[0].url : undefined,
    urls: mapped,
    header: headers,
    headers
  };
}

function _buildFallback(pageUrl, name = "FKTV 接口未返回可播地址") {
  const headers = {
    "User-Agent": UA,
    "Referer": pageUrl,
    "Origin": BASE_URL
  };
  return {
    parse: 1,
    url: pageUrl,
    urls: [{ name, url: pageUrl }],
    header: headers,
    headers
  };
}

async function home() {
  const payload = { page: 1, page_size: PAGE_SIZE, is_hot: "y", order: "new" };
  let result;
  try {
    result = await _fetchMovieList(payload, `${BASE_URL}/`);
  } catch (e) {
    await _log("warn", "home 热门列表失败，回退最新列表", { message: e.message });
    result = await _fetchMovieList({ page: 1, page_size: PAGE_SIZE }, `${BASE_URL}/`);
  }
  await _log("info", "home 解析结果", { count: result.list.length, first: result.list[0] || null });
  return { class: CATEGORIES, list: result.list.slice(0, 24) };
}

async function category(params) {
  const page = params.page ? Number(params.page) : 1;
  const pageSize = params.page_size ? Number(params.page_size) : PAGE_SIZE;
  const position = _normalizePosition(params.type_id || params.cat_id || params.typeId || params.type || params.categoryId);
  const payload = { page, page_size: pageSize };
  if (position) payload.position = position;

  await _log("info", "category 入参", { params, payload });
  const result = await _fetchMovieList(payload, `${BASE_URL}/channel/${position || "movie"}`);
  await _log("info", "category 解析结果", { count: result.list.length, first: result.list[0] || null });
  return { ..._normalizePagination(result.page, pageSize, result.total, result.pagecount), list: result.list };
}

async function detail(params) {
  const id = String(params.videoId || params.vod_id || params.id || "").trim();
  await _log("info", "detail 入参", params);
  if (!id) return { list: [] };

  const movieId = (id.match(/([0-9a-f]{16})/i) || [])[1] || id;
  const pageUrl = id.startsWith("http") ? id : _movieDetailUrl({ id: movieId, seo_slug: "" });
  const data = await _apiPost("movie/detail", { id: movieId, link_id: "", is_simple: "y" }, pageUrl);
  const links = Array.isArray(data.links) ? data.links : [];
  const fallbackLink = data.link_id || links.find((it) => it.is_selected === "y")?.id || links[0]?.id || "";
  const episodes = (links.length ? links : (fallbackLink ? [{ id: fallbackLink, name: "正片" }] : [])).map((item, index) => ({
    name: _pickEpisodeName(item, index),
    playId: _encodePlayId({
      movie_id: data.id || movieId,
      link_id: item.id || fallbackLink,
      line_id: "",
      line_name: "",
      episode_name: _pickEpisodeName(item, index),
      page: _movieDetailUrl(data)
    })
  }));

  const playSources = episodes.length ? [{ name: "默认线路", episodes }] : [];
  const remarks = [
    data.area,
    data.language,
    data.release_at,
    data.child_title || data.category,
    data.play_error_type && data.play_error_type !== "none" ? data.play_error : ""
  ].filter(Boolean).join(" | ");
  const vod = {
    vod_id: data.id || movieId,
    vod_name: data.name || movieId,
    vod_pic: _absUrl(data.img_y_source || data.img_x_source || data.img_y || data.img_x || ""),
    vod_url: _movieDetailUrl(data),
    vod_content: data.description || "",
    vod_actor: data.actor || "",
    vod_director: data.director || "",
    vod_area: data.area || "",
    vod_year: data.release_at || "",
    vod_remarks: remarks,
    vod_play_from: "FKTV",
    vod_play_url: episodes.map((it) => `${it.name}$${it.playId}`).join("#"),
    vod_play_sources: playSources
  };

  await _log("info", "detail 解析结果", {
    id: vod.vod_id,
    name: vod.vod_name,
    episodeCount: episodes.length,
    playErrorType: data.play_error_type,
    playbackV2: !!data.playback_v2
  });
  return { list: [vod] };
}

async function _requestPlayDetail(meta) {
  const movieId = String(meta.movie_id || "").trim();
  const linkId = String(meta.link_id || "").trim();
  const pageUrl = meta.page || _movieDetailUrl({ id: movieId });
  const payload = { id: movieId, link_id: linkId, is_simple: "y" };
  const data = await _apiPost("movie/detail", payload, pageUrl);
  const selectedLink = linkId
    || data.link_id
    || (Array.isArray(data.links) && (data.links.find((it) => it.is_selected === "y")?.id || data.links[0]?.id))
    || "";
  let urls = _normalizePlayback(data.playback_v2);
  if (meta.line_id) {
    const picked = urls.filter((it) => it.lineId === meta.line_id);
    if (picked.length) urls = picked;
  }
  if (!urls.length) urls = _normalizeLegacyLinks(data.play_links);
  return { data, urls, pageUrl, selectedLink };
}

async function play(params) {
  try {
    await _log("info", "play 入参", params);
    const raw = String(params.playId || params.play_id || params.url || "").trim();
    if (!raw) throw new Error("播放标识为空");

    if (/\.(m3u8|mp4|flv)(\?|$)/i.test(raw)) {
      return _buildDirectResult([{ name: "直链播放", url: raw }], BASE_URL);
    }

    let meta = _safeJsonParse(raw, null);
    if (!meta && /^[0-9a-f]{32}$/i.test(raw)) meta = { movie_id: "", link_id: raw, page: "" };
    if (!meta?.movie_id && !meta?.link_id && /^https?:\/\//i.test(raw)) {
      const fallback = _buildFallback(raw);
      await _log("warn", "play 仅收到页面地址，回退嗅探页", fallback);
      return fallback;
    }
    if (meta.movie_id && !meta.page) meta.page = _movieDetailUrl({ id: meta.movie_id });
    await _log("info", "play 解析后的 playId", meta);

    const result = await _requestPlayDetail(meta);
    await _log("info", "play 接口结果", {
      movieId: meta.movie_id,
      requestedLinkId: meta.link_id,
      selectedLink: result.selectedLink,
      playErrorType: result.data.play_error_type,
      urls: result.urls
    });

    if (result.urls.length) return _buildDirectResult(result.urls, result.pageUrl);

    if (["need_vip", "captcha"].includes(result.data.play_error_type)) {
      const fallback = _buildFallback(result.pageUrl, result.data.play_error || "站点播放受限");
      await _log("warn", "play 官方接口受限，回退页面", { playErrorType: result.data.play_error_type, fallback });
      return fallback;
    }

    try {
      const sniff = await OmniBox.sniffVideo(result.pageUrl, { "User-Agent": UA, "Referer": result.pageUrl });
      if (sniff?.url) {
        const direct = _buildDirectResult([{ name: "嗅探播放", url: sniff.url }], result.pageUrl);
        direct.header = sniff.header || direct.header;
        direct.headers = sniff.header || direct.headers;
        await _log("info", "play 使用 sniff 结果返回", direct);
        return direct;
      }
    } catch (e) {
      await _log("warn", "play sniffVideo 失败", { message: e.message, sniffUrl: result.pageUrl });
    }

    return _buildFallback(result.pageUrl, "FKTV 接口未返回当前剧集可播地址");
  } catch (e) {
    await _log("error", "play 异常", { message: e.message, stack: e.stack });
    return { parse: 0, urls: [], url: "", header: {}, headers: {} };
  }
}

async function search(params) {
  const keyword = String(params.keyword || params.key || params.wd || "").trim();
  const page = params.page ? Number(params.page) : 1;
  const pageSize = params.page_size ? Number(params.page_size) : 20;
  await _log("info", "search 入参", params);
  if (!keyword) return { ..._normalizePagination(page, pageSize, 0), list: [] };

  const payload = { keywords: keyword, page, page_size: pageSize, is_search: "y" };
  const result = await _fetchMovieList(payload, `${BASE_URL}/movie/search`);
  await _log("info", "search 解析结果", { keyword, count: result.list.length, first: result.list[0] || null });
  return { ..._normalizePagination(result.page, pageSize, result.total, result.pagecount), list: result.list };
}

runner.run({ home, category, detail, search, play });
