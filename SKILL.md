## Overview

This is the design system for the Rancho MATHCOUNTS website (`mc.uhsmathclub.org`). It is the visual and editorial contract for four pages — home, tryouts, resources, and the student check-in at `/hello` — plus a 404 page and the Google Apps Script fallback app.

The system is built from one idea: **navy ink on warm paper, with a single gold line running through it.** That line is already in the club logo — one continuous gold stroke sweeping across a navy circle — and it is the only ornament the system needs.

The system is deliberately small. There are no cards, no drop shadows, no gradients, no glass, no icon set, no component library, and no framework. Structure comes from hairline rules, real whitespace, and a hard left edge. Personality comes from an editorial serif, generous measure, full-bleed photographs, and the gold line. The result should read like a well-set printed program rather than a product landing page.

This is a school club site maintained by students and one teacher. Every decision here favors **legibility, longevity, and being easy to edit in two years by someone who has never seen the code.** A page that loads in one request with no build-time magic is worth more than a page that is clever.

**Non-negotiable:** the site serves English, Chinese, and Korean readers. Internationalization is not a feature bolted on at the end — it is a structural rule that every component must satisfy. See **Internationalization**, which is the most important section in this file.

* * *

## Design Tokens

### Color Palette

Two brand colors, one paper, one ink. Everything else is a tint of those.

| Token        | Value     | Purpose                                                                  |
|--------------|----------:|---------------------------------------------------------------------------|
| `navy`       | `#132749` | Brand primary. Body text, headings, rules, logo field, dark-mode canvas   |
| `gold`       | `#fdb717` | Brand accent. Fills, underlines, the line motif, focus ring, active state |
| `paper`      | `#fbf7ef` | Page canvas in light mode. Warm off-white, never pure white               |
| `paper-deep` | `#f2ece0` | Second surface: the home page announcement block, quotes, inline code     |
| `ink`        | `#132749` | Alias of `navy` for text roles                                           |
| `ink-muted`  | `#5a6580` | Captions, dates, metadata, helper text, placeholder                      |
| `rule`       | `#d9d2c4` | Hairline dividers and input borders at rest                              |
| `danger`     | `#a3281e` | Form errors only. Deep brick red, reads as ink, not as alarm             |
| `success`    | `#1f6b4a` | Successful check-in only                                                 |

There is no separate "warning" color. If something needs caution, write a clearer sentence.

### Semantic Tokens

Define these on `:root` and redefine them under a dark-mode block. Never write a raw hex value anywhere else in the codebase.

```css
:root {
  --paper:        #fbf7ef;
  --paper-deep:   #f2ece0;
  --ink:          #132749;
  --ink-muted:    #5a6580;
  --rule:         #d9d2c4;
  --rule-strong:  #132749;
  --gold:         #fdb717;
  --brand-navy:   #132749;  /* fixed: never flips with the theme */
  --brand-gold:   #fdb717;  /* fixed: never flips with the theme */
  --focus:        #132749;
  --danger:       #a3281e;
  --success:      #1f6b4a;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:       #132749;
    --paper-deep:  #1b3159;
    --ink:         #fbf7ef;
    --ink-muted:   #a8b2c6;
    --rule:        #2d4270;
    --rule-strong: #fbf7ef;
    --focus:       #fdb717;
    --danger:      #ff9d92;
    --success:     #7fd3a8;
  }
}

:root[data-theme="dark"] { /* the same overrides, repeated */ }
```

`body` always sets `background: var(--paper)` explicitly.

### The Contrast Rule

This is the single most violated rule in any navy-and-gold palette, so it is stated numerically.

| Combination          | Ratio    | Verdict                                       |
|----------------------|---------:|-----------------------------------------------|
| Navy on paper        | `13.9:1` | Use freely for all text                       |
| Navy on gold         | `8.5:1`  | Use freely — gold fills always take navy text |
| Paper on navy        | `13.9:1` | Dark mode body text                           |
| **Gold on paper**    | `1.6:1`  | **Never use for text, icons, or thin marks**  |
| **Gold on white**    | `1.8:1`  | **Never use for text**                        |
| Gold on navy         | `8.5:1`  | Allowed for text in dark mode only            |
| `ink-muted` on paper | `6.1:1`  | Captions and metadata only, 15px and up       |

The operative asymmetry: **in light mode gold is a shape, never a letterform; in dark mode gold may also be a letterform.** Gold at 3px or thicker as a rule, underline, or fill is fine in both modes because it is a graphic, not text. Gold text on paper is the fastest way to make this site look cheap and fail an audit at the same time.

### Color Usage Principles

1. **Paper is the canvas.** Every page, every section, light mode. Pure `#ffffff` appears nowhere.
2. **Navy carries all meaning.** Text, headings, rules, borders, the logo field.
3. **Gold marks exactly one thing per view.** The active nav item, the current language, the focused input, the hero line. If three unrelated gold things are visible at once, delete two.
4. **No color-only states.** Every error, success, and selected state pairs color with text, an underline weight change, or a position change.
5. **Photographs are the only other color on the site.** Let them be.

* * *

## Typography

### Font Families

**No webfonts.** Every face on this site is already on the reader's machine. School Chromebooks are slow and the network at 3pm is congested; a page that renders instantly in a system serif beats a page that renders 400ms later in something prettier. It also means Chinese and Korean render in the reader's own system face instead of a multi-megabyte download.

| Role    | Stack                                                                | Usage                                              |
|---------|----------------------------------------------------------------------|----------------------------------------------------|
| Display | `Georgia, "Noto Serif", "Liberation Serif", "Times New Roman", serif` | Hero, section headings, pull quotes, stat numerals |
| Body    | system UI sans stack                                                 | Body copy, nav, labels, buttons, captions          |
| Mono    | `ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace`       | Student ID boxes, code boxes, any digit grid       |

```css
:root {
  --font-display: Georgia, "Noto Serif", "Liberation Serif",
                  "Times New Roman", serif;
  --font-body: system-ui, -apple-system, "Segoe UI", Roboto,
               "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
}
```

Georgia is the reason this system can look editorial without a font request: large x-height, sturdy at small sizes, and **old-style numerals by default**, which give the statistics row real character for free.

**Georgia is not installed on ChromeOS or Android.** Those platforms fall through to Noto Serif or Tinos — both sound text serifs, both metrically different. The design must therefore never depend on Georgia's specific metrics: no optical alignment tuned to its sidebearings, no `ch`-based widths on display text, and no layout that breaks if the display face is 4% wider. Check headings on a Chromebook before shipping.

One consequence of old-style figures: in Georgia the digits `3 4 5 7 9` have descenders, so a row of statistics will not sit on a flat baseline. That is correct and attractive at display size. If a number must align inside a grid, use `--font-mono` with `tabular-nums` instead.

### CJK Font Stacks

Georgia has no CJK coverage. Chinese and Korean text must be given explicit stacks scoped by `:lang()`, and the display face must be **excluded** from CJK headings rather than left to an ugly synthetic fallback.

```css
:lang(zh) {
  --font-display: "Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", serif;
  --font-body: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
               "Noto Sans CJK SC", sans-serif;
}

:lang(ko) {
  --font-display: "Apple SD Gothic Neo", Pretendard, "Malgun Gothic",
                  "Noto Sans CJK KR", sans-serif;
  --font-body: "Apple SD Gothic Neo", Pretendard, "Malgun Gothic",
               "Noto Sans CJK KR", sans-serif;
}
```

Korean has no comfortable system serif, so Korean display type uses a heavier weight of the sans instead. That is correct, not a compromise.

### Type Scale

```css
:root {
  --text-xs:   0.8125rem;                   /* 13px — metadata, footnotes  */
  --text-sm:   0.9375rem;                   /* 15px — captions, labels, nav */
  --text-base: 1.0625rem;                   /* 17px — body copy            */
  --text-lg:   1.3125rem;                   /* 21px — lede, intros         */
  --text-xl:   1.6875rem;                   /* 27px — section headings     */
  --text-2xl:  clamp(2rem, 4vw, 2.625rem);  /* 32–42px — page titles       */
  --text-3xl:  clamp(2.75rem, 8vw, 4.5rem); /* 44–72px — hero, stat digits */
}
```

Body copy is 17px, not 16px. This site is read by twelve-year-olds and by parents on phones, and the extra pixel costs nothing.

### Typographic Rules

- **Measure is capped at 66 characters** (`max-width: 34rem`) for body copy. Never let a paragraph span a wide viewport.
- **Line height:** `1.65` for Latin body, `1.15` for display, `1.85` for CJK body. CJK needs the extra leading — the glyphs are dense and square.
- **Letter-spacing:** `-0.02em` on display sizes, `0` on body, and **never** on CJK text at any size. Letter-spaced CJK looks broken.
- **No italics on CJK.** Browsers synthesize an oblique that is genuinely wrong. Force `font-style: normal` under `:lang(zh)` and `:lang(ko)` for `em`, `i`, and `cite`, and substitute weight or a gold underline for emphasis.
- **No justification.** Ragged right everywhere. Use `text-wrap: pretty` on paragraphs and `text-wrap: balance` on headings.
- **Numerals** use the display serif at `--text-3xl` for statistics, and mono with `font-variant-numeric: tabular-nums` for IDs and codes.
- **Use real typography:** en dashes in ranges (`2026–27`), curly quotes, `π` not `pi`, and a non-breaking space before room numbers.
- **Georgia has a true bold and a true italic — use them.** What it does not have is a light or a black weight, and neither does any CJK system face at a guaranteed weight. Never let the browser synthesize one. If a heading needs more presence, make it bigger or give it the gold line.

* * *

## Spacing and Layout

A 4px scale, used without exception.

| Token      | Value  | Usage                                           |
|------------|-------:|-------------------------------------------------|
| `space-1`  | `4px`  | Icon-to-label, inline nudges                    |
| `space-2`  | `8px`  | Label-to-input, tight stacks                    |
| `space-3`  | `12px` | Input padding, gaps between digit boxes         |
| `space-4`  | `16px` | Default internal padding, **the page gutter**   |
| `space-6`  | `24px` | Paragraph rhythm, nav item spacing              |
| `space-8`  | `32px` | Sub-section separation                          |
| `space-12` | `48px` | Between content blocks                          |
| `space-16` | `64px` | Between major page sections                     |
| `space-24` | `96px` | Above and below the hero, around full-bleed art |

### Layout

- **One column.** The site is a single centered column at `max-width: 46rem` with a hard left alignment inside it. There is no grid system, no sidebar, and no multi-column text.
- **Page gutter is 16px minimum** at all viewport widths. No horizontal page scroll, ever.
- **Full-bleed exception:** photographs and the hero gold line may break out to the full viewport width. Nothing else may.
- **The stats row** is the one place a horizontal arrangement is allowed: three items, flex, wrapping to a vertical stack under 40rem.
- **Vertical rhythm carries the design.** When a section feels wrong, the answer is almost always more space, not a border.

* * *

## The Look

### Rules, Not Boxes

Structure is drawn with hairlines, not containers.

```css
:root {
  --line-hair: 1px solid var(--rule);
  --line-ink:  1px solid var(--rule-strong);
  --line-gold: 3px solid var(--gold);
}
```

- Section boundaries: a single `--line-hair` full-width rule, with `space-16` above and below.
- Emphasis boundaries: `--line-ink`.
- The gold line: `--line-gold`, used at most twice per page.

**Do not** put content inside a bordered, rounded, shadowed rectangle. There are no cards on this site. If content needs to feel grouped, give it a heading and space above it.

### The Gold Line Motif

The logo is one continuous gold stroke. The site repeats that gesture in four sanctioned forms:

1. **The hero line** — a 3px gold rule directly under the page title, inset to the width of the title text.
2. **The active marker** — a 3px gold underline under the current nav item and the current language.
3. **The inverted block** — a solid navy field with gold text, for section headings on the resources page. Gold on navy is 8.5:1, so gold may be a letterform inside it. Both colours are fixed (`--brand-navy`, `--brand-gold`) so the block reads identically in dark mode.
4. **The focus ring** — see **Accessibility**.

Anything beyond these four is decoration this site does not need.

### Photographs

Photos are the emotional content of the home page and must be treated as the artwork they are, not as stock filler.

- Full-bleed or full-column width. Never in a rounded card, never with a shadow.
- A `1px` navy hairline on all four sides in light mode; none in dark mode.
- The caption sits **inside** the photograph, along the bottom edge, on a half-opaque navy plate with paper-coloured text. Both colours are fixed rather than themed: the plate has to stay readable over an unknown image in either mode. It is still a real `<figcaption>`, translated with the rest of the page.
- Always `loading="lazy"` except the hero image, and always explicit `width`/`height` to reserve space.
- Serve modern formats with fallbacks and real `srcset` widths. Never ship HEIC to a browser.
- `alt` describes the photograph for someone who cannot see it. The caption is not the alt text.

### No Shadows, No Motion Theater

- `box-shadow` is not used anywhere on this site.
- `border-radius` is `0` everywhere except the check-in digit boxes (`4px`). Nothing on this site is a pill. A rounded control bends the gold marker under it into a curve, and it stops matching the straight rules everywhere else.
- Transitions are limited to `120ms` on `color`, `background-color`, `border-color`, and `opacity`. No transforms, no entrance animations, no scroll-triggered reveals.
- The only animated element on the site is the check-in loading state, and it must respect `prefers-reduced-motion`.

* * *

## Internationalization

**Every user-facing string on this site exists in English, Chinese (Simplified), and Korean.** The single exception is the body of the resources page, which stays English because it links to English materials. Chrome — nav, footer, buttons, errors — translates on every page including that one.

The system may grow to more languages. Nothing may assume there are exactly three.

### Two Mechanisms

**Mechanism A — attribute swap.** For short plain-text chrome: nav links, buttons, labels, error messages, section headings, `placeholder`, `aria-label`, `alt`, and `title`.

```html
<a href="/resources/" data-zh="资源" data-ko="자료">Resources</a>

<input id="code"
       aria-label="Today's code"
       data-zh-aria-label="今日代码"
       data-ko-aria-label="오늘의 코드">
```

Rules:

- English is the element's own content. It is never duplicated into a `data-en` attribute by hand.
- On first switch, the script caches the original English into `el.dataset.english` so switching back is lossless.
- Attribute targets use the suffix form `data-{lang}-{attribute}`, kebab-cased.
- Mechanism A handles **plain text only.** An element containing markup must use Mechanism B.

**Mechanism B — sibling blocks.** For prose from `home.yml` and `tryouts.md`, anything with a link inside it, and anything longer than a sentence.

```html
<div class="i18n">
  <p lang="en">MATHCOUNTS is a weekly after-school…</p>
  <p lang="zh-Hans" hidden>MATHCOUNTS 是一项每周课后…</p>
  <p lang="ko" hidden>MATHCOUNTS는 주 1회 방과 후…</p>
</div>
```

Visibility is handled **in CSS, not JavaScript**, so there is no flash of the wrong language:

```css
[data-lang="zh"] .i18n > :not([lang|="zh"]) { display: none; }
[data-lang="zh"] .i18n > [lang|="zh"]       { display: revert; }
```

### The Language Switch

- State lives in `document.documentElement.dataset.lang` (`en` | `zh` | `ko`) and in `localStorage["mc-lang"]`.
- A tiny **blocking inline script in `<head>`** reads `localStorage` and sets the attribute before first paint. It must be under 300 bytes and must not throw when storage is blocked or unavailable.
- `document.documentElement.lang` is set in parallel to `en` / `zh-Hans` / `ko`, so `:lang()` selectors, screen readers, and the browser's own translation prompt all behave.
- The switcher is three always-visible controls — never a `<select>`, never a dropdown: `English` · `中文` · `한국어`, each labelled in its own language.
- Implement as `<button>` elements inside a `<nav aria-label>` with `aria-pressed` reflecting the current choice. The active one carries the 3px gold underline.
- Switching never reloads the page, never changes the URL path, and never loses form state on `/hello`.

### Writing for Three Languages

- **Layout must survive a ±60% length change.** Korean and Chinese usually run shorter than English; a long English heading must not be what the hero is tuned to. Check every component in all three before calling it done.
- Never build a sentence out of concatenated fragments. `"Welcome, " + name + "!"` is broken in Korean word order. Use a whole-string template per language with a `{name}` placeholder.
- Numbers, dates, and names keep their own formats: `March 12, 2026` / `2026年3月12日` / `2026년 3월 12일`.
- Product and institution names stay Latin: `MATHCOUNTS`, `Rancho MATHCOUNTS`, `University High School`, `AoPS`. Do not transliterate them.
- Teacher names take the local honorific: `Mrs. Gastelum` / `Gastelum 老师` / `Gastelum 선생님`.
- CJK punctuation is full-width: `，。！？（）「」` — never Latin punctuation inside a CJK sentence.
- No hard-coded pixel widths on any text container.

### Content Source of Truth

`home.yml`, `tryouts.md`, and `resources.md` are the editable content. A non-programmer must be able to change a sentence and see it live. That means:

- No prose is hard-coded into a page template. Chrome strings live in one place and carry their translations as attributes.
- Every translatable string in `home.yml` is keyed **explicitly by language**, never split out of one blob on a newline.
- Adding a fourth language must mean adding a key, not editing a parser.

* * *

## Components

### Navigation

A single row, present on all four pages, and nothing else in it.

| Slot        | Content                                                            |
|-------------|--------------------------------------------------------------------|
| Left        | Logo mark (SVG, ~28px) + `Rancho MATHCOUNTS` wordmark, linked home |
| After it    | Page link(s) — Tryouts, Resources                                  |
| Far right   | Language switcher — `English` `中文` `한국어`                        |

- The wordmark is display serif at `--text-lg`, bold, and never translated. The rest of the bar is the body sans at 600.
- **Every item in the bar is the same height** (44px) with the same 3px transparent bottom border, so the gold markers under the current page and the current language sit on one line. Align the row on `center`, never on `baseline` — the wordmark is a different size and a different family, and baseline alignment visibly lifts it above the links.
- The logo and wordmark are one link with one accessible name; the SVG is `aria-hidden`.
- The current page's link carries the gold underline and `aria-current="page"`.
- There is no hamburger menu. At narrow widths the row wraps to two lines: identity on top, links and languages beneath.
- The nav does not stick to the top. The pages are short.
- `/hello` is **not** linked in the nav.

### Hero

Page title in display serif at `--text-3xl`, the gold line beneath it, an optional subtext line above in `--text-sm` `--ink-muted`, and a lede paragraph at `--text-lg`. Left-aligned. `space-24` below.

### Announcements

Two different things share one visual treatment. They never appear on the same page.

**Home page announcement** — from `home.yml`, translated, at the top of the home page. A single paragraph at `--text-lg` on `--paper-deep` with `space-8` padding and a `--line-gold` on its left edge. No icon, no dismiss button, no border box. If `home.yml` has no announcement, the block does not render.

**Day announcement** — from `Dashboard!C1`, English only, rendered **only behind the code gate** on `/hello` and in the Apps Script fallback. Same visual treatment. It is written by coaches directly into a spreadsheet cell, so it may carry bold, italics, and links, and it must be escaped before interpolation. If the cell is empty, the block does not render.

### Statistics

Three figures. Numeral in display serif at `--text-3xl`, label beneath in `--text-sm` `--ink-muted`. Separated by whitespace, not by vertical rules. The numeral is navy, not gold.

### FAQ

Native `<details>` / `<summary>`. No JavaScript.

- `<summary>` is the question at `--text-base`, with a gold marker built from a CSS pseudo-element that rotates on open.
- The answer is indented to the question text, `--ink`, capped at measure.
- Items are separated by `--line-hair`.
- The section heading is `Frequently Asked Questions`, translated via Mechanism A.

### Prose and the Resources Page

The resources page is compiled markdown. Style the raw elements; do not wrap them in components.

- `h1` → `--text-2xl` display, gold line beneath.
- `h2` → `--text-xl` display, `space-12` above. The resource-list `h2`s are set in gold on a navy block. The markdown writes them in backticks, but they must not look like code: the inverted block replaces the monospace chip entirely.
- `p`, `li` → `--text-base`, capped at measure, `space-6` rhythm.
- Links: navy text with a `1px` `--rule-strong` underline at `0.12em` offset, becoming a 2px gold underline on hover and focus. Never blue, never `text-decoration: none`.
- External links open in the same tab. Do not hijack the reader's back button.
- `ul` uses a gold en-dash marker rather than a bullet disc.
- Inline `code` → `--font-mono` on `--paper-deep`, no border.

### Check-In Form (`/hello`)

The most interaction-heavy surface on the site, and the one most likely to be used by a tired student on a cracked phone at 3:05pm. It must be fast, forgiving, and unambiguous.

The page is a **gate, then a form.** Nothing behind the gate — including the day's announcement — is visible to someone who does not have today's code.

**Step 1 — the gate.** Today's code, and nothing else on the page.

- Four boxes. `--font-mono`, uppercased on input, `inputmode="text"`, `autocapitalize="characters"`, `autocomplete="off"`, `maxlength="1"` each.
- The alphabet is Crockford base-32, so input normalizes as the reader types: `I`, `i`, `L`, `l` become `1`; `O`, `o` become `0`; hyphens are ignored. A student who reads a `0` on the whiteboard as an `O` still gets in.
- **Nothing drawn from the spreadsheet may be in the page before the gate passes** — not the announcement, not a name, not a count, not an ID. The empty step 2 form may sit in the markup `hidden`, because an empty input box discloses nothing and keeping it in the HTML keeps the page working without JavaScript rebuilding it.
- A wrong code produces one message and nothing else. It must not reveal whether any ID exists, whether there is an announcement, or how many students are enrolled.
- The code is never written to `localStorage` and never put in the URL.

**Step 2 — check in.** Replaces step 1 once the code is accepted. Focus moves to the step 2 heading.

- The **day announcement** from `Dashboard!C1` sits at the top. This is the only place on the site where it appears.
- **Student ID:** nine boxes. `--font-mono`, `inputmode="numeric"`, `pattern="[0-9]*"`, `maxlength="1"` each, grouped 3–3–3 with a wider gap between groups so the eye can track position. Digits are visible, not masked.
- **Message to your coaches:** optional `<textarea>`, auto-growing, no character counter.
- **Leaving early:** a checkbox that reveals a time field. That field is `hidden`, not `visibility: hidden` — it must leave the tab order when unchecked.
- **Behavior that is not optional,** on both digit groups: typing advances focus; Backspace on an empty box moves back and clears; arrow keys move between boxes; pasting a whole code or a whole nine-digit ID into any box distributes across all of them; Enter submits from any box.
- **Accessibility:** each group is a `<fieldset>` with a visible `<legend>`. Each box has an `aria-label` naming its position. An `aria-live="polite"` region announces errors. Keyboard-only operation, no traps.
- **Saved ID:** on success the ID goes to `localStorage`, and on return step 2's boxes prefill — but the student still passes the gate first. A `--text-xs` line offers to clear it, so a shared device can forget a student in one click.
- **Submit** is a real `<button type="submit">` inside a real `<form>`. Gold fill, navy text, square, full width under 30rem.

**Step 3 — result.** Replaces step 2. Greeting in display serif at `--text-2xl`, the student's personal message beneath in prose styling, a `--line-gold` above it. The greeting is the confirmation; do not add a second line restating that the check-in worked. Focus moves to the greeting heading so screen reader users are not stranded.

**Errors.** Specific, in `--danger`, beneath the relevant fieldset, announced politely, never a modal:

- Incomplete code or ID → name the field.
- Wrong day code → say the code is wrong and where to find the right one.
- Unknown student ID → say the ID was not found. Only someone who already passed the gate can ever see this.
- Network or script failure → say check-in is unreachable, and what to do instead.

**Why the gate is its own step.** The server validates the code before any student ID is transmitted; the announcement is never served to an anonymous request; and a failed attempt carries no student data at all. See **Implementation Notes**.

### Footer

One line: the advisor's name, email, and room. Hairline rule above, `--text-sm`, `--ink-muted`, translated. Nothing else — no social links, no copyright, no "built with."

### 404

Display heading, one sentence of explanation, and a link home. Translated. Same nav and footer as every other page.

* * *

## Accessibility

Non-negotiable, and cheap at this scale.

- **Focus is always visible.** `outline: 2px solid var(--focus); outline-offset: 2px;` on `:focus-visible`. Never `outline: none` without an equal replacement. The ring is navy in light mode and gold in dark mode.
- **One exception:** a heading that receives focus only programmatically, to move a screen reader to a new step, carries `tabindex="-1"` and suppresses its ring. It is unreachable by Tab, so the ring signals nothing and reads as an unexplained outline around a title. This is the only place `outline: none` is allowed.
- **Contrast** meets WCAG AA at minimum; see **The Contrast Rule**. `--ink-muted` is the floor for small text.
- **Semantic HTML first.** `<nav>`, `<main>`, `<footer>`, `<button>`, `<form>`, `<details>`, real headings in order, exactly one `<h1>` per page. No `<div onclick>`.
- **Skip link** to `<main>` as the first focusable element on every page.
- **Every `<img>` has `alt`.** Decorative SVG gets `aria-hidden="true"` and `focusable="false"`.
- **Touch targets** are at least 44×44px, including each check-in digit box and each language control.
- **`prefers-reduced-motion: reduce`** disables the loading animation and all transitions.
- **`lang` is always correct** on `<html>` and on each Mechanism B block. Mislabeled language makes a screen reader unintelligible.
- **The site works without JavaScript** except for the language switch and check-in. English content, navigation, the FAQ, and the resources list must all render and function with JS off.
- **Never `user-scalable=no`.** The viewport meta allows zoom.
- **Declare `color-scheme`** on `:root`. Without it the browser paints native controls light whatever the page does, and the time picker's clock glyph turns into a dark smudge on the navy canvas. Chrome needs `::-webkit-calendar-picker-indicator { filter: invert(1) }` on top, because that glyph is a bitmap.

* * *

## Content and Tone

The voice is a coach talking to a student: **plain, warm, specific, and unhurried.** It never sounds like marketing, and it never sounds like a robot.

### Principles

- Say the thing. "Tryouts are over for this year" beats "Tryout registration is currently unavailable at this time."
- Address the reader as *you*.
- Prefer concrete nouns and real dates over vague reassurance.
- One exclamation mark per page, maximum.
- Contractions are fine. Corporate hedging is not.
- Errors say what happened and what to do next, in that order.

### Forbidden Register

These are the tells of generated filler. None of them appear on this site.

- `Empowering students to unlock their potential`
- `Join our vibrant community of learners`
- `Take your math skills to the next level`
- `We're passionate about excellence`
- `Seamless`, `robust`, `leverage`, `elevate`, `journey`, `dive in`, `unlock`
- Em-dash-heavy triplets used for rhythm rather than meaning
- `Click here`, `Learn more`, `Oops!`, `Something went wrong`
- Emoji in body copy
- Any sentence that would be equally true of a dentist's office

### Say It Once

A heading and the control beneath it must not say the same words. `Today's Code` above a legend reading `Today's code`, or `Check In` above a button reading `Check in`, reads as a stutter and wastes the one line that could have been useful. Give the second one a job: the legend says where to find the code, and the button says what pressing it does.

A plain label like `Submit` is fine when the heading above it has already named the task. It is only weak when it stands alone.

### The Approval Rule

**Any user-facing string longer than two words must be approved by the maintainer before it ships.** This covers headings, buttons, labels, errors, alt text, page titles, meta descriptions, and all three translations of each.

When proposing copy, present it as a table of English / Chinese / Korean and wait. Do not write placeholder prose "to be replaced later" — placeholder prose ships.

### Translation Standards

- Translations are **professional and idiomatic**, not literal. A translation that mirrors English word order is wrong even when every word is right.
- Register must match across languages: the English is warm and plain, so the Chinese avoids bureaucratic set phrases (`福祉`, `无法满足…需求`) and the Korean avoids stiff formal endings where a friendly polite form reads better.
- Jokes and parallelism are content. If two English headings rhyme structurally, the Chinese and Korean must too.
- School vocabulary, not business vocabulary: club sessions are `活动` / `모임`, not `会议`; a school club is `社团`, not `俱乐部`.
- When the English source is itself wrong or ambiguous, fix the English — do not translate an error faithfully.

* * *

## Implementation Notes

### Build and Hosting

- GitHub Pages at `mc.uhsmathclub.org`, with a `CNAME` file and HTTPS enforced.
- Clean URLs come from directory indexes: `/tryouts/index.html`, `/resources/index.html`, `/hello/index.html`. Do not rely on extensionless `.html` serving.
- Content sources compile to HTML in CI. The deployed artifact is built, not committed, so the repository stays readable.
- The repository root holds only `build.py`, `requirements.txt`, `SKILL.md`, and the dotfiles. Everything else is grouped: `content/` for the YAML and markdown a coach edits, `assets/` for photographs and the logo, `templates/` for the page templates and the stylesheet, `apps-script/` for the fallback web app. A root that fits on one screen is worth the extra path segment.
- One stylesheet, one script, both small enough to consider inlining. No bundler, no framework, no dependency tree that will rot.
- `/hello` is `noindex`.

### The Check-In Backend

The spreadsheet is the database. Its shape is fixed, and the code must not assume anything beyond it.

| Sheet        | Layout                                                                                                                                                             |
|--------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `Dashboard`  | `B1` day code · `C1` day announcement · from **row 3**: `A` name, `B` student ID, `C` timestamp, `D` personal message, `E` student response, `F` leaving-early time |
| `Log`        | `A` name, `B` timestamp, `C` response. **Append-only** — never rewritten, never cleared                                                                            |
| `Attendance` | `A` name, `B` student ID, then one column per meeting with the date in row 1                                                                                       |

Names in `Dashboard!A` take the form `Preferred (Legal) Last`, collapsing to `First Last` when the preferred and legal names match. Anything greeting a student must handle both.

Three things here are easy to get wrong and silently destructive:

- **Student rows start at row 3.** The ID lookup scans `B3:B`, never `B1:B`, or it can match the day code sitting in `B1`.
- **`Log!B` must hold a real `Date`, not a formatted string.** The attendance checkboxes are
  `=IF(ISERROR(VLOOKUP($A2, FILTER(Log!$A$2:$A, INT(Log!$B$2:$B)=INT(C$1)), 1, FALSE)), FALSE, TRUE)`.
  `INT()` over a text timestamp never matches a date header, so attendance reads as absent for everyone and nothing visibly errors. Write a `Date` object and set the cell's number format for display. The same applies to `Dashboard!C`.
- **Timestamps come from a real `Date` in `America/Los_Angeles`,** formatted with `Utilities.formatDate` — never `toLocaleString`, which depends on the server's locale rather than the sheet's.

**Checking in twice** overwrites that student's `Dashboard` row — there is one row per student — and appends another `Log` entry. The log is the record; the dashboard is the view.

**Resetting** is a menu item, never a trigger. `New day` rolls a fresh code and clears the per-day columns (`C` through `F`) and the name bolding. `New code only` re-rolls the code mid-session without clearing anything. Neither writes to `Attendance`: those columns are added by hand, and their formulas read the `Log`, so the script never needs to.

Neither action announces the new code. It lands in `B1`, in front of whoever ran the menu item, and a dialog on top of it would only need dismissing.

### The Day Code

- Four characters of **Crockford base-32**: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`. `I`, `L`, and `O` are excluded because they are misread as `1`, `1`, and `0`; `U` is excluded so the generator cannot produce a word nobody wants on a whiteboard.
- Input is normalized before comparison: uppercase, `I`/`i`/`L`/`l` to `1`, `O`/`o` to `0`, hyphens stripped. A student who transcribes the code wrong in the predictable way still gets in.
- Generate from `Utilities.getUuid()` entropy rather than `Math.random()`, and reject modulo bias instead of taking a remainder.
- Compare with a **constant-time equality check**: accumulate XOR differences across a fixed length and test once at the end. Never `===`, never an early `return false`.

  State this honestly rather than overselling it. JavaScript on Apps Script cannot truly guarantee constant time, and network jitter to a Google endpoint dwarfs any timing signal a student could measure. It costs four lines and closes a whole category of argument, so it is worth doing — but the real protection is that 32^4 is 1,048,576, that Apps Script enforces its own quotas, and that the code rotates every meeting.
- The code is validated **first**, before any student record is read, and never appears in a response body.

### Google Apps Script Fallback

The Apps Script web app is the backup for when Pages or DNS fails, and it must stay visually consistent with the site.

- Shared CSS lives in `Stylesheet.html` and is pulled into every template with
  `<?!= HtmlService.createHtmlOutputFromFile('Stylesheet').getContent(); ?>`.
- The same rule applies to any shared script partial. Nothing is duplicated between templates.
- It mirrors the public flow exactly — same gate, same two steps, same copy — so there is one interaction model to explain and one stylesheet to maintain.
- Values interpolated from the spreadsheet are escaped. A coach pasting `a < b` into a cell must not break the page.
- The public site reaches Apps Script through a single JSON endpoint. That endpoint is public, so the day code is the gate: validate it first, keep responses minimal, and never echo a student ID back.

## Anti-Patterns

- Gold text on a light background
- Pure white backgrounds
- Cards, rounded containers, pill controls, drop shadows, gradients, glassmorphism
- A hamburger menu on a four-page site
- A `<select>` for the language switcher
- Text built by concatenating translated fragments
- Latin punctuation inside CJK sentences, or letter-spaced CJK
- Italic CJK
- Loading a webfont — any webfont
- Hard-coded prose in a template instead of `home.yml`
- HEIC delivered to a browser
- Placeholder text used as a label
- Scroll-triggered animation
- An icon font or icon library for four pages
- `outline: none`
- Generated marketing voice anywhere in the copy

* * *

## QA Checklist

**Visual**

- [ ] Paper background, not white; navy text throughout
- [ ] No gold text on a light background anywhere
- [ ] At most two gold marks visible per viewport
- [ ] No shadows, and no radii outside the two sanctioned cases
- [ ] Dark mode verified, including photo borders and the focus ring

**Typography**

- [ ] Body copy is 17px and capped at ~66 characters
- [ ] Display serif checked on Windows and macOS (Georgia) **and** on ChromeOS/Android (Noto Serif / Tinos), where Georgia is absent
- [ ] CJK uses its own stack, with no italics and no letter-spacing
- [ ] En dashes in year ranges, curly quotes, real `π`

**Internationalization**

- [ ] Every string translates in all three languages, including `alt`, `aria-label`, `placeholder`, and `<title>`
- [ ] `<html lang>` updates with the switch
- [ ] No flash of the wrong language on load with a saved preference
- [ ] Layout holds in all three at 320px and at 1440px
- [ ] Language choice survives reload and does not clear the check-in form

**Check-in**

- [ ] With the gate unpassed, the page source contains no ID field and no announcement
- [ ] Crockford normalization works: `o`/`O` accept as `0`, `i`/`I`/`l`/`L` accept as `1`, and hyphens are ignored
- [ ] Pasting a whole code or a whole 9-digit ID into any box fills the group
- [ ] Backspace, arrow keys, and Enter behave in both groups
- [ ] A saved ID prefills at step 2 and can be cleared in one click
- [ ] The day code is absent from localStorage and from the URL
- [ ] Each error case produces its own specific message
- [ ] A wrong day code reveals nothing about whether an ID exists
- [ ] Checking in twice overwrites one Dashboard row and appends a second Log row
- [ ] Log timestamps are real Dates and the Attendance checkboxes actually tick
- [ ] Errors are announced to screen readers

**Accessibility**

- [ ] Keyboard-only pass through every page, focus always visible
- [ ] Skip link present and working
- [ ] One `<h1>` per page, heading order unbroken
- [ ] All images have meaningful or empty `alt` as appropriate
- [ ] Touch targets ≥ 44px
- [ ] Every page is usable with JavaScript disabled

**Content**

- [ ] Every string over two words has been approved
- [ ] No phrase from the Forbidden Register appears
- [ ] Dates, names, and room numbers are factually correct in all three languages
- [ ] No placeholder copy remains
