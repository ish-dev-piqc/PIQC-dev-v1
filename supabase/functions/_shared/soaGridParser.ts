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

import { canonicalVisitName, normalizeVisitName } from "./visitNameNormalize.ts";

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
  /** true → this visit has no protocol-stated day; `study_day` is a synthetic
   * sort anchor (monotonic approximate-day pass), NOT a protocol claim. UI must
   * not display it as "Day N" (spec §2.9 — ordering may use it; a claim may not). */
  study_day_is_approximate?: boolean;
  /** Verbatim composite SoA column header of the first source column — the grid
   * reading's quotable text for divergence records. */
  source_header?: string;
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
// A visit's cohort applicability is evidence-driven and generalized across
// protocol shapes — NOT hard-coded to any one study:
//   • When an AUTHORITATIVE cohort list is known (extracted from the protocol
//     body — see ingestPipeline's cohort pass), a visit's cohort set is derived
//     from the section heading(s) of the SoA table(s) its column(s) came from.
//     A heading that enumerates cohorts ("…SAD Cohorts S1, S2 … S6", "MAD
//     Cohorts", "CSF") binds the visit to exactly those cohorts. A heading that
//     names NONE — or names ALL of them — → null = the shared backbone (applies
//     to every cohort; the full list lives in protocol_cohorts). A strict SUBSET
//     → cohort-specific (a divergent schedule). An exclusive "[X only]" /
//     "Cohorts 3–6 only" marker narrows further and wins. Guarantee: a visit is
//     never bound to a cohort the evidence (heading/marker) doesn't name — no
//     cross-cohort requirement leakage.
//   • When NO cohort list is known (single-schedule protocol, or any caller that
//     doesn't pass one), applicability falls back to the explicit "[X only]"
//     header marker ONLY — exactly the prior, parse-robust behavior; everything
//     else → null. (Deriving cohorts from Reducto's non-deterministic table
//     SEGMENTATION alone was tried and dropped — it mislabeled shared visits.
//     The authoritative list + heading ENUMERATION is the stable signal that
//     replaces it.)

const GENERIC_RANGE_PREFIXES = new Set(
  ["", "cohort", "cohorts", "part", "parts", "arm", "arms", "group", "groups"],
);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Decompose a cohort label into {prefix, number} for numeric-range resolution:
 * "S3"→{s,3}, "Cohort 4"→{cohort,4}, "MAD"→{mad,null}. */
function cohortLabelParts(label: string): { prefix: string; num: number | null } {
  const t = clean(label).toLowerCase();
  const m = t.match(/^([a-z ]*?)\s*0*(\d{1,3})$/);
  if (m) return { prefix: m[1].replace(/\s+/g, ""), num: parseInt(m[2], 10) };
  return { prefix: t.replace(/\s+/g, ""), num: null };
}

/** Numeric ranges in a heading/marker: "S1–S6", "1-6", "3 to 6", "S4 … S6". The
 * first operand's leading letters are the range prefix (or a generic descriptor
 * like "Cohorts"); the second operand's prefix is ignored. */
function numericRanges(text: string): Array<{ prefix: string; lo: number; hi: number }> {
  const out: Array<{ prefix: string; lo: number; hi: number }> = [];
  const re = /([A-Za-z]{0,8}?)\s*0*(\d{1,3})\s*(?:[-–—]|\.{2,}|…|\bto\b)\s*[A-Za-z]{0,8}?\s*0*(\d{1,3})/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const lo = parseInt(m[2], 10);
    const hi = parseInt(m[3], 10);
    if (hi >= lo && hi - lo <= 50) out.push({ prefix: m[1].toLowerCase(), lo, hi });
  }
  return out;
}

/**
 * Per-cohort SoA aliases: canonical label → the way(s) the cohort appears in SoA
 * table headings/markers when that differs from the label ('CSF' →
 * ['Cerebrospinal Fluid Cohort']). Empty/omitted → label-only matching (the
 * prior behavior). An alias only ever resolves to a cohort already in the list.
 */
export type CohortAliasMap = Readonly<Record<string, readonly string[]>>;

/**
 * The coarse leading cohort token of a granular label: 'S4 Period 1' → 'S4',
 * 'Cohort 3 Expansion' → 'Cohort 3'. null for a single-token label (nothing
 * coarser to expand from; the literal match already covers it). Lets a SoA
 * heading naming only the parent ('S4') bind every granular label under it.
 */
export function leadingCohortToken(label: string): string | null {
  const words = clean(label).split(/\s+/).filter(Boolean);
  if (words.length <= 1) return null;
  // "Cohort 3 Expansion" → "Cohort 3" (bare word + number); else the first word.
  if (/^[A-Za-z]+$/.test(words[0]) && /^\d+$/.test(words[1])) return `${words[0]} ${words[1]}`;
  return words[0];
}

/**
 * The cohorts (drawn from the authoritative `cohortList`) that a SoA table's
 * section heading enumerates — by literal label token, stated SoA alias, numeric
 * range expansion, AND parent→period prefix expansion (a heading naming a coarse
 * parent token like "S4" binds every granular label under it, "S4 Period 1/2").
 * "…Cohorts S1, S2, S3, S4 … S6" → S1..S6; "MAD Cohorts" → MAD; a generic
 * heading with no cohort token → []. Only ever returns labels present in
 * `cohortList`, so it can never invent a cohort. Pure, vitest-importable.
 */
export function cohortsFromTableHeading(
  section: string | null | undefined,
  cohortList: readonly string[],
  aliasMap: CohortAliasMap = {},
): string[] {
  const text = clean(section || "");
  if (!text || cohortList.length === 0) return [];
  const matched = new Set<string>();
  // Bounded token test so "S1" ∌ "S12", "MAD" ∌ "NOMADIC".
  const nameMatches = (needle: string): boolean => {
    const n = clean(needle);
    return !!n && new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(n)}(?![A-Za-z0-9])`, "i").test(text);
  };
  // (1) literal label OR a stated SoA alias.
  for (const label of cohortList) {
    if (nameMatches(label) || (aliasMap[label] ?? []).some((a) => nameMatches(a))) {
      matched.add(label);
    }
  }
  // (1b) parent→period prefix expansion — but NOT when the heading is already
  //      granular for that family. If a sibling sharing the same lead token was
  //      named literally/by alias (e.g. heading "S4 Period 2"), the parent token
  //      is "used up" → don't over-bind the other period.
  const matchedLeads = new Set(
    [...matched].map((l) => leadingCohortToken(l)).filter((t): t is string => !!t),
  );
  for (const label of cohortList) {
    if (matched.has(label)) continue;
    const lead = leadingCohortToken(label);
    if (lead && !matchedLeads.has(lead) && nameMatches(lead)) matched.add(label);
  }
  // (2) numeric ranges expand against the list ("S4 … S6" → S4,S5,S6), resolving
  //     a granular label ("S4 Period 1") through its leading token ("S4").
  const ranges = numericRanges(text);
  if (ranges.length > 0) {
    for (const label of cohortList) {
      if (matched.has(label)) continue;
      const { prefix, num } = cohortLabelParts(leadingCohortToken(label) ?? label);
      if (num == null) continue;
      for (const r of ranges) {
        if (num >= r.lo && num <= r.hi && (GENERIC_RANGE_PREFIXES.has(r.prefix) || r.prefix === prefix)) {
          matched.add(label);
          break;
        }
      }
    }
  }
  return cohortList.filter((c) => matched.has(c)); // preserve authoritative order
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

/**
 * An exclusive cohort-scoping marker resolved to a cohort SET, using the
 * authoritative `cohortList` to expand ranges: "[S4 Only]" → ["S4"];
 * "Cohorts 3–6 only" → ["S3","S4","S5","S6"]. null when there is no exclusive
 * marker. The range branch fires only on an explicit "… only" + numeric range
 * (and only when it resolves to a strict subset), so a plain shared heading
 * never narrows.
 */
export function markerCohortScope(
  text: string | null | undefined,
  cohortList: readonly string[],
  aliasMap: CohortAliasMap = {},
): string[] | null {
  const t = clean(text || "");
  if (!t) return null;
  if (
    cohortList.length > 0 &&
    /\bonly\b/i.test(t) &&
    /\d\s*(?:[-–—]|\.{2,}|…|\bto\b)\s*[A-Za-z]*\s*\d/.test(t)
  ) {
    const scope = cohortsFromTableHeading(t, cohortList, aliasMap);
    if (scope.length > 0 && scope.length < cohortList.length) return scope;
  }
  const single = cohortOnlyRestriction(t);
  if (!single) return null;
  // Resolve the raw restriction token ("[S4 only]" → "S4") against the
  // authoritative list, so a list finer-grained than the marker ("S4 Period
  // 1/2") — or an alias — binds correctly instead of emitting the orphan
  // ["S4"]. No list / no resolution → the raw token (parse-robust; the
  // reconcile flags any orphan).
  if (cohortList.length > 0) {
    const resolved = cohortsFromTableHeading(single, cohortList, aliasMap);
    if (resolved.length > 0) return resolved;
  }
  return [single];
}

/**
 * Evidence-driven cohort applicability for one assembled visit (see the cohort
 * applicability note above for the full rule). null = shared (applies to all
 * participants/cohorts); a non-null list = cohort-specific (divergent schedule).
 */
function deriveAppliesTo(
  name: string,
  srcCols: readonly RawColumn[],
  cohortList: readonly string[],
  aliasMap: CohortAliasMap = {},
): string[] | null {
  // No authoritative list → markers-only (the prior, parse-robust behavior).
  if (cohortList.length === 0) {
    const onlyR = cohortOnlyRestriction(name) ?? cohortOnlyRestriction(srcCols[0]?.header);
    return onlyR ? [onlyR] : null;
  }
  // Exclusive "[X only]" / range marker narrows to specific cohort(s) — wins.
  const marker =
    markerCohortScope(name, cohortList, aliasMap) ?? markerCohortScope(srcCols[0]?.header, cohortList, aliasMap);
  if (marker && marker.length > 0) return marker;
  // Otherwise: union of the cohorts the source table heading(s) enumerate.
  const heading = new Set<string>();
  for (const col of srcCols) {
    for (const c of cohortsFromTableHeading(col.section, cohortList, aliasMap)) heading.add(c);
  }
  // Names none, or names ALL → shared backbone (null). A strict subset →
  // cohort-specific; never bound to a cohort the heading doesn't name.
  if (heading.size === 0 || heading.size >= cohortList.length) return null;
  return cohortList.filter((c) => heading.has(c));
}

export function assembleVisitsFromGrouping(
  columns: readonly RawColumn[],
  grouping: VisitGrouping,
  /**
   * Authoritative cohort labels for this protocol (from the body-text cohort
   * pass). When non-empty, each visit's `applies_to` is derived from its source
   * table heading(s) ∪ "[X only]" markers (see deriveAppliesTo). Empty/omitted →
   * markers-only (unchanged Slice-2 behavior; single-schedule protocols).
   */
  cohortList: readonly string[] = [],
  /** Per-cohort SoA aliases (label → the way it appears in the SoA), so a
   * heading naming a cohort by a synonym still binds. Omitted → label-only. */
  aliasMap: CohortAliasMap = {},
): { schedule: ScheduleOfEventsItem[]; citations: SoaCitation[] } {
  const byIdx = new Map(columns.map((c) => [c.idx, c]));
  const schedule: ScheduleOfEventsItem[] = [];
  const citations: SoaCitation[] = [];
  const isApproxDay = new Map<ScheduleOfEventsItem, boolean>();

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

    // cohort applicability — evidence-driven (table-heading enumeration ∪ "[X
    // only]" markers, alias- and parent→period-aware) when an authoritative
    // cohort list is supplied; markers-only (unchanged) otherwise. Additive
    // metadata: never changes which visits exist.
    const applies_to = deriveAppliesTo(name, srcCols, cohortList, aliasMap);

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
      applies_to,
    };
    if (srcCols[0]?.header) item.source_header = srcCols[0].header;
    if (day.approximate) item.study_day_is_approximate = true;
    schedule.push(item);
    isApproxDay.set(item, day.approximate);
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

  return { schedule, citations };
}

/** Full-fidelity label key — case/whitespace/footnote-superscript folding with
 * PARENTHETICALS PRESERVED, so sibling procedures like "Pregnancy test (serum)"
 * and "Pregnancy test (urine)" keep distinct keys. */
export function normLabelFull(s: string): string {
  return clean(s).toLowerCase().replace(/[ª²³¹º⁰-⁹]/g, "").replace(/\s+/g, " ").trim();
}

/** Paren-stripped key (the historical normLabel behavior). It maps distinct
 * sibling procedures onto ONE key, so it is only ever used behind a both-sides
 * uniqueness gate (tier 3) — never as the primary join. */
export function normLabelLoose(s: string): string {
  return normLabelFull(s).replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/** One LLM procedure occurrence (label × the LLM visit that carries it). */
interface LlmProcOccurrence {
  visitIdx: number;
  rec: Record<string, unknown>;
}

/** Per-procedure narrative fields the enricher may fill (fill-only-empty). */
const PROC_NARRATIVE_FIELDS = ["role_hint", "conditions", "timing", "source_fields", "description"] as const;
type ProcNarrativeField = (typeof PROC_NARRATIVE_FIELDS)[number];

const ALL_PROC_FIELDS: ReadonlySet<ProcNarrativeField> = new Set(PROC_NARRATIVE_FIELDS);

/** Fill empty narrative fields on a grid procedure from an LLM record, restricted
 * to `allowed` (the invariance gate for global binds). Mirrors the historical
 * fill-only-empty semantics exactly; a grid-set value is never overwritten. */
function fillProcFromRec(
  proc: ScheduleProcedure,
  rec: Record<string, unknown>,
  allowed: ReadonlySet<ProcNarrativeField>,
): boolean {
  let touched = false;
  if (allowed.has("role_hint") && proc.role_hint == null && typeof rec.role_hint === "string" && rec.role_hint.trim()) {
    proc.role_hint = rec.role_hint;
    touched = true;
  }
  if (allowed.has("conditions") && (!proc.conditions || proc.conditions.length === 0) && Array.isArray(rec.conditions) && rec.conditions.length > 0) {
    proc.conditions = rec.conditions;
    touched = true;
  }
  if (allowed.has("timing") && proc.timing == null && rec.timing && typeof rec.timing === "object") {
    proc.timing = rec.timing;
    touched = true;
  }
  if (allowed.has("source_fields") && (!proc.source_fields || proc.source_fields.length === 0) && Array.isArray(rec.source_fields) && rec.source_fields.length > 0) {
    proc.source_fields = rec.source_fields;
    touched = true;
  }
  if (allowed.has("description") && proc.description == null && typeof rec.description === "string" && rec.description.trim()) {
    proc.description = rec.description;
    touched = true;
  }
  return touched;
}

/** Stable value fingerprint for the invariance gate (absent → null). */
function fieldFingerprint(rec: Record<string, unknown>, field: ProcNarrativeField): string {
  return JSON.stringify(rec[field] ?? null);
}

export interface NarrativeRecoveryUnbound {
  visit: string;
  label: string;
  /** true → an LLM record with a matching label existed somewhere but did not
   * bind (a bind failure); false → the extract has no candidate at all. */
  had_candidate: boolean;
}

/** The reconcile record for narrative recovery — persisted on
 * documents.extracted_fields (like `_cohort_reconciliation`) so silent loss
 * becomes visible, countable loss. */
export interface NarrativeRecovery {
  /** grid procedures that received at least one narrative field */
  bound: number;
  /** grid procedures left with NO narrative (no description/conditions/timing) */
  unbound: NarrativeRecoveryUnbound[];
  /** ambiguous keys refused by a uniqueness gate — never bound, never guessed */
  collisions: string[];
  /** visits whose ±window was recovered from the narrative reading (grid header stated none) */
  window_filled_from_narrative: string[];
  visit_purpose_recovered: number;
  cross_references_recovered: number;
}

/** One LLM schedule visit, indexed for alignment. */
export interface LlmVisitEntry {
  raw: Record<string, unknown>;
  nameKey: string | null;
  studyDay: number | null;
  procs: Record<string, unknown>[];
}

/** Alignment index over the LLM extraction's visits — shared by narrative
 * recovery (enrichScheduleFromLlm) and narrative↔grid divergence detection
 * (narrativeDivergence.ts), so the two features can never disagree about which
 * LLM visit a grid visit means. */
export interface LlmVisitIndex {
  entries: LlmVisitEntry[];
  byNameKey: Map<string, number[]>;
  byDay: Map<number, number[]>;
}

export function indexLlmScheduleVisits(llmSchedule: unknown): LlmVisitIndex {
  const entries: LlmVisitEntry[] = [];
  if (Array.isArray(llmSchedule)) {
    for (const v of llmSchedule) {
      if (!v || typeof v !== "object") continue;
      const raw = v as Record<string, unknown>;
      const name = typeof raw.visit_name === "string" ? raw.visit_name.trim() : "";
      const day = typeof raw.study_day === "number" && Number.isFinite(raw.study_day)
        ? Math.trunc(raw.study_day)
        : null;
      const procs = Array.isArray(raw.procedures_structured)
        ? (raw.procedures_structured as unknown[]).filter(
          (p): p is Record<string, unknown> =>
            !!p && typeof p === "object" && typeof (p as { label?: unknown }).label === "string",
        )
        : [];
      entries.push({ raw, nameKey: name ? normalizeVisitName(name) : null, studyDay: day, procs });
    }
  }
  const byNameKey = new Map<string, number[]>();
  const byDay = new Map<number, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const { nameKey, studyDay } = entries[i];
    if (nameKey) {
      const l = byNameKey.get(nameKey);
      if (l) l.push(i);
      else byNameKey.set(nameKey, [i]);
    }
    if (studyDay != null) {
      const l = byDay.get(studyDay);
      if (l) l.push(i);
      else byDay.set(studyDay, [i]);
    }
  }
  return { entries, byNameKey, byDay };
}

/** Confident grid→LLM visit alignment: unique normalized-name match first;
 * unique exact study_day only when the grid day is REAL — a synthetic
 * approximate day is PIQC's sort-order invention, not the protocol's claim
 * (spec §2.9), so it must not drive alignment. */
export function alignGridVisitToLlm(
  visit: ScheduleOfEventsItem,
  idx: LlmVisitIndex,
): LlmVisitEntry | null {
  const key = visit.visit_name ? normalizeVisitName(visit.visit_name) : "";
  const byName = key ? idx.byNameKey.get(key) : undefined;
  if (byName && byName.length === 1) return idx.entries[byName[0]];
  if (typeof visit.study_day === "number" && !visit.study_day_is_approximate) {
    const byDay = idx.byDay.get(visit.study_day);
    if (byDay && byDay.length === 1) return idx.entries[byDay[0]];
  }
  return null;
}

/**
 * Recover per-procedure and per-visit narrative from the pre-overwrite LLM
 * extraction into the deterministic grid schedule. Replaces the historical
 * single global first-wins label map, which carried two live defects:
 *   (1) global first-wins — a procedure recurring across visits inherited the
 *       FIRST visit's conditions/timing (narrative attached to the wrong visit);
 *   (2) paren-stripped keys — distinct siblings ("Pregnancy test (serum)" vs
 *       "(urine)") collided into one key and first-wins picked a winner silently.
 *
 * Precision-tiered design (narrative-first spec §3.4 — correctness before
 * coverage; every non-bind is surfaced, never guessed):
 *   T1  per-visit map, full-fidelity keys (parens preserved), on visits aligned
 *       by normalized visit name (fallback: exact non-approximate study_day) —
 *       binds ALL fields;
 *   T2  invariant-hoisted global map — a field binds globally ONLY when its
 *       value is deep-equal across EVERY occurrence of that label in the LLM
 *       extract (a single occurrence is trivially invariant);
 *   T3  paren-stripped fallback, gated on uniqueness on BOTH sides (per-visit
 *       first; then global, hoisted fields only). Ambiguity → no bind + flag.
 * Visit-level fills for aligned pairs: visit_purpose, cross_references, and the
 * ±window when the grid header stated none (grid 0/0 = not-found; a nonzero
 * grid window is NEVER touched — a narrative disagreement there is divergence
 * detection's finding, not recovery's).
 * Mutates in place; returns the NarrativeRecovery reconcile record. Pure
 * (no I/O), vitest-importable.
 */
export function enrichScheduleFromLlm(
  gridSchedule: ScheduleOfEventsItem[],
  llmSchedule: unknown,
): NarrativeRecovery {
  const recovery: NarrativeRecovery = {
    bound: 0,
    unbound: [],
    collisions: [],
    window_filled_from_narrative: [],
    visit_purpose_recovered: 0,
    cross_references_recovered: 0,
  };

  const llmIndex = indexLlmScheduleVisits(llmSchedule);
  const llmVisits = llmIndex.entries;
  if (llmVisits.length === 0) return recovery;

  // ---- global occurrence census (T2 invariance gate + T3 global census) ---
  const occByFull = new Map<string, LlmProcOccurrence[]>();
  for (let i = 0; i < llmVisits.length; i++) {
    for (const rec of llmVisits[i].procs) {
      const key = normLabelFull(String(rec.label));
      if (!key) continue;
      const list = occByFull.get(key);
      if (list) list.push({ visitIdx: i, rec });
      else occByFull.set(key, [{ visitIdx: i, rec }]);
    }
  }
  // Fields invariant across EVERY occurrence of a label may bind globally; a
  // varying field binds only within its own aligned visit. This is what
  // recovers the common "described once in prose, applies everywhere" case
  // that plain per-visit scoping would lose — at zero wrong-visit risk.
  const hoisted = new Map<string, { rec: Record<string, unknown>; allowed: Set<ProcNarrativeField> }>();
  for (const [key, occs] of occByFull) {
    const allowed = new Set<ProcNarrativeField>();
    for (const f of PROC_NARRATIVE_FIELDS) {
      const fp = fieldFingerprint(occs[0].rec, f);
      if (occs.every((o) => fieldFingerprint(o.rec, f) === fp)) allowed.add(f);
    }
    if (allowed.size > 0) hoisted.set(key, { rec: occs[0].rec, allowed });
  }
  // T3 global census: loose key → the set of full keys it covers, per side.
  const llmLooseFulls = new Map<string, Set<string>>();
  for (const key of occByFull.keys()) {
    const loose = normLabelLoose(key);
    if (!loose) continue;
    const set = llmLooseFulls.get(loose);
    if (set) set.add(key);
    else llmLooseFulls.set(loose, new Set([key]));
  }
  const gridLooseFulls = new Map<string, Set<string>>();
  for (const visit of gridSchedule) {
    for (const proc of visit.procedures_structured) {
      const loose = normLabelLoose(proc.label);
      if (!loose) continue;
      const set = gridLooseFulls.get(loose);
      if (set) set.add(normLabelFull(proc.label));
      else gridLooseFulls.set(loose, new Set([normLabelFull(proc.label)]));
    }
  }

  // ---- bind loop ----------------------------------------------------------
  for (const visit of gridSchedule) {
    const aligned = alignGridVisitToLlm(visit, llmIndex);

    // Per-visit T1 map (full keys) + T3a loose map, with in-visit collision refusal.
    const visitByFull = new Map<string, Record<string, unknown> | "collision">();
    const visitByLoose = new Map<string, Record<string, unknown>[]>();
    if (aligned) {
      for (const rec of aligned.procs) {
        const key = normLabelFull(String(rec.label));
        if (!key) continue;
        const existing = visitByFull.get(key);
        if (existing === undefined) visitByFull.set(key, rec);
        else if (existing !== "collision" && JSON.stringify(existing) !== JSON.stringify(rec)) {
          visitByFull.set(key, "collision");
          recovery.collisions.push(`${visit.visit_name} :: ${key}`);
        }
        const loose = normLabelLoose(String(rec.label));
        if (loose) {
          const l = visitByLoose.get(loose);
          if (l) l.push(rec);
          else visitByLoose.set(loose, [rec]);
        }
      }
    }
    // Grid-side loose census within this visit (T3a uniqueness gate).
    const gridVisitLooseCount = new Map<string, number>();
    for (const proc of visit.procedures_structured) {
      const loose = normLabelLoose(proc.label);
      if (loose) gridVisitLooseCount.set(loose, (gridVisitLooseCount.get(loose) ?? 0) + 1);
    }

    for (const proc of visit.procedures_structured) {
      const full = normLabelFull(proc.label);
      const loose = normLabelLoose(proc.label);
      let touched = false;

      // T1 — aligned visit, full-fidelity key: bind everything.
      const t1 = visitByFull.get(full);
      if (t1 && t1 !== "collision") {
        touched = fillProcFromRec(proc, t1, ALL_PROC_FIELDS) || touched;
      }
      // T2 — invariant-hoisted global bind (only fields identical everywhere).
      const t2 = hoisted.get(full);
      if (t2) {
        touched = fillProcFromRec(proc, t2.rec, t2.allowed) || touched;
      }
      // T3a — per-visit paren-stripped, unique on both sides in THIS visit.
      if (loose && aligned) {
        const cands = visitByLoose.get(loose);
        if (cands && cands.length === 1 && gridVisitLooseCount.get(loose) === 1 && normLabelFull(String(cands[0].label)) !== full) {
          touched = fillProcFromRec(proc, cands[0], ALL_PROC_FIELDS) || touched;
        } else if (cands && cands.length > 1) {
          recovery.collisions.push(`${visit.visit_name} :: ${loose} (loose ×${cands.length})`);
        }
      }
      // T3b — global paren-stripped, unique on both sides, hoisted fields only.
      if (loose) {
        const llmFulls = llmLooseFulls.get(loose);
        const gridFulls = gridLooseFulls.get(loose);
        if (llmFulls && llmFulls.size === 1 && gridFulls && gridFulls.size === 1) {
          const target = [...llmFulls][0];
          if (target !== full) {
            const h = hoisted.get(target);
            if (h) touched = fillProcFromRec(proc, h.rec, h.allowed) || touched;
          }
        }
      }

      if (touched) recovery.bound += 1;
      const hasNarrative = (typeof proc.description === "string" && proc.description.trim().length > 0) ||
        (Array.isArray(proc.conditions) && proc.conditions.length > 0) ||
        proc.timing != null;
      if (!hasNarrative) {
        recovery.unbound.push({
          visit: visit.visit_name,
          label: proc.label,
          had_candidate: occByFull.has(full) || (loose ? llmLooseFulls.has(loose) : false),
        });
      }
    }

    // ---- visit-level fills (aligned pairs only) ---------------------------
    if (aligned) {
      const raw = aligned.raw;
      if (visit.visit_purpose === "" && typeof raw.visit_purpose === "string" && raw.visit_purpose.trim()) {
        visit.visit_purpose = raw.visit_purpose.trim();
        recovery.visit_purpose_recovered += 1;
      }
      if (
        (!Array.isArray(visit.cross_references) || visit.cross_references.length === 0) &&
        Array.isArray(raw.cross_references) && raw.cross_references.length > 0
      ) {
        visit.cross_references = raw.cross_references;
        recovery.cross_references_recovered += 1;
      }
      // E1 — window recovery: grid 0/0 means the header stated none (parser
      // default), NOT a zero-day window; the narrative reading may carry a
      // prose-stated window. A nonzero grid window is never touched — if the
      // two readings disagree there, that is divergence detection's finding.
      const lm = typeof raw.window_minus_days === "number" && Number.isFinite(raw.window_minus_days)
        ? Math.max(0, Math.trunc(raw.window_minus_days))
        : null;
      const lp = typeof raw.window_plus_days === "number" && Number.isFinite(raw.window_plus_days)
        ? Math.max(0, Math.trunc(raw.window_plus_days))
        : null;
      if (visit.window_minus_days === 0 && visit.window_plus_days === 0 && ((lm ?? 0) > 0 || (lp ?? 0) > 0)) {
        visit.window_minus_days = lm ?? 0;
        visit.window_plus_days = lp ?? 0;
        recovery.window_filled_from_narrative.push(visit.visit_name);
      }
    }
  }

  return recovery;
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
