const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const mediaUrl = "https://media.example/video.mp4";
const comments = [{ name: "字幕", url: "https://media.example/danmaku.xml" }];
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const metadata = {
  scrapeType: "tv",
  scrapeData: { title: "测试剧", posterPath: "/poster.jpg", seasonNumber: 1 },
  videoMappings: ["file", "show#1", "1", "show|1", "file|https://pan.quark.cn/s/test"].map((fileId) => ({
    fileId, seasonNumber: 1, episodeNumber: 1, episodeName: "第一集",
  })),
};
const combined = (main, extra = {}) => main + "|||" + encode({
  sid: "show", fid: "show#1", v: "测试剧", e: "第一集", n: 1, name: "第一集", ...extra,
});
const cases = [
  { name: "影视库 site", file: "影视/影视库/影视库.js", kind: "site", params: { playId: mediaUrl + "|show", title: "测试剧", episodeName: "第一集" } },
  { name: "影视库 webdav", file: "影视/影视库/影视库.js", kind: "webdav", params: { playId: mediaUrl + "|show", title: "测试剧", episodeName: "第一集" } },
  { name: "影视库 cloud", file: "影视/影视库/影视库.js", kind: "cloud_share", params: { playId: "file|show", title: "测试剧", episodeName: "第一集" } },
  { name: "Auete影视", file: "影视/采集/Auete影视.js", params: { playId: encode({ playPath: "/play/1.html", referer: "/detail/show", vodName: "测试剧", episodeName: "第一集" }) } },
  { name: "LIBVIO 直链", file: "影视/采集/LIBVIO.js", params: { playId: combined("/play/1.html") } },
  { name: "LIBVIO 网盘", file: "影视/采集/LIBVIO.js", params: { playId: combined("/play/1.html", { mode: "pan-file", shareUrl: "https://pan.quark.cn/s/test", fileId: "file" }) } },
  { name: "枫叶", file: "影视/采集/枫叶.js", params: { playId: combined("1") } },
  { name: "枫叶4K", file: "影视/采集/枫叶4K.js", params: { playId: combined("1") } },
  { name: "爱奇艺资源站", file: "影视/采集/爱奇艺资源站.js", params: { playId: encode({ url: mediaUrl, resourceId: "show", fileId: "show#1", vodId: "show", name: "测试剧", epName: "第一集" }) } },
  { name: "电影人生", file: "影视/采集/电影人生.js", params: { playId: JSON.stringify({ page: "https://movie.example/play/1", title: "第一集", vodName: "测试剧" }) } },
  { name: "茶杯狐", file: "影视/采集/茶杯狐.js", params: { playId: combined("/play/1.html") } },
  { name: "荐片", file: "影视/采集/荐片.js", params: { playId: combined(mediaUrl), vodId: "show" } },
  { name: "金牌", file: "影视/采集/金牌.js", params: { playId: JSON.stringify({ vodId: "show", nid: "1", title: "测试剧", episodeName: "第一集" }) } },
];

function loadSpider(spec, apiAvailable) {
  const forbidden = [];
  const calls = [];
  const logs = [];
  const responseFor = (url) => {
    calls.push(["request", String(url)]);
    let body;
    let statusCode = 200;
    let headers = {};
    if (spec.name === "Auete影视") {
      body = 'var pn="第一集";var next=base64decode("' + Buffer.from(mediaUrl).toString("base64") + '");';
    } else if (spec.name === "电影人生") {
      if (String(url).includes("/api/m3u8?")) {
        statusCode = 302;
        headers = { location: mediaUrl };
        body = "";
      } else if (url === mediaUrl) {
        body = "#EXTM3U\n#EXTINF:1\nvideo.ts";
      } else {
        body = '<iframe src="/api/m3u8?origin=test&url=abc123"></iframe>';
      }
    } else if (spec.name === "金牌") {
      body = JSON.stringify({ code: 200, data: { list: [{ name: "高清", url: mediaUrl }] } });
    } else if (String(url).includes("/foxplay/api.php")) {
      body = JSON.stringify({ code: 200, data: { url: mediaUrl, urlmode: 0 } });
    } else {
      body = '<script>var player_aaaa=' + JSON.stringify({ url: mediaUrl, encrypt: 0, from: "direct" }) + '</script>';
    }
    return { statusCode, headers, body };
  };
  const sdk = new Proxy({
    log: async (level, message) => { logs.push([level, message]); },
    request: async (url) => responseFor(url),
    getCache: async () => null,
    setCache: async (key) => { calls.push(["setCache", key]); },
    getMediaItem: async () => ({ title: "测试剧", from: "https://pan.quark.cn/s/test", playbackPayload: { kind: spec.kind, header: { Authorization: "test" } } }),
    getScrapeMetadata: async (id) => { calls.push(["metadata", id]); return metadata; },
    getDanmakuByFileName: async (name) => { calls.push(["danmaku", name]); return comments; },
    getDriveVideoPlayInfo: async (shareUrl, fileId) => {
      calls.push(["drive", shareUrl, fileId]);
      return { url: [{ name: "原画", url: mediaUrl }], header: { Authorization: "drive" }, danmaku: comments };
    },
  }, {
    get(target, key) {
      if (["getAnalyzeSites", "addhistory", "addPlayHistory", "getVideoMediaInfo"].includes(key)) {
        forbidden.push(String(key));
        if (!apiAvailable) return undefined;
        return async () => key === "getVideoMediaInfo" ? { format: { duration: 3600 } } : true;
      }
      return target[key];
    },
  });
  const transport = {
    request(target, options, callback) {
      if (typeof options === "function") callback = options;
      const url = target instanceof URL ? target.href : (target.protocol + "//" + target.hostname + target.path);
      const request = new EventEmitter();
      request.write = () => {};
      request.destroy = (error) => request.emit("error", error);
      request.end = () => queueMicrotask(() => {
        const value = responseFor(url);
        const response = new EventEmitter();
        response.statusCode = value.statusCode;
        response.headers = value.headers;
        let textEncoding = false;
        response.setEncoding = () => { textEncoding = true; };
        callback(response);
        response.emit("data", textEncoding ? value.body : Buffer.from(value.body));
        response.emit("end");
      });
      return request;
    },
  };
  const spiderModule = { exports: {} };
  const localRequire = (name) => {
    if (name === "omnibox_sdk") return sdk;
    if (name === "spider_runner") return { run() {} };
    if (name === "http" || name === "https") return transport;
    if (name === "cheerio") return { load() { throw new Error("本用例不应进入 DOM 解析"); } };
    if (name === "axios") return { create: () => ({ get() { throw new Error("本用例不应调用 axios"); } }) };
    if (name === "crypto-js") return {
      MD5: (value) => crypto.createHash("md5").update(value).digest("hex"),
      SHA1: (value) => crypto.createHash("sha1").update(value).digest("hex"),
    };
    if (["crypto", "url"].includes(name)) return require(name);
    throw new Error("未受控的依赖: " + name);
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "..", spec.file), "utf8"), {
    module: spiderModule, exports: spiderModule.exports, require: localRequire,
    process: { env: {} }, Buffer, URL, URLSearchParams, console,
    setTimeout, clearTimeout, performance,
  }, { filename: spec.file });
  return { spider: spiderModule.exports, forbidden, calls, logs };
}

for (const spec of cases) {
  for (const apiAvailable of [true, false]) {
    test(spec.name + (apiAvailable ? "：SDK 提供历史 API" : "：SDK 缺少历史 API"), async () => {
      const { spider, forbidden, calls, logs } = loadSpider(spec, apiAvailable);
      const result = await spider.play(spec.params, { sourceId: "source", from: "web" });
      await new Promise(setImmediate);
      assert.equal(result.parse, 0, JSON.stringify(logs));
      assert.equal(result.urls[0]?.url, mediaUrl, JSON.stringify(logs));
      assert.equal(typeof result.header, "object");
      if (!["Auete影视", "电影人生"].includes(spec.name)) {
        assert.deepEqual(JSON.parse(JSON.stringify(result.danmaku)), comments);
        assert.ok(calls.some(([kind]) => kind === "metadata"));
        assert.ok(calls.some(([kind]) => kind === "danmaku"));
      }
      if (spec.kind) assert.equal(result.header.Authorization, spec.kind === "cloud_share" ? "drive" : "test");
      assert.deepEqual(forbidden, [], "播放不应读取或调用历史 API/历史专用时长 API");
      assert.equal(logs.some(([, message]) => /播放记录|观看记录|addPlayHistory/.test(message)), false);
    });
  }
}
