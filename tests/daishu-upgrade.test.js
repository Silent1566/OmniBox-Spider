const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "影视", "采集", "袋鼠影视.js"), "utf8");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "daishu");

function loadSpider(request) {
  const spiderModule = { exports: {} };
  const sdk = {
    log: async () => {},
    getCache: async () => null,
    setCache: async () => {},
    request,
  };
  const localRequire = (id) => {
    if (id === "omnibox_sdk") return sdk;
    if (id === "spider_runner") return { run: () => {} };
    return require(id);
  };

  vm.runInNewContext(source, {
    module: spiderModule,
    exports: spiderModule.exports,
    require: localRequire,
    process: { env: {} },
    URL,
    URLSearchParams,
    Buffer,
    performance,
    setTimeout,
    clearTimeout,
  }, { filename: "袋鼠影视.js" });

  return spiderModule.exports;
}

function fixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

function makeRequest({ firstHomeRedirect = false } = {}) {
  const requests = [];
  let homeServed = false;
  const request = async (url, options = {}) => {
    const currentUrl = String(url);
    requests.push({ url: currentUrl, method: options.method || "GET", body: options.body });
    if (firstHomeRedirect && currentUrl === "https://dsystv.com/" && !homeServed) {
      homeServed = true;
      return {
        statusCode: 301,
        headers: { location: "https://dsystv.com/" },
        body: "",
      };
    }
    if (currentUrl === "https://dsystv.com/") return { statusCode: 200, headers: {}, body: fixture("home.html") };
    if (currentUrl === "https://dsystv.com/search.php?searchtype=5&tid=2&page=1") return { statusCode: 200, headers: {}, body: fixture("category.html") };
    if (currentUrl === "https://dsystv.com/movie/index429656.html") return { statusCode: 200, headers: {}, body: fixture("detail.html") };
    if (currentUrl === "https://dsystv.com/search.php?page=1") return { statusCode: 200, headers: {}, body: fixture("search.html") };
    if (currentUrl === "https://dsystv.com/play/429656-0-0.html") return { statusCode: 200, headers: {}, body: fixture("play.html") };
    return { statusCode: 404, headers: {}, body: "" };
  };
  return { request, requests };
}

test("袋鼠影视 uses the new domain and follows HTTP redirects", async () => {
  assert.match(source, /const BASE_URL = "https:\/\/dsystv\.com"/);
  assert.match(source, /@version 1\.0\.1/);
  assert.match(source, /\[301, 302, 303, 307, 308\]\.includes\(statusCode\)/);

  const { request, requests } = makeRequest({ firstHomeRedirect: true });
  const spider = loadSpider(request);
  const result = await spider.home({}, {});

  assert.equal(result.class.length, 4);
  assert.equal(result.class[1].type_name, "电视剧");
  assert.ok(result.list.length >= 40);
  assert.ok(result.list.some((item) => item.vod_id === "https://dsystv.com/movie/index427901.html" && item.vod_name === "交锋" && item.vod_pic.startsWith("https://community.codewave.163.com/upload/app/")));
  assert.deepEqual(requests.map((item) => item.url), ["https://dsystv.com/", "https://dsystv.com/"]);
});

test("袋鼠影视 parses category cards and pagination", async () => {
  const { request } = makeRequest();
  const spider = loadSpider(request);
  const result = await spider.category({ categoryId: "2", page: 1 }, {});

  assert.equal(result.page, 1);
  assert.equal(result.pagecount, 603);
  assert.equal(result.list.length, 36);
  const target = result.list.find((item) => item.vod_id === "https://dsystv.com/movie/index429656.html");
  assert.equal(target.vod_name, "法医秦明之龙番往事");
  assert.equal(target.vod_remarks, "更新至第04集");
  assert.ok(result.list[0].vod_pic.startsWith("https://community.codewave.163.com/upload/app/"));
});

test("袋鼠影视 parses detail metadata, play lines, and episodes", async () => {
  const spider = loadSpider(makeRequest().request);
  const result = await spider.detail({ id: "https://dsystv.com/movie/index429656.html" }, {});
  const item = result.list[0];

  assert.equal(item.vod_id, "https://dsystv.com/movie/index429656.html");
  assert.equal(item.vod_name, "法医秦明之龙番往事");
  assert.equal(item.vod_remarks, "更新至第04集");
  assert.equal(item.vod_year, "2026");
  assert.equal(item.vod_area, "大陆");
  assert.equal(item.type_name, "国产剧");
  assert.equal(item.vod_lang, "国语");
  assert.ok(item.vod_actor.includes("俞灏明"));
  assert.ok(item.vod_director.includes("邢键钧"));
  assert.ok(item.vod_content.length > 20);
  assert.equal(item.vod_play_sources.length, 4);
  assert.equal(item.vod_play_sources.reduce((sum, source) => sum + source.episodes.length, 0), 16);
  assert.deepEqual(JSON.parse(JSON.stringify(item.vod_play_sources[0])), {
    name: "蓝光专线4",
    episodes: [
      { name: "第01集", playId: "https://dsystv.com/play/429656-2-0.html" },
      { name: "第02集", playId: "https://dsystv.com/play/429656-2-1.html" },
      { name: "第03集", playId: "https://dsystv.com/play/429656-2-2.html" },
      { name: "第04集", playId: "https://dsystv.com/play/429656-2-3.html" },
    ],
  });
});

test("袋鼠影视 parses search results and posts the keyword", async () => {
  const { request, requests } = makeRequest();
  const spider = loadSpider(request);
  const result = await spider.search({ keyword: "法医", page: 1 }, {});

  assert.equal(result.total, 79);
  assert.ok(result.list.length >= 10);
  assert.ok(result.pagecount > 1, "搜索页应解析出分页");
  assert.equal(result.list[0].vod_id, "https://dsystv.com/movie/index429656.html");
  assert.equal(result.list[0].vod_name, "法医秦明之龙番往事");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[0].body, "searchword=%E6%B3%95%E5%8C%BB");
});

test("袋鼠影视 extracts the direct m3u8 URL from a play page", async () => {
  const spider = loadSpider(makeRequest().request);
  const result = await spider.play({ playId: "https://dsystv.com/play/429656-0-0.html" }, {});

  assert.equal(result.parse, 0);
  assert.equal(result.url, "https://vip.ffzy-plays.com/20260922/58566_d32fa042/index.m3u8");
  assert.equal(result.urls[0].name, "播放");
  assert.equal(result.header.Referer, "https://dsystv.com/play/429656-0-0.html");
});
