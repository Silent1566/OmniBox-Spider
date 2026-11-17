// @name 聚盘搜索分组 (pan.dyuzi.com)
// @author 梦
// @description 聚盘搜索分组版：搜索先按网盘分组，再进入二级结果；详情与播放沿用聚盘搜索的多层级展开、刮削、弹幕能力
// @dependencies: axios
// @version 1.0.3
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/网盘/聚盘搜索分组.js


const axios = require("axios");
const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

// ==================== 配置区域开始 ====================
// 站点基地址（旧域 pan.dyuzi.com 已迁移/跳转到 ppan.dyuzi.com）
const BASE = "https://ppan.dyuzi.com";
// 站点前端 API 根地址
const API = `${BASE}/api/frontend`;
// 默认请求 User-Agent
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";

// 首页榜单默认频道
const RANK_CHANNELS = ["电视剧", "电影", "短剧", "动漫", "综艺"];
// 搜索默认每页条数
const DEFAULT_PAGE_SIZE = 20;
// 异步搜索轮询次数
const SEARCH_POLL_ROUNDS = 10;
// 异步搜索轮询间隔（毫秒）
const SEARCH_POLL_INTERVAL_MS = 900;
// 搜索 / 分组联动缓存时间（秒）
const SEARCH_CACHE_EX_SECONDS = Number(process.env.JUPAN_GROUP_SEARCH_CACHE_EX_SECONDS || 1800);

// PanCheck API 地址
const PANCHECK_API = text(process.env.PANCHECK_API || "");
// 是否启用 PanCheck（未显式设置时：配置了 API 即启用）
const PANCHECK_ENABLED = text(process.env.PANCHECK_ENABLED || (PANCHECK_API ? "1" : "0")) === "1";
// PanCheck 待校验平台列表，支持逗号 / 分号分隔
const PANCHECK_PLATFORMS = text(process.env.PANCHECK_PLATFORMS || "quark,baidu,uc,pan123,tianyi,cmcc");

// 命中的网盘类型才展开代理多线路，支持逗号 / 分号分隔
const DRIVE_TYPE_CONFIG = splitConfigList(process.env.DRIVE_TYPE_CONFIG || "quark;uc").map((s) => s.toLowerCase());
// 多线路名称列表，支持逗号 / 分号分隔；web 端默认会过滤“本地代理”
const SOURCE_NAMES_CONFIG = splitConfigList(process.env.SOURCE_NAMES_CONFIG || "本地代理;服务端代理;直连");

// 默认网盘排序（中文名）
const DRIVE_ORDER_DEFAULT = "百度网盘,天翼网盘,夸克网盘,UC网盘,115网盘,迅雷网盘,阿里网盘";
// 网盘排序配置，支持中文网盘名 / 类型码，支持逗号 / 分号分隔
const DRIVE_ORDER_RAW = text(process.env.DRIVE_ORDER || DRIVE_ORDER_DEFAULT);
// ==================== 配置区域结束 ====================

const http = axios.create({
  timeout: 15000,
  headers: {
    "User-Agent": UA,
    "Accept": "application/json,text/plain,*/*",
    "Referer": `${BASE}/`
  },
  validateStatus: () => true
});

function text(v) {
  return String(v == null ? "" : v).trim();
}

function splitConfigList(v) {
  return text(v)
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeJson(input, fallback = {}) {
  if (input == null) return fallback;
  if (typeof input === "object") return input;
  try {
    return JSON.parse(input);
  } catch {
    return fallback;
  }
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

function buildCacheKey(prefix, value) {
  return `${prefix}:${value}`;
}

async function getCachedJSON(key) {
  try {
    const value = await OmniBox.getCache(key);
    if (value && Array.isArray(value.items) && value.items.length === 0) {
      await OmniBox.log("info", `[cache] 忽略空缓存 key=${key}`);
      return null;
    }
    return value;
  } catch (e) {
    await OmniBox.log("warn", `[cache] 读取失败 key=${key}: ${e.message}`);
    return null;
  }
}

async function setCachedJSON(key, value, exSeconds = SEARCH_CACHE_EX_SECONDS) {
  try {
    if (value && Array.isArray(value.items) && value.items.length === 0) {
      await OmniBox.log("info", `[cache] 跳过写入空缓存 key=${key}`);
      return;
    }
    await OmniBox.setCache(key, value, exSeconds);
  } catch (e) {
    await OmniBox.log("warn", `[cache] 写入失败 key=${key}: ${e.message}`);
  }
}

function isVideoFile(file) {
  const name = text(file?.file_name).toLowerCase();
  if (!name) return false;
  const exts = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v"];
  if (exts.some((ext) => name.endsWith(ext))) return true;
  const formatType = text(file?.format_type).toLowerCase();
  return formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264");
}

async function apiGet(path, params = {}) {
  try {
    const res = await http.get(`${API}${path}`, { params });
    return safeJson(res.data, {});
  } catch (e) {
    await OmniBox.log("warn", `[dyuzi] GET ${path} 失败: ${e.message}`);
    return { code: 1005, message: e.message || "request failed", data: {} };
  }
}

/**
 * 批量调用 PanCheck 检测链接有效性
 * @param {string[]} links
 * @returns {Promise<Set<string>>} invalid links set
 */
async function checkLinksWithPanCheck(links) {
  if (!PANCHECK_ENABLED || !PANCHECK_API || !Array.isArray(links) || links.length === 0) {
    return {
      invalidLinksSet: new Set(),
      stats: null,
    };
  }

  try {
    const { selectedPlatforms, linksToCheck, bypassLinks } = splitLinksByPanCheckPlatforms(links);
    const detectDriveType = (link) => normalizeDriveType("", link) || "unknown";
    const inputPlatformStats = {};

    for (const link of links) {
      const driveType = detectDriveType(link);
      inputPlatformStats[driveType] = (inputPlatformStats[driveType] || 0) + 1;
    }

    if (linksToCheck.length === 0) {
      await OmniBox.log("info", `[dyuzi] PanCheck 跳过: 未命中待校验平台, 跳过链接数量=${bypassLinks.length}`);
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

    const body = { links: linksToCheck };
    if (selectedPlatforms.length) body.selected_platforms = selectedPlatforms;

    const apiUrl = PANCHECK_API.replace(/\/$/, "");
    const checkURL = `${apiUrl}/api/v1/links/check`;

    await OmniBox.log("info", `[dyuzi] PanCheck 开始，总链接=${links.length}, 待校验=${linksToCheck.length}, 跳过=${bypassLinks.length}, 平台=${selectedPlatforms.join(",") || "全部"}, url=${checkURL}`);
    const res = await OmniBox.request(checkURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA
      },
      body: JSON.stringify(body)
    });

    if (res.statusCode !== 200) {
      await OmniBox.log("warn", `[dyuzi] PanCheck 状态码异常 status=${res.statusCode}`);
      return {
        invalidLinksSet: new Set(),
        stats: null,
      };
    }

    const data = safeJson(res.body, {});
    const invalid = Array.isArray(data.invalid_links) ? data.invalid_links : [];
    const valid = Array.isArray(data.valid_links) ? data.valid_links : [];
    const invalidLinksSet = new Set(invalid.map((x) => String(x)));
    const checkedPlatformStats = {};
    const invalidPlatformStats = {};
    const validPlatformStats = {};
    const bypassPlatformStats = {};

    for (const link of linksToCheck) {
      const driveType = detectDriveType(link);
      checkedPlatformStats[driveType] = (checkedPlatformStats[driveType] || 0) + 1;
      if (invalidLinksSet.has(String(link))) {
        invalidPlatformStats[driveType] = (invalidPlatformStats[driveType] || 0) + 1;
      } else {
        validPlatformStats[driveType] = (validPlatformStats[driveType] || 0) + 1;
      }
    }

    for (const link of bypassLinks) {
      const driveType = detectDriveType(link);
      bypassPlatformStats[driveType] = (bypassPlatformStats[driveType] || 0) + 1;
    }

    await OmniBox.log("info", `[dyuzi] PanCheck 完成，有效链接数=${valid.length}, 无效链接数=${invalid.length}, 未校验直出=${bypassLinks.length}`);
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
        totalInvalid: invalid.length,
        totalValid: valid.length,
        totalBypass: bypassLinks.length,
        totalOutput: (links.length - invalid.length),
      },
    };
  } catch (e) {
    await OmniBox.log("warn", `[dyuzi] PanCheck 调用失败: ${e.message}`);
    return {
      invalidLinksSet: new Set(),
      stats: null,
    };
  }
}

function extractLinksFromItems(items) {
  const links = [];
  for (const it of items || []) {
    const link = text(it?.share_link || it?.link || "");
    if (link) links.push(link);
  }
  return [...new Set(links)];
}

function filterInvalidItems(items, invalidLinksSet) {
  if (!invalidLinksSet || invalidLinksSet.size === 0) return items || [];
  return (items || []).filter((it) => {
    const link = text(it?.share_link || it?.link || "");
    return !link || !invalidLinksSet.has(link);
  });
}

async function fetchHome() {
  return apiGet("/home", {});
}

async function searchStart(keyword, drive = "", limit = DEFAULT_PAGE_SIZE) {
  const params = { q: keyword, limit: String(limit) };
  if (drive) params.drive = drive;
  return apiGet("/search", params);
}

async function searchPoll(searchId, keyword = "", drive = "", limit = DEFAULT_PAGE_SIZE) {
  const params = { id: searchId, limit: String(limit) };
  if (keyword) params.q = keyword;
  if (drive) params.drive = drive;
  return apiGet("/searchPoll", params);
}

async function searchAll(keyword, drive = "", limit = DEFAULT_PAGE_SIZE) {
  const first = await searchStart(keyword, drive, limit);
  if (!first || first.code !== 0) return { code: 1001, data: { items: [] } };

  const data = first.data || {};
  const firstItems = data.list || data.items || [];
  const complete = !!data.complete;
  const sid = data.search_id || data.searchId || "";

  if (complete || !sid) return { code: 0, data: { items: firstItems, raw: data } };

  let latest = data;
  for (let i = 0; i < SEARCH_POLL_ROUNDS; i += 1) {
    await sleep(SEARCH_POLL_INTERVAL_MS);
    const poll = await searchPoll(sid, keyword, drive, limit);
    if (!poll || poll.code !== 0) continue;
    latest = poll.data || latest;
    const items = latest.list || latest.items || [];
    if (latest.complete && items.length > 0) {
      return { code: 0, data: { items, raw: latest } };
    }
    if (latest.complete) {
      return { code: 0, data: { items, raw: latest } };
    }
  }

  return { code: 0, data: { items: latest.list || latest.items || firstItems, raw: latest } };
}

async function fetchRanking(channel, limit = DEFAULT_PAGE_SIZE) {
  return apiGet("/ranking", { channel, limit: String(limit) });
}

async function resolveSlug(slug) {
  return apiGet("/resolve", { slug });
}

async function fetchResourceById(id) {
  return apiGet("/resources", { id });
}

async function resolveResource(inputId) {
  const raw = text(inputId);
  if (!raw) return null;

  // 1) 纯数字直接 resources
  if (/^\d+$/.test(raw)) {
    const direct = await fetchResourceById(raw);
    if (direct?.code === 0 && direct.data) return direct.data;
  }

  // 2) web_xxx / tg_xxx / slug 先 resolve
  const resolved = await resolveSlug(raw);
  if (resolved?.code === 0 && resolved.data?.id) {
    const rid = text(resolved.data.id);
    const res = await fetchResourceById(rid);
    if (res?.code === 0 && res.data) return res.data;
  }

  // 3) 最后尝试 resources(id=raw)
  const fallback = await fetchResourceById(raw);
  if (fallback?.code === 0 && fallback.data) return fallback.data;

  return null;
}

function driveFromLink(link) {
  const u = text(link).toLowerCase();
  if (!u) return "";
  if (u.includes("pan.quark.cn") || u.includes("drive.quark.cn")) return "quark";
  if (u.includes("pan.baidu.com")) return "baidu";
  if (u.includes("pan.xunlei.com")) return "xunlei";
  if (u.includes("drive.uc.cn") || u.includes("fast.uc.cn") || u.includes("uc.cn")) return "uc";
  if (u.includes("aliyundrive.com") || u.includes("alipan.com")) return "aliyun";
  if (u.includes("cloud.189.cn")) return "tianyiyun";
  if (u.includes("yun.139.com")) return "cmcc";
  if (u.includes("123684.com") || u.includes("123865.com") || u.includes("123912.com") || u.includes("123pan.com")) return "pan123";
  return "";
}

function driveAliasToCode(input) {
  const v = text(input).toLowerCase();
  if (!v) return "";

  const map = {
    "百度网盘": "baidu", "baidu": "baidu",
    "天翼网盘": "tianyiyun", "天翼": "tianyiyun", "tianyi": "tianyiyun", "tianyiyun": "tianyiyun",
    "夸克网盘": "quark", "quark": "quark",
    "uc网盘": "uc", "uc": "uc",
    "115网盘": "115", "115": "115",
    "迅雷网盘": "xunlei", "xunlei": "xunlei",
    "阿里网盘": "aliyun", "阿里云盘": "aliyun",
    "aliyun": "aliyun", "aliyundrive": "aliyun", "ali": "aliyun", "alipan": "aliyun",
    "移动云盘": "cmcc", "移动": "cmcc", "cmcc": "cmcc", "mobile": "cmcc", "139": "cmcc",
    "123网盘": "pan123", "123pan": "pan123", "pan123": "pan123", "123": "pan123"
  };

  return map[input] || map[v] || v;
}

/**
 * 网盘类型码 → 中文显示名称
 * 支持：baidu/quark/xunlei/uc/aliyun/tianyiyun/115 及原始值透传
 */
function driveLabel(driveType) {
  const d = text(driveType).toLowerCase();
  if (!d) return "网盘";
  if (d === "baidu") return "百度网盘";
  if (d === "tianyiyun") return "天翼网盘";
  if (d === "quark") return "夸克网盘";
  if (d === "uc") return "UC网盘";
  if (d === "115") return "115网盘";
  if (d === "xunlei") return "迅雷网盘";
  if (d === "aliyun" || d === "aliyundrive") return "阿里网盘";
  return text(driveType); // 未知类型原样透传
}

function driveShortLabel(driveType) {
  const d = text(driveType).toLowerCase();
  if (!d) return "网盘";
  if (d === "baidu") return "百度";
  if (d === "tianyiyun") return "天翼";
  if (d === "quark") return "夸克";
  if (d === "uc") return "UC";
  if (d === "115") return "115";
  if (d === "xunlei") return "迅雷";
  if (d === "aliyun" || d === "aliyundrive") return "阿里";
  if (d === "cmcc") return "移动";
  if (d === "pan123") return "123";
  return text(driveType);
}

/**
 * 将 drive_type 字段或链接归一化为小写内部类型码（供排序使用）
 * 例：aliyundrive → aliyun；空值从 share_link 推断
 */
function normalizeDriveType(driveTypeRaw, link) {
  const d = driveAliasToCode(driveTypeRaw);
  if (d) return d;
  return driveAliasToCode(driveFromLink(link || ""));
}

function getPanCheckSelectedPlatforms() {
  return splitConfigList(PANCHECK_PLATFORMS)
    .map((x) => driveAliasToCode(x))
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
    const driveType = normalizeDriveType("", link);
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

/**
 * 解析环境变量 DRIVE_ORDER → 网盘类型码数组
 * 默认顺序：百度 → 天翼 → 夸克 → UC → 115 → 迅雷 → 阿里
 * 支持中文网盘名 / 类型码，支持逗号/分号分隔
 * 配置示例：DRIVE_ORDER=夸克网盘,百度网盘,迅雷网盘
 *           DRIVE_ORDER=quark,baidu,xunlei
 *           DRIVE_ORDER=quark;baidu;xunlei
 */
function parseDriveOrderEnv() {
  const DEFAULT_ORDER = ["baidu", "tianyiyun", "quark", "uc", "115", "xunlei", "aliyun"];
  const raw = DRIVE_ORDER_RAW;
  if (!raw) return DEFAULT_ORDER;

  const out = [];
  for (const part of splitConfigList(raw)) {
    const code = driveAliasToCode(part);
    if (code && !out.includes(code)) out.push(code);
  }
  return out.length ? out : DEFAULT_ORDER;
}

/**
 * 按 DRIVE_ORDER 对搜索结果排序
 * - 配置内的网盘按配置顺序排前面
 * - 未配置的网盘按网盘中文名 locale 排序（保持稳定），再按资源标题排序
 */
function sortItemsByDriveOrder(items) {
  const order = parseDriveOrderEnv();
  const rankMap = new Map(order.map((d, i) => [d, i]));

  return [...(items || [])].sort((a, b) => {
    const da = normalizeDriveType(a?.drive_type || a?.disk_type || "", a?.share_link || a?.link || "");
    const db = normalizeDriveType(b?.drive_type || b?.disk_type || "", b?.share_link || b?.link || "");

    const ra = rankMap.has(da) ? rankMap.get(da) : Number.MAX_SAFE_INTEGER;
    const rb = rankMap.has(db) ? rankMap.get(db) : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;

    // 同优先级 → 网盘中文名 → 资源标题（保证稳定性）
    const nameCmp = driveLabel(da).localeCompare(driveLabel(db), "zh-Hans-CN");
    if (nameCmp !== 0) return nameCmp;
    return text(a?.title || a?.name || "").localeCompare(text(b?.title || b?.name || ""), "zh-Hans-CN");
  });
}

function resourceToVod(resource, mode = "search") {
  const id = text(resource.id || resource.resource_id || "");
  const title = text(resource.title || resource.name || "未命名资源");
  const poster = text(resource.poster || resource.src || "");
  const year = text(resource.year || "");
  const drive = text(resource.drive_type || resource.disk_type || driveFromLink(resource.share_link || resource.link || ""));
  const driveName = driveLabel(drive);
  const remark = driveName;

  const meta = {
    mode,
    id,
    title,
    drive,
    share_link: text(resource.share_link || resource.link || ""),
    share_code: text(resource.share_code || ""),
    source: text(resource.source || "")
  };

  return {
    vod_id: b64Encode(meta),
    vod_name: title,
    vod_pic: poster,
    type_id: drive || "dyuzi",
    type_name: driveName,
    vod_remarks: remark,
    vod_year: year,
    vod_douban_score: text(resource.score_avg || "")
  };
}

async function collectAllVideoFiles(shareURL, files) {
  const out = [];
  for (const file of files || []) {
    if (file?.file && isVideoFile(file)) {
      out.push(file);
      continue;
    }
    if (file?.dir) {
      try {
        const sub = await OmniBox.getDriveFileList(shareURL, file.fid);
        const subFiles = (sub && Array.isArray(sub.files)) ? sub.files : [];
        const subVideos = await collectAllVideoFiles(shareURL, subFiles);
        out.push(...subVideos);
      } catch (e) {
        await OmniBox.log("warn", `[dyuzi] 子目录读取失败: ${e.message}`);
      }
    }
  }
  return out;
}

function buildResourceId(shareURL, title) {
  return shareURL || title;
}

function normalizeTitleForScrape(rawTitle) {
  let s = text(rawTitle);
  if (!s) return s;

  // 去掉 emoji / 装饰前缀（常见：🗄、✅ 等）
  s = s.replace(/^[^\p{Script=Han}A-Za-z0-9]+/u, "").trim();

  // 去掉括号内容（画质、来源说明等）
  s = s.replace(/【[^】]*】/g, " ");
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/（[^）]*）/g, " ");

  // 去掉常见噪声词
  s = s.replace(/更新至\s*\d+\s*集/gi, " ");
  s = s.replace(/共\s*\d+\s*集/gi, " ");
  s = s.replace(/全\s*\d+\s*集/gi, " ");
  s = s.replace(/4K|HDR|DV|杜比|高码率|内封简中|中字|国语|粤语|无删减/gi, " ");

  // 去掉多余分隔符
  s = s.replace(/[|｜·•]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  // 太短就回退原值
  return s || text(rawTitle);
}

/**
 * 计算两个字符串的相似度（0~1），基于最长公共子序列字符覆盖率
 * 用于搜索结果按关键词相关性排序
 */
function titleSimilarity(a, b) {
  const sa = text(a).toLowerCase().replace(/\s+/g, "");
  const sb = text(b).toLowerCase().replace(/\s+/g, "");
  if (!sa || !sb) return 0;
  if (sa === sb) return 1;
  // 统计 sb 中在 sa 里出现的字符数（简单字符覆盖）
  let matched = 0;
  const used = Array(sa.length).fill(false);
  for (const ch of sb) {
    const idx = sa.indexOf(ch);
    if (idx !== -1 && !used[idx]) { matched++; used[idx] = true; }
  }
  return matched / Math.max(sa.length, sb.length);
}

function buildDisplayNameByTMDB(scrapeData, mapping, fallbackName) {
  if (!mapping) return fallbackName;
  if (mapping.episodeName) return mapping.episodeName;
  return fallbackName;
}

function buildPanGroupVod(keyword, driveType, count, extra = {}) {
  const folderMeta = {
    mode: "group_drive_folder",
    driveType,
    keyword,
    title: text(extra.title || keyword),
    channel: text(extra.channel || ""),
    video_id: text(extra.video_id || ""),
    vod_pic: text(extra.vod_pic || "")
  };
  return {
    vod_id: b64Encode(folderMeta),
    vod_name: driveLabel(driveType),
    vod_pic: text(extra.vod_pic || ""),
    type_id: "pan_category",
    type_name: text(extra.type_name || "网盘分类"),
    vod_remarks: `${count}条结果`,
    vod_tag: "folder",
    panType: driveType,
  };
}

function buildRankFolderVod(item, channel) {
  const title = text(item?.title);
  const videoId = text(item?.video_id || "");
  const keyword = title;
  return {
    vod_id: b64Encode({ mode: "rank_folder", title, channel, video_id: videoId, keyword }),
    vod_name: title,
    vod_pic: text(item?.src || ""),
    type_id: channel,
    type_name: channel,
    vod_remarks: text(item?.episode_count || item?.category || "点击查看网盘分组"),
    vod_year: text(item?.year || ""),
    vod_douban_score: text(item?.score_avg || ""),
    vod_tag: "folder"
  };
}

async function buildGroupedDetailFromKeyword(keyword, fallbackMeta = {}) {
  const rawKeyword = text(keyword || fallbackMeta?.title || "");
  if (!rawKeyword) return { list: [] };

  let items = await searchAndFilterItems(rawKeyword);
  const groups = new Map();
  for (const item of items) {
    const driveType = normalizeDriveType(item?.drive_type || item?.disk_type || "", item?.share_link || item?.link || "");
    if (!driveType) continue;
    groups.set(driveType, (groups.get(driveType) || 0) + 1);
  }

  const playSources = sortItemsByDriveOrder(
    [...groups.entries()].map(([driveType, count]) => ({
      name: driveLabel(driveType),
      drive_type: driveType,
      episodes: [{
        name: `${count}条结果`,
        playId: b64Encode({
          mode: "group_folder",
          driveType,
          keyword: rawKeyword,
          title: text(fallbackMeta?.title || rawKeyword),
          channel: text(fallbackMeta?.channel || ""),
          video_id: text(fallbackMeta?.video_id || "")
        })
      }]
    }))
  ).map((item) => ({ name: item.name, episodes: item.episodes }));

  return {
    list: [{
      vod_id: b64Encode({ mode: "rank_folder", title: text(fallbackMeta?.title || rawKeyword), channel: text(fallbackMeta?.channel || ""), video_id: text(fallbackMeta?.video_id || ""), keyword: rawKeyword }),
      vod_name: text(fallbackMeta?.title || rawKeyword),
      vod_pic: text(fallbackMeta?.vod_pic || ""),
      vod_content: "点击下方网盘线路进入对应分组结果",
      vod_remarks: "网盘分组",
      vod_year: text(fallbackMeta?.year || ""),
      vod_douban_score: text(fallbackMeta?.score_avg || ""),
      vod_play_sources: playSources
    }]
  };
}

function sortItemsWithinDrive(items, keyword) {
  return [...(items || [])].sort((a, b) => {
    const sa = titleSimilarity(keyword, normalizeTitleForScrape(text(a?.title || a?.name || "")));
    const sb = titleSimilarity(keyword, normalizeTitleForScrape(text(b?.title || b?.name || "")));
    if (Math.abs(sa - sb) > 0.01) return sb - sa;
    return text(b?.datetime || b?.created_at || "").localeCompare(text(a?.datetime || a?.created_at || ""), "zh-Hans-CN");
  });
}

async function searchAndFilterItems(keyword) {
  const normalizedKeyword = text(keyword);
  const cacheKey = buildCacheKey("jupan-group:search", normalizedKeyword);
  const cached = await getCachedJSON(cacheKey);
  if (cached && Array.isArray(cached.items)) {
    await OmniBox.log("info", `[search] 命中缓存 keyword=${normalizedKeyword}, count=${cached.items.length}`);
    return cached.items;
  }

  const res = await searchAll(normalizedKeyword, "", DEFAULT_PAGE_SIZE);
  let items = res?.data?.items || [];

  await OmniBox.log("info", `[search] 原始命中数量=${items.length}`);

  if (PANCHECK_ENABLED && PANCHECK_API && items.length > 0) {
    try {
      const links = extractLinksFromItems(items);
      await OmniBox.log("info", `[search] PanCheck 预校验链接数=${links.length}`);
      if (links.length > 0) {
        const { invalidLinksSet, stats } = await checkLinksWithPanCheck(links);
        const before = items.length;
        const filtered = filterInvalidItems(items, invalidLinksSet);
        const after = filtered.length;
        if (stats) {
          await OmniBox.log("info", `[search] PanCheck 分平台统计: 输入=${JSON.stringify(stats.inputPlatformStats)}, 校验=${JSON.stringify(stats.checkedPlatformStats)}, 过滤=${JSON.stringify(stats.invalidPlatformStats)}, 剩余=${JSON.stringify(stats.validPlatformStats)}, 跳过=${JSON.stringify(stats.bypassPlatformStats)}`);
          await OmniBox.log("info", `[search] PanCheck 总统计: 总输入=${stats.totalInput}, 总校验=${stats.totalChecked}, 总过滤=${stats.totalInvalid}, 总剩余=${stats.totalOutput}, 其中直出=${stats.totalBypass}`);
        }
        if (after === 0) {
          await OmniBox.log("warn", `[search] PanCheck 过滤后结果全空，回退原始结果 before=${before}, links=${links.length}`);
        } else {
          items = filtered;
          await OmniBox.log("info", `[search] PanCheck 过滤完成 before=${before}, after=${after}, removed=${before - after}`);
        }
      }
    } catch (e) {
      await OmniBox.log("warn", `[search] PanCheck 过滤失败，回退原始结果: ${e.message}`);
    }
  }

  await setCachedJSON(cacheKey, { items }, SEARCH_CACHE_EX_SECONDS);
  return items;
}

async function home(params, context) {
  const homeRes = await fetchHome();
  const categories = (homeRes?.data?.categories || []).map((c) => ({
    type_id: text(c.name || c.id),
    type_name: text(c.name || c.id)
  }));

  const classes = categories.length
    ? categories
    : RANK_CHANNELS.map((name) => ({ type_id: name, type_name: name }));

  const list = [];
  const rank = await fetchRanking("电视剧", 10);
  const rankList = rank?.data?.list || [];
  for (const item of rankList) {
    list.push(buildRankFolderVod(item, "电视剧"));
  }

  return { class: classes, list };
}

async function category(params, context) {
  const categoryId = text(params?.categoryId || params?.type_id || "电视剧") || "电视剧";
  const page = Number(params?.page || 1) || 1;
  const limit = DEFAULT_PAGE_SIZE;
  const decodedCategoryMeta = b64Decode(categoryId);

  if (decodedCategoryMeta?.mode === "rank_folder") {
    const keyword = text(decodedCategoryMeta.keyword || decodedCategoryMeta.title || "");
    await OmniBox.log("info", `[category] rank_folder 分组列表 keyword=${keyword}, page=${page}`);
    if (page > 1) {
      await OmniBox.log("info", `[category] rank_folder 超出第一页，返回空列表 keyword=${keyword}, page=${page}`);
      return { page, pagecount: 1, total: 0, list: [] };
    }
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    let items = await searchAndFilterItems(keyword);
    const groups = new Map();
    for (const item of items) {
      const driveType = normalizeDriveType(item?.drive_type || item?.disk_type || "", item?.share_link || item?.link || "");
      if (!driveType) continue;
      groups.set(driveType, (groups.get(driveType) || 0) + 1);
    }

    const list = sortItemsByDriveOrder(
      [...groups.entries()].map(([driveType, count]) => ({
        ...buildPanGroupVod(keyword, driveType, count, {
          vod_pic: text(decodedCategoryMeta.vod_pic || ""),
          type_name: text(decodedCategoryMeta.channel || "网盘分类"),
          title: text(decodedCategoryMeta.title || keyword),
          channel: text(decodedCategoryMeta.channel || ""),
          video_id: text(decodedCategoryMeta.video_id || "")
        }),
        drive_type: driveType,
      }))
    ).map(({ drive_type, ...item }) => item);

    await setCachedJSON(buildCacheKey("jupan-group:drive-list", `${keyword}::all`), { items }, SEARCH_CACHE_EX_SECONDS);

    return {
      page,
      pagecount: 1,
      total: list.length,
      list
    };
  }

  if (decodedCategoryMeta?.mode === "group_drive_folder") {
    const driveType = normalizeDriveType(decodedCategoryMeta.driveType || "", "");
    const keyword = text(decodedCategoryMeta.keyword || decodedCategoryMeta.title || "");
    await OmniBox.log("info", `[category] group_drive_folder 分享列表 drive=${driveType}, keyword=${keyword}, page=${page}`);
    if (page > 1) {
      await OmniBox.log("info", `[category] group_drive_folder 超出第一页，返回空列表 drive=${driveType}, keyword=${keyword}, page=${page}`);
      return { page, pagecount: 1, total: 0, list: [] };
    }
    if (!keyword || !driveType) return { page, pagecount: 0, total: 0, list: [] };

    let cachedDriveList = await getCachedJSON(buildCacheKey("jupan-group:drive-list", `${keyword}::${driveType}`));
    let items = Array.isArray(cachedDriveList?.items) ? cachedDriveList.items : null;
    if (!items) {
      const allItems = await searchAndFilterItems(keyword);
      items = allItems.filter((it) => normalizeDriveType(it?.drive_type || it?.disk_type || "", it?.share_link || it?.link || "") === driveType);
      items = sortItemsWithinDrive(items, keyword);
      await setCachedJSON(buildCacheKey("jupan-group:drive-list", `${keyword}::${driveType}`), { items }, SEARCH_CACHE_EX_SECONDS);
    } else {
      await OmniBox.log("info", `[category] group_drive_folder 命中缓存 drive=${driveType}, count=${items.length}`);
    }

    const list = items.map((it) => {
      const vod = resourceToVod(it, "single_share");
      const meta = b64Decode(vod.vod_id);
      meta.mode = "single_share";
      meta.aggregate = false;
      meta.title = text(it?.title || it?.name || decodedCategoryMeta.title || keyword);
      meta.share_link = text(it?.share_link || it?.link || "");
      meta.drive = text(it?.drive_type || it?.disk_type || driveType);
      vod.vod_id = b64Encode(meta);
      return vod;
    });
    return {
      page,
      pagecount: 1,
      total: list.length,
      list
    };
  }

  if (categoryId.includes("|")) {
    const [driveTypeRaw, ...keywordParts] = categoryId.split("|");
    const driveType = normalizeDriveType(driveTypeRaw, "");
    const keyword = keywordParts.join("|");
    await OmniBox.log("info", `[category] 兼容旧分组二级列表 drive=${driveType}, keyword=${keyword}, page=${page}`);

    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    let items = await searchAndFilterItems(keyword);
    items = items.filter((it) => normalizeDriveType(it?.drive_type || it?.disk_type || "", it?.share_link || it?.link || "") === driveType);
    items = sortItemsWithinDrive(items, keyword);

    const list = items.map((it) => {
      const vod = resourceToVod(it, "single_share");
      const meta = b64Decode(vod.vod_id);
      meta.mode = "single_share";
      meta.aggregate = false;
      meta.title = text(it?.title || it?.name || keyword);
      meta.share_link = text(it?.share_link || it?.link || "");
      meta.drive = text(it?.drive_type || it?.disk_type || driveType);
      vod.vod_id = b64Encode(meta);
      return vod;
    });
    return {
      page,
      pagecount: 1,
      total: list.length,
      list
    };
  }

  const channel = categoryId;
  const rank = await fetchRanking(channel, limit);
  if (!rank || rank.code !== 0) {
    return { page, pagecount: 0, total: 0, list: [] };
  }

  const rows = rank?.data?.list || [];
  const list = rows.map((item) => buildRankFolderVod(item, channel));

  return {
    page,
    pagecount: 1,
    total: list.length,
    list
  };
}

async function search(params, context) {
  const keyword = text(params?.keyword || params?.wd || "");
  const page = Number(params?.page || 1) || 1;
  if (!keyword) return { page: 1, pagecount: 0, total: 0, list: [] };
  if (page > 1) return { page, pagecount: 1, total: 0, list: [] };

  await OmniBox.log("info", `[search] 开始 keyword=${keyword}, page=${page}, mode=grouped`);
  let items = await searchAndFilterItems(keyword);

  const groups = new Map();
  for (const item of items) {
    const driveType = normalizeDriveType(item?.drive_type || item?.disk_type || "", item?.share_link || item?.link || "");
    if (!driveType) continue;
    groups.set(driveType, (groups.get(driveType) || 0) + 1);
  }

  const list = [...groups.entries()].map(([driveType, count]) => buildPanGroupVod(keyword, driveType, count));
  const sorted = sortItemsByDriveOrder(list.map((item) => ({ ...item, drive_type: item.panType }))).map((item) => ({
    vod_id: item.vod_id,
    vod_name: item.vod_name,
    vod_pic: item.vod_pic,
    type_id: item.type_id,
    type_name: item.type_name,
    vod_remarks: item.vod_remarks,
    vod_tag: item.vod_tag,
    panType: item.panType,
  }));

  await OmniBox.log("info", `[search] 分组返回数量=${sorted.length}, 顺序=${sorted.map(x => x.panType).join(",")}`);
  return {
    page,
    pagecount: 1,
    total: sorted.length,
    list: sorted
  };
}

async function resolveShareResourceFromVodMeta(meta) {
  if (!meta || typeof meta !== "object") {
    await OmniBox.log("warn", `[dyuzi] resolveShareResourceFromVodMeta: meta 非对象`);
    return null;
  }

  await OmniBox.log(
    "info",
    `[dyuzi] resolveShareResourceFromVodMeta: mode=${text(meta.mode)}, id=${text(meta.id)}, title=${text(meta.title)}, hasShare=${!!text(meta.share_link)}, hasVideoId=${!!text(meta.video_id)}`
  );

  // 1) 搜索结果已带 share_link，直接用
  if (text(meta.share_link)) {
    await OmniBox.log("info", `[dyuzi] resolve: 直接使用 meta.share_link`);
    return {
      id: text(meta.id),
      title: text(meta.title),
      share_link: text(meta.share_link),
      share_code: text(meta.share_code),
      drive_type: text(meta.drive || driveFromLink(meta.share_link)),
      source: text(meta.source || "")
    };
  }

  // 2) 有 id，去 resources 拉详情
  if (text(meta.id)) {
    await OmniBox.log("info", `[dyuzi] resolve: 通过 meta.id 拉取资源 id=${text(meta.id)}`);
    const resource = await resolveResource(text(meta.id));
    if (resource) {
      await OmniBox.log("info", `[dyuzi] resolve: meta.id 命中资源 id=${text(resource.id || resource.resource_id)}`);
      return resource;
    }
  }

  // 3) rank 模式：优先用 video_id（站点返回的“标题/年份/频道”）检索，再按 title 兜底
  if (meta.mode === "rank") {
    const rankVideoId = text(meta.video_id || "");
    const rankTitle = text(meta.title || "");

    if (rankVideoId) {
      await OmniBox.log("info", `[dyuzi] resolve: rank 模式，先用 video_id 检索 keyword=${rankVideoId}`);
      const byVideoId = await searchAll(rankVideoId, "", 20);
      const idItems = byVideoId?.data?.items || [];
      await OmniBox.log("info", `[dyuzi] resolve: video_id 检索结果数量=${idItems.length}`);
      if (idItems.length) {
        const first = idItems[0];
        const resource = await resolveResource(text(first.id || first.resource_id || ""));
        if (resource) {
          await OmniBox.log("info", `[dyuzi] resolve: video_id 路径命中资源 id=${text(resource.id || resource.resource_id)}`);
          return resource;
        }
        if (text(first.share_link || first.link)) {
          await OmniBox.log("info", `[dyuzi] resolve: video_id 路径直接命中 share_link`);
          return first;
        }
      }
    }

    if (rankTitle) {
      await OmniBox.log("info", `[dyuzi] resolve: rank 模式，title 兜底检索 keyword=${rankTitle}`);
      const byTitle = await searchAll(rankTitle, "", 20);
      const titleItems = byTitle?.data?.items || [];
      await OmniBox.log("info", `[dyuzi] resolve: title 检索结果数量=${titleItems.length}`);
      if (titleItems.length) {
        const first = titleItems[0];
        const resource = await resolveResource(text(first.id || first.resource_id || ""));
        if (resource) {
          await OmniBox.log("info", `[dyuzi] resolve: title 路径命中资源 id=${text(resource.id || resource.resource_id)}`);
          return resource;
        }
        if (text(first.share_link || first.link)) {
          await OmniBox.log("info", `[dyuzi] resolve: title 路径直接命中 share_link`);
          return first;
        }
      }
    }
  }

  // 4) 普通兜底：按 title 搜一次
  if (text(meta.title)) {
    await OmniBox.log("info", `[dyuzi] resolve: 通用 title 兜底 keyword=${text(meta.title)}`);
    const fallback = await searchAll(text(meta.title), "", 20);
    const items = fallback?.data?.items || [];
    await OmniBox.log("info", `[dyuzi] resolve: 通用兜底结果数量=${items.length}`);
    if (items.length) {
      const first = items[0];
      const resource = await resolveResource(text(first.id || first.resource_id || ""));
      if (resource) return resource;
      if (text(first.share_link || first.link)) return first;
    }
  }

  await OmniBox.log("warn", `[dyuzi] resolve: 所有路径都未命中资源`);
  return null;
}

async function detail(params, context) {
  try {
    const vodId = text(params?.videoId || "");
    if (!vodId) return { list: [] };

    const meta = b64Decode(vodId);

    if (meta.mode === "rank_folder") {
      const keyword = text(meta.keyword || meta.title || "");
      await OmniBox.log("info", `[detail] rank_folder 分组详情 keyword=${keyword}, title=${text(meta.title || "")}`);
      return await buildGroupedDetailFromKeyword(keyword, {
        title: text(meta.title || keyword),
        channel: text(meta.channel || ""),
        video_id: text(meta.video_id || ""),
      });
    }

    const rawTitle = text(meta.title || "聚盘资源");
    const scrapeTitle = normalizeTitleForScrape(rawTitle);

    await OmniBox.log("info", `[detail] 开始 vodId=${vodId}, title=${rawTitle}`);

    // ── Step 1: 单分享详情只保留当前分享；其他模式才做 resolve + 聚合 ───────
    let candidates = [];
    const singleShareMode = meta.mode === "single_share" || meta.aggregate === false;

    if (singleShareMode) {
      const directLink = text(meta.share_link || "");
      await OmniBox.log("info", `[detail] 单分享模式 hasLink=${!!directLink}, title=${rawTitle}`);
      if (directLink) {
        candidates.push({
          id: text(meta.id),
          title: rawTitle,
          share_link: directLink,
          share_code: text(meta.share_code || ""),
          drive_type: text(meta.drive || driveFromLink(directLink)),
          poster: text(meta.poster || meta.src || ""),
          source: text(meta.source || "")
        });
      }
    } else {
      try {
        const resolved = await resolveShareResourceFromVodMeta(meta);
        if (resolved) {
          const resolvedLink = text(resolved.share_link || resolved.link || "");
          await OmniBox.log("info", `[detail] resolve 命中: hasLink=${!!resolvedLink}, id=${text(resolved.id || resolved.resource_id || "")}`);
          if (resolvedLink) {
            candidates.push({
              id: text(resolved.id || resolved.resource_id || meta.id),
              title: text(resolved.title || resolved.name || rawTitle),
              share_link: resolvedLink,
              share_code: text(resolved.share_code || ""),
              drive_type: text(resolved.drive_type || resolved.disk_type || driveFromLink(resolvedLink)),
              poster: text(resolved.poster || resolved.src || ""),
              source: text(resolved.source || "")
            });
          }
        } else {
          await OmniBox.log("info", `[detail] resolve 未命中，继续走聚合搜索`);
        }
      } catch (e) {
        await OmniBox.log("warn", `[detail] resolve 失败，继续走聚合搜索: ${e.message}`);
      }

      if (text(meta.share_link)) {
        const directLink = text(meta.share_link);
        if (!candidates.some((c) => text(c.share_link) === directLink)) {
          candidates.push({
            id: text(meta.id),
            title: rawTitle,
            share_link: directLink,
            share_code: text(meta.share_code || ""),
            drive_type: text(meta.drive || driveFromLink(directLink)),
            poster: "",
            source: text(meta.source || "")
          });
        }
      }

      try {
        const searchKeyword = scrapeTitle || rawTitle;
        await OmniBox.log("info", `[detail] 聚合搜索 keyword=${searchKeyword}`);
        const searchItems = await searchAndFilterItems(searchKeyword);
        await OmniBox.log("info", `[detail] 聚合搜索命中数=${searchItems.length}`);
        for (const item of searchItems) {
          const link = text(item.share_link || item.link || "");
          if (!link) continue;
          if (candidates.some((c) => text(c.share_link) === link)) continue;
          candidates.push(item);
        }
      } catch (e) {
        await OmniBox.log("warn", `[detail] 聚合搜索失败: ${e.message}`);
      }
    }

    await OmniBox.log("info", `[detail] 聚合前候选数=${candidates.length}`);

    // ── Step 2: PanCheck 批量过滤失效链接 ────────────────────────────────
    if (PANCHECK_ENABLED && PANCHECK_API && candidates.length > 0) {
      try {
        const links = candidates.map((c) => text(c.share_link || c.link || "")).filter(Boolean);
        await OmniBox.log("info", `[detail] PanCheck 开始，链接数=${links.length}`);
        const { invalidLinksSet, stats } = await checkLinksWithPanCheck(links);
        const before = candidates.length;
        const filtered = candidates.filter((c) => !invalidLinksSet.has(text(c.share_link || c.link || "")));
        if (stats) {
          await OmniBox.log("info", `[detail] PanCheck 分平台统计: 输入=${JSON.stringify(stats.inputPlatformStats)}, 校验=${JSON.stringify(stats.checkedPlatformStats)}, 过滤=${JSON.stringify(stats.invalidPlatformStats)}, 剩余=${JSON.stringify(stats.validPlatformStats)}, 跳过=${JSON.stringify(stats.bypassPlatformStats)}`);
          await OmniBox.log("info", `[detail] PanCheck 总统计: 总输入=${stats.totalInput}, 总校验=${stats.totalChecked}, 总过滤=${stats.totalInvalid}, 总剩余=${stats.totalOutput}, 其中直出=${stats.totalBypass}`);
        }
        if (filtered.length === 0) {
          await OmniBox.log("warn", `[detail] PanCheck 过滤后结果全空，回退原始候选 before=${before}, links=${links.length}`);
        } else {
          candidates = filtered;
          await OmniBox.log("info", `[detail] PanCheck 过滤完成 before=${before}, after=${candidates.length}, removed=${before - candidates.length}`);
        }
      } catch (e) {
        await OmniBox.log("warn", `[detail] PanCheck 过滤失败，回退: ${e.message}`);
      }
    }

    if (!candidates.length) {
      await OmniBox.log("warn", `[detail] 无有效候选资源 vodId=${vodId}`);
      return { list: [] };
    }

    // ── Step 3: 按 DRIVE_ORDER 排序 ──────────────────────────────────────
    candidates = sortItemsByDriveOrder(candidates);
    await OmniBox.log("info", `[detail] 排序后首盘=${normalizeDriveType(candidates[0]?.drive_type || "", candidates[0]?.share_link || "")}`);

    const primaryResource = candidates[0];
    const primaryTitle = text(primaryResource.title || primaryResource.name || rawTitle);
    const primaryShareURL = text(primaryResource.share_link || primaryResource.link || "");
    // resourceId 用主资源的 shareURL（刮削 key）
    const resourceId = buildResourceId(primaryShareURL, primaryTitle);

    // ── Step 4: 并行展开目录 + 各自刮削 ──────────────────────────────────
    // 每条候选资源各自独立刮削，映射结果存入 Map<shareURL, mappingMap>
    async function prepareCandidateData(candidate) {
      const shareURL = text(candidate.share_link || candidate.link || "");
      if (!shareURL) return null;

      const driveType = normalizeDriveType(candidate.drive_type || candidate.disk_type || "", shareURL);
      await OmniBox.log("info", `[detail] 准备候选(并行) drive=${driveType}, url=${shareURL.substring(0, 60)}`);

      // 展开目录
      let videoFiles = [];
      try {
        const root = await OmniBox.getDriveFileList(shareURL, "0");
        const rootFiles = (root && Array.isArray(root.files)) ? root.files : [];
        videoFiles = await collectAllVideoFiles(shareURL, rootFiles);
        await OmniBox.log("info", `[detail] 文件数=${videoFiles.length} drive=${driveType}`);
      } catch (e) {
        await OmniBox.log("warn", `[detail] 目录读取失败 drive=${driveType}: ${e.message}`);
        return { candidate, driveType, shareURL, videoFiles: [], scrapeData: null, mappingMap: new Map() };
      }

      // 独立刮削（每条线路各自刮削）
      let cScrapeData = null;
      let cMappingMap = new Map();
      if (videoFiles.length > 0) {
        try {
          const cResourceId = buildResourceId(shareURL, primaryTitle);
          const scrapeCandidates = videoFiles.map((f) => {
            const fid = text(f.fid || f.file_id || "");
            return { ...f, fid: `${shareURL}|${fid}`, file_id: `${shareURL}|${fid}`, file_name: text(f.file_name || f.name || "") };
          });
          await OmniBox.log("info", `[detail] 刮削 drive=${driveType}, resourceId=${cResourceId}`);
          await OmniBox.processScraping(cResourceId, scrapeTitle, scrapeTitle, scrapeCandidates);
          const metadata = await OmniBox.getScrapeMetadata(cResourceId);
          cScrapeData = metadata?.scrapeData || null;
          const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
          for (const m of mappings) {
            if (m?.fileId) cMappingMap.set(String(m.fileId), m);
          }
          await OmniBox.log("info", `[detail] 刮削完成 drive=${driveType}, hasScrape=${!!cScrapeData}, mappings=${mappings.length}`);
        } catch (e) {
          await OmniBox.log("warn", `[detail] 刮削失败 drive=${driveType}: ${e.message}`);
        }
      }

      return { candidate, driveType, shareURL, videoFiles, scrapeData: cScrapeData, mappingMap: cMappingMap };
    }

    await OmniBox.log("info", `[detail] 并行准备候选数=${candidates.length}`);
    const preparedList = (await Promise.all(candidates.map(prepareCandidateData))).filter(Boolean);

    // 取主线路刮削数据（用于 vod 封面/简介）
    const primaryPrepared = preparedList[0];
    const primaryScrapeData = primaryPrepared?.scrapeData || null;

    // ── Step 5: 构建播放线路 ─────────────────────────────────────────────
    // 先按网盘名统计每个 baseName 对应多少个不同的 shareURL，确定是否需要序号
    const baseNameShareCount = new Map(); // baseName -> Set<shareURL>
    for (const prep of preparedList) {
      if (!prep) continue;
      const driveLabelName = driveShortLabel(prep.driveType);
      const set = baseNameShareCount.get(driveLabelName) || new Set();
      set.add(prep.shareURL);
      baseNameShareCount.set(driveLabelName, set);
    }

    const baseNameIndexMap = new Map(); // baseName -> 当前已分配序号
    const playSources = [];

    for (const prep of preparedList) {
      if (!prep) continue;
      const { candidate, driveType, shareURL, videoFiles, scrapeData: cScrapeData, mappingMap: cMappingMap } = prep;
      const driveLabelName = driveShortLabel(driveType);

      // 确定序号：同 baseName 有多个不同 shareURL 时才加序号
      const needIndex = (baseNameShareCount.get(driveLabelName)?.size || 0) > 1;
      const idx = needIndex ? (baseNameIndexMap.get(driveLabelName) || 0) + 1 : null;
      if (needIndex) baseNameIndexMap.set(driveLabelName, idx);
      const labelWithIdx = needIndex ? `${driveLabelName}${idx}` : driveLabelName;

      // 无视频文件时直接排除：这类候选通常是目录展开失败、分享失效或当前链路无法拿到有效视频文件
      if (!videoFiles.length) {
        await OmniBox.log("warn", `[detail] 排除无有效视频文件候选 drive=${driveType}, url=${shareURL.substring(0, 60)}`);
        continue;
      }

      // 子线路名：与盘搜分组.js 对齐，匹配 DRIVE_TYPE_CONFIG 时才展开 SOURCE_NAMES_CONFIG
      let sourceNames = ["直连"];
      if (DRIVE_TYPE_CONFIG.includes(driveType)) {
        sourceNames = [...SOURCE_NAMES_CONFIG];
        if (context?.from === "web") {
          sourceNames = sourceNames.filter((x) => x !== "本地代理");
        }
      }

      for (const sourceName of sourceNames) {
        const episodes = [];
        for (const file of videoFiles) {
          const fid = text(file.fid || file.file_id || "");
          if (!fid) continue;
          const mappedFileId = `${shareURL}|${fid}`;
          const mapping = cMappingMap.get(mappedFileId);
          const fallbackName = text(file.file_name || file.name || "视频");
          const epName = buildDisplayNameByTMDB(cScrapeData, mapping, fallbackName);

          const ep = {
            name: epName,
            playId: b64Encode({ mode: "drive_file", shareURL, fid, flag: sourceName, epName, title: primaryTitle, driveType, resourceId, mappedFileId }),
            size: Number(file.size || file.file_size || 0) || undefined
          };

          if (mapping) {
            ep.episodeName = mapping.episodeName || undefined;
            ep.episodeOverview = mapping.episodeOverview || undefined;
            ep.episodeAirDate = mapping.episodeAirDate || undefined;
            ep.episodeStillPath = mapping.episodeStillPath || undefined;
            ep.episodeVoteAverage = mapping.episodeVoteAverage ?? undefined;
            ep.episodeRuntime = mapping.episodeRuntime ?? undefined;
            ep._season = mapping.seasonNumber ?? 0;
            ep._episode = mapping.episodeNumber ?? 0;
          }
          episodes.push(ep);
        }

        if (episodes.some((e) => e._episode != null)) {
          episodes.sort((a, b) => {
            const sa = Number(a._season || 0), sb = Number(b._season || 0);
            if (sa !== sb) return sa - sb;
            return Number(a._episode || 0) - Number(b._episode || 0);
          });
        }
        for (const ep of episodes) { delete ep._season; delete ep._episode; }
        if (episodes.length) {
          let finalSourceName = labelWithIdx;
          if (DRIVE_TYPE_CONFIG.includes(driveType)) {
            finalSourceName = `${labelWithIdx}-${sourceName}`;
          }
          playSources.push({ name: finalSourceName, episodes });
        }
      }
    }

    await OmniBox.log("info", `[detail] 完成 线路数=${playSources.length}, 线路名=${playSources.map(s => s.name).join(",")}`);

    return {
      list: [{
        vod_id: vodId,
        vod_name: text(primaryScrapeData?.title || primaryTitle),
        vod_pic: primaryScrapeData?.posterPath
          ? `https://image.tmdb.org/t/p/w500${primaryScrapeData.posterPath}`
          : text(primaryResource.poster || primaryResource.src || ""),
        vod_content: text(primaryScrapeData?.overview || primaryResource.description || primaryResource.desc || ""),
        vod_remarks: driveLabel(normalizeDriveType(primaryResource.drive_type || "", primaryShareURL)),
        vod_year: text((primaryScrapeData?.releaseDate || primaryResource.year || "").slice?.(0, 4) || primaryResource.year || ""),
        vod_douban_score: text(primaryScrapeData?.voteAverage != null ? Number(primaryScrapeData.voteAverage).toFixed(1) : (primaryResource.score_avg || "")),
        vod_play_sources: playSources
      }]
    };
  } catch (e) {
    await OmniBox.log("error", `[detail] 异常: ${e.message}`);
    return { list: [] };
  }
}


async function play(params, context) {
  try {
    const playId = text(params?.playId || "");
    const meta = b64Decode(playId);

    if (meta.mode === "group_folder") {
      const driveType = normalizeDriveType(meta.driveType || "", "");
      const keyword = text(meta.keyword || meta.title || "");
      await OmniBox.log("info", `[play] group_folder 跳转 drive=${driveType}, keyword=${keyword}`);
      const categoryResult = await category({ categoryId: `${driveType}|${keyword}`, page: 1 }, context);
      const first = Array.isArray(categoryResult?.list) ? categoryResult.list[0] : null;
      if (!first?.vod_id) {
        throw new Error(`分组结果为空 drive=${driveType}, keyword=${keyword}`);
      }
      return {
        urls: [{ name: first.vod_name || driveLabel(driveType), url: `omnibox://detail?videoId=${encodeURIComponent(first.vod_id)}` }],
        header: { "User-Agent": UA, "Referer": `${BASE}/` },
        parse: 1,
        danmaku: []
      };
    }

    // raw_link 退化模式
    if (meta.mode === "raw_link") {
      const url = text(meta.shareURL || "");
      return {
        urls: [{ name: meta.epName || "播放", url }],
        header: { "User-Agent": UA, "Referer": `${BASE}/` },
        parse: /\.(m3u8|mp4|flv|webm)(\?|$)/i.test(url) ? 0 : 1
      };
    }

    const shareURL = text(meta.shareURL || "");
    const fid = text(meta.fid || "");
    const flag = text(meta.flag || "");
    const title = text(meta.title || "");
    const epName = text(meta.epName || "");
    const resourceId = text(meta.resourceId || shareURL);

    if (!shareURL || !fid) {
      throw new Error("无效播放参数：缺少 shareURL 或 fid");
    }

    let routeType = context?.from === "web" ? "服务端代理" : "直连";
    if (flag) {
      if (flag.includes("-")) {
        const parts = flag.split("-");
        routeType = parts[parts.length - 1];
      } else {
        routeType = flag;
      }
    }
    const info = await OmniBox.getDriveVideoPlayInfo(shareURL, fid, routeType);

    const urls = [];
    if (Array.isArray(info?.url)) {
      for (const u of info.url) {
        if (!u?.url) continue;
        urls.push({ name: text(u.name || "播放"), url: text(u.url) });
      }
    } else if (typeof info?.url === "string" && info.url) {
      urls.push({ name: "播放", url: info.url });
    }

    if (!urls.length) {
      throw new Error("未获取到可用播放地址");
    }

    // 弹幕（可选）
    let danmaku = [];
    try {
      const metadata = await OmniBox.getScrapeMetadata(resourceId);
      const mappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];
      const mapping = mappings.find((m) => String(m?.fileId || "") === String(meta.mappedFileId || "")) || null;
      const scrapeData = metadata?.scrapeData || null;

      let fileName = "";
      // 优先级链：
      // 1) 刮削成功 + 映射成功 → Title.Year.SxxExx（精确匹配弹幕库）
      // 2) 仅刮削成功无映射   → 刮削标题 + epName
      // 3) 刮削失败           → normalizeTitleForScrape(title) + epName（净化原始标题）
      // 最后兜底用 epName（集名本身）
      if (mapping && scrapeData) {
        // 路径1：精确格式
        const title2 = text(scrapeData.title || title);
        const year = text(scrapeData.seasonAirYear || scrapeData.releaseDate || "").slice(0, 4);
        const sNum = Number(mapping.seasonNumber || 1);
        const eNum = Number(mapping.episodeNumber || 1);
        fileName = `${title2}${year ? `.${year}` : ""}.S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`;
      } else if (scrapeData) {
        // 路径2：刮削有结果但无集映射
        const title2 = text(scrapeData.title || title);
        fileName = epName ? `${title2} ${epName}`.trim() : title2;
      } else {
        // 路径3：刮削失败，净化原始标题
        const cleanTitle = normalizeTitleForScrape(title);
        fileName = epName ? `${cleanTitle} ${epName}`.trim() : cleanTitle;
      }

      await OmniBox.log("info", `[dyuzi] 弹幕匹配 fileName=${fileName}, hasMapping=${!!mapping}, hasScrape=${!!scrapeData}`);
      if (fileName) {
        danmaku = await OmniBox.getDanmakuByFileName(fileName);
      }
      await OmniBox.log("info", `[dyuzi] 弹幕匹配完成 count=${Array.isArray(danmaku) ? danmaku.length : 0}`);
    } catch (e) {
      await OmniBox.log("warn", `[dyuzi] 弹幕匹配失败: ${e.message}`);
    }

    return {
      urls,
      header: info?.header || { "User-Agent": UA, "Referer": `${BASE}/` },
      parse: 0,
      danmaku: Array.isArray(danmaku) ? danmaku : []
    };
  } catch (e) {
    await OmniBox.log("error", `[dyuzi] play 异常: ${e.message}`);
    return {
      urls: [],
      header: { "User-Agent": UA, "Referer": `${BASE}/` },
      parse: 1,
      danmaku: []
    };
  }
}

module.exports = { home, category, detail, search, play };
runner.run(module.exports);
