const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sources = ["AListTvbox", "二小", "剧迷115", "多多", "快映", "木偶", "欧哥", "玩偶", "至臻", "虎斑", "蜗牛4K", "蜡笔", "闪电"];
const shareURL = "https://pan.quark.cn/s/local-fixture";
const fileId = "fixture-file";
const vodId = "fixture-video";
const mediaURL = "https://media.example/fixture.mp4";
const header = { Referer: "https://media.example/" };
const danmaku = [{ name: "fixture", url: "https://danmaku.example/fixture.xml" }];

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadSpider(name, { historyAvailable = true, metadataAvailable = true, mappingAvailable = true } = {}) {
  const logs = [];
  const historyAccesses = [];
  const historyWrites = [];
  const playRequests = [];
  const metadataRequests = [];
  const danmakuRequests = [];
  const httpRequests = [];
  const sdk = {
    log: async (level, message) => logs.push(`${level}:${message}`),
    getCache: async () => null,
    setCache: async () => {},
    getDriveVideoPlayInfo: async (...args) => {
      playRequests.push(args);
      return { url: [{ name: "原画", url: mediaURL }], header, danmaku: [{ name: "SDK fallback" }] };
    },
    getScrapeMetadata: async (id) => {
      metadataRequests.push(id);
      if (!metadataAvailable) return null;
      const mappingId = name === "AListTvbox" ? `${vodId}|fixture-id` : name === "剧迷115" ? `${shareURL}|${fileId}` : `${shareURL}|${fileId}|${vodId}`;
      return {
        scrapeType: "tv",
        scrapeData: { title: "刮削标题", posterPath: "/fixture.jpg", seasonAirYear: "2024" },
        videoMappings: mappingAvailable ? [{ fileId: mappingId, seasonNumber: 2, episodeNumber: 3, episodeName: "第3集" }] : [],
      };
    },
    getDanmakuByFileName: async (fileName) => {
      danmakuRequests.push(fileName);
      return metadataAvailable ? danmaku : [];
    },
  };
  for (const api of ["getAnalyzeSites", "addhistory", "addPlayHistory"]) {
    Object.defineProperty(sdk, api, {
      get() {
        historyAccesses.push(api);
        return historyAvailable ? async (params) => { historyWrites.push({ api, params }); return true; } : undefined;
      },
    });
  }
  const axios = async () => { throw new Error("unexpected HTTP request"); };
  axios.create = () => ({
    get: async (url, options) => {
      assert.equal(name, "AListTvbox");
      assert.match(url, /^\/play\//);
      httpRequests.push({ url, options });
      return { status: 200, data: { url: mediaURL, header: JSON.stringify(header) } };
    },
  });
  const spiderModule = { exports: {} };
  const localRequire = (id) => {
    if (id === "omnibox_sdk") return sdk;
    if (id === "spider_runner") return { run: () => {} };
    if (id === "axios") return axios;
    if (id === "cheerio") return { load: () => { throw new Error("unexpected HTML parsing"); } };
    if (["fs", "http", "https"].includes(id)) return require(id);
    throw new Error(`unexpected dependency: ${id}`);
  };
  const filename = path.join(__dirname, "..", "影视", "网盘", `${name}.js`);
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module: spiderModule,
    exports: spiderModule.exports,
    require: localRequire,
    process: { env: { XIAOYA_ENABLE_PROXY: "0" } },
    URL, URLSearchParams, Buffer, performance, setTimeout, clearTimeout,
  }, { filename });
  return { spider: spiderModule.exports, logs, historyAccesses, historyWrites, playRequests, metadataRequests, danmakuRequests, httpRequests };
}

function playParams(name, share = shareURL) {
  const playId = name === "AListTvbox" ? "fixture-id"
    : name === "剧迷115" ? JSON.stringify({ shareURL: share, fileId, routeType: "直连" })
      : `${share}|${fileId}|${vodId}`;
  return { playId, vodId, title: "原始标题", episodeName: "第3集", flag: "网盘-直连", source: "web" };
}

for (const name of sources) {
  for (const historyAvailable of [true, false]) {
    test(`${name} ${name === "剧迷115" ? "keeps its existing blocked playback free of history" : "preserves successful playback without history"} (API ${historyAvailable ? "present" : "missing"})`, async (t) => {
      const h = loadSpider(name, { historyAvailable });
      const result = plain(await h.spider.play(playParams(name), { sourceId: "fixture-source", from: "web", baseURL: "http://127.0.0.1:1234" }));
      await Promise.resolve();
      if (name === "剧迷115") {
        t.diagnostic(`成功播放路径未验证；当前返回 ${JSON.stringify(result)}；日志 ${h.logs.join("; ")}`);
        assert.deepEqual(h.historyWrites, [], "play must not write history");
        assert.deepEqual(h.historyAccesses, [], "play must not probe history APIs");
        return;
      }
      assert.deepEqual(result.urls, [{ name: name === "AListTvbox" ? "RAW" : "原画", url: mediaURL }]);
      assert.deepEqual(result.header, header);
      assert.equal(result.parse, 0);
      assert.deepEqual(result.danmaku, danmaku);
      assert.deepEqual(h.metadataRequests, [vodId]);
      assert.deepEqual(h.danmakuRequests, ["刮削标题.2024.S02E03"]);
      if (name === "AListTvbox") {
        assert.equal(h.httpRequests.length, 1);
        assert.deepEqual(plain(h.httpRequests[0].options.params), { id: "fixture-id" });
      } else {
        assert.deepEqual(h.playRequests, [[shareURL, fileId, "直连"]]);
      }
      assert.deepEqual(h.historyWrites, [], "play must not write history");
      assert.deepEqual(h.historyAccesses, [], "play must not probe history APIs");
      assert.doesNotMatch(h.logs.join("\n"), /观看记录|历史|addPlayHistory|getAnalyzeSites|addhistory/);
    });
  }
}

for (const name of ["二小", "多多", "木偶", "玩偶", "蜗牛4K"]) {
  test(`${name} preserves SDK danmaku fallback when metadata is absent`, async () => {
    const h = loadSpider(name, { historyAvailable: false, metadataAvailable: false });
    const result = plain(await h.spider.play(playParams(name), { sourceId: "fixture-source", from: "web" }));
    assert.deepEqual(result.urls, [{ name: "原画", url: mediaURL }]);
    assert.deepEqual(result.danmaku, [{ name: "SDK fallback" }]);
    assert.deepEqual(h.historyAccesses, []);
  });
}

for (const name of ["木偶", "蜗牛4K"]) {
  test(`${name} keeps UC direct-play headers empty`, async () => {
    const h = loadSpider(name, { historyAvailable: false, metadataAvailable: false });
    const result = plain(await h.spider.play(playParams(name, "https://drive.uc.cn/s/local-fixture"), { sourceId: "fixture-source", from: "web" }));
    assert.deepEqual(result.urls, [{ name: "原画", url: mediaURL }]);
    assert.deepEqual(result.header, {});
    assert.deepEqual(h.historyAccesses, []);
  });
}

test("AListTvbox keeps scraped-title fallback danmaku matching", async () => {
  const h = loadSpider("AListTvbox", { historyAvailable: false, mappingAvailable: false });
  const params = { ...playParams("AListTvbox"), title: "", episodeName: "" };
  const result = plain(await h.spider.play(params, { sourceId: "fixture-source" }));
  assert.deepEqual(result.urls, [{ name: "RAW", url: mediaURL }]);
  assert.deepEqual(result.danmaku, danmaku);
  assert.deepEqual(h.danmakuRequests, ["刮削标题"]);
  assert.deepEqual(h.historyAccesses, []);
});
