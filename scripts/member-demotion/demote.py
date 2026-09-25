#!/usr/bin/env python3
"""Demote every member on a target list to 비지터 through the studio page.

Needs a studio.cafe.naver.com tab open in the Aside browser. For each level
the list is sorted by last visit and walked from page 1; the targets on the
page (up to 100) are ticked and changed in one 등급 변경 dialog. Demoted rows
leave the list and later rows move up, so a page is reread until it holds no
target. Each batch is appended to the progress file, and a rerun skips what
it already records.

  python3 scripts/member-demotion/demote.py --targets ~/Documents/inactive_..._대상.csv
  python3 scripts/member-demotion/demote.py --targets ... --dry-run
"""
import argparse
import datetime
import json
import math
import os

import studio
import target_list as tl

DEFAULT_REASON = "1년 글 미작성, 새글 작성 후 재등업 가능"
REASON_MAX_LENGTH = 25
BATCH_SIZE = 100
LEVEL_ORDER = list(studio.LEVEL_IDS)
ATTEMPTS_PER_LEVEL = 3

DEMOTE_PAGE_JS = r"""
const P = __PARAMS__;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const stop = (reason) => { console.log('STOP:' + reason); throw new Error(reason); };
const buttons = (tree) => [...tree.matchAll(/button "([^"]+)" \[ref=(e\d+)\]/g)].map(m => ({text: m[1], ref: m[2]}));
const pageRows = (tree) => {
  const boxes = [...tree.matchAll(/checkbox "([^"]+) 선택" \[ref=(e\d+)\]/g)].filter(m => m[1] !== '전체');
  const tags = [...tree.matchAll(/button "멤버 태그 (\w+) 복사"/g)];
  return boxes.map(b => {
    const t = tags.find(t => t.index > b.index);
    return t ? {ref: b[2], tag: t[1]} : null;
  }).filter(Boolean);
};

// After 확인 the studio may ask to confirm 조정 멤버, then reports success.
const settleAlerts = async (p) => {
  let idle = 0;
  for (let i = 0; i < 12; i++) {
    let tree = null;
    try { tree = (await snapshot(p, {selector: '[role="alertdialog"]'})).tree; } catch (e) { tree = null; }
    const text = tree ? tree.match(/alertdialog "([^"]+)"/) : null;
    if (!text) {
      if (idle >= 6) return;
      idle++; await sleep(1000); continue;
    }
    const ok = tree.match(/button "확인" \[ref=(e\d+)\]/);
    if (!ok) stop('alert_without_ok:' + text[1]);
    if (/등급이\s*변경되었습니다/.test(text[1])) { await p.locator(ok[1]).click(); return; }
    if (/조정 멤버가\s*\d+명 포함되어 있습니다/.test(text[1])) { await p.locator(ok[1]).click(); await sleep(1500); continue; }
    stop('unexpected_alert:' + text[1]);
  }
  stop('alert_loop_exceeded');
};

const tab = (await listBrowserTabs()).find(t => t.url.includes('studio.cafe.naver.com'));
if (!tab) stop('no_studio_tab');
const p = await attachBrowserTab(tab.targetId);
await p.goto(P.pageUrl);
await sleep(2000);

const wanted = new Set(P.remainingTags);
const picked = pageRows((await snapshot(p)).tree).filter(r => wanted.has(r.tag)).slice(0, P.batchSize);
if (picked.length === 0 || P.dryRun) {
  console.log('BATCH:' + JSON.stringify({tags: picked.map(r => r.tag), dryRun: P.dryRun}));
} else {
  for (const row of picked) await p.locator(row.ref).click();
  const change = buttons((await snapshot(p)).tree).find(b => b.text === '등급 변경');
  if (!change) stop('no_grade_change_button');
  await p.locator(change.ref).click();

  const dialog = (await snapshot(p)).tree;
  if (!/heading "등급 변경"/.test(dialog)) stop('dialog_not_open');
  const level = dialog.match(/combobox "([^"]+)" \[ref=(e\d+)\]/);
  if (!level || level[1] !== P.visitorLevelName) stop('combobox_not_visitor:' + (level ? level[1] : 'none'));
  const reason = dialog.match(/textbox[^\n]*\[ref=(e\d+)\]/);
  if (!reason) stop('no_reason_textbox');
  await p.locator(reason[1]).fill(P.reason);

  const ok = buttons((await snapshot(p)).tree).find(b => b.text === '확인');
  if (!ok) stop('no_ok_button');
  await p.locator(ok.ref).click();
  await settleAlerts(p);
  console.log('BATCH:' + JSON.stringify({tags: picked.map(r => r.tag), dryRun: false}));
}
"""


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--targets", required=True, help="CSV written by build_targets.py")
    parser.add_argument("--progress", help="batch log (default: <targets>.progress.jsonl)")
    parser.add_argument("--reason", default=DEFAULT_REASON)
    parser.add_argument("--dry-run", action="store_true", help="find targets on each page without ticking them")
    args = parser.parse_args()
    if len(args.reason) > REASON_MAX_LENGTH:
        parser.error(f"--reason is {len(args.reason)} chars; the studio allows {REASON_MAX_LENGTH}")
    args.targets = os.path.expanduser(args.targets)
    args.progress = args.progress or os.path.splitext(args.targets)[0] + ".progress.jsonl"
    return args


def targets_by_level(path):
    levels = {level: set() for level in LEVEL_ORDER}
    for row in tl.read_rows(path):
        if row[tl.LEVEL] in levels:
            levels[row[tl.LEVEL]].add(row[tl.TAG].strip())
    return levels


def load_done(progress_path):
    if not os.path.exists(progress_path):
        return set()
    with open(progress_path, encoding="utf-8") as f:
        return {tag for line in f if line.strip() for tag in json.loads(line)["tags"]}


def log_batch(progress_path, level, page, sort_order, tags):
    record = {"level": level, "page": page, "sort": sort_order, "tags": tags,
              "at": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    with open(progress_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def walk_pages(args, level, targets, done, sort_order):
    level_id = studio.LEVEL_IDS[level]
    total = studio.level_total(level_id, "LAST_VISIT_DATE", sort_order)
    listed = total
    demoted = 0
    page = 1
    while page <= min(math.ceil(total / studio.PER_PAGE), studio.MAX_PAGES):
        remaining = targets - done
        if not remaining:
            break
        page_url = (f"{studio.MEMBER_LIST_PAGE}?page={page}&perPage={studio.PER_PAGE}&activityStopFilter=ALL"
                    f"&memberLevel={level_id}&sortType=LAST_VISIT_DATE&sortOrder={sort_order}")
        params = {"pageUrl": page_url, "remainingTags": sorted(remaining), "batchSize": BATCH_SIZE,
                  "reason": args.reason, "visitorLevelName": studio.VISITOR_LEVEL_NAME, "dryRun": args.dry_run}
        batch = studio.repl_result(studio.with_params(DEMOTE_PAGE_JS, params), "BATCH")
        tags = batch["tags"]
        if args.dry_run:
            print(f"  [{level}] page {page} {sort_order}: {len(tags)} targets (dry run)")
            done |= set(tags)
            page += 1
        elif tags:
            log_batch(args.progress, level, page, sort_order, tags)
            done |= set(tags)
            demoted += len(tags)
            total -= len(tags)
            print(f"  [{level}] page {page} {sort_order}: demoted {len(tags)} (level {demoted})")
        else:
            page += 1
    return demoted, listed


def process_level(args, level, targets, done):
    demoted, listed = walk_pages(args, level, targets, done, "ASC")
    if listed > studio.LIST_CAP and targets - done:
        # A list shows at most 5000 rows; the other end reaches the rest.
        demoted += walk_pages(args, level, targets, done, "DESC")[0]
    missing = targets - done
    print(f"STATUS {level}: demoted={demoted} not_found={len(missing)}")
    if missing:
        print(f"  not found on {level} list: {' '.join(sorted(missing))}")


def main():
    args = parse_args()
    levels = targets_by_level(args.targets)
    print(f"targets: { {level: len(tags) for level, tags in levels.items()} }")
    print(f"progress: {args.progress}")
    for level in LEVEL_ORDER:
        for attempt in range(1, ATTEMPTS_PER_LEVEL + 1):
            done = set() if args.dry_run else load_done(args.progress)
            try:
                process_level(args, level, levels[level], done)
                break
            except Exception as error:  # a stale ref or slow page; rerun the level from the log
                print(f"  {level} attempt {attempt} failed: {error}")
                if attempt == ATTEMPTS_PER_LEVEL or str(error).startswith("studio stopped"):
                    raise


if __name__ == "__main__":
    main()
