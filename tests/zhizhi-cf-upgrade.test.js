const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "影视", "采集", "枝枝影视.js"), "utf8");

function getVersion(text) {
  return text.match(/^\/\/ @version (.+)$/m)?.[1] || "";
}

function extractBrowserScript(text) {
  const match = text.match(/const script = String\.raw`([\s\S]*?)`;\s*\n\s*const \{ stdout, stderr \}/);
  assert.ok(match, "browser helper script is missing");
  return match[1];
}

function loadSpider({ statusCode = 200, body = "ok", flaresolverr = false, manualCookie = "", cachedCookie = "" } = {}) {
  const module = { exports: {} };
  const requests = [];
  const logs = [];
  const cache = new Map([["zhizhi:cf_clearance", cachedCookie]]);

  const axios = Object.assign(async () => {
    throw new Error("unexpected direct axios request");
  }, {
    post: async (url, data, options = {}) => {
      requests.push({ kind: "flaresolverr", url, data, options });
      if (!flaresolverr) return { status: 502, data: { status: "error", message: "unavailable" } };
      return {
        status: 200,
        data: {
          status: "ok",
          solution: {
            status: 200,
            response: "<!doctype html><title>枝枝详情</title>",
            cookies: [{ name: "cf_clearance", value: "flare-cookie" }],
            userAgent: "FlareSolverr UA",
          },
        },
      };
    },
  });

  const request = async (url, options = {}) => {
    requests.push({ kind: "request", url, options });
    if (manualCookie && String(options.headers?.Cookie || "") !== manualCookie) {
      throw new Error(`cookie missing: ${options.headers?.Cookie}`);
    }
    return { statusCode, body, headers: {} };
  };

  const localRequire = (id) => {
    if (id === "omnibox_sdk") {
      return {
        request,
        log: async (level, message) => logs.push([level, message]),
        getCache: async (key) => cache.get(key) || "",
        setCache: async (key, value) => cache.set(key, value),
      };
    }
    if (id === "spider_runner") return { run: () => {} };
    if (id === "axios") return axios;
    return require(id);
  };

  const context = {
    module,
    exports: module.exports,
    require: localRequire,
    process: { env: { ZHIZHI_HOST: "https://zzoc.cc", ZHIZHI_CF_COOKIE: manualCookie } },
    URL,
    URLSearchParams,
    Buffer,
    performance,
    setTimeout,
    clearTimeout,
    WebSocket,
    global: globalThis,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "枝枝影视.js" });

  return { spider: module.exports, requests, logs, cache };
}

test("枝枝影视 declares axios and FlareSolverr fallback configuration", () => {
  assert.equal(getVersion(source), "1.1.1");
  assert.match(source, /axios\.post\(endpoint/);
  assert.match(source, /ZHIZHI_FLARESOLVERR_URL/);
  assert.match(source, /ZHIZHI_CF_COOKIE/);
  assert.match(source, /ZHIZHI_CF_CACHE_KEY/);
  assert.match(source, /fetchCfClearanceWithBrowser/);
  assert.match(source, /Storage\.getCookies/);
});

test("manual cf_clearance is used before any request and refreshed FlareSolverr cookies are cached", async () => {
  const manual = loadSpider({ statusCode: 403, body: "Just a moment...", manualCookie: "cf_clearance=manual" });
  await manual.spider.category({ categoryId: "1" });
  const siteRequest = manual.requests.find((item) => item.kind === "request" && String(item.url).startsWith("https://zzoc.cc/vodshow/"));
  assert.equal(siteRequest?.options?.headers?.Cookie, "cf_clearance=manual");

  const solved = loadSpider({ statusCode: 403, body: "Just a moment...", flaresolverr: true });
  await solved.spider.category({ categoryId: "1" });
  assert.equal(solved.cache.get("zhizhi:cf_clearance"), "cf_clearance=flare-cookie");
});

test("challenge helper script is valid JavaScript", () => {
  const script = extractBrowserScript(source);
  new vm.Script(script, { filename: "zhizhi-browser-script.js" });
});

test("all spider handlers remain callable", async () => {
  const spider = loadSpider({ statusCode: 200, body: "<!doctype html><title>枝枝</title>", flaresolverr: true }).spider;
  const home = await spider.home();
  const category = await spider.category({ categoryId: "1" });
  const search = await spider.search({ keyword: "测试" });
  const detail = await spider.detail({ videoId: "1" });
  const play = await spider.play({ id: "https://zzoc.cc/vodplay/1.html" });
  assert.equal(Array.isArray(home.list), true);
  assert.equal(Array.isArray(category.list), true);
  assert.equal(Array.isArray(search.list), true);
  assert.equal(Array.isArray(detail.list), true);
  assert.equal(play.parse, 1);
});
