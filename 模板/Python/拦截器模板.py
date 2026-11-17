# -*- coding: utf-8 -*-
# @name 拦截器模板
# @author OmniBox
# @description 通用拦截器模板，覆盖所有生命周期阶段（home/category/search/detail/play 的 before 与 after），含完整注释和日志示例
# @version 1.0.1
# @filter-stages home_before,home_after,category_before,category_after,search_before,search_after,detail_before,detail_after,play_before,play_after
# @filter-config-schema {"description":"通用拦截器模板，演示如何在各个生命周期阶段拦截并处理数据","fields":[{"key":"enabled","label":"启用拦截器","type":"boolean","required":false,"placeholder":"全局开关，默认启用"},{"key":"logLevel","label":"日志级别","type":"select","required":false,"placeholder":"日志输出级别","options":[{"label":"debug","value":"debug"},{"label":"info","value":"info"},{"label":"warn","value":"warn"},{"label":"error","value":"error"}]},{"key":"customParam","label":"自定义参数","type":"string","required":false,"placeholder":"可在拦截器中使用的自定义配置项"}]}

"""
====================================================================
OmniBox 拦截器模板 (Python)
====================================================================

【拦截器概述】
拦截器是 OmniBox 爬虫框架的核心扩展机制，允许在爬虫的生命周期各阶段
注入自定义逻辑。与爬虫脚本（如采集站模板、推送脚本）不同，拦截器
不独立提供数据，而是"拦截"已有爬虫的数据流，对其进行增强、修改或补充。

【生命周期阶段 (filter-stages)】
每个爬虫接口都提供 before 和 after 两个拦截点：
  - home_before     : 首页接口调用前，可修改请求参数
  - home_after      : 首页接口调用后，可修改返回数据（分类列表、推荐列表等）
  - category_before : 分类接口调用前，可修改分类查询参数
  - category_after  : 分类接口调用后，可修改分类视频列表
  - search_before   : 搜索接口调用前，可修改搜索关键词等参数
  - search_after    : 搜索接口调用后，可修改搜索结果
  - detail_before   : 详情接口调用前，可修改详情查询参数（如 videoId 规范化）
  - detail_after    : 详情接口调用后，可修改详情数据（如 TMDB 刮削回填）
  - play_before     : 播放接口调用前，可修改播放请求参数
  - play_after      : 播放接口调用后，可修改播放返回数据（如注入弹幕、记录历史）

【拦截器参数结构】
所有 before 钩子接收 params 对象：
  {
    "params": { ... },     # 当前接口的请求参数，可修改后返回
    "extend": { ... },     # @filter-config-schema 中定义的用户配置项
    "context": { ... },    # 运行时上下文（如 sourceId、baseURL 等）
  }
  返回值：修改后的 params（即请求参数字典）

所有 after 钩子接收 params 对象：
  {
    "data": { ... },       # 当前接口的返回数据，可修改后返回
    "extend": { ... },     # @filter-config-schema 中定义的用户配置项
    "context": { ... },    # 运行时上下文
    "params": { ... },     # 原始请求参数（只读参考，after 阶段修改无效）
  }
  返回值：修改后的 data（即返回数据字典）

【头部元数据说明】
  @name               : 拦截器名称，显示在 OmniBox 管理界面
  @author             : 作者
  @description        : 描述，说明拦截器功能
  @version            : 版本号
  @filter-stages      : 声明拦截器参与的生命周期阶段（逗号分隔）
                        框架根据此声明决定调用哪些钩子函数
  @filter-config-schema : 用户可配置的参数（JSON Schema 格式）
                          fields 数组中每个字段包含：
                            key        - 配置项键名
                            label      - 显示名称
                            type       - 类型：boolean / string / select / number
                            required   - 是否必填
                            placeholder - 提示文字
                            options    - select 类型的可选项
                          配置值通过 params.extend 传入拦截器

【常用 SDK API (spider_runner.OmniBox)】
  OmniBox.log(level, message)             - 输出日志 (level: debug/info/warn/error)
  OmniBox.request(url, options)           - 发送 HTTP 请求
  OmniBox.getScrapeMetadata(video_id)     - 获取 TMDB 刮削元数据
  OmniBox.processScraping(video_id, ...)  - 触发 TMDB 刮削
  OmniBox.addPlayHistory(record)          - 添加播放历史记录
  OmniBox.updateFavoriteEpisode(...)      - 更新追剧集数
  OmniBox.getDanmakuByFileName(file_name) - 根据文件名匹配弹幕
  OmniBox.getDriveInfoByShareURL(url)     - 获取网盘信息
  OmniBox.getDriveFileList(url, fid)      - 获取网盘文件列表
  OmniBox.getDriveVideoPlayInfo(...)      - 获取网盘视频播放信息
  OmniBox.getCache(key)                  - 获取缓存
  OmniBox.setCache(key, value, ttl)      - 设置缓存

【日志规范】
  - debug : 详细的调试信息，如参数解析过程、中间变量值
  - info  : 正常业务流程关键节点，如"开始刮削"、"匹配成功"、"已注入N条弹幕"
  - warn  : 非致命异常或可恢复的降级，如"缓存读取失败"、"未命中映射，使用兜底逻辑"
  - error : 致命错误，如"HTTP 请求失败"、"JSON 解析失败"
  建议统一格式："拦截器名: 动作描述 key=value"  例如："弹幕拦截器: 匹配成功 count=5"

【Python vs JavaScript 差异说明】
  - Python 文件首行必须声明编码：# -*- coding: utf-8 -*-
  - Python 从 spider_runner 导入：from spider_runner import OmniBox, run
  - Python 的 run() 入口写法：run({"beforeHome": before_home, "afterHome": after_home, ...})
  - Python 钩子函数命名使用 snake_case（如 before_home），但导出映射使用 camelCase
  - Python 的 OmniBox.request 返回值为字典：{"statusCode": int, "body": str|bytes}
  - Python 的 OmniBox.log 是异步函数，需要 await 调用
  - Python 中使用 requests 库发送同步请求时可与 OmniBox.request（异步）混用

====================================================================
"""

import json
import copy
from spider_runner import OmniBox, run


# ==================== 常量与工具函数 ====================

# 拦截器名称（用于日志前缀，日志中统一使用拦截器名前缀方便定位）
INTERCEPTOR_NAME = "拦截器模板"

# 日志级别优先级映射（用于按配置级别过滤日志输出）
LOG_LEVELS = {"debug": 0, "info": 1, "warn": 2, "error": 3}


def is_enabled(extend: dict) -> bool:
    """判断拦截器是否启用

    Args:
        extend: 用户配置项（来自 @filter-config-schema）

    Returns:
        bool: 是否启用，默认 True
    """
    return extend.get("enabled") is not False


def get_log_level(extend: dict) -> str:
    """获取配置的日志级别

    Args:
        extend: 用户配置项

    Returns:
        str: 日志级别，默认 "info"
    """
    return str(extend.get("logLevel") or "info").strip() or "info"


def should_log(level: str, configured_level: str) -> bool:
    """判断是否应该输出指定级别的日志

    根据配置的日志级别过滤，只输出 >= 配置级别的日志。
    例如配置为 "info" 时，debug 日志不会输出。

    Args:
        level: 待输出的日志级别
        configured_level: 配置的日志级别

    Returns:
        bool: 是否输出
    """
    return LOG_LEVELS.get(level, 1) >= LOG_LEVELS.get(configured_level, 1)


async def log(level: str, message: str, extend: dict = None):
    """统一日志输出函数

    根据配置的日志级别决定是否输出，未配置时默认输出 info 及以上级别。
    所有日志自动添加拦截器名前缀。

    Args:
        level: 日志级别 (debug/info/warn/error)
        message: 日志消息
        extend: 用户配置项（用于读取 logLevel 配置）
    """
    extend = extend or {}
    if should_log(level, get_log_level(extend)):
        try:
            await OmniBox.log(level, f"{INTERCEPTOR_NAME}: {message}")
        except Exception:
            pass


def safe_str(value, default: str = "") -> str:
    """安全转换为字符串并去除首尾空白

    Args:
        value: 待转换的值
        default: 转换失败时的默认值

    Returns:
        str: 处理后的字符串
    """
    return str(value or default).strip()


# ==================== Home 阶段 ====================

async def before_home(params: dict) -> dict:
    """首页接口 - 前置拦截

    触发时机：home(params, context) 被框架调用之前
    用途：修改首页请求参数，如强制指定页码、添加默认筛选条件等

    Args:
        params: 拦截器参数
            params["params"]  - 原始请求参数 { page, ... }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文

    Returns:
        dict: 修改后的请求参数（返回 params["params"] 的修改副本）
    """
    request_params = dict(params.get("params") or {})
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return request_params

    await log("debug", f"beforeHome 入参 page={request_params.get('page')}", extend)

    # TODO: 在此添加首页前置处理逻辑
    # 示例：强制首页从第1页开始
    # page = request_params.get("page", "1")
    # if page and int(page) < 1:
    #     request_params["page"] = "1"
    #     await log("info", f"纠正页码 page={request_params['page']}", extend)

    await log("debug", f"beforeHome 出参 page={request_params.get('page')}", extend)
    return request_params


async def after_home(params: dict) -> dict:
    """首页接口 - 后置拦截

    触发时机：home(params, context) 返回数据之后
    用途：修改首页返回数据，如补充分类、过滤推荐列表、添加 Banner 等

    Args:
        params: 拦截器参数
            params["data"]    - 原始返回数据 { class: [], list: [], filters: {}, banner: [] }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文
            params["params"]  - 原始请求参数（只读）

    Returns:
        dict: 修改后的返回数据
    """
    data = params.get("data") or {}
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return data

    class_count = len(data.get("class") or [])
    list_count = len(data.get("list") or [])
    await log("debug", f"afterHome 分类数={class_count} 列表数={list_count}", extend)

    # TODO: 在此添加首页后置处理逻辑
    # 示例：过滤掉没有图片的视频
    # if isinstance(data.get("list"), list):
    #     before = len(data["list"])
    #     data["list"] = [item for item in data["list"] if item.get("vod_pic")]
    #     await log("info", f"过滤无图视频 before={before} after={len(data['list'])}", extend)

    return data


# ==================== Category 阶段 ====================

async def before_category(params: dict) -> dict:
    """分类接口 - 前置拦截

    触发时机：category(params, context) 被框架调用之前
    用途：修改分类查询参数，如纠正 categoryId、添加默认筛选条件

    Args:
        params: 拦截器参数
            params["params"]  - 原始请求参数 { categoryId, page, filters, ... }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文

    Returns:
        dict: 修改后的请求参数
    """
    request_params = dict(params.get("params") or {})
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return request_params

    await log("debug", f"beforeCategory 入参 categoryId={request_params.get('categoryId')} page={request_params.get('page')}", extend)

    # TODO: 在此添加分类前置处理逻辑

    return request_params


async def after_category(params: dict) -> dict:
    """分类接口 - 后置拦截

    触发时机：category(params, context) 返回数据之后
    用途：修改分类返回数据，如排序、过滤、补充视频信息

    Args:
        params: 拦截器参数
            params["data"]    - 原始返回数据 { page, pagecount, total, list: [] }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文
            params["params"]  - 原始请求参数（只读）

    Returns:
        dict: 修改后的返回数据
    """
    data = params.get("data") or {}
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return data

    list_count = len(data.get("list") or [])
    await log("debug", f"afterCategory 列表数={list_count} total={data.get('total')}", extend)

    # TODO: 在此添加分类后置处理逻辑

    return data


# ==================== Search 阶段 ====================

async def before_search(params: dict) -> dict:
    """搜索接口 - 前置拦截

    触发时机：search(params, context) 被框架调用之前
    用途：修改搜索参数，如关键词纠错、添加默认分页等

    Args:
        params: 拦截器参数
            params["params"]  - 原始请求参数 { keyword, page, ... }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文

    Returns:
        dict: 修改后的请求参数
    """
    request_params = dict(params.get("params") or {})
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return request_params

    await log("debug", f"beforeSearch 入参 keyword={request_params.get('keyword')} page={request_params.get('page')}", extend)

    # TODO: 在此添加搜索前置处理逻辑
    # 示例：去除关键词中的特殊字符
    # keyword = safe_str(request_params.get("keyword"))
    # if keyword:
    #     import re
    #     cleaned = re.sub(r"[^\w\u4e00-\u9fff]", " ", keyword).strip()
    #     if cleaned != keyword:
    #         await log("info", f"关键词清理 before={keyword} after={cleaned}", extend)
    #         request_params["keyword"] = cleaned

    return request_params


async def after_search(params: dict) -> dict:
    """搜索接口 - 后置拦截

    触发时机：search(params, context) 返回数据之后
    用途：修改搜索结果，如去重、排序、补充评分信息

    Args:
        params: 拦截器参数
            params["data"]    - 原始返回数据 { page, pagecount, total, list: [] }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文
            params["params"]  - 原始请求参数（只读）

    Returns:
        dict: 修改后的返回数据
    """
    data = params.get("data") or {}
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return data

    list_count = len(data.get("list") or [])
    await log("debug", f"afterSearch 列表数={list_count}", extend)

    # TODO: 在此添加搜索后置处理逻辑

    return data


# ==================== Detail 阶段 ====================

async def before_detail(params: dict) -> dict:
    """详情接口 - 前置拦截

    触发时机：detail(params, context) 被框架调用之前
    用途：规范化详情查询参数，如 videoId 去空格、URL 编码修正等

    实际参考：刮削拦截器的 beforeDetail 会对 videoId 做规范化处理

    Args:
        params: 拦截器参数
            params["params"]  - 原始请求参数 { videoId, source, ... }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文

    Returns:
        dict: 修改后的请求参数
    """
    request_params = dict(params.get("params") or {})
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return request_params

    await log("debug", f"beforeDetail 入参 videoId={request_params.get('videoId')}", extend)

    # 示例：规范化 videoId（去除首尾空白）
    if request_params.get("videoId") is not None:
        normalized = safe_str(request_params["videoId"])
        if normalized != request_params["videoId"]:
            request_params["videoId"] = normalized
            await log("info", f"规范化 videoId -> {normalized}", extend)

    # 示例：规范化 source 字段
    if request_params.get("source") is not None:
        request_params["source"] = safe_str(request_params["source"])

    # TODO: 在此添加更多详情前置处理逻辑

    return request_params


async def after_detail(params: dict) -> dict:
    """详情接口 - 后置拦截

    触发时机：detail(params, context) 返回数据之后
    用途：对详情结果进行增强处理，最常见的是触发 TMDB 刮削并回填元数据

    实际参考：刮削拦截器的 afterDetail 会自动触发刮削并回填标题/封面/集名等

    Args:
        params: 拦截器参数
            params["data"]    - 原始返回数据 { list: [{ vod_id, vod_name, vod_pic, vod_play_sources, ... }] }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文
            params["params"]  - 原始请求参数（只读）

    Returns:
        dict: 修改后的返回数据
    """
    data = params.get("data") or {}
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return data

    item_list = data.get("list")
    if not isinstance(item_list, list) or len(item_list) == 0:
        await log("debug", "afterDetail 列表为空，跳过处理", extend)
        return data

    await log("debug", f"afterDetail 列表数={len(item_list)}", extend)

    # TODO: 在此添加详情后置处理逻辑
    #
    # === 刮削增强示例（参考 刮削拦截器.js）===
    #
    # for item in item_list:
    #     video_id = safe_str(item.get("vod_id"))
    #     vod_name = safe_str(item.get("vod_name"))
    #     if not video_id:
    #         continue
    #
    #     try:
    #         # 检查是否已有刮削数据
    #         existing = await OmniBox.getScrapeMetadata(video_id)
    #         if existing and isinstance(existing, dict):
    #             scrape_data = existing.get("scrapeData") or {}
    #             if scrape_data.get("title"):
    #                 await log("info", f"命中缓存 videoId={video_id}", extend)
    #                 # 应用刮削数据到 item...
    #             else:
    #                 # 触发刮削
    #                 await log("info", f"开始刮削 videoId={video_id}", extend)
    #                 # video_files = collect_video_files(item)
    #                 # await OmniBox.processScraping(video_id, vod_name, vod_name, video_files)
    #     except Exception as error:
    #         await log("warn", f"刮削失败 videoId={video_id} {error}", extend)

    return data


# ==================== Play 阶段 ====================

async def before_play(params: dict) -> dict:
    """播放接口 - 前置拦截

    触发时机：play(params, context) 被框架调用之前
    用途：修改播放请求参数，如根据 flag 调整播放策略、添加 Referer 等

    Args:
        params: 拦截器参数
            params["params"]  - 原始请求参数 { playId, flag, vodId, ... }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文

    Returns:
        dict: 修改后的请求参数
    """
    request_params = dict(params.get("params") or {})
    extend = params.get("extend") or {}

    if not is_enabled(extend):
        return request_params

    await log("debug", f"beforePlay 入参 playId={request_params.get('playId')} flag={request_params.get('flag')}", extend)

    # TODO: 在此添加播放前置处理逻辑
    # 示例：根据 flag 调整播放模式
    # if request_params.get("flag") == "直连":
    #     request_params["flag"] = ""
    #     await log("info", "清除直连flag标记", extend)

    return request_params


async def after_play(params: dict) -> dict:
    """播放接口 - 后置拦截

    触发时机：play(params, context) 返回数据之后
    用途：对播放结果进行增强，最常见的是注入弹幕数据或记录播放历史

    实际参考：
      - 弹幕拦截器.js：根据刮削结果匹配并注入弹幕
      - 播放记录拦截器.js：自动记录观看历史并更新追剧进度

    Args:
        params: 拦截器参数
            params["data"]    - 原始返回数据 { urls: [], flag, header, parse, danmaku: [] }
            params["extend"]  - 用户配置项
            params["context"] - 运行时上下文
            params["params"]  - 原始请求参数（只读）：{ playId, flag, vodId, ... }

    Returns:
        dict: 修改后的返回数据
    """
    data = dict(params.get("data") or {})
    extend = params.get("extend") or {}
    request_params = params.get("params") or {}

    if not is_enabled(extend):
        return data

    urls_count = len(data.get("urls") or [])
    danmaku_count = len(data.get("danmaku") or [])
    await log("debug", f"afterPlay urls数量={urls_count} danmaku数量={danmaku_count}", extend)

    # === 弹幕注入示例（参考 弹幕拦截器.js）===
    #
    # play_id = safe_str(request_params.get("playId") or data.get("playId"))
    # if play_id:
    #     try:
    #         # 1. 解析 playId 获取 videoId、vodName、episodeName 等信息
    #         # 2. 通过 OmniBox.getScrapeMetadata(video_id) 获取刮削数据
    #         # 3. 构建弹幕匹配用的 fileName（如 "剧名 S01E01"）
    #         # 4. 通过 OmniBox.getDanmakuByFileName(file_name) 匹配弹幕
    #         # 5. 将匹配到的弹幕注入 data["danmaku"]
    #
    #         file_name = "示例剧名 S01E01"
    #         await log("info", f"尝试匹配弹幕 fileName={file_name}", extend)
    #         matched = await OmniBox.getDanmakuByFileName(file_name)
    #         danmaku_list = matched if isinstance(matched, list) else []
    #         if danmaku_list:
    #             if not isinstance(data.get("danmaku"), list):
    #                 data["danmaku"] = []
    #             data["danmaku"].extend(danmaku_list)
    #             await log("info", f"已注入{len(danmaku_list)}条弹幕", extend)
    #     except Exception as error:
    #         await log("warn", f"弹幕匹配失败 {error}", extend)

    # === 播放记录示例（参考 播放记录拦截器.js）===
    #
    # vod_id = safe_str(request_params.get("vodId"))
    # if vod_id:
    #     try:
    #         title = safe_str(data.get("vod_name") or data.get("title") or vod_id)
    #         pic = safe_str(data.get("vod_pic") or data.get("pic"))
    #         context = params.get("context") or {}
    #         added = await OmniBox.addPlayHistory({
    #             "vodId": vod_id,
    #             "title": title,
    #             "pic": pic,
    #             "episode": safe_str(request_params.get("playId")),
    #             "sourceId": safe_str(context.get("sourceId")),
    #             "episodeNumber": data.get("episodeNumber"),
    #             "episodeName": safe_str(data.get("episodeName")),
    #         })
    #         await log("info", f"{'已添加' if added else '已存在跳过'} title={title}", extend)
    #     except Exception as error:
    #         await log("warn", f"记录失败 {error}", extend)

    # === 自定义参数使用示例 ===
    #
    # custom_param = safe_str(extend.get("customParam"))
    # if custom_param:
    #     await log("info", f"使用自定义参数 customParam={custom_param}", extend)
    #     # 根据 custom_param 执行特定逻辑...

    return data


# ==================== 导出与入口 ====================

# Python 版的入口映射
# 注意：键名使用 camelCase（与框架约定一致），值使用 Python 的 snake_case 函数名
# 只有在 @filter-stages 中声明的阶段对应的钩子才会被框架调用
# 不需要的钩子可以直接删除，同时从 @filter-stages 中移除对应阶段

if __name__ == "__main__":
    run({
        "beforeHome": before_home,
        "afterHome": after_home,
        "beforeCategory": before_category,
        "afterCategory": after_category,
        "beforeSearch": before_search,
        "afterSearch": after_search,
        "beforeDetail": before_detail,
        "afterDetail": after_detail,
        "beforePlay": before_play,
        "afterPlay": after_play,
    })
