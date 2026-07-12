---
name: infographic-design
description: Brand design system for generating infographics, social graphics, posters, carousels, slides, and other standalone visual content. Use whenever the user asks for an infographic, social media graphic, poster, visual explainer, stat card, carousel, thumbnail, or any designed visual asset (not app UI). Supplies canvas presets, color tokens, typography scale, component specs, and chart rules.
---

# Infographic & Visual Content Design System

Single source of truth for generating standalone visual content (infographics,
social graphics, posters, slides, thumbnails). This is NOT for app UI - the app
uses `lib/theme.ts`. Tokens below are derived from the platform brand
(AI Skills Africa defaults); when generating for another tenant, swap the
accent for that tenant's primary color and keep everything else.

Default output: a self-contained HTML file sized to the exact canvas preset
(no external requests), suitable for screenshot/PNG export or artifact preview.
Render and visually inspect the result before delivering.

## 1. Color tokens

Light ground (default):

| Role | Hex | Use |
|---|---|---|
| page | #F2F5FA | canvas background |
| card | #FFFFFF | panels, tiles (borderless, flat, no shadow) |
| ink | #111111 | headlines, values |
| muted | #555555 | body, decks |
| faint | #888888 | captions, sources |
| accent | #00bf63 | brand green: fills, markers, badges, highlights |
| accent-ink | #15803d | green when used as TEXT on light (4.5:1) |
| warn | #eda100 | warning status only |
| danger | #d03b3b | negative/critical status only |

Dark ground (optional variant - commit to one ground per graphic):

| Role | Hex |
|---|---|
| page | #17181E |
| card | #1E1F26 |
| ink | #F8FAFC |
| muted | #ACB8C5 |
| faint | #6b7a89 |
| accent | #3E93FF (ocean - dark ground never uses the light green as accent) |
| accent-ink | #7db8ff |

Hard rules:
- NEVER purple or indigo, anywhere, in any role.
- Badges / status chips: green background, white bold text. Never blue or black badges.
- White text on accent green only at large/bold sizes (>= 24px bold at 1080 scale).
- Cards are borderless and flat: separation comes from card-vs-page contrast,
  not borders or drop shadows.
- One bold moment per graphic (the hero stat, the headline, the chart).
  Everything around it stays neutral.

## 2. Typography

- Display (headlines, stat values): "Archivo Black", "Arial Black", system-ui;
  weight 900, letter-spacing -0.02em, line-height 1.02. Headlines get
  `text-wrap: balance`.
- Body: "Segoe UI", system-ui, sans-serif; 400/600, line-height 1.4, max 65ch.
- Labels/eyebrows: uppercase, 700, letter-spacing 0.1em, muted or accent-ink.
- Aligned number columns get `font-variant-numeric: tabular-nums`.

Type scale for a 1080px-wide canvas (scale linearly: size x canvasWidth/1080):

| Role | Size | Weight |
|---|---|---|
| Eyebrow | 26px | 700 uppercase |
| Headline | 72-96px | 900 |
| Deck | 34px | 400 muted, max 2 lines |
| Section head | 44px | 800 |
| Body | 30px | 400 |
| Label | 24px | 700 uppercase |
| Stat value | 120-180px | 900 |
| Hero number | 200-300px | 900, accent |
| Caption / source | 22px | 400 faint |

Copy rules:
- Plain ASCII only: no em dashes, curly quotes, or ellipsis characters.
  Use hyphens, straight quotes, commas.
- The headline states the FINDING, not the topic ("3 in 5 African firms now
  use AI", not "AI adoption survey results").
- Sentence case headlines; uppercase is reserved for eyebrows and labels.
- Display numbers rounded to 2 significant figures; exact values in captions.
- Every data graphic carries a source + date line in the footer.

## 3. Canvas presets

| Preset | Size | Use |
|---|---|---|
| Square | 1080 x 1080 | Instagram, WhatsApp |
| Portrait | 1080 x 1350 | IG feed / carousel pages |
| Story | 1080 x 1920 | Stories, reels, status |
| Landscape | 1200 x 675 | X, LinkedIn posts |
| Link preview | 1200 x 630 | OG images |
| Thumbnail | 1280 x 720 | YouTube |
| Slide | 1920 x 1080 | decks, webinars |
| A4 poster | 2480 x 3508 | print at 300dpi |

Geometry (at 1080 scale, scale with canvas):
- Safe margin: 6% of the shortest side on all edges.
- Spacing unit: 12px; gaps between siblings via flex/grid `gap`, multiples of 12.
- Radius: 20px cards, 999px pills. Icon size 48-64px.
- Footer band reserved: wordmark left, "Source: ... | date" right, caption size.

## 4. Layout anatomy

Every graphic = header + ONE dominant body pattern + footer.

- Header: eyebrow, headline, optional deck.
- Body: pick exactly one pattern - hero stat, stat-tile grid, process steps,
  timeline, comparison split, ranked bar list, chart story, do/don't, quote.
  Do not stack multiple patterns on one canvas; make a carousel instead
  (one pattern per page, shared header style, page dots).
- Footer: wordmark + source line.
- Numbered markers (1/2/3) only when order truly matters (a process, a
  timeline). Never as decoration on unordered lists.
- No emoji as icons or section markers. Icons are 2px-stroke outlines, round
  caps, single color (ink or accent), drawn as inline SVG.

## 5. Component specs (at 1080 scale)

- Stat tile: white card, 24px padding-top label (uppercase muted), value
  120px/900 ink, optional one-line context in caption. 2-4 tiles per row max.
- Delta chip: pill, green bg + white bold text for positive ("+18%"), the
  danger red bg for negative. Always paired with an arrow glyph, never color alone.
- Hero number: one giant accent-colored value (200-300px) + a plain-ink
  support line. Use when a single stat IS the story - not a chart.
- Process steps: accent-filled circles (white number, 900), 4px connector line
  in divider gray, step title 800, one-line description muted. Max 5 steps.
- Timeline: 4px vertical spine in divider gray, accent dot markers, year/date
  as label, event title 800.
- Comparison split: two equal columns, each headed by a pill (accent pill for
  the favored side, gray pill for the other), rows aligned across columns.
- Ranked bar list: horizontal bars, label + value direct-labeled in ink,
  bars in accent (leader) and gray-300 (#d4d9e0) for the rest, or the
  categorical palette when identity matters. Bar height 40px, 12px gaps,
  4px radius on the data end only.
- Do / Don't: two cards; green check circle vs red x circle (icon + word,
  never color alone). No purple, no blue.
- Quote card: oversized quote mark in accent at 15% opacity behind, quote
  36px/600 ink, attribution as label.
- Progress ring / donut: only for a single part-of-whole share; 24px stroke,
  accent on divider-gray track, value in the center at stat size. Never a
  multi-slice pie with more than 4 slices.

## 6. Charts inside infographics

Categorical palette - fixed order, never cycled, never purple (validated for
CVD safety; light set requires direct labels, which are mandatory anyway):

| Slot | Light (#fff card) | Dark (#1E1F26 card) |
|---|---|---|
| 1 blue | #2a78d6 | #3987e5 |
| 2 teal | #1baf7a | #199e70 |
| 3 amber | #eda100 | #c98500 |
| 4 green | #008300 | #008300 |
| 5 red | #e34948 | #e66767 |
| 6 orange | #eb6834 | #d95926 |

More than 6 categories: fold the tail into "Other" in gray.

- Sequential (magnitude): one green ramp light-to-dark:
  #d9f7e8, #a4ecc9, #6fdda6, #35c37f, #00a857, #007a3f, #00532a.
- Diverging (polarity): blue #2a78d6 <-> red #d03b3b with neutral gray
  midpoint #eceff3. Never green-vs-red for diverging scales.
- One y-axis, always. Two measures = two charts, never dual-axis.
- Direct-label every series and key data point in ink (values never wear the
  series color); legends only when direct labels cannot fit.
- Marks: bars thin with 2px gaps between adjacent fills, 4px radius at the
  data end only; lines 2px with emphasized endpoint; grid hairlines faint
  and recessive; baseline slightly stronger than grid.
- Status colors (green good / amber warning / red critical) are reserved for
  state and never used as series colors; always paired with icon or label.

## 7. QA checklist (run before delivering)

1. Exactly one dominant pattern; one bold moment.
2. Ink contrast: body 4.5:1, large display 3:1 against its ground.
3. No purple/indigo; badges green/white; no emoji markers; ASCII only.
4. Cards borderless and flat; spacing on the 12px grid; nothing touches the
   6% safe margin.
5. Charts: single axis, direct labels, fixed palette order, source line present.
6. Meaning never carried by color alone (icons, labels, or position back it up).
7. Screenshot or render the output and LOOK at it - check overflow, label
   collisions, and balance before handing it over.
