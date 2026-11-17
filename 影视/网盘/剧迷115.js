// @name 剧迷115
// @author 梦
// @description 影视站：gimy115.top，支持首页、分类、搜索、详情与网盘线路提取；支持刮削、弹幕、播放记录；Cookie 支持环境变量配置
// @version 1.2.2
// @dependencies cheerio

const OmniBox = require("omnibox_sdk");
const runner = require("spider_runner");
const cheerio = require("cheerio");

const BASE_URL = process.env.GIMY115_HOST || "https://www.gimy115.top";
const SITE_COOKIE = String(process.env.GIMY115_COOKIE || "").trim();
const UA = process.env.GIMY115_UA || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";

module.exports = { home, category, detail, search, play };
runner.run(module.exports);

function getHeaders(referer = `${BASE_URL}/`, extra = {}) {
  return {
    "User-Agent": UA,
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    Referer: referer,
    ...(SITE_COOKIE ? { Cookie: SITE_COOKIE } : {}),
    ...extra,
  };
}

function getBodyText(res) {
  const body = res && typeof res === "object" && "body" in res ? res.body : res;
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return body.toString();
  return String(body || "");
}

async function requestText(url, options = {}) {
  const method = options.method || "GET";
  await OmniBox.log("info", `[Gimy115][request] ${method} ${url}`);
  const res = await OmniBox.request(url, {
    method,
    headers: getHeaders(options.referer || `${BASE_URL}/`, options.headers || {}),
    body: options.body,
    timeout: options.timeout || 20000,
  });
  const statusCode = Number(res?.statusCode || 0);
  const text = getBodyText(res);
  if (statusCode !== 200) {
    throw new Error(`HTTP ${statusCode} @ ${url}`);
  }
  return text;
}

function absUrl(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("/")) return `${BASE_URL}${value}`;
  return `${BASE_URL}/${value.replace(/^\.\//, "")}`;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return normalizeText(String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"'));
}

function buildClassAndFilters() {
  return {
    class: [
      { type_id: "1", type_name: "电影" },
      { type_id: "2", type_name: "电视剧" },
      { type_id: "25", type_name: "Remux电影" },
      { type_id: "26", type_name: "蓝光原盘" },
    ],
    filters: {
      "1": [
        { key: "class", name: "类型", init: "", value: [
          { name: "全部", value: "" },
          { name: "古装", value: "古装" },
          { name: "战争", value: "战争" },
          { name: "青春偶像", value: "青春偶像" },
          { name: "喜剧", value: "喜剧" },
          { name: "家庭", value: "家庭" },
          { name: "犯罪", value: "犯罪" },
          { name: "动作", value: "动作" },
          { name: "奇幻", value: "奇幻" },
          { name: "剧情", value: "剧情" },
          { name: "历史", value: "历史" },
        ] },
        { key: "area", name: "地区", init: "", value: [
          { name: "全部", value: "" },
          { name: "内地", value: "内地" },
          { name: "韩国", value: "韩国" },
          { name: "香港", value: "香港" },
          { name: "台湾", value: "台湾" },
        ] },
        { key: "year", name: "年份", init: "", value: [
          { name: "全部", value: "" },
          { name: "2026", value: "2026" },
          { name: "2025", value: "2025" },
          { name: "2024", value: "2024" },
          { name: "2023", value: "2023" },
        ] },
        { key: "by", name: "排序", init: "time", value: [
          { name: "最新", value: "time" },
          { name: "人气", value: "hits" },
          { name: "评分", value: "score" },
        ] },
      ],
      "2": [
        { key: "subType", name: "片库", init: "2", value: [
          { name: "全部类型", value: "2" },
          { name: "国产剧", value: "13" },
          { name: "日剧", value: "15" },
          { name: "韩剧", value: "31" },
          { name: "泰剧", value: "32" },
          { name: "印度剧", value: "33" },
          { name: "欧美剧", value: "16" },
          { name: "综艺", value: "23" },
          { name: "纪录片", value: "24" },
          { name: "儿童", value: "35" },
          { name: "国漫", value: "27" },
          { name: "日漫", value: "29" },
          { name: "韩漫", value: "36" },
          { name: "欧美动漫", value: "28" },
          { name: "其他动漫", value: "37" },
          { name: "综合", value: "34" },
        ] },
        { key: "class", name: "剧情", init: "", value: [
          { name: "全部剧情", value: "" },
          { name: "古装", value: "古装" },
          { name: "战争", value: "战争" },
          { name: "青春偶像", value: "青春偶像" },
          { name: "喜剧", value: "喜剧" },
          { name: "家庭", value: "家庭" },
          { name: "犯罪", value: "犯罪" },
          { name: "动作", value: "动作" },
          { name: "奇幻", value: "奇幻" },
          { name: "剧情", value: "剧情" },
          { name: "历史", value: "历史" },
          { name: "经典", value: "经典" },
          { name: "乡村", value: "乡村" },
          { name: "情景", value: "情景" },
          { name: "商战", value: "商战" },
          { name: "网剧", value: "网剧" },
          { name: "其他", value: "其他" },
        ] },
        { key: "area", name: "地区", init: "", value: [
          { name: "全部地区", value: "" },
          { name: "内地", value: "内地" },
          { name: "韩国", value: "韩国" },
          { name: "香港", value: "香港" },
          { name: "台湾", value: "台湾" },
          { name: "日本", value: "日本" },
          { name: "美国", value: "美国" },
          { name: "泰国", value: "泰国" },
          { name: "英国", value: "英国" },
          { name: "新加坡", value: "新加坡" },
          { name: "其他", value: "其他" },
        ] },
        { key: "lang", name: "语言", init: "", value: [
          { name: "全部语言", value: "" },
          { name: "国语", value: "国语" },
          { name: "英语", value: "英语" },
          { name: "粤语", value: "粤语" },
          { name: "闽南语", value: "闽南语" },
          { name: "韩语", value: "韩语" },
          { name: "日语", value: "日语" },
          { name: "其它", value: "其它" },
        ] },
        { key: "year", name: "年份", init: "", value: [
          { name: "全部时间", value: "" },
          { name: "2026", value: "2026" },
          { name: "2025", value: "2025" },
          { name: "2024", value: "2024" },
          { name: "2023", value: "2023" },
          { name: "2022", value: "2022" },
          { name: "2021", value: "2021" },
          { name: "2020", value: "2020" },
          { name: "2019", value: "2019" },
        ] },
        { key: "letter", name: "字母", init: "", value: [
          { name: "全部", value: "" },
          { name: "A", value: "A" },
          { name: "B", value: "B" },
          { name: "C", value: "C" },
          { name: "D", value: "D" },
          { name: "E", value: "E" },
          { name: "F", value: "F" },
          { name: "G", value: "G" },
          { name: "H", value: "H" },
          { name: "I", value: "I" },
          { name: "J", value: "J" },
          { name: "K", value: "K" },
          { name: "L", value: "L" },
          { name: "M", value: "M" },
          { name: "N", value: "N" },
          { name: "O", value: "O" },
          { name: "P", value: "P" },
          { name: "Q", value: "Q" },
          { name: "R", value: "R" },
          { name: "S", value: "S" },
          { name: "T", value: "T" },
          { name: "U", value: "U" },
          { name: "V", value: "V" },
          { name: "W", value: "W" },
          { name: "X", value: "X" },
          { name: "Y", value: "Y" },
          { name: "Z", value: "Z" },
          { name: "0-9", value: "0-9" },
        ] },
        { key: "by", name: "排序", init: "time", value: [
          { name: "时间排序", value: "time" },
          { name: "人气排序", value: "hits" },
          { name: "评分排序", value: "score" },
        ] },
      ],
      "25": [
        { key: "by", name: "排序", init: "time", value: [
          { name: "最新", value: "time" },
          { name: "人气", value: "hits" },
          { name: "评分", value: "score" },
        ] },
        { key: "year", name: "年份", init: "", value: [
          { name: "全部", value: "" },
          { name: "2026", value: "2026" },
          { name: "2025", value: "2025" },
          { name: "2024", value: "2024" },
          { name: "2023", value: "2023" },
        ] },
      ],
      "26": [
        { key: "by", name: "排序", init: "time", value: [
          { name: "最新", value: "time" },
          { name: "人气", value: "hits" },
          { name: "评分", value: "score" },
        ] },
        { key: "year", name: "年份", init: "", value: [
          { name: "全部", value: "" },
          { name: "2026", value: "2026" },
          { name: "2025", value: "2025" },
          { name: "2024", value: "2024" },
          { name: "2023", value: "2023" },
        ] },
      ],
    },
  };
}

function extractCards($, scope) {
  const list = [];
  const seen = new Set();
  const $scope = scope && scope.length ? scope : $.root();

  $scope.find("a[href*='/index.php/vod/down/id/']").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    if (!/\/index\.php\/vod\/down\/id\/\d+\/sid\/\d+\/nid\/\d+\.html/i.test(href)) return;

    const $item = $el.closest(".module-item, .module-search-item, .module-item-cover, li, .item");
    const vod_id = absUrl(href);
    if (!vod_id || seen.has(vod_id)) return;

    const vod_name = decodeHtml(
      $el.attr("title") ||
      $el.find("img").attr("alt") ||
      $item.find(".module-item-title, .video-name a, .module-card-item-title, h3, h4, h5").first().text() ||
      $el.text()
    );
    if (!vod_name) return;

    const vod_pic = absUrl(
      $item.find("img").attr("data-src") ||
      $item.find("img").attr("data-original") ||
      $item.find("img").attr("src") ||
      ""
    );

    const captionParts = $item.find(".module-item-caption span").map((_, span) => decodeHtml($(span).text())).get().filter(Boolean);
    let vod_remarks = captionParts.join(" / ");
    if (!vod_remarks) {
      vod_remarks = decodeHtml($item.find(".module-item-note, .module-item-text, .module-info-item-content").first().text());
    }

    seen.add(vod_id);
    list.push({ vod_id, vod_name, vod_pic, vod_remarks });
  });

  return list;
}

function isPermissionDenied(html) {
  return /您没有权限访问此数据，请升级会员|系统提示/i.test(String(html || ""));
}

function extractPermissionMessage(html) {
  const text = String(html || "");
  const m = text.match(/<div class="text">([\s\S]*?)<\/div>/i);
  return decodeHtml(m ? m[1] : "当前页面需要更高权限或有效 Cookie");
}

function pickInfoByTitle($, title) {
  const wanted = String(title || "").trim();
  let result = "";
  $(".video-info-items").each((_, el) => {
    const itemTitle = decodeHtml($(el).find(".video-info-itemtitle").first().text()).replace(/[：:]/g, "").trim();
    if (itemTitle !== wanted) return;
    result = decodeHtml($(el).find(".video-info-item").first().text());
  });
  return result;
}

function pickActors($, title) {
  const wanted = String(title || "").trim();
  let result = "";
  $(".video-info-items").each((_, el) => {
    const itemTitle = decodeHtml($(el).find(".video-info-itemtitle").first().text()).replace(/[：:]/g, "").trim();
    if (itemTitle !== wanted) return;
    result = $(el).find(".video-info-item a").map((_, a) => decodeHtml($(a).text())).get().filter(Boolean).join(" / ");
  });
  return result;
}

function extractDetailMeta($, fallbackUrl = "") {
  const titleText = decodeHtml($("title").text());
  const vod_name = decodeHtml(
    $(".page-title, .video-info-header h1, h1").first().text() ||
    titleText.replace(/^《|》.*$/g, "")
  );
  const vod_pic = absUrl(
    $("meta[property='og:image']").attr("content") ||
    $(".video-cover img").attr("data-src") ||
    $(".video-cover img").attr("src") ||
    $(".mobile-play img").attr("data-src") ||
    $(".mobile-play img").attr("src") ||
    $("img[alt]").first().attr("data-src") ||
    $("img[alt]").first().attr("src") ||
    ""
  );
  const vod_content = pickInfoByTitle($, "剧情") || decodeHtml($("meta[name='description']").attr("content") || "");
  const vod_director = pickActors($, "导演");
  const vod_actor = pickActors($, "主演");
  const vod_year = pickInfoByTitle($, "上映").slice(0, 4);
  const vod_remarks = pickInfoByTitle($, "备注") || pickInfoByTitle($, "更新");
  const vod_area = decodeHtml($("a[href*='/show/area/']").map((_, a) => $(a).text()).get().filter(Boolean).join(" / "));
  const type_name = decodeHtml($("a[href*='/vod/type/id/'], a[href*='/vod/show/id/']").first().text());
  return {
    vod_id: fallbackUrl,
    vod_name,
    vod_pic,
    vod_content,
    vod_director,
    vod_actor,
    vod_year,
    vod_remarks,
    vod_area,
    type_name,
  };
}

function extractRealDetailUrl(html) {
  const m = String(html || "").match(/\/index\.php\/vod\/detail\/id\/\d+\.html/i);
  return m ? absUrl(m[0]) : "";
}

function parseDownloadShareLinks($) {
  const tabs = $(".downtab-item").map((idx, el) => ({
    index: idx,
    name: decodeHtml($(el).find("span[data-dropdown-value]").attr("data-dropdown-value") || $(el).text()) || `线路${idx + 1}`,
  })).get();

  const lines = $(".down-line-item").map((idx, el) => {
    const links = [];
    const seen = new Set();
    $(el).find(".module-row-one").each((_, row) => {
      const $row = $(row);
      const title = decodeHtml($row.find(".module-row-title h4").first().text()) || "资源";
      const shareURL = String(
        $row.find(".btn-down").attr("href") ||
        $row.find(".module-row-text.copy").attr("data-clipboard-text") ||
        $row.find(".btn-copyurl.copy").attr("data-clipboard-text") ||
        ""
      ).trim();
      if (!shareURL) return;
      const dedupeKey = `${title}|||${shareURL}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      links.push({ title, shareURL });
    });
    return { index: idx, links };
  }).get();

  const sources = [];
  for (let i = 0; i < Math.max(tabs.length, lines.length); i += 1) {
    const tab = tabs[i];
    const line = lines[i];
    const links = line?.links || [];
    if (!links.length) continue;
    sources.push({
      name: tab?.name || `线路${i + 1}`,
      links,
    });
  }
  return sources;
}

function buildDrivePlayId(meta) {
  return JSON.stringify({
    shareURL: String(meta?.shareURL || ""),
    fileId: String(meta?.fileId || ""),
    episodeName: String(meta?.episodeName || ""),
    sourceName: String(meta?.sourceName || ""),
    routeType: String(meta?.routeType || ""),
  });
}

function parseDrivePlayId(playId) {
  try {
    return JSON.parse(String(playId || "{}"));
  } catch (_) {
    return null;
  }
}

function inferDriveType(url) {
  const value = String(url || "").toLowerCase();
  if (!value) return "";
  if (value.includes("115cdn.com") || value.includes("115.com")) return "115";
  if (value.includes("pan.quark.cn") || value.includes("drive-h.quark.cn")) return "quark";
  if (value.includes("pan.baidu.com")) return "baidu";
  if (value.includes("alipan.com") || value.includes("aliyundrive.com")) return "aliyun";
  if (value.includes("cloud.189.cn")) return "tianyi";
  if (value.includes("123684.com") || value.includes("123865.com") || value.includes("123pan.com")) return "123pan";
  return "";
}

function driveTypeToDisplayName(driveType) {
  const t = String(driveType || "").toLowerCase();
  if (t === "115") return "115网盘";
  if (t === "quark") return "UC网盘";
  if (t === "baidu") return "百度网盘";
  if (t === "aliyun") return "阿里云盘";
  if (t === "tianyi") return "天翼网盘";
  if (t === "123pan") return "123网盘";
  return "网盘";
}

function normalizeShareURL(shareURL) {
  const raw = String(shareURL || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (/115cdn\.com$|115\.com$/i.test(u.hostname)) {
      const m = u.pathname.match(/\/s\/([^/?#]+)/i);
      if (m && m[1]) {
        const pwd = u.searchParams.get("password") || u.searchParams.get("passwd") || u.searchParams.get("code") || "";
        return `https://115.com/s/${m[1]}${pwd ? `?password=${encodeURIComponent(pwd)}` : ""}`;
      }
    }
    return raw;
  } catch (_) {
    return raw;
  }
}

function isVideoFile(file) {
  const name = String(file?.file_name || file?.name || "").toLowerCase();
  if (!name) return false;
  const exts = [".mp4", ".mkv", ".avi", ".flv", ".mov", ".wmv", ".m3u8", ".ts", ".webm", ".m4v", ".rmvb", ".mpg", ".mpeg"];
  if (exts.some((ext) => name.endsWith(ext))) return true;
  const formatType = String(file?.format_type || file?.mime || file?.mimetype || "").toLowerCase();
  return formatType.includes("video") || formatType.includes("mpeg") || formatType.includes("h264") || formatType.includes("hevc");
}

function isFolderFile(file) {
  return Boolean(
    file?.dir ||
    String(file?.category || file?.type || "").toLowerCase().includes("folder") ||
    String(file?.is_folder || "") === "1" ||
    Number(file?.file_type) === 0
  );
}

function isPlainFile(file) {
  return Boolean(file?.file || file?.fid || file?.file_id || file?.id || file?.pickcode || file?.sha1);
}

async function collectAllVideoFiles(shareURL, files = [], parentId = "0") {
  const results = [];
  for (const file of files || []) {
    const fileId = String(file?.fid || file?.file_id || file?.id || "");
    if (isFolderFile(file)) {
      if (!fileId) continue;
      try {
        const subList = await OmniBox.getDriveFileList(shareURL, fileId);
        const subFiles = Array.isArray(subList?.files) ? subList.files : Array.isArray(subList?.data?.files) ? subList.data.files : [];
        if (subFiles.length) {
          const nested = await collectAllVideoFiles(shareURL, subFiles, fileId);
          results.push(...nested);
        }
      } catch (error) {
        await OmniBox.log("warn", `[Gimy115][detail] 展开目录失败: ${file?.file_name || file?.name || "folder"}, err=${error.message}`);
      }
      continue;
    }
    if (!isPlainFile(file)) continue;
    if (!isVideoFile(file)) continue;
    results.push({
      fid: fileId,
      file_name: String(file?.file_name || file?.name || ""),
      size: Number(file?.size || file?.obj_size || file?.file_size || 0) || 0,
      parent_id: parentId,
    });
  }
  return results;
}

function formatFileSize(size) {
  const num = Number(size || 0);
  if (!num || num <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = num;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2)}${units[idx]}`;
}

function getRouteTypes(context, driveType) {
  const normalized = String(driveType || "").toLowerCase();
  // 默认只给一个直连线路；后续如有需要再按配置扩展多线路
  if (normalized === "115") return ["直连"];
  return ["直连"];
}

async function collectDriveTypeCountMap(downloadGroups = []) {
  const countMap = {};
  for (const group of downloadGroups || []) {
    for (const link of group.links || []) {
      const normalizedShareURL = normalizeShareURL(link?.shareURL || "");
      if (!normalizedShareURL) continue;
      try {
        const driveInfo = await OmniBox.getDriveInfoByShareURL(normalizedShareURL);
        const inferredType = inferDriveType(normalizedShareURL);
        const displayName = inferredType ? driveTypeToDisplayName(inferredType) : String(driveInfo?.displayName || "网盘");
        countMap[displayName] = (countMap[displayName] || 0) + 1;
      } catch (_) {
        const inferredType = inferDriveType(normalizedShareURL);
        const displayName = inferredType ? driveTypeToDisplayName(inferredType) : "网盘";
        countMap[displayName] = (countMap[displayName] || 0) + 1;
      }
    }
  }
  return countMap;
}

async function tryRequest(urls, options = {}) {
  let lastErr = null;
  for (const url of urls.filter(Boolean)) {
    try {
      const html = await requestText(url, options);
      return { url, html };
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error("没有可请求的 URL");
}

function buildCategoryUrls(categoryId, page, filters = {}) {
  const pageNum = Math.max(Number(page || 1) || 1, 1);
  const actualId = String(filters.subType || categoryId || "1").trim();
  const classValue = String(filters.class || "").trim();
  const areaValue = String(filters.area || "").trim();
  const yearValue = String(filters.year || "").trim();
  const langValue = String(filters.lang || "").trim();
  const letterValue = String(filters.letter || "").trim();
  const byValue = String(filters.by || "time").trim();

  const parts = [BASE_URL, "/index.php/vod/show"];
  if (areaValue) parts.push(`/area/${encodeURIComponent(areaValue)}`);
  if (byValue && byValue !== 'time') parts.push(`/by/${encodeURIComponent(byValue)}`);
  if (classValue) parts.push(`/class/${encodeURIComponent(classValue)}`);
  parts.push(`/id/${actualId}`);
  if (langValue) parts.push(`/lang/${encodeURIComponent(langValue)}`);
  if (yearValue) parts.push(`/year/${encodeURIComponent(yearValue)}`);
  if (letterValue) parts.push(`/letter/${encodeURIComponent(letterValue)}`);
  if (pageNum > 1) parts.push(`/page/${pageNum}`);
  parts.push('.html');

  const showUrl = parts.join('');
  const fallbacks = [];
  if (pageNum <= 1 && actualId === categoryId && !classValue && !areaValue && !yearValue && !langValue && !letterValue && byValue === 'time') {
    fallbacks.push(`${BASE_URL}/index.php/vod/type/id/${categoryId}.html`);
  }
  return [showUrl, ...fallbacks.filter(Boolean)];
}

function buildSearchUrls(keyword, page) {
  const encoded = encodeURIComponent(keyword);
  const pageNum = Math.max(Number(page || 1) || 1, 1);
  if (pageNum <= 1) {
    return [
      `${BASE_URL}/index.php/vod/search/wd/${encoded}.html`,
      `${BASE_URL}/index.php/vod/search.html?wd=${encoded}`,
    ];
  }
  return [
    `${BASE_URL}/index.php/vod/search/page/${pageNum}/wd/${encoded}.html`,
    `${BASE_URL}/index.php/vod/search/wd/${encoded}/page/${pageNum}.html`,
    `${BASE_URL}/index.php/vod/search.html?wd=${encoded}&page=${pageNum}`,
  ];
}

async function home(params, context) {
  const config = buildClassAndFilters();
  try {
    const html = await requestText(`${BASE_URL}/`);
    const $ = cheerio.load(html);
    const list = extractCards($).slice(0, 24);
    await OmniBox.log("info", `[Gimy115][home] list=${list.length} cookie=${SITE_COOKIE ? 1 : 0}`);
    return { class: config.class, filters: config.filters, list };
  } catch (e) {
    await OmniBox.log("error", `[Gimy115][home] ${e.message}`);
    return { class: config.class, filters: config.filters, list: [] };
  }
}

async function category(params, context) {
  try {
    const categoryId = String(params.categoryId || params.type_id || "1");
    const page = Math.max(Number(params.page || 1) || 1, 1);
    const filters = params.filters || {};
    const { html, url } = await tryRequest(buildCategoryUrls(categoryId, page, filters));
    const $ = cheerio.load(html);
    const list = extractCards($);
    await OmniBox.log("info", `[Gimy115][category] type=${categoryId} page=${page} filters=${JSON.stringify(filters)} url=${url} list=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 20 ? 1 : 0),
      total: (page - 1) * 20 + list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy115][category] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function search(params, context) {
  try {
    const keyword = String(params.keyword || params.key || params.wd || "").trim();
    const page = Math.max(Number(params.page || 1) || 1, 1);
    if (!keyword) return { page, pagecount: 0, total: 0, list: [] };

    const { html, url } = await tryRequest(buildSearchUrls(keyword, page));
    const $ = cheerio.load(html);
    const scope = $(".module-search-item, .module-items, .module-list, .module-main").first();
    const list = extractCards($, scope.length ? scope.parent().length ? scope.parent() : scope : $.root());
    await OmniBox.log("info", `[Gimy115][search] keyword=${keyword} page=${page} url=${url} list=${list.length}`);
    return {
      page,
      pagecount: page + (list.length >= 20 ? 1 : 0),
      total: (page - 1) * 20 + list.length,
      list,
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy115][search] ${e.message}`);
    return { page: 1, pagecount: 0, total: 0, list: [] };
  }
}

async function detail(params, context) {
  try {
    const videoId = String(params.videoId || params.id || params.vod_id || "").trim();
    if (!videoId) return { list: [] };
    const inputUrl = /^https?:\/\//i.test(videoId) ? videoId : absUrl(videoId);
    const html = await requestText(inputUrl, { referer: `${BASE_URL}/` });

    if (isPermissionDenied(html)) {
      const msg = extractPermissionMessage(html);
      await OmniBox.log("warn", `[Gimy115][detail] permission denied @ ${inputUrl}: ${msg}`);
      return {
        list: [{
          vod_id: inputUrl,
          vod_name: decodeHtml(params.vod_name || params.name || "Gimy115 资源"),
          vod_pic: "",
          vod_remarks: `权限限制：${msg}`,
          vod_content: `当前站点详情入口返回权限页。可尝试配置环境变量 GIMY115_COOKIE 后重试。`,
          vod_play_sources: [{
            name: "权限提示",
            episodes: [{ name: "当前无法访问", playId: `denied|||${encodeURIComponent(inputUrl)}|||${encodeURIComponent(msg)}` }],
          }],
        }],
      };
    }

    let detailUrl = inputUrl;
    let detailHtml = html;
    let $ = cheerio.load(html);

    const realDetailUrl = extractRealDetailUrl(html);
    const downloadGroups = parseDownloadShareLinks($);
    await OmniBox.log("info", `[Gimy115][detail] parsed download groups=${downloadGroups.length}, links=${downloadGroups.reduce((sum, group) => sum + ((group?.links || []).length), 0)}`);

    if (/\/index\.php\/vod\/down\/id\//i.test(inputUrl) && realDetailUrl) {
      try {
        detailHtml = await requestText(realDetailUrl, { referer: inputUrl });
        detailUrl = realDetailUrl;
        $ = cheerio.load(detailHtml);
      } catch (e) {
        await OmniBox.log("warn", `[Gimy115][detail] fetch real detail failed: ${e.message}`);
      }
    }

    const detailMeta = extractDetailMeta($, detailUrl);
    const playSources = [];
    const filesForScraping = [];
    const driveTypeCountMap = await collectDriveTypeCountMap(downloadGroups);
    const driveTypeCurrentIndexMap = {};

    for (const group of downloadGroups) {
      for (const link of group.links || []) {
        const shareURL = String(link?.shareURL || "").trim();
        if (!shareURL) continue;
        try {
          const normalizedShareURL = normalizeShareURL(shareURL);
          const driveInfo = await OmniBox.getDriveInfoByShareURL(normalizedShareURL);
          const inferredType = inferDriveType(normalizedShareURL);
          const driveType = String(inferredType || driveInfo?.driveType || "").toLowerCase();
          const displayBase = String(inferredType ? driveTypeToDisplayName(inferredType) : (driveInfo?.displayName || group.name || "网盘")).trim();
          const totalCount = driveTypeCountMap[displayBase] || 0;
          let sourceBaseName = displayBase;
          if (totalCount > 1) {
            driveTypeCurrentIndexMap[displayBase] = (driveTypeCurrentIndexMap[displayBase] || 0) + 1;
            sourceBaseName = `${displayBase}${driveTypeCurrentIndexMap[displayBase]}`;
          }
          const root = await OmniBox.getDriveFileList(normalizedShareURL, "0");
          const rootFiles = Array.isArray(root?.files) ? root.files : Array.isArray(root?.data?.files) ? root.data.files : Array.isArray(root) ? root : [];
          await OmniBox.log("info", `[Gimy115][detail] root files for ${normalizedShareURL}: count=${rootFiles.length}`);
          if (rootFiles[0]) {
            const sample = rootFiles[0];
            await OmniBox.log("info", `[Gimy115][detail] root sample keys=${Object.keys(sample).slice(0, 20).join(',')}`);
            await OmniBox.log("info", `[Gimy115][detail] root sample file_name=${String(sample?.file_name || sample?.name || '')} dir=${String(sample?.dir || '')} file=${String(sample?.file || '')} fid=${String(sample?.fid || sample?.file_id || sample?.id || '')}`);
          }

          let directVideoFiles = rootFiles
            .filter((file) => isPlainFile(file) && isVideoFile(file))
            .map((file) => ({
              fid: String(file?.fid || file?.file_id || file?.id || ""),
              file_name: String(file?.file_name || file?.name || ""),
              size: Number(file?.size || file?.obj_size || file?.file_size || 0) || 0,
            }))
            .filter((file) => file.fid && file.file_name);

          if (!directVideoFiles.length) {
            const rootFolderCandidates = rootFiles.filter((file) => isFolderFile(file) || String(file?.dir || '') === '1');
            if (rootFolderCandidates.length === 1) {
              const folder = rootFolderCandidates[0];
              const folderId = String(folder?.fid || folder?.file_id || folder?.id || '');
              if (folderId) {
                await OmniBox.log('info', `[Gimy115][detail] 根目录无视频，尝试展开单一目录: ${String(folder?.file_name || folder?.name || folderId)}`);
                const subList = await OmniBox.getDriveFileList(normalizedShareURL, folderId);
                const subFiles = Array.isArray(subList?.files) ? subList.files : Array.isArray(subList?.data?.files) ? subList.data.files : Array.isArray(subList) ? subList : [];
                await OmniBox.log('info', `[Gimy115][detail] sub files for ${normalizedShareURL} fid=${folderId}: count=${subFiles.length}`);
                if (subFiles[0]) {
                  const subSample = subFiles[0];
                  await OmniBox.log('info', `[Gimy115][detail] sub sample keys=${Object.keys(subSample).slice(0, 20).join(',')}`);
                  await OmniBox.log('info', `[Gimy115][detail] sub sample file_name=${String(subSample?.file_name || subSample?.name || '')} dir=${String(subSample?.dir || '')} file=${String(subSample?.file || '')} fid=${String(subSample?.fid || subSample?.file_id || subSample?.id || '')}`);
                }
                directVideoFiles = subFiles
                  .filter((file) => isPlainFile(file) && isVideoFile(file))
                  .map((file) => ({
                    fid: String(file?.fid || file?.file_id || file?.id || ''),
                    file_name: String(file?.file_name || file?.name || ''),
                    size: Number(file?.size || file?.obj_size || file?.file_size || 0) || 0,
                  }))
                  .filter((file) => file.fid && file.file_name);

                if (!directVideoFiles.length) {
                  const secondFolderCandidates = subFiles.filter((file) => isFolderFile(file) || String(file?.dir || '') === '1' || String(file?.dir || '') === 'true');
                  if (secondFolderCandidates.length === 1) {
                    const folder2 = secondFolderCandidates[0];
                    const folder2Id = String(folder2?.fid || folder2?.file_id || folder2?.id || '');
                    if (folder2Id) {
                      await OmniBox.log('info', `[Gimy115][detail] 第一层仍无视频，尝试展开第二层目录: ${String(folder2?.file_name || folder2?.name || folder2Id)}`);
                      const subList2 = await OmniBox.getDriveFileList(normalizedShareURL, folder2Id);
                      const subFiles2 = Array.isArray(subList2?.files) ? subList2.files : Array.isArray(subList2?.data?.files) ? subList2.data.files : Array.isArray(subList2) ? subList2 : [];
                      await OmniBox.log('info', `[Gimy115][detail] sub2 files for ${normalizedShareURL} fid=${folder2Id}: count=${subFiles2.length}`);
                      if (subFiles2[0]) {
                        const subSample2 = subFiles2[0];
                        await OmniBox.log('info', `[Gimy115][detail] sub2 sample keys=${Object.keys(subSample2).slice(0, 20).join(',')}`);
                        await OmniBox.log('info', `[Gimy115][detail] sub2 sample file_name=${String(subSample2?.file_name || subSample2?.name || '')} dir=${String(subSample2?.dir || '')} file=${String(subSample2?.file || '')} fid=${String(subSample2?.fid || subSample2?.file_id || subSample2?.id || '')}`);
                      }
                      directVideoFiles = subFiles2
                        .filter((file) => isPlainFile(file) && isVideoFile(file))
                        .map((file) => ({
                          fid: String(file?.fid || file?.file_id || file?.id || ''),
                          file_name: String(file?.file_name || file?.name || ''),
                          size: Number(file?.size || file?.obj_size || file?.file_size || 0) || 0,
                        }))
                        .filter((file) => file.fid && file.file_name);
                    }
                  }
                }
              }
            }
          }

          if (!directVideoFiles.length) {
            await OmniBox.log("warn", `[Gimy115][detail] 未找到视频文件: raw=${shareURL} normalized=${normalizedShareURL}`);
            continue;
          }

          const routeTypes = getRouteTypes(context, driveType);
          for (const routeType of routeTypes) {
            const episodes = directVideoFiles.map((file) => {
              const episodeName = decodeHtml(String(file.file_name || "资源").replace(/\.[^.]+$/, "")) || "资源";
              const size = formatFileSize(file.size);
              const playMeta = encodePlayMeta({
                sid: detailUrl,
                t: detailMeta.vod_name || "",
                p: detailMeta.vod_pic || "",
                e: episodeName,
              });
              const drivePlayId = buildDrivePlayId({
                shareURL: normalizedShareURL,
                fileId: file.fid,
                episodeName,
                sourceName: sourceBaseName,
                routeType,
              });
              const finalPlayId = playMeta ? `${drivePlayId}|||${playMeta}` : drivePlayId;
              if (!filesForScraping.some((item) => item.fid === `${normalizedShareURL}|${file.fid}`)) {
                filesForScraping.push({
                  file_name: episodeName,
                  fid: `${normalizedShareURL}|${file.fid}`,
                  file_id: `${normalizedShareURL}|${file.fid}`,
                });
              }
              return {
                name: size ? `${episodeName} [${size}]` : episodeName,
                playId: finalPlayId,
              };
            });
            playSources.push({
              name: routeType === '直连' ? sourceBaseName : `${sourceBaseName}-${routeType}`,
              episodes,
            });
          }
        } catch (error) {
          await OmniBox.log("warn", `[Gimy115][detail] 展开网盘失败: ${shareURL}, err=${error.message}`);
        }
      }
    }

    const vod_play_sources = playSources.length
      ? playSources
      : [{ name: "详情页", episodes: [{ name: "打开详情页", playId: `page|||${encodeURIComponent(detailUrl)}` }] }];

    if (filesForScraping.length > 0) {
      try {
        await OmniBox.log("info", `[Gimy115][detail] 开始统一刮削: vodId=${detailUrl}, files=${filesForScraping.length}`);
        await OmniBox.processScraping(detailUrl, detailMeta.vod_name || "", detailMeta.vod_name || "", filesForScraping);
        const metadata = await OmniBox.getScrapeMetadata(detailUrl);
        const scrapeData = metadata?.scrapeData || null;
        const videoMappings = Array.isArray(metadata?.videoMappings) ? metadata.videoMappings : [];

        if (scrapeData || videoMappings.length > 0) {
          for (const source of vod_play_sources) {
            for (const episode of source.episodes || []) {
              const parts = String(episode.playId || "").split("|||");
              const drivePayload = parseDrivePlayId(parts[0] || "");
              const formattedId = `${String(drivePayload?.shareURL || "")}|${String(drivePayload?.fileId || "")}`;
              const matchedMapping = videoMappings.find((mapping) => mapping && mapping.fileId === formattedId);
              if (matchedMapping && scrapeData) {
                const newName = buildScrapedFileName(scrapeData, matchedMapping, String(episode.name || ""));
                if (newName && newName !== episode.name) {
                  episode.name = newName;
                }
              }
            }
          }

          if (scrapeData) {
            if (scrapeData.title) detailMeta.vod_name = scrapeData.title;
            if (scrapeData.posterPath) detailMeta.vod_pic = `https://image.tmdb.org/t/p/w500${scrapeData.posterPath}`;
            if (scrapeData.overview) detailMeta.vod_content = scrapeData.overview;
            if (scrapeData.releaseDate) detailMeta.vod_year = String(scrapeData.releaseDate).slice(0, 4);
            if (scrapeData.voteAverage) detailMeta.vod_douban_score = Number(scrapeData.voteAverage).toFixed(1);
          }
        }
      } catch (error) {
        await OmniBox.log("warn", `[Gimy115][detail] 统一刮削失败: ${error.message}`);
      }
    }

    await OmniBox.log("info", `[Gimy115][detail] input=${inputUrl} detail=${detailUrl} shareGroups=${downloadGroups.length} playSources=${playSources.length}`);
    return {
      list: [{
        ...detailMeta,
        vod_id: detailUrl,
        vod_play_sources,
      }],
    };
  } catch (e) {
    await OmniBox.log("error", `[Gimy115][detail] ${e.message}`);
    return { list: [] };
  }
}

async function play(params, context) {
  try {
    const playId = String(params.playId || params.id || params.url || "").trim();
    if (!playId) return { parse: 0, url: "", urls: [], header: {}, headers: {} };

    const [mainPlayId, metaPart = ""] = playId.split("|||");
    const playMeta = decodePlayMeta(metaPart);
    const driveMeta = parseDrivePlayId(mainPlayId);
    if (driveMeta && driveMeta.shareURL && driveMeta.fileId) {
      const shareURL = String(driveMeta.shareURL || "");
      const fileId = String(driveMeta.fileId || "");
      const routeType = String(driveMeta.routeType || (String(context?.from || "web") === "web" ? "服务端代理" : "直连"));
      const episodeName = String(playMeta.e || driveMeta.episodeName || "播放");
      await OmniBox.log("info", `[Gimy115][play] drive route=${routeType} shareURL=${shareURL} fileId=${fileId}`);

      const metadataPromise = (async () => {
        const result = {
          danmakuList: [],
          episodeName,
        };
        const vodId = String(playMeta.sid || params.vodId || params.videoId || "").trim();
        if (!vodId) return result;

        try {
          const metadata = await OmniBox.getScrapeMetadata(vodId);
          if (!metadata || !metadata.scrapeData || !Array.isArray(metadata.videoMappings)) {
            await OmniBox.log("info", `[Gimy115][play] 弹幕匹配跳过: metadata 不完整, vodId=${vodId}`);
            return result;
          }
          const formattedId = `${shareURL}|${fileId}`;
          const matchedMapping = metadata.videoMappings.find((mapping) => mapping && mapping.fileId === formattedId);
          const scrapeData = metadata.scrapeData || {};
          if (!matchedMapping) return result;
          if (matchedMapping.episodeName && !result.episodeName) {
            result.episodeName = matchedMapping.episodeName;
          }
          const fileName = buildScrapedFileName(scrapeData, matchedMapping, result.episodeName || "") || buildFileNameForDanmu(scrapeData.title || playMeta.t || "", result.episodeName || "");
          if (fileName) {
            await OmniBox.log("info", `[Gimy115][play] 生成 fileName 用于弹幕匹配: ${fileName}`);
            const matchedDanmaku = await OmniBox.getDanmakuByFileName(fileName);
            if (Array.isArray(matchedDanmaku) && matchedDanmaku.length > 0) {
              result.danmakuList = matchedDanmaku;
            }
          }
        } catch (error) {
          await OmniBox.log("warn", `[Gimy115][play] 弹幕匹配失败: ${error.message}`);
        }

        return result;
      })();

      const [playInfoResult, metadataResult] = await Promise.allSettled([
        OmniBox.getDriveVideoPlayInfo(shareURL, fileId, routeType),
        metadataPromise,
      ]);
      if (playInfoResult.status !== "fulfilled") {
        throw new Error(playInfoResult.reason && playInfoResult.reason.message ? playInfoResult.reason.message : `未获取到网盘播放地址: ${shareURL}`);
      }
      const playInfo = playInfoResult.value;
      const urlsRaw = Array.isArray(playInfo?.urls) ? playInfo.urls : Array.isArray(playInfo?.url) ? playInfo.url : [];
      const urls = urlsRaw.map((item) => ({
        name: String(item?.name || episodeName || "播放"),
        url: String(item?.url || ""),
      })).filter((item) => item.url);
      if (urls.length) {
        const header = playInfo?.header || playInfo?.headers || {};
        let danmakuList = playInfo?.danmaku;
        if (metadataResult.status === "fulfilled" && metadataResult.value) {
          danmakuList = metadataResult.value.danmakuList?.length ? metadataResult.value.danmakuList : danmakuList;
        }

        return {
          parse: Number(playInfo?.parse || 0),
          url: String(playInfo?.url || urls[0].url || ""),
          urls,
          header,
          headers: header,
          danmaku: danmakuList};
      }
      throw new Error(`未获取到网盘播放地址: ${shareURL}`);
    }

    if (playId.startsWith("denied|||")) {
      const parts = playId.split("|||");
      const deniedUrl = decodeURIComponent(parts[1] || "");
      return {
        parse: 1,
        url: deniedUrl,
        urls: [{ name: "权限页", url: deniedUrl }],
        header: getHeaders(deniedUrl),
        headers: getHeaders(deniedUrl)};
    }

    if (playId.startsWith("page|||")) {
      const pageUrl = decodeURIComponent(playId.slice("page|||".length));
      return {
        parse: 1,
        url: pageUrl,
        urls: [{ name: "详情页", url: pageUrl }],
        header: getHeaders(pageUrl),
        headers: getHeaders(pageUrl)};
    }

    return { parse: 0, url: playId, urls: [{ name: "播放", url: playId }], header: {}, headers: {} };
  } catch (e) {
    await OmniBox.log("error", `[Gimy115][play] ${e.message}`);
    return { parse: 0, url: "", urls: [], header: {}, headers: {} };
  }
}
