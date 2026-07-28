/**
 * Lab parsing (spec §12.1). The printed reference range must survive verbatim
 * and stay in its own field, because "normal" is the lab's word, not AIDr.'s.
 */

import { parseLabRows } from '../../services/documents/labParser';

describe('lab row extraction', () => {
  it('parses a standard numeric row with range and flag', () => {
    const rows = parseLabRows('Haemoglobin        13.4    g/dL     13.0 - 17.0      N');
    expect(rows[0]).toMatchObject({
      nameOriginal: 'Haemoglobin',
      value: '13.4',
      numericValue: 13.4,
      unit: 'g/dL',
      printedRange: '13.0 - 17.0',
      flag: 'normal',
    });
  });

  it('preserves inequality symbols', () => {
    const rows = parseLabRows('Vitamin D          <10     ng/mL    30 - 100         L');
    expect(rows[0].value).toBe('<10');
    expect(rows[0].flag).toBe('low');
  });

  it('handles decimal commas', () => {
    const rows = parseLabRows('Kreatinin          5,4     mg/dL');
    expect(rows[0].numericValue).toBeCloseTo(5.4);
  });

  it('keeps qualitative results as text, not numbers', () => {
    const rows = parseLabRows('Urine Culture      No growth');
    expect(rows[0]).toMatchObject({ value: 'No Growth', numericValue: null });
  });

  it('parses percentages', () => {
    const rows = parseLabRows('HbA1c              5.9%    %        4.0 - 5.6        H');
    expect(rows[0].unit).toBe('%');
    expect(rows[0].flag).toBe('high');
  });

  it('preserves the laboratory analyte name verbatim', () => {
    const rows = parseLabRows('eGFR (CKD-EPI)     88      mL/min/1.73    >60');
    expect(rows[0].nameOriginal).toBe('eGFR (CKD-EPI)');
  });

  it('skips header rows', () => {
    const rows = parseLabRows('Test Name          Result   Units    Reference Range   Flag');
    expect(rows).toHaveLength(0);
  });

  it('de-duplicates identical rows from a repeat import', () => {
    const text = 'Sodium   140   mmol/L   135 - 145\nSodium   140   mmol/L   135 - 145';
    expect(parseLabRows(text)).toHaveLength(1);
  });
});
