const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "影视", "采集", "HDmoli.js"), "utf8");
const fixtureDir = path.join(repoRoot, "tests", "fixtures", "hdmoli");

function fixture(name) {
  return fs.readFileSync(path.join(fixtureDir, name), "utf8");
}

function loadSpider(request, env = {}) {
  const spiderModule = { exports: {} };
  const sdk = {
    log: async () => {},
    getCache: async () => null,
    setCache: async () => {},
    request,
    sniffVideo: async () => ({ url: "", header: {} }),
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
    process: { env },
    URL,
    URLSearchParams,
    Buffer,
    performance,
    setTimeout,
    clearTimeout,
  }, { filename: "HDmoli.js" });

  return spiderModule.exports;
}

function makeRequest({ firstHomeRedirect = false } = {}) {
  const requests = [];
  let homeServed = false;
  const request = async (url, options = {}) => {
    const currentUrl = String(url);
    requests.push({ url: currentUrl, method: options.method || "GET", headers: options.headers });
    if (firstHomeRedirect && currentUrl === "https://www.hdmoli.org/" && !homeServed) {
      homeServed = true;
      return {
        statusCode: 301,
        headers: { location: "https://www.hdmoli.me/" },
        body: "",
      };
    }
    if (currentUrl === "https://www.hdmoli.me/") return { statusCode: 200, headers: {}, body: fixture("home.html") };
    if (currentUrl === "https://www.hdmoli.me/show/1-----------.html") return { statusCode: 200, headers: {}, body: fixture("category-movie.html") };
    if (currentUrl === "https://www.hdmoli.me/show/1--------2---.html") return { statusCode: 200, headers: {}, body: fixture("category-movie.html") };
    if (currentUrl === "https://www.hdmoli.me/show/2-----------.html") return { statusCode: 200, headers: {}, body: fixture("category-juji.html") };
    if (currentUrl === "https://www.hdmoli.me/search/-------------.html?wd=%E6%B5%81%E4%BA%BA") return { statusCode: 200, headers: {}, body: fixture("search.html") };
    if (currentUrl === "https://www.hdmoli.me/movie/index3798.html") return { statusCode: 200, headers: {}, body: fixture("detail.html") };
    if (currentUrl === "https://www.hdmoli.me/play/3798-4-1.html") return { statusCode: 200, headers: {}, body: fixture("play.html") };
    return { statusCode: 404, headers: {}, body: "" };
  };
  return { request, requests };
}

test("HDmoli uses the new domain and follows HTTP redirects", async () => {
  assert.match(source, /const BASE_URL = \(process\.env\.HDMOLI_HOST \|\| "https:\/\/www\.hdmoli\.me"\)/);
  assert.match(source, /@version 1\.0\.8/);
  assert.match(source, /\[301, 302, 303, 307, 308\]\.includes\(statusCode\)/);

  const { request, requests } = makeRequest({ firstHomeRedirect: true });
  const spider = loadSpider(request, { HDMOLI_HOST: "https://www.hdmoli.org" });
  const result = await spider.home({}, {});

  assert.equal(result.class.length, 12);
  assert.ok(result.list.length >= 20);
  const first = result.list.find((item) => item.vod_id === "movie:3815");
  assert.equal(first.vod_name, "无间兄弟情");
  assert.equal(first.vod_remarks, "更新至第02集");
  assert.equal(first.vod_year, "2026");
  assert.equal(first.vod_area, "美国");
  assert.ok(first.vod_pic.startsWith("https://"));
  assert.deepEqual(requests.map((item) => item.url), [
    "https://www.hdmoli.org/",
    "https://www.hdmoli.me/",
  ]);
});

test("HDmoli parses category cards, page two, and pagination", async () => {
  const { request, requests } = makeRequest();
  const spider = loadSpider(request);
  const result = await spider.category({ categoryId: "1", page: 2 }, {});

  assert.equal(result.page, 2);
  assert.equal(result.pagecount, 21);
  assert.ok(result.list.length >= 20);
  assert.ok(result.list.some((item) => item.vod_id === "movie:3810"));
  assert.equal(requests[0].url, "https://www.hdmoli.me/show/1--------2---.html");

  const dramaResult = await spider.category({ categoryId: "2", page: 1 }, {});
  assert.equal(dramaResult.pagecount, 45);
  assert.ok(dramaResult.list.length >= 20);
  assert.equal(requests[1].url, "https://www.hdmoli.me/show/2-----------.html");
});

test("HDmoli parses the media search layout", async () => {
  const { request } = makeRequest();
  const spider = loadSpider(request);
  const result = await spider.search({ keyword: "流人", page: 1 }, {});

  assert.ok(result.list.length >= 5);
  assert.equal(result.list[0].vod_id, "movie:3798");
  assert.equal(result.list[0].vod_name, "流人第六季");
  assert.equal(result.list[0].vod_remarks, "更新至第02集");
  assert.equal(result.list[0].vod_year, "2026");
  assert.equal(result.list[0].vod_area, "英国");
  assert.equal(result.list[0].type_name, "海外剧");
});

test("HDmoli parses detail metadata and hides drive sources", async () => {
  const { request } = makeRequest();
  const spider = loadSpider(request);
  const result = await spider.detail({ videoId: "movie:3798" }, {});
  const item = result.list[0];

  assert.equal(item.vod_name, "流人第六季");
  assert.equal(item.vod_remarks, "更新至第02集");
  assert.equal(item.vod_area, "英国");
  assert.equal(item.vod_year, "2026");
  assert.equal(item.type_name, "海外剧");
  assert.ok(item.vod_actor.includes("加里·奥德曼"));
  assert.equal(item.vod_director, "亚当·兰道");
  assert.ok(item.vod_content.length > 20);
  assert.equal(item.vod_play_sources.length, 4);
  assert.ok(item.vod_play_sources.every((source) => !/网盘/.test(source.name)));
  assert.equal(item.vod_play_sources[0].episodes.length, 2);

  assert.ok(item.vod_content.includes("第六季改编自米克·赫隆"));
  const playId = JSON.parse(item.vod_play_sources[0].episodes[0].playId);
  assert.equal(playId.source, "线路7");
  assert.equal(playId.playUrl, "https://www.hdmoli.me/play/3798-4-1.html");
  assert.equal(playId.referer, "https://www.hdmoli.me/movie/index3798.html");
});

test("HDmoli falls back to page sniffing for encrypted third-party players", async () => {
  const { request } = makeRequest();
  const spider = loadSpider(request);
  const playId = JSON.stringify({
    source: "线路7",
    playUrl: "https://www.hdmoli.me/play/3798-4-1.html",
    referer: "https://www.hdmoli.me/movie/index3798.html",
  });
  const result = await spider.play({ playId }, {});

  assert.equal(result.parse, 1);
  assert.equal(result.urls.length, 1);
  assert.equal(result.urls[0].name, "线路7");
  assert.equal(result.urls[0].url, "https://www.hdmoli.me/play/3798-4-1.html");
  assert.equal(result.header.Referer, "https://www.hdmoli.me/movie/index3798.html");
});
