# Lookup Performance Baseline

This document records the lookup timing boundary used for the first low-risk performance slice. It is not a permanent benchmark contract; compare runs only on the same machine and dictionary set.

## Environment

- Date: 2026-06-20
- Platform: Windows / Tauri debug build / WebView2
- Dictionary configuration: 4 enabled term dictionaries (650,853 term records), 1 frequency dictionary (99,999 records), and 1 pitch dictionary (327,037 records)
- Lookup behavior: `maxResults = 16`, `scanLength = 16`

Debug builds retain the latest frontend records in `window.__HSW_LOOKUP_PERFORMANCE__`. Frontend console records use `[lookup-perf]`; Rust records use `lookup_perf`. Release builds do not emit these records.

## Baseline

Representative reader clicks were collected after runtime initialization. Values are milliseconds from selection receipt unless noted otherwise.

| Sample | Results | Rust native lookup | IPC result ready | State committed | First frame ready | Styles ready |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Common term, first sample | 7 | 24.8 | 21.1 | 21.7 | 54.0 | 73.2 |
| Common term, second surface | 4 | 18.1 | 15.5 | 15.9 | 49.1 | 36.9 |
| Repeated common term | 7 | 5.9 | 20.5 | 20.8 | 60.8 | 48.8 |
| Inflected surface | 2 | 23.7 | not captured | not captured | not captured | not captured |
| No result | 0 | 1.8 | not captured | not captured | not applicable | not applicable |

Rust lock wait was at or below 0.001ms for these non-overlapping samples. Title override processing remained below 0.05ms. The repeated native lookup benefited from warm memory-mapped pages, but still crossed IPC and rebuilt the complete popup.

## Interpretation

- Dictionary lookup itself is tens of milliseconds cold and about 6ms warm for the sampled common term.
- Repeating a term currently repeats native lookup, IPC serialization, glossary grouping, structured-content rendering, and popup style resolution.
- First popup frame trails state commit by roughly 30–40ms in the sampled result sets.
- Dictionary styles can finish after the result state is committed, creating a second visible layout/style update.
- Media remains intentionally lazy and was not present in the representative timing samples.

The first optimization slice therefore targets repeated-query caching, style prewarming, parallel style resolution, and one-pass popup view-model construction. Native result limits, hoshidicts, FFI JSON conversion, media transport, and mutex behavior remain unchanged.
