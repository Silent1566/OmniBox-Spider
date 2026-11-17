// @name 荐片APP
// @author 
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @version 1.1.2
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/荐片.js
/**
 * ============================================================================
 * 荐片APP - OmniBox 爬虫脚本
 * ============================================================================
 *
 * 功能说明:
 * - 提供荐片视频APP源的 OmniBox 格式接口
 * - 支持分类浏览、搜索、详情、播放等功能
 * - 集成 Netflix 分类(放在分类列表最后)
 * - 自动屏蔽 FTP/边下边播线路,保留其他线路
 * - 搜索过滤功能,精准匹配搜索结果
 *
 * 主要特性:
 * 1. 分类支持:电影、电视剧、动漫、综艺、短剧、纪录片、Netflix
 * 2. 筛选功能:支持类型、地区、年份、排序等筛选条件
 * 3. 线路过滤:自动过滤包含"FTP"、"边下边播"、"VIP"关键字的线路
 * 4. 图片域名:自动处理图片 URL,支持多域名
 * 5. 搜索过滤:精准匹配结果,删除多余无关条目
 *
 * 日期:2025.02.27
 * ============================================================================
 */

const OmniBox = require("omnibox_sdk");

/**
 * 配置信息
 */
const jpConfig = {
  // 主 API 域名
  host: "https://h5.jianpianips1.com",
  // 图片域名
  imgHost: "https://img.ztfgh.com",
  // 请求头
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Origin': 'https://h5.jianpianips1.com',
    'Referer': 'https://h5.jianpianips1.com/'
  },
  // 超时时间(毫秒)
  timeout: 10000
};

// 播放请求头
const PLAY_HEADERS = {
  'User-Agent': jpConfig.headers['User-Agent'],
  'Referer': jpConfig.host,
  'Origin': jpConfig.host
};

// 弹幕API配置(目前仅预留)
const DANMU_API = process.env.DANMU_API || "";

/**
 * 分类映射表
 */
const categoryMap = {
  '1': '电影',
  '2': '电视剧',
  '3': '动漫',
  '4': '综艺',
  '67': '短剧',
  '50': '纪录片',
  'netflix': 'Netflix'
};

/**
 * 日志工具函数
 */
const logInfo = (message, data = null) => {
  if (data) {
    OmniBox.log("info", `[荐片APP] ${message}: ${JSON.stringify(data)}`);
  } else {
    OmniBox.log("info", `[荐片APP] ${message}`);
  }
};

const logError = (message, error) => {
  OmniBox.log("error", `[荐片APP] ${message}: ${error.message || error}`);
};

const logWarn = (message) => {
  OmniBox.log("warn", `[荐片APP] ${message}`);
};

/**
 * 元数据编解码，用于透传刮削/弹幕信息
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
 * 预处理标题,去掉常见干扰项
 */
function preprocessTitle(title) {
  if (!title) return "";
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, " ")
    .replace(/[hH]\.?26[45]/g, " ")
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, " ")
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, " ");
}

/**
 * 将中文数字转换为阿拉伯数字
 */
function chineseToArabic(cn) {
  const map = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 };
  if (!isNaN(cn)) return parseInt(cn);
  if (cn.length === 1) return map[cn] || cn;
  if (cn.length === 2) {
    if (cn[0] === '十') return 10 + map[cn[1]];
    if (cn[1] === '十') return map[cn[0]] * 10;
  }
  if (cn.length === 3) return map[cn[0]] * 10 + map[cn[2]];
  return cn;
}

/**
 * 从标题中提取集数数字
 */
function extractEpisode(title) {
  if (!title) return "";

  const processedTitle = preprocessTitle(title).trim();

  // 1. 中文格式:第XX集/话
  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));

  // 2. S01E03 格式
  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];

  // 3. EP/E 格式
  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];

  // 4. 括号格式 [03]
  const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    if (!["720", "1080", "480"].includes(num)) return num;
  }

  return "";
}

/**
 * 构建用于弹幕匹配的文件名(后续扩展)
 */
function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return "";

  if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') {
    return vodName;
  }

  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) {
      if (epNum < 10) {
        return `${vodName} S01E0${epNum}`;
      } else {
        return `${vodName} S01E${epNum}`;
      }
    }
  }

  return vodName;
}

function buildScrapedEpisodeName(scrapeData, mapping, originalName) {
  if (!mapping || mapping.episodeNumber === 0 || (mapping.confidence && mapping.confidence < 0.5)) {
    return originalName;
  }
  const prefix = mapping.episodeNumber ? `第${mapping.episodeNumber}集 ` : "";
  if (mapping.episodeName) {
    const epName = `${prefix}${mapping.episodeName}`.trim();
    return epName;
  }
  if (scrapeData && Array.isArray(scrapeData.episodes)) {
    const hit = scrapeData.episodes.find(
      (ep) => ep.episodeNumber === mapping.episodeNumber && ep.seasonNumber === mapping.seasonNumber
    );
    if (hit?.name) {
      return `${prefix}${hit.name}`.trim();
    }
  }
  return originalName;
}

/**
 * 发送HTTP请求
 * @param {string} url - 请求URL
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>} 响应数据
 */
async function request(url, options = {}) {
  try {
    const response = await OmniBox.request(url, {
      method: options.method || "GET",
      headers: options.headers || jpConfig.headers,
      timeout: options.timeout || jpConfig.timeout,
      body: options.body
    });

    if (response.statusCode !== 200) {
      throw new Error(`HTTP ${response.statusCode}: ${response.body}`);
    }

    return JSON.parse(response.body);
  } catch (error) {
    logError(`请求失败: ${url}`, error);
    throw error;
  }
}

/**
 * 获取完整图片 URL
 * @param {string} path - 图片路径
 * @returns {string} 完整图片 URL
 */
const getPicUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  return `${jpConfig.imgHost}${normalizedPath}`;
};

/**
 * 格式化视频列表数据
 * @param {Array} data - 原始数据
 * @returns {Array} 格式化后的列表
 */
const formatList = (data) => {
  if (!Array.isArray(data)) {
    logWarn('formatList 接收到的数据不是数组: ' + typeof data);
    return [];
  }

  return data.filter(i => i.id && String(i.id) !== '0').map(i => {
    const picPath = i.path || i.tvimg || i.tagimg || '';
    return {
      vod_id: String(i.id),
      vod_name: i.title || '未知标题',
      vod_pic: getPicUrl(picPath),
      vod_remarks: i.mask || (i.score ? `评分:${i.score}` : '')
    };
  });
};

/* ============================================================================
 * Netflix 相关功能
 * ============================================================================ */

/**
 * Netflix API 地址映射表
 */
const netflixApiMap = {
  hot_movie: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=70&page=',
  hot_tv: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=73&page=',
  hot_love: 'https://api.zxfmj.com/api/dyTag/tpl2_data?id=74&page=',
  hot_thriller: 'https://api.zxfmj.com/api/dyTag/tpl2_data?id=76&page=',
  hot_action: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=71&page=',
  top_movie: 'https://api.zxfmj.com/api/dyTag/tpl1_data?id=72&page=',
  classic_movie: 'https://api.zxfmj.com/api/special/detail?id=134',
  classic_tv: 'https://api.zxfmj.com/api/special/detail?id=131'
};

/**
 * 获取 Netflix 分类列表
 * @param {string} subType - 子分类类型
 * @param {number} page - 页码
 * @returns {Object} 列表数据
 */
const getNetflixList = async (subType, page = 1) => {
  try {
    logInfo('获取Netflix列表', { subType, page });

    const url = netflixApiMap[subType];
    if (!url) {
      logWarn(`未知的Netflix子类型: ${subType}`);
      return { list: [], page, pagecount: 1, total: 0 };
    }

    let fullUrl = url + page;
    // 经典分类不需要分页参数
    if (subType.startsWith('classic')) fullUrl = url;

    const res = await request(fullUrl);

    let data = res.data || [];
    if (!Array.isArray(data) && data.list) data = data.list;

    const list = data.map(item => ({
      vod_id: (item.id || item._id?.$oid)?.toString() + '@netflix',
      vod_name: item.title,
      vod_pic: getPicUrl(item.tvimg || item.path),
      vod_remarks: (item.mask || '') + (item.score ? ` ⭐${item.score}` : '')
    }));

    logInfo('Netflix列表获取成功', { count: list.length });

    return {
      list,
      page: parseInt(page),
      pagecount: list.length ? parseInt(page) + 1 : parseInt(page),
      limit: list.length,
      total: list.length ? 9999 : 0
    };
  } catch (e) {
    logError('Netflix列表获取失败', e);
    return { list: [], page: parseInt(page), pagecount: 1, limit: 0, total: 0 };
  }
};

/* ============================================================================
 * 首页和分类功能
 * ============================================================================ */

/**
 * 获取首页内容和分类
 * @returns {Object} 分类和筛选数据
 */
const getHomeContent = async () => {
  try {
    logInfo('========== 开始获取首页分类 ==========');

    const res = await request(`${jpConfig.host}/api/v2/settings/homeCategory`);

    if (res.code !== 1) {
      throw new Error(res.msg || '获取分类失败');
    }

    OmniBox.log('info', `[荐片APP] 分类数据: ${JSON.stringify({
      code: res.code,
      dataLength: res.data?.length
    })}`);

    const classes = [];
    const filters = {};

    // 先添加普通分类
    for (const item of res.data) {
      if (item.id === 88 || item.id === 99) continue;

      const tid = String(item.id);
      const tName = categoryMap[tid] || item.name;

      classes.push({ type_id: tid, type_name: tName });

      // 获取该分类的筛选选项
      try {
        OmniBox.log('info', `\n[荐片APP] ===== 获取分类[${tName}(${tid})]筛选选项 =====`);

        const filterUrl = `${jpConfig.host}/api/crumb/filterOptions?fcate_pid=${tid}`;
        OmniBox.log('info', `[荐片APP] 请求URL: ${filterUrl}`);

        const filterRes = await request(filterUrl);

        OmniBox.log('info', `[荐片APP] 响应code: ${filterRes.code}, hasData: ${!!filterRes.data}`);

        if (filterRes.code === 1 && filterRes.data && Array.isArray(filterRes.data)) {
          OmniBox.log('info', `[荐片APP] 筛选数据keys: ${JSON.stringify(filterRes.data.map(f => f.key))}`);

          const fts = [];
          const filterData = filterRes.data;

          // 类型筛选
          const typeFilter = filterData.find(f => f.key === 'type');
          if (typeFilter && typeFilter.data && Array.isArray(typeFilter.data)) {
            const options = typeFilter.data
              .map(t => ({ name: t.name, value: String(t.id) }))  // 改为 name/value
              .filter(t => t.name !== '全部');
            options.unshift({ name: '全部', value: '' });
            fts.push({
              name: '类型',
              key: 'type',
              init: '',  // 添加默认值
              value: options
            });
          }

          // 地区筛选
          const areaFilter = filterData.find(f => f.key === 'area');
          if (areaFilter && areaFilter.data && Array.isArray(areaFilter.data)) {
            const options = areaFilter.data
              .map(a => ({ name: a.name, value: String(a.id) }))  // 改为 name/value
              .filter(a => a.name !== '全部');
            options.unshift({ name: '全部', value: '' });
            fts.push({
              name: '地区',
              key: 'area',
              init: '',  // 添加默认值
              value: options
            });
          }

          // 年份筛选
          const yearFilter = filterData.find(f => f.key === 'year');
          if (yearFilter && yearFilter.data && Array.isArray(yearFilter.data)) {
            const options = yearFilter.data
              .map(y => ({ name: y.name, value: String(y.id) }))  // 改为 name/value
              .filter(y => y.name !== '全部');
            options.unshift({ name: '全部', value: '' });
            fts.push({
              name: '年份',
              key: 'year',
              init: '',  // 添加默认值
              value: options
            });
          }

          // 排序筛选
          const sortFilter = filterData.find(f => f.key === 'sort');
          if (sortFilter && sortFilter.data && Array.isArray(sortFilter.data)) {
            const options = sortFilter.data
              .map(s => ({ name: s.name, value: String(s.id) }))  // 改为 name/value
              .filter(s => s.name !== '全部');
            options.unshift({ name: '默认', value: '' });
            fts.push({
              name: '排序',
              key: 'sort',
              init: '',  // 添加默认值
              value: options
            });
          }

          if (fts.length > 0) {
            filters[tid] = fts;
            OmniBox.log('info', `[荐片APP] ✅ 分类[${tName}]筛选项已添加: ${fts.length}个`);
          }
        }
      } catch (e) {
        OmniBox.log('error', `[荐片APP] ❌ 获取分类[${tName}]筛选失败: ${e.message}`);
      }
    }

    // Netflix 分类
    classes.push({ type_id: 'netflix', type_name: 'Netflix' });
    filters['netflix'] = [{
      key: "cateId",
      name: "Netflix分类",
      value: [
        { n: "热播电影", v: "hot_movie" },
        { n: "热播电视剧", v: "hot_tv" },
        { n: "热播爱情片", v: "hot_love" },
        { n: "热播惊悚片", v: "hot_thriller" },
        { n: "热播动作片", v: "hot_action" },
        { n: "高分电影", v: "top_movie" },
        { n: "经典电影", v: "classic_movie" },
        { n: "经典电视剧", v: "classic_tv" }
      ]
    }];

    OmniBox.log('info', `[荐片APP] ========== 首页获取完成 ==========`);
    OmniBox.log('info', `[荐片APP] 分类数: ${classes.length}, 筛选项数: ${Object.keys(filters).length}`);

    return { class: classes, filters: filters };
  } catch (e) {
    OmniBox.log('error', `[荐片APP] ❌ 获取首页失败: ${e.message}`);
    return { class: [], filters: {} };
  }
};

/**
 * 获取首页数据
 */
async function home(params) {
  try {
    logInfo('处理首页请求');
    const homeData = await getHomeContent();
    const recommendList = await getRecommendList();

    OmniBox.log('info', `[荐片APP] 首页数据: classes=${homeData.class.length}, filters=${Object.keys(homeData.filters).length}, list=${recommendList.length}`);

    return {
      class: homeData.class,
      filters: homeData.filters,
      list: recommendList
    };
  } catch (error) {
    logError('获取首页数据失败', error);
    return {
      class: [],
      filters: {},
      list: []
    };
  }
}


/**
 * 获取分类视频列表
 * @param {string} tid - 分类 ID
 * @param {number} pg - 页码
 * @param {Object} extend - 扩展筛选参数
 * @returns {Object} 视频列表
 */
const getCategoryList = async (tid, pg = 1, extend = {}) => {
  try {
    logInfo('获取分类列表', { tid, pg, extend });

    const params = new URLSearchParams();
    params.append('fcate_pid', tid);
    params.append('page', pg);
    params.append('category_id', extend.type || '');
    params.append('area', extend.area || '');
    params.append('year', extend.year || '');
    params.append('type', '');
    params.append('sort', extend.sort || '');

    const res = await request(`${jpConfig.host}/api/crumb/list?${params.toString()}`);

    if (res.code !== 1) {
      throw new Error(res.msg || '获取列表失败');
    }

    const list = formatList(res.data);
    const hasMore = list.length >= 15;

    if (list.length > 0) {
      logInfo('列表首条数据图片', {
        name: list[0].vod_name,
        pic: list[0].vod_pic.substring(0, 80) + '...'
      });
    }

    logInfo('分类列表获取成功', { count: list.length, page: pg });

    return {
      list: list,
      page: parseInt(pg),
      pagecount: hasMore ? parseInt(pg) + 1 : parseInt(pg),
      limit: 15
    };
  } catch (e) {
    logError('获取分类列表失败', e);
    return { list: [], page: pg, pagecount: pg, limit: 15 };
  }
};

/**
 * 获取首页推荐视频
 * @returns {Array} 推荐视频列表
 */
const getRecommendList = async () => {
  try {
    logInfo('正在获取首页推荐');

    const res = await request(`${jpConfig.host}/api/dyTag/hand_data?category_id=88`);

    if (res.code !== 1 || !res.data) {
      logWarn('获取推荐数据失败或为空');
      return [];
    }

    let list = [];
    for (const key in res.data) {
      if (Array.isArray(res.data[key])) {
        list = list.concat(res.data[key]);
      }
    }

    const formatted = formatList(list);

    if (formatted.length > 0) {
      logInfo('推荐首条数据图片', {
        name: formatted[0].vod_name,
        pic: formatted[0].vod_pic.substring(0, 80) + '...'
      });
    }

    logInfo('首页推荐获取成功', { count: formatted.length });
    return formatted;
  } catch (e) {
    logError('获取首页推荐失败', e);
    return [];
  }
};

/**
 * 搜索视频
 * @param {string} wd - 搜索关键词
 * @param {number} pg - 页码
 * @returns {Object} 搜索结果
 */
const searchVod = async (wd, pg = 1) => {
  try {
    logInfo('执行搜索', { keyword: wd, page: pg });

    const params = new URLSearchParams();
    params.append('keyword', wd);
    params.append('page', pg);

    const res = await request(`${jpConfig.host}/api/v2/search/videoV2?key=${params.toString()}`);

    if (res.code !== 1) {
      logWarn('搜索接口返回错误: ' + res.msg);
      return { list: [], page: pg, pagecount: pg };
    }

    // 原始格式化
    let list = formatList(res.data);

    // =========================
    // 🔍 搜索词二次过滤(核心)
    // =========================
    const keyword = String(wd).trim().toLowerCase();

    list = list.filter(item => {
      const name = (item.vod_name || item.name || item.title || '').toLowerCase();
      return name.includes(keyword);
    });

    const hasMore = list.length >= 15;

    logInfo('搜索完成(已过滤)', {
      keyword: wd,
      count: list.length
    });

    return {
      list,
      page: parseInt(pg),
      pagecount: hasMore ? parseInt(pg) + 1 : parseInt(pg)
    };
  } catch (e) {
    logError('搜索失败', e);
    return { list: [], page: pg, pagecount: pg };
  }
};

/* ============================================================================
 * 详情和播放功能
 * ============================================================================ */

/**
 * 检查线路是否需要屏蔽
 * 屏蔽包含 VIP、FTP、常规 关键字的线路
 * @param {string} sourceName - 线路名称
 * @returns {boolean} 是否屏蔽
 */
const shouldBlockSource = (sourceName) => {
  if (!sourceName) return false;
  const name = sourceName.toLowerCase();
  return name.includes('vip') ||
    name.includes('ftp') ||
    name === '常规线路' ||
    name === '常规';
};

/**
 * 将旧格式的播放源转换为新格式(vod_play_sources)
 * @param {Array} sourceListSource - 原始播放源列表
 * @param {string} vodId - 视频ID
 * @returns {Array} 新格式的播放源列表
 */
function convertToPlaySources(sourceListSource, vodId, vodName = "") {
  const playSources = [];

  if (!sourceListSource || !Array.isArray(sourceListSource)) {
    return playSources;
  }

  for (const source of sourceListSource) {
    // 跳过需要屏蔽的线路
    if (shouldBlockSource(source.name)) {
      logInfo(`屏蔽线路: ${source.name}`);
      continue;
    }

    if (source.source_list && source.source_list.length > 0) {
      const episodes = source.source_list.map((item, index) => {
        const episodeName = item.source_name || `第${index + 1}集`;
        const fid = `${vodId}#${source.name || "线路"}#${index}`;
        const safeUrl = encodeURIComponent(item.url || "");
        const playId = `${safeUrl}|||${encodeMeta({ sid: vodId, fid, v: vodName || "", e: episodeName })}`;
        return {
          name: episodeName,
          playId
        };
      });

      playSources.push({
        name: source.name,
        episodes: episodes
      });
    }
  }

  return playSources;
}

/**
 * 嗅探播放页，兜底提取真实视频地址
 */
const sniffJianpianPlay = async (playUrl) => {
  if (!playUrl) return null;
  try {
    logInfo("尝试嗅探播放页", playUrl);
    const sniffed = await OmniBox.sniffVideo(playUrl);
    if (sniffed && sniffed.url) {
      logInfo("嗅探成功", sniffed.url);
      return {
        urls: [{ name: "嗅探线路", url: sniffed.url }],
        parse: 0,
        header: sniffed.header || { ...PLAY_HEADERS, "Referer": playUrl }
      };
    }
  } catch (error) {
    logInfo(`嗅探失败: ${error.message}`);
  }
  return null;
};

/**
 * 获取视频详情
 * @param {string} ids - 视频 ID(可能包含 @netflix 后缀)
 * @returns {Object} 详情数据
 */
const getDetail = async (ids) => {
  try {
    logInfo('获取详情', { id: ids });

    // 处理 Netflix 类型的详情(移除 @netflix 后缀)
    const realId = ids.replace('@netflix', '');

    const res = await request(`${jpConfig.host}/api/video/detailv2?id=${realId}`);

    if (res.code !== 1 || !res.data) {
      throw new Error(res.msg || '获取详情失败');
    }

    const v = res.data;

    const picPath = v.tvimg || v.thumbnail || v.path || '';
    const fullPicUrl = getPicUrl(picPath);

    logInfo('详情图片处理', {
      original: picPath.substring(0, 50),
      full: fullPicUrl.substring(0, 80)
    });

    // 转换为新格式的播放源
    const vodPlaySources = convertToPlaySources(v.source_list_source, realId, v.title || "");

    // 刮削处理
    let scrapeData = null;
    let videoMappings = [];
    let scrapeType = "";
    const scrapeCandidates = [];
    for (const source of vodPlaySources) {
      for (const ep of source.episodes || []) {
        const metaPart = (ep.playId || "").split('|||')[1] || "";
        const meta = decodeMeta(metaPart);
        const fid = meta?.fid || ep.playId;
        if (!fid) continue;
        scrapeCandidates.push({
          fid,
          file_id: fid,
          file_name: ep.name || "正片",
          name: ep.name || "正片",
          format_type: "video"
        });
      }
    }

    if (scrapeCandidates.length > 0) {
      try {
        const scrapingResult = await OmniBox.processScraping(realId, v.title || "", v.title || "", scrapeCandidates);
        OmniBox.log("info", `[荐片APP] 刮削处理完成,结果: ${JSON.stringify(scrapingResult || {}).substring(0, 200)}`);
        const metadata = await OmniBox.getScrapeMetadata(realId);
        scrapeData = metadata?.scrapeData || null;
        videoMappings = metadata?.videoMappings || [];
        scrapeType = metadata?.scrapeType || "";
      } catch (error) {
        logError("刮削处理失败", error);
      }
    }

    for (const source of vodPlaySources) {
      for (const ep of source.episodes || []) {
        const metaPart = (ep.playId || "").split('|||')[1] || "";
        const meta = decodeMeta(metaPart);
        const fid = meta?.fid;
        if (!fid) continue;
        const mapping = videoMappings.find((m) => m?.fileId === fid);
        if (!mapping) continue;
        const oldName = ep.name;
        const newName = buildScrapedEpisodeName(scrapeData, mapping, oldName);
        if (newName && newName !== oldName) {
          ep.name = newName;
          OmniBox.log("info", `[荐片APP] 应用刮削后源文件名: ${oldName} -> ${newName}`);
        }
        meta.e = ep.name;
        meta.s = mapping.seasonNumber;
        meta.n = mapping.episodeNumber;
        ep.playId = `${(ep.playId || "").split('|||')[0]}|||${encodeMeta(meta)}`;
      }

      const hasEpisodeNumber = (source.episodes || []).some(
        (ep) => {
          const metaPart = (ep.playId || "").split('|||')[1] || "";
          const meta = decodeMeta(metaPart);
          return meta?.n !== undefined && meta?.n !== null;
        }
      );
      if (hasEpisodeNumber) {
        source.episodes.sort((a, b) => {
          const metaA = decodeMeta((a.playId || "").split('|||')[1] || "");
          const metaB = decodeMeta((b.playId || "").split('|||')[1] || "");
          const seasonA = metaA?.s || 0;
          const seasonB = metaB?.s || 0;
          if (seasonA !== seasonB) return seasonA - seasonB;
          const episodeA = metaA?.n || 0;
          const episodeB = metaB?.n || 0;
          return episodeA - episodeB;
        });
      }
    }

    logInfo('详情获取成功', {
      name: v.title,
      pic: fullPicUrl.substring(0, 50) + '...',
      sourcesCount: vodPlaySources.length
    });

    return {
      list: [{
        vod_id: ids,
        vod_name: scrapeData?.title || v.title || '未知标题',
        vod_pic: scrapeData?.posterPath ? `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}` : fullPicUrl,
        vod_content: scrapeData?.overview || v.description || '',
        vod_play_sources: vodPlaySources.length > 0 ? vodPlaySources : undefined,
        vod_remarks: v.mask || (v.score ? `评分:${v.score}` : ''),
        vod_year: v.year || '',
        vod_area: v.area || '',
        vod_actor: v.actors ? v.actors.map(a => a.name).join(' ') : '',
        vod_douban_score: v.score || ''
      }]
    };
  } catch (e) {
    logError('获取详情失败', e);
    return { list: [] };
  }
};

/**
 * 处理播放请求
 * @param {string} playId - 播放地址
 * @returns {Object} 播放信息
 */
const handlePlay = async (playId, vodId = "", context = {}) => {
  try {
    logInfo('处理播放请求', { url: playId.substring(0, 50) + '...' });

    const from = context?.from || "web";
    const isWeb = from === "web";

    let rawPlayId = playId;
    let playMeta = {};
    let vodName = "";
    let episodeName = "";

    // 解析透传参数
    if (rawPlayId && rawPlayId.includes('|||')) {
      const [mainPlayId, metaB64] = rawPlayId.split('|||');
      rawPlayId = mainPlayId;
      playMeta = decodeMeta(metaB64 || "");
      vodName = playMeta.v || "";
      episodeName = playMeta.e || "";
      logInfo(`解析透传信息 - 视频: ${vodName}, 集数: ${episodeName}`);
    }

    try {
      rawPlayId = decodeURIComponent(rawPlayId || "");
    } catch (error) {
      logInfo(`playId 解码失败，按原值继续: ${error.message}`);
    }

    const videoIdForScrape = vodId ? String(vodId).replace('@netflix', '') : (playMeta?.sid ? String(playMeta.sid) : "");

    const playInfoPromise = (async () => {
      const isDirectPlayable = rawPlayId && rawPlayId.match(/\.(m3u8|mp4|flv|avi|mkv|ts)/i);
      if (isDirectPlayable) {
        return {
          urls: [{ name: "直接播放", url: rawPlayId }],
          parse: 0,
          header: isWeb ? {} : PLAY_HEADERS
        };
      }

      const sniffResult = await sniffJianpianPlay(rawPlayId);
      if (sniffResult) {
        if (isWeb) {
          return {
            ...sniffResult,
            header: {}
          };
        }
        return sniffResult;
      }

      return {
        urls: [{ name: "播放", url: rawPlayId }],
        parse: 1,
        header: isWeb ? {} : PLAY_HEADERS
      };
    })();

    const metadataPromise = (async () => {
      const result = {
        danmakuList: [],
        scrapeTitle: "",
        episodeName: episodeName || ""
      };

      if (!videoIdForScrape) {
        logInfo("播放增强链路跳过: videoIdForScrape 为空");
        return result;
      }

      try {
        const metadata = await OmniBox.getScrapeMetadata(videoIdForScrape);
        if (!metadata || !metadata.scrapeData) {
          logInfo(`播放增强链路跳过: metadata 不完整, videoId=${videoIdForScrape}`);
          return result;
        }

        result.scrapeTitle = metadata.scrapeData.title || "";

        const mappings = Array.isArray(metadata.videoMappings) ? metadata.videoMappings : [];
        logInfo(`播放增强链路读取元数据成功: videoId=${videoIdForScrape}, mappings=${mappings.length}, scrapeType=${metadata.scrapeType || "unknown"}`);
        const mapping = mappings.find((m) => m?.fileId === playMeta?.fid);
        if (mapping) {
          if (mapping.episodeName) {
            result.episodeName = buildScrapedEpisodeName(metadata.scrapeData, mapping, result.episodeName || episodeName || "");
          }
        } else if (mappings.length > 0) {
          logInfo(`播放增强链路未命中 mapping: fid=${playMeta?.fid || ""}`);
        }

        vodName = result.scrapeTitle || vodName;
        episodeName = result.episodeName || episodeName;
        const scrapedDanmuFileName = buildFileNameForDanmu(vodName, episodeName);
        if (scrapedDanmuFileName && typeof OmniBox.getDanmakuByFileName === "function") {
          const matchedDanmaku = await OmniBox.getDanmakuByFileName(scrapedDanmuFileName);
          const count = Array.isArray(matchedDanmaku) ? matchedDanmaku.length : 0;
          logInfo(`播放增强链路弹幕匹配结果: fileName=${scrapedDanmuFileName}, count=${count}`);
          if (count > 0) {
            result.danmakuList = matchedDanmaku;
          }
        }
      } catch (error) {
        logInfo(`读取刮削元数据失败: ${error.message}`);
      }

      return result;
    })();

    const [playInfoResult, metadataResult] = await Promise.allSettled([playInfoPromise, metadataPromise]);

    if (playInfoResult.status !== "fulfilled") {
      throw playInfoResult.reason || new Error("播放主链路失败");
    }

    const playResult = playInfoResult.value || { urls: [], parse: 0, header: {} };

    let danmakuList = [];
    if (metadataResult.status === "fulfilled" && metadataResult.value) {
      danmakuList = metadataResult.value.danmakuList || [];
    } else if (metadataResult.status === "rejected") {
      logInfo(`播放增强链路失败(不影响播放): ${metadataResult.reason?.message || metadataResult.reason}`);
    }

    if (danmakuList.length > 0) {
      playResult.danmaku = danmakuList;
    }

    return playResult;
  } catch (e) {
    logError('处理播放失败', e);
    return {
      urls: [],
      parse: 0,
      header: {}
    };
  }
};

/* ============================================================================
 * OmniBox 接口实现
 * ============================================================================ */

/**
 * 获取首页数据
 * @param {Object} params - 参数对象
 * @returns {Object} 返回分类列表和推荐视频列表
 */
async function home(params) {
  try {
    logInfo('处理首页请求');
    const homeData = await getHomeContent();
    const recommendList = await getRecommendList();

    logInfo('首页数据组装完成', {
      classCount: homeData.class.length,
      recommendCount: recommendList.length
    });

    return {
      class: homeData.class,
      filters: homeData.filters,
      list: recommendList
    };
  } catch (error) {
    logError('获取首页数据失败', error);
    return {
      class: [],
      filters: {},
      list: []
    };
  }
}

/**
 * 获取分类数据
 */
async function category(params) {
  try {
    const categoryId = params.categoryId;
    const page = params.page || 1;
    const filters = params.filters || {};

    if (!categoryId) {
      throw new Error("分类ID不能为空");
    }

    logInfo(`获取分类数据: categoryId=${categoryId}, page=${page}`);

    // 处理 Netflix 分类
    if (categoryId === 'netflix') {
      let subType = filters.cateId || 'hot_movie';
      const result = await getNetflixList(subType, page);

      // 只在第一页返回筛选选项
      if (page === 1) {
        result.filters = [
          {
            key: "cateId",
            name: "Netflix分类",
            value: [
              { n: "热播电影", v: "hot_movie" },
              { n: "热播电视剧", v: "hot_tv" },
              { n: "热播爱情片", v: "hot_love" },
              { n: "热播惊悚片", v: "hot_thriller" },
              { n: "热播动作片", v: "hot_action" },
              { n: "高分电影", v: "top_movie" },
              { n: "经典电影", v: "classic_movie" },
              { n: "经典电视剧", v: "classic_tv" }
            ]
          }
        ];
      }

      return result;
    }

    // 处理普通分类
    const result = await getCategoryList(categoryId, page, filters);

    return result;
  } catch (error) {
    logError('获取分类数据失败', error);
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: []
    };
  }
}

/**
 * 获取视频详情
 * @param {Object} params - 参数对象
 *   - videoId: 视频ID(必填)
 * @returns {Object} 返回视频详情
 */
async function detail(params) {
  try {
    const videoId = params.videoId;

    if (!videoId) {
      throw new Error("视频ID不能为空");
    }

    logInfo(`获取视频详情: videoId=${videoId}`);

    return await getDetail(videoId);
  } catch (error) {
    logError('获取视频详情失败', error);
    return {
      list: []
    };
  }
}

/**
 * 搜索视频
 * @param {Object} params - 参数对象
 *   - keyword: 搜索关键词(必填)
 *   - page: 页码(可选,默认1)
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
        list: []
      };
    }

    logInfo(`搜索视频: keyword=${keyword}, page=${page}`);

    return await searchVod(keyword, page);
  } catch (error) {
    logError('搜索视频失败', error);
    return {
      page: 1,
      pagecount: 0,
      total: 0,
      list: []
    };
  }
}

/**
 * 获取播放地址
 * @param {Object} params - 参数对象
 *   - playId: 播放地址ID(必填)
 *   - flag: 播放源标识(可选)
 * @returns {Object} 返回播放地址信息
 */
async function play(params, context) {
  try {
    const playId = params.playId;
    const vodId = params.vodId || "";

    if (!playId) {
      throw new Error("播放地址ID不能为空");
    }

    logInfo(`获取播放地址: playId=${playId}`);

    return await handlePlay(playId, vodId, context);
  } catch (error) {
    logError('获取播放地址失败', error);
    return {
      urls: [],
      parse: 0,
      header: {}
    };
  }
}

// 导出接口
module.exports = {
  home,
  category,
  search,
  detail,
  play
};

// 使用 OmniBox runner
const runner = require("spider_runner");
runner.run(module.exports);
