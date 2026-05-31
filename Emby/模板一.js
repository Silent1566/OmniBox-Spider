// @name Emby-模板一
// @author
// @description 直连 Emby 接口，TVBox T4 结构输出（刮削：不支持，弹幕：不支持，嗅探：不支持）
// @dependencies: axios
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/Emby/模板一.js

/**
 * ============================================================================
 * Emby 模板二 - TVBox T4 接口格式
 * ============================================================================
 * 说明：
 * 1. 基于本地调试 Emby.js 的逻辑实现 home/category/search/detail/play。
 * 2. 参考「两个BT」日志与注释风格，补充关键日志与异常提示。
 * 3. 支持多账号配置，可通过 params.extend 覆盖默认账号。
 */

const axios = require("axios");
const http = require("http");
const https = require("https");
const OmniBox = require("omnibox_sdk");

// ==================== 默认账号配置 ====================
const defaultAccounts = [
  {
    server: "", // Emby 服务器地址
    username: "", // Emby 账号
    password: "", // Emby 密码
    name: "", // Emby 服务器名称
  },
];

let accounts = [...defaultAccounts];

const DEVICE_PROFILE = {
  DeviceProfile: {
    SubtitleProfiles: [
      { Method: "Embed", Format: "ass" },
      { Format: "ssa", Method: "Embed" },
      { Format: "subrip", Method: "Embed" },
      { Format: "sub", Method: "Embed" },
      { Method: "Embed", Format: "pgssub" },
      { Format: "subrip", Method: "External" },
      { Method: "External", Format: "sub" },
      { Method: "External", Format: "ass" },
      { Format: "ssa", Method: "External" },
      { Method: "External", Format: "vtt" },
    ],
    CodecProfiles: [
      {
        Codec: "h264",
        Type: "Video",
        ApplyConditions: [
          { Property: "IsAnamorphic", Value: "true", Condition: "NotEquals", IsRequired: false },
          { IsRequired: false, Value: "high|main|baseline|constrained baseline", Condition: "EqualsAny", Property: "VideoProfile" },
          { IsRequired: false, Value: "80", Condition: "LessThanEqual", Property: "VideoLevel" },
          { IsRequired: false, Value: "true", Condition: "NotEquals", Property: "IsInterlaced" },
        ],
      },
      {
        Codec: "hevc",
        ApplyConditions: [
          { Property: "IsAnamorphic", Value: "true", Condition: "NotEquals", IsRequired: false },
          { IsRequired: false, Value: "high|main|main 10", Condition: "EqualsAny", Property: "VideoProfile" },
          { Property: "VideoLevel", Value: "175", Condition: "LessThanEqual", IsRequired: false },
          { IsRequired: false, Value: "true", Condition: "NotEquals", Property: "IsInterlaced" },
        ],
        Type: "Video",
      },
    ],
    MaxStreamingBitrate: 40000000,
    TranscodingProfiles: [
      {
        Container: "ts",
        AudioCodec: "aac,mp3,wav,ac3,eac3,flac,opus",
        VideoCodec: "hevc,h264,mpeg4",
        BreakOnNonKeyFrames: true,
        Type: "Video",
        MaxAudioChannels: "6",
        Protocol: "hls",
        Context: "Streaming",
        MinSegments: 2,
      },
    ],
    DirectPlayProfiles: [
      {
        Container: "mov,mp4,mkv,hls,webm",
        Type: "Video",
        VideoCodec: "h264,hevc,dvhe,dvh1,h264,hevc,hev1,mpeg4,vp9",
        AudioCodec: "aac,mp3,wav,ac3,eac3,flac,truehd,dts,dca,opus,pcm,pcm_s24le",
      },
    ],
    ResponseProfiles: [{ MimeType: "video/mp4", Type: "Video", Container: "m4v" }],
    ContainerProfiles: [],
    MusicStreamingTranscodingBitrate: 40000000,
    MaxStaticBitrate: 40000000,
  },
};

const axiosInstance = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
  httpAgent: new http.Agent({ keepAlive: true }),
  validateStatus: (status) => status >= 200,
});

// ==================== 日志工具 ====================
const logInfo = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log("info", `[Emby-DEBUG] ${output}`);
};

const logError = (message, error) => {
  OmniBox.log("error", `[Emby-DEBUG] ${message}: ${error?.message || error}`);
};

// ==================== 基础工具 ====================
function cleanText(text) {
  return String(text || "").trim();
}

function parseExtendAccounts(extend) {
  if (!extend) return null;
  if (Array.isArray(extend)) return extend;
  try {
    const raw = Buffer.from(String(extend || ""), "base64").toString("utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {
    try {
      const parsed = JSON.parse(String(extend || ""));
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      logError("extend 参数解析失败", e);
    }
  }
  return null;
}

function normalizeServer(server) {
  const raw = String(server || "").trim();
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function buildHeaders() {
  return {
    "User-Agent": "Yamby/1.0.2(Android)",
    "Content-Type": "application/json; charset=UTF-8",
  };
}

function buildApiParams(embyInfos) {
  return {
    "X-Emby-Client": embyInfos.SessionInfo.Client,
    "X-Emby-Device-Name": embyInfos.SessionInfo.DeviceName,
    "X-Emby-Device-Id": embyInfos.SessionInfo.DeviceId,
  };
}

function buildHeaders() {
  return {
    "User-Agent": "Yamby/1.0.2(Android)",
    "Content-Type": "application/json; charset=UTF-8",
  };
}eName,
    "X-Emby-Device-Id": embyInfos.SessionInfo.DeviceId,
    "X-Emby-Client-Version": embyInfos.SessionInfo.ApplicationVersion,
    "X-Emby-Token": embyInfos.AccessToken,
  };
}

function getImageUrl(baseUrl, itemId, imageTags) {
  if (!itemId || !imageTags?.Primary) return "";
  return `${baseUrl}/emby/Items/${itemId}/Images/Primary?maxWidth=400&tag=${imageTags.Primary}&quality=90`;
}

function encodeMeta(obj) {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
}

function decodeMeta(str) {
  try {
    const raw = Buffer.from(str || "", "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

async function requestJson(url, options, headers) {
  const start = Date.now();
  try {
    const res = await axiosInstance.request({ url, ...options, headers });
    const cost = Date.now() - start;
    logInfo(`请求完成 ${url}`, { status: res.status, cost });
    if (res.status >= 400) {
      throw new Error(`HTTP ${res.status}`);
    }
    return res.data;
  } catch (error) {
    const cost = Date.now() - start;
    logError(`请求失败 ${url} cost=${cost}ms`, error);
    throw error;
  }
}

function parseId(compositeId) {
  const parts = String(compositeId || "").split("@", 2);
  if (parts.length !== 2) {
    throw new Error("Invalid composite ID format");
  }
  const accountIndex = parseInt(parts[0], 10);
  const itemId = parts[1];
  if (Number.isNaN(accountIndex) || accountIndex < 0 || accountIndex >= accounts.length) {
    throw new Error("Account index out of bounds");
  }
  return { account: accounts[accountIndex], accountIndex, itemId };
}

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function getAccessToken(account) {
  const baseUrl = normalizeServer(account.server);
  const header = buildHeaders();
  const deviceId = generateUUID();
  const params = {
    Username: account.username,
    Password: account.password,
    Pw: account.password,
    "X-Emby-Client": "Yamby",
    "X-Emby-Device-Name": "Yamby",
    "X-Emby-Device-Id": deviceId,
    "X-Emby-Client-Version": "1.0.2",
  };

  const url = `${baseUrl}/emby/Users/AuthenticateByName?${new URLSearchParams(params)}`;
  const embyInfos = await requestJson(url, { method: "POST" }, header);
  return { embyInfos, baseUrl };
}

// ==================== 接口实现 ====================

async function home(params = {}) {
  logInfo("进入首页");

  const externalAccounts = parseExtendAccounts(params.extend || params.ext || params.config);
  if (externalAccounts && externalAccounts.length > 0) {
    accounts = externalAccounts;
    logInfo("使用外部账号配置", { count: accounts.length });
  } else {
    logInfo("使用默认账号配置", { count: accounts.length });
  }

  const classList = [];

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    try {
      const { embyInfos, baseUrl } = await getAccessToken(account);
      const params = buildApiParams(embyInfos);
      const url = `${baseUrl}/emby/Users/${embyInfos.User.Id}/Views`;
      const data = await requestJson(`${url}?${new URLSearchParams(params)}`, {}, buildHeaders());
      const typeInfos = data.Items || [];
      const accountName = account.name || `Server ${i + 1}`;

      typeInfos.forEach((typeInfo) => {
        if (typeInfo.Name?.includes("播放列表") || typeInfo.Name?.includes("相机")) return;
        const compositeCid = `${i}@${typeInfo.Id}`;
        classList.push({ type_name: `[${accountName}] ${typeInfo.Name}`, type_id: compositeCid });
      });
    } catch (e) {
      logError(`首页分类获取失败 ${account.name || "server"}`, e);
    }
  }

  return { class: classList, list: [] };
}

async function category(params = {}) {
  const categoryId = params.categoryId || params.type_id || params.t || "";
  const pg = Math.max(1, parseInt(params.page || params.pg || "1", 10));
  logInfo("请求分类", { categoryId, page: pg });

  try {
    const { account, itemId, accountIndex } = parseId(categoryId);
    const { embyInfos, baseUrl } = await getAccessToken(account);
    const header = buildHeaders();
    const apiParams = buildApiParams(embyInfos);

    const url = `${baseUrl}/emby/Users/${embyInfos.User.Id}/Items`;
    const paramsQuery = {
      ...apiParams,
      SortBy: "DateLastContentAdded,SortName",
      IncludeItemTypes: "Movie,Series,BoxSet",
      SortOrder: "Descending",
      ParentId: itemId,
      Recursive: "true",
      Limit: "30",
      ImageTypeLimit: 1,
      StartIndex: String((pg - 1) * 30),
      EnableImageTypes: "Primary,Backdrop,Thumb,Banner",
      Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,CommunityRating,Status,CriticRating,EndDate,Path",
      EnableUserData: "true",
    };

    const data = await requestJson(`${url}?${new URLSearchParams(paramsQuery)}`, {}, header);
    const videoList = data.Items || [];

    const list = videoList.map((video) => {
      const compositeVodId = `${accountIndex}@${video.Id}`;
      return {
        vod_id: compositeVodId,
        vod_name: cleanText(video.Name),
        vod_pic: getImageUrl(baseUrl, video.Id, video.ImageTags),
        vod_remarks: video.ProductionYear ? String(video.ProductionYear) : "",
      };
    });

    return {
      list,
      page: pg,
      pagecount: pg * 30 < (data.TotalRecordCount || 0) ? pg + 1 : pg,
      limit: list.length,
      total: data.TotalRecordCount || 0,
    };
  } catch (e) {
    logError("分类请求失败", e);
    return { list: [], page: pg, pagecount: 0 };
  }
}

async function search(params = {}) {
  const wd = params.keyword || params.wd || "";
  const pg = Math.max(1, parseInt(params.page || params.pg || "1", 10));
  logInfo("搜索", { keyword: wd, page: pg });

  const list = [];

  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    try {
      const { embyInfos, baseUrl } = await getAccessToken(account);
      const header = buildHeaders();
      const apiParams = buildApiParams(embyInfos);

      const url = `${baseUrl}/emby/Users/${embyInfos.User.Id}/Items`;
      const paramsQuery = {
        ...apiParams,
        SortBy: "SortName",
        SortOrder: "Ascending",
        Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,Status,EndDate",
        StartIndex: String((pg - 1) * 50),
        EnableImageTypes: "Primary,Backdrop,Thumb",
        ImageTypeLimit: "1",
        Recursive: "true",
        SearchTerm: wd,
        IncludeItemTypes: "Movie,Series,BoxSet",
        GroupProgramsBySeries: "true",
        Limit: "50",
        EnableTotalRecordCount: "true",
      };

      const data = await requestJson(`${url}?${new URLSearchParams(paramsQuery)}`, {}, header);
      const vodList = data.Items || [];
      const accountName = account.name || `Server ${i + 1}`;

      vodList.forEach((vod) => {
        const compositeVodId = `${i}@${vod.Id}`;
        list.push({
          vod_id: compositeVodId,
          vod_name: `[${accountName}] ${cleanText(vod.Name)}`,
          vod_pic: getImageUrl(baseUrl, vod.Id, vod.ImageTags),
          vod_remarks: vod.ProductionYear ? String(vod.ProductionYear) : "",
        });
      });
    } catch (e) {
      logError(`搜索失败 ${account.name || "server"}`, e);
    }
  }

  return {
    list,
    page: pg,
    pagecount: pg + 1,
    limit: 50,
    total: list.length,
  };
}

async function detail(params = {}) {
  const ids = params.ids || params.id || params.videoId || "";
  const idList = Array.isArray(ids)
    ? ids
    : String(ids)
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);

  const result = { list: [] };

  for (const id of idList) {
    try {
      const { account, itemId, accountIndex } = parseId(id);
      const { embyInfos, baseUrl } = await getAccessToken(account);
      const header = buildHeaders();
      const apiParams = buildApiParams(embyInfos);

      const url = `${baseUrl}/emby/Users/${embyInfos.User.Id}/Items/${itemId}`;
      const info = await requestJson(`${url}?${new URLSearchParams(apiParams)}`, {}, header);

      const vod = {
        vod_id: id,
        vod_name: info.Name || "",
        vod_pic: getImageUrl(baseUrl, itemId, info.ImageTags),
        type_name: (info.Genres && info.Genres.length > 0 ? info.Genres[0] : ""),
        vod_year: info.ProductionYear ? String(info.ProductionYear) : "",
        vod_content: (info.Overview || "").replace(/\xa0/g, " ").replace(/\n\n/g, "\n").trim(),
      };

      const playSources = [];

      if (!info.IsFolder) {
        const compositePid = `${accountIndex}@${info.Id}`;
        playSources.push({
          name: "EMBY",
          episodes: [{ name: cleanText(info.Name), playId: compositePid }],
        });
      } else {
        const seasonsUrl = `${baseUrl}/emby/Shows/${itemId}/Seasons`;
        const seasonParams = {
          ...apiParams,
          UserId: embyInfos.User.Id,
          EnableImages: "true",
          Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,CommunityRating",
          EnableUserData: "true",
          EnableTotalRecordCount: "false",
        };

        try {
          const seasonsData = await requestJson(`${seasonsUrl}?${new URLSearchParams(seasonParams)}`, {}, header);
          const seasons = seasonsData.Items || [];

          for (const season of seasons) {
            const episodesUrl = `${baseUrl}/emby/Shows/${season.Id}/Episodes`;
            const episodeParams = {
              ...apiParams,
              SeasonId: season.Id,
              UserId: embyInfos.User.Id,
              Fields: "BasicSyncInfo,CanDelete,CommunityRating,PrimaryImageAspectRatio,ProductionYear,Overview",
            };

            const episodesData = await requestJson(`${episodesUrl}?${new URLSearchParams(episodeParams)}`, {}, header);
            const episodes = (episodesData.Items || []).map((episode) => {
              const compositePid = `${accountIndex}@${episode.Id}`;
              const seasonLabel = season.IndexNumber ? `第${season.IndexNumber}季` : season.Name.replace(/#/g, "-").replace(/\$/g, "|").trim();
              const episodeLabel = episode.IndexNumber ? `第${episode.IndexNumber}集` : cleanText(episode.Name);
              const episodeName = cleanText(episode.Name);
              const label = `${seasonLabel} ${episodeLabel}${episodeName && episodeName !== episodeLabel ? ` ${episodeName}` : ""}`.trim();
              return { name: label, playId: compositePid };
            });

            if (episodes.length > 0) {
              playSources.push({ name: season.Name || "默认线路", episodes });
            }
          }
        } catch (e) {
          logError("剧集获取失败，回退到子项列表", e);
          const itemsUrl = `${baseUrl}/emby/Users/${embyInfos.User.Id}/Items`;
          const itemsParams = {
            ...apiParams,
            ParentId: itemId,
            Fields: "BasicSyncInfo,CanDelete,Container,PrimaryImageAspectRatio,ProductionYear,CommunityRating,CriticRating",
            ImageTypeLimit: "1",
            StartIndex: "0",
            EnableUserData: "true",
          };

          const itemsData = await requestJson(`${itemsUrl}?${new URLSearchParams(itemsParams)}`, {}, header);
          const episodes = (itemsData.Items || [])
            .filter((item) => !item.IsFolder)
            .map((item) => {
              const seasonLabel = item.ParentIndexNumber ? `第${item.ParentIndexNumber}季` : "";
              const episodeLabel = item.IndexNumber ? `第${item.IndexNumber}集` : cleanText(item.Name);
              const episodeName = cleanText(item.Name).replace(/#/g, "-").replace(/\$/g, "|");
              const label = `${seasonLabel} ${episodeLabel}${episodeName && episodeName !== episodeLabel ? ` ${episodeName}` : ""}`.trim();
              return {
                name: label,
                playId: `${accountIndex}@${item.Id}`,
              };
            });

          if (episodes.length > 0) {
            playSources.push({ name: "资源列表", episodes });
          }
        }
      }

      vod.vod_play_sources = playSources;
      result.list.push(vod);
    } catch (e) {
      logError("详情获取失败", e);
      result.list.push({
        vod_id: id,
        vod_name: "获取详情失败",
        vod_play_from: "EMBY",
        vod_play_url: "暂无播放源$#",
      });
    }
  }

  return result;
}

async function play(params = {}) {
  const rawPlayId = params.playId || params.id || "";
  logInfo("准备播放", { playId: rawPlayId });

  try {
    const { account, itemId } = parseId(rawPlayId);
    const { embyInfos, baseUrl } = await getAccessToken(account);
    const header = buildHeaders();
    const apiParams = buildApiParams(embyInfos);

    const url = `${baseUrl}/emby/Items/${itemId}/PlaybackInfo`;
    const query = {
      UserId: embyInfos.User.Id,
      IsPlayback: "false",
      AutoOpenLiveStream: "false",
      StartTimeTicks: 0,
      MaxStreamingBitrate: "2147483647",
      ...apiParams,
    };

    const result = await requestJson(
      `${url}?${new URLSearchParams(query)}`,
      {
        method: "POST",
        headers: header,
        data: JSON.stringify(DEVICE_PROFILE),
      },
      header
    );

    const mediaSource = result?.MediaSources?.[0];
    if (!mediaSource?.DirectStreamUrl) {
      return { parse: 1, url: "", header: {}, msg: "无可用播放地址" };
    }

    const playUrl = baseUrl + mediaSource.DirectStreamUrl;
    return {
      parse: 0,
      jx: 0,
      url: playUrl,
      header: { "User-Agent": "Yamby/1.0.2(Android)" },
    };
  } catch (e) {
    logError("播放解析失败", e);
    return { parse: 0, jx: 0, url: "", header: {}, msg: `播放错误: ${e.message}` };
  }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
