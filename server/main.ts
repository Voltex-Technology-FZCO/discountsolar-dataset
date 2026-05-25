import { Meteor } from "meteor/meteor";
import { Random } from "meteor/random";
import { createModule } from "meteor-rpc";
import { z } from "zod";
import {
  DatasetRecordsCollection,
  type DatasetRecord,
  type Phone,
} from "/imports/api/datasetRecords";
import {
  addContactNote,
  buildContactPairs,
  buildContactPayload,
  createContact,
  searchContactByRecordId,
  type GhlConfig,
} from "./ghl";

const parseCsv = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
    } else {
      cur += ch;
    }
  }
  if (cur.length > 0 || row.length > 0) {
    row.push(cur);
    if (row.some((v) => v.length > 0)) rows.push(row);
  }
  return rows;
};

const parseHomeValue = (raw: string): number | undefined => {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
};

const parseDate = (raw: string): Date | undefined => {
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const parsePhones = (cols: string[]): Phone[] => {
  const phones: Phone[] = [];
  for (let i = 0; i < 5; i++) {
    const base = 8 + i * 4;
    const number = (cols[base] ?? "").trim();
    if (!number) continue;
    const carrier = (cols[base + 1] ?? "").trim();
    const type = (cols[base + 2] ?? "").trim();
    const dncRaw = (cols[base + 3] ?? "").trim().toUpperCase();
    phones.push({
      number,
      carrier: carrier || undefined,
      type: type || undefined,
      dnc: dncRaw === "TRUE",
    });
  }
  return phones;
};

const parseEmails = (cols: string[]): string[] => {
  const emails: string[] = [];
  for (let i = 0; i < 3; i++) {
    const e = (cols[28 + i] ?? "").trim();
    if (e) emails.push(e);
  }
  return emails;
};

const rowToRecord = (cols: string[]): Omit<DatasetRecord, "_id"> | null => {
  const firstName = (cols[6] ?? "").trim();
  const lastName = (cols[7] ?? "").trim();
  const streetAddress = (cols[1] ?? "").trim();
  if (!firstName && !lastName && !streetAddress) return null;
  return {
    permitAppliedDate: parseDate((cols[0] ?? "").trim()),
    streetAddress,
    city: (cols[2] ?? "").trim(),
    zipCode: (cols[3] ?? "").trim(),
    county: (cols[4] ?? "").trim(),
    homeValue: parseHomeValue((cols[5] ?? "").trim()),
    firstName,
    lastName,
    phones: parsePhones(cols),
    emails: parseEmails(cols),
    projectDescription: (cols[37] ?? "").trim() || undefined,
    parcelId: (cols[38] ?? "").trim() || undefined,
    externalId: (cols[39] ?? "").trim() || undefined,
    sent: false,
  };
};

declare const Assets: {
  getTextAsync: (path: string) => Promise<string | undefined>;
};

const IMPORT_CANDIDATES = ["dataset.csv", "example.csv"] as const;
const INSERT_BATCH = 1000;

const loadImportSource = async (): Promise<
  { name: string; text: string } | null
> => {
  for (const name of IMPORT_CANDIDATES) {
    try {
      const text = await Assets.getTextAsync(name);
      if (text && text.length > 0) return { name, text };
    } catch {
      // Asset missing — try the next candidate.
    }
  }
  return null;
};

const importIfEmpty = async () => {
  const existing = await DatasetRecordsCollection.find().countAsync();
  if (existing > 0) {
    console.log(`[import] skipped — ${existing} records already present`);
    return;
  }

  const source = await loadImportSource();
  if (!source) {
    console.log(
      `[import] skipped — no CSV found in private/ (looked for: ${IMPORT_CANDIDATES.join(", ")})`,
    );
    return;
  }

  const started = Date.now();
  const rows = parseCsv(source.text);
  const [, ...dataRows] = rows;
  const docs = dataRows
    .map(rowToRecord)
    .filter((d): d is Omit<DatasetRecord, "_id"> => d !== null);

  console.log(
    `[import] ${source.name}: parsed ${docs.length} records, inserting in batches of ${INSERT_BATCH}…`,
  );

  const raw = DatasetRecordsCollection.rawCollection();
  let inserted = 0;
  for (let i = 0; i < docs.length; i += INSERT_BATCH) {
    const batch = docs.slice(i, i + INSERT_BATCH).map((d) => ({
      _id: Random.id(),
      ...d,
    }));
    await raw.insertMany(batch, { ordered: false });
    inserted += batch.length;
    if (inserted % (INSERT_BATCH * 10) === 0 || inserted === docs.length) {
      console.log(`[import]   ${inserted}/${docs.length}`);
    }
  }

  console.log(
    `[import] done — inserted ${inserted} records from ${source.name} in ${Date.now() - started}ms`,
  );
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const FilterSchema = z.object({
  includeSent: z.boolean().default(false),
  search: z.string().default(""),
  county: z.string().default("all"),
  zipCode: z.string().default(""),
  yearFrom: z.number().int().nullable().default(null),
  yearTo: z.number().int().nullable().default(null),
});
type Filter = z.infer<typeof FilterSchema>;

const ListArgsSchema = FilterSchema.extend({
  sortDir: z.enum(["asc", "desc"]).nullable().default("desc"),
  page: z.number().int().min(0).default(0),
  pageSize: z.number().int().min(1).max(1000).default(50),
});

const buildSelector = (args: Filter): Record<string, unknown> => {
  const selector: Record<string, unknown> = {};
  selector.sent = args.includeSent ? true : { $ne: true };
  if (args.county && args.county !== "all") selector.county = args.county;
  const zip = args.zipCode.trim();
  if (zip) selector.zipCode = new RegExp("^" + escapeRegex(zip));
  if (args.yearFrom !== null || args.yearTo !== null) {
    const range: Record<string, Date> = {};
    if (args.yearFrom !== null) range.$gte = new Date(args.yearFrom, 0, 1);
    if (args.yearTo !== null) range.$lt = new Date(args.yearTo + 1, 0, 1);
    selector.permitAppliedDate = range;
  }
  const search = args.search.trim();
  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    const or: Record<string, unknown>[] = [
      { firstName: re },
      { lastName: re },
      { streetAddress: re },
      { city: re },
      { zipCode: re },
      { projectDescription: re },
      { emails: re },
    ];
    const digits = search.replace(/\D/g, "");
    if (digits.length > 0) or.push({ "phones.number": new RegExp(digits) });
    selector.$or = or;
  }
  return selector;
};

const datasetRecordsModule = createModule("datasetRecords")
  .addPublication(
    "list",
    ListArgsSchema,
    // @ts-expect-error meteor-rpc types declare tuple but resolver receives unwrapped object
    (args: z.infer<typeof ListArgsSchema>) => {
      const selector = buildSelector(args);
      return DatasetRecordsCollection.find(selector, {
        sort: args.sortDir
          ? { permitAppliedDate: args.sortDir === "asc" ? 1 : -1 }
          : undefined,
        skip: args.page * args.pageSize,
        limit: args.pageSize,
      });
    },
  )
  .addMethod("count", FilterSchema, async (args) => {
    return DatasetRecordsCollection.find(buildSelector(args)).countAsync();
  })
  .addMethod("facets", z.object({}), async () => {
    const raw = DatasetRecordsCollection.rawCollection();
    const counties: string[] = (
      await raw.distinct("county")
    ).filter((c): c is string => typeof c === "string" && c.length > 0);
    counties.sort();
    const yearAgg = await raw
      .aggregate<{ _id: number }>([
        { $match: { permitAppliedDate: { $type: "date" } } },
        { $group: { _id: { $year: "$permitAppliedDate" } } },
        { $sort: { _id: -1 } },
      ])
      .toArray();
    const years = yearAgg.map((y) => y._id);
    return { counties, years };
  })
  .addMethod(
    "markAsSent",
    z.object({ ids: z.array(z.string()).min(1) }),
    async ({ ids }) => {
      const now = new Date();
      const updated = await DatasetRecordsCollection.updateAsync(
        { _id: { $in: ids }, sent: { $ne: true } },
        { $set: { sent: true, sentAt: now } },
        { multi: true },
      );
      return { updated };
    },
  )
  .addMethod(
    "sendToGhl",
    z.object({ ids: z.array(z.string()).min(1).max(500) }),
    async ({ ids }) => {
      const cfg = readGhlConfig();
      if (!cfg) {
        throw new Meteor.Error(
          "ghl-not-configured",
          "Meteor.settings.private.ghl missing — need apiToken, locationId, recordIdFieldId",
        );
      }

      const records = (await DatasetRecordsCollection.find({
        _id: { $in: ids },
      }).fetchAsync()) as DatasetRecord[];

      const rows: GhlExportRow[] = [];
      const recordOutcomes = new Map<string, "ok" | "fail" | "skip">();

      for (const r of records) {
        const baseRow = { recordId: r._id! };
        if (r.sent) {
          rows.push({ ...baseRow, outcome: "skipped_already_sent" });
          recordOutcomes.set(r._id!, "skip");
          continue;
        }
        const pairs = buildContactPairs(r);
        if (pairs.length === 0) {
          rows.push({ ...baseRow, outcome: "skipped_no_contact" });
          recordOutcomes.set(r._id!, "skip");
          continue;
        }

        let allOk = true;
        const total = pairs.length;
        for (const pair of pairs) {
          const meta = { ...baseRow, contactIndex: pair.index + 1, total };

          const search = await searchContactByRecordId(cfg, r._id!, pair.index);
          if (!search.ok) {
            rows.push({
              ...meta,
              outcome: "error",
              error: `search ${search.status}: ${search.error}`,
            });
            allOk = false;
            continue;
          }
          if (search.existing && search.contactId) {
            rows.push({
              ...meta,
              outcome: "duplicate",
              contactId: search.contactId,
            });
            continue;
          }

          const payload = buildContactPayload(r, cfg, pair);
          const create = await createContact(cfg, payload);
          if (!create.ok) {
            rows.push({
              ...meta,
              outcome: "error",
              error: `create ${create.status}: ${create.error}`,
            });
            allOk = false;
            continue;
          }

          const noteBody = buildNoteBody(r, pair.index, total);
          const note = await addContactNote(cfg, create.contactId, noteBody);
          if (!note.ok) {
            console.warn(
              `[ghl] note failed for ${create.contactId} (record ${r._id}): ${note.status} ${note.error}`,
            );
          }
          rows.push({
            ...meta,
            outcome: "created",
            contactId: create.contactId,
            noteError: note.ok
              ? undefined
              : `note ${note.status}: ${note.error}`,
          });
        }
        recordOutcomes.set(r._id!, allOk ? "ok" : "fail");
      }

      const toMarkSent = Array.from(recordOutcomes.entries())
        .filter(([, v]) => v === "ok")
        .map(([id]) => id);
      let updated = 0;
      if (toMarkSent.length > 0) {
        updated = await DatasetRecordsCollection.updateAsync(
          { _id: { $in: toMarkSent }, sent: { $ne: true } },
          { $set: { sent: true, sentAt: new Date() } },
          { multi: true },
        );
      }

      const summary = {
        created: rows.filter((r) => r.outcome === "created").length,
        duplicates: rows.filter((r) => r.outcome === "duplicate").length,
        skipped: rows.filter(
          (r) =>
            r.outcome === "skipped_no_contact" ||
            r.outcome === "skipped_already_sent",
        ).length,
        errors: rows.filter((r) => r.outcome === "error").length,
        noteErrors: rows.filter((r) => r.noteError).length,
        recordsMarkedSent: updated,
      };

      return { summary, rows };
    },
  )
  .buildSubmodule();

type GhlExportRow = {
  recordId: string;
  contactIndex?: number;
  total?: number;
  outcome:
    | "created"
    | "duplicate"
    | "skipped_no_contact"
    | "skipped_already_sent"
    | "error";
  contactId?: string;
  noteError?: string;
  error?: string;
};

const formatPhoneForNote = (p: Phone): string => {
  const d = p.number.replace(/\D/g, "");
  const pretty =
    d.length === 10
      ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
      : p.number;
  const type = p.type ? ` [${p.type}]` : "";
  return `${pretty}${type}`;
};

const buildNoteBody = (
  r: DatasetRecord,
  index: number,
  total: number,
): string => {
  const lines: string[] = [];
  lines.push(`Contact ${index + 1} of ${total} — Dataset Browser import`);
  lines.push("");
  lines.push(`Owner: ${r.firstName} ${r.lastName}`.trim());
  const addr = [r.streetAddress, r.city, r.zipCode].filter(Boolean).join(", ");
  if (addr) lines.push(`Site address: ${addr}`);
  if (r.county) lines.push(`County: ${r.county}`);
  if (r.permitAppliedDate) {
    lines.push(`Permit applied: ${new Date(r.permitAppliedDate).toISOString().slice(0, 10)}`);
  }
  if (typeof r.homeValue === "number") {
    lines.push(`Home value: $${r.homeValue.toLocaleString()}`);
  }
  if (r.projectDescription) lines.push(`Project: ${r.projectDescription}`);
  if (r.parcelId) lines.push(`Parcel ID: ${r.parcelId}`);
  if (r.externalId) lines.push(`External ID: ${r.externalId}`);

  const goodPhones = r.phones.filter((p) => !p.dnc);
  const dncCount = r.phones.length - goodPhones.length;
  if (goodPhones.length > 0) {
    lines.push("");
    lines.push(`All phones (${goodPhones.length}):`);
    for (const p of goodPhones) lines.push(`  • ${formatPhoneForNote(p)}`);
  }
  if (dncCount > 0) lines.push(`  (${dncCount} DNC suppressed)`);
  if (r.emails.length > 0) {
    lines.push("");
    lines.push(`All emails (${r.emails.length}):`);
    for (const e of r.emails) lines.push(`  • ${e}`);
  }
  return lines.join("\n");
};

const readGhlConfig = (): GhlConfig | null => {
  const s = (Meteor.settings as { private?: { ghl?: Partial<GhlConfig> } })
    .private?.ghl;
  if (!s?.apiToken || !s.locationId || !s.recordIdFieldId) return null;
  return {
    apiToken: s.apiToken,
    locationId: s.locationId,
    recordIdFieldId: s.recordIdFieldId,
    source: s.source ?? "Dataset Browser",
  };
};

const server = createModule().addSubmodule(datasetRecordsModule).build();

export type Server = typeof server;

Meteor.startup(async () => {
  await importIfEmpty();
});
