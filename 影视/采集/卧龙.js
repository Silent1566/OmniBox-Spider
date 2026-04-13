// @name 卧龙
// @author lampon
// @description 
// @version 1.0.0
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/卧龙.js

/**
 * OmniBox 采集站直接爬虫脚本
 *
 * 此脚本直接调用采集站接口获取数据，参考 OmniBox 后端实现逻辑
 * 只需要配置采集站的 API 地址即可使用
 *
 * 配置说明：
 * 1. 在 OmniBox 后台添加采集站，获取采集站的 API 地址
 * 2. 将 API 地址配置到环境变量 SITE_API 中，或直接修改下面的 SITE_API 常量
 * 3. （可选）配置弹幕 API 地址到环境变量 DANMU_API 中，或直接修改下面的 DANMU_API 常量
 *    弹幕 API 地址示例：https://danmu.example.com
 *
 * 采集站接口规范（参考 OmniBox 后端实现）：
 * - 首页：GET {API}?ac=list&pg={page}
 * - 分类：GET {API}?ac=class
 * - 分类列表：GET {API}?ac=videolist&t={typeId}&pg={page}
 * - 搜索：GET {API}?ac=list&wd={keyword}&pg={page}
 * - 详情：GET {API}?ac=detail&ids={videoId}
 *
 * 响应格式：
 * {
 *   "page": 1,
 *   "pagecount": 10,
 *   "total": 100,
 *   "list": [...],
 *   "class": [...]
 * }
 *
 * 使用方法：
 * 1. 在 OmniBox 后台创建爬虫源，选择 JavaScript 类型
 * 2. 复制此脚本内容到爬虫源编辑器
 * 3. 配置环境变量 SITE_API 为采集站的 API 地址
 * 4. 保存并测试
 */

const OmniBox = require("omnibox_sdk");

// ==================== 配置区域 ====================
// 采集站 API 地址（优先使用环境变量，如果没有则使用默认值）
// 例如：https://example.com/api.php/provide/vod/
const SITE_API =
  process.env.SITE_API || "https://collect.wolongzyw.com/api.php/provide/vod/";

// 弹幕 API 地址（优先使用环境变量，如果没有则使用默认值）
// 例如：https://danmu.example.com
// 如果为空，则不启用弹幕功能
const DANMU_API = process.env.DANMU_API || "";

// ==================== 配置区域结束 ====================

/**
 * 发送 HTTP 请求到采集站
 * @param {Object} params - 查询参数对象
 * @returns {Promise<Object>} API 响应数据
 */
async function requestSiteAPI(params = {}) {
  if (!SITE_API) {
    throw new Error("请配置采集站 API 地址（SITE_API 环境变量）");
  }

  // 构建 URL
  const url = new URL(SITE_API);
  Object.keys(params).forEach((key) => {
    if (
      params[key] !== undefined &&
      params[key] !== null &&
      params[key] !== ""
    ) {
      url.searchParams.append(key, params[key]);
    }
  });

  OmniBox.log("info", `请求采集站: ${url.toString()}`);

  try {
    const response = await OmniBox.request(url.toString(), {
      method: "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
    }

    const data = JSON.parse(response.body);
    return data;
  } catch (error) {
    OmniBox.log("error", `请求采集站失败: ${error.message}`);
    throw error;
  }
}

/**
 * 安全转换为整数
 * @param {*} value - 要转换的值
 * @returns {number} 整数
 */
function toInt(value) {
  if (typeof value === "number") {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const num = parseInt(value, 10);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}

/**
 * 格式化视频数据
 * @param {Array} list - 原始视频列表
 * @returns {Array} 格式化后的视频列表
 */
function formatVideos(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const vodId = String(item.vod_id || item.VodID || "");
      let vodPlayFrom = String(item.vod_play_from || item.VodPlayFrom || "");

      // 处理多线路播放源：如果包含 $$$ 分割符，将每个线路名称与 vod_id 用 - 连接
      // 例如：vod_play_from = "rym3u8$$$ruyi", vod_id = "68368"
      // 结果：vod_play_from = "rym3u8-68368$$$ruyi-68368"
      if (vodPlayFrom && vodId && vodPlayFrom.includes("$$$")) {
        const lines = vodPlayFrom.split("$$$");
        const processedLines = lines
          .map((line) => {
            const trimmedLine = line.trim();
            if (trimmedLine) {
              // 如果线路名称已经包含 - 和数字（可能是之前处理过的），先提取原始线路名
              // 否则直接拼接
              return `${trimmedLine}-${vodId}`;
            }
            return trimmedLine;
          })
          .filter((line) => line); // 过滤空字符串
        vodPlayFrom = processedLines.join("$$$");
      } else if (vodPlayFrom && vodId) {
        // 单线路，也添加 -vod_id
        vodPlayFrom = `${vodPlayFrom}-${vodId}`;
      }

      return {
        vod_id: vodId,
        vod_name: String(item.vod_name || item.VodName || ""),
        vod_pic: String(item.vod_pic || item.VodPic || ""),
        type_id: String(item.type_id || item.TypeID || ""),
        type_name: String(item.type_name || item.TypeName || ""),
        vod_year: String(item.vod_year || item.VodYear || ""),
        vod_remarks: String(item.vod_remarks || item.VodRemarks || ""),
        vod_time: String(item.vod_time || item.VodTime || ""),
        vod_play_from: vodPlayFrom,
        vod_play_url: String(item.vod_play_url || item.VodPlayURL || ""),
        vod_douban_score: String(
          item.vod_douban_score || item.VodDoubanScore || "",
        ),
      };
    })
    .filter((item) => item !== null && item.vod_id);
}

/**
 * 将旧格式的播放源转换为新格式（vod_play_sources）
 * @param {string} vodPlayFrom - 旧格式的播放源名称（用 $$$ 分隔）
 * @param {string} vodPlayUrl - 旧格式的播放URL（用 $$$ 分隔不同线路，用 # 分隔同一线路的不同集数，用 $ 分隔集数名称和地址）
 * @param {string} vodId - 视频ID（用于处理线路名称中的 -vodId 后缀）
 * @returns {Array} 新格式的播放源列表
 */
function convertToPlaySources(vodPlayFrom, vodPlayUrl, vodId) {
  const playSources = [];

  if (!vodPlayFrom || !vodPlayUrl) {
    return playSources;
  }

  // 分割不同线路
  const sourceNames = vodPlayFrom
    .split("$$$")
    .map((name) => name.trim())
    .filter((name) => name);
  const sourceUrls = vodPlayUrl
    .split("$$$")
    .map((url) => url.trim())
    .filter((url) => url);

  // 确保线路名称和URL数量一致
  const maxLength = Math.max(sourceNames.length, sourceUrls.length);

  for (let i = 0; i < maxLength; i++) {
    const sourceName = sourceNames[i] || `线路${i + 1}`;
    const sourceUrl = sourceUrls[i] || "";

    // 处理线路名称：移除 -vodId 后缀（如果存在）
    let cleanSourceName = sourceName;
    if (vodId && sourceName.endsWith(`-${vodId}`)) {
      cleanSourceName = sourceName.substring(
        0,
        sourceName.length - `-${vodId}`.length,
      );
    }

    // 解析该线路的剧集列表
    const episodes = [];
    if (sourceUrl) {
      // 用 # 分隔不同集数
      const episodeSegments = sourceUrl
        .split("#")
        .map((seg) => seg.trim())
        .filter((seg) => seg);

      for (const segment of episodeSegments) {
        // 用 $ 分隔集数名称和播放地址
        const parts = segment.split("$");
        if (parts.length >= 2) {
          const episodeName = parts[0].trim();
          const playId = parts.slice(1).join("$").trim(); // 支持播放地址中包含 $ 的情况

          if (episodeName && playId) {
            episodes.push({
              name: episodeName,
              playId: playId,
            });
          }
        } else if (parts.length === 1 && parts[0]) {
          // 如果没有 $ 分隔符，整个字符串作为播放地址，使用默认名称
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

/**
 * 格式化详情视频数据
 * @param {Array} list - 原始视频列表
 * @returns {Array} 格式化后的详情视频列表
 */
function formatDetailVideos(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return null;
      }

      const content = String(item.vod_content || item.VodContent || "").trim();
      const vodId = String(item.vod_id || item.VodID || "");
      let vodPlayFrom = String(item.vod_play_from || item.VodPlayFrom || "");

      // 处理多线路播放源：如果包含 $$$ 分割符，将每个线路名称与 vod_id 用 - 连接
      // 例如：vod_play_from = "rym3u8$$$ruyi", vod_id = "68368"
      // 结果：vod_play_from = "rym3u8-68368$$$ruyi-68368"
      if (vodPlayFrom && vodId && vodPlayFrom.includes("$$$")) {
        const lines = vodPlayFrom.split("$$$");
        const processedLines = lines
          .map((line) => {
            const trimmedLine = line.trim();
            if (trimmedLine) {
              // 如果线路名称已经包含 - 和数字（可能是之前处理过的），先提取原始线路名
              // 否则直接拼接
              return `${trimmedLine}-${vodId}`;
            }
            return trimmedLine;
          })
          .filter((line) => line); // 过滤空字符串
        vodPlayFrom = processedLines.join("$$$");
      } else if (vodPlayFrom && vodId) {
        // 单线路，也添加 -vod_id
        vodPlayFrom = `${vodPlayFrom}-${vodId}`;
      }

      const vodPlayUrl = String(item.vod_play_url || item.VodPlayURL || "");

      // 转换为新格式的播放源
      const vodPlaySources = convertToPlaySources(
        vodPlayFrom,
        vodPlayUrl,
        vodId,
      );

      return {
        vod_id: vodId,
        vod_name: String(item.vod_name || item.VodName || ""),
        vod_pic: String(item.vod_pic || item.VodPic || ""),
        type_name: String(item.type_name || item.TypeName || ""),
        vod_year: String(item.vod_year || item.VodYear || ""),
        vod_area: String(item.vod_area || item.VodArea || ""),
        vod_remarks: String(item.vod_remarks || item.VodRemarks || ""),
        vod_actor: String(item.vod_actor || item.VodActor || ""),
        vod_director: String(item.vod_director || item.VodDirector || ""),
        vod_content: content,
        vod_play_sources:
          vodPlaySources.length > 0 ? vodPlaySources : undefined,
        vod_douban_score: String(
          item.vod_douban_score || item.VodDoubanScore || "",
        ),
      };
    })
    .filter((item) => item !== null && item.vod_id);
}

/**
 * 格式化分类数据
 * @param {Array} classes - 原始分类列表
 * @returns {Array} 格式化后的分类列表
 */
function formatClasses(classes) {
  if (!Array.isArray(classes)) {
    return [];
  }

  const seen = new Set();
  const result = [];

  for (const cls of classes) {
    if (typeof cls !== "object" || cls === null) {
      continue;
    }

    const typeId = String(cls.type_id || cls.TypeID || "");
    const typePid = String(cls.type_pid || cls.TypePID || "");
    const typeName = String(cls.type_name || cls.TypeName || "").trim();

    // 去重
    if (!typeId || seen.has(typeId)) {
      continue;
    }
    seen.add(typeId);

    result.push({
      type_id: typeId,
      type_pid: typePid,
      type_name: typeName,
    });
  }

  return result;
}

/**
 * 批量获取视频详情来丰富视频数据
 * @param {Array} videos - 视频列表
 * @returns {Promise<Array>} 丰富后的视频列表
 */
async function enrichVideosWithDetails(videos) {
  if (!Array.isArray(videos) || videos.length === 0) {
    return videos;
  }

  // 收集需要获取详情的视频ID
  const videoIDs = [];
  const videoMap = new Map();

  for (const video of videos) {
    // 检查是否缺少关键信息（图片、年份、评分等）
    if (
      !video.vod_pic ||
      video.vod_pic === "<nil>" ||
      !video.vod_year ||
      video.vod_year === "<nil>" ||
      !video.vod_douban_score ||
      video.vod_douban_score === "<nil>"
    ) {
      videoIDs.push(video.vod_id);
      videoMap.set(video.vod_id, video);
    }
  }

  if (videoIDs.length === 0) {
    return videos;
  }

  // 批量获取详情，每次最多处理20个
  const batchSize = 20;
  for (let i = 0; i < videoIDs.length; i += batchSize) {
    const end = Math.min(i + batchSize, videoIDs.length);
    const batchIDs = videoIDs.slice(i, end);

    try {
      // 调用详情接口
      const response = await requestSiteAPI({
        ac: "detail",
        ids: batchIDs.join(","),
      });

      // 处理详情数据
      if (Array.isArray(response.list)) {
        for (const item of response.list) {
          if (typeof item !== "object" || item === null) {
            continue;
          }

          const vodId = String(item.vod_id || item.VodID || "");
          const originalVod = videoMap.get(vodId);

          if (originalVod) {
            // 更新原始视频信息
            const pic = String(item.vod_pic || item.VodPic || "");
            if (pic && pic !== "<nil>") {
              originalVod.vod_pic = pic;
            }

            const year = String(item.vod_year || item.VodYear || "");
            if (year && year !== "<nil>") {
              originalVod.vod_year = year;
            }

            const score = String(
              item.vod_douban_score || item.VodDoubanScore || "",
            );
            if (score && score !== "<nil>") {
              originalVod.vod_douban_score = score;
            }

            // 更新其他可能缺失的字段
            const en = String(item.vod_en || item.VodEn || "");
            if (en && en !== "<nil>") {
              originalVod.vod_en = en;
            }

            const time = String(item.vod_time || item.VodTime || "");
            if (time && time !== "<nil>") {
              originalVod.vod_time = time;
            }

            const playFrom = String(
              item.vod_play_from || item.VodPlayFrom || "",
            );
            if (playFrom && playFrom !== "<nil>") {
              originalVod.vod_play_from = playFrom;
            }
          }
        }
      }
    } catch (error) {
      OmniBox.log("warn", `批量获取详情失败: ${error.message}`);
      // 继续处理下一批
    }
  }

  return videos;
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

/**
 * 获取首页数据
 * @param {Object} params - 参数对象
 * @returns {Object} 返回分类列表和推荐视频列表
 */
async function home(params) {
  try {
    OmniBox.log("info", "获取首页数据");

    const page = params.page || "1";

    // 首先尝试获取首页数据（包含分类和视频列表）
    let response = await requestSiteAPI({
      ac: "list",
      pg: page,
    });

    // 如果没有分类数据，尝试单独获取分类
    if (
      !response.class ||
      (Array.isArray(response.class) && response.class.length === 0)
    ) {
      try {
        const classResponse = await requestSiteAPI({ ac: "class" });
        if (classResponse.class) {
          response.class = classResponse.class;
        }
      } catch (error) {
        OmniBox.log("warn", `获取分类失败: ${error.message}`);
      }
    }

    // 格式化分类数据
    const classes = formatClasses(response.class || []);

    // 格式化视频列表
    let videos = formatVideos(response.list || []);

    // 丰富视频数据 - 批量获取详情信息
    videos = await enrichVideosWithDetails(videos);

    return {
      class: classes,
      list: videos,
    };
  } catch (error) {
    OmniBox.log("error", `获取首页数据失败: ${error.message}`);
    return {
      class: [],
      list: [],
    };
  }
}

/**
 * 获取分类数据
 * @param {Object} params - 参数对象
 *   - categoryId: 分类ID（必填）
 *   - page: 页码（必填，默认1）
 * @returns {Object} 返回视频列表
 */
async function category(params) {
  try {
    const categoryId = params.categoryId;
    const page = params.page || 1;

    if (!categoryId) {
      throw new Error("分类ID不能为空");
    }

    OmniBox.log("info", `获取分类数据: categoryId=${categoryId}, page=${page}`);

    const response = await requestSiteAPI({
      ac: "videolist",
      t: categoryId,
      pg: String(page),
    });

    // 格式化视频列表
    const videos = formatVideos(response.list || []);

    return {
      page: toInt(response.page),
      pagecount: toInt(response.pagecount),
      total: toInt(response.total),
      list: videos,
    };
  } catch (error) {
    OmniBox.log("error", `获取分类数据失败: ${error.message}`);
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }
}

/**
 * 获取视频详情
 * @param {Object} params - 参数对象
 *   - videoId: 视频ID（必填）
 * @returns {Object} 返回视频详情
 */
async function detail(params) {
  try {
    const videoId = params.videoId;

    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    OmniBox.log("info", `获取视频详情: videoId=${videoId}`);

    const response = await requestSiteAPI({
      ac: "detail",
      ids: videoId,
    });

    // 格式化视频详情列表
    const videos = formatDetailVideos(response.list || []);

    return {
      list: videos,
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
 * @param {Object} params - 参数对象
 *   - keyword: 搜索关键词（必填）
 *   - page: 页码（可选，默认1）
 * @returns {Object} 返回搜索结果
 */
async function search(params) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = params.page || 1;

    if (!keyword) {
      return {
        page: 1,
        pagecount: 0,
        total: 0,
        list: [],
      };
    }

    OmniBox.log("info", `搜索视频: keyword=${keyword}, page=${page}`);

    const response = await requestSiteAPI({
      ac: "list",
      wd: keyword,
      pg: String(page),
    });

    // 格式化搜索结果列表
    let videos = formatVideos(response.list || []);

    // 如果列表有数据但没有图片，尝试获取详情
    if (videos.length > 0 && (!videos[0].vod_pic || videos[0].vod_pic === "")) {
      try {
        const videoIDs = videos.map((v) => v.vod_id);
        const detailResponse = await requestSiteAPI({
          ac: "detail",
          ids: videoIDs.join(","),
        });
        videos = formatVideos(detailResponse.list || []);
      } catch (error) {
        OmniBox.log("warn", `获取搜索结果详情失败: ${error.message}`);
      }
    }

    return {
      page: toInt(response.page),
      pagecount: toInt(response.pagecount),
      total: toInt(response.total),
      list: videos,
    };
  } catch (error) {
    OmniBox.log("error", `搜索视频失败: ${error.message}`);
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: [],
    };
  }
}

/**
 * 匹配弹幕
 * @param {string} fileName - 文件名（用于弹幕匹配）
 * @returns {Promise<Array>} 返回弹幕列表
 */
async function matchDanmu(fileName) {
  if (!DANMU_API || !fileName) {
    return [];
  }

  try {
    OmniBox.log("info", `匹配弹幕: fileName=${fileName}`);

    const matchUrl = `${DANMU_API}/api/v2/match`;
    const response = await OmniBox.request(matchUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      body: JSON.stringify({ fileName: fileName }),
    });

    if (response.statusCode !== 200) {
      OmniBox.log("warn", `弹幕匹配失败: HTTP ${response.statusCode}`);
      return [];
    }

    const matchData = JSON.parse(response.body);

    // 检查是否匹配成功
    if (!matchData.isMatched) {
      OmniBox.log("info", "弹幕未匹配到");
      return [];
    }

    // 获取matches数组
    const matches = matchData.matches || [];
    if (matches.length === 0) {
      return [];
    }

    // 取第一个匹配项
    const firstMatch = matches[0];
    const episodeId = firstMatch.episodeId;
    const animeTitle = firstMatch.animeTitle || "";
    const episodeTitle = firstMatch.episodeTitle || "";

    if (!episodeId) {
      return [];
    }

    // 构建弹幕名称
    let danmakuName = "弹幕";
    if (animeTitle && episodeTitle) {
      danmakuName = `${animeTitle} - ${episodeTitle}`;
    } else if (animeTitle) {
      danmakuName = animeTitle;
    } else if (episodeTitle) {
      danmakuName = episodeTitle;
    }

    // 构建弹幕URL
    const danmakuURL = `${DANMU_API}/api/v2/comment/${episodeId}?format=xml`;

    OmniBox.log(
      "info",
      `弹幕匹配成功: ${danmakuName} (episodeId: ${episodeId})`,
    );

    return [
      {
        name: danmakuName,
        url: danmakuURL,
      },
    ];
  } catch (error) {
    OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
    return [];
  }
}

/**
 * 根据播放URL推断文件名（用于弹幕匹配）
 * @param {string} url - 播放URL
 * @returns {string} 文件名
 */
function inferFileNameFromURL(url) {
  try {
    const urlObj = new URL(url);
    let base = urlObj.pathname.split("/").pop() || "";

    // 去掉扩展名
    const dotIndex = base.lastIndexOf(".");
    if (dotIndex > 0) {
      base = base.substring(0, dotIndex);
    }

    // 清理分隔符
    base = base.replace(/[_-]/g, " ").replace(/\./g, " ").trim();

    return base || url;
  } catch (error) {
    return url;
  }
}

/**
 * 从字符串中提取数字
 * @param {string} str - 字符串
 * @returns {string} 数字字符串
 */
function extractDigits(str) {
  if (typeof str !== "string") {
    return "";
  }
  return str.replace(/\D/g, "");
}

/**
 * 从flag中解析视频ID
 * flag格式可能是：
 * 1. "rym3u8-68368" -> 返回 "68368"
 * 2. "68368" -> 返回 "68368"
 * @param {string} flag - 播放源标识
 * @returns {string} 视频ID
 */
function extractVideoIdFromFlag(flag) {
  if (!flag) {
    return "";
  }

  // 如果包含 -，尝试提取 - 后面的部分作为视频ID
  if (flag.includes("-")) {
    const parts = flag.split("-");
    // 取最后一部分作为视频ID（支持多级分割）
    const videoId = parts[parts.length - 1];
    // 验证是否是数字（视频ID通常是数字）
    if (/^\d+$/.test(videoId)) {
      return videoId;
    }
  }

  // 如果不包含 - 或者是纯数字，直接返回
  if (/^\d+$/.test(flag)) {
    return flag;
  }

  // 如果都不匹配，返回空字符串
  return "";
}

/**
 * 获取播放地址
 * @param {Object} params - 参数对象
 *   - playId: 播放地址ID（必填）
 *   - flag: 播放源标识（格式：线路名-视频ID，例如：rym3u8-68368）
 * @returns {Object} 返回播放地址信息和弹幕列表
 */
async function play(params) {
  try {
    const playId = params.playId;
    const flag = params.flag || "";

    if (!playId) {
      throw new Error("播放地址ID不能为空");
    }

    // 从flag中解析视频ID
    // flag格式：rym3u8-68368 或 68368
    const videoId = extractVideoIdFromFlag(flag);

    OmniBox.log(
      "info",
      `获取播放地址: playId=${playId}, flag=${flag}, videoId=${videoId}`,
    );

    // 构建播放地址响应
    // 统一使用数组格式，每个元素包含 name 和 url，类似 danmaku 格式
    let urlsResult = [
      {
        name: "播放",
        url: playId,
      },
    ];

    let parse = 1; // 默认需要解析
    // 如果是直接的 m3u8 或 mp4 链接，不需要解析
    if (/\.(m3u8|mp4)$/.test(playId)) {
      parse = 0;
    }

    let playResponse = {
      urls: urlsResult,
      flag: flag,
      header: {},
      parse: parse,
    };

    // 弹幕匹配（如果配置了弹幕API）
    if (DANMU_API && videoId) {
      let fileName = "";

      try {
        // 使用视频ID获取详情
        const detailResponse = await requestSiteAPI({
          ac: "detail",
          ids: videoId,
        });

        if (detailResponse.list && detailResponse.list.length > 0) {
          const video = detailResponse.list[0];
          const videoName = video.vod_name || video.VodName || "";
          const playURL = video.vod_play_url || video.VodPlayURL || "";

          if (videoName && playURL) {
            // 解析播放URL，查找当前播放地址对应的集数
            // 播放URL格式：HD中字$https://...$$$HD中字$https://...
            // 或者：HD中字$https://...#HD中字$https://...
            const segments = playURL.split("#").filter((s) => s.trim());

            // 如果只有一集，视为电影，直接用片名匹配
            if (segments.length === 1) {
              fileName = videoName;
            } else {
              // 多集剧集，查找当前播放地址对应的集数
              let epNum = 0;
              for (let idx = 0; idx < segments.length; idx++) {
                const seg = segments[idx];
                const parts = seg.split("$");
                if (parts.length >= 2) {
                  const epLabel = parts[0].trim();
                  const epURL = parts[1].trim();

                  // 匹配当前播放地址
                  if (
                    epURL === playId ||
                    epURL.includes(playId) ||
                    playId.includes(epURL)
                  ) {
                    // 尝试从标签中提取集数
                    const digits = extractDigits(epLabel);
                    if (digits) {
                      epNum = parseInt(digits, 10);
                    } else {
                      epNum = idx + 1;
                    }
                    break;
                  }
                }
              }

              if (epNum > 0) {
                // 构建文件名：视频名 S01E01
                if (epNum < 10) {
                  fileName = `${videoName} S01E0${epNum}`;
                } else {
                  fileName = `${videoName} S01E${epNum}`;
                }
              } else {
                // 如果无法匹配集数，使用视频名称（可能是电影）
                fileName = videoName;
              }
            }
          }
        }
      } catch (error) {
        OmniBox.log("warn", `获取详情失败，无法推断集数: ${error.message}`);
      }

      // 如果无法从详情获取文件名，尝试从URL推断
      if (!fileName) {
        fileName = inferFileNameFromURL(playId);
      }

      // 匹配弹幕
      if (fileName) {
        const danmakuList = await matchDanmu(fileName);
        if (danmakuList.length > 0) {
          playResponse.danmaku = danmakuList;
        }
      }
    }

    return playResponse;
  } catch (error) {
    OmniBox.log("error", `获取播放地址失败: ${error.message}`);
    return {
      urls: [],
      flag: params.flag || "",
      header: {},
    };
  }
}
