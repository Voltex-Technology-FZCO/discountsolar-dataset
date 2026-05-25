import { Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  Send,
  Search,
  Loader2,
  PhoneOff,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

import {
  visiblePhones,
  visibleEmails,
  type DatasetRecord,
} from "/imports/api/datasetRecords";
import { api } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500, 1000] as const;
const TABLE_COL_COUNT = 9;

type FilterArgs = {
  includeSent: boolean;
  search: string;
  county: string;
  yearFrom: number | null;
  yearTo: number | null;
};

type ListArgs = FilterArgs & {
  sortDir: "asc" | "desc" | null;
  page: number;
  pageSize: number;
};

type SendSummary = {
  created: number;
  duplicates: number;
  skipped: number;
  errors: number;
  noteErrors: number;
  recordsMarkedSent: number;
};

const formatPhone = (n: string) => {
  const d = n.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return n;
};

const formatMoney = (v?: number) =>
  v === undefined ? "—" : `$${v.toLocaleString()}`;

const useDebounced = <T,>(value: T, delay = 300): T => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
};

const RecordsTable = ({
  args,
  selected,
  setSelected,
  yearSort,
  onCycleYearSort,
}: {
  args: ListArgs;
  selected: Set<string>;
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>;
  yearSort: "asc" | "desc" | null;
  onCycleYearSort: () => void;
}) => {
  const { data } = api.datasetRecords.list.usePublication(args);
  const records = (data ?? []) as DatasetRecord[];

  const allPageSelected =
    records.length > 0 && records.every((r) => selected.has(r._id!));

  const togglePageAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) for (const r of records) next.delete(r._id!);
      else for (const r of records) next.add(r._id!);
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              checked={allPageSelected}
              onCheckedChange={togglePageAll}
              aria-label="Select all on this page"
            />
          </TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>
            <button
              type="button"
              onClick={onCycleYearSort}
              className="-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium hover:bg-[var(--color-muted)]"
              aria-label={`Sort by year (${yearSort ?? "none"})`}
            >
              Year
              {yearSort === "asc" ? (
                <ArrowUp className="h-3 w-3" />
              ) : yearSort === "desc" ? (
                <ArrowDown className="h-3 w-3" />
              ) : (
                <ArrowUpDown className="h-3 w-3 opacity-50" />
              )}
            </button>
          </TableHead>
          <TableHead>Address</TableHead>
          <TableHead>County</TableHead>
          <TableHead className="text-right">Home value</TableHead>
          <TableHead>Phones</TableHead>
          <TableHead>Emails</TableHead>
          <TableHead className="w-[36rem] min-w-[24rem]">Project</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={TABLE_COL_COUNT}
              className="py-10 text-center text-sm text-[var(--color-muted-foreground)]"
            >
              No records match your filters.
            </TableCell>
          </TableRow>
        ) : (
          records.map((r) => {
            const id = r._id!;
            const isSelected = selected.has(id);
            const phones = visiblePhones(r);
            const dncCount = r.phones.length - phones.length;
            const emails = visibleEmails(r);
            return (
              <TableRow
                key={id}
                data-state={isSelected ? "selected" : undefined}
              >
                <TableCell>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleOne(id)}
                    aria-label={`Select ${r.firstName} ${r.lastName}`}
                  />
                </TableCell>
                <TableCell className="font-medium whitespace-nowrap">
                  {r.firstName} {r.lastName}
                </TableCell>
                <TableCell className="tabular-nums text-[var(--color-muted-foreground)]">
                  {r.permitAppliedDate
                    ? new Date(r.permitAppliedDate).getFullYear()
                    : "—"}
                </TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  {r.streetAddress},{" "}
                  <span className="text-[var(--color-muted-foreground)]">
                    {r.city}, {r.zipCode}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{r.county}</Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(r.homeValue)}
                </TableCell>
                <TableCell className="text-sm max-w-0">
                  <div className="flex items-center gap-2">
                    {phones.length === 0 ? (
                      <span className="text-[var(--color-muted-foreground)]">
                        —
                      </span>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="truncate tabular-nums cursor-default">
                            {phones
                              .map((p) => formatPhone(p.number))
                              .join(", ")}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="flex flex-col gap-0.5 tabular-nums">
                            {phones.map((p, i) => (
                              <span key={i}>
                                {formatPhone(p.number)}
                                {p.type ? (
                                  <span className="ml-2 text-[var(--color-muted-foreground)]">
                                    {p.type}
                                  </span>
                                ) : null}
                              </span>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {dncCount > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex shrink-0 cursor-default items-center gap-1 text-xs text-[var(--color-muted-foreground)]">
                            <PhoneOff className="h-3 w-3" />
                            {dncCount}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          {dncCount} DNC number
                          {dncCount === 1 ? "" : "s"} hidden
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm max-w-0">
                  {emails.length === 0 ? (
                    <span className="text-[var(--color-muted-foreground)]">
                      —
                    </span>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block truncate cursor-default">
                          {emails.join(", ")}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="flex flex-col gap-0.5">
                          {emails.map((e) => (
                            <span key={e}>{e}</span>
                          ))}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell className="text-sm text-[var(--color-muted-foreground)] max-w-0">
                  {r.projectDescription ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block truncate cursor-default">
                          {r.projectDescription}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{r.projectDescription}</TooltipContent>
                    </Tooltip>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
};

const TableSkeleton = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead colSpan={TABLE_COL_COUNT} className="h-10" />
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell
          colSpan={TABLE_COL_COUNT}
          className="py-10 text-center text-sm text-[var(--color-muted-foreground)]"
        >
          <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
);

export const DatasetBrowser = () => {
  const [includeSent, setIncludeSent] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput, 300);
  const [county, setCounty] = useState<string>("all");
  const [yearFrom, setYearFrom] = useState<string>("");
  const [yearTo, setYearTo] = useState<string>("");
  const [yearSort, setYearSort] = useState<"asc" | "desc" | null>("desc");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(50);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<SendSummary | null>(null);
  const queryClient = useQueryClient();

  const filterArgs: FilterArgs = {
    includeSent,
    search,
    county,
    yearFrom: yearFrom ? Number(yearFrom) : null,
    yearTo: yearTo ? Number(yearTo) : null,
  };

  useEffect(() => {
    setPage(0);
  }, [includeSent, search, county, yearFrom, yearTo, pageSize, yearSort]);

  const listArgs: ListArgs = { ...filterArgs, sortDir: yearSort, page, pageSize };

  const { data: total = 0 } = useQuery<number>({
    queryKey: ["datasetRecords.count", filterArgs],
    queryFn: () => api.datasetRecords.count(filterArgs) as Promise<number>,
    placeholderData: keepPreviousData,
  });

  const { data: facets = { counties: [], years: [] } } = useQuery<{
    counties: string[];
    years: number[];
  }>({
    queryKey: ["datasetRecords.facets"],
    queryFn: () =>
      api.datasetRecords.facets({}) as Promise<{
        counties: string[];
        years: number[];
      }>,
    staleTime: 5 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (page > 0 && page >= totalPages) setPage(totalPages - 1);
  }, [page, totalPages]);

  const handleSend = async () => {
    if (selected.size === 0) return;
    setSending(true);
    try {
      const ids = Array.from(selected);
      const res = (await api.datasetRecords.sendToGhl({ ids })) as {
        summary: SendSummary;
        rows: Array<{
          recordId: string;
          outcome: string;
          error?: string;
          noteError?: string;
        }>;
      };
      console.log("ghl send result", res);
      setLastResult(res.summary);
      const okIds = new Set(
        res.rows
          .filter((r) => r.outcome === "created" || r.outcome === "duplicate")
          .map((r) => r.recordId),
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of okIds) next.delete(id);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ["datasetRecords.count"] });
      if (res.summary.errors > 0) {
        const firstErr = res.rows.find((r) => r.outcome === "error");
        console.error("GHL errors", res.rows.filter((r) => r.outcome === "error"));
        alert(
          `Sent with ${res.summary.errors} error(s). First: ${firstErr?.error ?? ""}`,
        );
      }
    } catch (e) {
      console.error(e);
      alert(`Failed to send: ${(e as Error).message}`);
    } finally {
      setSending(false);
    }
  };

  const cycleYearSort = () =>
    setYearSort((s) => (s === "desc" ? "asc" : s === "asc" ? null : "desc"));

  const firstRow = total === 0 ? 0 : page * pageSize + 1;
  const lastRow = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="w-full space-y-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Dataset Browser
        </h1>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          Permit records with owner contact info. DNC-flagged phones are
          suppressed from view and export.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>
            Narrow the list before selecting records.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="filter">Search</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                id="filter"
                placeholder="name, address, email, phone…"
                className="pl-8"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="county">County</Label>
            <Select value={county} onValueChange={setCounty}>
              <SelectTrigger id="county">
                <SelectValue placeholder="All counties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All counties</SelectItem>
                {facets.counties.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Year range</Label>
            <div className="flex items-center gap-2">
              <Select
                value={yearFrom || "any"}
                onValueChange={(v) => setYearFrom(v === "any" ? "" : v)}
              >
                <SelectTrigger aria-label="Year from">
                  <SelectValue placeholder="From" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">From (any)</SelectItem>
                  {facets.years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-[var(--color-muted-foreground)]">–</span>
              <Select
                value={yearTo || "any"}
                onValueChange={(v) => setYearTo(v === "any" ? "" : v)}
              >
                <SelectTrigger aria-label="Year to">
                  <SelectValue placeholder="To" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">To (any)</SelectItem>
                  {facets.years.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Visibility</Label>
            <div className="flex h-9 items-center gap-2">
              <Checkbox
                id="includeSent"
                checked={includeSent}
                onCheckedChange={(v) => setIncludeSent(Boolean(v))}
              />
              <Label htmlFor="includeSent" className="cursor-pointer">
                Show only already-sent records
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div className="text-sm text-[var(--color-muted-foreground)]">
          {total === 0 ? (
            "0 records"
          ) : (
            <>
              <span className="font-medium text-[var(--color-foreground)]">
                {firstRow.toLocaleString()}–{lastRow.toLocaleString()}
              </span>{" "}
              of{" "}
              <span className="font-medium text-[var(--color-foreground)]">
                {total.toLocaleString()}
              </span>{" "}
              records
            </>
          )}{" "}
          · {selected.size} selected
        </div>
        <div className="flex items-center gap-3">
          {lastResult && (
            <div className="text-xs text-[var(--color-muted-foreground)] tabular-nums">
              Last send: {lastResult.created} created · {lastResult.duplicates} dup ·{" "}
              {lastResult.errors} error · {lastResult.noteErrors} note-fail ·{" "}
              {lastResult.recordsMarkedSent} marked sent
            </div>
          )}
          <Button onClick={handleSend} disabled={selected.size === 0 || sending}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Send selected
          </Button>
        </div>
      </div>

      <Card>
        <Suspense fallback={<TableSkeleton />}>
          <RecordsTable
            args={listArgs}
            selected={selected}
            setSelected={setSelected}
            yearSort={yearSort}
            onCycleYearSort={cycleYearSort}
          />
        </Suspense>
      </Card>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm">
          <Label htmlFor="pageSize" className="text-[var(--color-muted-foreground)]">
            Rows per page
          </Label>
          <Select
            value={String(pageSize)}
            onValueChange={(v) => setPageSize(Number(v))}
          >
            <SelectTrigger id="pageSize" className="h-8 w-[80px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span className="text-[var(--color-muted-foreground)]">
            Page{" "}
            <span className="font-medium text-[var(--color-foreground)]">
              {page + 1}
            </span>{" "}
            of {totalPages.toLocaleString()}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(0)}
              disabled={page === 0}
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPage(totalPages - 1)}
              disabled={page >= totalPages - 1}
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
