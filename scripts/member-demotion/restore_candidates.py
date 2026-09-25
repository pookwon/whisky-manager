#!/usr/bin/env python3
"""List demoted members who wrote again and should get their level back.

Reads demotion lists, finds members with a collected post on or after
--since, and keeps those the studio still shows as 비지터. The operator
restores them by hand.

  python3 scripts/member-demotion/restore_candidates.py \
      --targets ~/Documents/inactive_..._대상.csv --since 2026-09-24 \
      --out ~/Documents/강등_복구대상.csv
"""
import argparse
import collections
import os

import collection
import studio
import target_list as tl

RESTORE_LEVEL = "되돌릴 등급"
CURRENT_LEVEL = "현재 등급"
REASON = "사유"
COLUMNS = [tl.TAG, tl.NICKNAME, RESTORE_LEVEL, CURRENT_LEVEL, REASON]
LEVEL_ORDER = list(studio.LEVEL_IDS)


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--targets", action="append", required=True, help="demotion list CSV (repeatable)")
    parser.add_argument("--since", required=True, type=tl.kst_date, help="first KST day that counts as writing again")
    parser.add_argument("--out", required=True)
    parser.add_argument("--db", default=collection.DEFAULT_DB)
    return parser.parse_args()


def demoted_members(paths):
    """tag -> list row. Lists written before the key column existed get their
    keys from the studio, one tag search each."""
    members = {}
    for path in paths:
        for row in tl.read_rows(os.path.expanduser(path)):
            members[row[tl.TAG].strip()] = row
    keyless = [tag for tag, row in members.items() if not row.get(tl.KEY)]
    if keyless:
        print(f"looking up keys for {len(keyless)} tags in the studio...")
        for tag, found in studio.lookup_tags(keyless).items():
            if found:
                members[tag] = {**members[tag], tl.KEY: found["key"]}
    return members


def main():
    args = parse_args()
    members = demoted_members(args.targets)
    by_key = {row[tl.KEY]: tag for tag, row in members.items() if row.get(tl.KEY)}
    writers = collection.posts_since(args.db, list(by_key), args.since)
    print(f"demoted members: {len(members)}, wrote since {args.since}: {len(writers)}")

    writer_tags = [by_key[key] for key in writers]
    current = studio.lookup_tags(writer_tags)
    rows = []
    for key, (count, boards) in writers.items():
        tag = by_key[key]
        found = current.get(tag)
        level_now = found["level"] if found else "찾을 수 없음"
        if level_now != studio.VISITOR_LEVEL_NAME:
            continue
        rows.append({tl.TAG: tag, tl.NICKNAME: members[tag][tl.NICKNAME], RESTORE_LEVEL: members[tag][tl.LEVEL],
                     CURRENT_LEVEL: level_now, REASON: f"{args.since} 이후 글 {count}건 ({boards})"})

    rows.sort(key=lambda r: (LEVEL_ORDER.index(r[RESTORE_LEVEL]), r[tl.NICKNAME]))
    out = os.path.expanduser(args.out)
    tl.write_rows(out, COLUMNS, rows)
    print(f"restore: {len(rows)} {dict(collections.Counter(r[RESTORE_LEVEL] for r in rows))}")
    print(f"skipped (not 비지터 now): {len(writers) - len(rows)}")
    print(f"written: {out}")


if __name__ == "__main__":
    main()
