// @name 推送脚本
// @push 1
// @author lampon
// @description 推送脚本
// @version 1.0.7
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/模板/JavaScript/推送脚本.js

const OmniBox = require("omnibox_sdk");

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

/**
 * 详情
 * @param {Object} params - 参数对象
 *   - videoId: 视频ID（格式：shareURL|keyword|note）
 * @returns {Object} 视频详情
 */
async function detail(params) {
  try {
    OmniBox.log("info", `详情接口调用，参数: ${JSON.stringify(params)}`);

    const videoId = params.videoId || "";
    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    // 获取来源参数（可选）
    const source = params.source || "";

    // 解析id：格式为 shareURL|keyword|note
    const parts = videoId.split("|");
    const shareURL = parts[0] || "";
    const keyword = parts[1] || "";
    const note = parts[2] || "";

    if (!shareURL) {
      throw new Error("分享链接不能为空");
    }

    OmniBox.log("info", `解析参数: shareURL=${shareURL}, keyword=${keyword}, note=${note}`);

    // 检测网盘类型
    const driveInfo = await OmniBox.getDriveInfoByShareURL(shareURL);
    const displayName = driveInfo.displayName;

    // 获取文件列表（自动获取stoken）
    const fileList = await OmniBox.getDriveFileList(shareURL, "0");

    if (!fileList || !fileList.files || !Array.isArray(fileList.files)) {
      throw new Error("获取文件列表失败");
    }

    OmniBox.log("info", `获取文件列表成功，文件数量: ${fileList.files.length}`);

    // 递归获取所有视频文件
    const allVideoFiles = await getAllVideoFiles(shareURL, fileList.files, "0");

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
      const scrapingResult = await OmniBox.processScraping(videoId, keyword, note, videoFilesForScraping);
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
    try {
      OmniBox.log("info", `开始获取元数据，resourceId: ${videoId}`);
      // 使用新的通用元数据API，videoId作为resourceId
      const metadata = await OmniBox.getScrapeMetadata(videoId);
      OmniBox.log("info", `获取元数据响应: ${JSON.stringify(metadata).substring(0, 500)}`);

      scrapeData = metadata.scrapeData || null;
      videoMappings = metadata.videoMappings || [];
      const scrapeType = metadata.scrapeType || ""; // 获取刮削类型（movie 或 tv）

      if (scrapeData) {
        OmniBox.log("info", `获取到刮削数据，标题: ${scrapeData.title || "未知"}, 类型: ${scrapeType || "未知"}, 映射数量: ${videoMappings.length}`);
      } else {
        OmniBox.log("warn", `未获取到刮削数据，映射数量: ${videoMappings.length}`);
        if (!scrapingSuccess) {
          OmniBox.log("warn", "刮削处理可能失败，导致没有刮削数据");
        }
      }
    } catch (error) {
      OmniBox.log("error", `获取元数据失败: ${error.message}`);
      if (error.stack) {
        OmniBox.log("error", `获取元数据错误堆栈: ${error.stack}`);
      }
    }

    // 构建结构化播放源
    const playSources = [];

    // 确定播放源列表
    let sourceNames = [videoId]; // 默认使用 videoId
    if (driveInfo.driveType === "quark" || driveInfo.driveType === "uc") {
      sourceNames = ["服务端代理", "本地代理", "直连"];

      // 如果来源是网页端，过滤掉"本地代理"线路
      if (source === "web") {
        sourceNames = sourceNames.filter((name) => name !== "本地代理");
        OmniBox.log("info", `来源为网页端，已过滤掉"本地代理"线路`);
      }
    }

    // 为每个播放源构建剧集列表
    for (const sourceName of sourceNames) {
      const episodes = [];

      for (const file of allVideoFiles) {
        let fileName = file.file_name || "";
        const fileId = file.fid || "";
        const fileSize = file.size || file.file_size || 0;

        // 构建用于匹配映射关系的文件ID格式：{shareURL}|${fileId}
        const formattedFileId = fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : "";

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

        // 构建剧集对象
        const episode = {
          name: fileName,
          playId: fileId ? `${encodeURIComponent(shareURL)}|${fileId}` : "",
          size: fileSize > 0 ? fileSize : undefined,
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
        playSources.push({
          name: sourceName,
          episodes: episodes,
        });
      }
    }

    // 构建视频详情
    const displayNameFromFileList = fileList.displayName || fileList.display_name || "";
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
 * @returns {Object} 播放地址
 */
async function play(params) {
  try {
    const flag = params.flag || "";
    const playId = params.playId || "";
    // 获取来源参数（可选），从detail接口传递过来
    const source = params.source || "";

    if (!playId) {
      throw new Error("播放参数不能为空");
    }

    // 解析playId：格式为 分享链接|文件ID
    const parts = playId.split("|");
    if (parts.length < 2) {
      throw new Error("播放参数格式错误，应为：分享链接|文件ID");
    }
    let shareURL = parts[0] || "";
    const fileId = parts[1] || "";
    shareURL=decodeURIComponent(shareURL);

    if (!shareURL || !fileId) {
      throw new Error("分享链接或文件ID不能为空");
    }

    // 获取刮削元数据，用于弹幕匹配（使用通用API）
    let danmakuList = [];
    try {
      // 直接使用 shareURL 作为 resourceId 获取刮削元数据
      const metadata = await OmniBox.getScrapeMetadata(shareURL);
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
        OmniBox.log("info", "未找到刮削元数据，跳过弹幕匹配");
      }
    } catch (error) {
      OmniBox.log("warn", `弹幕匹配失败: ${error.message}`);
      // 弹幕匹配失败不影响播放，继续执行
    }

    // 使用SDK获取播放信息（自动获取stoken和fid_token，flag参数用于处理URL前缀）
    // 对于夸克和UC网盘，如果flag是"服务端代理"或"本地代理"，后端会自动添加前缀
    const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fileId, flag);

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
  detail,
  play,
};

// 使用公共 runner 处理标准输入/输出
// runner 通过 NODE_PATH 环境变量自动解析，无需手动指定路径
const runner = require("spider_runner");
runner.run(module.exports);
