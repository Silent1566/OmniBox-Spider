# -*- coding: utf-8 -*-
# @name 木兮
# @author 梦
# @description 影视站：https://film.symx.club ，Python版，接入首页、分类、搜索、详情与播放签名链路
# @version 1.2.14
# @downloadURL https://gh-proxy.org/https://github.com/Silent1566/OmniBox-Spider/raw/refs/heads/main/影视/采集/木兮.py
# @dependencies cloudscraper,curl_cffi,Pillow,ddddocr,pycryptodome

import asyncio
import base64
import hashlib
import hmac
import html
import json
import os
import random
import re
import time
import uuid
from io import BytesIO
from urllib.parse import urlencode, quote
from spider_runner import OmniBox, run

# ==================== 配置区域 ====================
# 站点基础地址。默认使用木兮当前主站，可通过环境变量覆盖。
HOST = os.environ.get("MUXI_HOST", "https://film.symx.club").rstrip("/")
# 站点请求默认 User-Agent。必要时可通过环境变量替换为新的移动端 UA。
UA = os.environ.get(
    "MUXI_UA",
    "Mozilla/5.0 (Linux; Android 13; 23049RAD8C Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36",
)
# 验证链最大重试次数。主要给需要二次强制验证的搜索/播放场景使用。
VERIFY_SOLVE_RETRIES = max(0, int(os.environ.get("MUXI_VERIFY_SOLVE_RETRIES", "1") or 1))
# 两次验证重试之间的等待时间（毫秒）。
VERIFY_SOLVE_RETRY_DELAY_MS = max(200, int(os.environ.get("MUXI_VERIFY_RETRY_DELAY_MS", "1000") or 1000))
# 外部滑块识别接口地址。配置后优先走外部接口，失败再回退本地 ddddocr / Pillow 逻辑。
EXTERNAL_SLIDE_API = str(os.environ.get("MUXI_DDDDOCR_API") or os.environ.get("MUXI_SLIDE_OCR_API") or os.environ.get("DDDDOCR_API") or "").strip()
# 外部滑块识别接口路径。传基础地址时默认自动拼接 /slide。
EXTERNAL_SLIDE_PATH = str(os.environ.get("MUXI_DDDDOCR_PATH") or os.environ.get("MUXI_SLIDE_OCR_PATH") or "/slide").strip() or "/slide"

# 站点公共请求头。
SITE_HEADERS = {
    "User-Agent": UA,
    "x-platform": "web",
}
# 站点分类 ID 到中文分类名的映射。
TYPE_NAME_MAP = {
    1: "电视剧",
    2: "电影",
    3: "综艺",
    4: "动漫",
    5: "短剧",
}
# 首页分类列表。
SITE_CLASS = [
    {"type_id": "1", "type_name": "电视剧"},
    {"type_id": "2", "type_name": "电影"},
    {"type_id": "3", "type_name": "综艺"},
    {"type_id": "4", "type_name": "动漫"},
    {"type_id": "5", "type_name": "短剧"},
]
# 分类筛选项定义。
SITE_FILTERS = {
    "1": [
        {"key": "lang", "name": "语言", "value": [{"name": "全部", "value": ""}, {"name": "国语", "value": "国语"}, {"name": "英语", "value": "英语"}, {"name": "韩语", "value": "韩语"}, {"name": "日语", "value": "日语"}]},
        {"key": "year", "name": "年份", "value": [{"name": "全部", "value": ""}, {"name": "2026", "value": "2026"}, {"name": "2025", "value": "2025"}, {"name": "2024", "value": "2024"}, {"name": "2023", "value": "2023"}, {"name": "2022", "value": "2022"}, {"name": "2021", "value": "2021"}, {"name": "2020", "value": "2020"}]},
        {"key": "by", "name": "排序", "value": [{"name": "更新时间", "value": "updateTime"}, {"name": "热度", "value": "hits"}, {"name": "评分", "value": "score"}]},
    ],
    "2": [
        {"key": "lang", "name": "语言", "value": [{"name": "全部", "value": ""}, {"name": "国语", "value": "国语"}, {"name": "英语", "value": "英语"}, {"name": "韩语", "value": "韩语"}, {"name": "日语", "value": "日语"}]},
        {"key": "year", "name": "年份", "value": [{"name": "全部", "value": ""}, {"name": "2026", "value": "2026"}, {"name": "2025", "value": "2025"}, {"name": "2024", "value": "2024"}, {"name": "2023", "value": "2023"}, {"name": "2022", "value": "2022"}, {"name": "2021", "value": "2021"}, {"name": "2020", "value": "2020"}]},
        {"key": "by", "name": "排序", "value": [{"name": "更新时间", "value": "updateTime"}, {"name": "热度", "value": "hits"}, {"name": "评分", "value": "score"}]},
    ],
    "3": [
        {"key": "lang", "name": "语言", "value": [{"name": "全部", "value": ""}, {"name": "国语", "value": "国语"}, {"name": "英语", "value": "英语"}, {"name": "韩语", "value": "韩语"}, {"name": "日语", "value": "日语"}]},
        {"key": "year", "name": "年份", "value": [{"name": "全部", "value": ""}, {"name": "2026", "value": "2026"}, {"name": "2025", "value": "2025"}, {"name": "2024", "value": "2024"}, {"name": "2023", "value": "2023"}, {"name": "2022", "value": "2022"}, {"name": "2021", "value": "2021"}, {"name": "2020", "value": "2020"}]},
        {"key": "by", "name": "排序", "value": [{"name": "更新时间", "value": "updateTime"}, {"name": "热度", "value": "hits"}, {"name": "评分", "value": "score"}]},
    ],
    "4": [
        {"key": "lang", "name": "语言", "value": [{"name": "全部", "value": ""}, {"name": "国语", "value": "国语"}, {"name": "英语", "value": "英语"}, {"name": "韩语", "value": "韩语"}, {"name": "日语", "value": "日语"}]},
        {"key": "year", "name": "年份", "value": [{"name": "全部", "value": ""}, {"name": "2026", "value": "2026"}, {"name": "2025", "value": "2025"}, {"name": "2024", "value": "2024"}, {"name": "2023", "value": "2023"}, {"name": "2022", "value": "2022"}, {"name": "2021", "value": "2021"}, {"name": "2020", "value": "2020"}]},
        {"key": "by", "name": "排序", "value": [{"name": "更新时间", "value": "updateTime"}, {"name": "热度", "value": "hits"}, {"name": "评分", "value": "score"}]},
    ],
    "5": [
        {"key": "lang", "name": "语言", "value": [{"name": "全部", "value": ""}, {"name": "国语", "value": "国语"}, {"name": "英语", "value": "英语"}, {"name": "韩语", "value": "韩语"}, {"name": "日语", "value": "日语"}]},
        {"key": "year", "name": "年份", "value": [{"name": "全部", "value": ""}, {"name": "2026", "value": "2026"}, {"name": "2025", "value": "2025"}, {"name": "2024", "value": "2024"}, {"name": "2023", "value": "2023"}, {"name": "2022", "value": "2022"}, {"name": "2021", "value": "2021"}, {"name": "2020", "value": "2020"}]},
        {"key": "by", "name": "排序", "value": [{"name": "更新时间", "value": "updateTime"}, {"name": "热度", "value": "hits"}, {"name": "评分", "value": "score"}]},
    ],
}
# 各分类默认筛选值。
FILTER_DEF = {
    "1": {"lang": "", "by": "updateTime", "year": ""},
    "2": {"lang": "", "by": "updateTime", "year": ""},
    "3": {"lang": "", "by": "updateTime", "year": ""},
    "4": {"lang": "", "by": "updateTime", "year": ""},
    "5": {"lang": "", "by": "updateTime", "year": ""},
}
# 鉴权 token 缓存时间（毫秒）。默认 7 天，优先复用缓存；调用失败后再强制刷新一次。
TTL_AUTH_MS = 7 * 24 * 60 * 60 * 1000
# 分类页缓存时间（毫秒）。
TTL_CATEGORY_MS = 30 * 1000
# 详情页缓存时间（毫秒）。
TTL_DETAIL_MS = 2 * 60 * 1000
# 搜索结果缓存时间（毫秒）。
TTL_SEARCH_MS = 20 * 1000
# 播放地址缓存时间（毫秒）。
TTL_PLAY_MS = 15 * 1000
# 首页缓存时间（毫秒）。
TTL_HOME_MS = 30 * 1000
# 首页各分类默认抓取条数。
HOME_CATEGORY_PAGE_SIZE = max(3, int(os.environ.get("MUXI_HOME_CATEGORY_PAGE_SIZE", "6") or 6))
# ==================== 配置区域结束 ====================

CACHE = {}
AUTH_CACHE_KEY = 'muxi:auth-state'
VERIFY_DELTA_CACHE_KEY = 'muxi:last-verify-delta'
AUTH_STATE = {
    "cookies": "",
    "clientId": "",
    "reportId": "",
    "session": "",
    "traceId": "",
    "verifyToken": "",
    "verifiedAt": 0,
    "initedAt": 0,
}
GEETEST_STATE = {
    "cookie": "",
}
EMPTY_PLAY = {"parse": 0, "url": "", "urls": [], "header": {}}
GEETEST_HOST = "https://gcaptcha4.geevisit.com"
GEETEST_SLIDER_RATIO = 0.8876 * 340 / 300
DEFAULT_PASSTIME = 419
GEETEST_BIHT = '1426265548'
GEETEST_STATIC_FLAG_KEY = '9zXN'
GEETEST_STATIC_FLAG_VALUE = 'NYzS'
GEETEST_EM = {
    'ph': 0,
    'cp': 0,
    'ek': '11',
    'wd': 1,
    'nt': 0,
    'si': 0,
    'sc': 0,
}
SETLEFT_SCAN_OFFSETS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
GEETEST_RSA_MODULUS_HEX = '00C1E3934D1614465B33053E7F48EE4EC87B14B95EF88947713D25EECBFF7E74C7977D02DC1D9451F79DD5D1C10C29ACB6A9B4D6FB7D0A0279B6719E1772565F09AF627715919221AEF91899CAE08C0D686D748B20A3603BE2318CA6BC2B59706592A9219D0BF05C9F65023A21D2330807252AE0066D59CEEFA5F2748EA80BAB81'
GEETEST_RSA_EXPONENT_HEX = '10001'
GEETEST_AES_IV = '0000000000000000'

try:
    from curl_cffi import requests as curl_requests
except Exception:
    curl_requests = None

try:
    import cloudscraper
except Exception:
    cloudscraper = None

try:
    from PIL import Image
except Exception:
    Image = None

try:
    import ddddocr
except Exception:
    ddddocr = None

try:
    from Crypto.PublicKey import RSA
    from Crypto.Cipher import PKCS1_v1_5, AES
    from Crypto.Util.Padding import pad
except Exception:
    RSA = None
    PKCS1_v1_5 = None
    AES = None
    pad = None


def now_ms():
    return int(time.time() * 1000)


def random_hex(size=16):
    return os.urandom(size).hex()


def normalize_page(page):
    try:
        page = int(page)
        return page if page > 0 else 1
    except Exception:
        return 1


def parse_extend(raw):
    if not raw:
        return {}
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str):
        return {}
    try:
        return json.loads(raw)
    except Exception:
        try:
            return json.loads(base64.b64decode(raw).decode("utf-8"))
        except Exception:
            return {}


def safe_json_parse(value, fallback=None):
    if fallback is None:
        fallback = {}
    if value is None:
        return fallback
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return fallback


def decrypt_hex_xor(data):
    raw = str(data or "")
    key = "0x1A2B3C4D5E6F7A8B9C"
    out = []
    for i in range(0, len(raw), 2):
        hex_part = raw[i:i + 2]
        try:
            value = int(hex_part, 16)
        except Exception:
            return ""
        out.append(chr(value ^ ord(key[(i // 2) % len(key)])))
    return "".join(out)


def checksum_timestamp(raw_ts):
    prefix = str(raw_ts)[:12]
    s = sum(int(ch) if ch.isdigit() else 0 for ch in prefix)
    return f"{prefix}{s % 10}"


def build_sign(url, timestamp, session, trace_id):
    path = str(url or "").split("?")[0].replace(f"{HOST}/api", "")
    map_obj = {
        "p": path,
        "t": str(timestamp or ""),
        "s": f"symx_{str(session or '')}",
    }
    payload = "".join(map_obj.get(ch, "") for ch in str(trace_id or ""))
    payload = payload.replace("1", "i").replace("0", "o").replace("5", "s")
    return hmac.new(str(session or "").encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def get_cache(key, ttl_ms):
    hit = CACHE.get(key)
    if not hit:
        return None
    if now_ms() - hit["ts"] > ttl_ms:
        CACHE.pop(key, None)
        return None
    return hit["data"]


def set_cache(key, data):
    CACHE[key] = {"ts": now_ms(), "data": data}


def short_body(value, limit=320):
    try:
        text = value if isinstance(value, str) else json.dumps(value or {}, ensure_ascii=False)
    except Exception:
        text = str(value or '')
    return text if len(text) <= limit else f"{text[:limit]}..."


async def log(level, message):
    try:
        await OmniBox.log(level, message)
    except Exception:
        pass


async def get_sdk_cache(key):
    try:
        fn = getattr(OmniBox, 'getCache', None)
        if not callable(fn):
            return None
        value = await fn(key)
        if not value:
            return None
        if isinstance(value, str):
            try:
                return json.loads(value)
            except Exception:
                return value
        return value
    except Exception:
        return None


async def set_sdk_cache(key, value, ex_seconds=600):
    try:
        fn = getattr(OmniBox, 'setCache', None)
        if not callable(fn):
            return False
        payload = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
        await fn(key, payload, ex_seconds)
        return True
    except Exception:
        return False


def split_set_cookie_values(val):
    if not val:
        return []
    if isinstance(val, list):
        raw_items = val
    else:
        raw_items = [val]
    out = []
    for raw in raw_items:
        text = str(raw)
        parts = []
        current = []
        i = 0
        while i < len(text):
            if text[i] == ',' and 'expires=' not in ''.join(current).lower().split(';')[-1]:
                parts.append(''.join(current).strip())
                current = []
                i += 1
                continue
            current.append(text[i])
            i += 1
        if current:
            parts.append(''.join(current).strip())
        out.extend([p for p in parts if p])
    return out


def merge_cookie_strings(*cookie_strings):
    cookie_map = {}
    for cookie_string in cookie_strings:
        if not cookie_string:
            continue
        for part in str(cookie_string).split(';'):
            seg = part.strip()
            if not seg or '=' not in seg:
                continue
            k, v = seg.split('=', 1)
            if k and v and k.lower() not in ('path', 'expires', 'max-age', 'domain', 'samesite', 'secure', 'httponly'):
                cookie_map[k.strip()] = v.strip()
    return '; '.join(f"{k}={v}" for k, v in cookie_map.items())


def extract_cookie_header(headers):
    if not isinstance(headers, dict):
        return ""
    cookies = []
    for key in ("set-cookie", "Set-Cookie"):
        val = headers.get(key)
        if not val:
            continue
        for item in split_set_cookie_values(val):
            first = str(item).split(';')[0].strip()
            if first:
                cookies.append(first)
    return merge_cookie_strings(*cookies)


def session_cookie_header(session):
    try:
        jar = getattr(session, 'cookies', None)
        if jar is None:
            return ''
        if hasattr(jar, 'items'):
            return '; '.join(f"{k}={v}" for k, v in jar.items())
        if hasattr(jar, 'get_dict'):
            d = jar.get_dict()
            return '; '.join(f"{k}={v}" for k, v in d.items())
    except Exception:
        return ''
    return ''


async def raw_request(url, method="GET", headers=None, body=None, timeout=10000):
    all_headers = {**SITE_HEADERS, **(headers or {})}
    geetest_host = (
        'gcaptcha4.geetest.com' in str(url)
        or 'gcaptcha4.geevisit.com' in str(url)
        or 'static.geetest.com' in str(url)
        or 'static.geevisit.com' in str(url)
    )
    if not geetest_host and curl_requests is not None:
        try:
            session = curl_requests.Session(impersonate='chrome124')
            if method.upper() == 'POST':
                resp = session.post(url, headers=all_headers, data=body, timeout=timeout / 1000)
            else:
                resp = session.get(url, headers=all_headers, timeout=timeout / 1000)
            merged_cookie = merge_cookie_strings(extract_cookie_header(dict(resp.headers or {})), session_cookie_header(session))
            if merged_cookie:
                AUTH_STATE['cookies'] = merge_cookie_strings(AUTH_STATE.get('cookies', ''), merged_cookie)
            return {
                "status": int(resp.status_code or 0),
                "headers": dict(resp.headers or {}),
                "text": resp.text,
            }
        except Exception:
            pass
    if not geetest_host and cloudscraper is not None:
        try:
            scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'android', 'mobile': True})
            if method.upper() == 'POST':
                resp = scraper.post(url, headers=all_headers, data=body, timeout=timeout / 1000)
            else:
                resp = scraper.get(url, headers=all_headers, timeout=timeout / 1000)
            merged_cookie = merge_cookie_strings(extract_cookie_header(dict(resp.headers or {})), session_cookie_header(scraper))
            if merged_cookie:
                AUTH_STATE['cookies'] = merge_cookie_strings(AUTH_STATE.get('cookies', ''), merged_cookie)
            return {
                "status": int(resp.status_code or 0),
                "headers": dict(resp.headers or {}),
                "text": resp.text,
            }
        except Exception:
            pass

    res = await OmniBox.request(url, {
        "method": method,
        "headers": all_headers,
        "body": body,
        "timeout": timeout,
    })
    status = int(res.get("statusCode") or 0)
    return {
        "status": status,
        "headers": res.get("headers") or {},
        "text": res.get("body", "") if isinstance(res.get("body", ""), str) else str(res.get("body", "")),
    }


async def request_text(url, method="GET", headers=None, body=None, timeout=10000):
    resp = await raw_request(url, method=method, headers=headers, body=body, timeout=timeout)
    return resp["text"]


async def request_json(url, method="GET", headers=None, body=None, timeout=10000):
    text = await request_text(url, method=method, headers=headers, body=body, timeout=timeout)
    try:
        return json.loads(text)
    except Exception:
        return None


async def ensure_site_cookie(force=False):
    if not force and AUTH_STATE["cookies"]:
        return AUTH_STATE["cookies"]
    page_res = await raw_request(f"{HOST}/verify", headers={"referer": f"{HOST}/verify"}, timeout=15000)
    cookie_header = extract_cookie_header(page_res.get("headers") or {})
    if cookie_header:
        AUTH_STATE["cookies"] = merge_cookie_strings(AUTH_STATE.get("cookies", ""), cookie_header)
    return AUTH_STATE["cookies"]


async def init_auth(force=False):
    if not force and not AUTH_STATE['cookies']:
        await load_auth_state_from_cache()

    auth_fresh = (
        AUTH_STATE["cookies"] and AUTH_STATE["session"] and AUTH_STATE["traceId"] and AUTH_STATE["reportId"]
        and now_ms() - AUTH_STATE["initedAt"] < TTL_AUTH_MS
    )
    if not force and auth_fresh:
        return True

    await ensure_site_cookie(force)
    track_res = await raw_request(
        f"{HOST}/api/stats/track",
        headers={
            **({"cookie": AUTH_STATE["cookies"]} if AUTH_STATE["cookies"] else {}),
            "referer": f"{HOST}/m/index",
        },
    )
    cookie_header = extract_cookie_header(track_res.get("headers") or {})
    if cookie_header:
        AUTH_STATE["cookies"] = cookie_header

    conf = await request_json(
        f"{HOST}/api/system/config",
        headers={
            **({"cookie": AUTH_STATE["cookies"]} if AUTH_STATE["cookies"] else {}),
            "referer": f"{HOST}/m/index",
        },
    )
    data = (conf or {}).get("data") or {}
    if not AUTH_STATE["clientId"] or force:
        AUTH_STATE["clientId"] = random_hex(16)
    AUTH_STATE["reportId"] = decrypt_hex_xor(data.get("reportId") or "")
    AUTH_STATE["session"] = decrypt_hex_xor(data.get("session") or "")
    AUTH_STATE["traceId"] = decrypt_hex_xor(data.get("traceId") or "")
    AUTH_STATE["initedAt"] = now_ms()
    await persist_auth_state()
    return bool(AUTH_STATE["cookies"])


def build_signed_headers(url, referer=None, use_checksum_ts=False):
    timestamp = checksum_timestamp(now_ms()) if use_checksum_ts else str(now_ms())
    sign = build_sign(url, timestamp, AUTH_STATE["session"], AUTH_STATE["traceId"])
    headers = {
        **SITE_HEADERS,
        **({"cookie": AUTH_STATE["cookies"]} if AUTH_STATE["cookies"] else {}),
        "referer": referer or HOST,
        "x-client-id": AUTH_STATE["clientId"] or random_hex(16),
        "x-verify-token": AUTH_STATE["verifyToken"] or "",
        "x-timestamp": timestamp,
    }
    if AUTH_STATE["reportId"] and sign:
        headers[AUTH_STATE["reportId"]] = sign
    return headers


def sync_auth_state(next_auth):
    if not isinstance(next_auth, dict):
        return
    for key_src, key_dst in (("cookie", "cookies"), ("cookies", "cookies"), ("clientId", "clientId"), ("reportId", "reportId"), ("session", "session"), ("traceId", "traceId"), ("verifyToken", "verifyToken")):
        val = next_auth.get(key_src)
        if val:
            AUTH_STATE[key_dst] = str(val)
    if AUTH_STATE["verifyToken"]:
        AUTH_STATE["verifiedAt"] = int(next_auth.get('verifiedAt') or now_ms())
    AUTH_STATE["initedAt"] = int(next_auth.get('initedAt') or now_ms())


async def load_auth_state_from_cache():
    cached = await get_sdk_cache(AUTH_CACHE_KEY)
    if isinstance(cached, dict):
        sync_auth_state(cached)
        return True
    return False


async def persist_auth_state():
    await set_sdk_cache(AUTH_CACHE_KEY, AUTH_STATE, max(600, TTL_AUTH_MS // 1000))


def normalize_gap_x(gap_x):
    try:
        parsed = int(round(float(gap_x)))
        return max(0, parsed)
    except Exception:
        return 0


def build_user_response(set_left):
    return set_left / GEETEST_SLIDER_RATIO + 2


def md5_hex(value):
    return hashlib.md5(str(value or '').encode('utf-8')).hexdigest()


def build_pow_message(pow_detail, captcha_id, lot_number):
    version = str((pow_detail or {}).get('version') or 1)
    bits = str((pow_detail or {}).get('bits') or 0)
    hashfunc = str((pow_detail or {}).get('hashfunc') or 'md5')
    datetime_val = str((pow_detail or {}).get('datetime') or '')
    return '|'.join([
        version,
        bits,
        hashfunc,
        datetime_val,
        str(captcha_id or ''),
        str(lot_number or ''),
        '',
        random_hex(8),
    ])


def build_lot_derived_object(lot_number):
    lot = str(lot_number or '')
    if len(lot) < 30:
        return {}
    return {
        lot[24:28]: {
            lot[29] + lot[27] + lot[15] + lot[9]: lot[1:9],
        }
    }


def urlsafe_encode(value):
    return base64.urlsafe_b64encode(str(value or '').encode('utf-8')).decode('utf-8').rstrip('=')


def geetest_guid():
    return random_hex(8)


def rsa_pkcs1_encrypt_hex(public_key, value):
    if RSA is None or PKCS1_v1_5 is None:
        return ''
    cipher = PKCS1_v1_5.new(public_key)
    encrypted = cipher.encrypt(str(value or '').encode('utf-8'))
    return encrypted.hex()


def aes_cbc_encrypt_hex(plain_text, key):
    if AES is None or pad is None:
        return ''
    cipher = AES.new(str(key or '').encode('utf-8'), AES.MODE_CBC, GEETEST_AES_IV.encode('utf-8'))
    encrypted = cipher.encrypt(pad(str(plain_text or '').encode('utf-8'), 16))
    return encrypted.hex()


def build_geetest_public_key():
    if RSA is None:
        return None
    modulus = int(GEETEST_RSA_MODULUS_HEX, 16)
    exponent = int(GEETEST_RSA_EXPONENT_HEX, 16)
    return RSA.construct((modulus, exponent))


def build_inner_payload(options=None):
    options = options or {}
    lot_number = str(options.get('lotNumber') or '')
    set_left = normalize_gap_x(options.get('setLeft') if options.get('setLeft') is not None else options.get('gapX'))
    passtime = int(options.get('passtime') or DEFAULT_PASSTIME)
    pow_msg = str(options.get('powMsg') or '')
    payload = {
        'setLeft': set_left,
        'passtime': passtime,
        'userresponse': build_user_response(set_left),
        'device_id': '',
        'lot_number': lot_number,
        'pow_msg': pow_msg,
        'pow_sign': md5_hex(pow_msg),
        'geetest': 'captcha',
        'lang': 'zh',
        'ep': '123',
        'biht': GEETEST_BIHT,
        GEETEST_STATIC_FLAG_KEY: GEETEST_STATIC_FLAG_VALUE,
        'em': dict(GEETEST_EM),
    }
    payload.update(build_lot_derived_object(lot_number))
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


def generate_w(ready_payload):
    public_key = build_geetest_public_key()
    inner = build_inner_payload(ready_payload)
    pt = int(ready_payload.get('pt') or 1)
    if pt != 1:
        return urlsafe_encode(inner)
    if public_key is None:
        return ''
    guid = geetest_guid()
    rsa_hex = rsa_pkcs1_encrypt_hex(public_key, guid)
    retries = 0
    while (not rsa_hex or len(rsa_hex) != 256) and retries < 5:
        guid = geetest_guid()
        rsa_hex = rsa_pkcs1_encrypt_hex(public_key, guid)
        retries += 1
    aes_hex = aes_cbc_encrypt_hex(inner, guid)
    return (aes_hex or '') + (rsa_hex or '')


def build_verify_ready_payload(prepared, set_left=None):
    load_data = (prepared or {}).get('loadData') or {}
    gap_best_x = (((prepared or {}).get('gap') or {}).get('bestX') or 0)
    set_left = normalize_gap_x(set_left if set_left is not None else gap_best_x)
    pow_msg = build_pow_message(load_data.get('pow_detail') or {}, (prepared or {}).get('captchaId') or '', load_data.get('lot_number') or '')
    return {
        'captchaId': (prepared or {}).get('captchaId') or '',
        'challenge': (prepared or {}).get('challenge') or '',
        'lotNumber': load_data.get('lot_number') or '',
        'payload': load_data.get('payload') or '',
        'processToken': load_data.get('process_token') or '',
        'payloadProtocol': int(load_data.get('payload_protocol') or 1),
        'pt': int(load_data.get('pt') or 1),
        'gapX': set_left,
        'setLeft': set_left,
        'ypos': (prepared or {}).get('ypos') or 0,
        'powMsg': pow_msg,
        'passtime': DEFAULT_PASSTIME,
    }


async def get_buffer(url, headers=None, timeout=20000):
    all_headers = headers or {}
    if curl_requests is not None:
        session = curl_requests.Session(impersonate='chrome124')
        resp = session.get(url, headers=all_headers, timeout=timeout / 1000)
        return bytes(resp.content or b'')
    if cloudscraper is not None:
        scraper = cloudscraper.create_scraper(browser={'browser': 'chrome', 'platform': 'android', 'mobile': True})
        resp = scraper.get(url, headers=all_headers, timeout=timeout / 1000)
        return bytes(resp.content or b'')
    text = await request_text(url, headers=all_headers, timeout=timeout)
    return text.encode('utf-8', 'ignore')


async def fetch_verify_config_py():
    url = f"{HOST}/api/auth/verify/config"
    return await request_json(url, headers=build_signed_headers(url, f"{HOST}/verify", True))


async def fetch_geetest_load_py(captcha_id, challenge):
    query = urlencode({
        'callback': f'geetest_{now_ms()}',
        'captcha_id': captcha_id,
        'challenge': challenge,
        'client_type': 'web',
        'lang': 'zho',
    })
    url = f"{GEETEST_HOST}/load?{query}"
    resp = await raw_request(url, headers={
        'User-Agent': UA,
        'referer': f'{HOST}/',
        'Accept': '*/*',
        'Sec-Fetch-Dest': 'script',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Storage-Access': 'active',
    })
    cookie_header = extract_cookie_header(resp.get('headers') or {})
    if cookie_header:
        GEETEST_STATE['cookie'] = merge_cookie_strings(GEETEST_STATE.get('cookie', ''), cookie_header)
    text = resp.get('text') or ''
    start = text.find('(')
    end = text.rfind(')')
    data = None
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start + 1:end])
        except Exception:
            data = None
    return {'url': url, 'raw': text, 'data': data, 'headers': resp.get('headers') or {}, 'cookie': GEETEST_STATE.get('cookie', '')}


async def request_external_gap_py(bg_buffer, slice_buffer=None):
    if not EXTERNAL_SLIDE_API:
        return None
    try:
        background_base64 = base64.b64encode(bg_buffer or b'').decode('utf-8')
        target_base64 = base64.b64encode(slice_buffer or b'').decode('utf-8') if slice_buffer else ''
        payload = {
            'bg': background_base64,
            'thumb': target_base64,
            'type': 'match',
        }
        normalized_base = EXTERNAL_SLIDE_API.rstrip('/')
        is_full_endpoint = normalized_base.startswith(('http://', 'https://')) and any(
            token in normalized_base.lower() for token in ('/slide', '/slide_match', '/slide_comparison', '/ocr', '/det')
        )
        candidates = [normalized_base] if is_full_endpoint else [f"{normalized_base}{EXTERNAL_SLIDE_PATH}", normalized_base]

        data = None
        used_url = ''
        for url in candidates:
            await log('info', f"[木兮][verify] external ocr request api={url}")
            resp = await raw_request(
                url,
                method='POST',
                headers={
                    'Content-Type': 'application/json',
                    'User-Agent': UA,
                },
                body=json.dumps(payload, ensure_ascii=False),
                timeout=20000,
            )
            parsed = safe_json_parse(resp.get('text') or '', {})
            detail = ''
            if isinstance(parsed, dict):
                detail = str(parsed.get('detail') or '')
            if int(resp.get('status') or 0) == 404 and 'Not Found' in detail and len(candidates) > 1 and url != candidates[-1]:
                await log('warn', f"[木兮][verify] external ocr 404 fallback api={url}")
                continue
            data = parsed if parsed else {'raw': resp.get('text') or ''}
            used_url = url
            break

        if not data:
            return None

        target = None
        if isinstance(data, dict):
            target = data.get('data', {}).get('target') if isinstance(data.get('data'), dict) else None
            target = target or (data.get('result', {}).get('target') if isinstance(data.get('result'), dict) else None)
            target = target or data.get('target') or data.get('data') or data.get('result') or data
        else:
            target = data

        x = None
        if isinstance(target, (list, tuple)) and len(target) >= 1:
            try:
                x = float(target[0])
            except Exception:
                x = None
        elif isinstance(target, dict):
            for key in ('x', 'target_x'):
                if key in target:
                    try:
                        x = float(target.get(key))
                        break
                    except Exception:
                        pass
        if x is None and isinstance(data, dict):
            for key_path in (('data', 'target_x'), ('x',), ('bestX',)):
                try:
                    if len(key_path) == 2 and isinstance(data.get(key_path[0]), dict) and key_path[1] in data.get(key_path[0]):
                        x = float(data[key_path[0]][key_path[1]])
                        break
                    if len(key_path) == 1 and key_path[0] in data:
                        x = float(data[key_path[0]])
                        break
                except Exception:
                    pass

        if x is not None:
            await log('info', f"[木兮][verify] external ocr success api={used_url} x={x} body={short_body(data)}")
            return {'bestX': max(0, round(x)), 'bestScore': 9999, 'engine': 'external-ddddocr', 'raw': data}

        await log('warn', f"[木兮][verify] external ocr invalid api={used_url} body={short_body(data)}")
        return None
    except Exception as e:
        await log('warn', f"[木兮][verify] external ocr failed api={EXTERNAL_SLIDE_API}: {e}")
        return None


def detect_gap_x_py(bg_buffer, ypos, slice_buffer=None):
    if ddddocr is not None and bg_buffer:
        try:
            det = ddddocr.DdddOcr(det=False, ocr=False, show_ad=False)
            if slice_buffer:
                try:
                    result = det.slide_match(slice_buffer, bg_buffer, simple_target=True)
                    if isinstance(result, dict):
                        target = result.get('target') or result.get('data') or result
                        if isinstance(target, (list, tuple)) and len(target) >= 1:
                            x = int(target[0])
                            return {'bestX': x, 'bestScore': 9999, 'engine': 'ddddocr.slide_match', 'raw': result}
                        if isinstance(target, dict) and 'x' in target:
                            x = int(target.get('x') or 0)
                            return {'bestX': x, 'bestScore': 9999, 'engine': 'ddddocr.slide_match', 'raw': result}
                except Exception as e:
                    return {'bestX': 0, 'bestScore': 0, 'engine': 'ddddocr.slide_match.error', 'error': str(e)}
            try:
                result = det.slide_comparison(bg_buffer, slice_buffer) if slice_buffer else None
                if isinstance(result, dict):
                    x = int(result.get('target', [0])[0] if isinstance(result.get('target'), (list, tuple)) else result.get('x', 0))
                    return {'bestX': x, 'bestScore': 9999, 'engine': 'ddddocr.slide_comparison', 'raw': result}
                if isinstance(result, (list, tuple)) and len(result) >= 1:
                    x = int(result[0])
                    return {'bestX': x, 'bestScore': 9999, 'engine': 'ddddocr.slide_comparison', 'raw': result}
            except Exception as e:
                return {'bestX': 0, 'bestScore': 0, 'engine': 'ddddocr.slide_comparison.error', 'error': str(e)}
        except Exception as e:
            return {'bestX': 0, 'bestScore': 0, 'engine': 'ddddocr.init.error', 'error': str(e)}

    if Image is None or not bg_buffer:
        return {'bestX': 0, 'bestScore': 0, 'engine': 'none'}
    try:
        img = Image.open(BytesIO(bg_buffer)).convert('L')
        width, height = img.size
        y_start = max(0, round(float(ypos or 0) + 8))
        y_end = min(height, round(float(ypos or 0) + 52))
        best_x, best_score = 0, float('-inf')
        for x in range(1, width - 1):
            score = 0
            for y in range(y_start, y_end):
                left = img.getpixel((x - 1, y))
                center = img.getpixel((x, y))
                right = img.getpixel((x + 1, y))
                score += abs(right - left) + abs(center - left)
            if score > best_score:
                best_score = score
                best_x = x
        return {'bestX': best_x, 'bestScore': best_score, 'engine': 'pillow-fallback'}
    except Exception:
        return {'bestX': 0, 'bestScore': 0, 'engine': 'error'}


async def verify_geetest_py(ready_payload):
    callback = f"geetest_{now_ms()}"
    query = urlencode({
        'callback': callback,
        'captcha_id': ready_payload.get('captchaId') or '',
        'client_type': 'web',
        'lot_number': ready_payload.get('lotNumber') or '',
        'payload': ready_payload.get('payload') or '',
        'process_token': ready_payload.get('processToken') or '',
        'payload_protocol': str(ready_payload.get('payloadProtocol') or 1),
        'pt': str(ready_payload.get('pt') or 1),
        'w': ready_payload.get('w') or '',
    })
    url = f"{GEETEST_HOST}/verify?{query}"
    resp = await raw_request(url, headers={
        'User-Agent': UA,
        'referer': f'{HOST}/',
        'Accept': '*/*',
        'Sec-Fetch-Dest': 'script',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Storage-Access': 'active',
        **({'cookie': GEETEST_STATE['cookie']} if GEETEST_STATE.get('cookie') else {}),
    })
    cookie_header = extract_cookie_header(resp.get('headers') or {})
    if cookie_header:
        GEETEST_STATE['cookie'] = merge_cookie_strings(GEETEST_STATE.get('cookie', ''), cookie_header)
    text = resp.get('text') or ''
    start = text.find('(')
    end = text.rfind(')')
    data = None
    if start >= 0 and end > start:
        try:
            data = json.loads(text[start + 1:end])
        except Exception:
            data = None
    return {'raw': text, 'data': data}


async def submit_auth_verify_py(verify_payload):
    timestamp = checksum_timestamp(now_ms())
    body = {
        'captchaId': verify_payload.get('captchaId') or '',
        'captchaOutput': verify_payload.get('captchaOutput') or '',
        'genTime': int(verify_payload.get('genTime') or 0),
        'lotNumber': verify_payload.get('lotNumber') or '',
        'passToken': verify_payload.get('passToken') or '',
    }
    headers = {
        **SITE_HEADERS,
        **({'cookie': AUTH_STATE['cookies']} if AUTH_STATE['cookies'] else {}),
        'referer': f'{HOST}/verify',
        'x-client-id': AUTH_STATE['clientId'] or random_hex(16),
        'x-verify-token': AUTH_STATE['verifyToken'] or '',
        'Content-Type': 'application/json',
        'x-timestamp': timestamp,
    }
    if AUTH_STATE['reportId'] and AUTH_STATE['session'] and AUTH_STATE['traceId']:
        headers[AUTH_STATE['reportId']] = build_sign(f'{HOST}/api/auth/verify', timestamp, AUTH_STATE['session'], AUTH_STATE['traceId'])
    return await request_json(f'{HOST}/api/auth/verify', method='POST', headers=headers, body=json.dumps(body))


async def ensure_verify_token(force=False):
    if not force and not AUTH_STATE['verifyToken']:
        await load_auth_state_from_cache()
    token_fresh = AUTH_STATE["verifyToken"] and (now_ms() - AUTH_STATE["verifiedAt"] < TTL_AUTH_MS)
    if not force and token_fresh:
        return AUTH_STATE["verifyToken"]

    try:
        await ensure_site_cookie(True)
        verify_conf = await fetch_verify_config_py()
        captcha_id = (((verify_conf or {}).get('data') or {}).get('captchaId') or '')
        if not captcha_id:
            await log('warn', f"[木兮][verify] missing captchaId cookies={AUTH_STATE.get('cookies','')}")
            return ''
        challenge = f'muxi-{now_ms()}-{random_hex(4)}'
        load = await fetch_geetest_load_py(captcha_id, challenge)
        load_data = ((((load or {}).get('data') or {}).get('data')) or {})
        bg = load_data.get('bg') or ''
        slice_path = load_data.get('slice') or ''
        ypos = load_data.get('ypos') or 0
        bg_url = f"https://static.geetest.com/{bg}" if bg else ''
        slice_url = f"https://static.geetest.com/{slice_path}" if slice_path else ''
        gap = {'bestX': 0, 'bestScore': 0, 'engine': 'none'}
        if bg_url:
            bg_buffer = await get_buffer(bg_url, headers={'User-Agent': UA, 'referer': f'{HOST}/'})
            slice_buffer = await get_buffer(slice_url, headers={'User-Agent': UA, 'referer': f'{HOST}/'}) if slice_url else None
            external_gap = await request_external_gap_py(bg_buffer, slice_buffer)
            if external_gap:
                gap = external_gap
            else:
                if EXTERNAL_SLIDE_API:
                    await log('warn', f"[木兮][verify] external ocr unavailable api={EXTERNAL_SLIDE_API}")
                gap = detect_gap_x_py(bg_buffer, ypos, slice_buffer)
        prepared = {
            'captchaId': captcha_id,
            'challenge': challenge,
            'loadData': load_data,
            'ypos': ypos,
            'gap': gap,
        }
        ready = build_verify_ready_payload(prepared)
        await log('info', f"[木兮][verify] python preflight captchaId={captcha_id} gapX={gap.get('bestX')} score={gap.get('bestScore')} engine={gap.get('engine')} lot={ready.get('lotNumber')} cookies={AUTH_STATE.get('cookies','')} geetestCookie={GEETEST_STATE.get('cookie','')}")
        if gap.get('error'):
            await log('warn', f"[木兮][verify] gap engine error={gap.get('error')}")
        if gap.get('raw'):
            await log('info', f"[木兮][verify] gap raw={str(gap.get('raw'))[:500]}")
        verify_result = None
        cached_delta = await get_sdk_cache(VERIFY_DELTA_CACHE_KEY)
        delta_order = list(SETLEFT_SCAN_OFFSETS)
        if isinstance(cached_delta, int) and cached_delta in delta_order:
            delta_order = [cached_delta] + [d for d in delta_order if d != cached_delta]
        for delta in delta_order:
            candidate = build_verify_ready_payload(prepared, (gap.get('bestX') or 0) + delta)
            candidate['w'] = generate_w(candidate)
            await log('info', f"[木兮][verify] geetest verify delta={delta} setLeft={candidate.get('setLeft')} hasW={'yes' if candidate.get('w') else 'no'} geetestCookie={GEETEST_STATE.get('cookie','')}")
            verify_result = await verify_geetest_py(candidate)
            verify_data = ((verify_result or {}).get('data') or {})
            result = (((verify_data.get('data') or {}).get('result')) or verify_data.get('result') or '')
            if not result:
                await log('warn', f"[木兮][verify] geetest verify empty result raw={str((verify_result or {}).get('raw') or '')[:300]}")
            await log('info', f"[木兮][verify] geetest verify result={result}")
            seccode = (verify_data.get('data') or {}).get('seccode') or verify_data.get('seccode') or {}
            if result == 'success' and seccode:
                payload = {
                    'captchaId': captcha_id,
                    'captchaOutput': seccode.get('captcha_output') or '',
                    'genTime': int(seccode.get('gen_time') or 0),
                    'lotNumber': seccode.get('lot_number') or '',
                    'passToken': seccode.get('pass_token') or '',
                }
                await log('info', f"[木兮][verify] auth verify submit lot={payload['lotNumber']} genTime={payload['genTime']}")
                auth_verify = await submit_auth_verify_py(payload)
                await log('info', f"[木兮][verify] auth verify response code={(auth_verify or {}).get('code')} message={(auth_verify or {}).get('message')}")
                data = (auth_verify or {}).get('data') or {}
                token = str(data.get('token') or '')
                if data.get('verified') and token:
                    AUTH_STATE['verifyToken'] = token
                    AUTH_STATE['verifiedAt'] = now_ms()
                    await set_sdk_cache(VERIFY_DELTA_CACHE_KEY, delta, 86400)
                    await persist_auth_state()
                    return token
                break
    except Exception as e:
        await log('error', f"[木兮][verify] python verifier preflight failed: {e}")
    return ''


async def warm_play_context(film_id, line_id, referer):
    steps = [
        f"{HOST}/api/system/config",
        f"{HOST}/api/stats/track",
        f"{HOST}/api/film/detail/play?filmId={quote(str(film_id or ''))}",
        f"{HOST}/api/category/top",
        f"{HOST}/api/issue/new",
        f"{HOST}/api/film/search/hot",
        f"{HOST}/api/line/play?lineId={quote(str(line_id or ''))}",
    ]
    for url in steps:
        try:
            await request_text(url, headers=build_signed_headers(url, referer, True))
        except Exception:
            pass
    time.sleep(2.8)


def clean_html_text(value):
    text = html.unescape(str(value or ""))
    text = text.replace("\xa0", " ")
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text)
    return text.strip()


def join_text_parts(*parts):
    out = []
    for part in parts:
        text = clean_html_text(part)
        if text:
            out.append(text)
    return " / ".join(out)


def to_vod_list(items):
    out = []
    for item in items if isinstance(items, list) else []:
        vod_id = str(item.get("id") or "")
        vod_name = str(item.get("name") or "")
        if not vod_id or not vod_name:
            continue
        area = str(item.get("area") or "")
        language = str(item.get("language") or "")
        out.append({
            "vod_id": vod_id,
            "vod_name": vod_name,
            "vod_pic": str(item.get("cover") or ""),
            "vod_remarks": str(item.get("updateStatus") or ""),
            "vod_content": clean_html_text(item.get("blurb") or ""),
            "type_id": str(item.get("categoryId") or ""),
            "type_name": TYPE_NAME_MAP.get(item.get("categoryId"), ""),
            "vod_year": str(item.get("year") or ""),
            "vod_area": area,
            "vod_lang": language,
            "vod_director": clean_html_text(item.get("director") or ""),
            "vod_actor": clean_html_text(item.get("actor") or ""),
            "vod_douban_score": str(item.get("doubanScore") or ""),
            "other": join_text_parts(area, language),
        })
    return out


def dedupe_vod_list(items, limit=0):
    out = []
    seen = set()
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        vod_id = str(item.get("vod_id") or "").strip()
        vod_name = str(item.get("vod_name") or "").strip()
        key = vod_id or vod_name
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
        if limit and len(out) >= limit:
            break
    return out


def build_muxi_resource_id(vod_id):
    return str(vod_id or "").strip()


def build_muxi_episode_file_id(vod_id, source_name, episode_index, episode_name):
    return f"{build_muxi_resource_id(vod_id)}#{str(source_name or '默认').strip()}#{int(episode_index)}#{str(episode_name or '').strip()}"


def encode_muxi_play_meta(meta):
    try:
        raw = json.dumps(meta or {}, ensure_ascii=False)
        return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")
    except Exception:
        return ""


def decode_muxi_play_meta(raw):
    try:
        text = base64.urlsafe_b64decode(str(raw or "").encode("utf-8")).decode("utf-8")
        return json.loads(text or "{}")
    except Exception:
        return {}


def build_muxi_scraped_episode_name(mapping, fallback_name):
    if not isinstance(mapping, dict):
        return str(fallback_name or "")
    episode_number = mapping.get("episodeNumber")
    episode_name = str(mapping.get("episodeName") or "").strip()
    if episode_number and episode_name:
        return f"{episode_number}.{episode_name}"
    if episode_name:
        return episode_name
    return str(fallback_name or "")


def extract_muxi_episode(title):
    raw = str(title or "")
    if not raw:
        return ""
    text = re.sub(r"\s+", " ", raw).strip()
    match = re.search(r"第\s*(\d{1,3})\s*[集话章节回]", text)
    if match:
        return match.group(1)
    match = re.search(r"\b(?:EP|E)[-._\s]*(\d{1,3})\b", text, flags=re.I)
    if match:
        return match.group(1)
    match = re.search(r"[Ss](?:\d{1,2})?[-._\s]*[Ee](\d{1,3})", text, flags=re.I)
    if match:
        return match.group(1)
    match = re.search(r"[\[\(【](\d{1,3})[\]\)】]", text)
    if match and match.group(1) not in {"480", "720", "1080", "2160"}:
        return match.group(1)
    if re.fullmatch(r"\d{1,3}", text):
        return text
    return ""


def build_muxi_danmaku_file_name(vod_name, episode_title):
    title = str(vod_name or "").strip()
    episode = str(episode_title or "").strip()
    if not title:
        return episode
    if not episode or episode == "播放":
        return title
    digits = extract_muxi_episode(episode)
    if digits:
        try:
            num = int(digits)
            return f"{title} 第{num:02d}集"
        except Exception:
            return f"{title} 第{digits}集"
    return f"{title} {episode}".strip()


def build_muxi_danmaku_candidates(vod_name, episode_name, metadata, file_id):
    candidates = []
    title = str(vod_name or "").strip()
    raw_episode = str(episode_name or "").strip()

    def push(value):
        text = str(value or "").strip()
        if text and text not in candidates:
            candidates.append(text)

    if isinstance(metadata, dict):
        mappings = metadata.get("videoMappings") or []
        if isinstance(mappings, list) and file_id:
            for mapping in mappings:
                if not isinstance(mapping, dict):
                    continue
                if str(mapping.get("fileId") or "").strip() != str(file_id or "").strip():
                    continue
                scraped_episode_name = build_muxi_scraped_episode_name(mapping, raw_episode)
                push(f"{title} {scraped_episode_name}".strip())
                push(build_muxi_danmaku_file_name(title, scraped_episode_name))
                break

    push(build_muxi_danmaku_file_name(title, raw_episode))
    push(f"{title} {raw_episode}".strip())
    if title:
        push(title)
    return candidates


def apply_muxi_scrape_mappings(play_sources, metadata):
    if not isinstance(metadata, dict):
        return play_sources, 0
    mappings = metadata.get("videoMappings") or []
    if not isinstance(mappings, list) or not mappings:
        return play_sources, 0

    mapping_by_file_id = {}
    for mapping in mappings:
        if not isinstance(mapping, dict):
            continue
        file_id = str(mapping.get("fileId") or "").strip()
        if file_id:
            mapping_by_file_id[file_id] = mapping

    renamed = 0
    for source in play_sources if isinstance(play_sources, list) else []:
        for episode in (source or {}).get("episodes") or []:
            file_id = str((episode or {}).get("_file_id") or "").strip()
            if not file_id or file_id not in mapping_by_file_id:
                continue
            new_name = build_muxi_scraped_episode_name(mapping_by_file_id[file_id], episode.get("name"))
            if new_name and new_name != episode.get("name"):
                episode["name"] = new_name
                renamed += 1
    return play_sources, renamed


async def spawn_background_job(coro, label):
    try:
        task = asyncio.create_task(coro)

        def _on_done(fut):
            try:
                fut.result()
            except Exception as e:
                try:
                    asyncio.create_task(log("warn", f"[木兮][bg:{label}] {e}"))
                except Exception:
                    pass

        task.add_done_callback(_on_done)
    except Exception as e:
        await log("warn", f"[木兮][bg-spawn:{label}] {e}")


async def run_muxi_scraping_task(vod_id, vod_name, play_sources):
    try:
        resource_id = build_muxi_resource_id(vod_id)
        video_files = []
        for source in play_sources if isinstance(play_sources, list) else []:
            source_name = str((source or {}).get("name") or "默认").strip() or "默认"
            for idx, episode in enumerate((source or {}).get("episodes") or [], start=1):
                episode_name = str((episode or {}).get("name") or f"第{idx}集").strip() or f"第{idx}集"
                file_id = str((episode or {}).get("_file_id") or build_muxi_episode_file_id(vod_id, source_name, idx, episode_name)).strip()
                video_files.append({
                    "fid": file_id,
                    "file_id": file_id,
                    "file_name": episode_name,
                    "name": episode_name,
                    "format_type": "video",
                })
        if not video_files:
            await log("info", f"[木兮][scrape] skip empty video files vodId={vod_id}")
            return
        await log("info", f"[木兮][scrape] start vodId={vod_id} files={len(video_files)}")
        await OmniBox.processScraping(resource_id, vod_name or "", vod_name or "", video_files)
        metadata = await OmniBox.getScrapeMetadata(resource_id)
        mapping_count = len((metadata or {}).get("videoMappings") or []) if isinstance(metadata, dict) else 0
        has_scrape = bool(((metadata or {}).get("scrapeData") or {})) if isinstance(metadata, dict) else False
        renamed_sources, renamed_count = apply_muxi_scrape_mappings(play_sources, metadata if isinstance(metadata, dict) else {})

        cache_key = f"detail:{vod_id}"
        cached_detail = get_cache(cache_key, TTL_DETAIL_MS)
        if isinstance(cached_detail, dict) and renamed_count > 0:
            cached_detail["vod_play_sources"] = renamed_sources
            set_cache(cache_key, cached_detail)

        await log("info", f"[木兮][scrape] done vodId={vod_id} mappings={mapping_count} renamed={renamed_count} hasScrape={has_scrape}")
    except Exception as e:
        await log("warn", f"[木兮][scrape] {e}")


def map_home_poster_item(item):
    if not isinstance(item, dict):
        return {}
    vod_id = str(item.get("filmId") or item.get("id") or "").strip()
    vod_name = str(item.get("filmName") or item.get("name") or "").strip()
    if not vod_id or not vod_name:
        return {}
    category_id = str(item.get("categoryId") or "").strip()
    return {
        "vod_id": vod_id,
        "vod_name": vod_name,
        "vod_pic": str(item.get("poster") or item.get("cover") or ""),
        "vod_remarks": str(item.get("updateStatus") or "轮播推荐"),
        "vod_content": clean_html_text(item.get("blurb") or ""),
        "type_id": category_id,
        "type_name": TYPE_NAME_MAP.get(int(category_id), "") if category_id.isdigit() else "",
    }


def is_success_json(json_obj):
    return isinstance(json_obj, dict) and str(json_obj.get("code")) == "200"


def has_nonempty_detail_fields(data):
    if not isinstance(data, dict):
        return False
    keys = ("other", "director", "actor", "doubanScore", "year", "area", "language")
    return any(str(data.get(key) or "").strip() for key in keys)


def has_auth_state(require_verify=False):
    basic = bool(AUTH_STATE.get("cookies") and AUTH_STATE.get("session") and AUTH_STATE.get("traceId") and AUTH_STATE.get("reportId"))
    if not basic:
        return False
    if require_verify:
        return bool(AUTH_STATE.get("verifyToken"))
    return True


async def request_json_with_auth_retry(url, referer=None, use_checksum_ts=False, validator=None, force_verify=False):
    async def do_request(force_auth=False):
        auth_ready = await init_auth(force_auth)
        if not auth_ready:
            return None
        if force_verify:
            token = await ensure_verify_token(force_auth)
            if not token:
                await log("warn", f"[木兮][request] verify token missing url={url}")
        return await request_json(url, headers=build_signed_headers(url, referer, use_checksum_ts))

    json_obj = await do_request(False)
    ok = validator(json_obj) if callable(validator) else is_success_json(json_obj)
    if ok:
        return json_obj

    await log("warn", f"[木兮][request] retry with refreshed auth url={url}")
    return await do_request(True)


async def fetch_home_data():
    referer = f"{HOST}/index"
    category_url = f"{HOST}/api/film/category"
    poster_url = f"{HOST}/api/poster/list"

    async def request_once(url):
        return await request_json_with_auth_retry(
            url,
            referer=referer,
            use_checksum_ts=True,
            validator=lambda obj: is_success_json(obj) and isinstance(obj.get("data"), list),
        )

    poster_json, category_json = await asyncio.gather(
        request_once(poster_url),
        request_once(category_url),
    )

    poster_list = []
    for item in ((poster_json or {}).get("data") or []):
        mapped = map_home_poster_item(item)
        if mapped:
            poster_list.append(mapped)

    classes = []
    merged = list(poster_list)
    category_groups = ((category_json or {}).get("data") or [])
    for group in category_groups if isinstance(category_groups, list) else []:
        type_id = str(group.get("categoryId") or "").strip()
        type_name = str(group.get("categoryName") or TYPE_NAME_MAP.get(int(type_id), "") if type_id.isdigit() else "").strip()
        if type_id and type_name:
            classes.append({"type_id": type_id, "type_name": type_name})
        merged.extend(to_vod_list(group.get("filmList") or []))

    return {
        "class": classes or SITE_CLASS,
        "filters": SITE_FILTERS,
        "list": dedupe_vod_list(merged),
    }


async def home(params, context):
    try:
        cache_key = "home"
        cached = get_cache(cache_key, TTL_HOME_MS)
        if cached is not None:
            return cached

        await init_auth()
        result = await fetch_home_data()
        if not result.get("list"):
            refreshed = await init_auth(True)
            if refreshed:
                result = await fetch_home_data()

        set_cache(cache_key, result)
        return result
    except Exception as e:
        await log("error", f"[木兮][home] {e}")
        return {"class": SITE_CLASS, "filters": SITE_FILTERS, "list": []}


async def category(params, context):
    try:
        type_id = str(params.get("categoryId") or params.get("type_id") or "1").strip() or "1"
        page = normalize_page(params.get("page"))
        extend = parse_extend(params.get("extend") or params.get("filters") or params.get("ext"))
        filter_obj = {**(FILTER_DEF.get(type_id) or FILTER_DEF["1"]), **extend}
        cache_key = f"category:{type_id}:{page}:{json.dumps(filter_obj, ensure_ascii=False, sort_keys=True)}"
        cached = get_cache(cache_key, TTL_CATEGORY_MS)
        if cached is not None:
            return cached

        qs = urlencode({
            "categoryId": type_id,
            "language": str(filter_obj.get("lang") or ""),
            "pageNum": str(page),
            "pageSize": "15",
            "sort": str(filter_obj.get("by") or "updateTime"),
            "year": str(filter_obj.get("year") or ""),
        })
        url = f"{HOST}/api/film/category/list?{qs}"
        referer = f"{HOST}/m/category?categoryId={quote(type_id)}"

        async def fetch_list():
            json_obj = await request_json_with_auth_retry(
                url,
                referer=referer,
                validator=lambda obj: is_success_json(obj) and isinstance((((obj or {}).get("data") or {}).get("list")), list),
            )
            return to_vod_list((((json_obj or {}).get("data") or {}).get("list")) or [])

        list_data = await fetch_list()

        result = {
            "page": page,
            "pagecount": page + 1 if len(list_data) >= 10 else page,
            "total": page * 15 + len(list_data) if list_data else 0,
            "list": list_data,
        }
        set_cache(cache_key, result)
        return result
    except Exception as e:
        await log("error", f"[木兮][category] {e}")
        return {"page": 1, "pagecount": 0, "total": 0, "list": []}


async def detail(params, context):
    try:
        ids = [x.strip() for x in str(params.get("videoId") or params.get("id") or "").split(",") if x.strip()]
        if not ids:
            return {"list": []}
        out = []
        for film_id in ids:
            cache_key = f"detail:{film_id}"
            item = get_cache(cache_key, TTL_DETAIL_MS)
            if item is None:
                detail_referer = f"{HOST}/detail/1/{quote(film_id)}"
                play_url = f"{HOST}/api/film/detail/play?filmId={quote(film_id)}"

                play_json = await request_json_with_auth_retry(
                    play_url,
                    referer=detail_referer,
                    validator=lambda obj: is_success_json(obj) and isinstance(((obj or {}).get("data") or {}).get("playLineList"), list),
                )
                data = (play_json or {}).get("data") or {}
                if not data:
                    continue

                sources = []
                for line in data.get("playLineList") or []:
                    episodes = []
                    for ep_index, ep in enumerate(line.get("lines") or [], start=1):
                        line_id = str(ep.get("id") or "").strip()
                        if not line_id:
                            continue
                        title = str(ep.get("name") or f"第{ep_index}集").strip() or f"第{ep_index}集"
                        file_id = build_muxi_episode_file_id(data.get("id") or film_id, line.get("playerName") or "默认", ep_index, title)
                        play_meta = encode_muxi_play_meta({
                            "vod_id": str(data.get("id") or film_id),
                            "vod_name": str(data.get("name") or ""),
                            "category_id": str(data.get("categoryId") or ""),
                            "episode_name": title,
                            "file_id": file_id,
                            "source_name": str(line.get("playerName") or "默认"),
                        })
                        play_id = f"{line_id}@{data.get('id') or film_id}@{data.get('categoryId') or ''}"
                        if play_meta:
                            play_id = f"{play_id}|||{play_meta}"
                        episodes.append({
                            "name": title,
                            "playId": play_id,
                            "_file_id": file_id,
                        })
                    if episodes:
                        sources.append({
                            "name": str(line.get("playerName") or "默认"),
                            "episodes": episodes,
                        })

                area = str(data.get("area") or "")
                language = str(data.get("language") or "")
                director = clean_html_text(data.get("director") or "")
                actor = clean_html_text(data.get("actor") or "")
                other = str(data.get("other") or join_text_parts(area, language))
                metadata = None
                renamed_count = 0
                try:
                    metadata = await OmniBox.getScrapeMetadata(build_muxi_resource_id(data.get("id") or film_id))
                    sources, renamed_count = apply_muxi_scrape_mappings(sources, metadata if isinstance(metadata, dict) else {})
                except Exception as e:
                    await log("warn", f"[木兮][detail] scrape metadata read failed {e}")

                item = {
                    "vod_id": str(data.get("id") or film_id),
                    "vod_name": str(data.get("name") or ""),
                    "type_id": str(data.get("categoryId") or ""),
                    "type_name": str(data.get("categoryName") or TYPE_NAME_MAP.get(data.get("categoryId"), "")),
                    "vod_pic": str(data.get("cover") or ""),
                    "vod_remarks": str(data.get("updateStatus") or ""),
                    "vod_content": clean_html_text(data.get("blurb") or ""),
                    "vod_year": str(data.get("year") or ""),
                    "vod_area": area,
                    "vod_lang": language,
                    "vod_director": director,
                    "vod_actor": actor,
                    "vod_douban_score": str(data.get("doubanScore") or ""),
                    "other": other,
                    "director": director,
                    "actor": actor,
                    "doubanScore": str(data.get("doubanScore") or ""),
                    "vod_play_sources": sources,
                }
                set_cache(cache_key, item)
                await log("info", f"[木兮][detail] scrape-rename immediate={renamed_count} vodId={item.get('vod_id')}")
                await spawn_background_job(
                    run_muxi_scraping_task(item.get("vod_id"), item.get("vod_name"), sources),
                    f"scrape:{item.get('vod_id')}",
                )
            if item:
                out.append(item)
        return {"list": out}
    except Exception as e:
        await log("error", f"[木兮][detail] {e}")
        return {"list": []}


async def play(params, context):
    try:
        raw_id = str(params.get("playId") or params.get("id") or "").strip()
        if not raw_id:
            return dict(EMPTY_PLAY)
        cache_key = f"play:{raw_id}"
        cached = get_cache(cache_key, TTL_PLAY_MS)
        if cached is not None:
            return cached

        play_meta = {}
        play_id_raw = raw_id
        if "|||" in raw_id:
            play_id_raw, meta_raw = raw_id.split("|||", 1)
            play_meta = decode_muxi_play_meta(meta_raw)

        parts = play_id_raw.split("@")
        line_id = parts[0] if len(parts) > 0 else ""
        film_id = str(play_meta.get("vod_id") or (parts[1] if len(parts) > 1 else ""))
        category_id = str(play_meta.get("category_id") or (parts[2] if len(parts) > 2 else ""))
        file_id = str(play_meta.get("file_id") or params.get("file_id") or params.get("fid") or "").strip()
        if not line_id:
            return dict(EMPTY_PLAY)

        referer = f"{HOST}/m/player?cid={quote(category_id)}&film_id={quote(film_id)}&line_id={quote(line_id)}"
        parse_url = f"{HOST}/api/line/play/parse?lineId={quote(line_id)}"

        async def load_direct_play(force_auth=False):
            token = await ensure_verify_token(force_auth)
            await log("info", f"[木兮][play] verify forceAuth={force_auth} token={'yes' if token else 'no'} lineId={line_id}")
            if not token:
                return ""
            await warm_play_context(film_id, line_id, referer)
            json_obj = await request_json_with_auth_retry(
                parse_url,
                referer=referer,
                use_checksum_ts=True,
                force_verify=True,
                validator=lambda obj: is_success_json(obj) and str((obj or {}).get("data") or "").strip() != "",
            )
            await log("info", f"[木兮][play] parse response code={(json_obj or {}).get('code')} message={(json_obj or {}).get('message')}")
            return str((json_obj or {}).get("data") or "").strip()

        episode_name = str(play_meta.get("episode_name") or params.get("name") or params.get("episodeName") or params.get("title") or "播放").strip() or "播放"
        vod_name_for_side = str(play_meta.get("vod_name") or params.get("vod_name") or params.get("videoName") or film_id)

        async def load_danmaku_bundle():
            metadata = None
            try:
                metadata = await OmniBox.getScrapeMetadata(build_muxi_resource_id(film_id))
            except Exception:
                metadata = None
            candidates = build_muxi_danmaku_candidates(vod_name_for_side, episode_name, metadata, file_id)
            for candidate in candidates:
                danmaku = await OmniBox.getDanmakuByFileName(candidate)
                if danmaku:
                    return candidate, danmaku
            return (candidates[0] if candidates else f"{vod_name_for_side} {episode_name}".strip()), None

        play_task = asyncio.create_task(load_direct_play(False))
        danmaku_task = asyncio.create_task(load_danmaku_bundle())

        play_url = await play_task
        if not play_url:
            play_url = await load_direct_play(True)
        if not play_url:
            if not danmaku_task.done():
                danmaku_task.cancel()
            return dict(EMPTY_PLAY)

        result = {
            "parse": 0,
            "url": play_url,
            "urls": [{"name": episode_name, "url": play_url}],
            "header": {
                "User-Agent": SITE_HEADERS["User-Agent"],
                "Referer": referer,
            },
            "flag": str(params.get("flag") or ""),
        }

        try:
            danmaku_file_name, danmaku = await danmaku_task
            if danmaku:
                result["danmaku"] = danmaku
                await log("info", f"[木兮][play] danmaku attached file={danmaku_file_name}")
            else:
                await log("info", f"[木兮][play] danmaku miss file={danmaku_file_name}")
        except Exception as e:
            await log("warn", f"[木兮][play] danmaku attach failed {e}")
        set_cache(cache_key, result)
        return result
    except Exception as e:
        await log("error", f"[木兮][play] {e}")
        return dict(EMPTY_PLAY)


async def search(params, context):
    try:
        page = normalize_page(params.get("page"))
        wd = str(params.get("keyword") or params.get("wd") or params.get("key") or "").strip()
        if not wd:
            return {"page": page, "pagecount": page, "total": 0, "list": []}
        cache_key = f"search:{page}:{wd}"
        cached = get_cache(cache_key, TTL_SEARCH_MS)
        if cached is not None:
            return cached

        url = f"{HOST}/api/film/search?keyword={quote(wd)}&pageNum={page}&pageSize=10"
        referer = f"{HOST}/m/search?keyword={quote(wd)}"

        json_obj = await request_json_with_auth_retry(
            url,
            referer=referer,
            use_checksum_ts=True,
            force_verify=True,
            validator=lambda obj: is_success_json(obj) and isinstance((((obj or {}).get("data") or {}).get("list")), list),
        )
        if (json_obj or {}).get("code") == 1004 or (json_obj or {}).get("message") == "请先完成验证":
            await log("warn", f"[木兮][search] verify required keyword={wd}")
            json_obj = await request_json_with_auth_retry(
                url,
                referer=referer,
                use_checksum_ts=True,
                force_verify=True,
                validator=lambda obj: is_success_json(obj) and isinstance((((obj or {}).get("data") or {}).get("list")), list),
            )

        list_data = to_vod_list((((json_obj or {}).get("data") or {}).get("list")) or [])
        result = {
            "page": page,
            "pagecount": page + 1 if list_data else page,
            "total": len(list_data),
            "list": list_data,
        }
        set_cache(cache_key, result)
        return result
    except Exception as e:
        await log("error", f"[木兮][search] {e}")
        return {"page": 1, "pagecount": 0, "total": 0, "list": []}


if __name__ == "__main__":
    run({"home": home, "category": category, "detail": detail, "search": search, "play": play})
