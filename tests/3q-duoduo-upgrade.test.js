const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "影视", "采集", "3Q影视.js"), "utf8");

const RELEASE_HOST = "duoduozhuiju.com";
const SITE_HOST = "duoduo-site-1.top";
const FALLBACK_HOST = "duoduo-fallback.top";

const RELEASE_HTML = `<!doctype html><html><body><script src="/js/config.js"></script><a href="https://${FALLBACK_HOST}/"></a></body></html>`;
const RELEASE_CONFIG = `window.SITE_CONFIG={lines:[{name:'线路 1',host:'${SITE_HOST}'},{name:'线路 2',host:'${FALLBACK_HOST}'}]};`;

function getVersion(text) {
  return text.match(/^\/\/ @version (.+)$/m)?.[1] || "";
}

function createFakeAxios(requests) {
  const requestJson = {
    code: 200,
    msg: "success",
    data: [],
  };
  const instance = {
    async get(url, options = {}) {
      const target = new URL(url, `https://${RELEASE_HOST}/`);
      requests.push({ url: target.href, headers: options.headers || {} });
      if (target.host === "bbys.app") {
        const error = new Error(`Request failed with status code 404: ${target.href}`);
        error.response = { status: 404, data: "" };
        throw error;
      }
      if (target.host === RELEASE_HOST && target.pathname === "/") {
        return { status: 200, data: RELEASE_HTML };
      }
      if (target.host === RELEASE_HOST && target.pathname === "/js/config.js") {
        return { status: 200, data: RELEASE_CONFIG };
      }
      if (target.host === SITE_HOST || target.host === FALLBACK_HOST) {
        assert.match(options.headers?.["User-Agent"] || "", /Chrome\/142/);
        assert.equal(options.headers?.["web-sign"], "ddtvf65f3a83d6d9ad6f");
        if (target.pathname === "/api.php/web/index/home") {
          return { status: 200, data: { code: 200, data: { categories: [] } } };
        }
        if (target.pathname === "/api.php/web/search/index") {
          return {
            status: 200,
            data: {
              code: 200,
              data: [{
                vod_id: 139148,
                vod_name: "蜘蛛侠",
                vod_pic: "https://example.com/poster.jpg",
                vod_remarks: "全65集",
                type_name: "动漫",
                vod_class: ["动作", "冒险"],
                vod_year: 1994,
              }],
            },
          };
        }
        if (target.pathname === "/api.php/web/vod/get_detail") {
          return {
            status: 200,
            data: {
              code: 200,
              data: [{
                vod_id: 139148,
                vod_name: "蜘蛛侠",
                vod_pic: "https://example.com/poster.jpg",
                vod_remarks: "全65集",
                vod_content: "简介",
                vod_year: "1994",
                vod_area: ["英国"],
                vod_actor: "演员",
                vod_director: "导演",
                type_name: "动漫",
                vod_play_from: "missing-player$$$external",
                vod_play_url: "第1集$encrypted-url",
              }],
              vodplayer: [],
            },
          };
        }
      }
      const error = new Error(`Request failed with status code 404: ${target.href}`);
      error.response = { status: 404, data: "" };
      throw error;
    },
    async post(url, data, options = {}) {
      const target = new URL(url, `https://${RELEASE_HOST}/`);
      requests.push({ url: target.href, headers: options.headers || {} });
      if (target.pathname === "/api.php/web/decode/url") {
        return {
          status: 200,
          data: new Uint8Array([0x08, 0x00, 0x12, 0x0a, 0x48, 0x54, 0x54, 0x50, 0xe9, 0x94, 0x99, 0xe8, 0xaf, 0xaf]).buffer,
        };
      }
      const error = new Error(`Request failed with status code 404: ${target.href}`);
      error.response = { status: 404, data: "" };
      throw error;
    },
  };
  const axios = Object.assign(() => {
    throw new Error("unexpected direct axios call");
  }, {
    create: (options) => {
      const wrapped = {
        async get(url, requestOptions = {}) {
          return await instance.get(url, requestOptions);
        },
        async post(url, data, requestOptions = {}) {
          return await instance.post(url, data, requestOptions);
        },
      };
      return wrapped;
    },
    get: (url, options) => instance.get(url, options),
  });
  return axios;
}

function loadSpider(requests) {
  const spiderModule = { exports: {} };
  const cache = new Map();
  const sdk = {
    log: async () => {},
    getCache: async (key) => cache.get(key) ?? null,
    setCache: async (key, value) => { cache.set(key, value); },
    sniffVideo: async () => null,
    getScrapeMetadata: async () => null,
    processScraping: async () => {},
    request: async () => ({ statusCode: 200, body: "{}" }),
  };
  const localRequire = (id) => {
    if (id === "omnibox_sdk") return sdk;
    if (id === "spider_runner") return { run: () => {} };
    if (id === "axios") return createFakeAxios(requests);
    if (id === "url") return require("node:url");
    if (id === "http") return { Agent: require("node:http").Agent, request: () => { throw new Error("unexpected raw http request"); }, get: () => { throw new Error("unexpected raw http get"); } };
    if (id === "https") return { Agent: require("node:https").Agent, request: () => { throw new Error("unexpected raw https request"); }, get: () => { throw new Error("unexpected raw https get"); } };
    if (id === "crypto") return require("node:crypto");
    return require(id);
  };
  const context = {
    module: spiderModule,
    exports: spiderModule.exports,
    require: localRequire,
    process: { env: {} },
    global: globalThis,
    TextEncoder,
    TextDecoder,
    WebAssembly,
    URL,
    URLSearchParams,
    Buffer,
    performance,
    setTimeout,
    clearTimeout,
    console,
    crypto: require("node:crypto"),
  };
  vm.runInNewContext(source, context, { filename: "3Q影视.js" });
  return spiderModule.exports;
}

test("3Q upgrades metadata and uses the Duoduo release page", () => {
  assert.doesNotMatch(source, /wasmUrl:/);
  const version = getVersion(source);
  const [major, minor] = version.split(".").map(Number);
  assert.equal(Number.isFinite(major) && Number.isFinite(minor), true);
  assert.ok(major > 1 || (major === 1 && minor >= 1), `expected >=1.1.0, got ${version}`);
  assert.match(source, /duoduozhuiju\.com/);
  assert.match(source, /ddtvf65f3a83d6d9ad6f/);
  assert.match(source, /web_app_wasm_bg-Bxwbrgev\.wasm/);
  assert.doesNotMatch(source, /host:\s*['"]https:\/\/bbys\.app['"]/);
  assert.doesNotMatch(source, /Referer":\s*"https:\/\/bbys\.app\//);
});

test("3Q finds the newest site host and retries search through it", async () => {
  const requests = [];
  const spider = loadSpider(requests);
  const result = await spider.search({ keyword: "蜘蛛侠", page: 1 });

  assert.equal(Array.isArray(result?.list), true);
  assert.equal(result?.list?.[0]?.vod_name, "蜘蛛侠");
  assert.equal(result?.list?.[0]?.type_name, "动漫,动作,冒险");
  assert.equal(result?.list?.[0]?.vod_year, "1994");
  const hosts = [...new Set(requests.map((r) => new URL(r.url).host))];
  assert.equal(hosts.includes(SITE_HOST), true);
  assert.equal(hosts.includes("bbys.app"), false);
});

test("3Q keeps external detail lines when the player metadata is missing", async () => {
  const requests = [];
  const spider = loadSpider(requests);
  const result = await spider.detail({ videoId: "139148" });
  const vod = result?.list?.[0];
  assert.equal(vod?.vod_name, "蜘蛛侠");
  assert.equal(vod?.vod_area, "英国");
  assert.equal(vod?.vod_play_sources?.length, 1);
  assert.match(vod?.vod_play_sources?.[0]?.episodes?.[0]?.playId || "", /^missing-player@0@encrypted-url(?:\|\|\|.+)?$/);
});

test("3Q no longer uses legacy raw HTTP clients for site requests", () => {
  const siteRequestSpan = source.slice(source.indexOf("async function fetchReleaseHosts"), source.indexOf("// ========== 刮削和弹幕辅助函数"));
  assert.doesNotMatch(siteRequestSpan, /https\.request|https\.get/);
  assert.match(siteRequestSpan, /_http\.post\(/);
  assert.match(siteRequestSpan, /web_app_wasm_bg-Bxwbrgev\.wasm/);
});
