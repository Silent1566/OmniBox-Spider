const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sources = ["4K指南.js", "七味分组.js", "影巢.js", "玩偶聚合-非分组.js", "玩偶聚合.js", "盘搜.js", "盘搜分组.js", "聚盘搜索.js", "聚盘搜索分组.js", "Echo4K.js"];
const shareURL = "https://pan.quark.cn/s/history-fixture";
const videoURL = "https://fixture.invalid/video.mp4";
const header = { Referer: "https://fixture.invalid/", "User-Agent": "fixture" };
const danmaku = [{ time: 1, text: "fixture" }];
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");

function loadSpider(filename, historyAvailable) {
  const calls = { history: [], drive: [], metadata: [], danmaku: [], http: [], logs: [] };
  const sdk = {
    log: async (...args) => calls.logs.push(args),
    getCache: async () => null,
    setCache: async () => {},
    getDriveVideoPlayInfo: async (...args) => {
      calls.drive.push(args);
      return { url: [{ name: "播放", url: videoURL }], header, danmaku: [] };
    },
    getScrapeMetadata: async (resourceId) => {
      calls.metadata.push(resourceId);
      return { scrapeType: "movie", scrapeData: { title: "Fixture Movie", posterPath: "/fixture.jpg" }, videoMappings: [
        { fileId: shareURL + "|fixture-file", episodeNumber: 1, episodeName: "正片" },
        { fileId: shareURL + "|fixture-file|" + resourceId, episodeNumber: 1, episodeName: "正片" },
        { fileId: encodeURIComponent(shareURL) + "|fixture-file", episodeNumber: 1, episodeName: "正片" },
      ] };
    },
    getDanmakuByFileName: async (name) => { calls.danmaku.push(name); return danmaku; },
    sniffVideo: async () => ({ url: videoURL, header }),
  };
  sdk.getDriveMetadata = sdk.getScrapeMetadata;
  if (historyAvailable) sdk.addPlayHistory = async (payload) => { calls.history.push(payload); return true; };
  const http = async (...args) => {
    calls.http.push(args);
    throw new Error("unexpected HTTP request in controlled playback test");
  };
  http.create = () => http;
  http.get = http;
  http.post = http;
  const spiderModule = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, "..", "影视", "网盘", filename), "utf8");
  vm.runInNewContext(source, {
    module: spiderModule, exports: spiderModule.exports,
    require: (id) => {
      if (id === "omnibox_sdk") return sdk;
      if (id === "spider_runner") return { run: () => {} };
      if (id === "axios") return http;
      if (id === "cheerio") return { load: () => { throw new Error("unexpected HTML parsing"); } };
      return require(id);
    },
    process: { env: {} }, URL, URLSearchParams, Buffer, setTimeout, clearTimeout, performance,
  }, { filename });
  return { spider: spiderModule.exports, calls };
}

function playbackParams(filename) {
  let playId = shareURL + "|fixture-file";
  if (filename.startsWith("聚盘搜索")) {
    playId = encode({ shareURL, fid: "fixture-file", title: "Fixture Movie", epName: "正片", resourceId: "fixture-resource" });
  } else if (filename.startsWith("玩偶聚合")) {
    playId += "|fixture-resource";
  }
  return { playId, flag: "夸克-直连", vodId: "fixture-resource", title: "Fixture Movie", vodName: "Fixture Movie", episodeName: "正片" };
}

for (const filename of sources) {
  for (const historyAvailable of [true, false]) {
    test(filename + " preserves SDK playback and danmaku without history (SDK " + (historyAvailable ? "present" : "missing") + ")", async () => {
      const { spider, calls } = loadSpider(filename, historyAvailable);
      const result = await spider.play(playbackParams(filename), { sourceId: "fixture-source", from: "tvbox" });
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(JSON.parse(JSON.stringify(result.urls)), [{ name: "播放", url: videoURL }]);
      assert.deepEqual(JSON.parse(JSON.stringify(result.header)), header);
      assert.deepEqual(JSON.parse(JSON.stringify(result.danmaku)), danmaku);
      assert.equal(result.parse, 0);
      assert.deepEqual(calls.drive, [[shareURL, "fixture-file", "直连"]]);
      assert.equal(calls.metadata.length, 1);
      assert.deepEqual(calls.danmaku, [filename.startsWith("聚盘搜索") ? "Fixture Movie 正片" : "Fixture Movie"]);
      assert.equal(calls.http.length, 0);
      assert.equal(calls.history.length, 0, "playback must not write history");
      assert.equal(calls.logs.some((args) => /观看记录|播放记录/.test(args.join(" "))), false, "playback must not attempt or log history");
    });
  }
}

for (const filename of ["七味分组.js", "盘搜分组.js"]) {
  test(filename + " preserves magnet playback without history", async () => {
    const { spider, calls } = loadSpider(filename, true);
    const magnet = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789";
    const result = await spider.play({ playId: magnet, title: "Fixture Magnet" }, { sourceId: "fixture-source", from: "tvbox" });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(result.urls[0].url, magnet);
    assert.equal(result.parse, 0);
    assert.equal(calls.history.length, 0, "magnet playback must not write history");
    assert.equal(calls.http.length, 0);
  });
}

test("七味分组.js preserves sniffed playback without history when DANMU_API is unset", async () => {
  const { spider, calls } = loadSpider("七味分组.js", true);
  const result = await spider.play({ playId: "https://fixture.invalid/player.html", vodName: "Fixture Movie" }, { sourceId: "fixture-source" });
  assert.equal(result.urls[0].url, videoURL);
  assert.equal(result.parse, 0);
  assert.equal(calls.history.length, 0);
});
