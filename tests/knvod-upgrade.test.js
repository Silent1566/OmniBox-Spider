const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const repoRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(repoRoot, "影视", "采集", "柯南影视.js");
const source = fs.readFileSync(sourcePath, "utf8");

const apiResponse = {
  code: 1,
  msg: "数据列表",
  page: 1,
  pagecount: 3,
  total: 30,
  list: [
    {
      vod_id: 137791,
      vod_name: "星墟流浪者",
      vod_pic: "http://img.example.com/poster.jpg",
      vod_pic_thumb: "",
      vod_remarks: "1080P",
    },
  ],
};

function loadSpider({ firstStatus = 200 } = {}) {
  const requests = [];
  let challenged = false;
  const OmniBox = {
    log: async () => {},
    request: async (url, options = {}) => {
      requests.push({ url, method: options.method || "GET", headers: options.headers || {}, body: options.body });
      if (!challenged && firstStatus !== 200) {
        challenged = true;
        return {
          statusCode: firstStatus,
          headers: {
            "set-cookie": [
              "gate=first-value; Path=/; Max-Age=7200",
              "server_session_86dbda3b=session-value; Max-Age=864000; HttpOnly; Path=/",
            ],
          },
          body: '<script>window.location.href="/";</script>',
        };
      }
      if (url === "https://www.knvod.com/index.php/api/vod") {
        return { statusCode: 200, headers: {}, body: JSON.stringify(apiResponse) };
      }
      if (url === "https://www.knvod.com/vplay/137791-1-1.html") {
        return { statusCode: 200, headers: {}, body: '<html><body>播放页</body></html>' };
      }
      return { statusCode: 200, headers: {}, body: "" };
    },
  };
  const context = {
    module: { exports: {} },
    require(id) {
      if (id === "omnibox_sdk") return OmniBox;
      if (id === "spider_runner") return { run: () => {} };
      if (id === "crypto-js") return require("crypto-js");
      return require(id);
    },
    setTimeout,
    clearTimeout,
    Buffer,
    URL,
    URLSearchParams,
  };
  vm.runInNewContext(source, context, { filename: "柯南影视.js" });
  return { spider: context.module.exports, requests };
}

test("metadata upgrades knvod API and challenge handling", () => {
  assert.equal(source.match(/@version\s+([^\n*]+)/)?.[1].trim(), "1.0.2");
  assert.match(source, /index\.php\/api\/vod/);
  assert.match(source, /siteCookies/);
  assert.match(source, /statusCode === 403 \|\| statusCode === 429/);
});

test("home retries the 403/429 challenge with cookies and maps API items", async () => {
  const { spider, requests } = loadSpider({ firstStatus: 403 });
  const result = await spider.home({});
  assert.equal(result.list.length, 3);
  assert.equal(result.list[0].vod_id, "137791");
  assert.equal(result.list[0].vod_name, "星墟流浪者");
  assert.equal(result.list[0].vod_pic, "https://img.example.com/poster.jpg");
  assert.equal(result.list[0].vod_remarks, "1080P");
  assert.equal(requests[0].headers.Cookie, undefined);
  const apiRequests = requests.filter((item) => item.url === "https://www.knvod.com/index.php/api/vod");
  assert.equal(apiRequests.length, 4);
  assert.ok(apiRequests.slice(3).every((item) => item.headers.Cookie === "gate=first-value; server_session_86dbda3b=session-value"));
});

test("category and search use the signed list API", async () => {
  const { spider, requests } = loadSpider();
  const category = await spider.category({ categoryId: "2", page: 2 });
  assert.equal(category.page, 1);
  assert.equal(category.pagecount, 3);
  assert.equal(category.total, 30);
  assert.equal(category.list[0].vod_name, "星墟流浪者");
  const search = await spider.search({ keyword: "斗罗" });
  assert.equal(search.list[0].vod_id, "137791");
  const apiRequests = requests.filter((item) => item.url === "https://www.knvod.com/index.php/api/vod" && item.method === "POST" && item.body);
  assert.equal(apiRequests.length, 2);
  assert.match(apiRequests[0].body, /type=2/);
  assert.match(apiRequests[0].body, /page=2/);
  assert.match(apiRequests[0].body, /time=\d+/);
  assert.match(apiRequests[0].body, /key=[0-9a-f]{32}/);
  assert.match(apiRequests[1].body, /wd=%E6%96%97%E7%BD%97/);
  assert.match(apiRequests[1].body, /tag=/);
});

test("play falls back to sniff mode for a page target", async () => {
  const { spider } = loadSpider();
  const result = await spider.play({ playId: "https://www.knvod.com/vplay/137791-1-1.html" });
  assert.equal(result.parse, 1);
  assert.equal(result.jx, 1);
  assert.equal(result.url, "https://www.knvod.com/vplay/137791-1-1.html");
});
