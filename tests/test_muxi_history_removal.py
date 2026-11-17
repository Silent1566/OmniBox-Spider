import asyncio
import base64
import importlib.util
import json
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[1] / "影视" / "采集" / "木兮.py"
MEDIA_URL = "https://media.example/video.mp4"
DANMAKU = [{"name": "字幕", "url": "https://media.example/danmaku.xml"}]


class ControlledSDK:
    def __init__(self, api_available):
        self.api_available = api_available
        self.forbidden = []
        self.requests = []
        self.logs = []
        self.scrapes = []

    def __getattr__(self, name):
        if name in {"getAnalyzeSites", "addhistory", "addPlayHistory", "getVideoMediaInfo"}:
            self.forbidden.append(name)
            if not self.api_available:
                raise AttributeError(name)

            async def history_api(*args):
                return {"format": {"duration": 3600}} if name == "getVideoMediaInfo" else True

            return history_api
        raise AttributeError(name)

    async def log(self, level, message):
        self.logs.append((level, message))

    async def request(self, url, options):
        self.requests.append((url, options))
        data = MEDIA_URL if "/api/line/play/parse?" in url else {}
        return {"statusCode": 200, "headers": {}, "body": json.dumps({"code": 200, "data": data})}

    async def getScrapeMetadata(self, resource_id):
        return {
            "scrapeType": "tv",
            "scrapeData": {"title": "测试剧", "seasonNumber": 1},
            "videoMappings": [{"fileId": "file", "seasonNumber": 1, "episodeNumber": 1, "episodeName": "第一集"}],
        }

    async def getDanmakuByFileName(self, name):
        return DANMAKU

    async def processScraping(self, *args):
        self.scrapes.append(args)

    async def getCache(self, *args):
        return None

    async def setCache(self, *args):
        return None


def load_spider(sdk):
    runner = types.ModuleType("spider_runner")
    runner.OmniBox = sdk
    runner.run = lambda *args: None
    spec = importlib.util.spec_from_file_location("muxi_history_test", SOURCE)
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {"spider_runner": runner}):
        spec.loader.exec_module(module)
    module.curl_requests = None
    module.cloudscraper = None
    module.AUTH_STATE.update({
        "cookies": "session=test", "clientId": "client", "reportId": "report",
        "session": "session", "traceId": "trace", "verifyToken": "token",
        "verifiedAt": int(time.time() * 1000), "initedAt": int(time.time() * 1000),
    })
    return module


class MuxiHistoryRemovalTests(unittest.IsolatedAsyncioTestCase):
    async def check_play(self, api_available):
        sdk = ControlledSDK(api_available)
        module = load_spider(sdk)
        meta = base64.b64encode(json.dumps({
            "vod_id": "show", "file_id": "file", "vod_name": "测试剧", "episode_name": "第一集",
        }).encode()).decode()
        params = {"playId": "line@show@1|||" + meta, "flag": "木兮"}
        with patch.object(module.time, "sleep", return_value=None):
            result = await module.play(params, {"sourceId": "source"})
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            self.assertEqual(result["url"], MEDIA_URL, sdk.logs)
            self.assertEqual(result["parse"], 0)
            self.assertEqual(result["urls"], [{"name": "第一集", "url": MEDIA_URL}])
            self.assertEqual(result["danmaku"], DANMAKU)
            self.assertEqual(result["flag"], "木兮")
            self.assertIn("line_id=line", result["header"]["Referer"])
            request_count = len(sdk.requests)
            cached = await module.play(params, {"sourceId": "source"})
            self.assertEqual(cached, result)
            self.assertEqual(len(sdk.requests), request_count)
        self.assertTrue(any("/api/line/play/parse?" in url for url, _ in sdk.requests))
        self.assertEqual(sdk.forbidden, [], "历史 API 或历史专用时长获取仍在执行")
        self.assertFalse(any("[history]" in message or "[media-info]" in message for _, message in sdk.logs))

    async def test_play_with_history_api_keeps_url_danmaku_and_cache(self):
        await self.check_play(True)

    async def test_play_without_history_api_keeps_url_danmaku_and_cache(self):
        await self.check_play(False)

    async def test_shared_background_scraping_still_runs(self):
        sdk = ControlledSDK(False)
        module = load_spider(sdk)
        await module.spawn_background_job(module.run_muxi_scraping_task("show", "测试剧", [{
            "name": "木兮", "episodes": [{"name": "第一集", "playId": "line@show@1|||" + base64.b64encode(json.dumps({"file_id": "file"}).encode()).decode()}],
        }]), "scraping-test")
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        self.assertEqual(len(sdk.scrapes), 1, sdk.logs)
        self.assertEqual(sdk.scrapes[0][0], "show")
        self.assertEqual(sdk.forbidden, [])


if __name__ == "__main__":
    unittest.main()
