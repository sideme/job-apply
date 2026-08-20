---
id: discovered-date-filter
title: Filter discovered jobs by date
description: View every job posted or first collected on a selected calendar date.
sidebar_position: 4
---

## What it is

The **Discovered** tab has a date picker that filters jobs by the source posting
date when it is available. It defaults to today's date in the
`America/Toronto` timezone.

The selected date includes two groups:

- Jobs whose displayed `Posted` date matches the selected date.
- Jobs with no source posting date that were first collected on the selected
  date. These are clearly labelled `post date unavailable`.

Jobs with a known posting date from another day are excluded. This prevents old
posts from mixing into today's results without dropping undated LinkedIn jobs.

## Why it exists

The Discovered queue contains historical jobs. Loading every historical match
makes it difficult to review the jobs found by the latest scheduled runs. The
date filter limits the server query, status counts, pagination, and automatic
refresh to one calendar day. All server pages for that date are loaded
automatically, so the list does not stop at the first 60 jobs.

## How to use it

1. Open **Jobs → Discovered**.
2. The date picker displays today automatically.
3. Choose an earlier date to review jobs posted on that day.
4. Use search, source, job-level, salary, and sorting filters normally; they are
   combined with the selected date.
5. Choose **Reset filters** to return the date to today.

When the date changes, an open detail pane is moved to the first job from the
selected date. If that date has no jobs, the detail pane is cleared.

The selected historical date is stored in the URL as `date=YYYY-MM-DD`, so the
view can be bookmarked. Today's default is omitted from the URL.

## Common problems

- **A job says `post date unavailable`:** The source did not return a reliable
  posting date. The job is grouped by the Toronto date when the app first
  collected it, so it is not silently omitted.
- **No jobs appear today:** The current scheduled run may not have completed,
  or all collected results may have been duplicates.
- **A future date cannot be selected:** The picker intentionally allows only
  today and earlier dates.
- **The filter disappears on another tab:** Date filtering applies only to
  **Discovered**. Other job and application tabs keep their existing behavior.

## Related pages

- [Agentic discovery](/docs/features/agentic-discovery)
- [Job level and screening](/docs/features/job-level-and-screening-roadmap)
