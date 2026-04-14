// @name girigiri爱动漫
// @author 梦
// @description 刮削：支持，弹幕：支持，嗅探：支持
// @dependencies: axios
// @version 1.1.1
// @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/%E5%8A%A8%E6%BC%AB/girigiri%E7%88%B1%E5%8A%A8%E6%BC%AB.js

/**
 * ============================================================================
 * girigiri爱动漫
 * 站点：https://bgm.girigirilove.com/
 * 分类：日番 / 剧场版
 * 说明：
 * - 详情使用新版 vod_play_sources 数组结构
 * - 播放页 player_aaaa.url 为 base64 + percent-encoded 的直链
 * - 分类/筛选/排序均按站点真实 show 路由拼接
 * ============================================================================
 */
const axios = require('axios');
const https = require('https');
const OmniBox = require('omnibox_sdk');

const HOST = 'https://bgm.girigirilove.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const PAGE_LIMIT = 48;
const DANMU_API = process.env.DANMU_API || '';

const axiosInstance = axios.create({
  timeout: 15000,
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false, family: 4 }),
  headers: {
    'User-Agent': UA,
    'Referer': HOST + '/',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  },
});

const logInfo = (message, data = null) => {
  const output = data ? `${message}: ${JSON.stringify(data)}` : message;
  OmniBox.log('info', `[girigiri爱动漫-DEBUG] ${output}`);
};

const logError = (message, error) => {
  OmniBox.log('error', `[girigiri爱动漫-DEBUG] ${message}: ${error.message || error}`);
};

const encodeMeta = (obj) => {
  try {
    return Buffer.from(JSON.stringify(obj || {}), 'utf8').toString('base64');
  } catch (_) {
    return '';
  }
};

const decodeMeta = (str) => {
  try {
    return JSON.parse(Buffer.from(str || '', 'base64').toString('utf8'));
  } catch (_) {
    return {};
  }
};

function stripTags(html) {
  return (html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickParamValue(...values) {
  for (const value of values) {
    if (value == null) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      const s = String(value).trim();
      if (s) return s;
      continue;
    }
    if (typeof value === 'object') {
      const nested = pickParamValue(
        value.vod_id,
        value.videoId,
        value.play_id,
        value.playId,
        value.categoryId,
        value.type_id,
        value.tid,
        value.id,
        value.url,
        value.href,
        value.path
      );
      if (nested) return nested;
    }
  }
  return '';
}

function absolutize(url) {
  const value = pickParamValue(url);
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  try {
    return new URL(value.startsWith('/') ? value : `/${value}`, HOST).toString();
  } catch (_) {
    return '';
  }
}

function decodePlayerUrl(encoded) {
  try {
    const first = Buffer.from(encoded || '', 'base64').toString('utf8');
    return decodeURIComponent(first);
  } catch (e) {
    logInfo('decodePlayerUrl failed', e.message);
    return encoded || '';
  }
}

function preprocessTitle(title) {
  if (!title) return '';
  return title
    .replace(/4[kK]|[xX]26[45]|720[pP]|1080[pP]|2160[pP]/g, ' ')
    .replace(/[hH]\.?26[45]/g, ' ')
    .replace(/BluRay|WEB-DL|HDR|REMUX/gi, ' ')
    .replace(/\.mp4|\.mkv|\.avi|\.flv/gi, ' ');
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
  if (!title) return '';
  const processedTitle = preprocessTitle(title).trim();
  const cnMatch = processedTitle.match(/第\s*([零一二三四五六七八九十0-9]+)\s*[集话章节回期]/);
  if (cnMatch) return String(chineseToArabic(cnMatch[1]));
  const seMatch = processedTitle.match(/[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})/i);
  if (seMatch) return seMatch[1];
  const epMatch = processedTitle.match(/\b(?:EP|E)[-._\s]*(\d{1,3})\b/i);
  if (epMatch) return epMatch[1];
  const bracketMatch = processedTitle.match(/[\[\(【(](\d{1,3})[\]\)】)]/);
  if (bracketMatch) {
    const num = bracketMatch[1];
    if (!['720', '1080', '480'].includes(num)) return num;
  }
  return '';
}

function buildFileNameForDanmu(vodName, episodeTitle) {
  if (!vodName) return '';
  if (!episodeTitle || episodeTitle === '正片' || episodeTitle === '播放') return vodName;
  const digits = extractEpisode(episodeTitle);
  if (digits) {
    const epNum = parseInt(digits, 10);
    if (epNum > 0) return epNum < 10 ? `${vodName} S01E0${epNum}` : `${vodName} S01E${epNum}`;
  }
  return vodName;
}

async function matchDanmu(fileName) {
  if (!DANMU_API || !fileName) return [];
  try {
    const matchUrl = `${DANMU_API}/api/v2/match`;
    const response = await OmniBox.request(matchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({ fileName }),
    });
    if (response.statusCode !== 200) return [];
    const matchData = JSON.parse(response.body || '{}');
    if (!matchData.isMatched) return [];
    const firstMatch = (matchData.matches || [])[0];
    if (!firstMatch?.episodeId) return [];
    const danmakuURL = `${DANMU_API}/api/v2/comment/${firstMatch.episodeId}?format=xml`;
    const danmakuName = [firstMatch.animeTitle, firstMatch.episodeTitle].filter(Boolean).join(' - ') || '弹幕';
    return [{ name: danmakuName, url: danmakuURL }];
  } catch (_) {
    return [];
  }
}

function extractCards(html) {
  const results = [];
  const blocks = html.match(/<div class="public-list-box public-pic-b">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/g) || [];
  for (const block of blocks) {
    const href = (block.match(/class="public-list-exp"[^>]*href="([^"]+)"/) || [])[1] || '';
    const title = (block.match(/class="public-list-exp"[^>]*title="([^"]+)"/) || [])[1]
      || (block.match(/class="time-title[^"]*"[^>]*title="([^"]+)"/) || [])[1]
      || '';
    const pic = (block.match(/data-src="([^"]+)"/) || [])[1]
      || (block.match(/src="([^"]+)"/) || [])[1]
      || '';
    const remarks = (block.match(/<span class="public-list-prb[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '';
    if (!href || !title) continue;
    results.push({
      vod_id: href,
      vod_name: stripTags(title),
      vod_pic: absolutize(pic),
      vod_remarks: stripTags(remarks),
    });
  }
  return results;
}

function dedupeByVodId(list) {
  const seen = new Set();
  const result = [];
  for (const item of list || []) {
    const key = item?.vod_id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function withPage(path, page) {
  if (page <= 1) return HOST + path;
  return HOST + path.replace(/\/$/, `--------${page}---/`);
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildCategoryCandidates(tid, page, extend = {}) {
  const classId = tid || '2';
  const by = extend.by || '';
  const className = extend.class || '';
  const month = extend.month || extend.area || '';
  const year = extend.year || '';
  const version = extend.version || '';
  const state = extend.state || '';
  const lang = extend.lang || '';

  const hasFilter = !!(by || className || month || year || version || state || lang);
  const candidates = [];

  if (className && by) candidates.push(`/show/${classId}--${encodeURIComponent(by)}-${encodeURIComponent(className)}--------/`);
  if (className && state && by) candidates.push(`/show/${classId}--${encodeURIComponent(by)}-${encodeURIComponent(className)}------${encodeURIComponent(state)}--/`);
  if (className && state) candidates.push(`/show/${classId}---${encodeURIComponent(className)}------${encodeURIComponent(state)}--/`);
  if (className && version) candidates.push(`/show/${classId}---${encodeURIComponent(className)}--------/version/${encodeURIComponent(version)}/`);
  if (month && version) candidates.push(`/show/${classId}-${encodeURIComponent(month)}----------/version/${encodeURIComponent(version)}/`);
  if (year && version) candidates.push(`/show/${classId}-----------${encodeURIComponent(year)}/version/${encodeURIComponent(version)}/`);
  if (lang && version) candidates.push(`/show/${classId}----${encodeURIComponent(lang)}-------/version/${encodeURIComponent(version)}/`);

  if (version) candidates.push(`/show/${classId}-----------/version/${encodeURIComponent(version)}/`);
  if (state) candidates.push(`/show/${classId}---------${encodeURIComponent(state)}--/`);
  if (className) candidates.push(`/show/${classId}---${encodeURIComponent(className)}--------/`);
  if (month) candidates.push(`/show/${classId}-${encodeURIComponent(month)}----------/`);
  if (year) candidates.push(`/show/${classId}-----------${encodeURIComponent(year)}/`);
  if (lang) candidates.push(`/show/${classId}----${encodeURIComponent(lang)}-------/`);
  if (by) candidates.push(`/show/${classId}--${encodeURIComponent(by)}---------/`);
  if (!hasFilter) candidates.push(`/show/${classId}-----------/`);

  return uniqueList(candidates).map((path) => withPage(path, page));
}

function parseCategoryLinks(html, tidPrefix) {
  const map = new Map();
  const reg = /<a[^>]+href="(\/show\/[^\"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = reg.exec(html)) !== null) {
    const href = m[1];
    const name = stripTags(m[2]);
    if (!href.startsWith(`/show/${tidPrefix}`)) continue;
    if (!name || ['首页', '更多'].includes(name)) continue;
    if (!map.has(name)) map.set(name, href);
  }
  return Array.from(map.entries()).map(([name, href]) => ({ name, href }));
}

function buildFiltersFromLinks(links, tid) {
  const filters = [{
    key: 'by',
    name: '排序',
    value: [
      { name: '按最新', value: 'time' },
      { name: '按最热', value: 'hits' },
      { name: '按评分', value: 'score' },
    ],
  }];

  const classValues = [];
  const monthValues = [];
  const yearValues = [];
  const versionValues = [];
  const stateValues = [];
  const langValues = [];

  for (const item of links || []) {
    const href = item.href || '';
    const name = item.name || '';
    if (!name) continue;
    if (new RegExp(`^/show/${tid}---`).test(href)) classValues.push({ name, value: name });
    else if (href.includes('/version/')) versionValues.push({ name, value: name });
    else if (new RegExp(`^/show/${tid}----`).test(href) && !new RegExp(`^/show/${tid}-----`).test(href)) langValues.push({ name, value: name });
    else if (new RegExp(`^/show/${tid}---------`).test(href)) stateValues.push({ name, value: name });
    else if (new RegExp(`^/show/${tid}-`).test(href) && !new RegExp(`^/show/${tid}--`).test(href)) monthValues.push({ name, value: name });
    else if (new RegExp(`^/show/${tid}-----------\\d{4}/`).test(href)) yearValues.push({ name, value: name });
  }

  if (classValues.length) filters.push({ key: 'class', name: '类型', value: classValues.slice(0, 30) });
  if (monthValues.length) filters.push({ key: 'month', name: '季度', value: monthValues.slice(0, 12) });
  if (yearValues.length) filters.push({ key: 'year', name: '年份', value: yearValues.slice(0, 20) });
  if (versionValues.length) filters.push({ key: 'version', name: '原作', value: versionValues.slice(0, 20) });
  if (langValues.length) filters.push({ key: 'lang', name: '语言', value: langValues.slice(0, 20) });
  if (stateValues.length) filters.push({ key: 'state', name: '资源', value: stateValues.slice(0, 20) });
  return filters;
}

function parseHomeSection(html, title) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<h4 class="title-h cor4">${escapedTitle}</h4>[\\s\\S]*?<div class="flex wrap border-box public-r(?: hide-b-2)? diy-center1 mask2">([\\s\\S]*?)</div></div></div>`));
  if (!match) return [];
  return extractCards(match[1]);
}

function parseHomeSlides(html) {
  const list = [];
  const reg = /<div class="slide-time-bj swiper-slide"><a href="([^"]+)">[\s\S]*?data-background="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>[\s\S]*?<h3 class="slide-info-title hide">([^<]+)<\/h3>[\s\S]*?<div class="slide-info hide2">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = reg.exec(html)) !== null) {
    list.push({
      vod_id: m[1],
      vod_name: stripTags(m[4]),
      vod_pic: absolutize(m[2]),
      vod_remarks: stripTags(m[3]),
      vod_content: stripTags(m[5]),
    });
  }
  return list;
}

async function home() {
  try {
    const classes = [
      { type_id: '2', type_name: '日番' },
      { type_id: '21', type_name: '剧场版' },
    ];

    const [{ data: homeHtml }, { data: animeHtml }, { data: movieHtml }] = await Promise.all([
      axiosInstance.get(HOST + '/'),
      axiosInstance.get(HOST + '/show/2-----------/'),
      axiosInstance.get(HOST + '/show/21-----------/'),
    ]);

    const filters = {
      '2': buildFiltersFromLinks(parseCategoryLinks(animeHtml, '2').filter((item) => item.name !== '日番'), '2'),
      '21': buildFiltersFromLinks(parseCategoryLinks(movieHtml, '21').filter((item) => item.name !== '劇場版' && item.name !== '剧场版'), '21'),
    };

    const list = dedupeByVodId([
      ...parseHomeSlides(homeHtml),
      ...parseHomeSection(homeHtml, '最近大家在看'),
      ...parseHomeSection(homeHtml, '或许你感兴趣？'),
      ...parseHomeSection(homeHtml, '日番'),
      ...parseHomeSection(homeHtml, '剧场版'),
    ]).slice(0, 40);

    logInfo('home ok', { classes: classes.length, list: list.length });
    return { class: classes, filters, list };
  } catch (e) {
    logError('home failed', e);
    return {
      class: [
        { type_id: '2', type_name: '日番' },
        { type_id: '21', type_name: '剧场版' },
      ],
      filters: {},
      list: [],
    };
  }
}

async function category(params) {
  const tid = pickParamValue(params.tid, params.type_id, params.categoryId, params.id) || '2';
  const page = Number(params.page || params.pg || 1);
  const extend = {
    ...(params.extend || {}),
    ...(params.filters || {}),
  };
  const candidates = buildCategoryCandidates(tid, page, extend);
  logInfo('category request', { tid, page, extend, candidates });

  try {
    let html = '';
    let hitUrl = '';
    let list = [];

    for (const candidate of candidates) {
      try {
        const resp = await axiosInstance.get(candidate);
        const currentHtml = resp.data || '';
        const currentList = extractCards(currentHtml);
        if (currentList.length > 0) {
          html = currentHtml;
          hitUrl = candidate;
          list = currentList;
          break;
        }
      } catch (_) {}
    }

    if (!list.length) {
      logInfo('category no-hit', { tid, page, extend, candidates });
      return { list: [], page, pagecount: page, limit: PAGE_LIMIT, total: 0 };
    }

    const nextPatterns = [
      `${page + 1}&nbsp;/&nbsp;`,
      `--------${page + 1}---/`,
      `------${page + 1}---/`,
    ];
    const hasNext = nextPatterns.some((p) => html.includes(p));
    logInfo('category hit', { hitUrl, count: list.length });
    return {
      list,
      page,
      pagecount: hasNext ? page + 1 : page,
      limit: PAGE_LIMIT,
      total: page * PAGE_LIMIT + (hasNext ? PAGE_LIMIT : list.length),
    };
  } catch (e) {
    logError('category failed', e);
    return { list: [], page, pagecount: page, limit: PAGE_LIMIT, total: 0 };
  }
}

async function search(params) {
  const wd = String(params.wd || '').trim();
  if (!wd) return { list: [] };
  try {
    const url = `${HOST}/index.php/ajax/suggest?mid=1&wd=${encodeURIComponent(wd)}`;
    logInfo('search request', { wd, url });
    const { data } = await axiosInstance.get(url, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${HOST}/search/-------------/`,
      },
    });
    return {
      list: (data?.list || []).map((item) => ({
        vod_id: `/GV${item.id}/`,
        vod_name: item.name || '',
        vod_pic: absolutize(item.pic || ''),
        vod_remarks: '',
      })),
    };
  } catch (e) {
    logError('search failed', e);
    return { list: [] };
  }
}

async function detail(params) {
  const vodId = pickParamValue(params.vod_id, params.videoId, params.id, params);
  const url = absolutize(vodId);
  logInfo('detail request', { vodId, url, rawKeys: Object.keys(params || {}) });
  if (!url) return { list: [] };

  try {
    const { data: html } = await axiosInstance.get(url);
    const title = stripTags((html.match(/<title>(.*?)<\//i) || [])[1] || '').replace(/_.*$/, '');
    const pic = absolutize((html.match(/<img[^>]+data-src="([^"]+\.webp)"/) || [])[1] || '');
    const content = stripTags((html.match(/<div id="height_limit" class="text cor3">([\s\S]*?)<\/div>/) || [])[1] || '');
    const remarks = stripTags((html.match(/<p>([^<]*?(?:更新|點|支持杜比)[^<]*?)<\/p>/) || [])[1] || '');
    const year = ((html.match(/20\d{2}/) || [])[0] || '');

    const playTabs = [];
    const tabReg = /<a class="swiper-slide"[^>]*>[\s\S]*?&nbsp;([^<]+)<span class="badge">(\d+)<\/span><\/a>/g;
    let tabMatch;
    while ((tabMatch = tabReg.exec(html)) !== null) {
      playTabs.push({ name: stripTags(tabMatch[1]), count: Number(tabMatch[2] || 0) });
    }

    const vodPlaySources = [];
    const anthologyMatch = html.match(/<div class="anthology wow[\s\S]*?<script>\$\("\.anthology-tab a"\)\.eq\(0\)/);
    const anthologyHtml = anthologyMatch ? anthologyMatch[0] : '';
    const playLists = [];
    const boxReg = /<div class="anthology-list-box[^>]*>([\s\S]*?)<\/div><\/div>/g;
    let boxMatch;
    while ((boxMatch = boxReg.exec(anthologyHtml)) !== null) {
      const episodes = [];
      const epReg = /href="([^"]*\/play[^\"]+)"[^>]*>([^<]+)<\/a>/g;
      let epMatch;
      while ((epMatch = epReg.exec(boxMatch[1])) !== null) {
        const epName = stripTags(epMatch[2]);
        const playUrl = epMatch[1];
        if (!playUrl.includes('/play')) continue;
        episodes.push({
          name: epName,
          playId: encodeMeta({ playUrl, epName, vodName: title, referer: vodId }),
        });
      }
      if (episodes.length) playLists.push(episodes);
    }

    for (let i = 0; i < playLists.length; i += 1) {
      vodPlaySources.push({ name: playTabs[i]?.name || `线路${i + 1}`, episodes: playLists[i] });
    }

    if (!vodPlaySources.length) {
      const episodes = [];
      const epReg = /href="([^"]*\/play[^\"]+)"[^>]*>([^<]+)<\/a>/g;
      let epMatch;
      while ((epMatch = epReg.exec(anthologyHtml || html)) !== null) {
        const playUrl = epMatch[1];
        if (!playUrl.includes('/play')) continue;
        const epName = stripTags(epMatch[2]);
        episodes.push({
          name: epName,
          playId: encodeMeta({ playUrl, epName, vodName: title, referer: vodId }),
        });
      }
      if (episodes.length) vodPlaySources.push({ name: playTabs[0]?.name || '默认', episodes });
    }

    return {
      list: [{
        vod_id: vodId,
        vod_name: title,
        vod_pic: pic,
        vod_remarks: remarks,
        vod_content: content,
        vod_director: '',
        vod_actor: '',
        vod_year: year,
        vod_play_sources: vodPlaySources,
      }],
    };
  } catch (e) {
    logError('detail failed', e);
    return { list: [] };
  }
}

async function play(params) {
  const rawPlayId = pickParamValue(params.play_id, params.playId, params.id, params);
  const meta = decodeMeta(rawPlayId);
  const playPath = meta.playUrl || rawPlayId || '';
  const episodeName = meta.epName || '默认';
  const vodName = meta.vodName || '';
  const referer = absolutize(meta.referer || '/');
  const url = absolutize(playPath);
  logInfo('play request', { playPath, url, referer, episodeName });

  try {
    const { data: html } = await axiosInstance.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': referer || HOST + '/',
        'Origin': HOST,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const playerMatch = html.match(/var\s+player_aaaa\s*=\s*(\{[\s\S]*?\})<\/script>/);
    if (!playerMatch) throw new Error('player_aaaa not found');

    const player = JSON.parse(playerMatch[1]);
    let playUrl = player.url || '';
    if (player.encrypt === 2) playUrl = decodePlayerUrl(playUrl);
    else if (player.encrypt === 1) playUrl = decodeURIComponent(playUrl);

    let parse = 0;
    let finalUrl = playUrl;
    const from = player.from || '';
    if (from && from !== 'no' && from !== 'iframe' && from !== 'link') parse = 1;
    if (!/^https?:\/\//i.test(finalUrl)) finalUrl = absolutize(finalUrl);

    const response = {
      urls: [{ name: '默认线路', url: finalUrl }],
      parse,
      header: {
        'User-Agent': UA,
        'Referer': referer || HOST + '/',
        'Origin': HOST,
      },
    };

    if (DANMU_API && vodName) {
      const fileName = buildFileNameForDanmu(vodName, episodeName);
      if (fileName) {
        const danmakuList = await matchDanmu(fileName);
        if (danmakuList.length) response.danmaku = danmakuList;
      }
    }
    return response;
  } catch (e) {
    logError('play failed', e);
    return {
      urls: [{ name: '默认线路', url }],
      parse: 0,
      header: {
        'User-Agent': UA,
        'Referer': referer || HOST + '/',
        'Origin': HOST,
      },
    };
  }
}

module.exports = { home, category, search, detail, play };

const runner = require('spider_runner');
runner.run(module.exports);
