// =============================================================================
// soaGridParser — pure: parse Reducto's Schedule-of-Assessments HTML <table>
// grids into per-visit procedure checklists, deterministically and verbatim.
//
// Reducto returns the SoA as HTML table block(s) (rows = procedures, columns =
// visits, cells = "X"). We read the grid directly — for each visit column, the
// procedure rows whose cell is marked — instead of asking an LLM to rebuild the
// schedule (which collapses non-deterministically). Verified on 2 protocols.
//
// Handles: footnote superscripts on labels, multi-line <td>, rowspan/colspan
// (full grid expansion), conditional "(X)" marks, and merge/dedup of visits
// that recur across continuation-page tables. A-guards (per-cell classification,
// self-consistency counts, table-selection scoring) live here so the caller can
// grade confidence and decide fallback. Pure, no I/O, vitest-importable.
// =============================================================================

import { canonicalVisitName } from "./visitNameNormalize.ts";

export type CellMark = "marked" | "conditional" | "empty" | "uncertain";

export interface SoaProcedure {
  /** Verbatim procedure label, trailing footnote superscripts stripped. */
  label: string;
  /** Cell text beyond the mark (e.g. "before IMP infusion"), or null. */
  note: string | null;
  /** marked = scheduled; conditional = "(X)" → needs_review; uncertain → needs_review. */
  mark: CellMark;
}

export interface SoaVisit {
  /** Canonical visit name (Screening, Treatment Visit 1, Assessment Visit Month 9…). */
  visit_name: string;
  /** Verbatim column-header text (for traceability). */
  raw_header: string;
  /** Parsed from the header (Day N; Week N×7; Month N×30; "N days prior" → −N); null if unknown. */
  study_day: number | null;
  window_minus_days: number;
  window_plus_days: number;
  procedures: SoaProcedure[];
  /** PDF pages of the SoA table(s) this visit's column came from (for citations). */
  source_pages: number[];
  /**
   * Left-to-right column position across the SoA table(s), in page order — the
   * protocol's own visit sequence. Downstream orders Visit Prep by this so visits
   * render "the way they are in the protocol", which study_day alone gets wrong
   * (e.g. an EOT dated "Day 14 after last cycle" must not sort next to Day-14 TV2).
   */
  column_order: number;
}

export interface SoaGridResult {
  visits: SoaVisit[];
  guards: {
    soaTablesFound: number;
    nonSoaTablesSkipped: number;
    rawMarkCount: number; // mark-bearing cells seen across SoA grids
    emittedMarkCount: number; // (visit, procedure) marks emitted
    unresolvedSpans: number; // rowspan/colspan cells we couldn't place cleanly
    emptyVisitColumns: number; // visit columns parsed with zero procedures (alignment failure)
    lowConfidence: boolean; // self-consistency mismatch or no SoA tables
    notes: string[];
  };
}

export interface TableBlock {
  content: string;
  page?: number | null;
  /** Section heading the table sits under (e.g. "SYNOPSIS", "Schedule of
   * Activities"). Lets the LLM grouper drop synopsis/TOC restatements. Optional. */
  section?: string | null;
}

// --- text helpers ------------------------------------------------------------

function stripTags(s: string): string {
  return (s ?? "").replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, " ") // drop footnote superscripts
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");
}

function clean(s: string): string {
  return stripTags(s)
    .replace(/\s+/g, " ")
    // rejoin Reducto soft-wrap hyphenation ("Rando- mization" → "Randomization");
    // legit hyphenated terms ("EQ-5D-5L", "GOG-NTX-13") have no space after the hyphen.
    .replace(/([a-z])-\s+([a-z])/g, "$1$2")
    .trim();
}

/** Strip a trailing footnote marker that survived as plain digits/symbols on a label. */
function stripTrailingFootnote(label: string): string {
  // Reducto renders footnote superscripts as literal unicode superscript chars
  // ("Neurological Exam¹º") — always safe to drop a trailing run of them.
  let s = label.replace(/[ª²³¹º⁰-⁹]+$/g, "").trim();
  // Also strip a SHORT trailing ASCII digit run that's a footnote ref, but not
  // when it's part of the name ("Treatment Visit 1", "EQ-5D-5L", "FACT/GOG-NTX-13").
  s = s.replace(/(?<=[a-z)\]])\s*\d{1,2}$/i, (m) => (/visit|cycle|week|month|day|ntx|updrs|5l|5d/i.test(s) ? m : "")).trim();
  return s;
}

// --- mark classification (A-guards: explicit, never guess) -------------------

/** A note that is just a footnote ref number (no real timing/condition text) is dropped. */
function noteOrNull(s: string): string | null {
  const n = s.replace(/[ª²³¹º⁰-⁹]+/g, "").trim();
  return !n || /^\d{1,2}$/.test(n) ? null : n;
}

// Unambiguous "scheduled" mark glyphs (NOT the ASCII letter x — that needs word
// boundaries so a note like "max" / "6x" isn't read as a mark). Validated across
// 5 sponsor protocols: PledOx uses X, CLR uses × (U+00D7), BLKR201 uses → (a span
// arrow), others use ✓/●. The set is broad on purpose; self-consistency
// (emitted vs detected marks) flags any glyph still missed instead of silently
// dropping it.
const MARK_GLYPHS = "×✓✔✗✕✘●•○◯■□√→⟶➔➝⇒⟵↔☑☒";
const GLYPH_RE = new RegExp(`[${MARK_GLYPHS}]`, "u");

export function classifyMark(cellText: string): { mark: CellMark; note: string | null } {
  const t = clean(cellText);
  if (!t) return { mark: "empty", note: null };
  // Parenthesized mark → conditional (e.g. "(X)" / "(×)" — perform only if a condition holds).
  if (/\(\s*[x×✓✔]\s*\)/i.test(t)) {
    return { mark: "conditional", note: noteOrNull(t.replace(/\(\s*[x×✓✔]\s*\)/i, "").replace(/^\d+\s*/, "")) };
  }
  // A clear mark glyph anywhere, or a standalone "x"/"yes" → marked; the remaining
  // text is the note (timing etc.).
  if (GLYPH_RE.test(t) || /(^|\s)x(\s|$)/i.test(t) || /^x\b/i.test(t) || /^(yes|y)$/i.test(t)) {
    const note = t.replace(GLYPH_RE, " ").replace(/(^|\s)x(\s|$)/ig, " ").replace(/^\d+\s*/, "");
    return { mark: "marked", note: noteOrNull(note) };
  }
  // Non-empty but no recognizable mark — don't guess; flag for review.
  return { mark: "uncertain", note: t };
}

/** True if any column>0 cell in this row is a scheduled/conditional mark. Used for
 * STRUCTURAL header-band detection: the header band is the run of leading rows
 * with no marks (visit-name / day / window rows carry no X); the first row with a
 * mark is the first procedure row. Vocabulary-free — works for "Study Day" /
 * "Study Visits" / non-English label columns the old keyword test missed. */
function rowHasMark(row: string[] | undefined): boolean {
  if (!row) return false;
  for (let c = 1; c < row.length; c++) {
    const m = classifyMark(row[c] ?? "").mark;
    if (m === "marked" || m === "conditional") return true;
  }
  return false;
}

// --- HTML table → 2-D grid (expands colspan, carries rowspan) ----------------

function attrInt(attrs: string, name: string): number {
  const m = attrs.match(new RegExp(`${name}\\s*=\\s*"?(\\d+)`, "i"));
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
}

interface GridParse {
  grid: string[][];
  unresolvedSpans: number;
}

function htmlTableToGrid(tableHtml: string): GridParse {
  const trs = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const grid: string[][] = [];
  // active[col] = a rowspan carrying down into following rows.
  const active: Array<{ text: string; rows: number } | null> = [];
  let unresolvedSpans = 0;

  for (const tr of trs) {
    const cells = [...tr.matchAll(/<(t[dh])([^>]*)>([\s\S]*?)<\/\1>/gi)].map((m) => ({
      attrs: m[2],
      text: clean(m[3]),
    }));
    const row: string[] = [];
    let ci = 0;
    let col = 0;
    const safetyMax = 200;
    while ((ci < cells.length || active.some((a) => a && a.rows > 0)) && col < safetyMax) {
      if (active[col] && active[col]!.rows > 0) {
        row[col] = active[col]!.text;
        active[col]!.rows -= 1;
        col += 1;
        continue;
      }
      if (ci >= cells.length) break;
      const cell = cells[ci++];
      const cs = attrInt(cell.attrs, "colspan");
      const rs = attrInt(cell.attrs, "rowspan");
      if (cs > 1 || rs > 1) unresolvedSpans += 0; // expansion below resolves them
      for (let k = 0; k < cs; k++) {
        row[col] = cell.text;
        if (rs > 1) active[col] = { text: cell.text, rows: rs - 1 };
        col += 1;
      }
    }
    // normalize row length to current width
    grid.push(row);
  }
  return { grid, unresolvedSpans };
}

// --- visit-header parsing ----------------------------------------------------

const VISIT_PATTERNS: Array<{ re: RegExp; name: (m: RegExpMatchArray) => string }> = [
  { re: /\bscreening\b/i, name: () => "Screening" },
  { re: /\brando\w*/i, name: () => "Randomization" },
  { re: /treatment\s*visit\s*(\d+)/i, name: (m) => `Treatment Visit ${m[1]}` },
  { re: /\beot\b|end[\s-]*of[\s-]*treatment/i, name: () => "EOT Visit" },
  { re: /\beos\b|end[\s-]*of[\s-]*study/i, name: () => "EOS Visit" },
  { re: /(?:assessment\s*(?:visit\s*)?)?month\s*(\d+)/i, name: (m) => `Assessment Visit Month ${m[1]}` },
  { re: /baseline/i, name: () => "Baseline" },
  { re: /\bvisit\s*(\d+)\b/i, name: (m) => `Visit ${m[1]}` },
];

/**
 * Reducto renders footnote superscripts inline, gluing them onto the preceding
 * number ("Month 6" + footnote "11" → "Month 611"). Footnotes are small (1–12)
 * and append, and real time-units fall under a unit cap, so strip trailing
 * digits until the value is plausible. Returns [value, wasCapped].
 */
function capTimeUnit(n: number, max: number): [number, boolean] {
  let v = n;
  let capped = false;
  while (v > max && v >= 10) {
    v = Math.floor(v / 10);
    capped = true;
  }
  return [v, capped];
}

/** Is this (composite) header cell a visit column vs the label column? */
function looksLikeVisit(header: string): boolean {
  const t = clean(header);
  if (!t) return false;
  // the label column / structural header — never a visit
  if (/^visit$|visit\s*window|visit\s*name|^assessment$|^procedures?$|days,?\s*if\s*applicable/i.test(t)) {
    return false;
  }
  return VISIT_PATTERNS.some((p) => p.re.test(t)) || /\bv\d+\b/i.test(t);
}

export function parseVisitHeader(header: string): {
  visit_name: string;
  study_day: number | null;
  window_minus_days: number;
  window_plus_days: number;
  footnoteCapped: boolean;
} {
  const raw = clean(header);
  let footnoteCapped = false;
  let visit_name = raw;
  for (const p of VISIT_PATTERNS) {
    const m = raw.match(p.re);
    if (m) {
      // "Assessment Visit Month N" carries a number that can be footnote-glued.
      if (/month/i.test(p.re.source) && m[1]) {
        const [mo, capped] = capTimeUnit(parseInt(m[1], 10), 60);
        footnoteCapped = footnoteCapped || capped;
        visit_name = `Assessment Visit Month ${mo}`;
      } else {
        visit_name = p.name(m);
      }
      break;
    }
  }
  visit_name = canonicalVisitName(visit_name);

  // study_day: the treatment-visit headers carry an intra-cycle "Day 1" plus the
  // real timeline anchor as "Week N"/"Month N", so prefer Week → Month → Day.
  let study_day: number | null = null;
  let m: RegExpMatchArray | null;
  if ((m = raw.match(/\bweek\s*([+-]?\d+)\b/i))) {
    const [w, c] = capTimeUnit(parseInt(m[1], 10), 300);
    footnoteCapped = footnoteCapped || c;
    study_day = w * 7;
  } else if ((m = raw.match(/\bmonth\s*(\d+)\b/i))) {
    const [mo, c] = capTimeUnit(parseInt(m[1], 10), 60);
    footnoteCapped = footnoteCapped || c;
    study_day = mo * 30;
  } else if ((m = raw.match(/\bday\s*([+-]?\d+)\b/i))) {
    study_day = parseInt(m[1], 10);
  } else if ((m = raw.match(/(\d+)\s*days?\s*prior/i))) {
    study_day = -parseInt(m[1], 10);
  } else if (/screening/i.test(raw)) study_day = -28;
  else if (/rando/i.test(raw)) study_day = -1;

  // window: "±N days" / "±N week".
  let window_minus_days = 0;
  let window_plus_days = 0;
  if ((m = raw.match(/[±]\s*(\d+)\s*(day|week)/i))) {
    const n = parseInt(m[1], 10) * (/week/i.test(m[2]) ? 7 : 1);
    window_minus_days = n;
    window_plus_days = n;
  }
  return { visit_name, study_day, window_minus_days, window_plus_days, footnoteCapped };
}

// --- header band -------------------------------------------------------------

/**
 * A header-band row's label column is empty or structural ("Visit", "Visit
 * Window", "(±2 days, if applicable)", "Day 1,", "Cycle 7", "Week 12", "Month
 * 3") — i.e. NOT a real procedure label. The band is the run of leading rows for
 * which col0 is header-band-ish; the first real procedure row ends it. This
 * folds Reducto's multi-row visit headers (name in the <th> row, scheduling in
 * the rows below) into one composite header per column.
 */
function isHeaderBandLabel(s: string): boolean {
  const t = clean(s);
  if (!t) return true;
  return /^visit\b|visit\s*window|visit\s*name|^assessment$|^procedures?$|days,?\s*if\s*applicable|^\(?±|^day\b|^cycle\b|^week\b|^month\b/i.test(t);
}

function headerBandHeight(grid: string[][]): number {
  // STRUCTURAL: the band is the leading run of rows with no marks (header rows
  // carry visit names/days/windows, never X). Vocabulary-free, so it works for
  // "Study Day"/"Study Visits"/non-English label columns. Falls back to the old
  // keyword scan only if the structural scan finds no band (defensive).
  let h = 0;
  while (h < grid.length && h < 10 && !rowHasMark(grid[h])) h += 1;
  if (h === 0) { while (h < grid.length && h < 8 && isHeaderBandLabel(grid[h][0] ?? "")) h += 1; }
  return h;
}

/** Join the header-band cells of one column into a single composite header. */
function compositeHeader(grid: string[][], col: number, bandHeight: number): string {
  const parts: string[] = [];
  for (let r = 0; r < bandHeight; r++) {
    const t = clean(grid[r][col] ?? "");
    if (t && !parts.includes(t)) parts.push(t);
  }
  return parts.join(" ");
}

// --- main --------------------------------------------------------------------

/**
 * Parse SoA HTML table block(s) into per-visit checklists. Tables whose header
 * band doesn't enumerate ≥2 visit columns are skipped (scoring). Visits
 * recurring across continuation-page tables merge by canonical identity (the
 * union of their procedures).
 */
export function parseSoaGrid(tables: readonly TableBlock[]): SoaGridResult {
  const byKey = new Map<string, SoaVisit>();
  let columnCursor = 0; // global left-to-right, page-order visit position
  const guards = {
    soaTablesFound: 0,
    nonSoaTablesSkipped: 0,
    rawMarkCount: 0,
    emittedMarkCount: 0,
    unresolvedSpans: 0,
    emptyVisitColumns: 0,
    lowConfidence: false,
    notes: [] as string[],
  };

  for (const tb of tables) {
    if (typeof tb?.content !== "string" || !/<tr/i.test(tb.content)) continue;
    const { grid, unresolvedSpans } = htmlTableToGrid(tb.content);
    guards.unresolvedSpans += unresolvedSpans;
    if (grid.length < 2) continue;

    const band = headerBandHeight(grid);
    if (band < 1 || band >= grid.length) {
      guards.nonSoaTablesSkipped += 1;
      continue;
    }
    const width = Math.max(...grid.map((r) => r.length));

    // table-selection scoring: visit columns are indices ≥1 whose composite
    // header looks like a visit.
    const colMeta = new Map<number, ReturnType<typeof parseVisitHeader>>();
    for (let c = 1; c < width; c++) {
      const comp = compositeHeader(grid, c, band);
      if (looksLikeVisit(comp)) colMeta.set(c, parseVisitHeader(comp));
    }
    if (colMeta.size < 2) {
      guards.nonSoaTablesSkipped += 1;
      continue;
    }
    guards.soaTablesFound += 1;

    // Pre-register each visit column in left-to-right order BEFORE scanning rows,
    // so column_order reflects the protocol's own sequence (not first-marked-cell
    // order). The same column recurring across continuation tables merges by
    // canonical name and keeps its first column_order.
    for (const [c, meta] of colMeta) {
      const key = meta.visit_name.toLowerCase();
      let visit = byKey.get(key);
      if (!visit) {
        visit = {
          visit_name: meta.visit_name,
          raw_header: compositeHeader(grid, c, band),
          study_day: meta.study_day,
          window_minus_days: meta.window_minus_days,
          window_plus_days: meta.window_plus_days,
          procedures: [],
          source_pages: [],
          column_order: columnCursor++,
        };
        byKey.set(key, visit);
      } else if (visit.study_day == null && meta.study_day != null) {
        visit.study_day = meta.study_day; // backfill from a richer continuation header
      }
      if (typeof tb.page === "number" && !visit.source_pages.includes(tb.page)) {
        visit.source_pages.push(tb.page);
      }
      if (meta.footnoteCapped && !guards.notes.includes("footnote-glued header number corrected")) {
        guards.notes.push("footnote-glued header number corrected");
      }
    }

    for (let r = band; r < grid.length; r++) {
      const rowLabel = stripTrailingFootnote(clean(grid[r][0] ?? ""));
      if (!rowLabel) continue;
      for (const [c, meta] of colMeta) {
        const raw = grid[r][c] ?? "";
        if (/[x✓●•]/i.test(clean(raw))) guards.rawMarkCount += 1; // self-consistency tally
        const { mark, note } = classifyMark(raw);
        if (mark === "empty") continue;
        const visit = byKey.get(meta.visit_name.toLowerCase())!; // pre-registered above
        // dedup procedure within a visit (rows recur across continuation tables)
        if (!visit.procedures.some((p) => p.label.toLowerCase() === rowLabel.toLowerCase())) {
          visit.procedures.push({ label: rowLabel, note, mark });
          guards.emittedMarkCount += 1;
        }
      }
    }
  }

  guards.emptyVisitColumns = [...byKey.values()].filter((v) => v.procedures.length === 0).length;
  const visits = [...byKey.values()].filter((v) => v.procedures.length > 0);
  // self-consistency: emitted marks should be within a sane band of raw marks
  // (raw counts only literal X; conditional/✓ differ, so allow generous slack).
  if (guards.soaTablesFound === 0) {
    guards.lowConfidence = true;
    guards.notes.push("no SoA grid table found");
  } else if (guards.rawMarkCount > 0 && guards.emittedMarkCount < guards.rawMarkCount * 0.5) {
    guards.lowConfidence = true;
    guards.notes.push(`emitted ${guards.emittedMarkCount} marks vs ${guards.rawMarkCount} raw — possible lossy parse`);
  }
  return { visits, guards };
}

// =============================================================================
// HYBRID PATH — extract every visit COLUMN deterministically (complete + verbatim),
// for an LLM to GROUP into visits (see ingestPipeline.groupSoaColumnsViaLlm). The
// LLM is handed only the column headers (never cells), so it cannot under-read or
// invent — this side owns completeness + self-consistency; the LLM owns grouping.
// =============================================================================

export interface RawColumn {
  /** Stable index, left-to-right across all SoA tables in page order. */
  idx: number;
  /** Verbatim composite column header (header-band rows joined). */
  header: string;
  page: number | null;
  /** Section heading the source table sits under (lets the grouper drop synopsis/TOC). */
  section: string;
  /** Verbatim marked procedure row-labels for this column (deterministic). */
  procedures: SoaProcedure[];
  /** Number of marked/conditional procedures (== procedures.length; for the grouper's proc_count). */
  markCount: number;
}

export interface RawColumnsResult {
  columns: RawColumn[];
  guards: {
    soaTablesFound: number;
    nonSoaTablesSkipped: number;
    rawMarkCount: number;
    emittedMarkCount: number;
    selfConsistency: number; // emitted / max(1, rawMarkCount); <0.95 → flag
    notes: string[];
  };
}

const MIN_MARKS_PER_COLUMN = 2;
const COLUMN_MARK_PURITY = 0.6;

/**
 * Extract every visit column from the SoA table(s) by MARK DENSITY (vocabulary-
 * free, so it works for any naming/language): a column is a visit if ≥2 of its
 * body cells are marks AND ≥60% of its non-empty body cells are marks. Emits one
 * RawColumn per qualifying column per table — NOT merged by name (grouping/dedup
 * is the LLM's job). Self-consistency = emitted marks / detected marks.
 */
export function extractRawColumns(tables: readonly TableBlock[]): RawColumnsResult {
  const columns: RawColumn[] = [];
  const guards = {
    soaTablesFound: 0,
    nonSoaTablesSkipped: 0,
    rawMarkCount: 0,
    emittedMarkCount: 0,
    selfConsistency: 1,
    notes: [] as string[],
  };
  let idx = 0;

  for (const tb of tables) {
    if (typeof tb?.content !== "string" || !/<tr/i.test(tb.content)) continue;
    const { grid } = htmlTableToGrid(tb.content);
    if (grid.length < 2) continue;
    const band = headerBandHeight(grid);
    if (band < 1 || band >= grid.length) { guards.nonSoaTablesSkipped += 1; continue; }
    const width = Math.max(...grid.map((r) => r.length));

    // procedure rows = body rows whose col0 is a real label (not a stray sub-header)
    const bodyRows: number[] = [];
    for (let r = band; r < grid.length; r++) {
      const label = clean(grid[r][0] ?? "");
      if (label && !isHeaderBandLabel(label)) bodyRows.push(r);
    }

    // classify each column>0 by mark density, with a named-visit rescue for sparse columns
    const visitCols: number[] = [];
    for (let c = 1; c < width; c++) {
      let marks = 0;
      let nonEmpty = 0;
      for (const r of bodyRows) {
        if (clean(grid[r][c] ?? "")) nonEmpty += 1;
        const m = classifyMark(grid[r][c] ?? "").mark;
        if (m === "marked" || m === "conditional") marks += 1;
      }
      const purity = nonEmpty > 0 ? marks / nonEmpty : 0;
      const dense = marks >= MIN_MARKS_PER_COLUMN && purity >= COLUMN_MARK_PURITY;
      // Rescue a sparse but clearly-named visit column (e.g. "Randomization — not a
      // patient visit" marks only 1 procedure) that mark-density alone would drop.
      // Mark-density stays the primary, vocabulary-free signal; this only ADDS real
      // visits it misses, and the LLM grouper still drops anything that isn't one.
      const namedSparse = marks >= 1 && purity >= 0.5 && looksLikeVisit(compositeHeader(grid, c, band));
      if (dense || namedSparse) visitCols.push(c);
    }
    if (visitCols.length < 2) { guards.nonSoaTablesSkipped += 1; continue; } // not an SoA grid
    guards.soaTablesFound += 1;

    for (const c of visitCols) {
      const procedures: SoaProcedure[] = [];
      for (const r of bodyRows) {
        const cell = grid[r][c] ?? "";
        if (GLYPH_RE.test(clean(cell)) || /(^|\s)x(\s|$)/i.test(clean(cell))) guards.rawMarkCount += 1; // self-consistency tally
        const rowLabel = stripTrailingFootnote(clean(grid[r][0] ?? ""));
        if (!rowLabel) continue;
        const { mark, note } = classifyMark(cell);
        if (mark === "empty" || mark === "uncertain") continue;
        if (!procedures.some((p) => p.label.toLowerCase() === rowLabel.toLowerCase())) {
          procedures.push({ label: rowLabel, note, mark });
          guards.emittedMarkCount += 1;
        }
      }
      columns.push({
        idx: idx++,
        header: compositeHeader(grid, c, band) || `(unlabeled column ${c}, p${tb.page ?? "?"})`,
        page: typeof tb.page === "number" ? tb.page : null,
        section: typeof tb.section === "string" ? tb.section : "",
        procedures,
        markCount: procedures.length,
      });
    }
  }

  guards.selfConsistency = guards.rawMarkCount > 0 ? Math.min(1, guards.emittedMarkCount / guards.rawMarkCount) : 1;
  if (guards.soaTablesFound === 0) guards.notes.push("no SoA grid table found");
  if (guards.selfConsistency < 0.95) {
    guards.notes.push(`self-consistency ${guards.selfConsistency.toFixed(2)} — possible lossy parse / unknown mark glyph`);
  }
  return { columns, guards };
}

// =============================================================================
// Grid → schedule_of_events  +  the automatic fallback decision gate
// =============================================================================

/** One procedure in the schedule shape. Fields the SoA grid can't see (role_hint,
 * conditions, timing, source_fields) are left empty here and may be enriched from
 * the LLM extraction by label-match downstream — hence the open types. */
export interface ScheduleProcedure {
  label: string;
  description: string | null;
  phase: string | null;
  /** null for a plain mark → buildPersistPayloadForVisit's assignClassification
   * heuristic derives required/safety_critical/primary_endpoint/etc from the
   * label; "conditional" only for an explicit "(X)" mark. */
  classification: "conditional" | null;
  role_hint: string | null;
  soa_column: string;
  protocol_section: string;
  protocol_page: number | null;
  conditions: unknown[];
  timing: unknown;
  source_fields: unknown[];
}

/** One schedule_of_events entry in the shape downstream (SOTR + visit templates) consumes. */
export interface ScheduleOfEventsItem {
  visit_name: string;
  study_day: number | null;
  window_minus_days: number;
  window_plus_days: number;
  /** Protocol visit sequence (SoA column order) — downstream orders by this. */
  column_order: number;
  procedures: string[];
  procedures_structured: ScheduleProcedure[];
  visit_purpose: string;
  schedule_variant: string;
  cross_references: unknown[];
  /**
   * Study cohort(s)/arm(s) this visit applies to, derived from the source SoA
   * tables' section headings (+ any "[X only]" header marker). `null` = applies
   * to all participants (a shared/unscoped visit, or a non-cohort protocol).
   * A non-null list is only ever produced for a cohort-structured protocol;
   * single-schedule protocols get `null` everywhere (no behavior change).
   */
  applies_to: string[] | null;
}

/** Normalized citation shape matching ingestPipeline's normalizeReductoCitation output. */
export interface SoaCitation {
  text: string;
  pages: number[];
  section: string;
  /** Grid parse is deterministic → 'high'; honored by the SOTR adapter's confidence map. */
  confidence: "high" | "medium" | "low";
}

/**
 * Convert grid visits into the schedule_of_events array + a parallel citation
 * array (aligned by index, for `_reducto_citations.schedule_of_events`). The
 * citation points at the actual SoA page — more faithful than the LLM's guess —
 * and is always emitted with confidence 'high' (the parse is deterministic), so
 * grid visits get high-confidence source evidence instead of needs_review.
 * Conditional "(X)" → classification "conditional"; everything else → null so the
 * downstream heuristic can derive required/safety_critical/endpoint from the label.
 */
export function gridToScheduleOfEvents(
  visits: readonly SoaVisit[],
): { schedule: ScheduleOfEventsItem[]; citations: SoaCitation[] } {
  const schedule: ScheduleOfEventsItem[] = [];
  const citations: SoaCitation[] = [];
  for (const v of visits) {
    schedule.push({
      visit_name: v.visit_name,
      study_day: v.study_day,
      window_minus_days: v.window_minus_days,
      window_plus_days: v.window_plus_days,
      column_order: v.column_order,
      procedures: v.procedures.map((p) => p.label),
      procedures_structured: v.procedures.map((p) => ({
        label: p.label,
        description: p.note,
        phase: null,
        classification: p.mark === "conditional" ? "conditional" : null,
        role_hint: null,
        soa_column: v.visit_name,
        protocol_section: "Schedule of Assessments",
        protocol_page: v.source_pages[0] ?? null,
        conditions: [],
        timing: null,
        source_fields: [],
      })),
      visit_purpose: "", // downstream generateVisitPurpose enriches
      schedule_variant: "",
      cross_references: [],
      applies_to: null, // legacy grid path is single-schedule; cohorts come via assembleVisitsFromGrouping
    });
    citations.push({
      text: `${v.visit_name} — ${v.procedures.slice(0, 4).map((p) => p.label).join(", ")}`,
      pages: v.source_pages,
      section: "Schedule of Assessments",
      confidence: "high",
    });
  }
  return { schedule, citations };
}

/** The LLM grouper's output: each final visit maps to the RawColumn indices it covers. */
export interface VisitGrouping {
  visits: Array<{ name: string; source_idx: number[] }>;
}

/**
 * Assemble the LLM grouping over RawColumns into the downstream schedule_of_events
 * shape. Procedures come ENTIRELY from the deterministic RawColumns (the LLM never
 * supplies procedures) — the union of the grouped columns, deduped, verbatim.
 * column_order = min source index (protocol sequence). Unknown source_idx values
 * are ignored (the LLM cannot invent a column). Pure, vitest-importable.
 */
// Study-day derivation for an assembled visit. study_day is INTEGER NOT NULL and
// anchors calendar projection + the template unique key, so a null silently drops
// the visit at persist. Protocols encode the day in many shapes — an explicit
// "Day/Week/Month N" keyword (parseVisitHeader handles those), a parenthetical
// "(14±3)" day-with-window (CLR), a bare "D-28" code (PledOx selection visits), or
// a trailing day-number after a scheduling word ("EOT 28", "Follow-Up 42 ±2",
// "Dosing 1" — RVW101). We try each in turn, then fall back to the column's
// left-to-right position so a visit is NEVER dropped and sequence is preserved
// even when no absolute day is recoverable (`approximate`).
const SCHEDULE_WORD_RE =
  /\b(?:eot|eos|end of treatment|end of study|follow.?up|dosing|infusion|treatment|discontinuation|termination|baseline)\b/i;
function extractDayWindow(text: string): { day: number; window: number } | null {
  const s = clean(text);
  // parenthetical "(N)" / "(N±W)" / "(N + W)" — the canonical day-with-window form
  let m = s.match(/\(\s*(-?\d{1,3})\s*(?:[±+]\s*(\d{1,2}))?\s*(?:days?)?\s*\)/i);
  if (m) return { day: parseInt(m[1], 10), window: m[2] ? parseInt(m[2], 10) : 0 };
  // bare "D-28" / "D 28" / "D+1" code (not "Day", which parseVisitHeader owns)
  m = s.match(/(?:^|\s)D\s*([+-]?\d{1,3})\b/);
  if (m) return { day: parseInt(m[1], 10), window: 0 };
  // trailing day-number after a scheduling word: "EOT 28", "Follow-Up 42 ±2",
  // "Dosing 1". Require the schedule word so a visit ordinal ("Visit 3") is not
  // misread as a day; take the first standalone integer + optional ± window.
  if (SCHEDULE_WORD_RE.test(s)) {
    m = s.match(/(-?\d{1,3})\s*(?:[±+]\s*(\d{1,2}))?\b/);
    if (m) return { day: parseInt(m[1], 10), window: m[2] ? parseInt(m[2], 10) : 0 };
  }
  return null;
}
export function deriveStudyDay(
  name: string,
  header: string,
  columnOrder: number,
): { study_day: number; window_minus_days: number; window_plus_days: number; approximate: boolean } {
  const fromName = parseVisitHeader(name);
  const fromHeader = parseVisitHeader(header);
  const keywordDay = fromName.study_day ?? fromHeader.study_day;
  const wMinus = fromHeader.window_minus_days || fromName.window_minus_days;
  const wPlus = fromHeader.window_plus_days || fromName.window_plus_days;
  if (keywordDay != null) {
    return { study_day: keywordDay, window_minus_days: wMinus, window_plus_days: wPlus, approximate: false };
  }
  const dw = extractDayWindow(name) ?? extractDayWindow(header);
  if (dw) {
    return {
      study_day: dw.day,
      window_minus_days: wMinus || dw.window,
      window_plus_days: wPlus || dw.window,
      approximate: false,
    };
  }
  // last resort: keep the visit, ordered by its SoA column position
  return { study_day: columnOrder, window_minus_days: wMinus, window_plus_days: wPlus, approximate: true };
}

// --- cohort applicability --------------------------------------------------
// A branched study (FIH SAD/MAD, dose-escalation, expansion, food-effect, etc.)
// expresses cohorts as DISTINCT SoA tables — and each RawColumn already records
// its source table's `section` heading. So a visit's cohort applicability is
// derivable deterministically from which tables fed it. cohortLabelFromSection
// turns a heading into a short cohort label, or null for a generic SoA heading
// (which keeps single-schedule protocols cohort-free → no behavior change).

/** Short cohort label for a SoA table's section heading, or null if generic. */
export function cohortLabelFromSection(section: string | null | undefined): string | null {
  const s = clean(section || "").toLowerCase();
  if (!s) return null;
  if (/\bmultiple ascending dose\b|\bmad\b/.test(s)) return "MAD";
  if (/\bsingle ascending dose\b|\bsad\b/.test(s)) return "SAD";
  if (/\bcerebrospinal fluid\b|\bcsf\b/.test(s)) return "CSF";
  let m: RegExpMatchArray | null;
  if ((m = s.match(/\bpart\s+([a-z0-9]+)\b/))) return `Part ${m[1].toUpperCase()}`;
  if ((m = s.match(/\bcohort\s+([a-z0-9]+)\b/))) return `Cohort ${m[1].toUpperCase()}`;
  if (/\bfood[- ]?effect\b|\bfasted\b|\bfed\b/.test(s)) return "Food-effect";
  if (/\bexpansion\b/.test(s)) return "Expansion";
  if (/\bdose[ -]?escalat\w*\b|\bdose[ -]level\b/.test(s)) return "Dose-escalation";
  return null; // generic "Schedule of Assessments" / "Table N" → not a cohort
}

/** A cohort name carried by an explicit "[X only]" / "(X only)" header marker. */
export function cohortOnlyRestriction(text: string | null | undefined): string | null {
  const t = clean(text || "");
  if (!t) return null;
  let m = t.match(/[\[(]\s*([A-Za-z0-9][A-Za-z0-9 ]{0,18}?)\s+only\s*[\])]/i);
  if (m) return m[1].trim().replace(/\s+/g, " ");
  m = t.match(/\b(S\d{1,2}|Cohort\s+[A-Za-z0-9]+|Part\s+[A-Za-z0-9]+)\s+only\b/i);
  return m ? m[1].trim().replace(/\s+/g, " ") : null;
}

export function assembleVisitsFromGrouping(
  columns: readonly RawColumn[],
  grouping: VisitGrouping,
): { schedule: ScheduleOfEventsItem[]; citations: SoaCitation[] } {
  const byIdx = new Map(columns.map((c) => [c.idx, c]));
  const schedule: ScheduleOfEventsItem[] = [];
  const citations: SoaCitation[] = [];
  const isApproxDay = new Map<ScheduleOfEventsItem, boolean>();
  const cohortLabels = new Map<ScheduleOfEventsItem, string[]>();
  let anyCohortOnly = false;

  for (const v of grouping?.visits ?? []) {
    const srcCols = (v.source_idx ?? [])
      .map((i) => byIdx.get(i))
      .filter((c): c is RawColumn => !!c);
    if (srcCols.length === 0) continue;

    // union of marked procedures across the grouped columns (verbatim, dedup by label)
    const procs: SoaProcedure[] = [];
    const seen = new Set<string>();
    for (const col of srcCols) {
      for (const p of col.procedures) {
        const k = p.label.toLowerCase();
        if (!seen.has(k)) { seen.add(k); procs.push(p); }
      }
    }

    const columnOrder = Math.min(...srcCols.map((c) => c.idx));
    const pages = [...new Set(srcCols.map((c) => c.page).filter((p): p is number => typeof p === "number"))];
    const name = (typeof v.name === "string" && v.name.trim()) ? v.name.trim() : srcCols[0].header;
    // study_day anchors calendar projection (materialize_protocol_visits) and is
    // part of the template unique key, so it must be non-null or the persist
    // step drops the visit. deriveStudyDay tries the LLM-cleaned name, the raw
    // header, parenthetical/bare-code day forms, then falls back to column order
    // so a visit is never dropped (see deriveStudyDay for the full ladder).
    const day = deriveStudyDay(name, srcCols[0].header, columnOrder);

    // cohort applicability: an explicit "[X only]" header marker is exclusive
    // (overrides), otherwise the visit applies to the cohort(s) of its source
    // tables. Empty (no cohort signal) = shared/unscoped. The protocol-level
    // gate below decides whether any of this is kept (null for non-cohort).
    const onlyR = cohortOnlyRestriction(name) ?? cohortOnlyRestriction(srcCols[0].header);
    if (onlyR) anyCohortOnly = true;
    const labels = onlyR
      ? [onlyR]
      : [...new Set(srcCols.map((c) => cohortLabelFromSection(c.section)).filter((x): x is string => !!x))];

    const item: ScheduleOfEventsItem = {
      visit_name: name,
      study_day: day.study_day,
      window_minus_days: day.window_minus_days,
      window_plus_days: day.window_plus_days,
      column_order: columnOrder,
      procedures: procs.map((p) => p.label),
      procedures_structured: procs.map((p) => ({
        label: p.label,
        description: p.note,
        phase: null,
        classification: p.mark === "conditional" ? "conditional" : null,
        role_hint: null,
        soa_column: name,
        protocol_section: "Schedule of Assessments",
        protocol_page: pages[0] ?? null,
        conditions: [],
        timing: null,
        source_fields: [],
      })),
      visit_purpose: "",
      schedule_variant: "",
      cross_references: [],
      applies_to: null, // set in the cohort-gate pass below
    };
    schedule.push(item);
    isApproxDay.set(item, day.approximate);
    cohortLabels.set(item, labels);
    citations.push({
      text: `${name} — ${procs.slice(0, 4).map((p) => p.label).join(", ")}`,
      pages,
      section: "Schedule of Assessments",
      confidence: "high",
    });
  }

  schedule.sort((a, b) => a.column_order - b.column_order);

  // Monotonic approximate-day pass. A dateless visit (no parseable day — e.g.
  // "EOFU", "LTFU", "ED") got a column-index fallback from deriveStudyDay, but
  // Visit Prep sorts by study_day, so a raw column index can interleave it among
  // real treatment visits. Walk in column order and re-anchor each approximate
  // day to (last real day seen) + a running offset, so dateless visits sort
  // immediately AFTER the preceding real visit and keep their sequence. Visits
  // with a real day are untouched (regression-safe for date-bearing protocols).
  let lastRealDay: number | null = null;
  let approxOffset = 0;
  for (const item of schedule) {
    if (isApproxDay.get(item)) {
      if (lastRealDay !== null) {
        approxOffset += 1;
        item.study_day = lastRealDay + approxOffset;
      }
      // else: no real day seen yet — keep the column-index fallback
    } else {
      if (typeof item.study_day === "number") {
        lastRealDay = lastRealDay === null ? item.study_day : Math.max(lastRealDay, item.study_day);
      }
      approxOffset = 0;
    }
  }

  // Cohort-applicability gate. Only tag visits when the protocol is genuinely
  // cohort-structured (≥2 distinct cohort labels emerged, or an explicit
  // "[X only]" marker) — otherwise EVERY visit stays applies_to=null so
  // single-schedule protocols are unchanged and no cohort UI appears. Within a
  // cohort protocol, a visit with no cohort signal stays null (shared/unscoped,
  // shows under every cohort filter — same convention as the role filter).
  const allCohorts = new Set<string>();
  for (const ls of cohortLabels.values()) for (const l of ls) allCohorts.add(l);
  const cohortStructured = allCohorts.size >= 2 || anyCohortOnly;
  for (const item of schedule) {
    const ls = cohortLabels.get(item) ?? [];
    item.applies_to = cohortStructured && ls.length ? [...new Set(ls)].sort() : null;
  }

  return { schedule, citations };
}

/** Normalize a procedure label for cross-source matching (drop parentheticals/footnotes/case). */
function normLabel(s: string): string {
  return clean(s).toLowerCase().replace(/\([^)]*\)/g, "").replace(/[ª²³¹º⁰-⁹]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * The SoA grid gives the verbatim per-visit checklist (which the LLM collapsed)
 * but not the per-procedure metadata the LLM CAN infer — role_hint (drives the
 * role-filtered views), conditional rules, timing windows, source-field
 * scaffolds. This recovers those by matching each grid procedure to the LLM's
 * procedures_structured by normalized label (a label like "Hematology" has the
 * same role wherever it appears), filling ONLY fields the grid left empty.
 * Classification/phase are deliberately NOT inherited — those stay deterministic
 * (the grid's "(X)" + buildPersistPayloadForVisit's heuristic). Mutates in place;
 * returns the number of procedures enriched. Pure (no I/O), vitest-importable.
 */
export function enrichScheduleFromLlm(
  gridSchedule: ScheduleOfEventsItem[],
  llmSchedule: unknown,
): number {
  const byLabel = new Map<string, Record<string, unknown>>();
  if (Array.isArray(llmSchedule)) {
    for (const v of llmSchedule) {
      const procs = (v as { procedures_structured?: unknown })?.procedures_structured;
      if (!Array.isArray(procs)) continue;
      for (const p of procs) {
        if (!p || typeof p !== "object") continue;
        const rec = p as Record<string, unknown>;
        const key = normLabel(typeof rec.label === "string" ? rec.label : "");
        if (key && !byLabel.has(key)) byLabel.set(key, rec);
      }
    }
  }
  if (byLabel.size === 0) return 0;

  let enriched = 0;
  for (const visit of gridSchedule) {
    for (const proc of visit.procedures_structured) {
      const match = byLabel.get(normLabel(proc.label));
      if (!match) continue;
      let touched = false;
      if (proc.role_hint == null && typeof match.role_hint === "string") {
        proc.role_hint = match.role_hint;
        touched = true;
      }
      if ((!proc.conditions || proc.conditions.length === 0) && Array.isArray(match.conditions) && match.conditions.length > 0) {
        proc.conditions = match.conditions;
        touched = true;
      }
      if (proc.timing == null && match.timing && typeof match.timing === "object") {
        proc.timing = match.timing;
        touched = true;
      }
      if ((!proc.source_fields || proc.source_fields.length === 0) && Array.isArray(match.source_fields) && match.source_fields.length > 0) {
        proc.source_fields = match.source_fields;
        touched = true;
      }
      if (proc.description == null && typeof match.description === "string" && match.description.trim()) {
        proc.description = match.description;
        touched = true;
      }
      if (touched) enriched += 1;
    }
  }
  return enriched;
}

export interface SoaGateDecision {
  /** true → use the deterministic grid; false → fall back to the LLM extraction. */
  useGrid: boolean;
  /** Persisted on the coverage row; surfaced in the banner (never silent). */
  method: "grid" | "grid_low_confidence" | "llm_fallback";
  /** Human-readable reasons the gate fired (for logs + the banner). */
  reasons: string[];
}

const TREATMENT_VISIT_RE = /^(?:treatment\s+visit|visit)\s+\d+$/i;

/**
 * The automatic, per-document fallback gate (plan A-fallback). Accept the grid
 * UNLESS any check fails:
 *   1. no SoA grid found
 *   2. under-covers — grid's numbered treatment visits < the independent signal
 *   3. an empty visit column (alignment failure)
 *   4. structural failure — unresolved spans, or self-consistency low-confidence
 * Pass all → grid (deterministic, the normal path). Any fail → llm_fallback,
 * flagged on the coverage row.
 */
export function evaluateSoaGate(
  result: SoaGridResult,
  expectedTreatmentVisits: number,
): SoaGateDecision {
  const reasons: string[] = [];
  const { guards, visits } = result;

  if (guards.soaTablesFound === 0 || visits.length === 0) reasons.push("no SoA grid found");

  const gridTreatmentVisits = visits.filter((v) => TREATMENT_VISIT_RE.test(v.visit_name)).length;
  if (expectedTreatmentVisits > 0 && gridTreatmentVisits < expectedTreatmentVisits) {
    reasons.push(`grid under-covers: ${gridTreatmentVisits} treatment visits vs ~${expectedTreatmentVisits} expected`);
  }
  if (guards.emptyVisitColumns > 0) reasons.push(`${guards.emptyVisitColumns} empty visit column(s)`);
  if (guards.unresolvedSpans > 0) reasons.push(`${guards.unresolvedSpans} unresolved row/col span(s)`);

  if (reasons.length > 0) return { useGrid: false, method: "llm_fallback", reasons };
  if (guards.lowConfidence) {
    return { useGrid: true, method: "grid_low_confidence", reasons: guards.notes };
  }
  return { useGrid: true, method: "grid", reasons: [] };
}
