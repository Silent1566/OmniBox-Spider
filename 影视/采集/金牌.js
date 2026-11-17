// @name 金牌
// @author 梦
// @description API 站：https://m.jiabaide.cn，支持首页、分类、搜索、详情与播放解析
// @version 1.1.5
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/金牌.js
// @dependencies crypto-js

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const CryptoJS = require("crypto-js");

const BASE_URL = process.env.JINPAI_HOST || "https://m.jiabaide.cn";
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36";
const APP_KEY = process.env.JINPAI_APP_KEY || "cb808529bae6b6be45ecfab29a4889bc";
const BASE_HEADERS = { "User-Agent": MOBILE_UA, Referer: `${BASE_URL}/` };

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

const CLASS_NAME_MAP = {
  typeList: ["type", "类型"],
  plotList: ["class", "剧情"],
  districtList: ["area", "地区"],
  languageList: ["lang", "语言"],
  yearList: ["year", "年份"],
  serialList: ["by", "排序"],
};

const SORT_VALUES = [
  { name: "最近更新", value: "1" },
  { name: "添加时间", value: "2" },
  { name: "人气高低", value: "3" },
  { name: "评分高低", value: "4" },
];

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function stripHtml(value) {
  return text(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function objToForm(obj = {}) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

function getSignedHeaders(obj = {}) {
  const t = String(Date.now());
  const signObj = { ...obj, key: APP_KEY, t };
  const objStr = objToForm(signObj);
  const md5 = CryptoJS.MD5(objStr).toString();
  const sign = CryptoJS.SHA1(md5).toString();
  return {
    ...BASE_HEADERS,
    t,
    sign,
  };
}

async function fetchJson(path, params = {}) {
  const qs = objToForm(params);
  const url = `${BASE_URL}${path}${qs ? `?${qs}` : ""}`;
  const headers = getSignedHeaders(params);
  await OmniBox.log("info", `[金牌][request] ${url}`);
  const res = await OmniBox.request(url, {
    method: "GET",
    headers,
    timeout: 20000,
  });
  if (!res || Number(res.statusCode) < 200 || Number(res.statusCode) >= 400) {
    throw new Error(`HTTP ${res?.statusCode || "unknown"} @ ${url}`);
  }
  const textBody = getBodyText(res);
  const data = JSON.parse(textBody || "{}");
  if (Number(data.code) && Number(data.code) !== 200) {
    throw new Error(data.msg || `API code=${data.code}`);
  }
  return data;
}

function mapVod(v = {}) {
  const pubdate = String(v.vodPubdate || "");
  const year = pubdate ? pubdate.split("-")[0] : "";
  return {
    vod_id: String(v.vodId || ""),
    vod_name: String(v.vodName || ""),
    vod_pic: String(v.vodPic || ""),
    vod_remarks: [String(v.vodRemarks || "").trim(), String(v.vodDoubanScore || "").trim()].filter(Boolean).join("_"),
    vod_year: year,
    type_id: String(v.typeId || ""),
    type_name: String(v.typeName || ""),
  };
}

function buildEpisodePlayId({ vodId = "", nid = "", episodeName = "", sourceName = "", title = "" } = {}) {
  return JSON.stringify({
    vodId: text(vodId),
    nid: text(nid),
    episodeName: text(episodeName),
    sourceName: text(sourceName),
    title: text(title),
  });
}

function parseEpisodePlayId(value = "") {
  const raw = text(value);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        vodId: text(parsed.vodId),
        nid: text(parsed.nid),
        episodeName: text(parsed.episodeName),
        sourceName: text(parsed.sourceName),
        title: text(parsed.title),
      };
    }
  } catch (_) {}

  const legacy = raw.match(/^(.*?)@(.*)$/);
  if (legacy) {
    return {
      vodId: text(legacy[1]),
      nid: text(legacy[2]),
      episodeName: "",
      sourceName: "金牌线路",
      title: "",
    };
  }
  return null;
}

function buildScrapeCandidate(episode = {}, vodName = "", vodId = "") {
  const rawName = text(episode.name || episode.episodeName || episode.vodRemarks || "");
  const fileId = text(episode.nid || episode.episodeId || episode.id || "");
  return {
    fid: fileId,
    name: rawName || `${text(vodName) || "金牌资源"}_${fileId || text(vodId || "")}`,
    file_name: rawName || `${text(vodName) || "金牌资源"}_${fileId || text(vodId || "")}`,
    file_size: 0,
    file_id: fileId,
    format_type: "video",
  };
}

function normalizeMappingFileId(value = "") {
  const raw = text(value);
  if (!raw) return "";
  const parts = raw.split("|").map((item) => text(item)).filter(Boolean);
  if (parts.length === 0) return raw;
  return parts[parts.length - 1];
}

function findEpisodeMapping(mappings = [], candidates = []) {
  const expected = Array.isArray(candidates)
    ? candidates.map((item) => text(item)).filter(Boolean)
    : [text(candidates)].filter(Boolean);
  if (!expected.length || !Array.isArray(mappings) || mappings.length === 0) return null;
  return mappings.find((mapping) => {
    const rawFileId = text(mapping?.fileId || "");
    const normalizedFileId = normalizeMappingFileId(rawFileId);
    return expected.includes(rawFileId) || expected.includes(normalizedFileId);
  }) || null;
}

function buildMappingPreview(mappings = [], limit = 5) {
  if (!Array.isArray(mappings) || mappings.length === 0) return "";
  return mappings
    .slice(0, limit)
    .map((mapping) => `${text(mapping?.fileId || "<empty>")}=>${text(mapping?.episodeName || mapping?.episodeNumber || "")}`)
    .join("; ");
}

function pickEpisodeNumber(...values) {
  for (const value of values) {
    if (Number.isFinite(value) && value > 0) return value;
    const raw = text(value);
    if (!raw) continue;
    const direct = Number(raw);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const match = raw.match(/^(?:第\s*)?(\d+)\s*(?:集|话|期)?(?:[\s.、:_-].*)?$/);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function formatEpisodeDisplayName(name = "", episodeNumber = null) {
  const rawName = text(name);
  const prefixed = rawName.match(/^(?:第\s*(\d+)\s*(?:集|话|期)\s*|(\d+)\s*[.、:_-]\s*)(.*)$/);
  const prefixedNumber = prefixed ? Number(prefixed[1] || prefixed[2]) : null;
  const finalNumber = Number.isFinite(episodeNumber) && episodeNumber > 0 ? episodeNumber : prefixedNumber;
  const episodeName = prefixed ? text(prefixed[3]) : rawName;

  if (!finalNumber) {
    return episodeName;
  }
  if (!episodeName) {
    return `第${finalNumber}集`;
  }
  return `第${finalNumber}集 ${episodeName}`;
}

function summarizeScrapeCandidates(candidates = [], limit = 5) {
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  return candidates
    .slice(0, limit)
    .map((item) => `${text(item?.file_id || item?.fid || "<empty>")}=>${text(item?.file_name || item?.name || "")}`)
    .join("; ");
}

function pickScrapeTitle(metadata = {}, fallbackVodName = "") {
  const scrapeData = metadata?.scrapeData || null;
  return text(scrapeData?.title || fallbackVodName);
}

function pickScrapePic(metadata = {}, fallbackPic = "") {
  const posterPath = text(metadata?.scrapeData?.posterPath || "");
  return posterPath ? `https://image.tmdb.org/t/p/w500${posterPath}` : text(fallbackPic);
}

function buildDanmakuFileName(metadata = {}, episodeMeta = {}, fallbackVodName = "") {
  const scrapeData = metadata?.scrapeData || null;
  const mapping = episodeMeta?.mapping || null;
  const episodeName = text(episodeMeta?.episodeName || mapping?.episodeName || "");
  const episodeNumber = Number.isFinite(mapping?.episodeNumber) ? mapping.episodeNumber : null;
  const seasonNumber = Number.isFinite(mapping?.seasonNumber) ? mapping.seasonNumber : 1;
  const scrapeType = text(metadata?.scrapeType || "").toLowerCase();
  const title = text(scrapeData?.title || fallbackVodName || episodeMeta?.title || "");
  const seasonAirYear = text(scrapeData?.seasonAirYear || scrapeData?.releaseDate || "").slice(0, 4);

  if (!title) return episodeName;
  if (scrapeType === "movie") return title;
  if (episodeNumber != null) {
    return `${title}.${seasonAirYear || ""}.S${String(seasonNumber || 1).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`.replace(/\.\.*/g, (match) => match.replace(/^\.+/, "."));
  }
  return episodeName ? `${title}.${episodeName}` : title;
}

function buildPlaybackUrlEntry(item = {}) {
  const url = text(item.url);
  if (!url) return null;
  return {
    name: text(item.name || item.resolution || item.title || "播放"),
    url,
  };
}

async function buildFilters() {
  const classes = [];
  const filters = {};

  const typeRes = await fetchJson("/api/mw-movie/anonymous/get/filer/type");
  const typeObj = typeRes.data || [];
  for (const item of typeObj) {
    classes.push({
      type_id: String(item.typeId),
      type_name: String(item.typeName),
    });
  }

  const filterRes = await fetchJson("/api/mw-movie/anonymous/v1/get/filer/list");
  const fDataObj = filterRes.data || {};

  for (const cls of classes) {
    const tid = cls.type_id;
    filters[tid] = [];

    for (const [rawKey, [key, name]] of Object.entries(CLASS_NAME_MAP)) {
      const values = [{ name: "全部", value: "" }];
      if (rawKey === "serialList") {
        values.push(...SORT_VALUES);
      } else {
        const items = (((fDataObj || {})[tid] || {})[rawKey]) || [];
        for (const it of items) {
          if (rawKey === "typeList") {
            values.push({ name: String(it.itemText || ""), value: String(it.itemValue || "") });
          } else {
            values.push({ name: String(it.itemText || ""), value: String(it.itemText || "") });
          }
        }
      }
      if (values.length > 1) {
        filters[tid].push({ key, name, value: values });
      }
    }
  }

  return { classes, filters };
}

async function home(params, context) {
  try {
    const { classes, filters } = await buildFilters();
    const homeRes = await fetchJson("/api/mw-movie/anonymous/home/hotSearch");
    const list = Array.isArray(homeRes.data) ? homeRes.data.map(mapVod) : [];
    await OmniBox.log("info", `[金牌][home] class=${classes.length} list=${list.length}`);
    return { class: classes, filters, list };
  } catch (e) {
    await OmniBox.log("error", `[金牌][home] ${e.message}`);
    return { class: [], filters: {}, list: [] };
  }
}

async function category(params, context) {
  try {
    const tid = String(params.categoryId || params.type_id || "1");
    const page = Math.max(1, parseInt(params.page || 1, 10));
    const f = params.filters || {};
    const body = {
      area: f.area || "",
      lang: f.lang || "",
      pageNum: String(page),
      pageSize: "30",
      sort: f.by || "1",
      sortBy: "1",
      type: f.type || "",
      type1: tid,
      v_class: f.class || "",
      year: f.year || "",
    };
    const res = await fetchJson("/api/mw-movie/anonymous/video/list", body);
    const list = (((res || {}).data || {}).list || []).map(mapVod);
    await OmniBox.log("info", `[金牌][category] tid=${tid} page=${page} list=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 30 ? 1 : 0),
      total: page * 30 + (list.length >= 30 ? 1 : 0),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[金牌][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const id = text(params.videoId || params.id || "");
    if (!id) return { list: [] };

    const res = await fetchJson("/api/mw-movie/anonymous/video/detail", { id });
    const kvod = res.data || {};
    if (!Object.keys(kvod).length) return { list: [] };

    const kid = text(kvod.vodId || id);
    const sourceName = text(kvod.sourceName || "金牌线路");
    const rawEpisodeList = Array.isArray(kvod.episodeList) ? kvod.episodeList : [];
    const scrapeCandidates = rawEpisodeList.map((it) => buildScrapeCandidate(it, kvod.vodName, kid)).filter((it) => text(it.file_name));

    let scrapeMetadata = null;
    if (scrapeCandidates.length > 0) {
      await OmniBox.log("info", `[金牌][detail] 开始统一刮削 kid=${kid} candidates=${scrapeCandidates.length} preview=${summarizeScrapeCandidates(scrapeCandidates) || "<empty>"}`);
      try {
        const scrapeResult = await OmniBox.processScraping(kid, text(kvod.vodName), text(kvod.vodName), scrapeCandidates);
        await OmniBox.log("info", `[金牌][detail] processScraping 完成 kid=${kid} result=${JSON.stringify(scrapeResult || {}).slice(0, 300)}`);
        scrapeMetadata = await OmniBox.getScrapeMetadata(kid);
        await OmniBox.log("info", `[金牌][detail] 读取刮削元数据完成 kid=${kid} hasScrapeData=${!!scrapeMetadata?.scrapeData} mappings=${Array.isArray(scrapeMetadata?.videoMappings) ? scrapeMetadata.videoMappings.length : 0}`);
      } catch (error) {
        await OmniBox.log("warn", `[金牌][detail] 刮削失败 kid=${kid} error=${error.message}`);
      }
    } else {
      await OmniBox.log("warn", `[金牌][detail] 未提取到可刮削分集 kid=${kid}`);
    }

    const mappings = Array.isArray(scrapeMetadata?.videoMappings) ? scrapeMetadata.videoMappings : [];
    await OmniBox.log("info", `[金牌][detail] mappingPreview kid=${kid} preview=${buildMappingPreview(mappings) || "<empty>"}`);
    const episodes = rawEpisodeList.map((it, index) => {
      const nid = text(it.nid);
      const mapping = findEpisodeMapping(mappings, [nid]);
      const episodeNumber = pickEpisodeNumber(mapping?.episodeNumber, it.episodeNumber, it.name, index + 1);
      const episodeName = formatEpisodeDisplayName(mapping?.episodeName || it.name || `第${episodeNumber || nid || "1"}集`, episodeNumber);
      return {
        name: episodeName,
        playId: buildEpisodePlayId({
          vodId: kid,
          nid,
          episodeName,
          sourceName,
          title: text(kvod.vodName),
        }),
      };
    }).filter((it) => text(it.playId));

    const scrapeTitle = pickScrapeTitle(scrapeMetadata, kvod.vodName);
    const scrapePic = pickScrapePic(scrapeMetadata, kvod.vodPic);
    const scrapeContent = stripHtml(scrapeMetadata?.scrapeData?.overview || kvod.vodContent || "简介");
    const scrapeYear = text((scrapeMetadata?.scrapeData?.releaseDate || kvod.vodYear || "").slice?.(0, 4) || kvod.vodYear || "");
    const scrapeActors = text(
      kvod.vodActor || scrapeMetadata?.scrapeData?.credits?.cast?.slice?.(0, 8).map?.((x) => x.name).join(",") || "主演"
    );
    const scrapeDirector = text(
      kvod.vodDirector || scrapeMetadata?.scrapeData?.credits?.crew?.filter?.((x) => x.job === "Director").map?.((x) => x.name).join(",") || "导演"
    );

    await OmniBox.log("info", `[金牌][detail] kid=${kid} finalEpisodes=${episodes.length} hasScrape=${!!scrapeMetadata?.scrapeData}`);

    return {
      list: [{
        vod_id: kid,
        vod_name: scrapeTitle || text(kvod.vodName),
        vod_pic: scrapePic,
        type_name: text(kvod.vodClass || "类型"),
        vod_remarks: text(kvod.vodRemarks || "状态"),
        vod_year: scrapeYear || text(kvod.vodYear || "0000"),
        vod_area: text(kvod.vodArea || "地区"),
        vod_lang: text(kvod.vodLang || "语言"),
        vod_director: scrapeDirector,
        vod_actor: scrapeActors,
        vod_content: scrapeContent,
        vod_play_sources: episodes.length ? [{ name: sourceName, episodes }] : [],
      }],
    };
  } catch (e) {
    await OmniBox.log("error", `[金牌][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    const page = Math.max(1, parseInt(params.page || 1, 10));
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const body = { keyword, pageNum: String(page), pageSize: "30" };
    const res = await fetchJson("/api/mw-movie/anonymous/video/searchByWordPageable", body);
    const list = (((res || {}).data || {}).list || []).map(mapVod);
    await OmniBox.log("info", `[金牌][search] keyword=${keyword} page=${page} list=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 30 ? 1 : 0),
      total: page * 30 + (list.length >= 30 ? 1 : 0),
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[金牌][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const flag = text(params.flag || "");
    const rawPlayId = text(params.playId || params.id || "");
    const playMeta = parseEpisodePlayId(rawPlayId);
    if (!playMeta?.vodId || !playMeta?.nid) {
      throw new Error("播放参数格式错误，期望包含 vodId 与 nid");
    }

    const sid = playMeta.vodId;
    const nid = playMeta.nid;
    const episodeName = text(playMeta.episodeName || params.episodeName || "");
    const title = text(playMeta.title || params.title || "");
    const body = { clientType: "3", id: sid, nid };

    await OmniBox.log("info", `[金牌][play] start sid=${sid} nid=${nid} title=${title} episode=${episodeName}`);

    const playInfoPromise = fetchJson("/api/mw-movie/anonymous/v2/video/episode/url", body);
    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
      };
      try {
        const metadata = await OmniBox.getScrapeMetadata(sid);
        const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
        const mapping = findEpisodeMapping(mappings, [nid, `${sid}|${nid}`]);
        await OmniBox.log("info", `[金牌][play] 元数据读取完成 sid=${sid} mappings=${mappings.length} matched=${!!mapping} expected=${nid} preview=${buildMappingPreview(mappings) || "<empty>"}`);
        if (!mapping && mappings.length > 0) {
          await OmniBox.log("info", `[金牌][play] 首条映射原始数据 sample=${JSON.stringify(mappings.slice(0, 2)).slice(0, 400)}`);
        }
        const fileName = buildDanmakuFileName(metadata, { mapping, episodeName, title }, title);
        await OmniBox.log("info", `[金牌][play] 弹幕匹配文件名 fileName=${fileName}`);
        if (fileName) {
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
          result.danmakuList = Array.isArray(matchedDanmaku) ? matchedDanmaku : [];
          await OmniBox.log("info", `[金牌][play] 弹幕匹配完成 count=${result.danmakuList.length}`);
        }
      } catch (error) {
        await OmniBox.log("warn", `[金牌][play] 元数据/弹幕链路失败: ${error.message}`);
      }
      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);
    if (playInfoResult.status !== "fulfilled") {
      throw new Error(playInfoResult.reason?.message || "无法获取播放地址");
    }

    const playData = playInfoResult.value;
    const list = (((playData || {}).data || {}).list || []);
    const urls = list.map(buildPlaybackUrlEntry).filter(Boolean);
    if (!urls.length) {
      throw new Error("播放接口未返回有效地址");
    }

    let danmakuList = [];
    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
    } else if (metadataResult.status === "rejected") {
      await OmniBox.log("warn", `[金牌][play] metadataPromise rejected: ${metadataResult.reason?.message || metadataResult.reason}`);
    }

    const header = { "User-Agent": MOBILE_UA };
    await OmniBox.log("info", `[金牌][play] success sid=${sid} nid=${nid} urls=${urls.length} danmaku=${danmakuList.length}`);
    return {
      parse: 0,
      urls,
      header,
      danmaku: danmakuList};
  } catch (e) {
    await OmniBox.log("error", `[金牌][play] ${e.message}`);
    return { parse: 0, urls: [], header: {}, danmaku: [] };
  }
}
