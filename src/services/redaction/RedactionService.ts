/**
 * On-device redaction (spec §9.2).
 *
 * This is the single chokepoint between local data and any network call.
 * Nothing reaches `AIProvider` without passing through `redact()`.
 *
 * Design notes
 * ------------
 * • Two engines. A deterministic pattern layer always runs. An optional Core ML
 *   / TFLite clinical-NER pack ("OpenMed PII", ~40 MB) raises recall on free
 *   text such as clinic notes. The pack is a *strengthener*, never a gate: if it
 *   is absent the pattern layer plus the platform NER fallback still runs.
 * • Spans carry character offsets so the UI can highlight exactly what will go,
 *   and so the placeholder map can be reversed for local display only.
 * • The reversible map lives in memory for the current session only and is
 *   never serialised (§9.2). `dispose()` clears it.
 */

import * as Crypto from 'expo-crypto';
import type { NERBackend } from './nerBackend';
import { getNERBackend } from './nerBackend';

export type EntityClass =
  | 'person' | 'date' | 'address' | 'phone' | 'email' | 'healthRecordNumber'
  | 'accountNumber' | 'nationalId' | 'insuranceId' | 'clinicianName'
  | 'facility' | 'url' | 'deviceIdentifier' | 'age90Plus';

export interface RedactionSpan {
  start: number;
  end: number;
  text: string;
  entity: EntityClass;
  confidence: number;
  /** `auto` spans are removed silently; `review` spans block the send (§16). */
  disposition: 'auto' | 'review';
  placeholder: string;
}

export interface RedactionResult {
  redactedText: string;
  spans: RedactionSpan[];
  /** True when any span needs the user's eyes before a cloud send. */
  requiresReview: boolean;
  engine: string;
  /** SHA-256 of `redactedText` — recorded in the privacy log as proof of payload. */
  payloadHash: string;
}

const AUTO_THRESHOLD = 0.9;
const REVIEW_THRESHOLD = 0.55;

/**
 * Deterministic patterns. Ordered most-specific first; overlapping matches are
 * resolved by span length so `NHS 485 777 3456` wins over the bare digits.
 */
const PATTERNS: Array<{ entity: EntityClass; re: RegExp; confidence: number }> = [
  // ── Person names ──────────────────────────────────────────────────────────
  // Names are the highest-value PHI class, so the pattern layer must catch the
  // common cases rather than delegating entirely to the optional NER pack. Three
  // tiers, by how much surrounding evidence there is:
  //
  //   1. Explicitly labelled — "Patient: Sarah Mills". Near-certain.
  //   2. Adjacent to an identifier cue — a capitalised name immediately before a
  //      DOB, record number or age. Very likely.
  //   3. Line-initial "Firstname Lastname," with nothing else to go on. This
  //      will occasionally catch a clinical term ("Blood Pressure, 120/80"), so
  //      it sits at review confidence: the user sees it and decides, rather than
  //      AIDr. silently mangling a lab row.
  {
    // Character classes rather than an `i` flag: the cue word may be capitalised,
    // but `[A-Z]` on the name itself must stay strict or this matches any two
    // lowercase words. The colon is required — "Patient:" and "Name:" are how
    // clinical documents actually label this, and demanding it keeps the tier
    // precise enough to auto-redact without review.
    entity: 'person',
    re: /\b(?:[Pp]atient|[Pp]t|[Nn]ame|[Ss]urname|[Gg]iven[ ][Nn]ame)(?:[ ][Nn]ame)?\s*:\s*([A-Z][a-z'’-]{1,18}(?:\s+[A-Z][a-z'’-]{1,20}){1,2})\b/g,
    confidence: 0.97,
  },
  {
    entity: 'person',
    re: /\b[A-Z][a-z'’-]{1,18}(?:\s+[A-Z][a-z'’-]{1,20}){1,2}(?=\s*,?\s*(?:DOB\b|D\.O\.B|date of birth|NHS\b|MRN\b|UHID\b|ABHA\b|aged?\s+\d))/g,
    confidence: 0.94,
  },
  {
    entity: 'person',
    re: /^[A-Z][a-z'’-]{1,18}\s+[A-Z][a-z'’-]{1,20}(?=\s*,)/gm,
    confidence: 0.72,
  },

  { entity: 'email', re: /\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.99 },
  { entity: 'url', re: /\bhttps?:\/\/\S+/gi, confidence: 0.97 },
  // UK NHS number, 3-3-4 grouping.
  { entity: 'healthRecordNumber', re: /\bNHS\s*(?:no\.?|number)?\s*:?\s*\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/gi, confidence: 0.99 },
  { entity: 'healthRecordNumber', re: /\b(?:MRN|UHID|patient\s*id|hospital\s*(?:no|number))\s*:?\s*[A-Z0-9-]{4,}\b/gi, confidence: 0.97 },
  // India Aadhaar (12 digits, 4-4-4) and ABHA.
  { entity: 'nationalId', re: /\b\d{4}\s\d{4}\s\d{4}\b/g, confidence: 0.93 },
  { entity: 'nationalId', re: /\b\d{2}-\d{4}-\d{4}-\d{4}\b/g, confidence: 0.95 },
  // US SSN.
  { entity: 'nationalId', re: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.98 },
  { entity: 'insuranceId', re: /\b(?:policy|member|insurance)\s*(?:no\.?|number|id)\s*:?\s*[A-Z0-9-]{5,}\b/gi, confidence: 0.95 },
  { entity: 'accountNumber', re: /\b(?:acct|account)\s*(?:no\.?|number)?\s*:?\s*\d{6,}\b/gi, confidence: 0.94 },
  { entity: 'phone', re: /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,5}[\s-]?\d{3,4}[\s-]?\d{0,4}(?=\b)/g, confidence: 0.72 },
  { entity: 'date', re: /\b(?:DOB|D\.O\.B\.|date of birth)\s*:?\s*\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}\b/gi, confidence: 0.99 },
  { entity: 'date', re: /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:19|20)\d{2}\b/g, confidence: 0.8 },
  { entity: 'date', re: /\b(?:0?[1-9]|[12]\d|3[01])\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(?:19|20)\d{2}\b/gi, confidence: 0.85 },
  { entity: 'clinicianName', re: /\b(?:Dr|Doctor|Prof|Consultant)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/g, confidence: 0.9 },
  { entity: 'facility', re: /\b[A-Z][A-Za-z'’]+(?:\s+[A-Z][A-Za-z'’]+)*\s+(?:Hospital|Clinic|Medical Cent(?:re|er)|Surgery|Infirmary|Laborator(?:y|ies))\b/g, confidence: 0.9 },
  { entity: 'address', re: /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:Street|St|Road|Rd|Avenue|Ave|Lane|Ln|Drive|Dr|Close|Way|Boulevard|Blvd)\b/g, confidence: 0.88 },
  // UK postcode / US ZIP+4.
  { entity: 'address', re: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/g, confidence: 0.9 },
  { entity: 'address', re: /\b\d{5}(?:-\d{4})?\b(?=\s|,|$)/g, confidence: 0.6 },
  // HIPAA safe-harbour: ages over 89 must be generalised.
  { entity: 'age90Plus', re: /\b(9\d|1\d{2})\s*(?:years old|y\/o|yo)\b/gi, confidence: 0.92 },
  { entity: 'deviceIdentifier', re: /\b(?:serial|device|IMEI)\s*(?:no\.?|number|id)?\s*:?\s*[A-Z0-9-]{6,}\b/gi, confidence: 0.93 },
];

export class RedactionService {
  private reversible = new Map<string, string>();
  private counters = new Map<EntityClass, number>();
  private ner: NERBackend | null = null;

  /** Loads the optional on-device NER pack. Safe to call repeatedly. */
  async prepare(): Promise<{ engine: string; packReady: boolean }> {
    this.ner = await getNERBackend();
    return { engine: this.engineName(), packReady: this.ner?.kind === 'clinicalPack' };
  }

  engineName(): string {
    if (this.ner?.kind === 'clinicalPack') return 'patterns+clinical-pii-pack';
    if (this.ner?.kind === 'platform') return 'patterns+platform-ner';
    return 'patterns';
  }

  async redact(input: string): Promise<RedactionResult> {
    if (!input.trim()) {
      return {
        redactedText: '',
        spans: [],
        requiresReview: false,
        engine: this.engineName(),
        payloadHash: await sha256(''),
      };
    }

    const raw: RedactionSpan[] = [];

    for (const { entity, re, confidence } of PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(input)) !== null) {
        if (!m[0].trim()) continue;

        // When a pattern captures a group, redact only that group. A cue-based
        // pattern like "Patient: Sarah Mills" matches the label too, and
        // replacing the whole match would silently delete the label — leaving a
        // clinician reading the export unable to tell what the placeholder was.
        const target = m[1] ?? m[0];
        const offset = m[1] ? m[0].indexOf(m[1]) : 0;
        const start = m.index + offset;

        raw.push({
          start,
          end: start + target.length,
          text: target,
          entity,
          confidence,
          disposition: 'auto',
          placeholder: '',
        });
        if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
      }
    }

    if (this.ner) {
      for (const e of await this.ner.detect(input)) {
        raw.push({ ...e, disposition: 'auto', placeholder: '' });
      }
    }

    const spans = this.resolve(raw);
    const redactedText = this.apply(input, spans);

    return {
      redactedText,
      spans,
      requiresReview: spans.some((s) => s.disposition === 'review'),
      engine: this.engineName(),
      payloadHash: await sha256(redactedText),
    };
  }

  /**
   * Drop spans below the review floor, de-overlap (longest wins, then highest
   * confidence), assign stable placeholders, and sort by position.
   */
  private resolve(raw: RedactionSpan[]): RedactionSpan[] {
    const viable = raw
      .filter((s) => s.confidence >= REVIEW_THRESHOLD)
      .sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.confidence - a.confidence);

    const kept: RedactionSpan[] = [];
    for (const s of viable) {
      if (kept.some((k) => s.start < k.end && k.start < s.end)) continue;
      kept.push(s);
    }

    this.counters.clear();
    return kept
      .sort((a, b) => a.start - b.start)
      .map((s) => {
        const n = (this.counters.get(s.entity) ?? 0) + 1;
        this.counters.set(s.entity, n);
        const placeholder = `[${labelFor(s.entity)}_${n}]`;
        this.reversible.set(placeholder, s.text);
        return {
          ...s,
          placeholder,
          disposition: s.confidence >= AUTO_THRESHOLD ? ('auto' as const) : ('review' as const),
        };
      });
  }

  private apply(input: string, spans: RedactionSpan[]): string {
    let out = '';
    let cursor = 0;
    for (const s of spans) {
      out += input.slice(cursor, s.start) + s.placeholder;
      cursor = s.end;
    }
    return out + input.slice(cursor);
  }

  /** Restore placeholders for on-screen display only. Never for a payload. */
  restoreForDisplay(text: string): string {
    let out = text;
    for (const [placeholder, original] of this.reversible) {
      out = out.split(placeholder).join(original);
    }
    return out;
  }

  /** Drop the session map. Called on background, sign-out and run completion. */
  dispose(): void {
    this.reversible.clear();
    this.counters.clear();
  }
}

function labelFor(e: EntityClass): string {
  return {
    person: 'NAME', clinicianName: 'CLINICIAN', date: 'DATE', address: 'ADDRESS',
    phone: 'PHONE', email: 'EMAIL', healthRecordNumber: 'RECORD_ID',
    accountNumber: 'ACCOUNT', nationalId: 'NATIONAL_ID', insuranceId: 'INSURANCE',
    facility: 'FACILITY', url: 'LINK', deviceIdentifier: 'DEVICE', age90Plus: 'AGE',
  }[e];
}

async function sha256(s: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, s);
}

/** Process-wide singleton — one session map, one dispose point. */
export const redactionService = new RedactionService();
