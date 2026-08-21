#!/usr/bin/env python3
"""Run all_stats_db with resilient, smaller Supabase upsert batches.

The stats aggregation can produce thousands of wide player rows.  A single
500-row HTTP POST can spend long enough writing the request body that the
GitHub Actions runner times out before Supabase receives it.  This wrapper
keeps the existing stats logic untouched and replaces only sb_upsert at
runtime with bounded batches plus retry/backoff.
"""

import sys
import time

import requests

import all_stats_db as stats


SUCCESS = {200, 201, 204}
RETRYABLE_STATUS = {408, 425, 429, 500, 502, 503, 504}
BATCH_SIZE = 100
MAX_RETRIES = 5


def resilient_sb_upsert(table, rows, conflict):
    if not rows:
        return

    cols = stats.get_table_cols(table)
    if cols:
        rows = [{k: v for k, v in row.items() if k in cols} for row in rows]

    url = f"{stats.SB_REST}/{table}?on_conflict={conflict}"
    total = len(rows)

    for start in range(0, total, BATCH_SIZE):
        batch = rows[start:start + BATCH_SIZE]
        batch_no = start // BATCH_SIZE + 1
        batch_total = (total + BATCH_SIZE - 1) // BATCH_SIZE

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = requests.post(
                    url,
                    headers=stats.SB_HDR,
                    json=batch,
                    timeout=(15, 180),
                )

                if response.status_code in SUCCESS:
                    if batch_total > 1:
                        print(
                            f"  [SB] UPSERT {table} batch {batch_no}/{batch_total} ok "
                            f"({len(batch)} rows)",
                            file=sys.stderr,
                        )
                    break

                message = response.text[:300]
                if response.status_code not in RETRYABLE_STATUS:
                    raise RuntimeError(
                        f"Supabase UPSERT {table} failed with HTTP "
                        f"{response.status_code}: {message}"
                    )

                raise requests.HTTPError(
                    f"retryable HTTP {response.status_code}: {message}",
                    response=response,
                )

            except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as exc:
                if attempt >= MAX_RETRIES:
                    raise RuntimeError(
                        f"Supabase UPSERT {table} batch {batch_no}/{batch_total} "
                        f"failed after {MAX_RETRIES} attempts: {exc}"
                    ) from exc

                delay = min(30, 2 ** (attempt - 1) * 2)
                print(
                    f"  [SB] UPSERT {table} batch {batch_no}/{batch_total} "
                    f"attempt {attempt}/{MAX_RETRIES} failed: {exc}; retry in {delay}s",
                    file=sys.stderr,
                )
                time.sleep(delay)
        else:
            raise RuntimeError(f"Supabase UPSERT {table} batch loop ended unexpectedly")

        # Avoid turning a successful aggregate into a burst of large REST writes.
        time.sleep(0.10)


# Patch only the transport used by the existing aggregation code.
stats.sb_upsert = resilient_sb_upsert


if __name__ == "__main__":
    stats.main()
