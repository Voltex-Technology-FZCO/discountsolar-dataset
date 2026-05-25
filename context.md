# Dataset Browser — Project Context

## Goal

React + Meteor app that displays a permit/owner dataset (will scale to ~90k records). No login. User can:

1. Browse the dataset (paginated table, fullscreen).
2. Filter by search text, county, year range. Sort by year.
3. Select records (selection persists across pages) and send them to a downstream service (TBD).
4. Once successfully sent, records are flagged (`sent: true`, `sentAt: Date`) and hidden from the default view. A toggle re-reveals sent records.

DNC-flagged phones are suppressed from the table view (and will be suppressed from any future export). Original DNC entries are still stored on the record so we can count them.

## Stack

- **Meteor 3.4.1** with rspack bundler (`@meteorjs/rspack` 2.0.1)
- **React 18** + TypeScript
- **Tailwind v4** via `@tailwindcss/postcss` (no `tailwind.config` file; CSS-only theme)
- **shadcn/ui** — manual install (no Meteor preset); style `new-york`, base `neutral`, alias `@/*` → `imports/ui`
  - Installed primitives: button, input, checkbox, table, badge, card, label, **tooltip**, **select**
  - Radix peers: `@radix-ui/react-checkbox`, `react-dialog`, `react-label`, `react-slot`, `react-tooltip`, `react-select`
- **zod** for schema validation
- **meteor-rpc** (`grubba`, npm pkg) for type-safe RPC — arrow fns only, never `function()`, never `this.userId` (use `Meteor.userId()`)
- **@tanstack/react-query 5.x** — peer of meteor-rpc. Used both via meteor-rpc's wrappers (suspense by default) **and** directly for non-suspending queries (see "Suspense isolation" gotcha).
- **lucide-react** icons

`@faker-js/faker` is in deps but no longer used (replaced by CSV seed).

## Directory map

```
datasetbrowser/
  client/
    main.css            # Tailwind v4 @import + oklch theme tokens + shadcn vars
    main.html
    main.tsx            # Meteor.startup → React root + import "./main.css"
  imports/
    api/
      datasetRecords.ts  # Mongo.Collection + zod schemas (PhoneSchema, DatasetRecordSchema) + visiblePhones/visibleEmails helpers
    ui/
      App.tsx              # ErrorBoundary > QueryClientProvider > TooltipProvider > Suspense > router
      components/
        ErrorBoundary.tsx
        ui/                # shadcn primitives — incl. tooltip.tsx, select.tsx
      lib/
        utils.ts           # cn() helper
        queryClient.ts     # react-query client
        rpc.ts             # createClient<Server>() from server type
      pages/
        DatasetBrowser.tsx # main page (filters, sortable+paginated table, send)
        NotFound.tsx
  private/
    example.csv         # seed data — read via Assets.getTextAsync on startup
  server/
    main.ts             # meteor-rpc module + CSV parser + seedFromCsv
  components.json       # shadcn config
  postcss.config.cjs    # @tailwindcss/postcss plugin
  rspack.config.ts      # CSS loader + meteor-rpc swc loader + @ alias + ts-checker exclude (configOverwrite + issue.exclude)
  tsconfig.json         # paths "@/*": ["imports/ui/*"], excludes node_modules
  swc.config.ts         # default
```

## Domain model

`imports/api/datasetRecords.ts`:

```ts
PhoneSchema = z.object({
  number: z.string(),
  carrier: z.string().optional(),
  type: z.string().optional(),  // "Mobile" / "Land Line" / ...
  dnc: z.boolean().default(false),
});

DatasetRecordSchema = z.object({
  _id: z.string().optional(),
  permitAppliedDate: z.date().optional(),
  streetAddress: z.string(),
  city: z.string(),
  zipCode: z.string(),
  county: z.string(),
  homeValue: z.number().optional(),
  firstName: z.string(),
  lastName: z.string(),
  phones: z.array(PhoneSchema).default([]),
  emails: z.array(z.string()).default([]),
  projectDescription: z.string().optional(),
  parcelId: z.string().optional(),
  externalId: z.string().optional(),
  sent: z.boolean().default(false),
  sentAt: z.date().optional(),
});

DatasetRecordsCollection = new Mongo.Collection<DatasetRecord>("datasetRecords");

visiblePhones(r) = r.phones.filter(p => !p.dnc);
visibleEmails(r) = r.emails.filter(e => e.length > 0);
```

This shape is derived from `private/example.csv`. Real production schema may swap in here later. For the 90k import, ensure indexes on the filtered columns (`sent`, `county`, `permitAppliedDate`, plus a text/multikey strategy for `firstName`/`lastName`/`streetAddress`/`emails`/`phones.number`) before pushing real data in.

## CSV import

`server/main.ts` runs `importIfEmpty()` on `Meteor.startup`. **One-shot** — only imports when `DatasetRecordsCollection.find().countAsync() === 0`. Subsequent boots short-circuit with `[import] skipped — N records already present`.

- Source resolution: tries `private/dataset.csv` first, then `private/example.csv` (kept as a dev fallback). If neither is found, logs and exits — no error.
- Inline CSV parser handles quoted values (e.g. `"$454,000.00"`).
- Maps columns by fixed offset (each phone group = 4 cols at base `8 + i*4`).
- `homeValue` parsed stripping `$` and `,`. `permitAppliedDate` parsed as `Date`. DNC = literal string `"TRUE"`.
- **Bulk insert** via `DatasetRecordsCollection.rawCollection().insertMany(batch, { ordered: false })` in batches of `1000`. `Promise.all(insertAsync)` does **not** scale to ~90k — pool exhaustion. Each doc gets a pre-generated `_id` from `Random.id()` (`meteor/random`) so the raw driver doesn't substitute Mongo ObjectIds and break the app's `_id: string` typing.
- Logs progress every 10k inserts plus a final total + duration line.

To re-import (e.g. after dropping a new `dataset.csv` in):

1. Stop meteor.
2. Wipe the collection — easiest is to delete `.meteor/local/db/` (full mongo reset), or in the meteor mongo shell: `db.datasetRecords.drop()`.
3. Restart meteor — first boot re-imports.

`Assets` global typing: the bundled `@types/meteor` only declares the sync `getText` and isn't auto-loaded because `tsconfig.types: ["node", "mocha"]`. Server file declares it locally:

```ts
declare const Assets: {
  getTextAsync: (path: string) => Promise<string | undefined>;
};
```

## meteor-rpc layout

Server (`server/main.ts`) builds a submodule `datasetRecords` so the client gets nested `api.datasetRecords.*`. Filter/paginate/sort all happen **server-side** — clients never receive more than one page of records.

```ts
const FilterSchema = z.object({
  includeSent: z.boolean().default(false),
  search: z.string().default(""),
  county: z.string().default("all"),
  yearFrom: z.number().int().nullable().default(null),
  yearTo: z.number().int().nullable().default(null),
});
const ListArgsSchema = FilterSchema.extend({
  sortDir: z.enum(["asc", "desc"]).nullable().default("desc"),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(500).default(50),
});

// buildSelector(FilterArgs) → Mongo selector
//   includeSent=false ⇒ { sent: { $ne: true } }
//   county!="all"     ⇒ { county }
//   yearFrom/yearTo   ⇒ { permitAppliedDate: { $gte, $lt } } (whole-year boundaries)
//   search            ⇒ case-insensitive RegExp $or over name/address/city/zip/project/emails
//                       (digits-only token also matched against "phones.number")

createModule("datasetRecords")
  .addPublication("list", ListArgsSchema,
    // @ts-expect-error meteor-rpc types declare tuple but resolver receives unwrapped object
    (args) => DatasetRecordsCollection.find(buildSelector(args), {
      sort: args.sortDir ? { permitAppliedDate: args.sortDir === "asc" ? 1 : -1 } : undefined,
      skip: args.page * args.pageSize,
      limit: args.pageSize,
    })
  )
  .addMethod("count", FilterSchema,
    async (args) => DatasetRecordsCollection.find(buildSelector(args)).countAsync())
  .addMethod("facets", z.object({}),
    async () => {
      const raw = DatasetRecordsCollection.rawCollection();
      const counties = (await raw.distinct("county")).filter(c => typeof c === "string" && c.length > 0).sort();
      const yearAgg = await raw.aggregate([
        { $match: { permitAppliedDate: { $type: "date" } } },
        { $group: { _id: { $year: "$permitAppliedDate" } } },
        { $sort: { _id: -1 } },
      ]).toArray();
      return { counties, years: yearAgg.map(y => y._id) };
    })
  .addMethod("markAsSent", z.object({ ids: z.array(z.string()).min(1) }),
    async ({ ids }) => { /* sets sent:true / sentAt:now, skips already-sent */ })
  .buildSubmodule();
```

Client (`imports/ui/lib/rpc.ts`):

```ts
import { createClient } from "meteor-rpc";
import type { Server } from "/server/main";
export const api = createClient<Server>();
```

### How the client uses these

```ts
// list (current page) — suspending; isolated in a child component (see below)
const { data } = api.datasetRecords.list.usePublication(listArgs);

// count + facets — non-suspending react-query (see Suspense isolation gotcha)
const { data: total } = useQuery({
  queryKey: ["datasetRecords.count", filterArgs],
  queryFn: () => api.datasetRecords.count(filterArgs),
  placeholderData: keepPreviousData,
});

// methods directly
await api.datasetRecords.markAsSent({ ids });
```

The publication's client minimongo collection is **named after the publication** (`"datasetRecords.list"`), not `DatasetRecordsCollection`. Don't `useFind` the original collection from the client.

## UI

`App.tsx`: `ErrorBoundary > QueryClientProvider > TooltipProvider (delayDuration={150}) > Suspense (page-level fallback) > router`.

`DatasetBrowser.tsx` — fullscreen (`w-full p-6`).

**Filters card** (4-col grid on lg):
- **Search**: text input, debounced 300ms via `useDebounced` hook before being included in `filterArgs`.
- **County**: shadcn `Select`, populated from `facets.counties`, `"all"` option = no filter.
- **Year range**: two shadcn `Select`s (From / To), populated from `facets.years`. Each defaults to sentinel `"any"` (mapped to empty string in state — Radix forbids empty `value`). Records without a date are excluded when either bound is set.
- **Visibility**: checkbox "Show already-sent records" → drives `includeSent`.

**Header bar**: `firstRow–lastRow of total records · K selected` + "Send selected" button.

**Table** (extracted as `<RecordsTable>` child, wrapped in inner `<Suspense fallback={<TableSkeleton/>}>`):
1. Select-all checkbox (current page only)
2. Owner (firstName + lastName, nowrap)
3. **Year** — sortable header button: cycles `desc → asc → null`, default `desc`. Icon: `ArrowDown` / `ArrowUp` / muted `ArrowUpDown`.
4. Address — single-line: `street, city, zip` (`whitespace-nowrap`)
5. County — `Badge variant="secondary"`
6. Home value (right-aligned, tabular-nums, `formatMoney`)
7. Phones — `max-w-0` cell + `truncate` child for ellipsis; `(xxx) xxx-xxxx` formatted; DNC numbers filtered out via `visiblePhones`; if any DNC, a `<PhoneOff />` badge with hidden count appears inline. Both the phone list and the DNC badge open shadcn `Tooltip`s on hover (list shows each number + type on its own line).
8. Emails — `max-w-0` + `truncate`; tooltip shows each email on its own line.
9. Project (muted text, project description)
10. Status — `Badge` `sent` / outline `pending`

**Pagination footer**:
- "Rows per page" select (`25 / 50 / 100 / 200`).
- "Page X of Y" + first / prev / next / last buttons (`ChevronsLeft/Left/Right/RightsRight`).
- `totalPages = max(1, ceil(total / pageSize))`. Page clamped when filter trims results.

**Selection**: lives in component-local `Set<string>`. Persists across page navigation. "Select all visible" only toggles records on the current page. The `firstRow–lastRow of total` counter and `K selected` counter sit in the header bar.

**Filter-change page reset**: `useEffect` resets `page = 0` whenever any of `includeSent / search / county / yearFrom / yearTo / pageSize / yearSort` changes.

## Build wiring — gotchas worth remembering

### 1. rspack.config.ts is loaded as ESM
No `__dirname`. Use `process.cwd()`:

```ts
const projectRoot = process.cwd();
alias: { "@": path.resolve(projectRoot, "imports/ui") }
```

### 2. meteor-rpc ships raw `.ts` source (not compiled)
Default swc-loader rule excludes `node_modules`. Second rule includes meteor-rpc:

```ts
{
  test: /\.ts$/,
  include: [path.resolve(projectRoot, "node_modules/meteor-rpc")],
  loader: "builtin:swc-loader",
  options: { jsc: { parser: { syntax: "typescript" }, target: "es2020" } },
}
```

### 3. meteor-rpc has internal TS errors — silence them
Its `lib/*.ts` files have `z.input` vs `z.output` mismatches. Silence ts-checker output with **two** mechanisms:

- `TsCheckerRspackPlugin({ typescript: { configOverwrite: { exclude: [...] } } })` — keeps them out of the initial program.
- `issue: { exclude: [{ file: "**/node_modules/meteor-rpc/**" }, { file: "**/node_modules/**" }] }` — drops any diagnostic ts-checker still produces for those paths after walking imports. **Required** — `configOverwrite.exclude` alone is not enough because TS transitively type-checks imported files.

Restart meteor after editing `rspack.config.ts` (config only loads at boot).

### 4. Publication handler signature
meteor-rpc types declare `args: [z.input<Schema>]` (tuple) but at runtime the resolver receives the **unwrapped object**. Use `@ts-expect-error` + explicit type:

```ts
// @ts-expect-error meteor-rpc types declare tuple but resolver receives unwrapped object
(args: z.infer<typeof ListArgsSchema>) => { ... }
```

### 5. Tailwind v4 + Meteor rspack
- `@meteorjs/rspack` auto-delegates CSS to rspack when we provide a CSS loader rule.
- `experiments.css: true` + `postcss-loader` rule for `.css`.
- `postcss.config.cjs` registers `@tailwindcss/postcss` only.
- `main.css` does `@import "tailwindcss"` + `@import "tw-animate-css"` + oklch theme tokens + `@theme inline { --color-* mappings }`.

### 6. Path alias declared in two places
- `tsconfig.json` paths: `"@/*": ["imports/ui/*"]`
- `rspack.config.ts` resolve.alias: `"@": path.resolve(projectRoot, "imports/ui")`

### 7. Radix Select rejects empty string values
For "no selection" sentinels (year range bounds), use a non-empty placeholder like `"any"` and map back to `""` in state. Native `<select>` allows `value=""`; Radix throws.

### 8. shadcn tooltips need a Provider
`TooltipProvider` is mounted once in `App.tsx`. Individual `Tooltip` components don't need their own provider.

### 9. Suspense isolation — DO NOT let suspending hooks live next to inputs
meteor-rpc's `usePublication`, `useQuery`, and `useMutation` all wrap `useSuspenseQuery` internally. When their args change (new query key) they **re-suspend**, which unmounts the entire subtree to the nearest Suspense boundary. If a search input lives in that subtree, every keystroke (or every debounce tick) causes the input to unmount and **lose focus**.

Rules in this project:

- **Filters and the search input never call a suspending hook.** They use only `useState` and `@tanstack/react-query`'s plain `useQuery` (not the meteor-rpc wrappers).
- **`count` and `facets`** are read with react-query directly (`useQuery({ queryFn: () => api.datasetRecords.count(args) })`) plus `placeholderData: keepPreviousData` so the displayed value doesn't flash to zero during refetch.
- **The list publication is the one suspending call** — it's extracted into a `<RecordsTable>` child wrapped in its own `<Suspense fallback={<TableSkeleton/>}>`. Filter changes flash only the table area; the input stays mounted.

If you add another suspending hook, put it inside (or behind) an inner Suspense boundary that excludes any focusable controls.

## Running

```bash
meteor run                  # default
meteor run --port 3457      # what we used during dev
```

App at `http://localhost:3457/`. On boot, `importIfEmpty()` imports CSV rows only when the collection is empty (see "CSV import" above for re-import procedure).

## GoHighLevel export

Wired up. RPC method `datasetRecords.sendToGhl({ ids })`, server-side, sequential. Mirrors the pattern from `../recordweb/apps/web/app/(tenant)/history/actions.ts` (`exportOrdersToGhl`) and `../recordweb/apps/web/lib/ghl.ts`.

### Settings

Tokens live in `Meteor.settings.private.ghl` (server-only — `private` key never leaks to client). Shape in `settings.example.json`:

```json
{
  "private": {
    "ghl": {
      "apiToken": "REPLACE_ME_PRIVATE_INTEGRATION_TOKEN",
      "locationId": "REPLACE_ME_LOCATION_ID",
      "recordIdFieldId": "REPLACE_ME_CUSTOM_FIELD_ID_FOR_RECORD_ID",
      "source": "Dataset Browser"
    }
  }
}
```

Run with `meteor run --settings settings.json`. `recordIdFieldId` must be a text custom field on the GHL location (find under Custom Fields in the GHL UI, copy field id). Used for dedup search.

### Split strategy (multi-contact records)

Records with several non-DNC phones and/or emails are split into multiple GHL contacts. Total contacts = `max(non-DNC phones, emails)`. Pairing is **zip by index** — `contact[i]` gets `phones[i]` (if exists) and `emails[i]` (if exists). Extras get only the longer side. Example: 3 emails + 2 phones = 3 contacts; the third has email only, no phone.

Build helpers live in `server/ghl.ts`: `buildContactPairs(record)`, `buildContactPayload(rec, cfg, pair)`, `buildTagsForContact({ hasEmail, phone })`.

### Tags

Every contact gets `source:ds`. Then per contact:

- has email → `ds:email`
- phone type contains "mobile" / "cell" / "wireless" → `ds:text` + `ds:call`
- phone type contains "land" → `ds:call` only
- phone with unknown / missing type → `ds:call` (callable default)

No spaces in tags. Constants exported from `server/ghl.ts`: `SOURCE_TAG`, `EMAIL_TAG`, `TEXT_TAG`, `CALL_TAG`.

### Dedup

Before create: `POST /contacts/search` filtered by custom field `customFields.${recordIdFieldId} == "${recordId}#${i+1}"`. If hit → outcome `duplicate`, contact id returned, **note creation is skipped** (gotcha — see below).

### Note attached to each created contact

`buildNoteBody(record, index, total)` in `server/main.ts` produces multi-line note:

```
Contact 1 of 3 — Dataset Browser import

Owner: John Doe
Site address: 123 Main St, Springfield, 90210
County: Cook
Permit applied: 2024-08-12
Home value: $450,000
Project: Solar PV install
Parcel ID: ...
External ID: ...

All phones (2):
  • (312) 555-1234 [Mobile]
  • (312) 555-9999 [Land Line]
  (1 DNC suppressed)

All emails (3):
  • a@b.com
  • c@d.com
  • e@f.com
```

Note failure is **non-fatal** — captured as `noteError` on the result row, logged as `[ghl] note failed for <contactId> ...` on the meteor console, surfaced in UI summary as `noteErrors`. Contact still counts as `created`.

### Outcomes / mark-sent semantics

Per-pair outcomes: `created` | `duplicate` | `error` (search or create failure). Per-record outcomes: `skipped_no_contact` (no non-DNC phones AND no emails), `skipped_already_sent`.

A record's `sent: true` flips **only if every pair succeeded as created OR duplicate** (no `error`). Partial failures stay pending so the user can retry. Mark happens in one bulk `updateAsync` at the end of the method.

Method return:

```ts
{
  summary: {
    created, duplicates, skipped, errors, noteErrors,
    recordsMarkedSent  // count of records whose status flipped
  },
  rows: Array<{ recordId, contactIndex?, total?, outcome, contactId?, noteError?, error? }>
}
```

### UI

`Send selected` button → `api.datasetRecords.sendToGhl({ ids: [...selected] })`. On success:
- summary chip in header bar shows last-send counts
- successful ids removed from selection
- `["datasetRecords.count"]` query invalidated so counts refetch
- if `errors > 0`, alert with first error message; full error rows in `console.error`

Hard cap: 500 ids per call (zod `.max(500)`). UI doesn't enforce this yet — for large batches the operator must chunk manually.

### "Show only already-sent records" toggle

`includeSent: false` (default) → `{ sent: { $ne: true } }` (pending only).
`includeSent: true` → `{ sent: true }` (sent only, no mixed view).

### Open follow-ups

1. **Background job + processing status** — `sendToGhl` blocks until all GHL round-trips finish (up to ~3000 fetches at max batch). Plan in conversation history: add `status: 'pending' | 'processing' | 'sent' | 'failed'`, fire-and-forget worker, hide `processing` from default view, restart recovery via on-startup re-enqueue of stuck `processing` records. ~1.5h for fire-and-forget, ~3h for proper queue with concurrency cap + 429 backoff.
2. **Re-importing notes on duplicate** — currently dedup skips note creation. If operator re-sends a record (test or genuine update), no fresh note. Could optionally always append a note even on duplicate, but risks note spam. Decide per-product.
3. **Note `userId` field** — some GHL Private Integration tokens require `userId` on note POST. If `noteErrors > 0` consistently, add `userId` to the addContactNote payload (read from settings).
4. **Drop the real dataset in** — put it at `private/dataset.csv` and restart with an empty collection; `importIfEmpty` picks it up automatically. Add indexes: `{ sent: 1 }`, `{ county: 1 }`, `{ permitAppliedDate: -1 }`, `{ "phones.number": 1 }`. Consider text index over name/address/city.
5. **Toast instead of alert** for error surface. `alert()` blocks; toast scales to multi-failure summaries.
6. **react-query `useMutation` for sendToGhl** — would give `isPending` / `error` state without manual `useState`. Use react-query's `useMutation` directly, not meteor-rpc's wrapper (Suspense gotcha #9).
7. **Sortable columns beyond Year** — Owner, Home value, County. Generalise `yearSort` into `{ col, dir }`.

## CLAUDE.md rules in play

- meteor-rpc → arrow fns, `Meteor.userId()` (not `this.userId`). Already followed.
- Publications for basic data fetching (we use `addPublication` for the paged list; methods only for count / facets / markAsSent which aren't reactive data).
- Cannot use sync (non-async) Roles package fns on the server. Not relevant yet — no auth.
- Commit messages: no "anthropic" / "claude" mentions.
- 404 + ErrorBoundary required. Done.
