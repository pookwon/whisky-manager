"""Post activity read from the collection DB (PostgreSQL, via psql).

Periods are KST calendar days, end inclusive. Only the collected boards count;
old and greeting-type boards are deliberately not collected.
"""
import datetime
import subprocess

DEFAULT_DB = "whisky_manager_collection"


def next_day(day):
    return (datetime.date.fromisoformat(day) + datetime.timedelta(days=1)).isoformat()


def query(db, sql):
    out = subprocess.run(
        ["psql", "-d", db, "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql],
        capture_output=True, text=True, check=True,
    ).stdout
    return [line.split("\t") for line in out.splitlines() if line]


def coverage(db, start, end):
    """Earliest and latest collected post inside the period (KST)."""
    rows = query(db, f"""
        select to_char(min(posted_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
               to_char(max(posted_at) at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI'),
               count(*)
        from posts
        where posted_at >= '{start}+09' and posted_at < '{next_day(end)}+09'""")
    first, last, count = rows[0]
    return first, last, int(count)


def activity_by_author(db, start, end):
    """author key -> (posts in period, last post before period, posts before period)."""
    rows = query(db, f"""
        select author_id,
               count(*) filter (where posted_at >= '{start}+09' and posted_at < '{next_day(end)}+09'),
               coalesce(to_char(max(posted_at) filter (where posted_at < '{start}+09')
                                at time zone 'Asia/Seoul', 'YYYY-MM-DD'), ''),
               count(*) filter (where posted_at < '{start}+09')
        from posts
        where author_id is not null
        group by author_id""")
    return {key: (int(n), last_before, int(n_before)) for key, n, last_before, n_before in rows}


def posts_since(db, author_keys, since):
    """author key -> (post count, board names) for posts on or after `since` (KST)."""
    if not author_keys:
        return {}
    keys = ",".join("'" + k.replace("'", "''") + "'" for k in author_keys)
    rows = query(db, f"""
        select p.author_id, count(*), string_agg(distinct b.name, ', ')
        from posts p join boards b using (board_id)
        where p.posted_at >= '{since}+09' and p.author_id in ({keys})
        group by p.author_id""")
    return {key: (int(n), boards) for key, n, boards in rows}
