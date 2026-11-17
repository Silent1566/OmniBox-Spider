// @name 拦截器模板
// @author OmniBox
// @description 通用拦截器模板，覆盖所有生命周期阶段（home/category/search/detail/play 的 before 与 after），含完整注释和日志示例
// @version 1.0.1
// @filter-stages home_before,home_after,category_before,category_after,search_before,search_after,detail_before,detail_after,play_before,play_after
// @filter-config-schema {"description":"通用拦截器模板，演示如何在各个生命周期阶段拦截并处理数据","fields":[{"key":"enabled","label":"启用拦截器","type":"boolean","required":false,"placeholder":"全局开关，默认启用"},{"key":"logLevel","label":"日志级别","type":"select","required":false,"placeholder":"日志输出级别","options":[{"label":"debug","value":"debug"},{"label":"info","value":"info"},{"label":"warn","value":"warn"},{"label":"error","value":"error"}]},{"key":"customParam","label":"自定义参数","type":"string","required":false,"placeholder":"可在拦截器中使用的自定义配置项"}]}

/**
 * ====================================================================
 * OmniBox 拦截器模板 (JavaScript)
 * ====================================================================
 *
 * 【拦截器概述】
 * 拦截器是 OmniBox 爬虫框架的核心扩展机制，允许在爬虫的生命周期各阶段
 * 注入自定义逻辑。与爬虫脚本（如采集站模板、推送脚本）不同，拦截器
 * 不独立提供数据，而是"拦截"已有爬虫的数据流，对其进行增强、修改或补充。
 *
 * 【生命周期阶段 (filter-stages)】
 * 每个爬虫接口都提供 before 和 after 两个拦截点：
 *   - home_before     : 首页接口调用前，可修改请求参数
 *   - home_after      : 首页接口调用后，可修改返回数据（分类列表、推荐列表等）
 *   - category_before : 分类接口调用前，可修改分类查询参数
 *   - category_after  : 分类接口调用后，可修改分类视频列表
 *   - search_before   : 搜索接口调用前，可修改搜索关键词等参数
 *   - search_after    : 搜索接口调用后，可修改搜索结果
 *   - detail_before   : 详情接口调用前，可修改详情查询参数（如 videoId 规范化）
 *   - detail_after    : 详情接口调用后，可修改详情数据（如 TMDB 刮削回填）
 *   - play_before     : 播放接口调用前，可修改播放请求参数
 *   - play_after      : 播放接口调用后，可修改播放返回数据（如注入弹幕、记录历史）
 *
 * 【拦截器参数结构】
 * 所有 before 钩子接收 params 对象：
 *   {
 *     params: { ... },    // 当前接口的请求参数，可修改后返回
 *     extend: { ... },    // @filter-config-schema 中定义的用户配置项
 *     context: { ... },   // 运行时上下文（如 sourceId、baseURL 等）
 *   }
 *   返回值：修改后的 params（即请求参数对象）
 *
 * 所有 after 钩子接收 params 对象：
 *   {
 *     data: { ... },      // 当前接口的返回数据，可修改后返回
 *     extend: { ... },    // @filter-config-schema 中定义的用户配置项
 *     context: { ... },   // 运行时上下文
 *     params: { ... },    // 原始请求参数（只读参考，after 阶段修改无效）
 *   }
 *   返回值：修改后的 data（即返回数据对象）
 *
 * 【头部元数据说明】
 *   @name               : 拦截器名称，显示在 OmniBox 管理界面
 *   @author             : 作者
 *   @description        : 描述，说明拦截器功能
 *   @version            : 版本号
 *   @filter-stages      : 声明拦截器参与的生命周期阶段（逗号分隔）
 *                         框架根据此声明决定调用哪些钩子函数
 *   @filter-config-schema : 用户可配置的参数（JSON Schema 格式）
 *                           fields 数组中每个字段包含：
 *                             key        - 配置项键名
 *                             label      - 显示名称
 *                             type       - 类型：boolean / string / select / number
 *                             required   - 是否必填
 *                             placeholder - 提示文字
 *                             options    - select 类型的可选项
 *                           配置值通过 params.extend 传入拦截器
 *
 * 【常用 SDK API (omnibox_sdk)】
 *   OmniBox.log(level, message)             - 输出日志 (level: debug/info/warn/error)
 *   OmniBox.request(url, options)           - 发送 HTTP 请求
 *   OmniBox.getScrapeMetadata(videoId)      - 获取 TMDB 刮削元数据
 *   OmniBox.processScraping(videoId, ...)   - 触发 TMDB 刮削
 *   OmniBox.addPlayHistory(record)          - 添加播放历史记录
 *   OmniBox.updateFavoriteEpisode(...)      - 更新追剧集数
 *   OmniBox.getDanmakuByFileName(fileName)  - 根据文件名匹配弹幕
 *   OmniBox.getDriveInfoByShareURL(url)     - 获取网盘信息
 *   OmniBox.getDriveFileList(url, fid)      - 获取网盘文件列表
 *   OmniBox.getDriveVideoPlayInfo(...)      - 获取网盘视频播放信息
 *
 * 【日志规范】
 *   - debug : 详细的调试信息，如参数解析过程、中间变量值
 *   - info  : 正常业务流程关键节点，如"开始刮削"、"匹配成功"、"已注入N条弹幕"
 *   - warn  : 非致命异常或可恢复的降级，如"缓存读取失败"、"未命中映射，使用兜底逻辑"
 *   - error: 致命错误，如"HTTP 请求失败"、"JSON 解析失败"
 *   建议统一格式："拦截器名: 动作描述 key=value"  例如："弹幕拦截器: 匹配成功 count=5"
 *
 * ====================================================================
 */

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");

/**
 * 导出拦截器钩子函数
 *
 * 只有在 @filter-stages 中声明的阶段对应的钩子才会被框架调用。
 * 不需要的钩子可以直接删除，同时从 @filter-stages 中移除对应阶段。
 *
 * 钩子命名规则：
 *   before + 阶段名（首字母大写） => beforeHome, beforeCategory, beforeSearch, beforeDetail, beforePlay
 *   after  + 阶段名（首字母大写） => afterHome, afterCategory, afterSearch, afterDetail, afterPlay
 */
module.exports = {
  beforeHome,
  afterHome,
  beforeCategory,
  afterCategory,
  beforeSearch,
  afterSearch,
  beforeDetail,
  afterDetail,
  beforePlay,
  afterPlay,
};

runner.run(module.exports);

// ==================== 工具函数 ====================

/**
 * 获取拦截器名称（用于日志前缀）
 * 日志中统一使用拦截器名前缀，方便在大量日志中快速定位
 */
const INTERCEPTOR_NAME = "拦截器模板";

/**
 * 判断拦截器是否启用
 * @param {Object} extend - 用户配置项（来自 @filter-config-schema）
 * @returns {boolean} 是否启用
 */
function isEnabled(extend = {}) {
  return extend.enabled !== false;
}

/**
 * 获取日志级别
 * @param {Object} extend - 用户配置项
 * @returns {string} 日志级别
 */
function getLogLevel(extend = {}) {
  return extend.logLevel || "info";
}

/**
 * 判断是否应该输出指定级别的日志
 * @param {string} level - 待输出的日志级别
 * @param {string} configuredLevel - 配置的日志级别
 * @returns {boolean} 是否输出
 */
function shouldLog(level, configuredLevel) {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  return (levels[level] || 1) >= (levels[configuredLevel] || 1);
}

/**
 * 统一日志输出函数
 * 根据配置的日志级别决定是否输出，未配置时默认输出 info 及以上级别
 * @param {string} level - 日志级别 (debug/info/warn/error)
 * @param {string} message - 日志消息
 * @param {Object} extend - 用户配置项
 */
async function log(level, message, extend = {}) {
  if (shouldLog(level, getLogLevel(extend))) {
    await OmniBox.log(level, `${INTERCEPTOR_NAME}: ${message}`);
  }
}

// ==================== Home 阶段 ====================

/**
 * 首页接口 - 前置拦截
 *
 * 触发时机：home(params) 被框架调用之前
 * 用途：修改首页请求参数，如强制指定页码、添加默认筛选条件等
 *
 * @param {Object} params - 拦截器参数
 *   params.params  - 原始请求参数 { page, ... }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 * @returns {Object} 修改后的请求参数（返回 params.params 的修改副本）
 */
async function beforeHome(params) {
  const next = Object.assign({}, params?.params || {});
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return next;

  await log("debug", `beforeHome 入参 page=${next.page}`, extend);

  // TODO: 在此添加首页前置处理逻辑
  // 示例：强制首页从第1页开始
  // if (next.page && Number(next.page) < 1) {
  //   next.page = "1";
  //   await log("info", `纠正页码 page=${next.page}`, extend);
  // }

  await log("debug", `beforeHome 出参 page=${next.page}`, extend);
  return next;
}

/**
 * 首页接口 - 后置拦截
 *
 * 触发时机：home(params) 返回数据之后
 * 用途：修改首页返回数据，如补充分类、过滤推荐列表、添加 Banner 等
 *
 * @param {Object} params - 拦截器参数
 *   params.data    - 原始返回数据 { class: [], list: [], filters: {}, banner: [] }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 *   params.params  - 原始请求参数（只读）
 * @returns {Object} 修改后的返回数据
 */
async function afterHome(params) {
  const data = params?.data || {};
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return data;

  await log("debug", `afterHome 分类数=${(data.class || []).length} 列表数=${(data.list || []).length}`, extend);

  // TODO: 在此添加首页后置处理逻辑
  // 示例：过滤掉没有图片的视频
  // if (Array.isArray(data.list)) {
  //   const before = data.list.length;
  //   data.list = data.list.filter(item => item.vod_pic);
  //   await log("info", `过滤无图视频 before=${before} after=${data.list.length}`, extend);
  // }

  return data;
}

// ==================== Category 阶段 ====================

/**
 * 分类接口 - 前置拦截
 *
 * 触发时机：category(params) 被框架调用之前
 * 用途：修改分类查询参数，如纠正 categoryId、添加默认筛选条件
 *
 * @param {Object} params - 拦截器参数
 *   params.params  - 原始请求参数 { categoryId, page, filters, ... }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 * @returns {Object} 修改后的请求参数
 */
async function beforeCategory(params) {
  const next = Object.assign({}, params?.params || {});
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return next;

  await log("debug", `beforeCategory 入参 categoryId=${next.categoryId} page=${next.page}`, extend);

  // TODO: 在此添加分类前置处理逻辑

  return next;
}

/**
 * 分类接口 - 后置拦截
 *
 * 触发时机：category(params) 返回数据之后
 * 用途：修改分类返回数据，如排序、过滤、补充视频信息
 *
 * @param {Object} params - 拦截器参数
 *   params.data    - 原始返回数据 { page, pagecount, total, list: [] }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 *   params.params  - 原始请求参数（只读）
 * @returns {Object} 修改后的返回数据
 */
async function afterCategory(params) {
  const data = params?.data || {};
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return data;

  await log("debug", `afterCategory 列表数=${(data.list || []).length} total=${data.total}`, extend);

  // TODO: 在此添加分类后置处理逻辑

  return data;
}

// ==================== Search 阶段 ====================

/**
 * 搜索接口 - 前置拦截
 *
 * 触发时机：search(params) 被框架调用之前
 * 用途：修改搜索参数，如关键词纠错、添加默认分页等
 *
 * @param {Object} params - 拦截器参数
 *   params.params  - 原始请求参数 { keyword, page, ... }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 * @returns {Object} 修改后的请求参数
 */
async function beforeSearch(params) {
  const next = Object.assign({}, params?.params || {});
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return next;

  await log("debug", `beforeSearch 入参 keyword=${next.keyword} page=${next.page}`, extend);

  // TODO: 在此添加搜索前置处理逻辑
  // 示例：去除关键词中的特殊字符
  // if (next.keyword) {
  //   const cleaned = next.keyword.replace(/[^\w\u4e00-\u9fff]/g, " ").trim();
  //   if (cleaned !== next.keyword) {
  //     await log("info", `关键词清理 before="${next.keyword}" after="${cleaned}"`, extend);
  //     next.keyword = cleaned;
  //   }
  // }

  return next;
}

/**
 * 搜索接口 - 后置拦截
 *
 * 触发时机：search(params) 返回数据之后
 * 用途：修改搜索结果，如去重、排序、补充评分信息
 *
 * @param {Object} params - 拦截器参数
 *   params.data    - 原始返回数据 { page, pagecount, total, list: [] }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 *   params.params  - 原始请求参数（只读）
 * @returns {Object} 修改后的返回数据
 */
async function afterSearch(params) {
  const data = params?.data || {};
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return data;

  await log("debug", `afterSearch 列表数=${(data.list || []).length}`, extend);

  // TODO: 在此添加搜索后置处理逻辑

  return data;
}

// ==================== Detail 阶段 ====================

/**
 * 详情接口 - 前置拦截
 *
 * 触发时机：detail(params) 被框架调用之前
 * 用途：规范化详情查询参数，如 videoId 去空格、URL 编码修正等
 *
 * 实际参考：刮削拦截器的 beforeDetail 会对 videoId 做规范化处理
 *
 * @param {Object} params - 拦截器参数
 *   params.params  - 原始请求参数 { videoId, source, ... }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 * @returns {Object} 修改后的请求参数
 */
async function beforeDetail(params) {
  const next = Object.assign({}, params?.params || {});
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return next;

  await log("debug", `beforeDetail 入参 videoId=${next.videoId}`, extend);

  // 示例：规范化 videoId（去除首尾空白）
  if (next.videoId !== undefined && next.videoId !== null) {
    const normalized = String(next.videoId).trim();
    if (normalized !== next.videoId) {
      next.videoId = normalized;
      await log("info", `规范化 videoId -> ${normalized}`, extend);
    }
  }

  // 示例：规范化 source 字段
  if (next.source !== undefined && next.source !== null) {
    next.source = String(next.source).trim();
  }

  // TODO: 在此添加更多详情前置处理逻辑

  return next;
}

/**
 * 详情接口 - 后置拦截
 *
 * 触发时机：detail(params) 返回数据之后
 * 用途：对详情结果进行增强处理，最常见的是触发 TMDB 刮削并回填元数据
 *
 * 实际参考：刮削拦截器的 afterDetail 会自动触发刮削并回填标题/封面/集名等
 *
 * @param {Object} params - 拦截器参数
 *   params.data    - 原始返回数据 { list: [{ vod_id, vod_name, vod_pic, vod_play_sources, ... }] }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 *   params.params  - 原始请求参数（只读）
 * @returns {Object} 修改后的返回数据
 */
async function afterDetail(params) {
  const data = params?.data || {};
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return data;

  if (!Array.isArray(data.list) || data.list.length === 0) {
    await log("debug", "afterDetail 列表为空，跳过处理", extend);
    return data;
  }

  await log("debug", `afterDetail 列表数=${data.list.length}`, extend);

  // TODO: 在此添加详情后置处理逻辑
  //
  // === 刮削增强示例（参考 刮削拦截器.js）===
  //
  // for (const item of data.list) {
  //   const videoId = String(item.vod_id || "");
  //   const vodName = String(item.vod_name || "");
  //   if (!videoId) continue;
  //
  //   try {
  //     // 检查是否已有刮削数据
  //     const existing = await OmniBox.getScrapeMetadata(videoId);
  //     if (existing?.scrapeData?.title) {
  //       await log("info", `命中缓存 videoId=${videoId}`, extend);
  //       // 应用刮削数据到 item...
  //     } else {
  //       // 触发刮削
  //       await log("info", `开始刮削 videoId=${videoId}`, extend);
  //       await OmniBox.processScraping(videoId, vodName, vodName, videoFiles);
  //     }
  //   } catch (error) {
  //     await log("warn", `刮削失败 videoId=${videoId} ${error.message}`, extend);
  //   }
  // }

  return data;
}

// ==================== Play 阶段 ====================

/**
 * 播放接口 - 前置拦截
 *
 * 触发时机：play(params) 被框架调用之前
 * 用途：修改播放请求参数，如根据 flag 调整播放策略、添加 Referer 等
 *
 * @param {Object} params - 拦截器参数
 *   params.params  - 原始请求参数 { playId, flag, vodId, ... }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 * @returns {Object} 修改后的请求参数
 */
async function beforePlay(params) {
  const next = Object.assign({}, params?.params || {});
  const extend = params?.extend || {};

  if (!isEnabled(extend)) return next;

  await log("debug", `beforePlay 入参 playId=${next.playId} flag=${next.flag}`, extend);

  // TODO: 在此添加播放前置处理逻辑
  // 示例：根据 flag 调整播放模式
  // if (next.flag === "直连") {
  //   next.flag = "";
  //   await log("info", "清除直连flag标记", extend);
  // }

  return next;
}

/**
 * 播放接口 - 后置拦截
 *
 * 触发时机：play(params) 返回数据之后
 * 用途：对播放结果进行增强，最常见的是注入弹幕数据或记录播放历史
 *
 * 实际参考：
 *   - 弹幕拦截器.js：根据刮削结果匹配并注入弹幕
 *   - 播放记录拦截器.js：自动记录观看历史并更新追剧进度
 *
 * @param {Object} params - 拦截器参数
 *   params.data    - 原始返回数据 { urls: [], flag, header, parse, danmaku: [] }
 *   params.extend  - 用户配置项
 *   params.context - 运行时上下文
 *   params.params  - 原始请求参数（只读）：{ playId, flag, vodId, ... }
 * @returns {Object} 修改后的返回数据
 */
async function afterPlay(params) {
  const data = params?.data || {};
  const extend = params?.extend || {};
  const requestParams = params?.params || {};

  if (!isEnabled(extend)) return data;

  await log("debug", `afterPlay urls数量=${(data.urls || []).length} danmaku数量=${(data.danmaku || []).length}`, extend);

  // === 弹幕注入示例（参考 弹幕拦截器.js）===
  //
  // const playId = String(requestParams.playId || data?.playId || "");
  // if (playId) {
  //   try {
  //     // 1. 解析 playId 获取 videoId、vodName、episodeName 等信息
  //     // 2. 通过 OmniBox.getScrapeMetadata(videoId) 获取刮削数据
  //     // 3. 构建弹幕匹配用的 fileName（如 "剧名 S01E01"）
  //     // 4. 通过 OmniBox.getDanmakuByFileName(fileName) 匹配弹幕
  //     // 5. 将匹配到的弹幕注入 data.danmaku
  //
  //     const fileName = "示例剧名 S01E01";
  //     await log("info", `尝试匹配弹幕 fileName=${fileName}`, extend);
  //     const matched = await OmniBox.getDanmakuByFileName(fileName);
  //     const danmakuList = Array.isArray(matched) ? matched : [];
  //     if (danmakuList.length > 0) {
  //       if (!data.danmaku || !Array.isArray(data.danmaku)) {
  //         data.danmaku = [];
  //       }
  //       for (const item of danmakuList) {
  //         data.danmaku.push(item);
  //       }
  //       await log("info", `已注入${danmakuList.length}条弹幕`, extend);
  //     }
  //   } catch (error) {
  //     await log("warn", `弹幕匹配失败 ${error.message}`, extend);
  //   }
  // }

  // === 播放记录示例（参考 播放记录拦截器.js）===
  //
  // const vodId = String(requestParams.vodId || "");
  // if (vodId) {
  //   try {
  //     const title = String(data.vod_name || data.title || vodId);
  //     const pic = String(data.vod_pic || data.pic || "");
  //     const added = await OmniBox.addPlayHistory({
  //       vodId: vodId,
  //       title: title,
  //       pic: pic,
  //       episode: requestParams.playId || "",
  //       sourceId: String(params?.context?.sourceId || ""),
  //       episodeNumber: data.episodeNumber,
  //       episodeName: String(data.episodeName || ""),
  //     });
  //     await log("info", `${added ? "已添加" : "已存在跳过"} title=${title}`, extend);
  //   } catch (error) {
  //     await log("warn", `记录失败 ${error.message}`, extend);
  //   }
  // }

  // === 自定义参数使用示例 ===
  //
  // const customParam = extend.customParam || "";
  // if (customParam) {
  //   await log("info", `使用自定义参数 customParam=${customParam}`, extend);
  //   // 根据 customParam 执行特定逻辑...
  // }

  return data;
}
