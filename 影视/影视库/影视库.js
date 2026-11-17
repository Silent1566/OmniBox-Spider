// @name 影视库
// @author lampon
// @description 
// @version 1.0.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/影视库/影视库.js


/**
 * 影视库（网盘入库版）完整爬虫脚本
 *
 * 与 scheduled_task_drive_batch_to_library.js / 手工 upsert 写入的数据配合：
 * - playbackPayload.kind === "cloud_share"
 * - playbackPayload.category / movieName（入库脚本按「分类/影片文件夹」写入）
 * - genres[0] 一般为分类名，可与后端 /media/list 的 genre 参数联动筛选
 * - episodes[].playId 格式：分享链接|文件ID（与 pansou.js 一致，便于走 getDriveVideoPlayInfo）
 *
 * 功能对齐参考：backend/static/templates/js/pansou.js
 * - home：影视库推荐 + 可选「最近观看 / 收藏」（需爬虫源 context.sourceId）
 * - category / search：分页读 listMediaItems
 * - detail：展开为 vod_play_sources（多线路：服务端代理 / 本地代理 / 直连，夸克/UC 与 pansou 类似）
 * - play：解析 playId，调用 getDriveVideoPlayInfo，可选弹幕
 *
 * 环境变量：
 *   OMNIBOX_API_URL=http://127.0.0.1:端口/api/spider/omnibox
 */

const OmniBox = require("omnibox_sdk");

/** 将分类名编码为 category 接口的 type_id（首页动态「分类」Tab） */
function genreToTypeId(g) {
  if (!g) return "";
  return (
    "g64_" +
    Buffer.from(String(g), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "")
  );
}

function typeIdToGenre(tid) {
  if (!tid || typeof tid !== "string") return null;
  if (!tid.startsWith("g64_")) return null;
  let b64 = tid.slice(4).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  try {
    return Buffer.from(b64, "base64").toString("utf8");
  } catch (_) {
    return null;
  }
}

function toVodLite(item) {
  if (!item) return null;
  const cat = Array.isArray(item.genres) && item.genres.length ? item.genres[0] : "";
  const remarks = [cat, item.year, item.sourceType].filter(Boolean).join(" · ");
  return {
    vod_id: item.id,
    vod_name: item.title,
    vod_pic: item.coverUrl || "",
    vod_remarks: remarks || "",
    type_name: cat || "影视库",
  };
}

function parsePlaybackRaw(item) {
  if (!item || item.playbackPayload == null) return null;
  const raw = item.playbackPayload;
  if (typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }
  return null;
}

function resolveShareURL(payload, item) {
  if (payload && payload.shareURL) return String(payload.shareURL);
  if (!item || item.extra == null) return "";
  try {
    const ex = typeof item.extra === "string" ? JSON.parse(item.extra) : item.extra;
    if (ex && ex.shareURL) return String(ex.shareURL);
  } catch (_) {
    /* ignore */
  }
  return "";
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
  if (!scrapeData) return String(fallbackVodName || fallbackEpisodeName || "");
  const title = scrapeData.title || fallbackVodName || "";
  if (!title) return "";
  if (scrapeType === "movie") return String(title);
  const seasonAirYear = scrapeData.seasonAirYear || "";
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
}

function applyScrapeToEpisodes(episodes, mappings) {
  const list = Array.isArray(episodes) ? episodes.map((e) => ({ ...e })) : [];
  const maps = Array.isArray(mappings) ? mappings : [];

  for (const ep of list) {
    const pid = String(ep.playId || "");
    if (!pid) continue;
    const m = maps.find((x) => String(x?.fileId || "") === pid);
    if (!m) continue;
    if (m.episodeName) {
      const prefix = m.episodeNumber != null ? `${m.episodeNumber}.` : "";
      ep.name = `${prefix}${m.episodeName}`.trim() || ep.name;
      ep.episodeName = m.episodeName;
    }
    if (m.episodeOverview) ep.episodeOverview = m.episodeOverview;
    if (m.episodeAirDate) ep.episodeAirDate = m.episodeAirDate;
    if (m.episodeStillPath) ep.episodeStillPath = m.episodeStillPath;
    if (m.episodeVoteAverage != null) ep.episodeVoteAverage = m.episodeVoteAverage;
    if (m.episodeRuntime != null) ep.episodeRuntime = m.episodeRuntime;
    if (m.seasonNumber != null) ep._seasonNumber = m.seasonNumber;
    if (m.episodeNumber != null) ep._episodeNumber = m.episodeNumber;
  }

  const hasEpNum = list.some((e) => e._episodeNumber != null || e._seasonNumber != null);
  if (hasEpNum) {
    list.sort((a, b) => {
      const sa = a._seasonNumber != null ? a._seasonNumber : 0;
      const sb = b._seasonNumber != null ? b._seasonNumber : 0;
      if (sa !== sb) return sa - sb;
      const ea = a._episodeNumber != null ? a._episodeNumber : 0;
      const eb = b._episodeNumber != null ? b._episodeNumber : 0;
      return ea - eb;
    });
  } else {
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
  }

  return list;
}

function episodesToScrapeFiles(episodes) {
  const out = [];
  for (const ep of episodes || []) {
    const playId = String(ep.playId || "");
    const name = String(ep.name || "视频");
    if (!playId) continue;
    out.push({
      fid: playId,
      file_id: playId,
      file_name: name,
      name,
      format_type: "video",
    });
  }
  return out;
}

/**
 * 首页
 */
async function home(params, context) {
  await OmniBox.log("info", "[media_library_cloud] home");
  // 首页分类不再依赖 SDK 动态返回数据，改为脚本内固定配置（参考 douban.js 的写法）。
  // 约定：入库脚本会把“分类”写入 media_item.genres[0]，这里用 genreToTypeId/ typeIdToGenre 做联动筛选。
  const fixedGenreTabs = [
    { type_id: genreToTypeId("电影"), type_name: "电影" },
    { type_id: genreToTypeId("剧集"), type_name: "剧集" },
    { type_id: genreToTypeId("综艺"), type_name: "综艺" },
    { type_id: genreToTypeId("动漫"), type_name: "动漫" },
    { type_id: genreToTypeId("纪录片"), type_name: "纪录片" },
  ];

  const classes = [
    { type_id: "all", type_name: "影视库全部" },
    ...fixedGenreTabs,
    { type_id: "site", type_name: "站点" },
    { type_id: "webdav", type_name: "WebDAV" },
  ];

  let list = [];
  try {
    const page = await OmniBox.listMediaItems({ page: 1, pageSize: 12, keyword: "", sourceType: "cloud_share" });
    list = (page.list || []).map(toVodLite).filter(Boolean);
  } catch (e) {
    await OmniBox.log("warn", `[media_library_cloud] listMediaItems: ${e.message}`);
  }

  return { class: classes, list };
}

/**
 * 分类
 */
async function category(params, context) {
  const tid = params.categoryId || params.type_id || "all";
  const pg = params.page != null ? Number(params.page) : 1;
  const page = pg > 0 ? pg : 1;

  if (tid === "history" || tid === "favorite") {
    try {
      const data = await OmniBox.getSourceCategoryData(tid, page, 20);
      const list = (data.list || []).map((item) => ({
        vod_id: item.vod_id || item.VodID,
        vod_name: item.vod_name || item.VodName,
        vod_pic: item.vod_pic || item.VodPic,
        vod_remarks: item.vod_remarks || item.VodRemarks || "",
        type_name: item.type_name || item.TypeName || "",
      }));
      return {
        page,
        pagecount: data.pageCount || 1,
        limit: 20,
        total: data.total || list.length,
        list,
      };
    } catch (e) {
      await OmniBox.log("warn", `[media_library_cloud] category sdk: ${e.message}`);
      return { page: 1, pagecount: 0, total: 0, list: [] };
    }
  }

  const genreFilter = typeIdToGenre(String(tid));
  if (genreFilter) {
    const res = await OmniBox.listMediaItems({
      page,
      pageSize: 20,
      keyword: "",
      sourceType: "cloud_share",
      genre: genreFilter,
    });
    const list = (res.list || []).map(toVodLite).filter(Boolean);
    const total = res.total || 0;
    const pageSize = res.pageSize || 20;
    const pagecount = Math.max(1, Math.ceil(total / pageSize));
    return { page, pagecount, limit: pageSize, total, list };
  }

  const sourceType = tid === "all" ? "" : String(tid);
  const res = await OmniBox.listMediaItems({
    page,
    pageSize: 20,
    keyword: "",
    sourceType,
  });
  const list = (res.list || []).map(toVodLite).filter(Boolean);
  const total = res.total || 0;
  const pageSize = res.pageSize || 20;
  const pagecount = Math.max(1, Math.ceil(total / pageSize));
  return { page, pagecount, limit: pageSize, total, list };
}

/**
 * 搜索
 */
async function search(params, context) {
  const keyword = params.keyword || params.wd || "";
  const pg = params.page != null ? Number(params.page) : 1;
  const page = pg > 0 ? pg : 1;
  const res = await OmniBox.listMediaItems({
    page,
    pageSize: 20,
    keyword: String(keyword),
    sourceType: "",
  });
  const list = (res.list || []).map(toVodLite).filter(Boolean);
  const total = res.total || 0;
  const pageSize = res.pageSize || 20;
  const pagecount = Math.max(1, Math.ceil(total / pageSize));
  return { page, pagecount, limit: pageSize, total, list };
}

function buildEpisodeRows(episodes, shareURL) {
  const out = [];
  for (const ep of episodes || []) {
    const name = ep.name || "剧集";
    let playId = ep.playId || "";
    if (!playId && ep.fid) {
      // 兼容旧入库：如果只给 fid，则补成 fid|shareURL
      playId = `${ep.fid}|${shareURL}`;
    }
    if (!name || !playId) continue;
    out.push({ name, playId, size: ep.size });
  }
  return out;
}

function pickPlaySourceNames(driveType, context, params) {
  const fromWeb = (context && context.from === "web") || params.source === "web";
  if (driveType === "quark" || driveType === "uc") {
    const base = ["服务端代理", "本地代理", "直连"];
    return fromWeb ? base.filter((n) => n !== "本地代理") : base;
  }
  return ["播放"];
}

function payloadToPlaySources(payload, context, params) {
  if (!payload || typeof payload !== "object") return [];
  const kind = String(payload.kind || "");

  if (kind === "cloud_share") {
    const shareURL = String(payload.shareURL || "");
    const eps = buildEpisodeRows(payload.episodes || [], shareURL);
    const driveType = String(payload.driveType || "");
    const sourceNames = pickPlaySourceNames(driveType, context, params);
    return sourceNames.map((name) => ({ name, episodes: eps.map((e) => ({ ...e })) }));
  }

  if (kind === "webdav" || kind === "site") {
    const eps = Array.isArray(payload.episodes) && payload.episodes.length
      ? payload.episodes.map((e) => ({ name: e.name || "播放", playId: e.playId || e.url || "", size: e.size }))
      : payload.playUrl
        ? [{ name: payload.episodeName || "正片", playId: String(payload.playUrl) }]
        : [];
    const sourceName = payload.sourceName || (kind === "webdav" ? "WebDAV" : "站点");
    return eps.length ? [{ name: sourceName, episodes: eps }] : [];
  }

  return [];
}

/**
 * 详情（网盘影视库条目 → vod_play_sources）
 */
async function detail(params, context) {
  const rawId = params.videoId || params.id;
  const ids = Array.isArray(rawId) ? rawId : rawId != null ? [rawId] : [];
  const list = [];

  for (const raw of ids) {
    const item = await OmniBox.getMediaItem(String(raw));
    if (!item) continue;

    const payload = parsePlaybackRaw(item);
    const kind = payload && payload.kind ? String(payload.kind) : "";
    const share = resolveShareURL(payload, item);

    let resolvedDrive = kind === "cloud_share" ? String(payload.driveType || "") : "";
    if (kind === "cloud_share" && !resolvedDrive && share) {
      try {
        const di = await OmniBox.getDriveInfoByShareURL(share);
        resolvedDrive = di.driveType || "";
      } catch (_) {
        /* ignore */
      }
    }

    let playSources = payloadToPlaySources(
      kind === "cloud_share" ? { ...payload, driveType: resolvedDrive, shareURL: share || payload.shareURL } : payload,
      context,
      params,
    );

    // 刮削：对 cloud_share/webdav/site 统一按“影视库条目ID”做资源ID，避免 shareURL/路径变化导致不稳定
    try {
      if (context && context.sourceId && playSources.length) {
        const episodesAll = [];
        for (const ps of playSources) {
          for (const ep of ps.episodes || []) episodesAll.push(ep);
        }
        const files = episodesToScrapeFiles(episodesAll);
        if (files.length) {
          await OmniBox.processScraping(String(item.id), String(item.title || ""), String(item.originalTitle || item.title || ""), files);
          const meta = await OmniBox.getScrapeMetadata(String(item.id));
          const scrapeData = meta && meta.scrapeData ? meta.scrapeData : null;
          const mappings = Array.isArray(meta && meta.videoMappings) ? meta.videoMappings : [];
          if (mappings.length) {
            playSources = playSources.map((ps) => ({
              ...ps,
              episodes: applyScrapeToEpisodes(ps.episodes || [], mappings),
            }));
          }
          if (scrapeData && scrapeData.title) {
            item.title = scrapeData.title;
          }
          if (scrapeData && scrapeData.posterPath) {
            item.coverUrl = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
          }
          if (scrapeData && scrapeData.releaseDate) {
            item.year = String(scrapeData.releaseDate).substring(0, 4);
          }
          if (scrapeData && scrapeData.overview) {
            item.description = String(scrapeData.overview);
          }
          if (scrapeData && scrapeData.credits) {
            const cast = Array.isArray(scrapeData.credits.cast) ? scrapeData.credits.cast : [];
            const crew = Array.isArray(scrapeData.credits.crew) ? scrapeData.credits.crew : [];
            item.actors = cast.slice(0, 6).map((c) => c?.name).filter(Boolean);
            item.directors = crew
              .filter((c) => c?.job === "Director" || c?.department === "Directing")
              .slice(0, 3)
              .map((c) => c?.name)
              .filter(Boolean);
          }
        }
      }
    } catch (e) {
      await OmniBox.log("warn", `[media_library_cloud] scraping: ${e.message}`);
    }

    const cat = (payload && payload.category) || (Array.isArray(item.genres) && item.genres[0]) || "";
    const mName = (payload && payload.movieName) || item.originalTitle || "";
    const remarks = [cat, mName, resolvedDrive || kind || item.sourceType].filter(Boolean).join(" · ");

    if (playSources.length) {
      // 将媒体库 ID 拼到 playId 末尾，play 接口可直接通过 playId 获取更多信息
      playSources = playSources.map((ps) => ({
        ...ps,
        episodes: (ps.episodes || []).map((ep) => ({
          ...ep,
          playId: ep && ep.playId ? `${ep.playId}|${item.id}` : ep.playId,
        })),
      }));
      list.push({
        vod_id: item.id,
        vod_name: item.title,
        vod_pic: item.coverUrl || "",
        type_name: cat ? `影视库 · ${cat}` : "影视库",
        vod_year: item.year || "",
        vod_area: cat || item.region || "",
        vod_remarks: remarks || "影视库",
        vod_actor: Array.isArray(item.actors) ? item.actors.join(",") : "",
        vod_director: Array.isArray(item.directors) ? item.directors.join(",") : "",
        vod_content: item.description || "",
        vod_play_sources: playSources,
      });
      continue;
    }

    // 兜底：旧结构 url/urls
    const p = payload || {};
    let urls = [];
    if (p.urls && Array.isArray(p.urls)) urls = p.urls;
    else if (p.url) urls = [{ name: "播放", url: p.url }];
    const vodPlayUrl = urls.map((u) => `${u.name}$${u.url}`).join("#");
    list.push({
      vod_id: item.id,
      vod_name: item.title,
      vod_pic: item.coverUrl || "",
      type_name: "影视库",
      vod_year: item.year || "",
      vod_content: item.description || "",
      vod_play_from: "影视库",
      vod_play_url: vodPlayUrl || "",
    });
  }

  return { list };
}

/**
 * 播放
 * playId 格式：文件ID|媒体表Id
 */
async function play(params, context) {
    const flag = params.flag || "服务端代理";

    const parts = params.playId.split("|");
    const libraryVodId = parts[1];
    const fileId = parts[0];
    let item = null;
    let payload = null;
    try {
        if (libraryVodId) {
            item = await OmniBox.getMediaItem(libraryVodId);
            payload = parsePlaybackRaw(item);
        }
    } catch (_) {
        item = null;
        payload = null;
    }

    const kind = payload && payload.kind ? String(payload.kind) : "";

    // webdav/site：playId 直接是 URL，header 可能来自 payload.header
    if (kind === "webdav" || kind === "site") {
        const urlOnly =fileId;
        const header = (payload && payload.header && typeof payload.header === "object") ? payload.header : {};
        let danmaku = [];
        try {
            const meta = libraryVodId ? await OmniBox.getScrapeMetadata(libraryVodId) : null;
            const scrapeData = meta && meta.scrapeData ? meta.scrapeData : null;
            const mappings = Array.isArray(meta && meta.videoMappings) ? meta.videoMappings : [];
            const mapping = mappings.find((m) => String(m?.fileId || "") === urlOnly);
            const fileName = buildScrapedDanmuFileName(scrapeData, meta?.scrapeType || "", mapping, item?.title || params.title || "", params.episodeName || "");
            if (fileName) {
                danmaku = await OmniBox.getDanmakuByFileName(fileName);
            }
        } catch (_) {
            /* ignore */
        }

        return { urls: [{ name: "播放", url: urlOnly }], header, parse: 0, danmaku: Array.isArray(danmaku) ? danmaku : [] };
    }
    else {

            const fid = fileId;
            const shareURL = item.from;
            if (!shareURL || !fid) return { urls: [], header: {}, parse: 0, danmaku: [] };

            try {
                const getTc = params.getTranscodeUrls !== false;
                const playInfo = await OmniBox.getDriveVideoPlayInfo(shareURL, fid, flag, getTc);
                const urlList = playInfo && Array.isArray(playInfo.url) ? playInfo.url : [];
                const urlsResult = urlList.map((x) => ({ name: x.name || "播放", url: x.url })).filter((x) => x.url);
                if (!urlsResult.length) throw new Error("无法获取播放地址");

                const header = playInfo.header || {};

                // 优先用刮削元数据生成弹幕名（如 S01E01）
                let danmakuList = Array.isArray(playInfo.danmaku) ? playInfo.danmaku : [];
                try {
                    if (libraryVodId) {
                        const meta = await OmniBox.getScrapeMetadata(libraryVodId);
                        const scrapeData = meta && meta.scrapeData ? meta.scrapeData : null;
                        const mappings = Array.isArray(meta && meta.videoMappings) ? meta.videoMappings : [];
                        const playIdNoLib = libraryVodId ? `${fid}|${shareURL}` : playId;
                        const mapping = mappings.find((m) => String(m?.fileId || "") === playIdNoLib);
                        const fileName = buildScrapedDanmuFileName(scrapeData, meta?.scrapeType || "", mapping, (item && item.title) || params.title || "", params.episodeName || "");
                        if (fileName) {
                            const dm = await OmniBox.getDanmakuByFileName(fileName);
                            if (Array.isArray(dm) && dm.length) danmakuList = dm;
                        }
                    }
                } catch (_) {
                    /* ignore */
                }

                return { urls: urlsResult, header, parse: 0, danmaku: danmakuList };
            } catch (e) {
                await OmniBox.log("error", `[media_library_cloud] play: ${e.message}`);
                return { urls: [], header: {}, parse: 0, danmaku: [] };
            }

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
