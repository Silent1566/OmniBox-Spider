const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "影视", "采集", "歪比巴卜.js");
const source = fs.readFileSync(sourcePath, "utf8");
const fixtureRoot = path.join(repoRoot, "tests", "fixtures", "wbbb");

function loadSpider(files) {
  const spiderModule = { exports: {} };
  const requests = [];
  let seen403 = false;
  let after403 = false;
  const axios = Object.assign(() => { throw new Error("unexpected direct axios call"); }, {
    create() {
      return {
        async get(url, options = {}) {
          requests.push({ url, options });
          const cookie = options.headers?.Cookie || "";
          const sawChallengeBefore = seen403;
          let res;
          if (seen403 && cookie) {
            res = { status: 200, data: files[url], headers: {} };
          } else if (url === "https://wbbb1.com/detail/114814.html") {
            seen403 = true;
            after403 = true;
            res = {
              status: 403,
              data: '<script> window.location.href ="/detail/114814.html"; </script>',
              headers: {
                "set-cookie": [
                  "gate=first-value; Path=/; Max-Age=7200",
                  "server_session_7b5e401d=session-value; Max-Age=864000; HttpOnly; Path=/",
                ],
              },
            };
          } else {
            res = { status: 200, data: files[url] || "", headers: {} };
          }
          assert.ok(!sawChallengeBefore || !!cookie, "expected a Cookie header after the 403 challenge");
          return res;
        },
        async post(url, data, options = {}) {
          requests.push({ url, options });
          return { status: 200, data: "", headers: {} };
        },
      };
    },
  });
  const localRequire = (id) => {
    if (id === "omnibox_sdk") return { log: async () => {} };
    if (id === "spider_runner") return { run: () => {} };
    if (id === "axios") return axios;
    if (id === "crypto-js") return require("node:crypto");
    return require(id);
  };
  const context = {
    module: spiderModule,
    exports: spiderModule.exports,
    require: localRequire,
    process: { env: {} },
    setTimeout,
    clearTimeout,
    Buffer,
    URL,
    URLSearchParams,
  };
  vm.runInNewContext(source, context, { filename: "歪比巴卜.js" });
  return { spider: spiderModule.exports, requests };
}

const detailUrl = "https://wbbb1.com/detail/114814.html";

test("metadata upgrades the cookie challenge workaround", () => {
  assert.equal(source.match(/@version\s+([^\n*]+)/)?.[1].trim(), "1.0.7");
  assert.match(source, /mergeCookies\(res\.headers\?\.\['set-cookie'\]\)/);
  assert.match(source, /looksLikeCookieChallenge/);
});

test("detail retries with cookies saved from the 403 challenge", async () => {
  const files = { [detailUrl]: fs.readFileSync(path.join(fixtureRoot, "detail.html"), "utf8") };
  const { spider, requests } = loadSpider(files);
  const result = await spider.detail({ videoId: "114814" });
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0].vod_name, "深渊无间");
  assert.equal(result.list[0].vod_play_sources[0].episodes.length, 16);
  const detailRequests = requests.filter((r) => r.url === detailUrl).map((r) => ({ ...r, options: { ...r.options, headers: r.options.headers ? { ...r.options.headers } : undefined } }));
  assert.equal(detailRequests.length, 2);
  assert.equal(detailRequests[0].options.headers?.Cookie, undefined);
  assert.equal(detailRequests[1].options.headers?.Cookie, "gate=first-value; server_session_7b5e401d=session-value");
});

test("home can reuse cookies without breaking normal requests", async () => {
  const files = { "https://wbbb1.com/": fs.readFileSync(path.join(fixtureRoot, "home.html"), "utf8") };
  const { spider, requests } = loadSpider(files);
  const result = await spider.home({});
  assert.ok(result.list.length > 0);
  assert.ok(requests.every((r) => !(r.options?.headers || {}).Cookie));
});
