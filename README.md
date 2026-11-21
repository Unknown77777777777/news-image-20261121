# news-image-20261121

[![make.fun](https://make.fun/badge/news-image-20261121.svg)](https://make.fun/bounty/news-image-20261121)
[![rank](https://make.fun/badge/news-image-20261121/Unknown77777777777/news-image-20261121/rank.svg)](https://make.fun/bounty/news-image-20261121)
[![reward](https://make.fun/badge/news-image-20261121/Unknown77777777777/news-image-20261121/reward.svg)](https://make.fun/bounty/news-image-20261121)

A program that sums up the world's news of Saturday 21 November 2026 in one image.

`main.ts` (Node 22, standard library only, no network, no dependencies) draws a 1024×1024 PNG — masthead with the date, the lead story (Russia's overnight strikes on Ukraine), and the day's other major stories (ICJ Rohingya ruling follow-up, AI stock sell-off, Peru earthquake, COP31, UK–EU deal) — and writes it to `entry.png`. The program is deterministic: every run produces byte-identical output.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Entry for the [news-image-20261121 bounty](https://make.fun/bounty/news-image-20261121) on make.fun.
