const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const sourcePath = path.join(process.cwd(), "影视/采集/3Q影视.js");
const source = fs.readFileSync(sourcePath, "utf8");

test("3Q downloads WASM as binary without UTF-8 corruption", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "3q-wasm-"));
  const wasmBytes = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 0x2a]);
  const expectedWasmBytes = Array.from(wasmBytes);
  let sawResponseType = "";
  let sawDecodeBody = "";

  const fakeExports = {
    __wbindgen_start() {},
    __wbindgen_malloc(length) {
      fakeExports.memory.lengthUsed = length;
      return 8;
    },
    __wbindgen_realloc() { return 0; },
    __wbindgen_free() {},
    create_decode_request() { return [32, 2]; },
    get_signature_headers() { return [48, 0]; },
    signatureheaders_aid() { return [0, 0]; },
    signatureheaders_ave() { return [0, 0]; },
    signatureheaders_nonc() { return [0, 0]; },
    signatureheaders_sign() { return [0, 0]; },
    signatureheaders_time() { return [0, 0]; },
    __wbg_signatureheaders_free() {},
    parse_decode_response() { return [64, 0, 0]; },
    decoderesult_code() { return 1; },
    decoderesult_data() { return [80, 30]; },
    decoderesult_msg() { return [0, 0]; },
    __wbg_decoderesult_free() {},
    memory: new WebAssembly.Memory({ initial: 1 }),
  };
  const fakeWebAssembly = {
    Memory: WebAssembly.Memory,
    instantiate: async (buffer) => {
      assert.deepEqual(Array.from(new Uint8Array(buffer)), expectedWasmBytes);
      const memory = new Uint8Array(fakeExports.memory.buffer);
      memory.set([1, 2], 32);
      memory.set(new TextEncoder().encode("https://example.com/video.m3u8"), 80);
      return { instance: { exports: fakeExports } };
    },
  };

  const fakeInstance = {
    async get(url, options = {}) {
      if (url.endsWith("/api.php/web/index/home")) {
        return { status: 200, data: { code: 200, msg: "success", data: {} } };
      }
      if (url.endsWith("/assets/web_app_wasm_bg-Bxwbrgev.wasm")) {
        sawResponseType = options.responseType || "";
        return {
          status: 200,
          data: sawResponseType === "arraybuffer" ? wasmBytes.buffer.slice() : Buffer.from(wasmBytes).toString("utf8"),
        };
      }
      throw new Error(`unexpected GET ${url}`);
    },
    async post(url, body, options = {}) {
      assert.equal(url.endsWith("/api.php/web/decode/url"), true);
      const response = { status: 200, data: new Uint8Array([8, 1]).buffer };
      sawDecodeBody = Array.from(body, (b) => b.toString(16).padStart(2, "0")).join("");
      return response;
    },
  };
  const axios = Object.assign(() => { throw new Error("unexpected direct axios call"); }, {
    create: () => fakeInstance,
  });

  const spiderModule = { exports: {} };
  const sdk = {
    log: async () => {},
    getCache: async () => null,
    setCache: async () => {},
    sniffVideo: async () => null,
    getScrapeMetadata: async () => null,
    processScraping: async () => {},
    request: async () => ({ statusCode: 200, body: "{}" }),
  };
  const context = {
    module: spiderModule,
    exports: spiderModule.exports,
    require: (id) => {
      if (id === "axios") return axios;
      if (id === "omnibox_sdk") return sdk;
      if (id === "spider_runner") return { run() {} };
      return require(id);
    },
    __dirname: temporaryDirectory,
    process: { env: {} },
    global: globalThis,
    TextEncoder, TextDecoder, URL, URLSearchParams, Buffer, performance,
    setTimeout, clearTimeout, console, crypto: require("node:crypto"),
    WebAssembly: fakeWebAssembly,
  };
  vm.runInNewContext(source, context, { filename: "3Q影视.js" });

  const play = await spiderModule.exports.play({ playId: "site_abc@1@fake-binary" });
  assert.equal(sawResponseType, "arraybuffer");
  assert.equal(sawDecodeBody, "0102");
  assert.equal(play?.urls?.[0]?.url, "https://example.com/video.m3u8");
});
