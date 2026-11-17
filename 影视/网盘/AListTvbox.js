// @name AListTvbox
// @author @sifanss
// @description 必填参数：BASE_URL，XIAOYA_TOKEN。刮削：支持，弹幕：支持，播放记录：支持
// @dependencies: axios
// @version 1.1.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/AListTvbox.js

// 引入 OmniBox SDK
const OmniBox = require("omnibox_sdk");

let axios;
try {
  axios = require("axios");
} catch (error) {
  throw new Error("axios 模块未找到,请先安装:npm install axios");
}

const http = require("http");
const https = require("https");

// ==================== 配置区域 ====================
// Alist Tvbox接口地址，目前只支持 4567 端口（支持通过环境变量覆盖）
// 示例：http://127.0.0.1:4567
const BASE_URL = process.env.XIAOYA_BASE_URL || "http://127.0.0.1:4567";
// AListTvbox 安全订阅
const ALIST_TVBOX_TOKEN = process.env.ALIST_TVBOX_TOKEN || process.env.XIAOYA_TOKEN || "";
// 小雅接口路径（如有变化可通过环境变量覆盖）
const VOD_PATH = `/vod1/${ALIST_TVBOX_TOKEN}`;
const PLAY_PATH = `/play/${ALIST_TVBOX_TOKEN}`;

// 是否启用本地代理（用于非 115/本地路由播放地址）
const ENABLE_LOCAL_PROXY = (process.env.XIAOYA_ENABLE_PROXY || "1") === "1";
const LOCAL_PROXY_URL = process.env.XIAOYA_PROXY_URL || "http://127.0.0.1:5575/proxy";

// 自定义分类（JSON 字符串，留空则不覆盖）
// 示例：[{"type_id":"1","type_name":"电影"}]
const CUSTOM_CLASS_JSON = process.env.XIAOYA_CLASS_JSON || "";

// ==================== 配置区域结束 ====================

const HTTP_CLIENT = axios.create({
  timeout: 60 * 1000,
  baseURL: BASE_URL,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
  validateStatus: (status) => status >= 200,
});

const proxyImageDomains = new Set([
  "img1.doubanio.com",
  "img2.doubanio.com",
  "img3.doubanio.com",
]);

/**
 * 修复图片地址
 */
function fixPicUrl(url) {
  if (!url) return "";
  if (url.startsWith("http")) return url;
  return url.startsWith("/") ? `${BASE_URL}${url}` : `${BASE_URL}/${url}`;
}

/**
 * 图片代理
 */
function processImageUrl(imageUrl, baseURL = "") {
  if (!imageUrl) return "";
  const url = fixPicUrl(imageUrl);
  if (!baseURL || !url.startsWith("http")) return url;

  try {
    const urlObj = new URL(url);
    if (!proxyImageDomains.has(urlObj.hostname)) return url;
    const referer = `${urlObj.protocol}//${urlObj.host}`;
    const urlWithHeaders = `${url}@Referer=${referer}`;
    const encodedUrl = encodeURIComponent(urlWithHeaders);
    return `${baseURL}/api/proxy/image?url=${encodedUrl}`;
  } catch (error) {
    OmniBox.log("warn", `处理图片 URL 失败: ${error.message}`);
    return url;
  }
}

function applyImageProxyToList(list, baseURL = "") {
  if (!Array.isArray(list)) return list;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    if (item.vod_pic) {
      item.vod_pic = processImageUrl(item.vod_pic, baseURL);
    } else if (item.VodPic) {
      item.VodPic = processImageUrl(item.VodPic, baseURL);
    }
  }
  return list;
}

/**
 * 解析自定义分类配置
 */
function getCustomClasses() {
  if (!CUSTOM_CLASS_JSON) {
    return [];
  }
  try {
    const parsed = JSON.parse(CUSTOM_CLASS_JSON);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (error) {
    OmniBox.log("warn", `解析自定义分类失败: ${error.message}`);
  }
  return [];
}

/**
 * 发送请求到小雅接口
 */
async function requestXiaoya(path, params = {}) {
  const start = Date.now();
  try {
    OmniBox.log("info", `请求小雅接口: ${path}, params=${JSON.stringify(params)}`);
    const response = await HTTP_CLIENT.get(path, { params });
    const cost = Date.now() - start;
    OmniBox.log("info", `小雅接口响应: ${path}, status=${response.status}, cost=${cost}ms`);
    return response.data;
  } catch (error) {
    const cost = Date.now() - start;
    OmniBox.log("error", `小雅接口请求失败: ${path}, cost=${cost}ms, err=${error.message}`);
    throw error;
  }
}

/**
 * 构建本地代理 URL
 */
function buildLocalProxyUrl(targetUrl) {
  const proxyUrl = new URL(LOCAL_PROXY_URL);
  proxyUrl.searchParams.append("thread", "10");
  proxyUrl.searchParams.append("chunkSize", "256");
  proxyUrl.searchParams.append("url", targetUrl);
  return proxyUrl.toString();
}

/**
 * 处理播放地址
 */
function buildPlayUrls(rawUrl) {
  const urls = [];

  // 先添加原始地址
  urls.push({ name: "RAW", url: rawUrl });

  // 可选本地代理
  if (ENABLE_LOCAL_PROXY && !/115/.test(rawUrl) && !/192\.168\.1\.254/.test(rawUrl)) {
    const proxyUrl = buildLocalProxyUrl(rawUrl);
    urls.unshift({ name: "代理RAW", url: proxyUrl });
  }

  return urls;
}

/**
 * 规范化 filters 的 value 字段 (n -> name, v -> value)
 */
function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object") {
    return filters;
  }

  for (const key of Object.keys(filters)) {
    const group = filters[key];
    if (!Array.isArray(group)) {
      continue;
    }

    for (const item of group) {
      if (!item || !Array.isArray(item.value)) {
        continue;
      }

      item.value = item.value.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return entry;
        }

        if ("name" in entry || "value" in entry) {
          return entry;
        }

        return {
          name: entry.n,
          value: entry.v,
        };
      });
    }
  }

  return filters;
}

/**
 * 将旧格式的播放源转换为新格式（vod_play_sources）
 */
function convertToPlaySources(vodPlayFrom, vodPlayUrl, vodId) {
  const playSources = [];

  if (!vodPlayFrom || !vodPlayUrl) {
    return playSources;
  }

  const sourceNames = vodPlayFrom
    .split("$$$")
    .map((name) => name.trim())
    .filter((name) => name);
  const sourceUrls = vodPlayUrl
    .split("$$$")
    .map((url) => url.trim())
    .filter((url) => url);

  const maxLength = Math.max(sourceNames.length, sourceUrls.length);

  for (let i = 0; i < maxLength; i++) {
    const sourceName = sourceNames[i] || `线路${i + 1}`;
    const sourceUrl = sourceUrls[i] || "";

    let cleanSourceName = sourceName;
    if (vodId && sourceName.endsWith(`-${vodId}`)) {
      cleanSourceName = sourceName.substring(0, sourceName.length - `-${vodId}`.length);
    }

    const episodes = [];
    if (sourceUrl) {
      const episodeSegments = sourceUrl
        .split("#")
        .map((seg) => seg.trim())
        .filter((seg) => seg);

      for (const segment of episodeSegments) {
        const parts = segment.split("$");
        if (parts.length >= 2) {
          const episodeName = parts[0].trim();
          const playId = parts.slice(1).join("$").trim();
          if (episodeName && playId) {
            episodes.push({
              name: episodeName,
              playId: playId,
            });
          }
        } else if (parts.length === 1 && parts[0]) {
          episodes.push({
            name: `第${episodes.length + 1}集`,
            playId: parts[0].trim(),
          });
        }
      }
    }

    if (episodes.length > 0) {
      playSources.push({
        name: cleanSourceName,
        episodes: episodes,
      });
    }
  }

  return playSources;
}

function encodePlayMeta(meta) {
  try {
    return Buffer.from(JSON.stringify(meta || {}), "utf8").toString("base64");
  } catch (error) {
    return "";
  }
}

function decodePlayMeta(meta) {
  try {
    const raw = Buffer.from(String(meta || ""), "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch (error) {
    return {};
  }
}

function parseVodIdForFallback(vodId) {
  const result = {
    title: "",
    episodeName: "",
  };

  if (!vodId) {
    return result;
  }

  const parts = String(vodId).split("|");
  if (parts.length >= 2) {
    result.title = parts[2] || parts[1] || "";
  }

  return result;
}

function normalizeEpisodeName(episodeName) {
  if (!episodeName) {
    return "";
  }

  let name = String(episodeName).trim();
  name = name.replace(/^[\s\uFEFF\u200B]+/g, "");
  name = name.replace(/^[\[\(【{]?\s*(?:uc|quark|aliyun|baidu|115|tianyi|xunlei|123|mobile)\b\s*[\]\)】}]?[\s._-]*/i, "");
  name = name.replace(/^(?:uc|quark|aliyun|baidu|115|tianyi|xunlei|123|mobile)\b[\s._-]*/i, "");
  return name;
}

function preprocessTitleForDanmu(title) {
  if (!title) {
    return "";
  }
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

function preprocessTitle(title) {
  if (!title) return "";
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]|1280x720|1920x1080/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

/**
* 将中文数字转换为阿拉伯数字
*/
function chineseToArabic(cn) {
  const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (!isNaN(cn)) return parseInt(cn);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === '十') return 10 + map[cn[1]];
    if (cn[1] === '十') return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
}

function extractEpisode(title) {
  if (!title) return "";

  const processedTitle = preprocessTitle(title).trim();

  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];

  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));

  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];

  const bracketMatch = processedTitle.match(/[\[\(【（](\d{1,3})[\]\)】）]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    if (!["720", "1080", "480"].includes(num)) return num;
  }

  const standaloneMatches = processedTitle.match(/(?:^|[\s\-\._\[\]])(\d{1,3})(?![0-9pP])/g);
  if (standaloneMatches) {
    const candidates = standaloneMatches
      .map((m) => m.match(/\d+/)[0])
      .filter((num) => {
        const n = parseInt(num, 10);
        return n > 0 && n < 300 && !["720", "480", "264", "265"].includes(num);
      });

    if (candidates.length > 0) {
      const normalEp = candidates.find((n) => parseInt(n, 10) < 100);
      return normalEp || candidates[0];
    }
  }

  return "";
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) {
    return "";
  }

  if (!episodeTitle || episodeTitle === "正片" || episodeTitle === "播放") {
    return vodName;
  }

  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) {
      return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
    }
  }

  return vodName;
}

function buildScrapedFileName(scrapeData, mapping, originalFileName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalFileName;
  }

  if (scrapeData && scrapeData.episodes && Array.isArray(scrapeData.episodes)) {
    for (const episode of scrapeData.episodes) {
      if (episode.episodeNumber === mapping.episodeNumber && episode.seasonNumber === mapping.seasonNumber) {
        if (episode.name) {
          return `${episode.episodeNumber}.${episode.name}`;
        }
        break;
      }
    }
  }

  return originalFileName;
}

/**
 * 首页
 */
async function home(params, context) {
  try {
    OmniBox.log("info", "获取首页数据");
    const page = params.page || 1;
    const baseURL = context?.baseURL || "";

    const data = await requestXiaoya(VOD_PATH, {
      ac: "list",
      pg: String(page),
    });

    const customClasses = getCustomClasses();
    if (customClasses.length > 0) {
      data.class = customClasses;
      OmniBox.log("info", `使用自定义分类: ${customClasses.length} 项`);
    }

    if (data && data.filters) {
      data.filters = normalizeFilters(data.filters);
    }

    if (data && data.list) {
      applyImageProxyToList(data.list, baseURL);
    }

    return data;
  } catch (error) {
    OmniBox.log("error", `获取首页数据失败: ${error.message}`);
    return { class: [], list: [] };
  }
}

/**
 * 分类
 */
async function category(params, context) {
  try {
    const categoryId = params.categoryId || params.type_id || "";
    const page = params.page || 1;
    const baseURL = context?.baseURL || "";

    if (!categoryId) {
      OmniBox.log("warn", "分类ID为空");
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }

    OmniBox.log("info", `获取分类数据: categoryId=${categoryId}, page=${page}`);

    const data = await requestXiaoya(VOD_PATH, {
      ac: "videolist",
      t: String(categoryId),
      pg: String(page),
    });

    if (data && data.list) {
      applyImageProxyToList(data.list, baseURL);
    }

    return data;
  } catch (error) {
    OmniBox.log("error", `获取分类数据失败: ${error.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

/**
 * 搜索
 */
async function search(params, context) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = params.page || 1;
    const baseURL = context?.baseURL || "";

    if (!keyword) {
      OmniBox.log("warn", "搜索关键词为空");
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }

    OmniBox.log("info", `搜索视频: keyword=${keyword}, page=${page}`);

    const data = await requestXiaoya(VOD_PATH, {
      ac: "list",
      wd: keyword,
      pg: String(page),
    });

    if (data && data.list) {
      applyImageProxyToList(data.list, baseURL);
    }

    return data;
  } catch (error) {
    OmniBox.log("error", `搜索视频失败: ${error.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

/**
 * 详情
 */
async function detail(params, context) {
  try {
    const videoId = params.videoId || "";
    const baseURL = context?.baseURL || "";
    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    OmniBox.log("info", `获取视频详情: videoId=${videoId}`);

    const data = await requestXiaoya(VOD_PATH, {
      ac: "detail",
      ids: String(videoId),
    });

    if (!data || !Array.isArray(data.list) || data.list.length === 0) {
      OmniBox.log("warn", "详情接口返回为空或无列表数据");
      return { list: [] };
    }

    const firstItem = data.list[0] || {};
    const vodPlayFrom = String(firstItem.vod_play_from || firstItem.VodPlayFrom || "");
    const vodPlayUrl = String(firstItem.vod_play_url || firstItem.VodPlayURL || "");

    OmniBox.log(
      "info",
      `详情播放字段: vod_play_from.length=${vodPlayFrom.length}, vod_play_url.length=${vodPlayUrl.length}`
    );

    if (vodPlayFrom && vodPlayUrl) {
      const vodId = String(firstItem.vod_id || firstItem.VodID || videoId);
      const vodPlaySources = convertToPlaySources(vodPlayFrom, vodPlayUrl, vodId);
      OmniBox.log("info", `转换播放源完成: sources=${vodPlaySources.length}`);

      for (const item of data.list) {
        item.vod_play_sources = vodPlaySources;
      }
    } else if (firstItem.vod_play_sources) {
      OmniBox.log("info", "详情已包含 vod_play_sources, 跳过转换");
    } else {
      OmniBox.log("warn", "详情缺少播放字段，可能导致无播放按钮");
    }

    applyImageProxyToList(data.list, baseURL);

    // 刮削处理
    try {
      const currentItem = data.list[0] || {};
      const vodId = String(currentItem.vod_id || currentItem.VodID || videoId);
      const vodName = String(currentItem.vod_name || currentItem.VodName || "");
      const playSources = currentItem.vod_play_sources || [];

      const filesForScraping = [];
      for (const source of playSources) {
        const episodes = source?.episodes || [];
        for (const episode of episodes) {
          const rawName = String(episode.name || episode.rawName || "");
          const playId = String(episode.playId || "");
          if (!playId) continue;
          const formattedId = `${vodId}|${playId}`;
          filesForScraping.push({
            file_name: rawName,
            fid: formattedId,
            file_id: formattedId,
          });
        }
      }

      if (filesForScraping.length > 0) {
        OmniBox.log("info", `开始执行刮削处理: vodId=${vodId}, files=${filesForScraping.length}`);
        await OmniBox.processScraping(vodId, vodName, "", filesForScraping);
      }
    } catch (error) {
      OmniBox.log("warn", `刮削处理失败: ${error.message}`);
    }

    // 应用刮削后的元数据
    try {
      const currentItem = data.list[0] || {};
      const vodId = String(currentItem.vod_id || currentItem.VodID || videoId);
      const metadata = await OmniBox.getScrapeMetadata(vodId);
      const scrapeData = metadata?.scrapeData || null;
      const videoMappings = metadata?.videoMappings || [];

      if (scrapeData || (videoMappings && videoMappings.length > 0)) {
        const playSources = currentItem.vod_play_sources || [];
        for (const source of playSources) {
          const episodes = source?.episodes || [];
          for (const episode of episodes) {
            const playId = String(episode.playId || "");
            const formattedId = `${vodId}|${playId}`;
            let matchedMapping = null;
            for (const mapping of videoMappings) {
              if (mapping && mapping.fileId === formattedId) {
                matchedMapping = mapping;
                break;
              }
            }

            if (matchedMapping && scrapeData) {
              const originalName = String(episode.name || "");
              const newName = buildScrapedFileName(scrapeData, matchedMapping, originalName);
              if (newName && newName !== originalName) {
                episode.name = newName;
              }
            }

            const normalizedOriginalEpisodeName = normalizeEpisodeName(episode.rawName || episode.name || "");
            const playMeta = encodePlayMeta({
              t: String(currentItem.vod_name || currentItem.VodName || ""),
              e: normalizedOriginalEpisodeName,
            });
            if (playMeta && playId && !String(playId).includes("|||")) {
              episode.playId = `${playId}|||${playMeta}`;
            }
          }
        }

        if (scrapeData) {
          if (scrapeData.title) {
            currentItem.vod_name = scrapeData.title;
          }
          if (scrapeData.posterPath) {
            currentItem.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
          }
          if (scrapeData.releaseDate) {
            currentItem.vod_year = scrapeData.releaseDate.substring(0, 4) || "";
          }
          if (scrapeData.overview) {
            currentItem.vod_content = scrapeData.overview;
          }
          if (scrapeData.voteAverage) {
            currentItem.vod_douban_score = scrapeData.voteAverage.toFixed(1);
          }
        }
      }
    } catch (error) {
      OmniBox.log("warn", `应用刮削元数据失败: ${error.message}`);
    }

    return data;
  } catch (error) {
    OmniBox.log("error", `获取视频详情失败: ${error.message}`);
    return { list: [] };
  }
}

function isValidUrl(str) {
  // 空值直接返回 false
  if (!str) return false;

  try {
    // 尝试用字符串构造 URL 对象
    const url = new URL(str);

    // 必须包含协议（http/https/ftp 等）才判定为有效 URL
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    // 解析失败说明不是合法 URL
    return false;
  }
}

/**
 * 播放
 */
async function play(params, context) {
  try {
    const playId = params.playId || params.id || "";
    const flag = params.flag || "";

    if (!playId) {
      throw new Error("播放参数不能为空");
    }

    let mainPlayId = playId;
    let metaPart = "";
    if (playId.includes("|||")) {
      const splitParts = playId.split("|||");
      mainPlayId = splitParts[0] || "";
      metaPart = splitParts[1] || "";
    }

    const playMeta = decodePlayMeta(metaPart);
    const originalTitle = playMeta.t || playMeta.v || playMeta.title || "";
    const originalEpisodeName = playMeta.e || playMeta.episodeName || "";

    OmniBox.log("info", `获取播放地址: playId=${mainPlayId}, flag=${flag}`);

    if (/\.(m3u8|mp4|rmvb|avi|wmv|flv|mkv|webm|mov|m3u|mp3)(?!\w)/i.test(mainPlayId)) {
      return {
        urls: [{ name: "播放", url: mainPlayId }],
        header: {},
        parse: 0};
    }

    if (isValidUrl(mainPlayId)) {
      mainPlayId = mainPlayId.split('/').pop()
    }

    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
        scrapeTitle: "",
      };
      const vodId = params.vodId || "";
      if (!vodId) return result;

      try {
        const metadata = await OmniBox.getScrapeMetadata(vodId);
        if (metadata && metadata.scrapeData && metadata.videoMappings) {
          const formattedFileId = `${vodId}|${mainPlayId}`;
          let matchedMapping = null;
          for (const mapping of metadata.videoMappings) {
            if (mapping.fileId === formattedFileId) {
              matchedMapping = mapping;
              break;
            }
          }

          if (metadata.scrapeData) {
            result.scrapeTitle = metadata.scrapeData.title || "";
          }

          if (matchedMapping && metadata.scrapeData) {
            const scrapeData = metadata.scrapeData;
            let fileName = "";
            const scrapeType = metadata.scrapeType || "";
            if (scrapeType === "movie") {
              fileName = scrapeData.title || "";
            } else {
              const title = scrapeData.title || "";
              const seasonAirYear = scrapeData.seasonAirYear || "";
              const seasonNumber = matchedMapping.seasonNumber || 1;
              const epNum = matchedMapping.episodeNumber || 1;
              fileName = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
            }

            if (fileName) {
              OmniBox.log("info", `生成fileName用于弹幕匹配: ${fileName}`);
              result.danmakuList = await OmniBox.getDanmakuByFileName(fileName);
            }
          }
        }
      } catch (error) {
        OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
      }

      return result;
    })();

    const [playResult, metadataResult] = await Promise.allSettled([
      requestXiaoya(PLAY_PATH, { id: mainPlayId }),
      metadataPromise,
    ]);
    if (playResult.status !== "fulfilled") {
      throw playResult.reason || new Error("获取播放地址失败");
    }

    const data = playResult.value;
    const urls = buildPlayUrls(data.url);
    const header = typeof data.header === "string" ? JSON.parse(data.header) : data.header || {};

    OmniBox.log("info", `urls:${JSON.stringify(urls)}`)

    let danmakuList = [];
    let scrapeTitle = "";
    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
      scrapeTitle = metadataResult.value.scrapeTitle || "";
    }

    if (!danmakuList || danmakuList.length === 0) {
      const fallbackFromVodId = parseVodIdForFallback(params.vodId || "");
      const rawFallbackEpisodeName = originalEpisodeName || params.episodeName || fallbackFromVodId.episodeName || "";
      const fallbackEpisodeName = normalizeEpisodeName(rawFallbackEpisodeName);
      const fallbackTitle = originalTitle || params.title || scrapeTitle || fallbackFromVodId.title || "";
      const fallbackFileName = buildFileNameForDanmu(fallbackTitle, fallbackEpisodeName) || fallbackTitle || fallbackEpisodeName;
      if (fallbackFileName) {
        try {
          OmniBox.log("info", `使用兜底文件名进行弹幕匹配: ${fallbackFileName}`);
          danmakuList = await OmniBox.getDanmakuByFileName(fallbackFileName);
        } catch (error) {
          OmniBox.log("warn", `兜底弹幕匹配失败: ${error.message}`);
        }
      }
    }

    return {
      urls,
      header,
      parse: 0,
      danmaku: danmakuList};
  } catch (error) {
    OmniBox.log("error", `播放接口失败: ${error.message}`);
    return {
      urls: [],
      header: {},
      danmaku: []};
  }
}

module.exports = {
  home,
  category,
  search,
  detail,
  play,
};

const runner = require("spider_runner");
runner.run(module.exports);
