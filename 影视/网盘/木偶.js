// @name 玩偶系模板
// 引入 OmniBox SDK
const OmniBox = require("omnibox_sdk");
// 引入 cheerio(用于 HTML 解析)
let cheerio;
try {
  cheerio = require("cheerio");
} catch (error) {
  throw new Error("cheerio 模块未找到,请先安装:npm install cheerio");
}
let axios;
try {
  axios = require("axios");
} catch (error) {
  throw new Error("axios 模块未找到,请先安装:npm install axios");
}
const https = require("https");
const fs = require("fs");

// ==================== 配置区域 ====================
// 网站地址(可以通过环境变量配置,支持多个域名用;分割)
const WEB_SITE_CONFIG = process.env.WEB_SITE_MUOU || "https://www.muou.site;https://www.muou.asia;https://666.666291.xyz;";
const WEB_SITES = WEB_SITE_CONFIG.split(';').map(url => url.trim()).filter(url => url);
// 筛选配置: 环境变量 -> 本地文件 -> 远程链接
const FILTERS_PATH_REMOTE = "https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/blob/main/%E9%85%8D%E7%BD%AE/%E7%AD%9B%E9%80%89/mogg.json";
const FILTERS_PATH_LOCAL = "/app/static/js/mogg.json";
const FILTERS_WOGG = process.env.FILTERS_WOGG || (fs.existsSync(FILTERS_PATH_LOCAL)
  ? fs.readFileSync(FILTERS_PATH_LOCAL, "utf-8")
  : FILTERS_PATH_REMOTE);
// 读取环境变量:支持多个网盘类型,用分号分割
const DRIVE_TYPE_CONFIG = (process.env.DRIVE_TYPE_CONFIG || "quark;uc").split(';').map(t => t.trim()).filter(t => t);
// 读取环境变量:线路名称和顺序,用分号分割
const SOURCE_NAMES_CONFIG = (process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连").split(';').map(s => s.trim()).filter(s => s);
// ==================== 配置区域结束 ====================

if (WEB_SITES.length === 0) {
  throw new Error("WEB_SITE 配置不能为空");
}

OmniBox.log("info", `配置了 ${WEB_SITES.length} 个域名: ${WEB_SITES.join(', ')}`);

const INSECURE_HTTPS_AGENT = new https.Agent({
  rejectUnauthorized: false,
});

async function httpRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  const response = await axios({
    url,
    method,
    headers: options.headers || {},
    data: options.body,
    timeout: options.timeout,
    httpsAgent: INSECURE_HTTPS_AGENT,
    validateStatus: () => true,
  });

  let body = response.data;
  if (typeof body !== "string") {
    body = body === undefined || body === null ? "" : JSON.stringify(body);
  }

  return {
    statusCode: response.status,
    body,
    headers: response.headers || {},
  };
}

function isBlockedHtml(body = "") {
  if (!body || typeof body !== "string") {
    return false;
  }
  const lower = body.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("cf-browser-verification") ||
    lower.includes("cloudflare") ||
    lower.includes("captcha") ||
    lower.includes("访问验证")
  );
}

/**
 * 带容灾的请求函数
 */
async function requestWithFailover(path, options = {}) {
  let lastError = null;
  const perDomainTimeout = Math.max(1000, Math.floor(30000 / WEB_SITES.length));

  for (let i = 0; i < WEB_SITES.length; i++) {
    const baseUrl = removeTrailingSlash(WEB_SITES[i]);
    const fullUrl = path.startsWith('http') ? path : baseUrl + path;

    try {
      OmniBox.log("info", `尝试请求域名 ${i + 1}/${WEB_SITES.length}: ${fullUrl}, timeout=${options.timeout ?? perDomainTimeout}ms`);

      const response = await httpRequest(fullUrl, {
        ...options,
        method: options.method || "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          ...(options.headers || {}),
        },
        timeout: options.timeout ?? perDomainTimeout,
      });

      if (response.statusCode === 200 && response.body) {
        if (isBlockedHtml(response.body)) {
          OmniBox.log("warn", `域名 ${baseUrl} 命中风控页,切换下一个域名`);
          lastError = new Error("命中风控页面");
          continue;
        }
        OmniBox.log("info", `域名 ${baseUrl} 请求成功`);
        return { response, baseUrl };
      } else {
        OmniBox.log("warn", `域名 ${baseUrl} 返回非200状态码: ${response.statusCode}`);
        lastError = new Error(`HTTP ${response.statusCode}`);
      }
    } catch (error) {
      OmniBox.log("warn", `域名 ${baseUrl} 请求失败: ${error.message}`);
      lastError = error;

      if (i < WEB_SITES.length - 1) {
        continue;
      }
    }
  }

  throw lastError || new Error("所有域名请求均失败");
}

function getBaseUrl() {
  return removeTrailingSlash(WEB_SITES[0]);
}

async function getDynamicFilters() {
  const config = FILTERS_WOGG;
  const defaultFilters = {};

  if (config) {
    if (config.startsWith('http')) {
      try {
        OmniBox.log("info", `正在从远程链接读取过滤器: ${config}`);
        const response = await httpRequest(config, {
          method: "GET",
          headers: {
            "Accept": "application/json; charset=utf-8"
          }
        });
        if (response.statusCode === 200 && response.body) {
          const rawFilters = JSON.parse(response.body);

          const formattedFilters = {};
          for (const typeId in rawFilters) {
            formattedFilters[typeId] = rawFilters[typeId].map(group => ({
              key: group.key,
              name: group.n || group.name,
              init: group.init,
              value: (group.v || group.value || []).map(item => ({
                name: item.n || item.name,
                value: item.v || item.value
              }))
            }));
          }
          return formattedFilters;
        }
      } catch (error) {
        OmniBox.log("error", `远程过滤器读取失败: ${error.message}`);
      }
    } else {
      try {
        return JSON.parse(config);
      } catch (error) {
        OmniBox.log("error", `解析环境变量 FILTERS_WOGG 失败: ${error.message}`);
      }
    }
  }
  return defaultFilters;
}

function removeTrailingSlash(url) {
  if (!url) return "";
  return url.replace(/\/+$/, "");
}

// ==================== 自动筛选提取 ====================
const FILTER_KEY_NAME_MAP = {
  class: "类型",
  area: "地区",
  lang: "语言",
  year: "年份",
  letter: "字母",
  by: "排序",
  sort: "排序",
  id: "分类"
};

let autoFiltersCache = {
  data: null,
  expiresAt: 0,
};

function normalizeFilterValueItem(item) {
  if (!item) return null;
  const name = String(item.n || item.name || "").trim();
  const value = String(item.v ?? item.value ?? "").trim();
  if (!name && !value) return null;
  return { name, value };
}

function normalizeFilterGroup(group) {
  if (!group) return null;
  const key = String(group.key || "").trim();
  const name = String(group.n || group.name || "").trim();
  const valuesRaw = Array.isArray(group.v) ? group.v : (Array.isArray(group.value) ? group.value : []);
  const values = valuesRaw.map(normalizeFilterValueItem).filter(Boolean);
  if (!key || values.length === 0) return null;

  return {
    key,
    name: name || FILTER_KEY_NAME_MAP[key] || key,
    init: String(group.init ?? ""),
    value: values,
  };
}

function extractFilterKeyFromHref(href = "") {
  if (!href) return null;
  for (const key of Object.keys(FILTER_KEY_NAME_MAP)) {
    if (href.includes(`${key}/`)) {
      return key;
    }
  }
  if (href.includes("id/")) {
    return "id";
  }
  return null;
}

function extractFilterValueFromHref(href = "", key = "") {
  if (!href || !key) return "";
  const marker = `${key}/`;
  const idx = href.indexOf(marker);
  if (idx < 0) return "";
  const rest = href.substring(idx + marker.length);
  return decodeURIComponent((rest.split('/')[0] || "").split('.')[0] || "");
}

function parseFiltersFromHtml(html = "") {
  if (!html) return [];
  const $ = cheerio.load(html);
  const groups = [];

  const libraryBoxes = $(".library-box.scroll-box").slice(1);
  libraryBoxes.each((_, element) => {
    const links = $(element).find(".library-list a");
    if (!links || links.length === 0) return;

    const firstHref = links.first().attr("href") || "";
    const key = extractFilterKeyFromHref(firstHref);
    if (!key) return;

    const values = [{ name: "全部", value: "" }];
    const dedupe = new Set(["__ALL__"]);

    links.each((__, a) => {
      const href = $(a).attr("href") || "";
      if (!href) return;
      const value = extractFilterValueFromHref(href, key);
      const name = ($(a).text() || "").trim();
      const dedupeKey = `${name}::${value}`;
      if (!name && !value) return;
      if (dedupe.has(dedupeKey)) return;
      dedupe.add(dedupeKey);
      values.push({ name, value });
    });

    if (values.length > 1) {
      groups.push({
        key,
        name: FILTER_KEY_NAME_MAP[key] || key,
        init: "",
        value: values,
      });
    }
  });

  return groups;
}

async function getAutoFiltersByCategory(categoryId) {
  if (!categoryId) return [];
  try {
    const path = `/index.php/vod/show/id/${categoryId}.html`;
    const { response } = await requestWithFailover(path);
    if (response.statusCode !== 200 || !response.body) {
      return [];
    }
    return parseFiltersFromHtml(response.body);
  } catch (error) {
    OmniBox.log("warn", `自动提取分类筛选失败: categoryId=${categoryId}, err=${error.message}`);
    return [];
  }
}

function normalizeStaticFilters(rawFilters) {
  const result = {};
  if (!rawFilters || typeof rawFilters !== "object") return result;

  for (const typeId of Object.keys(rawFilters)) {
    const groups = Array.isArray(rawFilters[typeId]) ? rawFilters[typeId] : [];
    const normalizedGroups = groups.map(normalizeFilterGroup).filter(Boolean);
    if (normalizedGroups.length > 0) {
      result[typeId] = normalizedGroups;
    }
  }
  return result;
}

async function getPreferredFilters(classes = []) {
  const now = Date.now();
  if (autoFiltersCache.data && now < autoFiltersCache.expiresAt) {
    return autoFiltersCache.data;
  }

  const autoFilters = {};
  for (const cls of classes) {
    const typeId = String(cls?.type_id || "").trim();
    if (!typeId) continue;
    const groups = await getAutoFiltersByCategory(typeId);
    if (groups.length > 0) {
      autoFilters[typeId] = groups;
    }
  }

  const staticFilters = normalizeStaticFilters(await getDynamicFilters());
  const merged = {
    ...staticFilters,
    ...autoFilters,
  };

  if (Object.keys(autoFilters).length > 0) {
    OmniBox.log("info", `自动提取筛选成功: ${Object.keys(autoFilters).length} 个分类，优先覆盖静态配置`);
  } else {
    OmniBox.log("warn", "自动提取筛选为空，回退到原有静态筛选逻辑");
  }

  autoFiltersCache = {
    data: merged,
    expiresAt: now + 10 * 60 * 1000,
  };

  return merged;
}

function isVideoFile(file) {
  if (!file || !file.file_name) {
    return false;
  }

  const fileName = file.file_name.toLowerCase();
  const videoExtensions = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];

  for (const ext of videoExtensions) {
    if (fileName.endsWith(ext)) {
      return true;
    }
  }

  if (file.format_type) {
    const formatType = String(file.format_type).toLowerCase();
    if (formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264")) {
      return true;
    }
  }

  return false;
}

async function getAllVideoFiles(shareURL, files, errors = []) {
  if (!files || !Array.isArray(files)) {
    return [];
  }

  const tasks = files.map(async (file) => {
    if (file.file && isVideoFile(file)) {
      return [file];
    } else if (file.dir) {
      const startTime = performance.now();

      try {
        const subFileList = await OmniBox.getDriveFileList(shareURL, file.fid);
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        OmniBox.log("info", `获取目录 [${file.name || file.fid}] 耗时: ${duration}ms`);

        if (subFileList?.files && Array.isArray(subFileList.files)) {
          return await getAllVideoFiles(shareURL, subFileList.files, errors);
        }
        return [];
      } catch (error) {
        const endTime = performance.now();
        const duration = (endTime - startTime).toFixed(2);

        const errorInfo = {
          path: file.name || file.fid,
          fid: file.fid,
          message: error.message,
          duration: `${duration}ms`,
          timestamp: new Date().toISOString()
        };
        errors.push(errorInfo);
        OmniBox.log("warn", `获取子目录失败 [${file.name || file.fid}] 耗时: ${duration}ms, 错误: ${error.message}`);
        return [];
      }
    }
    return [];
  });

  const results = await Promise.all(tasks);
  return results.flat();
}

function formatFileSize(size) {
  if (!size || size <= 0) {
    return "";
  }

  const unit = 1024;
  const units = ["B", "K", "M", "G", "T", "P"];

  if (size < unit) {
    return `${size}B`;
  }

  let exp = 0;
  let sizeFloat = size;
  while (sizeFloat >= unit && exp < units.length - 1) {
    sizeFloat /= unit;
    exp++;
  }

  if (sizeFloat === Math.floor(sizeFloat)) {
    return `${Math.floor(sizeFloat)}${units[exp]}`;
  }
  return `${sizeFloat.toFixed(2)}${units[exp]}`;
}

async function home(params) {
  try {
    OmniBox.log("info", "获取首页数据");

    let classes = [];
    let list = [];

    try {
      const { response, baseUrl } = await requestWithFailover('/');

      if (response.statusCode === 200 && response.body) {
        const $ = cheerio.load(response.body);

        const tabItems = $(".module-tab-items .module-tab-item");
        tabItems.each((_, element) => {
          const $item = $(element);
          const typeId = $item.attr("data-id");
          const typeName = $item.attr("data-name");

          if (typeId && typeId !== "0" && typeName) {
            classes.push({
              type_id: typeId,
              type_name: typeName.trim(),
            });
          }
        });

        OmniBox.log("info", `从首页导航提取到 ${classes.length} 个分类`);

        const firstModule = $(".module").first();

        if (firstModule.length > 0) {
          const moduleItems = firstModule.find(".module-item");

          moduleItems.each((_, element) => {
            const $item = $(element);
            const href = $item.find(".module-item-pic a").attr("href") || $item.find(".module-item-title").attr("href");
            const vodName = $item.find(".module-item-pic img").attr("alt") || $item.find(".module-item-title").attr("title") || $item.find(".module-item-title").text().trim();

            let vodPic = $item.find(".module-item-pic img").attr("data-src") || $item.find(".module-item-pic img").attr("src");
            if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
              vodPic = baseUrl + vodPic;
            }

            const vodRemarks = $item.find(".module-item-text").text().trim();
            const vodYear = $item.find(".module-item-caption span").first().text().trim();

            if (href && vodName) {
              list.push({
                vod_id: href,
                vod_name: vodName,
                vod_pic: vodPic || "",
                type_id: "",
                type_name: "",
                vod_remarks: vodRemarks || "",
                vod_year: vodYear || "",
              });
            }
          });

          OmniBox.log("info", `从首页提取到 ${list.length} 个影片`);
        }
      }
    } catch (error) {
      OmniBox.log("warn", `从首页提取数据失败: ${error.message}`);
    }

    const currentFilters = await getPreferredFilters(classes);
    return {
      class: classes,
      list: list,
      filters: currentFilters,
    };
  } catch (error) {
    OmniBox.log("error", `获取首页数据失败: ${error.message}`);
  }
}

async function category(params) {
  try {
    const categoryId = params.categoryId || params.type_id || "";
    const page = parseInt(params.page || "1", 10);
    const filters = params.filters || {};

    OmniBox.log("info", `获取分类数据: categoryId=${categoryId}, page=${page}`);

    if (!categoryId) {
      OmniBox.log("warn", "分类ID为空");
      return {
        list: [],
        page: 1,
        pagecount: 0,
        total: 0,
      };
    }

    let url = '/index.php/vod/show';
    if (filters.area) {
      url += `/area/${filters.area}`;
    }
    const sortValue = filters.sort || filters.by;
    if (sortValue) {
      url += `/by/${sortValue}`;
    }
    if (filters.class) {
      url += `/class/${filters.class}`;
    }
    if (filters.lang) {
      url += `/lang/${filters.lang}`;
    }
    if (filters.letter) {
      url += `/letter/${filters.letter}`;
    }
    if (filters.year) {
      url += `/year/${filters.year}`;
    }
    const tidValue = filters.tid || filters.id;
    if (tidValue) {
      url += `/id/${tidValue}.html`;
    } else {
      url += `/id/${categoryId}/page/${page}.html`;
    }

    const { response, baseUrl } = await requestWithFailover(url);

    if (response.statusCode !== 200 || !response.body) {
      OmniBox.log("error", `请求失败: HTTP ${response.statusCode}`);
      return {
        list: [],
        page: page,
        pagecount: 0,
        total: 0,
      };
    }

    const $ = cheerio.load(response.body);
    const videos = [];

    const vodItems = $("#main .module-item");
    vodItems.each((_, e) => {
      const $item = $(e);
      const href = $item.find(".module-item-pic a").attr("href");
      const vodName = $item.find(".module-item-pic img").attr("alt");
      let vodPic = $item.find(".module-item-pic img").attr("data-src");
      if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
        vodPic = baseUrl + vodPic;
      }
      const vodRemarks = $item.find(".module-item-text").text();
      const vodYear = $item.find(".module-item-caption span").first().text();

      if (href && vodName) {
        videos.push({
          vod_id: href,
          vod_name: vodName,
          vod_pic: vodPic || "",
          type_id: categoryId,
          type_name: "",
          vod_remarks: vodRemarks || "",
          vod_year: vodYear || "",
        });
      }
    });

    OmniBox.log("info", `解析完成,找到 ${videos.length} 个视频`);

    const autoFilters = parseFiltersFromHtml(response.body);
    let categoryFilters = autoFilters;

    if (categoryFilters.length === 0) {
      const preferredFilters = await getPreferredFilters([{ type_id: categoryId, type_name: "" }]);
      categoryFilters = preferredFilters[categoryId] || [];
    }

    const result = {
      list: videos,
      page: page,
      pagecount: 0,
      total: videos.length,
    };

    if (page === 1 && categoryFilters.length > 0) {
      result.filters = categoryFilters;
    }

    return result;
  } catch (error) {
    OmniBox.log("error", `获取分类数据失败: ${error.message}`);
    return {
      list: [],
      page: params.page || 1,
      pagecount: 0,
      total: 0,
    };
  }
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
 * 获取视频详情
 */
async function detail(params) {
  try {
    const videoId = params.videoId || "";

    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    const source = params.source || "";
    OmniBox.log("info", `获取视频详情: videoId=${videoId}, source=${source}`);

    const { response, baseUrl } = await requestWithFailover(videoId);

    if (response.statusCode !== 200 || !response.body) {
      throw new Error(`请求失败: HTTP ${response.statusCode}`);
    }

    const $ = cheerio.load(response.body);

    let vodName = $(".page-title")[0]?.children?.[0]?.data || "";
    let vodPic = $($(".mobile-play")).find(".lazyload")[0]?.attribs?.["data-src"] || "";
    if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
      vodPic = baseUrl + vodPic;
    }

    let vodYear = "";
    let vodDirector = "";
    let vodActor = "";
    let vodContent = "";

    const videoItems = $(".video-info-itemtitle");
    for (const item of videoItems) {
      const key = $(item).text();
      const vItems = $(item).next().find("a");
      const value = vItems
        .map((i, el) => {
          const text = $(el).text().trim();
          return text ? text : null;
        })
        .get()
        .filter(Boolean)
        .join(", ");

      if (key.includes("剧情")) {
        vodContent = $(item).next().find("p").text().trim();
      } else if (key.includes("导演")) {
        vodDirector = value.trim();
      } else if (key.includes("主演")) {
        vodActor = value.trim();
      }
    }

    const panUrls = [];
    const items = $(".module-row-info");
    for (const item of items) {
      const shareUrl = $(item).find("p")[0]?.children?.[0]?.data;
      if (shareUrl) {
        panUrls.push(shareUrl.trim());
      }
    }

    OmniBox.log("info", `解析完成,找到 ${panUrls.length} 个网盘链接`);

    const playSources = [];

    const driveTypeCountMap = {};
    for (const shareURL of panUrls) {
      const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
      const displayName = driveInfo.displayName || "未知网盘";
      driveTypeCountMap[displayName] = (driveTypeCountMap[displayName] || 0) + 1;
    }

    const driveTypeCurrentIndexMap = {};

    // ==================== 并行处理网盘链接 ====================
    const panUrlTasks = panUrls.map(async (shareURL) => {
      try {
        OmniBox.log("info", `处理网盘链接: ${shareURL}`);

        const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
        let displayName = driveInfo.displayName || "未知网盘";

        const totalCount = driveTypeCountMap[displayName] || 0;
        if (totalCount > 1) {
          driveTypeCurrentIndexMap[displayName] = (driveTypeCurrentIndexMap[displayName] || 0) + 1;
          displayName = `${displayName}${driveTypeCurrentIndexMap[displayName]}`;
        }

        OmniBox.log("info", `网盘类型: ${displayName}, driveType: ${driveInfo.driveType}`);

        const fileList = await OmniBox.getDriveFileList(shareURL, "0");
        if (!fileList || !fileList.files || !Array.isArray(fileList.files)) {
          OmniBox.log("warn", `获取文件列表失败: ${shareURL}`);
          return null;
        }

        OmniBox.log("info", `获取文件列表成功,文件数量: ${fileList.files.length}`);

        const allVideoFiles = await getAllVideoFiles(shareURL, fileList.files, "0");

        if (allVideoFiles.length === 0) {
          OmniBox.log("warn", `未找到视频文件: ${shareURL}`);
          return null;
        }

        OmniBox.log("info", `递归获取视频文件完成,视频文件数量: ${allVideoFiles.length}`);

        // 刮削处理
        let scrapingSuccess = false;
        // 以视频ID作为刮削资源ID，保证同一条目下刮削结果稳定复用
        const sourceId = `spider_source_${await OmniBox.getSourceId()}_${videoId}`;

        try {
          OmniBox.log("info", `开始执行刮削处理,资源名: ${vodName}, 视频文件数: ${allVideoFiles.length}`);

          const videoFilesForScraping = allVideoFiles.map((file) => {
            const fileId = file.fid || file.file_id || "";
            const formattedFileId = fileId ? `${shareURL}|${fileId}` : fileId;
            return {
              ...file,
              fid: formattedFileId,
              file_id: formattedFileId,
            };
          });

          OmniBox.log("info", `文件ID格式转换完成,示例: ${videoFilesForScraping[0]?.fid || "N/A"}`);

          const scrapingResult = await OmniBox.processScraping(sourceId, vodName, vodName, videoFilesForScraping);
          OmniBox.log("info", `刮削处理完成,结果: ${JSON.stringify(scrapingResult).substring(0, 200)}`);
          scrapingSuccess = true;
        } catch (error) {
          OmniBox.log("error", `刮削处理失败: ${error.message}`);
          if (error.stack) {
            OmniBox.log("error", `刮削错误堆栈: ${error.stack}`);
          }
        }

        // 获取刮削后的元数据
        let scrapeData = null;
        let videoMappings = [];
        let scrapeType = "";

        try {
          OmniBox.log("info", `开始获取元数据,resourceId: ${sourceId}`);
          const metadata = await OmniBox.getScrapeMetadata(sourceId);
          OmniBox.log("info", `获取元数据响应: ${JSON.stringify(metadata).substring(0, 500)}`);

          scrapeData = metadata.scrapeData || null;
          videoMappings = metadata.videoMappings || [];
          scrapeType = metadata.scrapeType || "";

          if (scrapeData) {
            OmniBox.log("info", `获取到刮削数据,标题: ${scrapeData.title || "未知"}, 类型: ${scrapeType || "未知"}, 映射数量: ${videoMappings.length}`);
          } else {
            OmniBox.log("warn", `未获取到刮削数据,映射数量: ${videoMappings.length}`);
          }
        } catch (error) {
          OmniBox.log("error", `获取元数据失败: ${error.message}`);
          if (error.stack) {
            OmniBox.log("error", `获取元数据错误堆栈: ${error.stack}`);
          }
        }

        return {
          shareURL,
          displayName,
          driveInfo,
          allVideoFiles,
          scrapeData,
          videoMappings,
          scrapeType,
          sourceId
        };

      } catch (error) {
        OmniBox.log("error", `处理网盘链接失败: ${shareURL}, 错误: ${error.message}`);
        return null;
      }
    });

    // 等待所有网盘链接并行处理完成
    const panUrlResults = await Promise.all(panUrlTasks);

    // 处理结果并构建播放源
    for (const result of panUrlResults) {
      if (!result) continue;

      const { shareURL, displayName, driveInfo, allVideoFiles, scrapeData, videoMappings, scrapeType } = result;

      let sourceNames = [displayName];
      const targetDriveTypes = DRIVE_TYPE_CONFIG;
      const configSourceNames = SOURCE_NAMES_CONFIG;

      if (targetDriveTypes.includes(driveInfo.driveType)) {
        sourceNames = [...configSourceNames];
        OmniBox.log("info", `${displayName} 匹配成功,线路设置为: ${sourceNames.join(", ")}`);

        if (source === "web") {
          sourceNames = sourceNames.filter((name) => name !== "本地代理");
          OmniBox.log("info", `来源为网页端,已过滤线路`);
        }
      }

      for (const sourceName of sourceNames) {
        const episodes = [];
        for (const file of allVideoFiles) {
          let fileName = file.file_name || "";
          const fileId = file.fid || "";
          const fileSize = file.size || file.file_size || 0;

          if (!fileName || !fileId) {
            continue;
          }

          const formattedFileId = fileId ? `${shareURL}|${fileId}` : "";

          let matchedMapping = null;
          if (scrapeData && videoMappings && Array.isArray(videoMappings) && videoMappings.length > 0) {
            for (const mapping of videoMappings) {
              if (mapping && mapping.fileId === formattedFileId) {
                matchedMapping = mapping;
                const newFileName = buildScrapedFileName(scrapeData, mapping, fileName);
                if (newFileName && newFileName !== fileName) {
                  fileName = newFileName;
                  OmniBox.log("info", `应用刮削文件名: ${file.file_name} -> ${fileName}`);
                }
                break;
              }
            }
          }

          let displayFileName = fileName;
          if (fileSize > 0) {
            const fileSizeStr = formatFileSize(fileSize);
            if (fileSizeStr) {
              displayFileName = `[${fileSizeStr}] ${fileName}`;
            }
          }

          const episode = {
            name: displayFileName,
            playId: `${shareURL}|${fileId}`,
            size: fileSize > 0 ? fileSize : undefined,
          };

          if (matchedMapping) {
            if (matchedMapping.seasonNumber !== undefined && matchedMapping.seasonNumber !== null) {
              episode._seasonNumber = matchedMapping.seasonNumber;
            }
            if (matchedMapping.episodeNumber !== undefined && matchedMapping.episodeNumber !== null) {
              episode._episodeNumber = matchedMapping.episodeNumber;
            }
            if (matchedMapping.episodeName) {
              episode.episodeName = matchedMapping.episodeName;
            }
            if (matchedMapping.episodeOverview) {
              episode.episodeOverview = matchedMapping.episodeOverview;
            }
            if (matchedMapping.episodeAirDate) {
              episode.episodeAirDate = matchedMapping.episodeAirDate;
            }
            if (matchedMapping.episodeStillPath) {
              episode.episodeStillPath = matchedMapping.episodeStillPath;
            }
            if (matchedMapping.episodeVoteAverage !== undefined && matchedMapping.episodeVoteAverage !== null) {
              episode.episodeVoteAverage = matchedMapping.episodeVoteAverage;
            }
            if (matchedMapping.episodeRuntime !== undefined && matchedMapping.episodeRuntime !== null) {
              episode.episodeRuntime = matchedMapping.episodeRuntime;
            }
          }

          episodes.push(episode);
        }

        if (scrapeData && episodes.length > 0) {
          const hasEpisodeNumber = episodes.some((ep) => ep._episodeNumber !== undefined);
          if (hasEpisodeNumber) {
            OmniBox.log("info", `检测到刮削数据,按 episodeNumber 排序剧集列表,共 ${episodes.length} 集`);
            episodes.sort((a, b) => {
              const seasonA = a._seasonNumber !== undefined ? a._seasonNumber : 0;
              const seasonB = b._seasonNumber !== undefined ? b._seasonNumber : 0;
              if (seasonA !== seasonB) {
                return seasonA - seasonB;
              }
              const episodeA = a._episodeNumber !== undefined ? a._episodeNumber : 0;
              const episodeB = b._episodeNumber !== undefined ? b._episodeNumber : 0;
              return episodeA - episodeB;
            });
          }
        }

        if (episodes.length > 0) {
          let finalSourceName = sourceName;
          if (DRIVE_TYPE_CONFIG.includes(driveInfo.driveType)) {
            finalSourceName = `${displayName}-${sourceName}`;
          }

          playSources.push({
            name: finalSourceName,
            episodes: episodes,
          });
        }
      }

      // 使用刮削数据更新详情
      if (scrapeData) {
        if (scrapeData.title) {
          vodName = scrapeData.title;
        }
        if (scrapeData.posterPath) {
          vodPic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
        }
        if (scrapeData.releaseDate) {
          vodYear = scrapeData.releaseDate.substring(0, 4) || vodYear;
        }
        if (scrapeData.overview) {
          vodContent = scrapeData.overview;
        }

        if (scrapeData.credits) {
          if (scrapeData.credits.cast && Array.isArray(scrapeData.credits.cast)) {
            const actors = scrapeData.credits.cast
              .slice(0, 5)
              .map((cast) => cast.name || "")
              .filter((name) => name)
              .join(",");
            if (actors) {
              vodActor = actors;
            }
          }
          if (scrapeData.credits.crew && Array.isArray(scrapeData.credits.crew)) {
            const directors = scrapeData.credits.crew.filter((crew) => crew.job === "Director" || crew.department === "Directing");
            if (directors.length > 0) {
              const directorNames = directors
                .slice(0, 3)
                .map((director) => director.name || "")
                .filter((name) => name)
                .join(",");
              if (directorNames) {
                vodDirector = directorNames;
              }
            }
          }
        }
      }
    }

    OmniBox.log("info", `构建播放源完成,网盘数量: ${playSources.length}`);

    const vodDetail = {
      vod_id: videoId,
      vod_name: vodName,
      vod_pic: vodPic,
      vod_year: vodYear,
      vod_director: vodDirector,
      vod_actor: vodActor,
      vod_content: vodContent || `网盘资源,共${panUrls.length}个网盘链接`,
      vod_play_sources: playSources.length > 0 ? playSources : undefined,
      vod_remarks: "",
    };

    return {
      list: [vodDetail],
    };
  } catch (error) {
    OmniBox.log("error", `获取视频详情失败: ${error.message}`);
    return {
      list: [],
    };
  }
}

/**
 * 搜索视频
 */
async function search(params) {
  try {
    const keyword = params.keyword || "";
    const page = parseInt(params.page || "1", 10);

    OmniBox.log("info", `搜索视频: keyword=${keyword}, page=${page}`);

    if (!keyword) {
      OmniBox.log("warn", "搜索关键词为空");
      return {
        list: [],
        page: 1,
        pagecount: 0,
        total: 0,
      };
    }

    const searchPath = `/index.php/vod/search/page/${page}/wd/${keyword}.html`;
    const { response, baseUrl } = await requestWithFailover(searchPath);

    if (response.statusCode !== 200 || !response.body) {
      OmniBox.log("error", `请求失败: HTTP ${response.statusCode}`);
      return {
        list: [],
        page: page,
        pagecount: 0,
        total: 0,
      };
    }

    const $ = cheerio.load(response.body);
    const videos = [];

    const items = $(".module-search-item");
    for (const item of items) {
      const $item = $(item);
      const videoSerial = $item.find(".video-serial")[0];
      const vodPicImg = $item.find(".module-item-pic > img")[0];

      if (videoSerial && videoSerial.attribs) {
        const vodId = videoSerial.attribs.href || "";
        const vodName = videoSerial.attribs.title || "";
        let vodPic = vodPicImg?.attribs?.["data-src"] || "";
        if (vodPic && !vodPic.startsWith("http://") && !vodPic.startsWith("https://")) {
          vodPic = baseUrl + vodPic;
        }
        const vodRemarks = $($item.find(".video-serial")[0]).text() || "";

        if (vodId && vodName) {
          videos.push({
            vod_id: vodId,
            vod_name: vodName,
            vod_pic: vodPic,
            type_id: "",
            type_name: "",
            vod_remarks: vodRemarks,
          });
        }
      }
    }

    OmniBox.log("info", `搜索完成,找到 ${videos.length} 个结果`);

    return {
      list: videos,
      page: page,
      pagecount: 0,
      total: videos.length,
    };
  } catch (error) {
    OmniBox.log("error", `搜索视频失败: ${error.message}`);
    return {
      list: [],
      page: params.page || 1,
      pagecount: 0,
      total: 0,
    };
  }
}

async function play(params) {
  try {
    const flag = params.flag || "";
    const playId = params.playId || "";
    const source = params.source || "";

    OmniBox.log("info", `获取播放地址: flag=${flag}, playId=${playId}`);

    if (!playId) {
      throw new Error("播放参数不能为空");
    }

    const parts = playId.split("|");
    if (parts.length < 2) {
      throw new Error("播放参数格式错误,应为:分享链接|文件ID");
    }
    const shareURL = parts[0] || "";
    const fileId = parts[1] || "";

    if (!shareURL || !fileId) {
      throw new Error("分享链接或文件ID不能为空");
    }

    OmniBox.log("info", `解析参数: shareURL=${shareURL}, fileId=${fileId}`);

    let danmakuList = [];
    let scrapeTitle = "";
    let scrapePic = "";
    let episodeNumber = null;
    let episodeName = params.episodeName || "";

    try {
      // 优先使用视频ID维度读取刮削元数据，与 detail 阶段保持一致
      const sourceIdByVod = params.vodId
        ? `spider_source_${await OmniBox.getSourceId()}_${params.vodId}`
        : "";
      const sourceIdByShare = `spider_source_${await OmniBox.getSourceId()}_${shareURL}`;

      let metadata = null;
      if (sourceIdByVod) {
        metadata = await OmniBox.getScrapeMetadata(sourceIdByVod);
      }
      if (!metadata || (!metadata.scrapeData && !metadata.videoMappings)) {
        metadata = await OmniBox.getScrapeMetadata(sourceIdByShare);
      }

      if (metadata && metadata.scrapeData && metadata.videoMappings) {
        const formattedFileId = fileId ? `${shareURL}|${fileId}` : "";

        let matchedMapping = null;
        for (const mapping of metadata.videoMappings) {
          if (mapping.fileId === formattedFileId) {
            matchedMapping = mapping;
            break;
          }
        }

        if (matchedMapping && metadata.scrapeData) {
          const scrapeData = metadata.scrapeData;
          OmniBox.log("info", `找到文件映射,fileId: ${formattedFileId}`);

          scrapeTitle = scrapeData.title || "";
          if (scrapeData.posterPath) {
            scrapePic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
          }

          if (matchedMapping.episodeNumber) {
            episodeNumber = matchedMapping.episodeNumber;
          }
          if (matchedMapping.episodeName && !episodeName) {
            episodeName = matchedMapping.episodeName;
          }

          let fileName = "";
          const scrapeType = metadata.scrapeType || "";
          if (scrapeType === "movie") {
            fileName = scrapeData.title || "";
          } else {
            const title = scrapeData.title || "";
            const seasonAirYear = scrapeData.seasonAirYear || "";
            const seasonNumber = matchedMapping.seasonNumber || 1;
            const episodeNum = matchedMapping.episodeNumber || 1;
            fileName = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNum).padStart(2, "0")}`;
          }

          if (fileName) {
            OmniBox.log("info", `生成fileName用于弹幕匹配: ${fileName}`);
            danmakuList = await OmniBox.getDanmakuByFileName(fileName);
            if (danmakuList && danmakuList.length > 0) {
              OmniBox.log("info", `弹幕匹配成功,找到 ${danmakuList.length} 条弹幕`);
            }
          }
        }
      }
    } catch (error) {
      OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
    }

    let routeType = source === "web" ? "服务端代理" : "直连";
    if (flag && flag.includes("-")) {
      const parts = flag.split("-");
      routeType = parts[parts.length - 1];
    }

    OmniBox.log("info", `使用线路: ${routeType}`);

    const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);

    if (!playInfo || !playInfo.url || !Array.isArray(playInfo.url) || playInfo.url.length === 0) {
      throw new Error("无法获取播放地址");
    }

    try {
      const sourceId = await OmniBox.getSourceId();
      if (sourceId) {
        const vodId = params.vodId || shareURL;
        const title = params.title || scrapeTitle || shareURL;
        const pic = params.pic || scrapePic || "";

        const added = await OmniBox.addPlayHistory({
          vodId: vodId,
          title: title,
          pic: pic,
          episode: playId,
          sourceId: sourceId,
          episodeNumber: episodeNumber,
          episodeName: episodeName,
        });

        if (added) {
          OmniBox.log("info", `已添加观看记录: ${title}`);
        } else {
          OmniBox.log("info", `观看记录已存在,跳过添加: ${title}`);
        }
      }
    } catch (error) {
      OmniBox.log("warn", `添加观看记录失败: ${error.message}`);
    }

    const urlList = playInfo.url || [];

    let urlsResult = [];
    for (const item of urlList) {
      urlsResult.push({
        name: item.name || "播放",
        url: item.url,
      });
    }

    let header = playInfo.header || {};

    let finalDanmakuList = danmakuList && danmakuList.length > 0 ? danmakuList : playInfo.danmaku || [];

    return {
      urls: urlsResult,
      flag: shareURL,
      header: header,
      parse: 0,
      danmaku: finalDanmakuList,
    };
  } catch (error) {
    OmniBox.log("error", `播放接口失败: ${error.message}`);
    return {
      urls: [],
      flag: params.flag || "",
      header: {},
      danmaku: [],
    };
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
