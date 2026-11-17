const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const standalone = fs.readFileSync(path.join(repoRoot, "影视", "网盘", "蜗牛4K.js"), "utf8");
const aggregate = fs.readFileSync(path.join(repoRoot, "影视", "网盘", "玩偶聚合.js"), "utf8");

function getSiteConfig(source, siteId) {
  const idIndex = source.indexOf(`id: "${siteId}"`);
  assert.notEqual(idIndex, -1, `missing site config: ${siteId}`);
  const start = source.lastIndexOf("pushSiteIfAny({", idIndex);
  const end = source.indexOf("\n});", idIndex);
  assert.notEqual(start, -1, `missing config start: ${siteId}`);
  assert.notEqual(end, -1, `missing config end: ${siteId}`);
  return source.slice(start, end + 4);
}

function getVersion(source) {
  return source.match(/^\/\/ @version (.+)$/m)?.[1] || "";
}

function loadSpider(source, filename) {
  const spiderModule = { exports: {} };
  const sdk = {
    log: async () => {},
    getCache: async () => null,
    setCache: async () => {},
  };
  const localRequire = (id) => {
    if (id === "omnibox_sdk") return sdk;
    if (id === "spider_runner") return { run: () => {} };
    if (id === "axios") return async () => ({ status: 200, headers: {}, data: "" });
    if (id === "cheerio") return { load: () => { throw new Error("unexpected HTML parsing"); } };
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
  }, { filename });

  return spiderModule.exports;
}

test("蜗牛4K supports the panlian_dark page structure", () => {
  assert.equal(getVersion(standalone), "1.0.4");
  assert.match(standalone, /\$\("a\.video-card"\)/);
  assert.match(standalone, /\.mobile-detail-title/);
  assert.match(standalone, /\.premium-meta-grid \.meta-item/);
  assert.match(standalone, /\.pan-link-item\[data-pan-item\]/);
});

test("蜗牛4K keeps a login session and rate-limits drive API requests", () => {
  assert.match(standalone, /const DRIVE_API_DELAY_MS =/);
  assert.match(standalone, /let cookieStore = \{\}/);
  assert.match(standalone, /async function login\(params\)/);
  assert.match(standalone, /setCookies: setCookiesFromString/);
  assert.doesNotMatch(standalone, /const panUrlTasks = panUrls\.map/);
});

test("玩偶聚合 parses the new 蜗牛4K cards and detail fields", () => {
  const woniuConfig = getSiteConfig(aggregate, "woniu4k");
  const wanouConfig = getSiteConfig(aggregate, "wanou");
  assert.equal(getVersion(aggregate), "1.2.6");
  assert.match(woniuConfig, /listSelector: "[^"]*a\.video-card/);
  assert.match(woniuConfig, /searchListSelector: "[^"]*a\.video-card/);
  assert.doesNotMatch(wanouConfig, /a\.video-card/);
  assert.match(aggregate, /\$item\.attr\("href"\)/);
  assert.match(aggregate, /\.premium-title/);
  assert.match(aggregate, /\.premium-meta-grid \.meta-item/);
  assert.match(aggregate, /\.pan-link-item\[data-pan-item\]/);
});

test("玩偶聚合 scopes 蜗牛4K session and throttling behavior", () => {
  assert.match(aggregate, /const WONIU4K_DRIVE_API_DELAY_MS =/);
  assert.match(aggregate, /site\.id === "woniu4k" \? 1 : 4/);
  assert.match(aggregate, /if \(!isWoniuURL\(url\)\) return ""/);
  assert.match(aggregate, /async function login\(params\)/);
  assert.match(aggregate, /setCookies: setCookiesFromString/);
});

test("category handlers return objects to the Spider Runner", async () => {
  const standaloneSpider = loadSpider(standalone, "蜗牛4K.js");
  const aggregateSpider = loadSpider(aggregate, "玩偶聚合.js");

  const standaloneResult = await standaloneSpider.category({ categoryId: "", page: 1 });
  const aggregateResult = await aggregateSpider.category({ categoryId: "", page: 1 }, {});

  assert.equal(typeof standaloneResult, "object");
  assert.equal(typeof aggregateResult, "object");
  assert.equal(Array.isArray(standaloneResult.list), true);
  assert.equal(Array.isArray(aggregateResult.list), true);
});
