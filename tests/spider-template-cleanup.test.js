const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");

function loadSpider(relativePath, sdk) {
  const spiderModule = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(repoRoot, relativePath), "utf8"),
    {
      module: spiderModule,
      exports: spiderModule.exports,
      require: (id) => {
        if (id === "omnibox_sdk") return sdk;
        if (id === "spider_runner") return { run: () => {} };
        throw new Error("unexpected require: " + id);
      },
      URL,
      URLSearchParams,
      console,
    },
    { filename: relativePath },
  );
  return spiderModule.exports;
}

const quietSdk = {
  log: async () => {},
  request: async () => ({ statusCode: 200, body: "{}" }),
};

for (const relativePath of ["导航/豆瓣推荐.js", "模板/JavaScript/豆瓣推荐.js"]) {
  test(`${relativePath} home 不依赖 getAnalyzeSites`, async () => {
    const home = loadSpider(relativePath, quietSdk).home;

    const result = await home({}, {});

    assert.deepEqual(
      Array.from(result.class).map((item) => item.type_name),
      ["选电影", "选剧集", "选综艺", "电影筛选", "电视剧筛选", "综艺筛选"],
    );
    assert.ok(Array.isArray(result.list), "首页应返回 list");
    assert.ok(Array.isArray(result.banner), "首页应返回 banner");
  });
}

test("推送脚本 play 只返回播放数据，不写播放历史", async () => {
  const historyCalls = [];
  const sdk = {
    ...quietSdk,
    addPlayHistory: async (payload) => {
      historyCalls.push(payload);
      return true;
    },
    getDriveVideoPlayInfo: async () => ({
      url: [{ name: "直连", url: "https://media.test/episode.mp4" }],
      header: { Referer: "https://drive.test/" },
    }),
    getScrapeMetadata: async () => ({
      scrapeType: "tv",
      scrapeData: { title: "示例剧", seasonAirYear: "2024", posterPath: "/poster.jpg" },
      videoMappings: [
        {
          fileId: "https://drive.test/s/share|file-1",
          episodeNumber: 2,
          seasonNumber: 1,
          episodeName: "第2集",
        },
      ],
    }),
    getDanmakuByFileName: async (fileName) =>
      fileName === "示例剧.2024.S01E02" ? [{ text: "示例弹幕", time: 1 }] : [],
  };

  const result = await loadSpider("模板/JavaScript/推送脚本.js", sdk).play({
    playId: "https://drive.test/s/share|file-1",
    flag: "直连",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result.urls)), [
    { name: "直连", url: "https://media.test/episode.mp4" },
  ]);
  assert.equal(result.header.Referer, "https://drive.test/");
  assert.deepEqual(JSON.parse(JSON.stringify(result.danmaku)), [
    { text: "示例弹幕", time: 1 },
  ]);
  assert.deepEqual(historyCalls, [], "播放流程不应再写播放历史");
});
