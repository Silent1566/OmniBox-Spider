// @name 听友FM
// @author OmniBox助手
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/听书/听友FM.js
// @dependencies axios,cheerio,@noble/ciphers
// notes:
// 1) 分类/详情优先走页面结构与 Nuxt 数据，减少对加密接口的依赖。 
// 2) 播放主链使用 /api/play_token，需按站点前端 v2 响应逻辑解包：nonce=bytes[1..24]，cipher=bytes[25..]，当 version===2 时先 reverse(cipher) 再解密。
// 3) /audios/{albumId}/{chapterIdx} 仅作为 sniffVideo 兜底页；若运行环境的 sniffer 存在 bug，可先依赖 play_token 直链。

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const axios = require("axios");
const cheerio = require("cheerio");
const { webcrypto } = require("crypto");
let xchacha = null;
let xchachaLoadAttempted = false;

async function getXChaChaModule() {
  if (xchacha) return xchacha;
  if (xchachaLoadAttempted) return null;
  xchachaLoadAttempted = true;

  const candidates = [
    '@noble/ciphers/chacha',
    '@noble/ciphers/chacha.js',
    '@noble/ciphers'
  ];

  for (const name of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(name);
      xchacha = mod;
      log("info", `xchacha.load.ok ${name} mode=require`);
      return xchacha;
    } catch (e) {
      log("warn", `xchacha.load.fail ${name} mode=require message=${e.message}`);
    }
  }

  for (const name of candidates) {
    try {
      const mod = await import(name);
      xchacha = mod;
      log("info", `xchacha.load.ok ${name} mode=import`);
      return xchacha;
    } catch (e) {
      log("warn", `xchacha.load.fail ${name} mode=import message=${e.message}`);
    }
  }

  return null;
}

const SITE = "https://tingyou.fm";
const PAYLOAD_KEY_HEX = "ea9d9d4f9a983fe6f6382f29c7b46b8d6dc47abc6da36662e6ddff8c78902f65";
const PAYLOAD_VERSION = 1;

const CATEGORY_MAP = [
  { type_id: "46", type_name: "有声小说" },
  { type_id: "11", type_name: "武侠小说" },
  { type_id: "19", type_name: "言情通俗" },
  { type_id: "21", type_name: "相声小品" },
  { type_id: "14", type_name: "恐怖惊悚" },
  { type_id: "17", type_name: "官场商战" },
  { type_id: "15", type_name: "历史军事" },
  { type_id: "9", type_name: "百家讲坛" }
];

function log(level, msg) {
  try {
    OmniBox.log(level, `[TingYou] ${msg}`);
  } catch {}
}

function j(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function summarizeVodList(list, limit = 3) {
  return (list || []).slice(0, limit).map(item => ({
    vod_id: item.vod_id,
    vod_name: item.vod_name,
    type_id: item.type_id,
    type_name: item.type_name,
    vod_pic: item.vod_pic,
    vod_remarks: item.vod_remarks
  }));
}

const HARDCODED_TINGYOU_ANON_AUTH = "Bearer gAAAAABpxTyveIsV3svITKMLKF6NdvuVhbJzxnWPJFmeav8M502s6toC4ryey8_DGOVK62SyVzJ1eDpcYA7Snr8kkcp5V40NaDyAudniva8y-Ac7MOBxPS9Ly1hlXxJ86s3xO9eg8HW9OPtoPIAIVJu19MSWo52zlVLeBlMBO903FQ-ZJBCVZuZdzg_Cok1d1_-C819LqDAfh_RzkMQmzBYxa6yCnhh_VImejRNaqSyb8sNYf-zYl009OaDGLNG8srEhaix7sVlN55n_9lhoxEVontCRN8rdaA==";
const HARDCODED_TINGYOU_ANON_COOKIE = "dfp=f-c28yu:f-FTCFtTJZeXVY2UuWHmawNVQqrdGrZPVkiLIbYEqzXTnAgPfIngVZ4rn1sO+Y0AaxEryBUXuyhA5JUyUw7x0NcW/UEhTsbrYcpf30YWJPMcuN/edHp0T/fMMcMC07yROtEupjp6qCgfAZkU7zlDvWRx3cGG90tcQvvMXkEiCm4qKaq8zTTCTIAKeWjVdIjzis; Hm_lvt_487a45d5a76f87740d9bd6c64551f918=1774497846,1774517403,1774531868; HMACCOUNT=6848F17C0F59F642; Hm_lpvt_487a45d5a76f87740d9bd6c64551f918=1774533196";

function getAuthToken(options = {}) {
  const includeHardcoded = options.includeHardcoded !== false;
  return process.env.TINGYOU_AUTH || process.env.TINGYOU_ANON_AUTH || (includeHardcoded ? HARDCODED_TINGYOU_ANON_AUTH : "") || "";
}

function getCookie(options = {}) {
  const includeHardcoded = options.includeHardcoded !== false;
  return process.env.TINGYOU_COOKIE || process.env.TINGYOU_ANON_COOKIE || (includeHardcoded ? HARDCODED_TINGYOU_ANON_COOKIE : "") || "";
}

function getHeaders(extra = {}, authOptions = {}) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
    Referer: SITE + "/",
    Origin: SITE,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  };
  const auth = getAuthToken(authOptions);
  const cookie = getCookie(authOptions);
  if (auth) headers.Authorization = auth;
  if (cookie) headers.Cookie = cookie;
  return { ...headers, ...extra };
}

function hexToBytes(hex) {
  const clean = String(hex || "").trim();
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes || []).map(b => b.toString(16).padStart(2, "0")).join("");
}


function inspectPayloadCandidate(value) {
  const text = typeof value === "string" ? value : "";
  const isHex = !!text && /^[0-9a-fA-F]+$/.test(text) && text.length > 32;
  const versionByte = isHex && text.length >= 2 ? parseInt(text.slice(0, 2), 16) : null;
  return {
    type: Array.isArray(value) ? "array" : typeof value,
    isHex,
    length: text.length || 0,
    versionByte,
    head: text ? text.slice(0, 80) : ""
  };
}

async function encryptPayload(plainText) {
  const keyBytes = hexToBytes(PAYLOAD_KEY_HEX);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const cipherBuf = await webcrypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plainText));
  const cipher = new Uint8Array(cipherBuf);
  const out = new Uint8Array(1 + iv.length + cipher.length);
  out[0] = PAYLOAD_VERSION;
  out.set(iv, 1);
  out.set(cipher, 1 + iv.length);
  return bytesToHex(out);
}

async function decryptPayloadHex(hex) {
  const verboseApi = !!process.env.TINGYOU_VERBOSE_API;
  const raw = hexToBytes(hex);
  if (!raw || raw.length < 29) throw new Error("payload too short");
  const version = raw[0];
  const keyBytes = hexToBytes(PAYLOAD_KEY_HEX);
  const key = await webcrypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);

  async function tryAes(ivStart, cipherStart, note) {
    const iv = raw.slice(ivStart, ivStart + 12);
    const cipher = raw.slice(cipherStart);
    const plainBuf = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    const plain = new TextDecoder().decode(plainBuf);
    log("info", `decrypt.variant.ok ${j({ version, note, ivStart, cipherStart, plainHead: plain.slice(0, 120) })}`);
    return plain;
  }

  if (version === 1) {
    const attempts = [
      { ivStart: 1, cipherStart: 13, note: 'v1-standard' },
      { ivStart: 0, cipherStart: 12, note: 'v1-no-version-prefix' },
      { ivStart: 2, cipherStart: 14, note: 'v1-shift-plus1' }
    ];
    let lastErr = null;
    for (const item of attempts) {
      try {
        return await tryAes(item.ivStart, item.cipherStart, item.note);
      } catch (e) {
        lastErr = e;
        log("warn", `decrypt.variant.fail ${j({ version, note: item.note, ivStart: item.ivStart, cipherStart: item.cipherStart, message: e.message })}`);
      }
    }
    throw lastErr || new Error("v1 decrypt failed");
  }

  if (version === 2) {
    const xchachaMod = await getXChaChaModule();
    const xchachaFn = xchachaMod?.xchacha20poly1305 || xchachaMod?.default?.xchacha20poly1305 || xchachaMod?.default;
    if (!xchachaFn || typeof xchachaFn !== 'function') {
      throw new Error("version=2 response requires @noble/ciphers/chacha xchacha20poly1305");
    }

    const nonce = raw.slice(1, 25);
    const cipher = raw.slice(25);
    const reversedCipher = cipher.slice().reverse();
    const attempts = [
      { note: 'v2-frontend-reversed-no-aad', cipherText: reversedCipher, aad: undefined },
      { note: 'v2-frontend-raw-no-aad', cipherText: cipher, aad: undefined },
      { note: 'v2-frontend-reversed-version-aad', cipherText: reversedCipher, aad: raw.slice(0, 1) },
      { note: 'v2-frontend-raw-version-aad', cipherText: cipher, aad: raw.slice(0, 1) }
    ];

    let lastErr = null;
    for (const item of attempts) {
      try {
        const box = xchachaFn(keyBytes, nonce, item.aad);
        const plainBytes = box.decrypt(item.cipherText);
        if (!plainBytes) throw new Error('xchacha decrypt returned null');
        const plain = new TextDecoder().decode(plainBytes);
        if (verboseApi) {
          log("info", `decrypt.variant.ok ${j({ version, note: item.note, nonceStart: 1, nonceLen: 24, cipherStart: 25, aadLen: item.aad ? item.aad.length : 0, plainHead: plain.slice(0, 120) })}`);
        }
        return plain;
      } catch (e) {
        lastErr = e;
        if (verboseApi) {
          log("warn", `decrypt.variant.fail ${j({ version, note: item.note, nonceStart: 1, nonceLen: 24, cipherStart: 25, aadLen: item.aad ? item.aad.length : 0, message: e.message })}`);
        }
      }
    }
    throw lastErr || new Error("v2 decrypt failed");
  }

  throw new Error(`unsupported payload version: ${version}`);
}

async function apiRequest(method, path, body, extra = {}) {
  const url = path.startsWith("http") ? path : `${SITE}${path.startsWith("/") ? path : "/" + path}`;
  const headers = getHeaders({ "X-Payload-Version": String(PAYLOAD_VERSION), ...(extra.headers || {}) });
  const config = { method, url, headers, timeout: 20000, validateStatus: () => true, ...(extra.config || {}) };
  const debugLabel = extra.debugLabel || path;
  const verboseApi = !!process.env.TINGYOU_VERBOSE_API;

  if (body !== undefined && body !== null) {
    const plain = typeof body === "string" ? body : JSON.stringify(body);
    config.data = await encryptPayload(plain);
    config.headers["Content-Type"] = "text/plain";
  }

  const resp = await axios(config);
  let data = resp.data;
  const rawSample = typeof data === "string" ? data.slice(0, 200) : j(data).slice(0, 400);
  const objectKeys = data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0, 20) : [];
  if (verboseApi) {
    log("info", `api.raw ${j({ label: debugLabel, status: resp.status, type: Array.isArray(data) ? 'array' : typeof data, keys: objectKeys, sample: rawSample })}`);
  }

  if (data && typeof data === "object" && typeof data.payload === "string") {
    const meta = inspectPayloadCandidate(data.payload);
    if (verboseApi) {
      log("info", `api.payload.meta ${j({ label: debugLabel, source: 'object.payload', ...meta })}`);
    }
    try {
      const plain = await decryptPayloadHex(data.payload);
      if (verboseApi) {
        log("info", `api.payload.decrypt.ok ${j({ label: debugLabel, source: 'object.payload', plainHead: String(plain).slice(0, 200) })}`);
      }
      try { data = JSON.parse(plain); } catch { data = plain; }
    } catch (e) {
      log("error", `api.payload.decrypt.error label=${debugLabel} source=object.payload message=${e.message}`);
      throw e;
    }
  }

  if (typeof data === "string" && /^[0-9a-fA-F]+$/.test(data) && data.length > 32) {
    const meta = inspectPayloadCandidate(data);
    if (verboseApi) {
      log("info", `api.payload.meta ${j({ label: debugLabel, source: 'raw-string', ...meta })}`);
    }
    try {
      const plain = await decryptPayloadHex(data);
      if (verboseApi) {
        log("info", `api.payload.decrypt.ok ${j({ label: debugLabel, source: 'raw-string', plainHead: String(plain).slice(0, 200) })}`);
      }
      try { data = JSON.parse(plain); } catch { data = plain; }
    } catch (e) {
      log("error", `api.payload.decrypt.error label=${debugLabel} source=raw-string message=${e.message} meta=${j(meta)}`);
      throw e;
    }
  }

  if (resp.status >= 400) {
    throw new Error(`HTTP ${resp.status}: ${typeof data === "string" ? data : JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function apiPost(nameOrPath, body, extra = {}) {
  let path = String(nameOrPath || "");
  if (!path.startsWith("/")) path = `/api/${path.replace(/^\//, "")}`;
  const url = path.startsWith("http") ? path : `${SITE}${path.startsWith("/") ? path : "/" + path}`;
  return apiRequest("POST", url, body, { ...extra, debugLabel: nameOrPath });
}

function makeDfpCookie(seed = "") {
  const timeFactor = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  })();
  const base36 = parseInt(timeFactor, 10).toString(36);
  const fpSeed = seed || `${Date.now()}|tingyou|${Math.random()}`;
  const fingerprint = require("crypto").createHash("sha256").update(fpSeed).digest("hex");
  return { timeFactor, fingerprint, cookie: `dfp=f-${base36}:f-${fingerprint}` };
}

async function anonymousAuth() {
  const dfp = makeDfpCookie();
  log("info", `auth.anonymous.start ${j({ timeFactor: dfp.timeFactor, fingerprintHead: dfp.fingerprint.slice(0, 16) })}`);
  const data = await apiPost("me", undefined, {
    headers: {
      Accept: "application/json",
      Cookie: dfp.cookie
    }
  });
  log("info", `auth.anonymous.me ${j(data).slice(0, 1200)}`);
  const authToken = data?.auth_token ? `Bearer ${data.auth_token}` : "";
  return {
    authToken,
    cookie: dfp.cookie,
    raw: data
  };
}

function normalizeUrl(url) {
  if (!url) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return SITE + url;
  return url;
}

function safeText($el) {
  if (!$el || !$el.text) return "";
  return $el.text().replace(/\s+/g, " ").trim();
}

function uniqBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr || []) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function pickImage($img) {
  if (!$img || !$img.attr) return "";
  let pic =
    $img.attr("src") ||
    $img.attr("data-src") ||
    $img.attr("data-lazy-src") ||
    $img.attr("data-original") ||
    $img.attr("data-url") ||
    "";

  if ((!pic || pic.startsWith("data:image")) && $img.attr("srcset")) {
    pic = ($img.attr("srcset") || "").split(",")[0].trim().split(" ")[0] || pic;
  }

  pic = normalizeUrl(pic);
  if (pic.startsWith("data:image")) return "";
  return pic;
}

function parseAlbumCard($, el, fallbackTypeId = "", fallbackTypeName = "") {
  const $el = $(el);
  const href = $el.attr("href") || "";
  const match = href.match(/\/albums\/(\d+)/);
  if (!match) return null;

  const vod_id = match[1];
  const $img = $el.find("img.cover").first().length ? $el.find("img.cover").first() : $el.find("img").first();

  let vod_name =
    $img.attr("alt") ||
    safeText($el.find("p").first()) ||
    safeText($el.find(".title").first()) ||
    safeText($el.find(".name").first()) ||
    "";

  if (!vod_name) {
    const text = safeText($el);
    vod_name = text.split("作者：")[0].trim() || `专辑${vod_id}`;
  }

  const text = safeText($el);
  const periods = /(\d+)\s*期/.exec(text)?.[1] || "";
  const status = /连载中|已完结/.exec(text)?.[0] || "";
  const broadcaster = /播音[：:]\s*([^\s·|]+)/.exec(text)?.[1] || "";
  const author = /作者[：:]\s*([^\s·|]+)/.exec(text)?.[1] || "";
  const vod_remarks = [periods ? `${periods}期` : "", status, broadcaster || author].filter(Boolean).join(" · ");

  return {
    vod_id,
    vod_name,
    vod_pic: pickImage($img),
    vod_remarks,
    type_id: String(fallbackTypeId || ""),
    type_name: fallbackTypeName || ""
  };
}

function decodeNuxtValue(table, node, seen = new Map()) {
  const markers = new Set(["ShallowReactive", "Reactive", "Ref", "EmptyRef", "Set", "Map", "Date", "RegExp", "BigInt", "null", "undefined", "NaN", "-0", "Infinity", "-Infinity"]);

  function inner(value) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < table.length) {
      if (seen.has(value)) return seen.get(value);
      const raw = table[value];

      if (Array.isArray(raw)) {
        if (raw.length && typeof raw[0] === "string" && markers.has(raw[0])) {
          const marker = raw[0];
          if (marker === "ShallowReactive" || marker === "Reactive" || marker === "Ref") {
            return raw.length > 1 ? inner(raw[1]) : null;
          }
          if (marker === "EmptyRef" || marker === "null" || marker === "undefined" || marker === "NaN") {
            return null;
          }
        }
        const out = [];
        seen.set(value, out);
        for (const item of raw) out.push(inner(item));
        return out;
      }

      if (raw && typeof raw === "object") {
        const out = {};
        seen.set(value, out);
        for (const [k, v] of Object.entries(raw)) out[k] = inner(v);
        return out;
      }

      seen.set(value, raw);
      return raw;
    }

    if (Array.isArray(value)) return value.map(inner);
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = inner(v);
      return out;
    }
    return value;
  }

  return inner(node);
}

function parseNuxtCategoryData(html, categoryId) {
  const match = html.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  const payload = JSON.parse(match[1]);
  const root = decodeNuxtValue(payload, 1);
  const dataKey = `categoryAlbums-${categoryId}`;
  return root?.data?.[dataKey] || null;
}

function mapNuxtAlbumItem(item, categoryId, categoryName) {
  if (!item || !item.id) return null;
  const statusText = String(item.status) === "1" ? "连载中" : String(item.status) === "0" ? "已完结" : "";
  const vod_remarks = [item.count ? `${item.count}期` : "", statusText, item.teller || item.author || ""].filter(Boolean).join(" · ");
  return {
    vod_id: String(item.id),
    vod_name: item.title || `专辑${item.id}`,
    vod_pic: normalizeUrl(item.cover_url || ""),
    vod_remarks,
    type_id: String(categoryId || ""),
    type_name: categoryName || ""
  };
}

async function home(params, context) {
  const input = params || {};
  log("info", `home.in ${j(input)}`);
  try {
    const url = SITE + "/";
    log("info", `home.req ${url}`);
    const resp = await axios.get(url, { headers: getHeaders(), timeout: 15000 });
    const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    log("info", `home.html length=${html.length}`);
    const $ = cheerio.load(html);

    const classList = [];
    const seen = new Set();
    const categoryAnchors = $("a[href*='/categories/']");
    log("info", `home.categoryAnchors count=${categoryAnchors.length}`);
    categoryAnchors.each((_, el) => {
      const href = $(el).attr("href") || "";
      const m = href.match(/\/categories\/(\d+)/);
      if (!m) return;
      const type_id = m[1];
      if (seen.has(type_id)) return;
      seen.add(type_id);
      const type_name = safeText($(el)) || CATEGORY_MAP.find(x => x.type_id === type_id)?.type_name || `分类${type_id}`;
      if (!type_name || /全部分类/.test(type_name)) return;
      classList.push({ type_id, type_name });
    });

    const rawAnchors = $("a[href*='/albums/']");
    log("info", `home.albumAnchors count=${rawAnchors.length}`);
    const list = [];
    rawAnchors.each((_, el) => {
      if ($(el).find("img").length === 0) return;
      const item = parseAlbumCard($, el, "46", "有声小说");
      if (item) list.push(item);
    });

    const finalList = uniqBy(list, item => item.vod_id).slice(0, 20);
    const out = { class: classList.length ? classList : CATEGORY_MAP, list: finalList };
    log("info", `home.out classCount=${out.class.length} listCount=${out.list.length} samples=${j(summarizeVodList(out.list))}`);
    return out;
  } catch (e) {
    log("error", `home.error message=${e.message} stack=${e.stack || ""}`);
    return { class: CATEGORY_MAP, list: [] };
  }
}

async function category(params, context) {
  const input = params || {};
  log("info", `category.in ${j(input)}`);
  try {
    const { categoryId, page = 1 } = input;
    const url = `${SITE}/categories/${categoryId}?sort=comprehensive&page=${page}`;
    log("info", `category.req ${url}`);
    const resp = await axios.get(url, { headers: getHeaders(), timeout: 15000 });
    const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    log("info", `category.html length=${html.length}`);
    const $ = cheerio.load(html);

    const pageTitle =
      safeText($("h1").first()) ||
      safeText($("[class*=\"title\"]").first()) ||
      CATEGORY_MAP.find(x => x.type_id === String(categoryId))?.type_name ||
      `分类${categoryId}`;
    log("info", `category.pageTitle ${pageTitle}`);

    const nuxtCategory = parseNuxtCategoryData(html, categoryId);
    if (nuxtCategory) {
      const nuxtItems = Array.isArray(nuxtCategory.data) ? nuxtCategory.data : [];
      log("info", `category.nuxt found=true page=${nuxtCategory.page || page} pages=${nuxtCategory.pages || 0} itemCount=${nuxtItems.length} detail=${nuxtCategory.detail || ''}`);
      log("info", `category.nuxt.samples ${j((nuxtItems || []).slice(0, 5))}`);
      const finalList = uniqBy(
        nuxtItems.map(item => mapNuxtAlbumItem(item, categoryId, pageTitle)).filter(Boolean),
        item => item.vod_id
      );
      const out = {
        page: Number(nuxtCategory.page || page) || 1,
        pagecount: Number(nuxtCategory.pages || page || 1),
        total: finalList.length,
        list: finalList
      };
      log("info", `category.out source=nuxt total=${out.total} listCount=${out.list.length} samples=${j(summarizeVodList(out.list))}`);
      return out;
    }

    log("warn", `category.nuxt found=false fallback=dom`);
    const rawAnchors = $("a[href*='/albums/']");
    log("info", `category.albumAnchors count=${rawAnchors.length}`);

    const list = [];
    const samples = [];
    rawAnchors.each((idx, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const hasImg = $el.find("img").length > 0;
      if (samples.length < 5) {
        samples.push({ idx, href, hasImg, text: safeText($el).slice(0, 80) });
      }
      if (!/\/albums\/\d+/.test(href)) return;
      if (!hasImg) return;
      const item = parseAlbumCard($, el, categoryId, pageTitle);
      if (item) list.push(item);
    });
    log("info", `category.anchorSamples ${j(samples)}`);

    const finalList = uniqBy(list, item => item.vod_id);
    const out = {
      page: Number(page) || 1,
      pagecount: finalList.length > 0 ? (Number(page) || 1) + 1 : Number(page) || 1,
      total: finalList.length,
      list: finalList
    };
    log("info", `category.out source=dom total=${out.total} listCount=${out.list.length} samples=${j(summarizeVodList(out.list))}`);
    return out;
  } catch (e) {
    log("error", `category.error message=${e.message} stack=${e.stack || ""}`);
    return {
      page: Number((params || {}).page || 1),
      pagecount: Number((params || {}).page || 1),
      total: 0,
      list: []
    };
  }
}

async function detail(params, context) {
  const input = params || {};
  log("info", `detail.in ${j(input)}`);
  try {
    const { videoId } = input;
    const url = `${SITE}/albums/${videoId}`;
    log("info", `detail.req ${url}`);
    const resp = await axios.get(url, { headers: getHeaders(), timeout: 15000 });
    const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    log("info", `detail.html length=${html.length}`);
    const $ = cheerio.load(html);
    const $panel = $("section.album-pannel");

    const vod_name =
      safeText($panel.find(".album-intro h1").first()) ||
      safeText($panel.find("h1").first()) ||
      $("meta[property='og:title']").attr("content") ||
      `专辑${videoId}`;

    const vod_pic =
      pickImage($panel.find("img").first()) ||
      normalizeUrl($("meta[property='og:image']").attr("content") || "");

    const vod_content =
      $("meta[name='description']").attr("content") ||
      $("meta[property='og:description']").attr("content") ||
      safeText($(".album-desc, .desc, .intro").first()) ||
      "";

    let type_name = "";
    $panel.find(".pods span").each((_, el) => {
      const txt = safeText($(el));
      if (txt.startsWith("分类:")) type_name = txt.replace(/^分类:\s*/, "").trim();
    });

    const episodes = [];
    $("ul.chapter-list > li.chapter-item").each((idx, el) => {
      const $item = $(el);
      const numText = safeText($item.find("p").first());
      const title = safeText($item.find(".item-content .title").first()) || safeText($item.find(".title").first()) || `第${idx + 1}集`;
      const chapterIdx = Number(numText) || idx + 1;
      episodes.push({ name: title, playId: `${videoId}|${chapterIdx}` });
    });

    const finalEpisodes = uniqBy(episodes, item => item.playId);
    const out = {
      list: [{
        vod_id: String(videoId),
        vod_name,
        vod_pic,
        vod_content,
        type_id: "",
        type_name,
        vod_play_sources: [{ name: "TingYou", episodes: finalEpisodes }]
      }]
    };
    log("info", `detail.out listCount=${out.list.length} episodeCount=${finalEpisodes.length} vod=${j({ vod_id: String(videoId), vod_name, type_name, vod_pic })}`);
    return out;
  } catch (e) {
    log("error", `detail.error message=${e.message} stack=${e.stack || ""}`);
    return { list: [] };
  }
}

function parseNuxtSearchData(html) {
  const match = html.match(/<script[^>]*id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return [];
  try {
    const payload = JSON.parse(match[1]);
    const root = decodeNuxtValue(payload, 1);
    const data = root?.data || {};
    const keys = Object.keys(data);
    const targetKey = keys.find(k => /^search[-_]/i.test(k)) || keys.find(k => /search/i.test(k));
    const searchData = targetKey ? data[targetKey] : null;
    if (!searchData) return [];

    const buckets = [];
    if (Array.isArray(searchData)) buckets.push(...searchData);
    if (Array.isArray(searchData?.data)) buckets.push(...searchData.data);
    if (Array.isArray(searchData?.items)) buckets.push(...searchData.items);
    if (Array.isArray(searchData?.hotKeywords)) buckets.push(...searchData.hotKeywords);
    if (Array.isArray(searchData?.rankKeywords)) buckets.push(...searchData.rankKeywords);

    const results = [];
    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) return node.forEach(walk);
      if (typeof node !== 'object') return;
      if (node.id && (node.title || node.name) && (node.cover || node.cover_url || node.pic || node.pic_url)) {
        results.push(node);
      }
      for (const value of Object.values(node)) walk(value);
    };
    walk(searchData);
    return uniqBy(results, item => String(item.id || item.album_id || ''));
  } catch (e) {
    log("error", `search.nuxt.parse.error message=${e.message}`);
    return [];
  }
}

function mapSearchItem(item) {
  const vod_id = String(item?.id || item?.album_id || "");
  if (!vod_id) return null;
  return {
    vod_id,
    vod_name: String(item?.title || item?.name || `专辑${vod_id}`),
    vod_pic: normalizeUrl(item?.cover || item?.cover_url || item?.pic || item?.pic_url || ""),
    vod_remarks: String(item?.desc || item?.subtitle || item?.author || item?.teller || "").trim(),
    vod_content: String(item?.desc || item?.intro || item?.description || "").trim(),
    type_id: "",
    type_name: ""
  };
}

async function search(params, context) {
  const input = params || {};
  log("info", `search.in ${j(input)}`);
  try {
    const wd = String(input.keyword || "").trim();
    const page = Number(input.page || 1) || 1;
    if (!wd) {
      const out = { page: 1, pagecount: 1, total: 0, list: [] };
      log("info", `search.out ${j({ page: out.page, pagecount: out.pagecount, total: out.total, listCount: out.list.length, reason: 'emptyKeyword' })}`);
      return out;
    }

    const url = `${SITE}/search?q=${encodeURIComponent(wd)}`;
    log("info", `search.req ${url}`);
    const resp = await axios.get(url, { headers: getHeaders({}, { includeHardcoded: false }), timeout: 15000 });
    const html = typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
    log("info", `search.html length=${html.length}`);

    let list = parseNuxtSearchData(html).map(mapSearchItem).filter(Boolean);
    log("info", `search.nuxt.count ${list.length}`);

    if (!list.length) {
      const $ = cheerio.load(html);
      const domList = [];
      $("a[href*='/albums/']").each((_, el) => {
        const item = parseAlbumCard($, el, "", "");
        if (item) domList.push(item);
      });
      list = uniqBy(domList, item => item.vod_id);
      log("info", `search.dom.count ${list.length}`);
    }

    const filtered = uniqBy(list, item => item.vod_id).filter(item => {
      const hay = `${item.vod_name || ''} ${item.vod_remarks || ''} ${item.vod_content || ''}`.toLowerCase();
      return hay.includes(wd.toLowerCase());
    });

    const out = {
      page,
      pagecount: page,
      total: filtered.length,
      list: filtered
    };
    log("info", `search.out ${j({ page: out.page, pagecount: out.pagecount, total: out.total, listCount: out.list.length, samples: summarizeVodList(out.list) })}`);
    return out;
  } catch (e) {
    log("error", `search.error message=${e.message} stack=${e.stack || ""}`);
    return { page: 1, pagecount: 1, total: 0, list: [] };
  }
}

async function play(params, context) {
  const input = params || {};
  log("info", `play.in ${j(input)}`);
  try {
    const { playId, flag } = input;
    const [albumId, chapterIdx] = String(playId || "").split("|");
    const audioPage = `${SITE}/audios/${albumId}/${chapterIdx}`;

    let auth = process.env.TINGYOU_AUTH || process.env.TINGYOU_ANON_AUTH || "";
    let cookie = process.env.TINGYOU_COOKIE || process.env.TINGYOU_ANON_COOKIE || "";
    log("info", `play.headers.present ${j({ hasAuth: !!auth, hasCookie: !!cookie, albumId, chapterIdx, flag: flag || '' })}`);

    // 播放优先尝试新的匿名鉴权，避免长期硬编码匿名凭证过期后一直卡死。
    if (!process.env.TINGYOU_AUTH && !process.env.TINGYOU_ANON_AUTH) {
      try {
        const anon = await anonymousAuth();
        auth = anon.authToken || auth;
        cookie = anon.cookie || cookie;
        log("info", `play.auth.anonymous ${j({ hasAuth: !!auth, hasCookie: !!cookie, userId: anon.raw?.user_id ?? null }).slice(0, 500)}`);
      } catch (anonErr) {
        log("error", `play.auth.anonymous.error message=${anonErr.message} stack=${anonErr.stack || ""}`);
      }
    } else {
      log("info", `play.auth.anonymous.skip reason=useEnvCredentials`);
    }

    if (!auth) auth = HARDCODED_TINGYOU_ANON_AUTH || auth;
    if (!cookie) cookie = HARDCODED_TINGYOU_ANON_COOKIE || cookie;

    if (auth || cookie) {
      const reqBody = { album_id: Number(albumId), chapter_idx: Number(chapterIdx) };
      log("info", `play.req /api/play_token body=${j(reqBody)}`);
      try {
        const apiData = await apiPost("play_token", reqBody, {
          headers: {
            ...(auth ? { Authorization: auth } : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            Accept: "application/json",
            "X-Payload-Version": "2"
          }
        });
        log("info", `play.apiBody.sample ${j(apiData).slice(0, 1200)}`);

        const candidates = [];
        const walk = (node) => {
          if (!node) return;
          if (typeof node === "string") {
            if (/^https?:\/\//.test(node) && /(m3u8|mp3|m4a|aac|flac|wav|stream)(\?|$|\/)/i.test(node)) candidates.push(node);
            return;
          }
          if (Array.isArray(node)) return node.forEach(walk);
          if (typeof node === "object") {
            for (const [k, v] of Object.entries(node)) {
              if (typeof v === "string" && /^https?:\/\//.test(v) && /(url|src|play|audio|file|link|token)/i.test(k)) candidates.push(v);
              walk(v);
            }
          }
        };
        walk(apiData);
        const playUrl = candidates.find(Boolean);
        if (playUrl) {
          const out = {
            urls: [{ name: `直链 ${chapterIdx}`, url: playUrl }],
            flag: "play",
            parse: 0,
            header: getHeaders({ ...(auth ? { Authorization: auth } : {}), ...(cookie ? { Cookie: cookie } : {}) })
          };
          log("info", `play.out source=api ${j({ parse: out.parse, url: playUrl })}`);
          return out;
        }
        log("warn", `play.api.noDirectUrl fallback=sniff`);
      } catch (apiErr) {
        log("error", `play.api.error message=${apiErr.message} stack=${apiErr.stack || ""}`);
      }
    } else {
      log("warn", `play.api.skip missingAuthOrCookie`);
    }

    if (typeof OmniBox.sniffVideo === "function") {
      try {
        log("info", `play.fallback.sniff ${audioPage}`);
        const sniffed = await OmniBox.sniffVideo(audioPage, getHeaders());
        log("info", `play.fallback.sniff.result ${j(sniffed).slice(0, 1200)}`);
        if (sniffed) {
          if (typeof sniffed === "string") {
            return { urls: [{ name: `嗅探 ${chapterIdx}`, url: sniffed }], flag: "play", parse: 0, header: getHeaders() };
          }
          if (sniffed.url) {
            return {
              urls: [{ name: `嗅探 ${chapterIdx}`, url: sniffed.url }],
              flag: sniffed.flag || "play",
              parse: sniffed.parse ?? 0,
              header: sniffed.headers || sniffed.header || getHeaders()
            };
          }
          if (Array.isArray(sniffed.urls) && sniffed.urls.length) {
            return {
              urls: sniffed.urls,
              flag: sniffed.flag || "play",
              parse: sniffed.parse ?? 0,
              header: sniffed.headers || sniffed.header || getHeaders()
            };
          }
        }
      } catch (sniffErr) {
        log("error", `play.sniff.error message=${sniffErr.message} stack=${sniffErr.stack || ""}`);
      }
    } else {
      log("warn", `play.sniff.unavailable`);
    }

    const out = {
      urls: [{ name: `播放页 ${chapterIdx}`, url: audioPage }],
      flag: "play",
      parse: 1,
      header: getHeaders()
    };
    log("info", `play.out source=page ${j({ parse: out.parse, url: audioPage })}`);
    return out;
  } catch (e) {
    log("error", `play.error message=${e.message} stack=${e.stack || ""}`);
    return { urls: [], flag: "play", parse: 1 };
  }
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);
