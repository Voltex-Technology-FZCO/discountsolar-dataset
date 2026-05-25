import { Mongo } from "meteor/mongo";
import { z } from "zod";

export const PhoneSchema = z.object({
  number: z.string(),
  carrier: z.string().optional(),
  type: z.string().optional(),
  dnc: z.boolean().default(false),
});

export type Phone = z.infer<typeof PhoneSchema>;

export const DatasetRecordSchema = z.object({
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

export type DatasetRecord = z.infer<typeof DatasetRecordSchema>;

export const DatasetRecordsCollection = new Mongo.Collection<DatasetRecord>(
  "datasetRecords",
);

export const visiblePhones = (r: { phones: Phone[] }) =>
  r.phones.filter((p) => !p.dnc);

export const visibleEmails = (r: { emails: string[] }) =>
  r.emails.filter((e) => e.length > 0);
