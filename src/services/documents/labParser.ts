/**
 * Lab row extraction (spec §12.1).
 *
 * Requirements that shape this parser:
 *   • numeric, percentage AND qualitative values
 *   • inequality symbols (`<0.01`), decimal commas (`5,4`), locale formats
 *   • the laboratory's own analyte name and unit, preserved verbatim
 *   • printed reference range and abnormal flag captured *separately*
 *
 * The last point is the important one. "Normal" is a property of the lab's
 * printed range, never AIDr.'s judgement — keeping them in different columns is
 * what makes the safety rule enforceable downstream.
 */

import { labsRepo, newId } from '../persistence/db';
import type { LabResult } from '../../domain/models';

/**
 * A lab line, loosely:
 *   Haemoglobin        13.4    g/dL     13.0 - 17.0      N
 *   Vitamin D          <10     ng/mL    30 - 100         L
 *   Culture            No growth
 */
const ROW = new RegExp(
  [
    '^\\s*',
    '(?<name>[A-Za-z][A-Za-z0-9 ()/%.,\'’+-]{2,44}?)',        // analyte, verbatim
    '\\s{2,}|\\s*[:\\t]\\s*',                                   // separator
  ].join(''),
);

const VALUE = /(?<op><=?|>=?|≤|≥)?\s*(?<num>\d{1,3}(?:[.,]\d{1,3})?)\s*(?<pct>%)?/;
const RANGE = /(?<lo>\d{1,3}(?:[.,]\d{1,3})?)\s*(?:-|–|—|to)\s*(?<hi>\d{1,3}(?:[.,]\d{1,3})?)/;
const FLAG = /\b(H|L|HIGH|LOW|ABNORMAL|A|N|NORMAL)\b\s*$/i;

const QUALITATIVE = [
  'positive', 'negative', 'reactive', 'non-reactive', 'nonreactive',
  'detected', 'not detected', 'no growth', 'trace', 'nil', 'absent', 'present',
];

const UNITS = [
  'g/dL', 'g/L', 'mg/dL', 'mg/L', 'mmol/L', 'µmol/L', 'umol/L', 'ng/mL', 'pg/mL',
  'IU/L', 'U/L', 'mIU/L', 'mEq/L', '10^9/L', '10^12/L', 'fL', 'pg', '%', 'mm/hr',
  'cells/µL', 'x10E3/uL', 'ratio', 'sec',
];

export interface ParsedLabRow {
  nameOriginal: string;
  value: string;
  numericValue: number | null;
  unit: string | null;
  printedRange: string | null;
  flag: LabResult['flag'];
}

export function parseLabRows(text: string): ParsedLabRow[] {
  const rows: ParsedLabRow[] = [];
  const reportDateLine = text.split('\n').find((l) => /report(ed)?\s*(date|on)/i.test(l));

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (line.length < 6 || line.length > 160) continue;
    if (/reference range|analyte|test name|specimen/i.test(line) && !/\d/.test(line)) continue;

    const nameMatch = ROW.exec(line);
    if (!nameMatch?.groups?.name) continue;
    const nameOriginal = nameMatch.groups.name.trim().replace(/[.:]+$/, '');
    const remainder = line.slice(nameMatch[0].length);

    // Qualitative first — "No growth" must not be mangled into a number.
    const qualitative = QUALITATIVE.find((q) => remainder.toLowerCase().includes(q));
    if (qualitative && !/\d/.test(remainder)) {
      rows.push({
        nameOriginal,
        value: titleCase(qualitative),
        numericValue: null,
        unit: null,
        printedRange: null,
        flag: null,
      });
      continue;
    }

    const valueMatch = VALUE.exec(remainder);
    if (!valueMatch?.groups?.num) continue;

    const op = valueMatch.groups.op ?? '';
    const numText = valueMatch.groups.num;
    // Decimal comma → point, but only when it is clearly a decimal separator.
    const numeric = Number(numText.replace(',', '.'));

    const afterValue = remainder.slice(valueMatch.index + valueMatch[0].length);
    const rangeMatch = RANGE.exec(afterValue);
    const unit =
      UNITS.find((u) => afterValue.includes(u)) ??
      (valueMatch.groups.pct ? '%' : null);
    const flagMatch = FLAG.exec(line);

    rows.push({
      nameOriginal,
      value: `${op}${numText}${valueMatch.groups.pct ?? ''}`.trim(),
      numericValue: Number.isFinite(numeric) ? numeric : null,
      unit,
      // Verbatim, including the lab's own spacing and dash style.
      printedRange: rangeMatch ? rangeMatch[0] : null,
      flag: normaliseFlag(flagMatch?.[1]),
    });
  }

  return dedupe(rows);
}

export async function parseLabReport(text: string, sourceDocumentId: string): Promise<LabResult[]> {
  const reportDate = extractReportDate(text);
  const results: LabResult[] = parseLabRows(text).map((r) => ({
    id: newId(),
    nameOriginal: r.nameOriginal,
    normalizedCode: null, // LOINC mapping is a later phase; the printed name is authoritative
    value: r.value,
    numericValue: r.numericValue,
    unit: r.unit,
    printedRange: r.printedRange,
    flag: r.flag,
    reportDate,
    sourceDocumentId,
    correctedByUser: false,
  }));
  if (results.length) await labsRepo.saveMany(results);
  return results;
}

function normaliseFlag(raw?: string): LabResult['flag'] {
  if (!raw) return null;
  const f = raw.toUpperCase();
  if (f === 'H' || f === 'HIGH') return 'high';
  if (f === 'L' || f === 'LOW') return 'low';
  if (f === 'A' || f === 'ABNORMAL') return 'abnormal';
  if (f === 'N' || f === 'NORMAL') return 'normal';
  return null;
}

function extractReportDate(text: string): string | null {
  const m = text.match(
    /(?:report(?:ed)?|collected|drawn|sample)\s*(?:date|on)?\s*:?\s*(\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4})/i,
  );
  if (!m) return null;
  const d = new Date(m[1].replace(/[.]/g, '/'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** §12.1 — repeat imports of the same report must not duplicate rows. */
function dedupe(rows: ParsedLabRow[]): ParsedLabRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.nameOriginal.toLowerCase()}|${r.value}|${r.unit ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
