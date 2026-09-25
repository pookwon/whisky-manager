#!/usr/bin/env python3
"""Build the inactive-member demotion list.

A target is a member currently at 1GLASS..4GLASS (read live from the studio,
so members already demoted never reappear) who wrote no post on the collected
boards during the period and joined before the period started. Members on an
earlier list can be excluded with --exclude-csv.

  python3 scripts/member-demotion/build_targets.py \
      --start 2025-09-23 --end 2026-09-23 \
      --exclude-csv ~/Documents/previous_list.csv --out-dir ~/Documents
"""
import argparse
import collections
import os

import collection
import studio
import target_list as tl

LEVEL_ORDER = list(studio.LEVEL_IDS)
REASON_JOINED_IN_PERIOD = "가입 1년 미만 (기간 중 가입)"
REASON_ON_EARLIER_LIST = "기존 명단 중복"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--start", required=True, type=tl.kst_date, help="period start, KST day (inclusive)")
    parser.add_argument("--end", required=True, type=tl.kst_date, help="period end, KST day (inclusive)")
    parser.add_argument("--exclude-csv", action="append", default=[], help="earlier list whose members are skipped")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--db", default=collection.DEFAULT_DB)
    return parser.parse_args()


def member_row(member, activity):
    _, last_before, n_before = activity.get(member["key"], (0, "", 0))
    return {tl.TAG: member["tag"], tl.KEY: member["key"], tl.NICKNAME: member["nickname"],
            tl.LEVEL: member["level"], tl.JOIN_DATE: member["joinDate"],
            tl.LAST_POST_BEFORE: last_before, tl.POSTS_BEFORE: n_before}


def row_order(row):
    return LEVEL_ORDER.index(row[tl.LEVEL]), row[tl.JOIN_DATE]


def main():
    args = parse_args()
    first, last, count = collection.coverage(args.db, args.start, args.end)
    print(f"collected posts in period: {count} ({first} ~ {last} KST)")

    activity = collection.activity_by_author(args.db, args.start, args.end)
    earlier = set().union(*(tl.read_tags(p) for p in args.exclude_csv)) if args.exclude_csv else set()

    targets, excluded = [], []
    for level in LEVEL_ORDER:
        members = studio.fetch_level_members(level)
        print(f"{level}: {len(members)} members")
        for member in members:
            if activity.get(member["key"], (0,))[0] > 0:
                continue
            row = member_row(member, activity)
            if member["joinDate"] >= args.start:
                excluded.append({**row, tl.EXCLUDED_REASON: REASON_JOINED_IN_PERIOD})
            elif member["tag"] in earlier:
                excluded.append({**row, tl.EXCLUDED_REASON: REASON_ON_EARLIER_LIST})
            else:
                targets.append(row)

    targets.sort(key=row_order)
    excluded.sort(key=row_order)
    base = os.path.join(os.path.expanduser(args.out_dir), f"inactive_{args.start}_{args.end}")
    tl.write_rows(base + "_대상.csv", tl.TARGET_COLUMNS, targets)
    tl.write_rows(base + "_제외.csv", tl.EXCLUDED_COLUMNS, excluded)

    print(f"targets: {len(targets)} {dict(collections.Counter(r[tl.LEVEL] for r in targets))}")
    print(f"excluded: {len(excluded)} {dict(collections.Counter(r[tl.EXCLUDED_REASON] for r in excluded))}")
    print(f"written: {base}_대상.csv, {base}_제외.csv")


if __name__ == "__main__":
    main()
