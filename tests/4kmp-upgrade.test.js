const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "影视", "采集", "4KMP.js"), "utf8");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "4kmp");
const cheerio = require("cheerio");

function loadSpider(requests = [], files = {}) {
  const spiderModule = { exports: {} };
  const logs = [];
  const request = async (url, options = {}) => {
    requests.push({ url, options });
    if (!files[url]) throw new Error(`HTTP 404 @ ${url}`);
    return { statusCode: 200, body: files[url], headers: {} };
  };
  const context = {
    module: spiderModule,
    exports: spiderModule.exports,
    require(id) {
      if (id === "omnibox_sdk") return { request, log: async (level, message) => logs.push([level, message]) };
      if (id === "spider_runner") return { run: () => {} };
      if (id === "cheerio") return cheerio;
      return require(id);
    },
    process: { env: {} },
    setTimeout,
    clearTimeout,
    Buffer,
    URL,
    URLSearchParams,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "4KMP.js" });
  return { spider: spiderModule.exports, requests, logs };
}

const homeUrl = "https://4k-av.com/";
const categoryUrl = "https://4k-av.com/tv/";
const searchUrl = "https://4k-av.com/s?y=%E6%8C%91%E6%83%85%E4%B8%91%E9%97%BB";
const detailUrl = "https://4k-av.com/tv/210869-the-scandal-ep01/";
const files = {
  [homeUrl]: fs.readFileSync(path.join(fixtureRoot, "home.html"), "utf8"),
  [categoryUrl]: fs.readFileSync(path.join(fixtureRoot, "tv.html"), "utf8"),
  [searchUrl]: fs.readFileSync(path.join(fixtureRoot, "search-hit.html"), "utf8"),
  [detailUrl]: fs.readFileSync(path.join(fixtureRoot, "detail.html"), "utf8"),
};

test("metadata points to the migrated 4K-AV site", () => {
  assert.equal(source.match(/^\/\/ @version (.+)$/m)?.[1], "1.0.2");
  assert.equal(source.match(/^\/\/ @description (.+)$/m)?.[1], "4k-av.com：支持首页、分类、搜索、详情与直链播放，站点请求使用苹果 Safari UA");
  assert.match(source, /const BASE_URL = "https:\/\/4k-av\.com";/);
  assert.doesNotMatch(source, /4kmp\.com|\/s\?k=/);
});

test("home returns migrated cards", async () => {
  const requests = [];
  const { spider } = loadSpider(requests, files);
  const result = await spider.home({});
  assert.equal(result.class.length, 2);
  assert.equal(result.list.length, 36);
  assert.equal(requests[0].url, homeUrl);
  assert.match(result.list[0].vod_id, /^https:\/\/4k-av\.com\/(tv|movie)\//);
  assert.ok(result.list[0].vod_pic);
  assert.ok(result.list[0].vod_name);
});

test("category reverses source pages and parses 24 cards", async () => {
  const firstRequests = [];
  const firstSpider = loadSpider(firstRequests, files).spider;
  const first = await firstSpider.category({ categoryId: "tv", page: 1 });
  assert.equal(first.pagecount, 18);
  assert.equal(first.list.length, 24);
  assert.equal(firstRequests.filter((r) => r.url === categoryUrl).length, 1);

  const lastRequests = [];
  const { spider: lastSpider } = loadSpider(lastRequests, files);
  const last = await lastSpider.category({ categoryId: "tv", page: 18 });
  assert.equal(last.page, 18);
  assert.equal(lastRequests.filter((r) => r.url === categoryUrl).length, 2);
  assert.equal(last.list.length, 24);
});

test("search uses y parameter and returns relevant results", async () => {
  const requests = [];
  const { spider } = loadSpider(requests, files);
  const result = await spider.search({ keyword: "挑情丑闻" });
  assert.equal(requests[0].url, searchUrl);
  assert.equal(result.pagecount, 1);
  assert.equal(result.list.length, 8);
  assert.match(result.list[0].vod_name, /挑情丑闻/);
});

test("detail extracts episodes and direct source", async () => {
  const { spider } = loadSpider([], files);
  const result = await spider.detail({ videoId: detailUrl });
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0].vod_name, "挑情丑闻 第1集");
  assert.equal(result.list[0].vod_play_sources[0].episodes.length, 8);
  assert.match(result.list[0].vod_remarks, /4K HDR/);
});

test("play parses the direct m3u8 source and playback headers", async () => {
  const { spider } = loadSpider([], files);
  const raw = JSON.stringify({ page: detailUrl, title: "挑情丑闻 第1集" });
  const result = await spider.play({ playId: raw });
  assert.equal(result.parse, 0);
  assert.equal(result.jx, 0);
  assert.equal(result.url, "https://www.4k-av.com/tv/210869-the-scandal-ep01/4K/jhoxuv.m3u8");
  assert.equal(result.headers["User-Agent"], "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15");
  assert.equal(result.headers.Referer, detailUrl);
});
