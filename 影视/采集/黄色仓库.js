// @name 黄色仓库
// @author 梦
// @description 刮削：不支持，弹幕：不支持，嗅探：不支持
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/黄色仓库.js

const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
// 采集站 API 地址（优先使用环境变量，如果没有则使用默认值）
const SITE_API = process.env.SITE_API || "https://huangsecangku.net/api.php/provide/vod";
// 请求超时时间（毫秒）
const API_TIMEOUT = Number(process.env.HSCK_API_TIMEOUT || 10000);
// 是否过滤广告分类：1=过滤，0=不过滤
const FILTER_AD_CATEGORY = String(process.env.HSCK_FILTER_AD_CATEGORY || "1") === "1";
// 默认请求头
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36";
// ==================== 配置区域结束 ====================

function logInfo(message, data = null) {
  if (data) {
    OmniBox.log("info", `[黄色仓库] ${message}: ${JSON.stringify(data)}`);
  } else {
    OmniBox.log("info", `[黄色仓库] ${message}`);
  }
}

function logError(message, error) {
  OmniBox.log("error", `[黄色仓库] ${message}: ${error?.message || error}`);
}

function buildApiUrl(params = {}) {
  const url = new URL(SITE_API);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function requestApi(params = {}) {
  const url = buildApiUrl(params);
  logInfo("请求接口", { url });

  const response = await OmniBox.request(url, {
    method: "GET",
    headers: {
      "User-Agent": DEFAULT_UA,
      "Accept": "application/json,text/plain,*/*",
      "Referer": "https://huangsecangku.net/"
    },
    timeout: API_TIMEOUT,
  });

  if (response.statusCode !== 200) {
    throw new Error(`HTTP ${response.statusCode}`);
  }

  let data;
  try {
    data = JSON.parse(response.body || "{}");
  } catch (error) {
    throw new Error(`JSON 解析失败: ${error.message}`);
  }

  if (data.code !== 1) {
    throw new Error(data.msg || "接口返回失败");
  }

  return data;
}

function normalizePic(url = "") {
  return String(url || "").trim();
}

function mapVodItem(item = {}) {
  return {
    vod_id: String(item.vod_id || ""),
    vod_name: item.vod_name || "未命名",
    vod_pic: normalizePic(item.vod_pic),
    vod_remarks: item.vod_remarks || item.type_name || "",
  };
}

function filterClasses(classList = []) {
  if (!Array.isArray(classList)) return [];
  return classList
    .filter((item) => item && item.type_id)
    .filter((item) => !(FILTER_AD_CATEGORY && String(item.type_name || "").includes("广告")))
    .map((item) => ({
      type_id: String(item.type_id),
      type_name: item.type_name || String(item.type_id),
    }));
}

function parsePlaySources(vodPlayFrom = "", vodPlayUrl = "") {
  const fromList = String(vodPlayFrom || "").split("$$$").filter(Boolean);
  const urlList = String(vodPlayUrl || "").split("$$$").filter(Boolean);
  const result = [];

  for (let i = 0; i < Math.max(fromList.length, urlList.length); i++) {
    const from = fromList[i] || `线路${i + 1}`;
    const current = urlList[i] || "";
    if (!current) continue;

    const episodes = current
      .split("#")
      .map((item, index) => {
        const parts = item.split("$");
        if (parts.length >= 2) {
          return {
            name: parts[0] || `播放${index + 1}`,
            playId: parts.slice(1).join("$") || "",
          };
        }
        return {
          name: `播放${index + 1}`,
          playId: item,
        };
      })
      .filter((item) => item.playId);

    if (episodes.length > 0) {
      result.push({ name: from, episodes });
    }
  }

  return result;
}

async function home(params, context) {
  try {
    const data = await requestApi({ ac: "list", pg: 1 });
    const classList = filterClasses(data.class || []);
    const list = Array.isArray(data.list) ? data.list.map(mapVodItem) : [];

    return {
      class: classList,
      list,
    };
  } catch (error) {
    logError("获取首页失败", error);
    return { class: [], list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = params.categoryId || params.t || "";
    const page = Number(params.page || 1);
    if (!categoryId) {
      throw new Error("分类ID不能为空");
    }

    const data = await requestApi({ ac: "list", t: categoryId, pg: page });
    return {
      page: Number(data.page || page),
      pagecount: Number(data.pagecount || page),
      total: Number(data.total || 0),
      list: Array.isArray(data.list) ? data.list.map(mapVodItem) : [],
    };
  } catch (error) {
    logError("获取分类失败", error);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = Number(params.page || 1);
    if (!keyword) {
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }

    const data = await requestApi({ ac: "list", wd: keyword, pg: page });
    return {
      page: Number(data.page || page),
      pagecount: Number(data.pagecount || page),
      total: Number(data.total || 0),
      list: Array.isArray(data.list) ? data.list.map(mapVodItem) : [],
    };
  } catch (error) {
    logError("搜索失败", error);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = params.videoId || params.vodId || "";
    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    const data = await requestApi({ ac: "detail", ids: videoId });
    const item = Array.isArray(data.list) ? data.list[0] : null;
    if (!item) {
      throw new Error("详情为空");
    }

    const playSources = parsePlaySources(item.vod_play_from, item.vod_play_url);

    return {
      list: [{
        vod_id: String(item.vod_id || videoId),
        vod_name: item.vod_name || "未命名",
        vod_pic: normalizePic(item.vod_pic),
        vod_content: item.vod_content || "",
        vod_remarks: item.vod_remarks || item.type_name || "",
        vod_year: item.vod_year || "",
        vod_area: item.vod_area || "",
        vod_actor: item.vod_actor || "",
        vod_director: item.vod_director || "",
        vod_play_sources: playSources.length > 0 ? playSources : undefined,
      }],
    };
  } catch (error) {
    logError("获取详情失败", error);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = params.playId || "";
    const flag = params.flag || "播放";
    if (!playId) {
      throw new Error("playId 不能为空");
    }

    return {
      parse: 0,
      urls: [{ name: flag || "播放", url: playId }],
      header: {},
    };
  } catch (error) {
    logError("获取播放失败", error);
    return { parse: 0, urls: [], header: {} };
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
