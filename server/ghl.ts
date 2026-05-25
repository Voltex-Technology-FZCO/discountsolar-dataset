import type { DatasetRecord, Phone } from "/imports/api/datasetRecords";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export const SOURCE_TAG = "source:ds";
export const EMAIL_TAG = "ds:email";
export const TEXT_TAG = "ds:text";
export const CALL_TAG = "ds:call";

export type GhlConfig = {
  apiToken: string;
  locationId: string;
  recordIdFieldId: string;
  source?: string;
};

export type GhlContactPayload = {
  locationId: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  postalCode?: string;
  source?: string;
  tags?: string[];
  customFields?: Array<{ id: string; field_value: string }>;
};

const headers = (token: string): HeadersInit => ({
  Authorization: `Bearer ${token}`,
  Version: GHL_VERSION,
  Accept: "application/json",
  "Content-Type": "application/json",
});

export const recordIdFieldValue = (recordId: string, index: number) =>
  `${recordId}#${index + 1}`;

const phoneTypeKind = (
  type: string | undefined,
): "mobile" | "landline" | "unknown" => {
  if (!type) return "unknown";
  const t = type.toLowerCase();
  if (t.includes("mobile") || t.includes("cell") || t.includes("wireless"))
    return "mobile";
  if (t.includes("land")) return "landline";
  return "unknown";
};

export const buildTagsForContact = (opts: {
  hasEmail: boolean;
  phone?: Phone;
}): string[] => {
  const tags = new Set<string>([SOURCE_TAG]);
  if (opts.hasEmail) tags.add(EMAIL_TAG);
  if (opts.phone) {
    const kind = phoneTypeKind(opts.phone.type);
    if (kind === "mobile") {
      tags.add(TEXT_TAG);
      tags.add(CALL_TAG);
    } else {
      tags.add(CALL_TAG);
    }
  }
  return Array.from(tags);
};

export type ContactPair = {
  index: number;
  email?: string;
  phone?: Phone;
};

export const buildContactPairs = (rec: DatasetRecord): ContactPair[] => {
  const phones = rec.phones.filter((p) => !p.dnc);
  const emails = rec.emails.filter((e) => e && e.length > 0);
  const total = Math.max(phones.length, emails.length);
  const pairs: ContactPair[] = [];
  for (let i = 0; i < total; i++) {
    pairs.push({ index: i, email: emails[i], phone: phones[i] });
  }
  return pairs;
};

export const buildContactPayload = (
  rec: DatasetRecord,
  cfg: GhlConfig,
  pair: ContactPair,
): GhlContactPayload => {
  const tags = buildTagsForContact({
    hasEmail: Boolean(pair.email),
    phone: pair.phone,
  });
  const fullName = `${rec.firstName} ${rec.lastName}`.trim();
  return {
    locationId: cfg.locationId,
    firstName: rec.firstName || undefined,
    lastName: rec.lastName || undefined,
    name: fullName || undefined,
    email: pair.email,
    phone: pair.phone?.number,
    address1: rec.streetAddress || undefined,
    city: rec.city || undefined,
    postalCode: rec.zipCode || undefined,
    source: cfg.source,
    tags,
    customFields: [
      {
        id: cfg.recordIdFieldId,
        field_value: recordIdFieldValue(rec._id!, pair.index),
      },
    ],
  };
};

export type GhlSearchOutcome =
  | { ok: true; existing: boolean; contactId: string | null }
  | { ok: false; status: number; error: string };

export const searchContactByRecordId = async (
  cfg: GhlConfig,
  recordId: string,
  index: number,
): Promise<GhlSearchOutcome> => {
  const body = {
    locationId: cfg.locationId,
    pageLimit: 1,
    filters: [
      {
        field: `customFields.${cfg.recordIdFieldId}`,
        operator: "eq",
        value: recordIdFieldValue(recordId, index),
      },
    ],
  };
  let res: Response;
  try {
    res = await fetch(`${GHL_BASE}/contacts/search`, {
      method: "POST",
      headers: headers(cfg.apiToken),
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 200) || res.statusText,
    };
  }
  const json = (await res.json().catch(() => ({}))) as {
    contacts?: Array<{ id?: string }>;
  };
  const first = json.contacts?.[0];
  if (first?.id) return { ok: true, existing: true, contactId: first.id };
  return { ok: true, existing: false, contactId: null };
};

export type GhlCreateOutcome =
  | { ok: true; contactId: string }
  | { ok: false; status: number; error: string };

export const createContact = async (
  cfg: GhlConfig,
  payload: GhlContactPayload,
): Promise<GhlCreateOutcome> => {
  let res: Response;
  try {
    res = await fetch(`${GHL_BASE}/contacts/`, {
      method: "POST",
      headers: headers(cfg.apiToken),
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 200) || res.statusText,
    };
  }
  const json = (await res.json().catch(() => ({}))) as {
    contact?: { id?: string };
    id?: string;
  };
  const id = json.contact?.id ?? json.id;
  if (!id) {
    return { ok: false, status: res.status, error: "GHL response missing contact id" };
  }
  return { ok: true, contactId: id };
};

export type GhlNoteOutcome =
  | { ok: true }
  | { ok: false; status: number; error: string };

export const addContactNote = async (
  cfg: GhlConfig,
  contactId: string,
  body: string,
): Promise<GhlNoteOutcome> => {
  let res: Response;
  try {
    res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: headers(cfg.apiToken),
      body: JSON.stringify({ body }),
    });
  } catch (e) {
    return { ok: false, status: 0, error: (e as Error).message };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 200) || res.statusText,
    };
  }
  return { ok: true };
};
