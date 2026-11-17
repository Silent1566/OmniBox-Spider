// @name 盘搜
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持，网盘：115、夸克、UC、百度、天翼、移动、阿里、迅雷、123，来源：web、tvbox、uz、emby、catvod
// @version 1.3.11
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/盘搜.js
/**
 * OmniBox 网盘爬虫脚本
 *
 * 此脚本直接调用盘搜API获取搜索结果，通过OmniBox SDK获取网盘文件列表和播放地址
 * 只需要配置盘搜API地址即可使用
 *
 * 配置说明：
 * 1. 配置盘搜API地址到环境变量 PANSOU_API 中，或直接修改下面的 PANSOU_API 常量
 * 2. （可选）配置盘搜频道到环境变量 PANSOU_CHANNELS 中
 * 3. （可选）配置盘搜插件到环境变量 PANSOU_PLUGINS 中
 * 4. （可选）配置网盘类型过滤到环境变量 PANSOU_CLOUD_TYPES 中（支持逗号/分号分隔，如：baidu,aliyun,quark 或 baidu;aliyun;quark）
 * 5. （可选）配置 PanCheck API 地址到环境变量 PANCHECK_API 中，用于过滤无效链接
 * 6. （可选）配置 PanCheck 是否启用到环境变量 PANCHECK_ENABLED 中（true/false，默认：如果配置了 PANCHECK_API 则启用）
 * 7. （可选）配置 PanCheck 选择的平台到环境变量 PANCHECK_PLATFORMS 中（支持逗号/分号分隔，如：baidu,aliyun,quark 或 baidu;aliyun;quark）
 * 8. （可选）配置 PanCheck 选择的平台到环境变量 PANSOU_FILTER 中（如：{"include":["合集","全集"],"exclude":["预告"]}）
 *
 * 使用方法：
 * 1. 在 OmniBox 后台创建爬虫源，选择 JavaScript 类型
 * 2. 复制此脚本内容到爬虫源编辑器
 * 3. 配置环境变量 PANSOU_API 为盘搜API地址
 * 4. （可选）配置环境变量 PANCHECK_API 为 PanCheck API 地址，启用链接检测
 * 5. 保存并测试
 */

const OmniBox = require("omnibox_sdk");
const querystring = require('querystring');

// ==================== 配置区域 ====================
// 盘搜API地址（优先使用环境变量，如果没有则使用默认值）
// 例如：https://pansou.example.com
const PANSOU_API = process.env.PANSOU_API || "";

// 盘搜频道（可选，多个用逗号分隔）
// 例如：channel1,channel2
const PANSOU_CHANNELS = process.env.PANSOU_CHANNELS || "";

// 盘搜插件（可选，多个用逗号分隔）
// 例如：plugin1,plugin2
const PANSOU_PLUGINS = process.env.PANSOU_PLUGINS || "";

// 网盘类型过滤（可选，多个支持逗号/分号分隔）
// 例如：baidu,aliyun,quark,115,tianyi,xunlei,123,mobile,uc
// 或：baidu;aliyun;quark;115;tianyi;xunlei;123;mobile;uc
const PANSOU_CLOUD_TYPES = process.env.PANSOU_CLOUD_TYPES || "";

// 关键词过滤
// 过滤配置，用于过滤返回结果。格式：{"include":["关键词1","关键词2"],"exclude":["排除词1","排除词2"]}。include为包含关键词列表（OR关系），exclude为排除关键词列表（OR关系）
const PANSOU_FILTER = process.env.PANSOU_FILTER || { "include": [""], "exclude": [] };

// PanCheck 配置（可选，用于过滤无效链接）
// PanCheck API 地址（可选，如果配置了则启用链接检测）
// 例如：https://pancheck.example.com
const PANCHECK_API = process.env.PANCHECK_API || "";

// PanCheck 是否启用（可选，默认为 false）
// 如果配置了 PANCHECK_API，则默认启用
const PANCHECK_ENABLED = true;

// PanCheck 选择的平台（可选，多个支持逗号/分号分隔）
// 例如：baidu,aliyun,quark,115,tianyi,xunlei,123,mobile,uc
// 或：baidu;aliyun;quark;115;tianyi;xunlei;123;mobile;uc
// 如果不配置，则检测所有平台
const PANCHECK_PLATFORMS = process.env.PANCHECK_PLATFORMS || "quark,baidu,uc,pan123,tianyi,cmcc";

function splitConfigList(value) {
  return String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 网盘类型匹配配置: 支持逗号/分号分隔，例如 quark;uc 或 quark,uc
const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "quark;uc");
// 线路名称配置: 支持逗号/分号分隔，例如 本地代理;服务端代理;直连
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");
// 是否开启外网服务器代理（默认关闭）
const EXTERNAL_SERVER_PROXY_ENABLED = String(process.env.EXTERNAL_SERVER_PROXY_ENABLED || "false").toLowerCase() === "true";
// 详情页播放线路的网盘排序顺序，仅作用于 detail() 返回的播放线路
const DRIVE_ORDER = splitConfigList(process.env.DRIVE_ORDER || "baidu;tianyi;quark;uc;115;xunlei;ali;123pan").map((s) => s.toLowerCase());
// 详情链路缓存时间（秒），默认 12 小时
const PANSOU_CACHE_EX_SECONDS = Number(process.env.PANSOU_CACHE_EX_SECONDS || 43200);

// ==================== 配置区域结束 ====================

function inferDriveTypeFromSourceName(name = "") {
  const raw = String(name || "").toLowerCase();
  if (raw.includes("百度")) return "baidu";
  if (raw.includes("天翼")) return "tianyiyun";
  if (raw.includes("夸克")) return "quark";
  if (raw === "uc" || raw.includes("uc")) return "uc";
  if (raw.includes("115")) return "115";
  if (raw.includes("迅雷")) return "xunlei";
  if (raw.includes("阿里")) return "aliyun";
  if (raw.includes("移动") || raw.includes("139") || raw.includes("cmcc")) return "cmcc";
  if (raw.includes("123")) return "pan123";
  return raw;
}

function normalizePanCheckPlatform(input = "") {
  const raw = String(input || "").trim().toLowerCase();
  if (!raw) return "";
  if (raw.includes("百度") || raw === "baidu") return "baidu";
  if (raw.includes("天翼") || raw === "tianyi" || raw === "tianyiyun" || raw.includes("tianyi")) return "tianyiyun";
  if (raw.includes("夸克") || raw === "quark") return "quark";
  if (raw === "uc" || raw.includes("uc")) return "uc";
  if (raw.includes("115")) return "115";
  if (raw.includes("迅雷") || raw === "xunlei") return "xunlei";
  if (raw.includes("阿里") || raw === "ali" || raw === "aliyun" || raw === "alipan" || raw === "aliyundrive" || raw.includes("aliyun") || raw.includes("alipan")) return "aliyun";
  if (raw.includes("移动") || raw.includes("139") || raw === "cmcc" || raw === "mobile") return "cmcc";
  if (raw === "123" || raw === "123pan" || raw === "pan123" || raw.includes("123pan") || raw.includes("pan123")) return "pan123";
  return raw;
}

function inferDriveTypeFromShareURL(shareURL = "") {
  const raw = String(shareURL || "").toLowerCase();
  if (!raw) return "";
  if (raw.includes("pan.quark.cn") || raw.includes("drive.quark.cn")) return "quark";
  if (raw.includes("drive.uc.cn") || raw.includes("fast.uc.cn") || raw.includes("uc.cn")) return "uc";
  if (raw.includes("pan.baidu.com")) return "baidu";
  if (raw.includes("cloud.189.cn")) return "tianyiyun";
  if (raw.includes("yun.139.com")) return "cmcc";
  if (raw.includes("www.aliyundrive.com") || raw.includes("www.alipan.com") || raw.includes("aliyundrive.com") || raw.includes("alipan.com")) return "aliyun";
  if (raw.includes("pan.xunlei.com")) return "xunlei";
  if (raw.includes("115.com")) return "115";
  if (raw.includes("123684.com") || raw.includes("123865.com") || raw.includes("123912.com") || raw.includes("123pan.com")) return "pan123";
  return "";
}

function resolveCallerSource(params = {}, context = {}) {
  return String(context?.from || params?.source || "").toLowerCase();
}

function getBaseURLHost(context = {}) {
  const baseURL = String(context?.baseURL || "").trim();
  if (!baseURL) return "";
  try {
    return new URL(baseURL).hostname.toLowerCase();
  } catch (error) {
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

function filterSourceNamesForCaller(sourceNames = [], callerSource = "", context = {}) {
  let filtered = Array.isArray(sourceNames) ? [...sourceNames] : [];
  const allowServerProxy = canUseServerProxy(context);

  if (callerSource === "web") {
    filtered = filtered.filter((name) => name !== "本地代理");
    OmniBox.log("info", "来源为网页端，已过滤掉\"本地代理\"线路");
  } else if (callerSource === "emby") {
    if (allowServerProxy) {
      filtered = filtered.filter((name) => name === "服务端代理");
      OmniBox.log("info", "来源为 emby，网盘多线路仅保留\"服务端代理\"");
    } else {
      filtered = filtered.filter((name) => name !== "服务端代理");
      OmniBox.log("info", "来源为 emby 但当前为外网环境且未开启外网代理，已屏蔽\"服务端代理\"线路");
    }
  } else if (callerSource === "uz") {
    filtered = filtered.filter((name) => name !== "本地代理");
    OmniBox.log("info", "来源为 uz，已屏蔽\"本地代理\"线路");
  }

  if (!allowServerProxy) {
    filtered = filtered.filter((name) => name !== "服务端代理");
  }

  return filtered.length > 0 ? filtered : ["直连"];
}

function resolveRouteType(flag = "", callerSource = "", context = {}) {
  const allowServerProxy = canUseServerProxy(context);
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

  if (!allowServerProxy && routeType === "服务端代理") {
    routeType = "直连";
  }

  if (callerSource === "uz" && routeType === "本地代理") {
    routeType = "直连";
  }

  return routeType;
}

function formatDriveShortName(name = "") {
  return String(name || "").replace(/(网盘|云盘)/g, "");
}

function sortPlaySourcesByDriveOrder(playSources = []) {
  if (!Array.isArray(playSources) || playSources.length <= 1 || DRIVE_ORDER.length === 0) {
    return playSources;
  }

  const orderMap = new Map(DRIVE_ORDER.map((name, index) => [name, index]));
  return [...playSources].sort((a, b) => {
    const aType = inferDriveTypeFromSourceName(a?.name || "");
    const bType = inferDriveTypeFromSourceName(b?.name || "");
    const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return 0;
  });
}

function inferDriveTypeFromResult(item = {}) {
  const rawType = String(item.type_id || item.type_name || item.vod_remarks || "").toLowerCase();
  return normalizePanCheckPlatform(rawType);
}

function getPanCheckSelectedPlatforms() {
  return splitConfigList(PANCHECK_PLATFORMS)
    .map((p) => normalizePanCheckPlatform(p))
    .filter(Boolean);
}

function splitLinksByPanCheckPlatforms(links = []) {
  const allLinks = Array.isArray(links) ? links.filter(Boolean) : [];
  const selectedPlatforms = getPanCheckSelectedPlatforms();

  if (selectedPlatforms.length === 0) {
    return {
      selectedPlatforms: [],
      linksToCheck: allLinks,
      bypassLinks: [],
    };
  }

  const selectedPlatformSet = new Set(selectedPlatforms);
  const linksToCheck = [];
  const bypassLinks = [];

  for (const link of allLinks) {
    const driveType = inferDriveTypeFromShareURL(link) || normalizePanCheckPlatform(OmniBox.getDriveInfoByShareURL(link)?.driveType || "");
    if (selectedPlatformSet.has(driveType)) {
      linksToCheck.push(link);
    } else {
      bypassLinks.push(link);
    }
  }

  return {
    selectedPlatforms,
    linksToCheck,
    bypassLinks,
  };
}

function sortResultsByDriveOrder(results = []) {
  if (!Array.isArray(results) || results.length <= 1 || DRIVE_ORDER.length === 0) {
    return results;
  }

  const orderMap = new Map(DRIVE_ORDER.map((name, index) => [name, index]));
  return [...results].sort((a, b) => {
    const aType = inferDriveTypeFromResult(a);
    const bType = inferDriveTypeFromResult(b);
    const aOrder = orderMap.has(aType) ? orderMap.get(aType) : Number.MAX_SAFE_INTEGER;
    const bOrder = orderMap.has(bType) ? orderMap.get(bType) : Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return 0;
  });
}

/**
 * 发送 HTTP 请求到盘搜API
 * @param {Object} params - 查询参数对象
 * @returns {Promise<Object>} API 响应数据
 */
async function requestPansouAPI(params = {}) {
  if (!PANSOU_API) {
    throw new Error("请配置盘搜API地址（PANSOU_API 环境变量）");
  }

  // 构建 URL
  const url = new URL(`${PANSOU_API}/api/search`);
  const body = {};
  body.kw = params.keyword || "";
  body.refresh = false;
  body.res = "merge";
  body.src = "all";

  // 添加可选参数
  if (PANSOU_CHANNELS) {
    body.channels = PANSOU_CHANNELS.split(',');;
  }
  if (PANSOU_PLUGINS) {
    body.plugins = PANSOU_PLUGINS.split(',');;
  }
  if (PANSOU_CLOUD_TYPES) {
    body.cloud_types = splitConfigList(PANSOU_CLOUD_TYPES);
  }
  if (PANSOU_FILTER) {
    body.filter = PANSOU_FILTER;
  }

  OmniBox.log("info", `请求盘搜API: ${JSON.stringify(body)}`);

  try {
    const response = await OmniBox.request(url.toString(), {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: body
    });

    OmniBox.log("info", `盘搜API响应状态码: ${response.statusCode}`);

    if (response.statusCode !== 200) {
      OmniBox.log("error", `盘搜API响应错误: ${response.statusCode}, 响应体: ${response.body?.substring(0, 500) || ""}`);
      throw new Error(`HTTP ${response.statusCode}: ${response.body?.substring(0, 200) || ""}`);
    }

    if (!response.body) {
      throw new Error("盘搜API返回空响应");
    }

    const data = JSON.parse(response.body);
    OmniBox.log("info", `盘搜API解析成功，数据类型: ${typeof data}, 是否有data字段: ${!!data.data}`);
    return data;
  } catch (error) {
    OmniBox.log("error", `请求盘搜API失败: ${error.message}`);
    if (error.stack) {
      OmniBox.log("error", `错误堆栈: ${error.stack}`);
    }
    throw error;
  }
}

/**
 * 格式化文件大小，返回如 "1.65G" 的格式
 * @param {number} size - 文件大小（字节）
 * @returns {string} 格式化后的文件大小
 */
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

  // 保留两位小数，但如果是整数则显示整数
  if (sizeFloat === Math.floor(sizeFloat)) {
    return `${Math.floor(sizeFloat)}${units[exp]}`;
  }
  return `${sizeFloat.toFixed(2)}${units[exp]}`;
}

function buildCacheKey(prefix, value) {
  return `${prefix}:${value}`;
}

async function getCachedJSON(key) {
  try {
    return await OmniBox.getCache(key);
  } catch (error) {
    OmniBox.log("warn", `读取缓存失败: key=${key}, error=${error.message}`);
    return null;
  }
}

async function setCachedJSON(key, value, exSeconds) {
  try {
    await OmniBox.setCache(key, value, exSeconds);
  } catch (error) {
    OmniBox.log("warn", `写入缓存失败: key=${key}, error=${error.message}`);
  }
}

/**
 * 调用 PanCheck API 检测链接有效性
 * @param {Array<string>} links - 要检测的链接列表
 * @returns {Promise<Set<string>>} 无效链接集合
 */
async function checkLinksWithPanCheck(links) {
  if (!PANCHECK_ENABLED || !PANCHECK_API || links.length === 0) {
    return {
      invalidLinksSet: new Set(),
      stats: null,
    };
  }

  try {
    const { selectedPlatforms, linksToCheck, bypassLinks } = splitLinksByPanCheckPlatforms(links);
    const detectDriveType = (link) => inferDriveTypeFromShareURL(link) || normalizePanCheckPlatform(OmniBox.getDriveInfoByShareURL(link)?.driveType || "") || "unknown";
    const inputPlatformStats = {};

    for (const link of links) {
      const driveType = detectDriveType(link);
      inputPlatformStats[driveType] = (inputPlatformStats[driveType] || 0) + 1;
    }

    if (linksToCheck.length === 0) {
      OmniBox.log("info", `PanCheck 跳过: 未命中待校验平台, 跳过链接数量: ${bypassLinks.length}`);
      return {
        invalidLinksSet: new Set(),
        stats: {
          selectedPlatforms,
          inputPlatformStats,
          checkedPlatformStats: {},
          invalidPlatformStats: {},
          validPlatformStats: {},
          bypassPlatformStats: inputPlatformStats,
          totalInput: links.length,
          totalChecked: 0,
          totalInvalid: 0,
          totalValid: 0,
          totalBypass: bypassLinks.length,
          totalOutput: links.length,
        },
      };
    }

    OmniBox.log("info", `开始调用 PanCheck 检测链接, 总链接: ${links.length}, 待校验: ${linksToCheck.length}, 跳过: ${bypassLinks.length}, 平台: ${selectedPlatforms.join(",") || "全部"}`);

    const requestBody = { links: linksToCheck };
    if (selectedPlatforms.length > 0) {
      requestBody.selected_platforms = selectedPlatforms;
    }

    const apiUrl = PANCHECK_API.replace(/\/$/, "");
    const checkURL = `${apiUrl}/api/v1/links/check`;
    OmniBox.log("info", `PanCheck API URL: ${checkURL}`);

    const response = await OmniBox.request(checkURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify(requestBody),
    });

    if (response.statusCode !== 200) {
      OmniBox.log("warn", `PanCheck API 响应错误: ${response.statusCode}, 响应体: ${response.body?.substring(0, 500) || ""}`);
      return {
        invalidLinksSet: new Set(),
        stats: null,
      };
    }

    if (!response.body) {
      OmniBox.log("warn", "PanCheck API 返回空响应");
      return {
        invalidLinksSet: new Set(),
        stats: null,
      };
    }

    const data = JSON.parse(response.body);
    const invalidLinks = data.invalid_links || [];
    const validLinks = data.valid_links || [];
    const invalidLinksSet = new Set(invalidLinks);
    const checkedPlatformStats = {};
    const invalidPlatformStats = {};
    const validPlatformStats = {};
    const bypassPlatformStats = {};

    for (const link of linksToCheck) {
      const driveType = detectDriveType(link);
      checkedPlatformStats[driveType] = (checkedPlatformStats[driveType] || 0) + 1;
      if (invalidLinksSet.has(link)) {
        invalidPlatformStats[driveType] = (invalidPlatformStats[driveType] || 0) + 1;
      } else {
        validPlatformStats[driveType] = (validPlatformStats[driveType] || 0) + 1;
      }
    }

    for (const link of bypassLinks) {
      const driveType = detectDriveType(link);
      bypassPlatformStats[driveType] = (bypassPlatformStats[driveType] || 0) + 1;
    }

    OmniBox.log("info", `PanCheck 检测完成,有效链接: ${validLinks.length}, 无效链接: ${invalidLinks.length}, 未校验直出: ${bypassLinks.length}`);

    return {
      invalidLinksSet,
      stats: {
        selectedPlatforms,
        inputPlatformStats,
        checkedPlatformStats,
        invalidPlatformStats,
        validPlatformStats,
        bypassPlatformStats,
        totalInput: links.length,
        totalChecked: linksToCheck.length,
        totalInvalid: invalidLinks.length,
        totalValid: validLinks.length,
        totalBypass: bypassLinks.length,
        totalOutput: (links.length - invalidLinks.length),
      },
    };
  } catch (error) {
    OmniBox.log("warn", `PanCheck 链接检测失败: ${error.message}`);
    if (error.stack) {
      OmniBox.log("warn", `错误堆栈: ${error.stack}`);
    }
    return {
      invalidLinksSet: new Set(),
      stats: null,
    };
  }
}

/**
 * 从盘搜结果中提取所有链接
 * @param {Object} data - 盘搜API返回的数据
 * @returns {Array<string>} 链接列表
 */
function extractLinksFromSearchData(data) {
  const links = [];

  if (!data || !data.data) {
    return links;
  }

  const mergedByType = data.data.merged_by_type || {};

  // 遍历所有网盘类型的结果
  for (const [driveType, driveResults] of Object.entries(mergedByType)) {
    if (!Array.isArray(driveResults)) {
      continue;
    }

    for (const item of driveResults) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const shareURL = String(item.url || item.URL || "");
      if (shareURL) {
        links.push(shareURL);
      }
    }
  }

  return links;
}

/**
 * 过滤盘搜结果中的无效链接
 * @param {Object} data - 盘搜API返回的数据
 * @param {Set<string>} invalidLinksSet - 无效链接集合
 * @returns {Object} 过滤后的数据
 */
function filterInvalidLinks(data, invalidLinksSet) {
  if (invalidLinksSet.size === 0) {
    return data;
  }

  if (!data || !data.data) {
    return data;
  }

  // 创建过滤后的数据副本
  const filteredData = JSON.parse(JSON.stringify(data));

  const mergedByType = filteredData.data.merged_by_type || {};

  // 遍历所有网盘类型的结果，过滤无效链接
  for (const [driveType, driveResults] of Object.entries(mergedByType)) {
    if (!Array.isArray(driveResults)) {
      continue;
    }

    // 过滤掉无效链接
    filteredData.data.merged_by_type[driveType] = driveResults.filter((item) => {
      if (typeof item !== "object" || item === null) {
        return true;
      }

      const shareURL = String(item.url || item.URL || "");
      if (!shareURL) {
        return true;
      }

      // 如果链接在无效链接集合中，则过滤掉
      return !invalidLinksSet.has(shareURL);
    });
  }

  // 更新总数（可选，因为过滤后总数会变化）
  // 这里不更新 total，因为前端可能依赖原始总数

  return filteredData;
}

/**
 * 格式化盘搜结果
 * @param {Object} data - 盘搜API返回的数据
 * @param {string} keyword - 搜索关键词
 * @returns {Promise<Array>} 格式化后的视频列表
 */
async function formatDriveSearchResults(data, keyword) {
  OmniBox.log("info", `开始格式化盘搜结果，数据类型: ${typeof data}`);

  if (!data || !data.data) {
    OmniBox.log("warn", `盘搜数据格式不正确，data: ${JSON.stringify(data).substring(0, 200)}`);
    return [];
  }

  const mergedByType = data.data.merged_by_type || {};
  OmniBox.log("info", `merged_by_type 类型: ${typeof mergedByType}, 键数量: ${Object.keys(mergedByType).length}`);

  const results = [];

  // 遍历所有网盘类型的结果
  for (const [driveType, driveResults] of Object.entries(mergedByType)) {
    if (!Array.isArray(driveResults)) {
      OmniBox.log("warn", `网盘类型 ${driveType} 的结果不是数组: ${typeof driveResults}`);
      continue;
    }

    OmniBox.log("info", `处理网盘类型 ${driveType}，结果数量: ${driveResults.length}`);

    for (const item of driveResults) {
      if (typeof item !== "object" || item === null) {
        continue;
      }

      const shareURL = String(item.url || item.URL || "");
      const note = String(item.note || item.Note || "");
      const images = item.images || item.Images || [];
      const datetime = String(item.datetime || item.Datetime || "");
      const source = item.source ? String(item.source).replace(/plugin:/gi, "plg:") : "";

      if (!shareURL) {
        continue;
      }

      const driveInfoCacheKey = buildCacheKey("pansou:driveInfo", shareURL);
      let driveInfo = await getCachedJSON(driveInfoCacheKey);
      if (!driveInfo) {
        driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
        await setCachedJSON(driveInfoCacheKey, driveInfo, PANSOU_CACHE_EX_SECONDS);
      }

      const vodId = `${shareURL}|${keyword || ""}|${note}`;

      // 构建vod_name：优先使用note，如果没有则使用URL
      const vodName = note || shareURL;

      // 构建vod_pic：使用images数组的第一个图片
      const vodPic = Array.isArray(images) && images.length > 0 ? images[0] : "";

      let timeDisplay = "";
      if (datetime) {
        try {
          const date = new Date(datetime);
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          const year = String(date.getFullYear()).slice(-2);
          timeDisplay = `${month}${day}${year}`;
        } catch (e) {
          timeDisplay = "";
        }
      }

      const remarks = [formatDriveShortName(driveInfo.displayName), source, timeDisplay].filter(Boolean).join(" | ");

      results.push({
        vod_id: vodId,
        vod_name: vodName,
        vod_pic: vodPic || driveInfo.iconUrl,
        type_id: driveType,
        type_name: driveInfo.displayName,
        vod_remarks: remarks,
        vod_time: datetime,
        _datetime: datetime,
      });
    }
  }

  OmniBox.log("info", `格式化完成，最终结果数量: ${results.length}`);
  const sortedResults = sortResultsByDriveOrder(results);
  if (sortedResults.length > 1) {
    OmniBox.log("info", `搜索结果按 DRIVE_ORDER 排序后顺序: ${sortedResults.map((item) => item.type_name || item.type_id || "未知").join(" | ")}`);
  }
  return sortedResults;
}

/**
 * 判断是否为视频文件
 * @param {Object} file - 文件对象
 * @returns {boolean} 是否为视频文件
 */
function isVideoFile(file) {
  if (!file || !file.file_name) {
    return false;
  }

  const fileName = file.file_name.toLowerCase();
  const videoExtensions = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];

  // 检查文件扩展名
  for (const ext of videoExtensions) {
    if (fileName.endsWith(ext)) {
      return true;
    }
  }

  // 检查format_type字段
  if (file.format_type) {
    const formatType = String(file.format_type).toLowerCase();
    if (formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264")) {
      return true;
    }
  }

  return false;
}

/**
 * 递归获取所有视频文件
 * @param {string} shareURL - 分享链接
 * @param {Array} files - 文件列表
 * @param {string} pdirFid - 父目录ID
 * @returns {Promise<Array>} 所有视频文件列表
 */
async function getAllVideoFiles(shareURL, files, pdirFid) {
  const videoFiles = [];

  for (const file of files) {
    if (file.file && isVideoFile(file)) {
      // 是视频文件，直接添加
      videoFiles.push(file);
    } else if (file.dir) {
      // 是目录，递归获取
      try {
        const subFileList = await OmniBox.getDriveFileList(shareURL, file.fid);
        if (subFileList && subFileList.files && Array.isArray(subFileList.files)) {
          const subVideoFiles = await getAllVideoFiles(shareURL, subFileList.files, file.fid);
          videoFiles.push(...subVideoFiles);
        }
      } catch (error) {
        OmniBox.log("warn", `获取子目录文件失败: ${error.message}`);
        // 继续处理其他文件
      }
    }
  }

  return videoFiles;
}

/**
 * 首页
 * @param {Object} params - 参数对象
 * @returns {Object} 首页数据
 */
async function home(params, context) {
  try {
    // 获取当前爬虫源ID（可选，用于日志记录等）
    const sourceId = context.sourceId;
    if (sourceId) {
      OmniBox.log("info", `当前爬虫源ID: ${sourceId}`);
    }
    // 构建默认分类
    const classes = [
      {
        type_id: "history",
        type_name: "最近观看",
      },
      {
        type_id: "favorite",
        type_name: "我的收藏",
      },
    ];

    // 获取爬虫源收藏标签
    try {
      const tags = await OmniBox.getSourceFavoriteTags();
      for (const tag of tags) {
        if (tag) {
          classes.push({
            type_id: tag,
            type_name: tag,
          });
        }
      }
    } catch (error) {
      OmniBox.log("warn", `获取收藏标签失败: ${error.message}`);
    }

    // 获取前20条收藏数据作为列表
    let list = [];
    try {
      const categoryData = await OmniBox.getSourceCategoryData("favorite", 1, 20);
      if (categoryData && categoryData.list && Array.isArray(categoryData.list)) {
        list = categoryData.list.map((item) => ({
          vod_id: item.vod_id || item.VodID || "",
          vod_name: item.vod_name || item.VodName || "",
          vod_pic: item.vod_pic || item.VodPic || "",
          type_id: item.type_id || item.TypeID || "",
          type_name: item.type_name || item.TypeName || "",
          vod_year: item.vod_year || item.VodYear || "",
          vod_remarks: item.vod_remarks || item.VodRemarks || "",
          vod_time: item.vod_time || item.VodTime || "",
          vod_play_from: item.vod_play_from || item.VodPlayFrom || "",
          vod_play_url: item.vod_play_url || item.VodPlayURL || "",
          vod_douban_score: item.vod_douban_score || item.VodDoubanScore || "",
        }));
      }
    } catch (error) {
      OmniBox.log("warn", `获取收藏数据失败: ${error.message}`);
    }

    return {
      class: classes,
      list: list,
    };
  } catch (error) {
    OmniBox.log("error", `首页接口失败: ${error.message}`);
    return {
      class: [],
      list: [],
    };
  }
}

/**
 * 分类
 * @param {Object} params - 参数对象
 *   - categoryId: 分类类型（history/favorite/tag）
 *   - type_id: 分类类型（兼容旧格式）
 *   - page: 页码（可选，默认为1）
 * @returns {Object} 分类数据
 */
async function category(params) {
  try {
    // 支持两种参数名：categoryId（新格式）和 type_id（兼容旧格式）
    const categoryType = params.categoryId || params.type_id || "";
    const page = parseInt(params.page || "1", 10);
    const pageSize = 20;

    OmniBox.log("info", `分类接口调用，categoryType: ${categoryType}, page: ${page}`);

    if (!categoryType) {
      OmniBox.log("warn", "分类类型为空");
      return {
        list: [],
        page: 1,
        pagecount: 0,
        total: 0,
      };
    }

    // 通过SDK获取分类数据（基于当前爬虫源）
    const categoryData = await OmniBox.getSourceCategoryData(categoryType, page, pageSize);

    OmniBox.log("info", `获取分类数据成功，是否有数据: ${!!categoryData}, 列表长度: ${categoryData?.list?.length || 0}`);

    if (!categoryData || !categoryData.list || !Array.isArray(categoryData.list)) {
      OmniBox.log("warn", `分类数据为空或格式不正确，categoryData: ${JSON.stringify(categoryData).substring(0, 200)}`);
      return {
        list: [],
        page: page,
        pagecount: categoryData?.pageCount || 0,
        total: categoryData?.total || 0,
      };
    }

    // 格式化数据 - SDK返回的是TVBox格式，需要转换为爬虫脚本格式
    const list = categoryData.list.map((item) => {
      // TVBox格式的字段名（JSON序列化后是小写）
      const vodId = item.vod_id || "";
      const shareURL = vodId; // 对于网盘，vod_id就是分享链接

      // 构建播放源标识和播放URL
      // 格式：shareURL|keyword|note（这里keyword和note为空，因为分类数据中没有这些信息）
      // 但为了与detail接口兼容，我们使用shareURL作为playFrom
      const playFrom = shareURL;
      const playURL = ""; // 分类列表不需要播放URL，详情接口会获取

      return {
        vod_id: vodId,
        vod_name: item.vod_name || "",
        vod_pic: item.vod_pic || "",
        type_id: categoryType, // 使用分类类型作为type_id
        type_name: item.type_name || "网盘资源",
        vod_year: item.vod_year || "",
        vod_remarks: item.vod_remarks || "",
        vod_play_from: playFrom,
        vod_play_url: playURL,
      };
    });

    OmniBox.log("info", `格式化完成，最终列表长度: ${list.length}`);

    return {
      list: list,
      page: page,
      pagecount: categoryData.pageCount || 0,
      total: categoryData.total || 0,
    };
  } catch (error) {
    OmniBox.log("error", `分类接口失败: ${error.message}`);
    if (error.stack) {
      OmniBox.log("error", `错误堆栈: ${error.stack}`);
    }
    return {
      list: [],
      page: 1,
      pagecount: 0,
      total: 0,
    };
  }
}

/**
 * 搜索
 * @param {Object} params - 参数对象
 *   - keyword: 搜索关键词（必填）
 *   - page: 页码（可选，默认为1）
 * @returns {Object} 搜索结果
 */
async function search(params) {
  try {
    OmniBox.log("info", `搜索接口调用，参数: ${JSON.stringify(params)}`);

    const keyword = params.keyword || "";
    const page = parseInt(params.page || "1", 10);

    // 只在第一页时进行搜索，其他页返回空列表
    if (page > 1) {
      return {
        list: [],
        page: page,
        pagecount: 1,
        total: 0,
      };
    }

    OmniBox.log("info", `搜索关键词: ${keyword}, 页码: ${page}`);

    if (!keyword) {
      OmniBox.log("warn", "搜索关键词为空");
      return {
        list: [],
        page: page,
        pagecount: 0,
        total: 0,
      };
    }

    // 检查盘搜API配置
    if (!PANSOU_API) {
      throw new Error("请配置盘搜API地址（PANSOU_API 环境变量）");
    }

    OmniBox.log("info", `盘搜API地址: ${PANSOU_API}`);

    // 调用盘搜API
    const response = await requestPansouAPI({ keyword });

    OmniBox.log("info", `盘搜API响应: ${JSON.stringify(response).substring(0, 500)}`);

    // 如果启用了 PanCheck，进行链接检测和过滤
    let filteredResponse = response;
    if (PANCHECK_ENABLED && PANCHECK_API) {
      try {
        // 提取所有链接
        const links = extractLinksFromSearchData(response);
        OmniBox.log("info", `提取到链接数量: ${links.length}`);

        if (links.length > 0) {
          // 调用 PanCheck 检测链接
          const { invalidLinksSet, stats } = await checkLinksWithPanCheck(links);
          if (stats) {
            OmniBox.log("info", `PanCheck 分平台统计(盘搜搜索): 输入=${JSON.stringify(stats.inputPlatformStats)}, 校验=${JSON.stringify(stats.checkedPlatformStats)}, 过滤=${JSON.stringify(stats.invalidPlatformStats)}, 剩余=${JSON.stringify(stats.validPlatformStats)}, 跳过=${JSON.stringify(stats.bypassPlatformStats)}`);
            OmniBox.log("info", `PanCheck 总统计(盘搜搜索): 总输入=${stats.totalInput}, 总校验=${stats.totalChecked}, 总过滤=${stats.totalInvalid}, 总剩余=${stats.totalOutput}, 其中直出=${stats.totalBypass}`);
          }

          if (invalidLinksSet.size > 0) {
            OmniBox.log("info", `检测到无效链接数量: ${invalidLinksSet.size}`);
            // 过滤无效链接
            filteredResponse = filterInvalidLinks(response, invalidLinksSet);
            OmniBox.log("info", `过滤完成，已移除 ${invalidLinksSet.size} 个无效链接`);
          } else {
            OmniBox.log("info", "所有链接检测通过，无需过滤");
          }
        }
      } catch (error) {
        OmniBox.log("warn", `PanCheck 处理失败: ${error.message}，使用原始搜索结果`);
        // PanCheck 处理失败，使用原始搜索结果
        filteredResponse = response;
      }
    }

    // 格式化结果
    const list = await formatDriveSearchResults(filteredResponse, keyword);

    OmniBox.log("info", `格式化后的结果数量: ${list.length}`);

    return {
      list: list,
      page: page,
      pagecount: 1,
      total: list.length,
    };
  } catch (error) {
    OmniBox.log("error", `搜索接口失败: ${error.message}`);
    OmniBox.log("error", `错误堆栈: ${error.stack || ""}`);
    return {
      list: [],
      page: 1,
      pagecount: 0,
      total: 0,
    };
  }
}

/**
 * 构建刮削后的文件名
 * @param {Object} scrapeData - TMDB刮削数据
 * @param {Object} mapping - 视频映射关系
 * @param {string} originalFileName - 原始文件名
 * @returns {string} 刮削后的文件名
 */
function buildScrapedFileName(scrapeData, mapping, originalFileName) {
  // 如果无法解析集号（EpisodeNumber == 0）或置信度很低（< 0.5），使用原始文件名
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalFileName;
  }

  // 查找对应的剧集信息
  if (scrapeData && scrapeData.episodes && Array.isArray(scrapeData.episodes)) {
    for (const episode of scrapeData.episodes) {
      if (episode.episodeNumber === mapping.episodeNumber && episode.seasonNumber === mapping.seasonNumber) {
        // 使用剧集标题作为文件名
        if (episode.name) {
          return `${episode.episodeNumber}.${episode.name}`;
        }
        break;
      }
    }
  }

  // 如果没有找到对应的剧集信息，返回原始文件名
  return originalFileName;
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

/**
 * 预处理标题，去掉常见干扰项
 */
function preprocessTitle(title) {
  if (!title) return "";
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]|1280x720|1920x1080/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

function extractEpisode(title) {
  if (!title) return "";

  const processedTitle = preprocessTitle(title).trim();

  // 1. S01E03 格式
  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];

  // 2. 中文格式：第XX集/话
  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));

  // 3. EP/E 格式
  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];

  // 4. 括号格式 [03]
  const bracketMatch = processedTitle.match(/[\[\(【（](\d{1,3})[\]\)】）]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    // 排除常见分辨率
    if (!["720", "1080", "480"].includes(num)) return num;
  }

  // 5. 独立的数字 (排除常见的视频参数)
  const standaloneMatches = processedTitle.match(/(?:^|[\s\-\._\[\]])(\d{1,3})(?![0-9pP])/g);
  if (standaloneMatches) {
    const candidates = standaloneMatches
      .map(m => m.match(/\d+/)[0])
      .filter(num => {
        const n = parseInt(num);
        return n > 0 && n < 300 && !["720", "480", "264", "265"].includes(num);
      });
    
    if (candidates.length > 0) {
      // 优先取 1-99 之间的
      const normalEp = candidates.find(n => parseInt(n) < 100);
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

/**
 * 详情
 * @param {Object} params - 参数对象
 *   - videoId: 视频ID（格式：shareURL|keyword|note）
 * @returns {Object} 视频详情
 */
async function detail(params, context) {
  try {
    OmniBox.log("info", `详情接口调用，参数: ${JSON.stringify(params)}`);

    const videoId = params.videoId || "";
    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    // 获取来源参数（可选）
    const source = resolveCallerSource(params, context);

    // 解析id：格式为 shareURL|keyword|note
    const parts = videoId.split("|");
    const shareURL = parts[0] || "";
    const keyword = parts[1] || "";
    const note = parts[2] || "";

    if (!shareURL) {
      throw new Error("分享链接不能为空");
    }

    OmniBox.log("info", `解析参数: shareURL=${shareURL}, keyword=${keyword}, note=${note}`);

    const driveInfoCacheKey = buildCacheKey("pansou:driveInfo", shareURL);
    const rootFilesCacheKey = buildCacheKey("pansou:rootFiles", shareURL);
    const videoFilesCacheKey = buildCacheKey("pansou:videoFiles", shareURL);

    const [cachedDriveInfo, cachedRootFiles, cachedVideoFiles] = await Promise.all([
      getCachedJSON(driveInfoCacheKey),
      getCachedJSON(rootFilesCacheKey),
      getCachedJSON(videoFilesCacheKey),
    ]);

    let driveInfo = cachedDriveInfo;
    let fileList = cachedRootFiles;

    if (!driveInfo || !fileList) {
      const results = await Promise.all([
        driveInfo ? Promise.resolve(driveInfo) : OmniBox.getDriveInfoByShareURL(shareURL),
        fileList ? Promise.resolve(fileList) : OmniBox.getDriveFileList(shareURL, "0"),
      ]);
      driveInfo = results[0];
      fileList = results[1];

      if (!cachedDriveInfo && driveInfo) {
        await setCachedJSON(driveInfoCacheKey, driveInfo, PANSOU_CACHE_EX_SECONDS);
      }
      if (!cachedRootFiles && fileList) {
        await setCachedJSON(rootFilesCacheKey, fileList, PANSOU_CACHE_EX_SECONDS);
      }
    }

    const displayName = driveInfo.displayName;

    if (!fileList || !fileList.files || !Array.isArray(fileList.files)) {
      throw new Error("获取文件列表失败");
    }

    OmniBox.log("info", `获取文件列表成功，文件数量: ${fileList.files.length}`);

    // 递归获取所有视频文件（优先走缓存）
    let allVideoFiles = cachedVideoFiles;
    if (!Array.isArray(allVideoFiles) || allVideoFiles.length === 0) {
      allVideoFiles = await getAllVideoFiles(shareURL, fileList.files, "0");
      if (Array.isArray(allVideoFiles) && allVideoFiles.length > 0) {
        await setCachedJSON(videoFilesCacheKey, allVideoFiles, PANSOU_CACHE_EX_SECONDS);
      }
    } else {
      OmniBox.log("info", `命中视频文件缓存: ${shareURL}, 数量: ${allVideoFiles.length}`);
    }

    if (allVideoFiles.length === 0) {
      throw new Error("未找到视频文件");
    }

    OmniBox.log("info", `递归获取视频文件完成，视频文件数量: ${allVideoFiles.length}`);

    // 执行刮削处理（使用通用API，videoId作为resourceId）
    let scrapingSuccess = false;

    try {
      OmniBox.log("info", `开始执行刮削处理，关键词: ${keyword}, 资源名: ${note}, 视频文件数: ${allVideoFiles.length}`);

      // 将文件ID转换为 {shareURL}|${fileId} 格式，用于刮削SDK
      const videoFilesForScraping = allVideoFiles.map((file) => {
        const fileId = file.fid || file.file_id || "";
        // 将文件ID转换为 {shareURL}|${fileId} 格式
        const formattedFileId = fileId ? `${shareURL}|${fileId}` : fileId;
        return {
          ...file,
          fid: formattedFileId,
          file_id: formattedFileId, // 兼容不同的字段名
        };
      });

      OmniBox.log("info", `文件ID格式转换完成，示例: ${videoFilesForScraping[0]?.fid || "N/A"}`);

      // 使用新的通用刮削API，videoId作为resourceId（网盘场景下，分享链接就是资源唯一标识）
      const scrapingResult = await OmniBox.processScraping(shareURL, keyword, note, videoFilesForScraping);
      OmniBox.log("info", `刮削处理完成，结果: ${JSON.stringify(scrapingResult).substring(0, 200)}`);
      scrapingSuccess = true;
    } catch (error) {
      OmniBox.log("error", `刮削处理失败: ${error.message}`);
      if (error.stack) {
        OmniBox.log("error", `刮削错误堆栈: ${error.stack}`);
      }
      // 刮削失败不影响返回结果，继续执行
    }

    // 获取刮削后的元数据（使用通用API）
    let scrapeData = null;
    let videoMappings = [];
    const metadataPromise = (async () => {
      try {
        OmniBox.log("info", `开始获取元数据，shareURL: ${shareURL}`);
        // 使用新的通用元数据API，videoId作为resourceId
        const metadata = await OmniBox.getDriveMetadata(shareURL);
        OmniBox.log("info", `获取元数据响应: ${JSON.stringify(metadata).substring(0, 500)}`);
        return metadata;
      } catch (error) {
        OmniBox.log("error", `获取元数据失败: ${error.message}`);
        if (error.stack) {
          OmniBox.log("error", `获取元数据错误堆栈: ${error.stack}`);
        }
        return null;
      }
    })();

    const metadata = await metadataPromise;
    if (metadata) {
      scrapeData = metadata.scrapeData || null;
      videoMappings = metadata.videoMappings || [];
      const scrapeType = metadata.scrapeType || "";

      if (scrapeData) {
        OmniBox.log("info", `获取到刮削数据，标题: ${scrapeData.title || "未知"}, 类型: ${scrapeType || "未知"}, 映射数量: ${videoMappings.length}`);
      } else {
        OmniBox.log("warn", `未获取到刮削数据，映射数量: ${videoMappings.length}`);
        if (!scrapingSuccess) {
          OmniBox.log("warn", "刮削处理可能失败，导致没有刮削数据");
        }
      }
    }

    const displayNameFromFileList = fileList.displayName || fileList.display_name || "";

    // 构建结构化播放源
    const playSources = [];

    // 确定播放源列表
    let sourceNames = ["直连"];
    const targetDriveTypes = DRIVE_TYPE_CONFIG;
    const configSourceNames = SOURCE_NAMES_CONFIG;

    if (targetDriveTypes.includes(driveInfo.driveType)) {
      sourceNames = [...configSourceNames];
      OmniBox.log("info", `${displayName} 匹配 DRIVE_TYPE_CONFIG，初始线路设置为: ${sourceNames.join(", ")}`);
      sourceNames = filterSourceNamesForCaller(sourceNames, source, context);
      OmniBox.log("info", `来源=${source || "unknown"}，最终线路设置为: ${sourceNames.join(", ")}`);
    }

    // 为每个播放源构建剧集列表
    for (const sourceName of sourceNames) {
      const episodes = [];

      for (const file of allVideoFiles) {
        let fileName = file.file_name || "";
        const fileId = file.fid || "";
        const fileSize = file.size || file.file_size || 0;

        const originalFileName = file.file_name || "";
        const originalVodName = note || keyword || displayNameFromFileList || shareURL;

        // 构建用于匹配映射关系的文件ID格式：{shareURL}|${fileId}
        const formattedFileId = fileId ? `${shareURL}|${fileId}` : "";

        // 查找匹配的视频映射关系
        let matchedMapping = null;
        if (scrapeData && videoMappings && Array.isArray(videoMappings) && videoMappings.length > 0) {
          for (const mapping of videoMappings) {
            if (mapping && mapping.fileId === formattedFileId) {
              matchedMapping = mapping;
              // 根据TMDB数据构建新的文件名
              const newFileName = buildScrapedFileName(scrapeData, mapping, fileName);
              if (newFileName && newFileName !== fileName) {
                fileName = newFileName;
                OmniBox.log("info", `应用刮削文件名: ${file.file_name} -> ${fileName}`);
              }
              break;
            }
          }
        }

        const normalizedOriginalEpisodeName = normalizeEpisodeName(originalFileName || fileName);
        const playMeta = encodePlayMeta({
          t: originalVodName,
          e: normalizedOriginalEpisodeName,
        });
        const basePlayId = fileId ? `${shareURL}|${fileId}` : "";

        let displayFileName = fileName;
        if (fileSize > 0) {
          const fileSizeStr = formatFileSize(fileSize);
          if (fileSizeStr) {
            displayFileName = `[${fileSizeStr}] ${fileName}`;
          }
        }

        // 构建剧集对象
        const episode = {
          name: displayFileName,
          playId: playMeta ? `${basePlayId}|${playMeta}` : basePlayId,
          size: fileSize > 0 ? fileSize : undefined,
          rawName: originalFileName,
        };

        // 如果匹配到映射关系，填充TMDB信息
          if (matchedMapping) {
            // 保存排序用的字段（用于后续排序）
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

          // 弹幕兜底: 保留未刮削前的原始文件名
          if (!episode.episodeName) {
            episode.episodeName = normalizedOriginalEpisodeName || originalFileName || fileName;
          }

          if (episode.name && episode.playId) {
            episodes.push(episode);
          }
        }

      // 如果刮削成功且有刮削数据，按照 episodeNumber 排序
      if (scrapeData && episodes.length > 0) {
        // 检查是否有剧集包含 episodeNumber（说明是电视剧类型）
        const hasEpisodeNumber = episodes.some((ep) => ep._episodeNumber !== undefined);
        if (hasEpisodeNumber) {
          OmniBox.log("info", `检测到刮削数据，按 episodeNumber 排序剧集列表，共 ${episodes.length} 集`);
          episodes.sort((a, b) => {
            // 优先按 seasonNumber 排序
            const seasonA = a._seasonNumber !== undefined ? a._seasonNumber : 0;
            const seasonB = b._seasonNumber !== undefined ? b._seasonNumber : 0;
            if (seasonA !== seasonB) {
              return seasonA - seasonB;
            }
            // 再按 episodeNumber 排序
            const episodeA = a._episodeNumber !== undefined ? a._episodeNumber : 0;
            const episodeB = b._episodeNumber !== undefined ? b._episodeNumber : 0;
            return episodeA - episodeB;
          });
          // 排序完成后，移除临时排序字段（可选，保留也不影响）
          // episodes.forEach(ep => {
          //   delete ep._seasonNumber;
          //   delete ep._episodeNumber;
          // });
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

    // 构建视频详情
    let vodName = displayNameFromFileList || note || keyword || shareURL;
    let vodPic = "";
    let vodYear = "";
    let vodArea = "";
    let vodActor = "";
    let vodDirector = "";
    let vodContent = `网盘资源，共${allVideoFiles.length}个视频文件`;
    let vodDoubanScore = "";

    // 如果有刮削数据，使用TMDB信息
    if (scrapeData) {
      if (scrapeData.title) {
        vodName = scrapeData.title;
      }
      if (scrapeData.posterPath) {
        vodPic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
      }
      if (scrapeData.releaseDate) {
        vodYear = scrapeData.releaseDate.substring(0, 4) || "";
      }
      if (scrapeData.overview) {
        vodContent = scrapeData.overview;
      }
      if (scrapeData.voteAverage) {
        vodDoubanScore = scrapeData.voteAverage.toFixed(1);
      }
      // 处理演员和导演信息
      if (scrapeData.credits) {
        if (scrapeData.credits.cast && Array.isArray(scrapeData.credits.cast)) {
          vodActor = scrapeData.credits.cast
            .slice(0, 5)
            .map((cast) => cast.name || cast.character || "")
            .filter((name) => name)
            .join(",");
        }
        if (scrapeData.credits.crew && Array.isArray(scrapeData.credits.crew)) {
          const directors = scrapeData.credits.crew.filter((crew) => crew.job === "Director" || crew.department === "Directing");
          if (directors.length > 0) {
            vodDirector = directors
              .slice(0, 3)
              .map((director) => director.name || "")
              .filter((name) => name)
              .join(",");
          }
        }
      }
      // 处理类型名称
      if (scrapeData.status) {
        // status字段可以作为类型名称
      }
    }

    if (Array.isArray(playSources) && playSources.length > 1 && DRIVE_ORDER.length > 0) {
      const sortedPlaySources = sortPlaySourcesByDriveOrder(playSources);
      playSources.length = 0;
      playSources.push(...sortedPlaySources);
      OmniBox.log("info", `按 DRIVE_ORDER 排序后线路顺序: ${playSources.map((item) => item.name).join(" | ")}`);
    }

    return {
      list: [
        {
          vod_id: videoId,
          vod_name: vodName,
          vod_pic: vodPic,
          type_name: displayName,
          vod_year: vodYear,
          vod_area: vodArea,
          vod_remarks: displayName,
          vod_actor: vodActor,
          vod_director: vodDirector,
          vod_content: vodContent,
          vod_play_sources: playSources,
          vod_douban_score: vodDoubanScore,
        },
      ],
    };
  } catch (error) {
    OmniBox.log("error", `详情接口失败: ${error.message}`);
    if (error.stack) {
      OmniBox.log("error", `错误堆栈: ${error.stack}`);
    }
    return {
      list: [],
    };
  }
}

/**
 * 播放
 * @param {Object} params - 参数对象
 *   - flag: 播放方式（服务端代理、本地代理、直连）
 *   - playId: 播放地址ID（格式：分享链接|文件ID）
 *   - vodId: 视频ID（可选）
 *   - title: 视频标题（可选）
 *   - episodeName: 剧集名称（可选）
 * @returns {Object} 播放地址
 */
async function play(params, context) {
  try {
    const flag = params.flag || "";
    const playId = params.playId || "";
    // 获取来源参数（可选），从detail接口传递过来
    const source = resolveCallerSource(params, context);

    OmniBox.log(
      "info",
      `播放参数:  flag=${flag || ""}, playId=${playId || ""}, vodId=${params.vodId || ""}, title=${params.title || ""}, episodeName=${params.episodeName || ""}`
    );

    if (!playId) {
      throw new Error("播放参数不能为空");
    }

    // 解析playId：格式为 分享链接|文件ID|meta(base64) 或 分享链接|文件ID|||meta(base64)
    let mainPlayId = playId;
    let metaPart = "";
    if (playId.includes("|||")) {
      const splitParts = playId.split("|||");
      mainPlayId = splitParts[0] || "";
      metaPart = splitParts[1] || "";
    }

    const parts = mainPlayId.split("|");
    if (parts.length < 2) {
      throw new Error("播放参数格式错误，应为：分享链接|文件ID");
    }
    const shareURL = parts[0] || "";
    const fileId = parts[1] || "";
    if (!metaPart && parts.length > 2) {
      metaPart = parts.slice(2).join("|");
    }

    const playMeta = decodePlayMeta(metaPart);
    const originalTitle = playMeta.t || playMeta.v || playMeta.title || "";
    const originalEpisodeName = playMeta.e || playMeta.episodeName || "";
    OmniBox.log(
      "info",
      `透传信息: title=${originalTitle || ""}, episode=${originalEpisodeName || ""}, meta=${metaPart ? "yes" : "no"}`
    );

    if (!shareURL || !fileId) {
      throw new Error("分享链接或文件ID不能为空");
    }

    // 获取刮削元数据，用于弹幕匹配（使用通用API）
    let danmakuList = [];
    let scrapeTitle = "";
    let episodeName = params.episodeName || "";
    try {
      // 使用新的通用元数据API，shareURL作为resourceId
      const metadata = await OmniBox.getDriveMetadata(shareURL);
      if (metadata && metadata.scrapeData && metadata.videoMappings) {
        // 构建用于匹配映射关系的文件ID格式：{shareURL}|${fileId}
        // 注意：playId 的格式已经是 分享链接|文件ID，所以可以直接使用 playId 来匹配
        const formattedFileId = fileId ? `${shareURL}|${fileId}` : "";

        // 根据文件ID查找对应的视频映射
        let matchedMapping = null;
        for (const mapping of metadata.videoMappings) {
          // 使用格式化后的文件ID进行匹配（因为刮削SDK返回的fileId是 {shareURL}|${fileId} 格式）
          if (mapping.fileId === formattedFileId) {
            matchedMapping = mapping;
            break;
          }
        }

        if (matchedMapping && metadata.scrapeData) {
          const scrapeData = metadata.scrapeData;
          OmniBox.log("info", `找到文件映射，fileId: ${fileId}, tmdbEpisodeId: ${matchedMapping.tmdbEpisodeId || "N/A"}`);

          scrapeTitle = scrapeData.title || "";

          // 获取集数信息
          if (matchedMapping.episodeName && !episodeName) {
            episodeName = matchedMapping.episodeName;
          }

          // 生成fileName用于弹幕匹配
          let fileName = "";
          const scrapeType = metadata.scrapeType || ""; // 从元数据获取类型（movie 或 tv）
          if (scrapeType === "movie") {
            // 电影直接用片名
            fileName = scrapeData.title || "";
          } else {
            // 电视剧根据集数生成：{Title}.{SeasonAirYear}.S{SeasonNumber}E{EpisodeNumber}
            const title = scrapeData.title || "";
            const seasonAirYear = scrapeData.seasonAirYear || "";
            const seasonNumber = matchedMapping.seasonNumber || 1;
            const epNum = matchedMapping.episodeNumber || 1;
            fileName = `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(epNum).padStart(2, "0")}`;
          }

          if (fileName) {
            OmniBox.log("info", `生成fileName用于弹幕匹配: ${fileName}`);
            // 调用弹幕匹配API
            danmakuList = await OmniBox.getDanmakuByFileName(fileName);
            if (danmakuList && danmakuList.length > 0) {
              OmniBox.log("info", `弹幕匹配成功，找到 ${danmakuList.length} 条弹幕`);
            } else {
              OmniBox.log("info", "弹幕匹配未找到结果");
            }
          }
        } else {
          OmniBox.log("info", `未找到文件映射，fileId: ${fileId}`);
        }
        } else {
          OmniBox.log("info", "未找到刮削元数据，改用原始名称兜底弹幕匹配");
        }
    } catch (error) {
      OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
      // 弹幕匹配失败不影响播放，继续执行
    }

    // 刮削失败或无结果时，依然进行弹幕匹配，使用原始剧名/集名兜底
    if (!danmakuList || danmakuList.length === 0) {
      const fallbackFromVodId = parseVodIdForFallback(params.vodId || "");
      const rawFallbackEpisodeName =
        originalEpisodeName || episodeName || params.episodeName || fallbackFromVodId.episodeName || "";
      const fallbackEpisodeName = normalizeEpisodeName(rawFallbackEpisodeName);
      const fallbackTitle = originalTitle || params.title || scrapeTitle || fallbackFromVodId.title || "";
      OmniBox.log(
        "info",
        `兜底来源: episodeRaw=${rawFallbackEpisodeName || ""}, episodeClean=${fallbackEpisodeName || ""}, title=${fallbackTitle || ""}`
      );
      const fallbackFileName = buildFileNameForDanmu(fallbackTitle, fallbackEpisodeName) || fallbackTitle || fallbackEpisodeName;
      if (fallbackFileName) {
        try {
          OmniBox.log("info", `使用兜底文件名进行弹幕匹配: ${fallbackFileName}`);
          danmakuList = await OmniBox.getDanmakuByFileName(fallbackFileName);
          OmniBox.log("info", `兜底弹幕匹配结果数量: ${danmakuList?.length || 0}`);
        } catch (error) {
          OmniBox.log("warn", `兜底弹幕匹配失败: ${error.message}`);
        }
      }
    }

    // 线路解析: 默认 web/emby 走服务端代理，其它直连；若 flag 含前缀，取最后一段
    const routeType = resolveRouteType(flag, source, context);

    const playInfoPromise = OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType);
    OmniBox.log("info", `使用线路: ${routeType}`);

    const playInfo = await playInfoPromise;

    if (!playInfo || !playInfo.url || !Array.isArray(playInfo.url) || playInfo.url.length === 0) {
      throw new Error("无法获取播放地址");
    }

    // 使用后端返回的url数组（格式：[{name: "RAW", url: "..."}, ...]）
    // 对于夸克和UC网盘，如果flag是"服务端代理"或"本地代理"，URL已经包含前缀
    const urlList = playInfo.url || [];

    // 统一使用数组格式，每个元素包含 name 和 url，类似 danmaku 格式
    // 直接使用后端返回的URL（已经根据flag处理过前缀）
    let urlsResult = [];
    for (const item of urlList) {
      // 如果来源是网页端，过滤掉画质为"RAW"的播放地址
      // if (source === "web" && item.name && item.name.toUpperCase() === "RAW") {
      //   OmniBox.log("info", `来源为网页端，已过滤掉画质为"RAW"的播放地址`);
      //   continue;
      // }

      urlsResult.push({
        name: item.name || "播放",
        url: item.url,
      });
    }

    let header = playInfo.header || {};

    // 合并弹幕列表：优先使用匹配到的弹幕，如果没有则使用playInfo中的弹幕
    let finalDanmakuList = danmakuList && danmakuList.length > 0 ? danmakuList : playInfo.danmaku || [];

    return {
      urls: urlsResult, // 返回网盘分享链接作为flag
      header: header,
      parse: 0,
      danmaku: finalDanmakuList};
  } catch (error) {
    OmniBox.log("error", `播放接口失败: ${error.message}`);
    if (error.stack) {
      OmniBox.log("error", `错误堆栈: ${error.stack}`);
    }
    return {
      urls: [],
      header: {},
      danmaku: []};
  }
}

// 导出接口（用于模块化引用）
module.exports = {
  home,
  category,
  search,
  detail,
  play,
};

// 使用公共 runner 处理标准输入/输出
// runner 通过 NODE_PATH 环境变量自动解析，无需手动指定路径
const runner = require("spider_runner");
runner.run(module.exports);
