"""Cafe studio access through the Aside browser CLI.

Every call runs inside the operator's logged-in Naver session: reads use the
REPL's cookie-bearing global fetch, level changes drive the studio page.
"""
import json
import os
import re
import subprocess

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOCAL_CONFIG_PATH = os.path.join(REPO_ROOT, "config", "local.json")

LEVEL_IDS = {"4GLASS": 140, "3GLASS": 130, "2GLASS": 120, "1GLASS": 110}
VISITOR_LEVEL_NAME = "비지터"
PER_PAGE = 250
LIST_CAP = 5000
MAX_PAGES = LIST_CAP // PER_PAGE
REPL_TIMEOUT_S = 115
TAG_LOOKUP_CHUNK = 40


def load_cafe_id():
    with open(LOCAL_CONFIG_PATH, encoding="utf-8") as f:
        cafe_id = json.load(f).get("cafeId")
    if not cafe_id:
        raise SystemExit(f"cafeId missing in {LOCAL_CONFIG_PATH}")
    return str(cafe_id)


CAFE_ID = load_cafe_id()
MEMBER_API = f"https://apis.cafe.naver.com/cafe-manage/cafe-manage/v1/cafes/{CAFE_ID}/members/list"
MEMBER_LIST_PAGE = f"https://studio.cafe.naver.com/@{CAFE_ID}/member/list"


def run_repl(js, timeout=REPL_TIMEOUT_S):
    """Run JS in the Aside REPL. The code is wrapped in a block so repeated
    runs never collide on top-level const names."""
    env = dict(os.environ)
    env["PATH"] = os.path.expanduser("~/.local/bin") + ":" + env.get("PATH", "")
    result = subprocess.run(
        ["aside", "repl", "{\n" + js + "\n}"],
        capture_output=True, text=True, timeout=timeout, env=env,
    )
    return result.stdout, result.stderr


def repl_result(js, marker, timeout=REPL_TIMEOUT_S):
    """Run JS that prints `<marker>:<json>` and return the parsed JSON."""
    stdout, stderr = run_repl(js, timeout)
    stop = re.search(r"STOP:(\S+)", stdout)
    if stop:
        raise RuntimeError(f"studio stopped: {stop.group(1)}\n{stdout[-2000:]}")
    found = re.search(rf"^{marker}:(.*)$", stdout, re.M)
    if not found:
        raise RuntimeError(f"no {marker} in REPL output\nstdout={stdout[-800:]}\nstderr={stderr[-800:]}")
    return json.loads(found.group(1))


def with_params(js_template, params):
    return js_template.replace("__PARAMS__", json.dumps(params, ensure_ascii=False))


LIST_MEMBERS_JS = r"""
const P = __PARAMS__;
const members = [];
let total = 0;
for (let page = 1; page <= P.maxPages; page++) {
  const body = await (await fetch(P.url + '&page=' + page)).json();
  total = body.totalCount;
  for (const m of body.members) {
    members.push({key: m.memberKey, tag: m.memberTag, nickname: m.nickname,
                  level: m.memberLevelName, joinDate: (m.joinDate || '').slice(0, 10)});
  }
  if (body.members.length === 0 || page * P.perPage >= total) break;
  await new Promise(r => setTimeout(r, 300));
}
console.log('MEMBERS:' + JSON.stringify({total, members}));
"""


def list_url(level_id, sort_type, sort_order, per_page=PER_PAGE):
    return (f"{MEMBER_API}?activityStopFilter=ALL&perPage={per_page}&memberLevel={level_id}"
            f"&sortType={sort_type}&sortOrder={sort_order}")


def fetch_list(level_id, sort_type, sort_order):
    params = {"url": list_url(level_id, sort_type, sort_order), "perPage": PER_PAGE, "maxPages": MAX_PAGES}
    return repl_result(with_params(LIST_MEMBERS_JS, params), "MEMBERS")


def fetch_level_members(level_name):
    """Every member currently at the level. A list stops at 5000 rows, so a
    larger level is read from both ends of the join-date order."""
    level_id = LEVEL_IDS[level_name]
    first = fetch_list(level_id, "JOIN_DATE", "ASC")
    by_key = {m["key"]: m for m in first["members"]}
    if first["total"] > LIST_CAP:
        for m in fetch_list(level_id, "JOIN_DATE", "DESC")["members"]:
            by_key[m["key"]] = m
    if len(by_key) < first["total"]:
        print(f"  WARNING {level_name}: read {len(by_key)} of {first['total']} members")
    return list(by_key.values())


LEVEL_TOTAL_JS = r"""
const P = __PARAMS__;
const body = await (await fetch(P.url)).json();
console.log('TOTAL:' + JSON.stringify(body.totalCount));
"""


def level_total(level_id, sort_type, sort_order):
    url = list_url(level_id, sort_type, sort_order, per_page=1) + "&page=1"
    return repl_result(with_params(LEVEL_TOTAL_JS, {"url": url}), "TOTAL", timeout=30)


LOOKUP_TAGS_JS = r"""
const P = __PARAMS__;
const found = {};
for (const tag of P.tags) {
  const body = await (await fetch(P.url + encodeURIComponent(tag))).json();
  const m = (body.members || []).find(m => m.memberTag === tag);
  found[tag] = m ? {key: m.memberKey, nickname: m.nickname, level: m.memberLevelName} : null;
}
console.log('LOOKUP:' + JSON.stringify(found));
"""


def lookup_tags(tags):
    """Current key and level of each member tag; None when not found."""
    url = f"{MEMBER_API}?activityStopFilter=ALL&page=1&perPage=30&searchType=MEMBER_TAG&keyword="
    found = {}
    for i in range(0, len(tags), TAG_LOOKUP_CHUNK):
        chunk = tags[i:i + TAG_LOOKUP_CHUNK]
        found.update(repl_result(with_params(LOOKUP_TAGS_JS, {"url": url, "tags": chunk}), "LOOKUP"))
    return found
