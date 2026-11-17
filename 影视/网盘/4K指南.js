// @name 4K指南
// @author 梦
// @description 网盘资源站：https://4kzn.cc ，支持首页、分类、详情、搜索、网盘播放、刮削、弹幕
// @version 1.2.4
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/4K指南.js
// @dependencies cheerio

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const HOST = process.env.K4ZN_HOST || "https://4kzn.cc";
const UA = process.env.K4ZN_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
const HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  Referer: `${HOST}/`,
};

const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "quark;uc");
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");
const DRIVE_ORDER = splitConfigList(process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").map((s) => s.toLowerCase());
const EXTERNAL_SERVER_PROXY_ENABLED = String(process.env.EXTERNAL_SERVER_PROXY_ENABLED || "false").toLowerCase() === "true";

const VIDEO_EXTENSIONS = [
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".m4v", ".mpg", ".mpeg", ".rmvb", ".ts", ".m2ts", ".webm", ".iso",
];

const CLASS_LIST = [
  { type_id: "books/top250", type_name: "豆瓣TOP250" },
  { type_id: "books/zuixin", type_name: "最新" },
  { type_id: "books/zuixin-juji", type_name: "最新剧集" },
  { type_id: "books/xiliehj", type_name: "系列合集" },
  { type_id: "books/manwei", type_name: "漫威电影系列合集" },
  { type_id: "books/mztkn", type_name: "名侦探柯南剧场版合集" },
  { type_id: "books/hanniba", type_name: "汉尼拔合集" },
];

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function splitConfigList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

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
  if (value.startsWith("/")) return `${HOST}${value}`;
  return `${HOST}/${value.replace(/^\/+/, "")}`;
}

function cleanText(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatFileSize(size) {
  const n = Number(size || 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(2)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(2)}MB`;
  if (n < 1024 ** 4) return `${(n / 1024 ** 3).toFixed(2)}GB`;
  return `${(n / 1024 ** 4).toFixed(2)}TB`;
}

function encodePlayMeta(meta) {
  try {
    return Buffer.from(JSON.stringify(meta || {}), "utf8").toString("base64");
  } catch (_) {
    return "";
  }
}

function decodePlayMeta(meta) {
  try {
    return JSON.parse(Buffer.from(String(meta || ""), "base64").toString("utf8") || "{}");
  } catch (_) {
    return {};
  }
}

function buildScrapedFileName(scrapeData, mapping, originalFileName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalFileName;
  }

  if (!scrapeData || !scrapeData.title) {
    return originalFileName;
  }

  if (scrapeData.type === "tv" || mapping.seasonNumber) {
    const seasonNum = mapping.seasonNumber || 1;
    const epNum = mapping.episodeNumber || 1;
    const seasonAirYear = scrapeData.seasonAirYear || "";
    let name = `${scrapeData.title}`;
    if (seasonAirYear) name += `.${seasonAirYear}`;
    name += `.S${String(seasonNum).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
    return name;
  }

  return scrapeData.title || originalFileName;
}

function normalizeEpisodeName(episodeName) {
  if (!episodeName) return "";
  return String(episodeName)
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/（[^）]*）/g, " ")
    .replace(/第\s*([0-9一二三四五六七八九十百千零〇两]+)\s*[集话期]/g, "E$1")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  const title = cleanText(vodName || "");
  const episode = normalizeEpisodeName(episodeTitle || "");
  if (!title) return episode;
  if (!episode || title.includes(episode)) return title;
  return `${title} ${episode}`;
}

function getBaseURLHost(context = {}) {
  const baseURL = String(context?.baseURL || "").trim();
  if (!baseURL) return "";
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch (_) {
    return baseURL.toLowerCase();
  }
}

function isPrivateHost(hostname = "") {
  const host = String(hostname || "").toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return true;
  if (/^(10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal") || host.endsWith(".intra")) return true;
  if (host.includes(":")) return host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80");
  return false;
}

function canUseServerProxy(context = {}) {
  if (EXTERNAL_SERVER_PROXY_ENABLED) return true;
  return isPrivateHost(getBaseURLHost(context));
}

function resolveCallerSource(params = {}, context = {}) {
  return String(context?.from || params?.source || "").toLowerCase();
}

function filterSourceNamesForCaller(sourceNames = [], callerSource = "", context = {}) {
  let filtered = Array.isArray(sourceNames) ? [...sourceNames] : [];
  const allowServerProxy = canUseServerProxy(context);

  if (callerSource === "web") {
    filtered = filtered.filter((name) => name !== "本地代理");
  } else if (callerSource === "emby") {
    if (allowServerProxy) {
      filtered = filtered.filter((name) => name === "服务端代理");
    } else {
      filtered = filtered.filter((name) => name !== "服务端代理");
    }
  } else if (callerSource === "uz") {
    filtered = filtered.filter((name) => name !== "本地代理");
  }

  if (!allowServerProxy) {
    filtered = filtered.filter((name) => name !== "服务端代理");
  }

  return filtered.length > 0 ? filtered : ["直连"];
}

function resolveRouteType(flag = "", callerSource = "", context = {}) {
  const allowServerProxy = canUseServerProxy(context);
  const validRouteTypes = new Set(["本地代理", "服务端代理", "直连"]);
  let routeType = "直连";

  if (callerSource === "web" || callerSource === "emby") {
    routeType = allowServerProxy ? "服务端代理" : "直连";
  }

  if (flag) {
    if (flag.includes("-")) {
      const parts = flag.split("-");
      routeType = parts[parts.length - 1];
    } else {
      routeType = flag;
    }
  }

  if (!validRouteTypes.has(routeType)) routeType = "直连";
  if (!allowServerProxy && routeType === "服务端代理") routeType = "直连";
  if (callerSource === "uz" && routeType === "本地代理") routeType = "直连";

  return routeType;
}

function inferDriveTypeFromSourceName(name = "") {
  const raw = String(name || "").toLowerCase();
  if (raw.includes("百度")) return "baidu";
  if (raw.includes("天翼")) return "tianyi";
  if (raw.includes("夸克")) return "quark";
  if (raw === "uc" || raw.includes("uc")) return "uc";
  if (raw.includes("115")) return "115";
  if (raw.includes("迅雷")) return "xunlei";
  if (raw.includes("阿里")) return "ali";
  if (raw.includes("123")) return "123pan";
  return raw;
}

function sortPlaySourcesByDriveOrder(playSources = []) {
  if (!Array.isArray(playSources) || playSources.length <= 1 || DRIVE_ORDER.length === 0) return playSources;
  const orderMap = new Map(DRIVE_ORDER.map((name, index) => [name, index]));
  return [...playSources].sort((a, b) => {
    const aType = inferDriveTypeFromSourceName(a?.name || "");
    const bType = inferDriveTypeFromSourceName(b?.name || "");
    const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return 0;
  });
}

function isVideoFile(file = {}) {
  const name = String(file.file_name || file.name || "").toLowerCase();
  const hasVideoExt = VIDEO_EXTENSIONS.some((ext) => name.endsWith(ext));
  const sdkFileFlag = file.file === 1 || file.file === true || file.is_file === 1 || file.isFile === 1;
  return hasVideoExt || (sdkFileFlag && hasVideoExt);
}

function isFolderLike(file = {}) {
  if (
    file.is_dir === 1 || file.isDir === 1 || file.dir === 1 || file.dir === true ||
    file.folder === 1 || file.folder === true || file.is_folder === 1
  ) {
    return true;
  }
  const type = String(file.type || file.obj_type || file.category || file.file_type || "").toLowerCase();
  return type.includes("dir") || type.includes("folder");
}

async function getAllVideoFiles(shareURL, files, depth = 0, seen = new Set()) {
  if (!Array.isArray(files) || !files.length || depth > 8) return [];

  const videos = [];
  for (const file of files) {
    const fid = String(file.fid || file.file_id || file.id || "").trim();
    if (!fid) continue;

    if (isVideoFile(file)) {
      videos.push({
        fid,
        file_name: String(file.file_name || file.name || fid),
        size: Number(file.size || file.file_size || 0),
      });
      continue;
    }

    if (isFolderLike(file)) {
      const key = `${shareURL}|${fid}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const subFileList = await OmniBox.getDriveFileList(shareURL, fid);
        const subFiles = Array.isArray(subFileList?.files) ? subFileList.files : Array.isArray(subFileList) ? subFileList : [];
        if (subFiles.length) {
          const nested = await getAllVideoFiles(shareURL, subFiles, depth + 1, seen);
          if (nested.length) videos.push(...nested);
        }
      } catch (e) {
        await OmniBox.log("warn", `[4K指南][detail] 读取子目录失败 share=${shareURL} fid=${fid}: ${e.message}`);
      }
    }
  }

  return videos;
}

function dedupeEpisodes(episodes = []) {
  const seen = new Set();
  const result = [];
  for (const ep of episodes) {
    const key = `${ep.playId}@@${ep.name}`;
    if (!ep.playId || seen.has(key)) continue;
    seen.add(key);
    result.push(ep);
  }
  return result;
}

async function requestText(url, options = {}) {
  const res = await OmniBox.request(url, {
    method: options.method || "GET",
    headers: {
      ...HEADERS,
      ...(options.headers || {}),
      Referer: options.referer || `${HOST}/`,
    },
    timeout: options.timeout || 20000,
    body: options.body,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  if (statusCode < 200 || statusCode >= 400) {
    throw new Error(`HTTP ${statusCode} @ ${url}`);
  }
  return text;
}

function extractItems(html) {
  const $ = cheerio.load(html);
  const list = [];
  const seen = new Set();

  $("article.posts-item.book-item, article.posts-item.sites-item, article.posts-item").each((_, el) => {
    const a = $(el).find("a.item-image, h3.item-title a, a[target='_blank']").first();
    const href = absUrl(a.attr("href") || "");
    const title = cleanText($(el).find(".item-title a").first().text() || a.text() || $(el).attr("data-title") || "");
    if (!href || !title || seen.has(href)) return;
    seen.add(href);

    const img = absUrl($(el).find("img").first().attr("data-src") || $(el).find("img").first().attr("src") || "");
    const desc = cleanText($(el).find(".line1.text-muted.text-xs, .book-info, .item-desc, .sub-title").first().text());

    list.push({
      vod_id: href,
      vod_name: title,
      vod_pic: img,
      vod_remarks: desc,
      vod_content: "",
    });
  });

  return list;
}

function extractPager(html) {
  const pagecountMatch = html.match(/\/books\/[^"']+\/page\/(\d+)/g);
  const pages = pagecountMatch ? pagecountMatch.map((s) => Number((s.match(/(\d+)$/) || [0, 1])[1] || 1)) : [];
  const maxPage = pages.length ? Math.max(...pages) : 1;
  const hasNext = /class="next-page[^>]*>\s*<a[^>]*href="[^"]+\/page\/\d+"/i.test(html);
  return { pagecount: Math.max(maxPage, hasNext ? maxPage + 1 : 1) };
}

async function home(params, context) {
  try {
    const html = await requestText(`${HOST}/`);
    const list = extractItems(html).slice(0, 24);
    return { class: CLASS_LIST, filters: {}, list };
  } catch (e) {
    await OmniBox.log("error", `[4K指南][home] ${e.message}`);
    return { class: CLASS_LIST, filters: {}, list: [] };
  }
}

async function category(params, context) {
  try {
    const tid = String(params.categoryId || params.type_id || "books/zuixin").replace(/^\/+/, "");
    const page = Math.max(1, parseInt(params.page || 1, 10));
    const url = page > 1 ? `${HOST}/${tid}/page/${page}` : `${HOST}/${tid}`;
    const html = await requestText(url);
    const list = extractItems(html);
    const { pagecount } = extractPager(html);
    return { page, pagecount, total: pagecount * Math.max(list.length, 1), list };
  } catch (e) {
    await OmniBox.log("error", `[4K指南][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const id = String(params.videoId || params.id || params.url || "").trim();
    if (!id) return { list: [] };

    const source = resolveCallerSource(params, context);
    const detailUrl = /^https?:\/\//i.test(id) ? id : absUrl(id);
    const html = await requestText(detailUrl);
    const $ = cheerio.load(html);

    const title = cleanText($("h1, h2, .book-title").first().text()) || cleanText($("meta[property='og:title']").attr("content") || "");
    const pic = absUrl($(".book-cover img, meta[property='og:image']").first().attr("data-src") || $(".book-cover img, meta[property='og:image']").first().attr("content") || $(".book-cover img").first().attr("src") || "");
    const desc = cleanText($("meta[name='description']").attr("content") || $(".panel-body.single").text());

    const shareLinks = [];
    const seenLinks = new Set();
    $(".site-go a[target='_blank'], a[target='_blank'][href*='pan.quark.cn'], a[href*='quark.cn'], a[href*='uc.cn'], a[href*='aliyundrive.com'], a[href*='115.com']").each((_, el) => {
      const href = absUrl($(el).attr("href") || "");
      if (!href || seenLinks.has(href)) return;
      seenLinks.add(href);
      shareLinks.push(href);
    });

    if (!shareLinks.length) {
      const fallbackLink = $("a.external[href*='pan.quark.cn'], a[href*='pan.quark.cn'], a[href*='quark.cn']").first();
      const href = absUrl(fallbackLink.attr("href") || "");
      if (href) shareLinks.push(href);
    }

    const driveTypeCountMap = {};
    const rawDriveInfos = [];

    for (const shareURL of shareLinks) {
      let driveInfo = null;
      try {
        driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
      } catch (_) {
        driveInfo = null;
      }
      const displayName = driveInfo?.displayName || "网盘";
      driveTypeCountMap[displayName] = (driveTypeCountMap[displayName] || 0) + 1;
      rawDriveInfos.push({ shareURL, driveInfo, displayName });
    }

    const driveTypeCurrentIndexMap = {};
    const filesForScraping = [];
    let playSources = [];

    for (const item of rawDriveInfos) {
      const { shareURL, driveInfo } = item;
      let displayName = item.displayName;

      if ((driveTypeCountMap[displayName] || 0) > 1) {
        driveTypeCurrentIndexMap[displayName] = (driveTypeCurrentIndexMap[displayName] || 0) + 1;
        displayName = `${displayName}${driveTypeCurrentIndexMap[displayName]}`;
      }

      let allVideoFiles = [];
      try {
        const rootFileList = await OmniBox.getDriveFileList(shareURL, "0");
        const rootFiles = Array.isArray(rootFileList?.files) ? rootFileList.files : Array.isArray(rootFileList) ? rootFileList : [];
        allVideoFiles = await getAllVideoFiles(shareURL, rootFiles, 0, new Set());
        await OmniBox.log("info", `[4K指南][detail] share=${shareURL} rootFiles=${rootFiles.length} videoFiles=${allVideoFiles.length}`);
      } catch (e) {
        await OmniBox.log("warn", `[4K指南][detail] 扫描网盘文件失败: ${e.message}`);
      }

      const episodes = dedupeEpisodes(allVideoFiles.map((file) => {
        const sizeText = formatFileSize(file.size);
        const episodeName = cleanText(String(file.file_name || "资源").replace(/\.[^.]+$/, "")) || "资源";
        const displayFileName = sizeText ? `[${sizeText}] ${file.file_name}` : file.file_name;
        const playMeta = encodePlayMeta({
          sid: detailUrl,
          t: title,
          e: episodeName,
        });
        const formattedFileId = `${shareURL}|${file.fid}`;
        if (file.fid && !filesForScraping.some((item) => item.fid === formattedFileId)) {
          filesForScraping.push({
            file_name: episodeName,
            fid: formattedFileId,
            file_id: formattedFileId,
          });
        }
        return {
          name: displayFileName,
          playId: playMeta ? `${shareURL}|${file.fid}|${playMeta}` : `${shareURL}|${file.fid}`,
        };
      }));

      if (!episodes.length) {
        episodes.push({
          name: "打开网盘链接",
          playId: `share|||${encodeURIComponent(shareURL)}`,
        });
      }

      let sourceNames = [displayName];
      const driveType = String(driveInfo?.driveType || "").toLowerCase();
      if (DRIVE_TYPE_CONFIG.includes(driveType)) {
        sourceNames = filterSourceNamesForCaller(SOURCE_NAMES_CONFIG, source, context);
      }

      for (const sourceName of sourceNames) {
        const lineName = DRIVE_TYPE_CONFIG.includes(driveType) ? `${displayName}-${sourceName}` : displayName;
        playSources.push({
          name: lineName,
          episodes,
        });
      }
    }

    if (playSources.length > 1) {
      playSources = sortPlaySourcesByDriveOrder(playSources);
    }

    const vodItem = {
      vod_id: detailUrl,
      vod_name: title,
      vod_pic: pic,
      vod_content: desc,
      vod_play_sources: playSources.length
        ? playSources
        : [{ name: "详情页", episodes: [{ name: "打开详情页", playId: `page|||${encodeURIComponent(detailUrl)}` }] }],
    };

    if (filesForScraping.length > 0) {
      try {
        await OmniBox.log("info", `[4K指南][detail] 开始统一刮削: vodId=${detailUrl}, files=${filesForScraping.length}`);
        await OmniBox.processScraping(detailUrl, title || "", title || "", filesForScraping);
        const metadata = await OmniBox.getScrapeMetadata(detailUrl);
        const scrapeData = metadata?.scrapeData || null;
        const videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];

        if (scrapeData || videoMappings.length > 0) {
          for (const source of vodItem.vod_play_sources || []) {
            for (const episode of source.episodes || []) {
              const playIdParts = String(episode.playId || "").split("|");
              const formattedId = `${String(playIdParts[0] || "")}|${String(playIdParts[1] || "")}`;
              const matchedMapping = videoMappings.find((mapping) => mapping && mapping.fileId === formattedId);
              if (matchedMapping && scrapeData) {
                const newName = buildScrapedFileName(scrapeData, matchedMapping, String(episode.name || ""));
                if (newName && newName !== episode.name) {
                  episode.name = newName;
                }
              }
            }
          }

          if (scrapeData) {
            if (scrapeData.title) vodItem.vod_name = scrapeData.title;
            if (scrapeData.posterPath) vodItem.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            if (scrapeData.overview) vodItem.vod_content = scrapeData.overview;
            if (scrapeData.releaseDate) vodItem.vod_year = String(scrapeData.releaseDate).slice(0, 4);
            if (scrapeData.voteAverage) vodItem.vod_douban_score = Number(scrapeData.voteAverage).toFixed(1);
          }
          await OmniBox.log("info", `[4K指南][detail] 统一刮削完成: vodId=${detailUrl}, mappings=${videoMappings.length}, title=${vodItem.vod_name || title}`);
        } else {
          await OmniBox.log("info", `[4K指南][detail] 统一刮削无结果: vodId=${detailUrl}`);
        }
      } catch (error) {
        await OmniBox.log("warn", `[4K指南][detail] 统一刮削失败: ${error.message}`);
      }
    } else {
      await OmniBox.log("info", `[4K指南][detail] 跳过统一刮削: 未收集到可刮削文件`);
    }

    await OmniBox.log("info", `[4K指南][detail] url=${detailUrl} title=${vodItem.vod_name || title} shareLinks=${shareLinks.length} lines=${playSources.length}`);

    return {
      list: [vodItem],
    };
  } catch (e) {
    await OmniBox.log("error", `[4K指南][detail] ${e.message}`);
    return { list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.wd || params.key || "").trim();
    const page = Math.max(1, parseInt(params.page || 1, 10));
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const url = `${HOST}/?s=${encodeURIComponent(keyword)}`;
    const html = await requestText(url, { referer: `${HOST}/` });
    let list = extractItems(html);
    if (!list.length) {
      const $ = cheerio.load(html);
      list = [];
      $("a[href*='/book/'], a[href*='/sites/']").each((_, el) => {
        const a = $(el);
        const href = absUrl(a.attr("href") || "");
        const title = cleanText(a.text());
        if (!href || !title) return;
        if (!title.includes(keyword)) return;
        list.push({ vod_id: href, vod_name: title, vod_pic: "", vod_remarks: "", vod_content: "" });
      });
    }

    return { page, pagecount: 1, total: list.length, list };
  } catch (e) {
    await OmniBox.log("error", `[4K指南][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params.playId || params.url || params.input || "").trim();
    const flag = String(params.flag || "").trim();
    const source = resolveCallerSource(params, context);

    if (!playId) return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };

    if (playId.startsWith("page|||")) {
      const pageUrl = decodeURIComponent(playId.slice("page|||".length));
      const header = { ...HEADERS, Referer: pageUrl };
      return { parse: 1, jx: 0, url: pageUrl, urls: [{ name: "详情页", url: pageUrl }], header, headers: header };
    }

    if (playId.startsWith("share|||")) {
      const shareUrl = decodeURIComponent(playId.slice("share|||".length));
      const header = { ...HEADERS, Referer: `${HOST}/` };
      return { parse: 1, jx: 0, url: shareUrl, urls: [{ name: "打开网盘", url: shareUrl }], header, headers: header };
    }

    const idParts = playId.split("|");
    const shareURL = idParts[0] || "";
    let fileId = idParts[1] || "";
    const playMeta = idParts.length >= 3 ? decodePlayMeta(idParts[2] || "") : {};

    if (!shareURL) {
      throw new Error("播放参数缺少分享链接");
    }

    const routeType = resolveRouteType(flag, source, context);

    if (!fileId) {
      const rootFileList = await OmniBox.getDriveFileList(shareURL, "0");
      const rootFiles = Array.isArray(rootFileList?.files) ? rootFileList.files : Array.isArray(rootFileList) ? rootFileList : [];
      const files = await getAllVideoFiles(shareURL, rootFiles, 0, new Set());
      if (files.length) {
        fileId = files[0].fid;
      }
    }

    if (!fileId) {
      const header = { ...HEADERS, Referer: `${HOST}/` };
      return { parse: 1, jx: 0, url: shareURL, urls: [{ name: "打开网盘", url: shareURL }], header, headers: header };
    }

    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
        episodeName: playMeta.e || params.episodeName || "",
      };

      const vodId = String(playMeta.sid || params.vodId || params.videoId || "").trim();
      if (!vodId) return result;

      try {
        const metadata = await OmniBox.getScrapeMetadata(vodId);
        if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) {
          await OmniBox.log("info", `[4K指南][play] 弹幕匹配跳过: metadata 不完整, vodId=${vodId}`);
          return result;
        }

        const formattedFileId = `${shareURL}|${fileId}`;
        const matchedMapping = metadata.videoMappings.find((mapping) => mapping && mapping.fileId === formattedFileId);
        const scrapeData = metadata.scrapeData || {};
        if (!matchedMapping) {
          await OmniBox.log("info", `[4K指南][play] 弹幕匹配未命中 mapping: ${formattedFileId}`);
          return result;
        }

        if (matchedMapping.episodeName && !result.episodeName) {
          result.episodeName = matchedMapping.episodeName;
        }

        const fileName = buildScrapedFileName(scrapeData, matchedMapping, result.episodeName || "") || buildFileNameForDanmu(scrapeData.title || playMeta.t || "", result.episodeName || "");
        if (fileName) {
          await OmniBox.log("info", `[4K指南][play] 生成 fileName 用于弹幕匹配: ${fileName}`);
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
          if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) {
            result.danmakuList = matchedDanmaku;
            await OmniBox.log("info", `[4K指南][play] 弹幕匹配成功, count=${matchedDanmaku.length}`);
          }
        }
      } catch (error) {
        await OmniBox.log("warn", `[4K指南][play] 弹幕匹配失败: ${error.message}`);
      }

      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([
      OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType),
      metadataPromise,
    ]);

    if (playInfoResult.status !== "fulfilled") {
      throw new Error(playInfoResult.reason && playInfoResult.reason.message ? playInfoResult.reason.message : "网盘直链解析失败");
    }

    const playInfo = playInfoResult.value;
    if (!playInfo || !Array.isArray(playInfo.url) || !playInfo.url.length) {
      throw new Error("网盘直链解析结果为空");
    }

    const urls = playInfo.url.map((item) => ({
      name: item.name || "播放",
      url: item.url,
    }));

    let danmakuList = Array.isArray(playInfo.danmaku) ? playInfo.danmaku : [];
    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList?.length ? metadataResult.value.danmakuList : danmakuList;
    } else if (metadataResult.status === "rejected") {
      await OmniBox.log("warn", `[4K指南][play] 获取元数据失败(不影响播放): ${metadataResult.reason && metadataResult.reason.message ? metadataResult.reason.message : metadataResult.reason}`);
    }

    const header = playInfo.header || {};

    await OmniBox.log("info", `[4K指南][play] route=${routeType} share=${shareURL} fileId=${fileId} urls=${urls.length}`);

    return {
      urls,
      header,
      parse: 0,
      jx: 0,
      danmaku: danmakuList};
  } catch (e) {
    await OmniBox.log("error", `[4K指南][play] ${e.message}`);
    return { parse: 0, jx: 0, url: "", urls: [], header: {}, headers: {} };
  }
}
