"""The demotion list CSV: one member per row, read back by header name.

Written with a UTF-8 BOM so Excel opens the Korean text correctly.
"""
import csv
import datetime

TAG = "멤버 태그"
KEY = "멤버 키"
NICKNAME = "닉네임"
LEVEL = "등급"
JOIN_DATE = "가입일"
LAST_POST_BEFORE = "기간 이전 마지막 글"
POSTS_BEFORE = "기간 이전 글 수"
EXCLUDED_REASON = "제외 사유"

TARGET_COLUMNS = [TAG, KEY, NICKNAME, LEVEL, JOIN_DATE, LAST_POST_BEFORE, POSTS_BEFORE]
EXCLUDED_COLUMNS = TARGET_COLUMNS + [EXCLUDED_REASON]


def kst_date(value):
    """argparse type: a YYYY-MM-DD calendar day."""
    return datetime.date.fromisoformat(value).isoformat()


def read_rows(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    if rows and TAG not in rows[0]:
        raise SystemExit(f"{path}: no '{TAG}' column")
    return rows


def read_tags(path):
    return {row[TAG].strip() for row in read_rows(path) if row[TAG].strip()}


def write_rows(path, columns, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
