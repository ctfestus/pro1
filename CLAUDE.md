# Placement & conventions guide

Where new code goes, and the rules that keep additions consistent. Read this before adding
a feature so it lands in the right place and follows the patterns the codebase already uses.

## Layout (the mental model)

- **`app/`** — routes and page orchestrators. A `page.tsx` should stay thin: state, data load,
  and a switch that renders sections imported from `components/<area>/`.
- **`app/api/<name>/route.ts`** — server routes.
- **`components/<area>/`** — the pieces a specific surface is built from
  (`components/student/`, `components/create/`, `components/dashboard/`, …).
- **`components/` (root)** — reusable UI **or cross-area feature components used by multiple
  routes** (e.g. `CourseTaker.tsx`, `FormEditor.tsx`, the AI-review players, `AnimatedField`,
  `RichTextEditor`).
- **`lib/`** — shared logic, contracts, helpers, adapters, auth, formatting, and lightweight
  hooks (e.g. `lib/theme.ts` exports `useC()`). Not page-level rendering.
- **`migrations/` + `festman-fresh-schema.sql`** — database.
- **`tests/`** — Vitest. Currently node-env, in-process route/auth-policy tests only.

## Decision tree — "I'm adding X, where does it go?"

- **A new section/card/panel/modal for one surface** → `components/<area>/`. Add it to that
  page's section switch (and `components/student/nav.tsx` if it's a nav item). If it's only
  used by one parent, it can start as a function inside that file and graduate to its own file
  when it grows.
- **A reusable UI component, or a feature component used by more than one route** →
  `components/` root.
- **Pure logic / contract / helper / adapter / formatter / lightweight hook (no page-level
  rendering)** → `lib/`, one file per concern.
- **A new backend endpoint** → `app/api/<name>/route.ts` (see auth rule below).
- **A new page/screen** → `app/<route>/page.tsx`, kept as a thin orchestrator.

## Architectural anchors (do not bypass)

- **Content contract:** the course/form types (`FormConfig`, `CourseQuestion`, `PointsSystem`,
  …) live in `lib/course-schema.ts`. Import them; never redefine them. Ingest/normalize through
  its `normalizeFormConfig`/`validateFormConfig` at boundaries.
- **API auth:**
  - User-authenticated routes → `requireUser` / `requireRole` from `lib/api-auth`. Do **not**
    hand-roll Bearer parsing. Roles come from `students.role` — never the `profiles` table.
  - Machine-auth routes (QStash cron, HMAC sync, shared-secret reindex, cookie-session uploads)
    are exceptions — follow the established pattern for that route family, don't force them onto
    `requireUser`.
- **Theme:** use `useC()` + tokens from `lib/theme` (`C.card`, `C.text`, `C.cta`, …).
  *Exception:* the create editor has its **own** local theme in `components/create/theme.ts`
  (different token shape). Inside that editor use the local one; don't cross them. Unifying the
  two is a deliberate future PR, not incidental work.

## Cross-cutting rules

- **New course/content field — wire the whole path:**
  1. type in `lib/course-schema.ts`
  2. persist in `app/api/forms/route.ts` (+ migration + `festman-fresh-schema.sql`)
  3. authoring UI in **both** `app/create/page.tsx` and `components/FormEditor.tsx` (create and
     edit are two separate editors)
  4. **runtime consumers** — wherever it renders/is used: usually `components/CourseTaker.tsx`
     and the relevant `components/student/*` / `components/dashboard/*` display.
  Missing step 4 is the easy one to forget.
- **Database:** every migration is also applied to `festman-fresh-schema.sql` in the same change,
  with an RLS policy following the existing `is_instructor_or_admin() AND owner = auth.uid()`
  shape. Client-side writes rely on RLS being correct.
- **Uploads:** use the **existing upload path for that asset type** — don't invent a new one.
  The repo deliberately uses several: `app/api/upload/route.ts` (cookie-session, ownership-scoped
  Cloudinary), direct `lib/uploadToCloudinary.ts`, Supabase Storage, and `lib/uploadToGithub.ts`
  for specific dataset/asset files. Match the surrounding flow.
- **Documents / media embeds:** use the **existing embed/document flow for that content type**
  (Canva embeds, PDF handling, safe embedded URLs via `lib/safe-embed-url`, extraction flows).
  Prefer safe URL embedding and existing viewers/helpers over building a new viewer.
- **Multi-tenant:** never hardcode "AI Skills Africa" (or any tenant) as a default/fallback.
- **Style:** borderless cards; no purple/indigo (use `C.cta`/neutrals); status badges green on
  white; plain ASCII in user-visible string, template, and JSX text (no em dashes, curly quotes,
  ellipsis char, angle brackets); comments are outside this rule and must not be auto-rewritten;
  use UI icons rather than ASCII substitutes when the character is a control (for example Close);
  no `--` in dropdown placeholders ("Select cohort", not "-- Select cohort --").

## Before committing

`npx tsc --noEmit`, `npx eslint <files>`, and `npm test` should be clean. `npm test` begins with
the non-mutating, changed-lines-only user-visible ASCII check (`npm run check:chars`). tsc is the safety net
for moves/refactors — it catches cross-file symbol and type gaps the linter (which does not flag
unused imports here) misses. Note: the harness covers route/auth behavior, **not** UI interaction
— exercise UI-heavy changes manually.

## Worked examples

**Add a "Goals" section to the student dashboard:** create `components/student/goals.tsx`
(export `GoalsSection`, import shared primitives from `components/student/shared`), add a nav
entry in `components/student/nav.tsx`, render it in `app/student/page.tsx`'s switch. Data reads
go through `supabase` under RLS (student-owned) or a new `app/api/...` route if it needs the
service role.

**Add a "difficulty" field to courses:** type in `lib/course-schema.ts` → persist in
`app/api/forms/route.ts` (+ migration + schema sync) → control in **both** `app/create/page.tsx`
and `components/FormEditor.tsx` → render in `components/CourseTaker.tsx` and
`components/student/courses-paths.tsx`.
