// @name 爱奇艺资源站(MacCMS API)-增强版
// @author OpenClaw Bingbu + 梦
// @description 刮削：支持，弹幕：支持，嗅探：支持，广告：菠菜
// @dependencies: axios
// @version 1.1.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/爱奇艺资源站.js

/**
 * ============================================================================
 * 爱奇艺资源站 OmniBox 站源（增强版）
 * 站点: https://iqiyizyapi.com
 * 接口: /api.php/provide/vod
 *
 * 新增能力：
 * - 支持 TMDB 刮削（detail 阶段触发 processScraping）
 * - 支持弹幕匹配（play 阶段通过 getDanmakuByFileName 获取）
 * - 保留原有：一级主类聚合、二级筛选、分类屏蔽、嗅探兼容
 *
 * 分类屏蔽配置：
 * - 环境变量 IQIYIZY_BLOCKED_MAIN
 * - 例："39" 或 "39,9"（按一级分类ID）
 * ============================================================================
 */

const axios = require("axios");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

const HOST = "https://iqiyizy.cc";
const API = `${HOST}/api.php/provide/vod`;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

const MAIN_CATEGORIES = [
  { type_id: "7", type_name: "电影" },
  { type_id: "8", type_name: "连续剧" },
  { type_id: "9", type_name: "综艺" },
  { type_id: "40", type_name: "动漫" },
  { type_id: "39", type_name: "伦理片" }
];

const MAIN_CHILDREN_FALLBACK = {
  "7": [
    { type_id: "5", type_name: "动漫电影" },
    { type_id: "10", type_name: "动作片" },
    { type_id: "11", type_name: "喜剧片" },
    { type_id: "12", type_name: "爱情片" },
    { type_id: "13", type_name: "科幻片" },
    { type_id: "14", type_name: "恐怖片" },
    { type_id: "15", type_name: "剧情片" },
    { type_id: "16", type_name: "战争片" },
    { type_id: "17", type_name: "惊悚片" },
    { type_id: "18", type_name: "家庭片" },
    { type_id: "19", type_name: "古装片" },
    { type_id: "20", type_name: "历史片" },
    { type_id: "21", type_name: "悬疑片" },
    { type_id: "22", type_name: "犯罪片" },
    { type_id: "23", type_name: "灾难片" },
    { type_id: "24", type_name: "记录片" },
    { type_id: "25", type_name: "短片" }
  ],
  "8": [
    { type_id: "26", type_name: "国产剧" },
    { type_id: "27", type_name: "香港剧" },
    { type_id: "28", type_name: "韩国剧" },
    { type_id: "29", type_name: "欧美剧" },
    { type_id: "30", type_name: "台湾剧" },
    { type_id: "31", type_name: "日本剧" },
    { type_id: "32", type_name: "海外剧" },
    { type_id: "33", type_name: "泰国剧" },
    { type_id: "38", type_name: "短剧" }
  ],
  "9": [
    { type_id: "34", type_name: "大陆综艺" },
    { type_id: "35", type_name: "港台综艺" },
    { type_id: "36", type_name: "日韩综艺" },
    { type_id: "37", type_name: "欧美综艺" }
  ],
  "40": [
    { type_id: "1", type_name: "国产动漫" },
    { type_id: "2", type_name: "日韩动漫" },
    { type_id: "3", type_name: "欧美动漫" },
    { type_id: "4", type_name: "港台动漫" },
    { type_id: "6", type_name: "里番动漫" }
  ],
  "39": []
};

const DEFAULT_BLOCKED_MAIN = ["39"];

const http = axios.create({
  timeout: 20000,
  headers: {
    "User-Agent": UA,
    "Accept": "application/json,text/plain,*/*",
    "Referer": `${HOST}/`
  },
  validateStatus: () => true
});

const CLASS_CACHE = {
  list: [],
  mapById: {},
  childMap: {}
};

function safeJson(input, fallback = {}) {
  if (!input) return fallback;
  if (typeof input === "object") return input;
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
}

function text(v) {
  return String(v == null ? "" : v).trim();
}

function fixUrl(url) {
  const u = text(url);
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return `https:${u}`;
  if (u.startsWith("/")) return `${HOST}${u}`;
  return `${HOST}/${u}`;
}

function b64Encode(obj) {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
}

function b64Decode(str) {
  try {
    return JSON.parse(Buffer.from(String(str || ""), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

function getBlockedMainSet() {
  const env = text(process.env.IQIYIZY_BLOCKED_MAIN);
  const raw = env ? env.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_BLOCKED_MAIN;
  return new Set(raw);
}

function updateClassCache(classList) {
  const classes = Array.isArray(classList)
    ? classList.map((c) => ({
        type_id: text(c.type_id),
        type_pid: text(c.type_pid),
        type_name: text(c.type_name)
      })).filter((c) => c.type_id && c.type_name)
    : [];

  if (!classes.length) return;

  const mapById = {};
  const childMap = {};
  classes.forEach((c) => {
    mapById[c.type_id] = c;
    const pid = c.type_pid || "0";
    if (!childMap[pid]) childMap[pid] = [];
    childMap[pid].push(c);
  });

  CLASS_CACHE.list = classes;
  CLASS_CACHE.mapById = mapById;
  CLASS_CACHE.childMap = childMap;
}

async function fetchApi(params = {}) {
  try {
    const res = await http.get(API, { params });
    const data = safeJson(res.data, {});
    if (Array.isArray(data.class)) updateClassCache(data.class);
    return data;
  } catch (error) {
    await OmniBox.log("warn", `fetchApi 失败: ${error.message}`);
    return {};
  }
}

async function ensureClassCache() {
  if (Array.isArray(CLASS_CACHE.list) && CLASS_CACHE.list.length > 0) return;
  await fetchApi({ ac: "list", pg: 1 });
}

function resolveMainTypeId(typeId, fallbackMain = "") {
  const t = text(typeId);
  if (!t) return text(fallbackMain);
  if (MAIN_CATEGORIES.some((m) => m.type_id === t)) return t;

  const mapById = CLASS_CACHE.mapById || {};
  let cur = mapById[t];
  let guard = 0;
  while (cur && guard < 10) {
    guard += 1;
    if (MAIN_CATEGORIES.some((m) => m.type_id === cur.type_id)) return cur.type_id;
    if (!cur.type_pid || cur.type_pid === cur.type_id) break;
    cur = mapById[cur.type_pid];
  }

  return text(fallbackMain);
}

function isMainBlocked(mainTypeId) {
  return getBlockedMainSet().has(text(mainTypeId));
}

function mapListItem(item) {
  const typeId = text(item.type_id || "");
  const mainTypeId = resolveMainTypeId(typeId, item.type_id_1 || "");
  return {
    vod_id: text(item.vod_id),
    vod_name: text(item.vod_name),
    vod_pic: fixUrl(item.vod_pic),
    vod_remarks: text(item.vod_remarks || item.type_name || ""),
    type_id: typeId,
    type_name: text(item.type_name || ""),
    main_type_id: mainTypeId,
    vod_year: text(item.vod_year || ""),
    vod_douban_score: text(item.vod_douban_score || "")
  };
}

function buildResourceId(vodId) {
  // 注意：OmniBox 刮削系统要求 resourceId 直接使用裸 videoId，不能加前缀
  // 参考瓜子.js: processScraping(videoId, ...) / getScrapeMetadata(videoId)
  return text(vodId);
}

function buildEpisodeFileId(vodId, flag, epName, idx) {
  // fileId 格式与瓜子.js 保持一致: `${videoId}#${index}`
  // index 从 1 开始，多线路时加上 flag 区分，避免重复
  return `${text(vodId)}#${text(flag)}#${idx}`;
}

function parsePlaySources(vodPlayFrom, vodPlayUrl, vodId, vodName = "") {
  // 这里做两件事：
  // 1) 把资源站返回的旧格式 vod_play_from / vod_play_url 转成 OmniBox 推荐的新格式 vod_play_sources
  // 2) 同时构造一份 videoFiles，供 processScraping(resourceId, keyword, resourceName, videoFiles) 使用
  //
  // 为什么要额外构造 videoFiles？
  // 因为本源不是网盘源，没有天然的 fileId，刮削系统依赖 fileId 把“某一集”映射到 TMDB 的某一集。
  // 所以这里人为构造一个稳定 fileId：iqiyizy:{vodId}:{flag}:{idx}:{epName}
  // detail 阶段用它去刮削，play 阶段再把同一个 fileId 塞回 playId，这样就能在播放时找回映射关系。
  const fromArr = text(vodPlayFrom).split("$$$").map((s) => s.trim()).filter(Boolean);
  const urlArr = text(vodPlayUrl).split("$$$").map((s) => s.trim()).filter(Boolean);
  const sourceCount = Math.max(fromArr.length, urlArr.length);
  const sources = [];
  const videoFiles = [];

  for (let i = 0; i < sourceCount; i += 1) {
    const flag = fromArr[i] || `线路${i + 1}`;
    const group = urlArr[i] || "";
    const episodesRaw = group.split("#").map((s) => s.trim()).filter(Boolean);

    const episodes = episodesRaw.map((item, idx) => {
      let epName = `第${idx + 1}集`;
      let epUrl = item;
      const cut = item.indexOf("$");
      if (cut > -1) {
        epName = text(item.slice(0, cut)) || epName;
        epUrl = text(item.slice(cut + 1));
      }

      const fileId = buildEpisodeFileId(vodId, flag, epName, idx + 1);
      videoFiles.push({
        fid: fileId,
        file_id: fileId,
        file_name: epName,
        name: epName,
        format_type: "video"
      });

      const playId = b64Encode({
        resourceId: buildResourceId(vodId),
        vodId: text(vodId),
        name: vodName,
        flag,
        epName,
        episodeIndex: idx + 1,
        fileId,
        url: epUrl
      });

      return { name: epName, playId, _fileId: fileId };
    });

    if (episodes.length > 0) {
      sources.push({ name: flag, episodes });
    }
  }

  return { sources, videoFiles };
}

async function enrichPlaySourcesWithMetadata(playSources, resourceId) {
  // 这里只负责“把刮削结果回填到剧集列表里”，不负责触发刮削。
  // 典型调用顺序：
  //   detail -> processScraping(...) -> getScrapeMetadata(...) -> enrichPlaySourcesWithMetadata(...)
  //
  // 注意：即使这里成功拿到了 metadata，页面上也不一定会“看起来变化很大”。
  // 因为前端主要展示 vod_name / vod_pic / 简介 / 剧集名称等字段；
  // 如果站点原始数据已经比较完整，或者前端没有展示 enrich 字段，就会产生“刮削似乎没生效”的错觉。
  // 所以这里额外加详细日志，帮助判断到底是：
  // - processScraping 没跑到
  // - getScrapeMetadata 没拿到数据
  // - videoMappings 没匹配上 fileId
  // - 还是拿到了但前端展示不明显
  try {
    await OmniBox.log("info", `[刮削回填] 开始读取元数据 resourceId=${resourceId}`);
    const metadata = await OmniBox.getScrapeMetadata(resourceId);
    const scrapeData = metadata?.scrapeData || null;
    const videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];

    await OmniBox.log(
      "info",
      `[刮削回填] 元数据读取完成 resourceId=${resourceId}, hasScrapeData=${!!scrapeData}, mappingCount=${videoMappings.length}, playSourceCount=${playSources.length}`
    );

    if (scrapeData) {
      await OmniBox.log(
        "info",
        `[刮削回填] scrapeData 摘要 title=${text(scrapeData.title)}, releaseDate=${text(scrapeData.releaseDate)}, voteAverage=${text(scrapeData.voteAverage)}`
      );
    }

    if (!playSources.length || !videoMappings.length) {
      await OmniBox.log(
        "warn",
        `[刮削回填] 没有可回填的数据 playSources=${playSources.length}, videoMappings=${videoMappings.length}`
      );
      return { playSources, scrapeData, metadata };
    }

    const mappingMap = new Map();
    for (const m of videoMappings) {
      if (m?.fileId) mappingMap.set(String(m.fileId), m);
    }

    let matchedCount = 0;

    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        const lookupKey = String(ep._fileId || "");
        const mapping = mappingMap.get(lookupKey);
        if (!mapping) {
          await OmniBox.log("info", `[刮削回填] 未命中映射 source=${source.name}, episode=${ep.name}, fileId=${lookupKey}`);
          continue;
        }

        matchedCount += 1;
        await OmniBox.log(
          "info",
          `[刮削回填] 命中映射 source=${source.name}, oldEpisode=${ep.name}, fileId=${lookupKey}, season=${mapping.seasonNumber ?? ""}, episode=${mapping.episodeNumber ?? ""}, tmdbEpisodeName=${text(mapping.episodeName)}`
        );

        if (mapping.episodeName) {
          const epName = mapping.episodeNumber + "." + mapping.episodeName;
          ep.episodeName = epName;
        }
        if (mapping.episodeOverview) ep.episodeOverview = mapping.episodeOverview;
        if (mapping.episodeAirDate) ep.episodeAirDate = mapping.episodeAirDate;
        if (mapping.episodeStillPath) ep.episodeStillPath = mapping.episodeStillPath;
        if (mapping.episodeVoteAverage != null) ep.episodeVoteAverage = mapping.episodeVoteAverage;
        if (mapping.episodeRuntime != null) ep.episodeRuntime = mapping.episodeRuntime;
        if (mapping.seasonNumber != null) ep._seasonNumber = mapping.seasonNumber;
        if (mapping.episodeNumber != null) ep._episodeNumber = mapping.episodeNumber;
        if (mapping.episodeName) {
          const epName = mapping.episodeNumber + "." + mapping.episodeName;
          ep.name = epName;
        }
      }

      const hasOrdering = (source.episodes || []).some((ep) => ep._episodeNumber != null);
      if (hasOrdering) {
        await OmniBox.log("info", `[刮削回填] 线路 ${source.name} 检测到剧集排序信息，按 season/episode 重排`);
        source.episodes.sort((a, b) => {
          const sa = Number(a._seasonNumber || 0);
          const sb = Number(b._seasonNumber || 0);
          if (sa !== sb) return sa - sb;
          return Number(a._episodeNumber || 0) - Number(b._episodeNumber || 0);
        });
      }

      for (const ep of source.episodes || []) {
        delete ep._seasonNumber;
        delete ep._episodeNumber;
        delete ep._fileId;
      }
    }

    await OmniBox.log("info", `[刮削回填] 完成 resourceId=${resourceId}, matchedEpisodeCount=${matchedCount}`);
    return { playSources, scrapeData, metadata };
  } catch (error) {
    await OmniBox.log("warn", `获取刮削元数据失败: ${error.message}`);
    for (const source of playSources) {
      for (const ep of source.episodes || []) delete ep._fileId;
    }
    return { playSources, scrapeData: null, metadata: null };
  }
}

function buildMainClasses() {
  return MAIN_CATEGORIES.filter((c) => !isMainBlocked(c.type_id));
}

function buildFiltersForMain(mainTypeId) {
  const key = text(mainTypeId);
  const cacheChildren = (CLASS_CACHE.childMap?.[key] || [])
    .filter((c) => c.type_id !== key)
    .map((c) => ({ type_id: c.type_id, type_name: c.type_name }));
  const children = (cacheChildren.length ? cacheChildren : (MAIN_CHILDREN_FALLBACK[key] || []))
    .sort((a, b) => String(a.type_id).localeCompare(String(b.type_id)));
  if (!children.length) return [];
  return [{
    key: "subtype",
    name: "子分类",
    init: "",
    value: [{ name: "全部", value: "" }, ...children.map((c) => ({ name: c.type_name, value: c.type_id }))]
  }];
}

function getChildTypeIds(mainTypeId) {
  const key = text(mainTypeId);
  const cacheChildren = (CLASS_CACHE.childMap?.[key] || [])
    .filter((c) => c.type_id && c.type_id !== key)
    .map((c) => c.type_id);
  if (cacheChildren.length) return cacheChildren;
  return (MAIN_CHILDREN_FALLBACK[key] || []).map((c) => c.type_id);
}

async function fetchMainAllByChildren(mainTypeId, page) {
  const childTypeIds = getChildTypeIds(mainTypeId);
  if (!childTypeIds.length) {
    const direct = await fetchApi({ ac: "list", t: text(mainTypeId), pg: page });
    const directList = (Array.isArray(direct.list) ? direct.list : [])
      .map(mapListItem)
      .filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
    return {
      list: directList,
      page: Number(direct.page || page || 1),
      pagecount: Number(direct.pagecount || page || 1),
      total: Number(direct.total || directList.length || 0),
      limit: Number(direct.limit || 20)
    };
  }

  const results = await Promise.all(childTypeIds.map((tid) => fetchApi({ ac: "list", t: tid, pg: page })));
  const mergedRaw = [];
  let total = 0;
  let pagecount = 0;
  let limit = 20;

  results.forEach((data) => {
    const arr = Array.isArray(data.list) ? data.list : [];
    mergedRaw.push(...arr);
    total += Number(data.total || 0);
    pagecount = Math.max(pagecount, Number(data.pagecount || 0));
    if (Number(data.limit || 0) > 0) limit = Number(data.limit);
  });

  const seen = new Set();
  const merged = mergedRaw
    .map(mapListItem)
    .filter((it) => !isMainBlocked(it.main_type_id || it.type_id))
    .filter((it) => {
      if (!it.vod_id || seen.has(it.vod_id)) return false;
      seen.add(it.vod_id);
      return true;
    })
    .sort((a, b) => Number(b.vod_id || 0) - Number(a.vod_id || 0));

  return { list: merged, page, pagecount: pagecount || page, total: total || merged.length, limit };
}

function getFilterSubtype(params) {
  return text(params?.filters?.subtype || params?.filter?.subtype || params?.extend?.subtype || params?.ext?.subtype || "");
}

function isAllSelection(value) {
  const v = text(value).toLowerCase();
  return !v || v === "0" || v === "-1" || v === "all" || v === "全部";
}

function inferTypeName(mainTypeId, rawTypeName) {
  const hit = MAIN_CATEGORIES.find((m) => m.type_id === text(mainTypeId));
  return hit?.type_name || text(rawTypeName || "");
}

function buildScrapeKeyword(item) {
  // 只传片名，不加年份；加年份容易干扰 TMDB 搜索（如"你好1983 2026"）
  // 参考瓜子.js: processScraping(videoId, vod.vod_name, vod.vod_name, ...)
  return text(item.vod_name);
}

function buildDanmakuFileName(scrapeData, mapping, fallbackTitle, fallbackEpName) {
  if (!scrapeData) return `${fallbackTitle || ""} ${fallbackEpName || ""}`.trim();
  const title = text(scrapeData.title || fallbackTitle || "");
  const scrapeType = text(scrapeData.scrapeType || scrapeData.type || "").toLowerCase();
  const seasonAirYear = text(scrapeData.seasonAirYear || scrapeData.releaseDate || "").slice(0, 4);

  if (mapping && (mapping.episodeNumber != null || mapping.seasonNumber != null || scrapeType === "tv")) {
    const season = Number(mapping?.seasonNumber || 1);
    const episode = Number(mapping?.episodeNumber || 1);
    const yearPart = seasonAirYear ? `.${seasonAirYear}` : "";
    return `${title}${yearPart}.S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
  }

  return title || `${fallbackTitle || ""} ${fallbackEpName || ""}`.trim();
}

async function home(params, context) {
  const data = await fetchApi({ ac: "list", pg: 1 });
  const classes = buildMainClasses();
  const list = (Array.isArray(data.list) ? data.list : []).map(mapListItem).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
  const filters = {};
  classes.forEach((m) => {
    const f = buildFiltersForMain(m.type_id);
    if (f.length) filters[m.type_id] = f;
  });
  return { class: classes, filters, list };
}

async function category(params, context) {
  const page = parseInt(params?.page || "1", 10) || 1;
  const mainTypeId = text(params?.categoryId || params?.type_id || "");
  const subtype = getFilterSubtype(params);
  await ensureClassCache();

  if (isMainBlocked(mainTypeId)) {
    return { list: [], page, pagecount: 0, total: 0, limit: 20 };
  }

  let result;
  if (!isAllSelection(subtype)) {
    const data = await fetchApi({ ac: "list", t: subtype, pg: page });
    const list = (Array.isArray(data.list) ? data.list : []).map(mapListItem).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
    result = {
      list,
      page: Number(data.page || page || 1),
      pagecount: Number(data.pagecount || page || 1),
      total: Number(data.total || list.length || 0),
      limit: Number(data.limit || 20)
    };
  } else {
    result = await fetchMainAllByChildren(mainTypeId, page);
  }

  const f = buildFiltersForMain(mainTypeId);
  if (f.length && page === 1) result.filters = f;
  return result;
}

async function search(params, context) {
  const keyword = text(params?.keyword || params?.wd || "");
  const page = parseInt(params?.page || "1", 10) || 1;
  if (!keyword) return { list: [], page: 1, pagecount: 0, total: 0 };

  const data = await fetchApi({ ac: "list", wd: keyword, pg: page });
  const list = (Array.isArray(data.list) ? data.list : []).map(mapListItem).filter((it) => !isMainBlocked(it.main_type_id || it.type_id));
  return {
    list,
    page: Number(data.page || page || 1),
    pagecount: Number(data.pagecount || page || 1),
    total: Number(data.total || list.length || 0),
    limit: Number(data.limit || 20)
  };
}

async function detail(params, context) {
  try {
    const videoId = text(params?.videoId || "");
    if (!videoId) return { list: [] };

    await OmniBox.log("info", `[detail] 开始处理 videoId=${videoId}`);
    const data = await fetchApi({ ac: "detail", ids: videoId });
    const item = Array.isArray(data.list) && data.list.length ? data.list[0] : null;
    if (!item) {
      await OmniBox.log("warn", `[detail] 未获取到详情数据 videoId=${videoId}`);
      return { list: [] };
    }

    const mainTypeId = resolveMainTypeId(item.type_id, item.type_id_1 || "");
    if (isMainBlocked(mainTypeId)) {
      await OmniBox.log("warn", `[detail] 命中屏蔽主类 mainTypeId=${mainTypeId}, videoId=${videoId}`);
      return { list: [] };
    }

    const resourceId = buildResourceId(videoId);
    const { sources, videoFiles } = parsePlaySources(item.vod_play_from, item.vod_play_url, videoId, item.vod_name);

    await OmniBox.log(
      "info",
      `[detail] 播放数据已解析 videoId=${videoId}, resourceId=${resourceId}, sourceCount=${sources.length}, videoFileCount=${videoFiles.length}, vodName=${text(item.vod_name)}`
    );

    let scrapeData = null;
    if (videoFiles.length > 0) {
      const scrapeKeyword = buildScrapeKeyword(item);
      await OmniBox.log(
        "info",
        `[detail] 准备执行刮削 resourceId=${resourceId}, keyword=${scrapeKeyword}, resourceName=${text(item.vod_name)}, firstFile=${text(videoFiles[0]?.file_name)}`
      );
      try {
        // processScraping 在采集源中是同步阻塞的，等刮削完成后才返回
        // 调用完成后可立即读取元数据，不需要轮询
        const scrapingResult = await OmniBox.processScraping(resourceId, scrapeKeyword, text(item.vod_name), videoFiles);
        await OmniBox.log("info", `[detail] processScraping 调用完成 resourceId=${resourceId}, result=${JSON.stringify(scrapingResult || {}).substring(0, 300)}`);
      } catch (error) {
        await OmniBox.log("warn", `[detail] processScraping 失败 resourceId=${resourceId}, error=${error.message}`);
      }
    } else {
      await OmniBox.log("warn", `[detail] 未解析出任何 videoFiles，跳过刮削 resourceId=${resourceId}`);
    }

    const enriched = await enrichPlaySourcesWithMetadata(sources, resourceId);
    const playSources = enriched.playSources;
    scrapeData = enriched.scrapeData;

    await OmniBox.log(
      "info",
      `[detail] 刮削回填结束 resourceId=${resourceId}, hasScrapeData=${!!scrapeData}, finalSourceCount=${playSources.length}, totalEpisodeCount=${playSources.reduce((n, s) => n + ((s.episodes || []).length), 0)}`
    );

    const vod = {
      vod_id: text(item.vod_id),
      vod_name: text(scrapeData?.title || item.vod_name),
      vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : fixUrl(item.vod_pic),
      vod_remarks: text(item.vod_remarks),
      vod_year: text((scrapeData?.releaseDate || item.vod_year || "").slice?.(0, 4) || item.vod_year || ""),
      vod_area: text(item.vod_area),
      vod_lang: text(item.vod_lang),
      vod_director: text(item.vod_director || scrapeData?.credits?.crew?.filter?.((x) => x.job === "Director").map?.((x) => x.name).join(",") || ""),
      vod_actor: text(item.vod_actor || scrapeData?.credits?.cast?.slice?.(0, 8).map?.((x) => x.name).join(",") || ""),
      vod_class: text(item.vod_class || inferTypeName(mainTypeId, item.type_name || "")),
      vod_content: text(scrapeData?.overview || item.vod_content).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
      vod_play_sources: playSources,
      vod_douban_score: text(scrapeData?.voteAverage != null ? Number(scrapeData.voteAverage).toFixed(1) : (item.vod_douban_score || ""))
    };

    await OmniBox.log(
      "info",
      `[detail] 最终返回 videoId=${videoId}, vodName=${vod.vod_name}, vodYear=${vod.vod_year}, vodScore=${vod.vod_douban_score}, hasPoster=${!!vod.vod_pic}, hasContent=${!!vod.vod_content}`
    );

    return { list: [vod] };
  } catch (error) {
    await OmniBox.log("error", `detail 失败: ${error.message}`);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = text(params?.playId || "");
    const meta = b64Decode(playId);
    const url = fixUrl(meta.url || "");
    const resourceId = text(meta.resourceId || "");
    const fileId = text(meta.fileId || "");
    const vodId = text(meta.vodId || "");
    const title = text(meta.name || params?.title || "");
    const epName = text(meta.epName || "");

    await OmniBox.log(
      "info",
      `[play] 开始处理 vodId=${vodId}, resourceId=${resourceId}, fileId=${fileId}, title=${title}, epName=${epName}, hasUrl=${!!url}`
    );

    if (!url) {
      await OmniBox.log("warn", `[play] playId 无法解出有效 URL, playId=${playId.slice(0, 120)}`);
      return {
        urls: [],
        parse: 1,
        header: {
          "User-Agent": UA,
          "Referer": `${HOST}/`
        },
        danmaku: []
      };
    }

    let danmaku = [];
    let scrapeData = null;
    let mapping = null;

    if (resourceId && fileId) {
      try {
        await OmniBox.log("info", `[play] 开始读取刮削元数据 resourceId=${resourceId}, fileId=${fileId}`);
        const metadata = await OmniBox.getScrapeMetadata(resourceId);
        scrapeData = metadata?.scrapeData || null;
        const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
        mapping = mappings.find((m) => String(m?.fileId || "") === fileId) || null;

        await OmniBox.log(
          "info",
          `[play] 元数据读取完成 resourceId=${resourceId}, hasScrapeData=${!!scrapeData}, mappingCount=${mappings.length}, mappingMatched=${!!mapping}`
        );

        const fileName = buildDanmakuFileName(scrapeData, mapping, title, epName);
        await OmniBox.log("info", `[play] 构造弹幕匹配文件名 fileName=${fileName}`);

        if (fileName) {
          danmaku = await OmniBox.getDanmakuByFileName(fileName);
          await OmniBox.log("info", `[play] 弹幕匹配完成 fileName=${fileName}, danmakuCount=${Array.isArray(danmaku) ? danmaku.length : 0}`);
        }
      } catch (error) {
        await OmniBox.log("warn", `[play] 弹幕匹配失败: ${error.message}`);
      }
    } else {
      await OmniBox.log("warn", `[play] 缺少 resourceId 或 fileId，跳过弹幕匹配 resourceId=${resourceId}, fileId=${fileId}`);
    }

    const parse = /\.(m3u8|mp4|flv|webm)(\?|$)/i.test(url) ? 0 : 1;
    const header = {
      "User-Agent": UA,
      "Referer": `${HOST}/`
    };

    await OmniBox.log("info", `[play] 播放地址已确定 parse=${parse}, url=${url.slice(0, 200)}`);

    return {
      urls: [{ name: epName || meta.flag || "播放", url }],
      parse,
      header,
      danmaku: Array.isArray(danmaku) ? danmaku : []
    };
  } catch (error) {
    await OmniBox.log("error", `play 失败: ${error.message}`);
    return {
      urls: [],
      parse: 1,
      header: {
        "User-Agent": UA,
        "Referer": `${HOST}/`
      },
      danmaku: []
    };
  }
}

module.exports = { home, category, search, detail, play };
runner.run(module.exports);
