// @name 如意资源
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持，类型筛选：支持
// @version 1.0.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/如意资源.js

const OmniBox = require("omnibox_sdk");

/**
 * 配置信息
 */
const ruyiConfig = {
  apiUrls: [
    "https://cj.rycjapi.com/api.php/provide/vod",
    "https://cj.rytvapi.com/api.php/provide/vod",
    "https://bycj.rytvapi.com/api.php/provide/vod"
  ],
  imgHosts: ["https://ps.ryzypics.com", "https://ry-pic.com", "https://img.lzzyimg.com"],
  danmuApi: process.env.DANMU_API || "",
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://cj.rycjapi.com/'
  },
  timeout: 15000,
  batchSize: 20
};

// 硬编码的分类数据
const HARDCODED_CLASSES = [
  { type_id: "1", type_name: "电影片" },
  { type_id: "2", type_name: "连续剧" },
  { type_id: "3", type_name: "综艺片" },
  { type_id: "4", type_name: "动漫片" },
  { type_id: "35", type_name: "电影解说" },
  { type_id: "36", type_name: "体育" }
];

// 硬编码的子分类映射
const HARDCODED_SUB_CLASS_MAP = new Map([
  ["1", ["7", "6", "8", "9", "10", "11", "12", "20", "34", "45", "47"]],  // 电影片
  ["2", ["13", "14", "15", "16", "21", "22", "23", "24", "46"]],           // 连续剧
  ["3", ["25", "26", "27", "28"]],                                          // 综艺片
  ["4", ["29", "30", "31", "32", "33"]],                                    // 动漫片
  ["35", []],  // 电影解说
  ["36", ["37", "38", "39", "40"]]                                          // 体育
]);

// 硬编码的类型选项
const HARDCODED_TYPE_OPTIONS = {
  "1": [  // 电影片
    { name: "动作片", value: "7" },
    { name: "喜剧片", value: "8" },
    { name: "爱情片", value: "9" },
    { name: "科幻片", value: "10" },
    { name: "恐怖片", value: "11" },
    { name: "剧情片", value: "12" },
    { name: "战争片", value: "6" },
    { name: "记录片", value: "20" },
    { name: "伦理片", value: "34" },
    { name: "预告片", value: "45" },
    { name: "动画电影", value: "47" }
  ],
  "2": [  // 连续剧
    { name: "国产剧", value: "13" },
    { name: "香港剧", value: "14" },
    { name: "韩国剧", value: "15" },
    { name: "欧美剧", value: "16" },
    { name: "台湾剧", value: "21" },
    { name: "日本剧", value: "22" },
    { name: "海外剧", value: "23" },
    { name: "泰国剧", value: "24" },
    { name: "短剧", value: "46" }
  ],
  "3": [  // 综艺片
    { name: "大陆综艺", value: "25" },
    { name: "港台综艺", value: "26" },
    { name: "日韩综艺", value: "27" },
    { name: "欧美综艺", value: "28" }
  ],
  "4": [  // 动漫片
    { name: "国产动漫", value: "29" },
    { name: "日韩动漫", value: "30" },
    { name: "欧美动漫", value: "31" },
    { name: "港台动漫", value: "32" },
    { name: "海外动漫", value: "33" }
  ],
  "35": [],  // 电影解说
  "36": [    // 体育
    { name: "足球", value: "37" },
    { name: "篮球", value: "38" },
    { name: "网球", value: "39" },
    { name: "斯诺克", value: "40" }
  ]
};

const PLAY_URL_PATTERNS = [
  (vodId) => `https://www.ryzyw.com/index.php/vod/play/id/${vodId}.html`,
  (vodId) => `https://cj.rycjapi.com/play/${vodId}.html`
];

// ========== 缓存 ==========
let initialized = false;
let classes = null;
let filters = null;
let subClassMap = null;
const detailCache = new Map();

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
  if (data) OmniBox.log("info", `[如意资源] ${message}: ${JSON.stringify(data)}`);
  else OmniBox.log("info", `[如意资源] ${message}`);
};

const logError = (message, error) => {
  OmniBox.log("error", `[如意资源] ${message}: ${error.message || error}`);
};

const logWarn = (message) => {
  OmniBox.log("warn", `[如意资源] ${message}`);
};

/**
 * 元数据编解码
 */
const encodeMeta = (obj) => {
  try {
    return Buffer.from(JSON.stringify(obj || {}), "utf8").toString("base64");
  } catch {
    return "";
  }
};

const decodeMeta = (str) => {
  try {
    const raw = Buffer.from(str || "", "base64").toString("utf8");
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
};

/**
 * 发送HTTP请求
 */
async function request(url, options = {}) {
  if (url && url.startsWith('http')) {
    try {
      const response = await OmniBox.request(url, {
        method: options.method || "GET",
        headers: options.headers || ruyiConfig.headers,
        timeout: options.timeout || ruyiConfig.timeout,
        body: options.body
      });
      if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
      return JSON.parse(response.body);
    } catch (error) {
      logError(`请求失败: ${url}`, error);
      throw error;
    }
  }
  
  let lastError = null;
  for (let i = 0; i < ruyiConfig.apiUrls.length; i++) {
    const apiUrl = ruyiConfig.apiUrls[i];
    try {
      let requestUrl = apiUrl;
      if (options.params) {
        const params = new URLSearchParams(options.params);
        requestUrl = `${apiUrl}?${params.toString()}`;
      }
      
      const response = await OmniBox.request(requestUrl, {
        method: options.method || "GET",
        headers: options.headers || ruyiConfig.headers,
        timeout: options.timeout || ruyiConfig.timeout,
        body: options.body
      });
      if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`);
      const data = JSON.parse(response.body);
      if (i > 0) logInfo(`切换到备用API: ${apiUrl}`);
      return data;
    } catch (error) {
      lastError = error;
      logWarn(`API ${apiUrl} 请求失败: ${error.message}`);
      continue;
    }
  }
  throw lastError || new Error("所有API都请求失败");
}

/**
 * 获取完整图片 URL
 */
const getPicUrl = (path) => {
  if (!path) return '';
  if (path === '<nil>' || path === 'nil' || path === 'null') return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('/')) return `${ruyiConfig.imgHosts[0]}${path}`;
  return path;
};

/**
 * 格式化视频列表数据
 */
const formatList = (data) => {
  if (!Array.isArray(data)) return [];

  return data.filter(i => i && i.vod_id && String(i.vod_id) !== '0').map(i => ({
    vod_id: String(i.vod_id),
    vod_name: i.vod_name || '未知标题',
    vod_pic: '',
    vod_remarks: i.vod_remarks || (i.vod_year ? `${i.vod_year}` : ''),
    vod_year: i.vod_year || '',
    type_id: String(i.type_id || '')
  }));
};

/**
 * 批量获取视频封面
 */
async function batchGetCovers(videoIds) {
  if (!videoIds || videoIds.length === 0) return new Map();
  
  const resultMap = new Map();
  const uncachedIds = [];
  
  for (const id of videoIds) {
    if (detailCache.has(id)) {
      resultMap.set(id, detailCache.get(id));
    } else {
      uncachedIds.push(id);
    }
  }
  
  if (uncachedIds.length === 0) return resultMap;
  
  for (let i = 0; i < uncachedIds.length; i += ruyiConfig.batchSize) {
    const batch = uncachedIds.slice(i, i + ruyiConfig.batchSize);
    try {
      const res = await request('', { params: { ac: 'videolist', ids: batch.join(',') } });
      
      if (Array.isArray(res.list)) {
        for (const item of res.list) {
          if (!item || typeof item !== 'object') continue;
          const vodId = String(item.vod_id);
          
          let pic = '';
          if (item.vod_pic && item.vod_pic !== '<nil>') pic = getPicUrl(item.vod_pic);
          else if (item.vod_img && item.vod_img !== '<nil>') pic = getPicUrl(item.vod_img);
          else if (item.pic && item.pic !== '<nil>') pic = getPicUrl(item.pic);
          
          detailCache.set(vodId, pic);
          resultMap.set(vodId, pic);
        }
      }
    } catch (error) {
      logError(`批量获取封面失败`, error);
    }
  }
  
  return resultMap;
}

/**
 * 补全视频封面
 */
async function enrichCovers(videos) {
  if (!Array.isArray(videos) || videos.length === 0) return videos;
  
  const needCoverIds = [];
  const videoMap = new Map();
  
  for (const video of videos) {
    if (!video.vod_pic || video.vod_pic === '') {
      needCoverIds.push(video.vod_id);
      videoMap.set(video.vod_id, video);
    }
  }
  
  if (needCoverIds.length === 0) return videos;
  
  const coversMap = await batchGetCovers(needCoverIds);
  
  for (const [vodId, pic] of coversMap) {
    const video = videoMap.get(vodId);
    if (video && pic) {
      video.vod_pic = pic;
    }
  }
  
  return videos;
}

/**
 * 解析播放源
 */
const parsePlaySources = (vodItem) => {
  const playSources = [];
  const vodId = vodItem.vod_id;
  const vodName = vodItem.vod_name;
  const playFrom = vodItem.vod_play_from || '默认线路';
  const playUrl = vodItem.vod_play_url || '';
  
  if (playUrl) {
    const episodes = playUrl.split('#').map((item, index) => {
      const parts = item.split('$');
      const episodeName = parts[0] || `第${index + 1}集`;
      const directUrl = parts[1] || '';
      const fid = `${vodId}#${index}`;
      const playMeta = { sid: vodId, fid: fid, v: vodName, e: index + 1, url: directUrl, isDirect: true };
      return {
        name: episodeName,
        playId: `${directUrl}|||${encodeMeta(playMeta)}`,
        _fid: fid,
        _rawName: episodeName
      };
    }).filter(ep => ep.playId);
    
    if (episodes.length > 0) {
      const sources = playFrom.split(',');
      for (const source of sources) {
        playSources.push({ name: source.trim(), episodes: episodes });
      }
    }
  }
  return playSources;
};

async function getPlayPageUrlSmart(vodId) {
  for (const pattern of PLAY_URL_PATTERNS) {
    try {
      const testUrl = pattern(vodId);
      const headResponse = await OmniBox.request(testUrl, { method: 'HEAD', timeout: 3000 }).catch(() => null);
      if (headResponse && headResponse.statusCode === 200) return testUrl;
    } catch (e) {}
  }
  return `https://www.ryzyw.com/index.php/vod/play/id/${vodId}.html`;
}

/* ============================================================================
 * 辅助函数
 * ============================================================================ */

function preprocessTitle(title) {
  if (!title) return "";
  return title.replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

function chineseToArabic(cn) {
  const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (!isNaN(cn)) return parseInt(cn, 10);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === '十') return 10 + map[cn[1]];
    if (cn[1] === '十') return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
}

function extractEpisode(title) {
  if (!title) return "";
  const processedTitle = preprocessTitle(title).trim();
  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));
  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];
  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];
  return "";
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return "";
  if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;
  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
  }
  return vodName;
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) return originalName;
  if (mapping.episodeName) return mapping.episodeName;
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(ep => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber);
    if (hit?.name) return `${hit.episodeNumber}.${hit.name}`;
  }
  return originalName;
}

function buildScrapedDanmuFileName(scrapeData, scrapeType, mapping, fallbackVodName, fallbackEpisodeName) {
  if (!scrapeData) return buildFileNameForDanmu(fallbackVodName, fallbackEpisodeName);
  if (scrapeType === 'movie') return scrapeData.title || fallbackVodName;
  const title = scrapeData.title || fallbackVodName;
  const seasonAirYear = scrapeData.seasonAirYear || '';
  const seasonNumber = mapping?.seasonNumber || 1;
  const episodeNumber = mapping?.episodeNumber || 1;
  return `${title}.${seasonAirYear}.S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
}

async function matchDanmu(fileName) {
  if (!ruyiConfig.danmuApi || !fileName) return [];
  try {
    const matchUrl = `${ruyiConfig.danmuApi}/api/v2/match`;
    const response = await OmniBox.request(matchUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ruyiConfig.headers['User-Agent'] },
      body: JSON.stringify({ fileName })
    });
    if (response.statusCode !== 200) return [];
    const matchData = JSON.parse(response.body || '{}');
    if (!matchData.isMatched) return [];
    const episodeId = matchData.matches?.[0]?.episodeId;
    if (!episodeId) return [];
    return [{ name: '弹幕', url: `${ruyiConfig.danmuApi}/api/v2/comment/${episodeId}?format=xml` }];
  } catch (error) {
    return [];
  }
}

/* ============================================================================
 * 初始化函数（使用硬编码数据，无API请求）
 * ============================================================================ */

const initialize = () => {
  if (initialized) {
    return { classes, filters, subClassMap };
  }
  
  logInfo('初始化分类数据');
  
  // 使用硬编码的分类数据
  classes = HARDCODED_CLASSES;
  subClassMap = HARDCODED_SUB_CLASS_MAP;
  
  // 构建筛选器
  filters = {};
  for (const cls of classes) {
    const tid = cls.type_id;
    const typeOptions = HARDCODED_TYPE_OPTIONS[tid] || [];
    if (typeOptions.length > 0) {
      filters[tid] = [{ name: '类型', key: 'type', init: typeOptions[0]?.value || '', value: typeOptions }];
    }
  }
  
  initialized = true;
  logInfo(`初始化完成，获取到 ${classes.length} 个主分类`);
  
  return { classes, filters, subClassMap };
};

/* ============================================================================
 * 首页和分类功能
 * ============================================================================ */

const getHomeContent = () => {
  const { classes, filters } = initialize();
  return { class: classes, filters: filters };
};

/**
 * 获取分类视频列表
 */
const getCategoryList = async (tid, pg = 1, extend = {}) => {
  try {
    logInfo('获取分类列表', { tid, pg, extend });
    
    const { subClassMap } = initialize();
    const subClassIds = subClassMap.get(tid) || [];
    
    let targetTypeId = tid;
    
    if (extend.type && extend.type !== '') {
      targetTypeId = extend.type;
    } else if (subClassIds.length > 0) {
      targetTypeId = subClassIds[0];
    }
    
    const params = { ac: 'list', t: targetTypeId, pg: pg, pagesize: 20 };
    const res = await request('', { params });
    
    let list = formatList(res.list || []);
    list = await enrichCovers(list);
    
    logInfo('分类列表获取成功', { count: list.length, page: pg, totalPages: res.pagecount });
    
    return {
      list: list,
      page: parseInt(pg),
      pagecount: res.pagecount || 1,
      limit: 20
    };
  } catch (e) {
    logError('获取分类列表失败', e);
    return { list: [], page: pg, pagecount: pg, limit: 20 };
  }
};

const getRecommendList = async () => {
  try {
    const res = await request('', { params: { ac: 'list', pg: 1, pagesize: 20 } });
    let list = formatList(res.list || []);
    list = await enrichCovers(list);
    logInfo('首页推荐获取成功', { count: list.length });
    return list;
  } catch (e) {
    logError('获取首页推荐失败', e);
    return [];
  }
};

/* ============================================================================
 * 刮削相关函数
 * ============================================================================ */

async function batchGetVideoDetailsForScraping(videoIds) {
  if (!videoIds || videoIds.length === 0) return new Map();
  
  const resultMap = new Map();
  const uncachedIds = [];
  
  for (const id of videoIds) {
    if (detailCache.has(id)) {
      resultMap.set(id, detailCache.get(id));
    } else {
      uncachedIds.push(id);
    }
  }
  
  if (uncachedIds.length === 0) return resultMap;
  
  for (let i = 0; i < uncachedIds.length; i += ruyiConfig.batchSize) {
    const batch = uncachedIds.slice(i, i + ruyiConfig.batchSize);
    try {
      const res = await request('', { params: { ac: 'videolist', ids: batch.join(',') } });
      
      if (Array.isArray(res.list)) {
        for (const item of res.list) {
          if (!item || typeof item !== 'object') continue;
          const vodId = String(item.vod_id);
          
          const detail = {
            vod_pic: getPicUrl(item.vod_pic),
            vod_year: item.vod_year || '',
            vod_area: item.vod_area || '',
            type_name: item.type_name || '',
            type_id: String(item.type_id || ''),
            vod_actor: item.vod_actor || '',
            vod_director: item.vod_director || '',
            vod_content: item.vod_content || ''
          };
          
          detailCache.set(vodId, detail);
          resultMap.set(vodId, detail);
        }
      }
    } catch (error) {
      logError(`批量获取详情失败`, error);
    }
  }
  return resultMap;
}

/* ============================================================================
 * OmniBox 接口实现
 * ============================================================================ */

async function home(params) {
  try {
    const homeData = getHomeContent();
    const recommendList = await getRecommendList();
    return { class: homeData.class, filters: homeData.filters, list: recommendList };
  } catch (error) {
    logError('获取首页数据失败', error);
    return { class: [], filters: {}, list: [] };
  }
}

async function category(params) {
  try {
    const categoryId = params.categoryId;
    const page = params.page || 1;
    const filters = params.filters || {};
    
    if (!categoryId) throw new Error("分类ID不能为空");
    
    const result = await getCategoryList(categoryId, page, filters);
    
    if (page === 1) {
      const { filters: allFilters } = initialize();
      result.filters = allFilters[categoryId] || [];
    }
    
    return result;
  } catch (error) {
    logError('获取分类数据失败', error);
    return { page: 1, pagecount: 0, list: [] };
  }
}

async function search(params) {
  try {
    const keyword = params.keyword || params.wd || "";
    const page = params.page || 1;
    
    if (!keyword) return { page: 1, pagecount: 0, list: [] };
    
    const res = await request('', { params: { ac: 'list', wd: keyword, pg: page, pagesize: 30 } });
    let list = formatList(res.list || []);
    
    const searchKeyword = keyword.trim().toLowerCase();
    list = list.filter(item => (item.vod_name || '').toLowerCase().includes(searchKeyword));
    list = await enrichCovers(list);
    
    return {
      list: list.slice(0, 20),
      page: parseInt(page),
      pagecount: res.pagecount || 1,
      total: res.total || 0
    };
  } catch (error) {
    logError('搜索视频失败', error);
    return { page: 1, pagecount: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = params.videoId;
    if (!videoId) throw new Error("视频ID不能为空");
    
    const res = await request('', { params: { ac: 'videolist', ids: videoId } });
    
    let vod = null;
    if (res.list && res.list.length > 0) {
      const item = res.list[0];
      vod = {
        vod_id: String(item.vod_id || ''),
        vod_name: String(item.vod_name || ''),
        vod_pic: getPicUrl(item.vod_pic),
        type_name: String(item.type_name || ''),
        vod_year: String(item.vod_year || ''),
        vod_area: String(item.vod_area || ''),
        vod_remarks: String(item.vod_remarks || ''),
        vod_actor: String(item.vod_actor || ''),
        vod_director: String(item.vod_director || ''),
        vod_content: String(item.vod_content || '').trim(),
        vod_play_sources: parsePlaySources(item)
      };
    }
    
    if (!vod) return { list: [] };
    
    // 刮削处理
    const sourceCandidates = [];
    const playSources = Array.isArray(vod.vod_play_sources) ? vod.vod_play_sources : [];
    
    for (const source of playSources) {
      for (const ep of source.episodes || []) {
        const meta = ep.playId && ep.playId.includes('|||') ? decodeMeta(ep.playId.split('|||')[1]) : {};
        const fid = ep._fid || meta.fid;
        const rawName = ep._rawName || ep.name || '正片';
        if (!fid) continue;
        sourceCandidates.push({ fid, file_id: fid, file_name: rawName, name: rawName, format_type: 'video' });
      }
    }
    
    if (sourceCandidates.length > 0 && vod.vod_name) {
      try {
        const sourceId = `spider_source_${context.sourceId}_${videoId}`;
        await OmniBox.processScraping(sourceId, vod.vod_name, vod.vod_name, sourceCandidates);
        const metadata = await OmniBox.getScrapeMetadata(sourceId);
        const scrapeData = metadata?.scrapeData || null;
        const videoMappings = metadata?.videoMappings || [];
        
        if (scrapeData) {
          vod.vod_name = scrapeData.title || scrapeData.name || vod.vod_name;
          if (scrapeData.poster_path) vod.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.poster_path}`;
          vod.vod_year = scrapeData.releaseDate ? String(scrapeData.releaseDate).substring(0, 4) : vod.vod_year;
          vod.vod_content = scrapeData.overview || vod.vod_content;
          
          if (scrapeData.credits?.cast) vod.vod_actor = scrapeData.credits.cast.slice(0, 5).map(c => c.name).join(',');
          if (scrapeData.credits?.crew) {
            const directors = scrapeData.credits.crew.filter(c => c.job === 'Director').slice(0, 3).map(c => c.name).join(',');
            if (directors) vod.vod_director = directors;
          }
          
          for (const source of playSources) {
            for (const ep of source.episodes || []) {
              const meta = ep.playId && ep.playId.includes('|||') ? decodeMeta(ep.playId.split('|||')[1]) : {};
              const fid = ep._fid || meta.fid;
              const mapping = videoMappings.find(m => m?.fileId === fid);
              if (!mapping) continue;
              
              const oldName = ep.name;
              const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
              if (newName && newName !== oldName) ep.name = newName;
              ep._seasonNumber = mapping.seasonNumber;
              ep._episodeNumber = mapping.episodeNumber;
            }
            
            const hasEpisodeNumber = (source.episodes || []).some(ep => ep._episodeNumber !== undefined);
            if (hasEpisodeNumber) {
              source.episodes.sort((a, b) => {
                const seasonA = a._seasonNumber || 0;
                const seasonB = b._seasonNumber || 0;
                if (seasonA !== seasonB) return seasonA - seasonB;
                return (a._episodeNumber || 0) - (b._episodeNumber || 0);
              });
            }
            
            source.episodes = source.episodes.map(ep => ({ name: ep.name, playId: ep.playId }));
          }
          
          vod.vod_play_sources = playSources;
        }
      } catch (error) {
        logError("刮削处理失败", error);
      }
    }
    
    return { list: [vod] };
  } catch (error) {
    logError('获取视频详情失败', error);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const rawPlayId = params.playId || '';
    const flag = params.flag || '';
    const vodId = params.vodId || '';
    
    let playUrl = rawPlayId;
    let vodName = '';
    let episodeName = '';
    let isDirectAddress = false;
    
    if (rawPlayId.includes('|||')) {
      const [mainPlayId, metaB64] = rawPlayId.split('|||');
      const meta = decodeMeta(metaB64 || '');
      vodName = meta.v || '';
      episodeName = meta.e || '';
      isDirectAddress = meta.isDirect || false;
      
      if (isDirectAddress) {
        playUrl = mainPlayId;
      } else if (mainPlayId.startsWith('need_resolve:')) {
        const resolveVodId = mainPlayId.split(':')[1] || meta.sid;
        if (resolveVodId) {
          const playPageUrl = await getPlayPageUrlSmart(resolveVodId);
          playUrl = playPageUrl;
        }
      } else {
        playUrl = mainPlayId;
      }
    }
    
    let scrapedDanmuFileName = '';
    try {
      const sourceVideoId = vodId || (rawPlayId.includes('|||') ? (decodeMeta(rawPlayId.split('|||')[1] || '').sid || '') : '');
      if (sourceVideoId) {
        const sourceId = `spider_source_${context.sourceId}_${sourceVideoId}`;
        const metadata = await OmniBox.getScrapeMetadata(sourceId);
        
        if (metadata && metadata.scrapeData) {
          const meta = rawPlayId.includes('|||') ? decodeMeta(rawPlayId.split('|||')[1] || '') : {};
          const mapping = (metadata.videoMappings || []).find(m => m?.fileId === meta.fid);
          
          scrapedDanmuFileName = buildScrapedDanmuFileName(metadata.scrapeData, metadata.scrapeType || '', mapping, vodName, episodeName);
          if (metadata.scrapeData.title) vodName = metadata.scrapeData.title;
          if (mapping?.episodeName) episodeName = mapping.episodeName;
        }
      }
    } catch (error) {}
    
    let resolvedUrl = playUrl;
    let resolvedHeader = {};
    let parse = 1;
    
    const isDirectPlayable = /\.(m3u8|mp4|flv|avi|mkv|ts)(?:\?|#|$)/i.test(playUrl || '');
    
    if (isDirectPlayable || isDirectAddress) {
      parse = 0;
    } else if (/^https?:\/\//i.test(playUrl || '')) {
      try {
        const sniffResult = await OmniBox.sniffVideo(playUrl);
        if (sniffResult && sniffResult.url) {
          resolvedUrl = sniffResult.url;
          resolvedHeader = sniffResult.header || {};
          parse = 0;
        }
      } catch (sniffError) {}
    }
    
    const response = { urls: [{ name: '默认线路', url: resolvedUrl }], flag: flag, header: resolvedHeader, parse: parse };
    
    if (ruyiConfig.danmuApi) {
      let fileName = '';
      if (vodName) fileName = scrapedDanmuFileName || buildFileNameForDanmu(vodName, episodeName);
      if (fileName) {
        const danmakuList = await matchDanmu(fileName);
        if (danmakuList && danmakuList.length > 0) response.danmaku = danmakuList;
      }
    }
    
    return response;
  } catch (error) {
    logError('获取播放地址失败', error);
    return { urls: [], parse: 0, header: {} };
  }
}

module.exports = { home, category, search, detail, play };

const runner = require("spider_runner");
runner.run(module.exports);
