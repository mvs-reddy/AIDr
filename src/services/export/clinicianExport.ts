/**
 * Clinician export (spec §14).
 *
 * Produces a clean one-page PDF and, optionally, an expiring link. Two rules the
 * UI must never soften:
 *
 *   • Revocation stops *future* access. It cannot retrieve a PDF or screenshot
 *     someone has already saved, and the copy says so plainly.
 *   • The link token is high-entropy and only its hash is stored locally, so a
 *     stolen device database cannot reconstruct a live link.
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { Alert } from 'react-native';

import type { WorkflowRun, SharedExport } from '../../domain/models';
import { exportsRepo, newId } from '../persistence/db';
import { DISCLAIMER } from '../../domain/safety/policy';

const DEFAULT_EXPIRY_DAYS = 14;
const SHARE_BASE = 'https://share.aidr.app/r';

export type ExportResult =
  | { ok: true; uri: string; export: SharedExport | null }
  | { ok: false; message: string };

export async function createClinicianExport(
  run: WorkflowRun,
  options: { createLink?: boolean; expiryDays?: number } = {},
): Promise<ExportResult> {
  if (!run.output) return { ok: false, message: 'This run has no result to export.' };

  const { createLink = false, expiryDays = DEFAULT_EXPIRY_DAYS } = options;

  let record: SharedExport | null = null;
  let linkURL: string | null = null;

  if (createLink) {
    // 32 bytes of entropy → ~256 bits. Only the hash is persisted.
    const tokenBytes = await Crypto.getRandomBytesAsync(32);
    const token = [...tokenBytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    const tokenHash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token);

    linkURL = `${SHARE_BASE}/${token}`;
    record = {
      id: newId(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiryDays * 86_400_000).toISOString(),
      revokedAt: null,
      secureLinkTokenHash: tokenHash,
      runId: run.id,
      label: run.output.headline.slice(0, 60),
    };
    await exportsRepo.create(record);
  }

  try {
    const { uri } = await Print.printToFileAsync({
      html: buildHTML(run, linkURL, record?.expiresAt ?? null),
      base64: false,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: 'Share with your clinician',
        UTI: 'com.adobe.pdf',
      });
    }

    if (record) {
      Alert.alert(
        'Link created',
        `This link expires ${new Date(record.expiresAt).toLocaleDateString()}. You can revoke it in Settings, but revoking cannot pull back a file someone already saved.`,
      );
    }

    return { ok: true, uri, export: record };
  } catch {
    return { ok: false, message: 'AIDr. could not generate the PDF. Try again in a moment.' };
  }
}

/**
 * Print stylesheet. Deliberately plain: a clinician has thirty seconds, so the
 * questions come first and the provenance sits in the footer.
 */
function buildHTML(run: WorkflowRun, linkURL: string | null, expiresAt: string | null): string {
  const out = run.output!;
  const created = new Date(run.createdAt).toLocaleString();

  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body { font: 10.5pt/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #23291F; margin: 0; }
  header { display: flex; justify-content: space-between; align-items: flex-start;
           border-bottom: 2px solid #23291F; padding-bottom: 8px; margin-bottom: 16px; }
  .brand { font-size: 16pt; font-weight: 700; letter-spacing: -0.3px; }
  .meta { text-align: right; font-size: 8.5pt; color: #6A7163; line-height: 1.45; }
  h1 { font-size: 14pt; margin: 0 0 6px; letter-spacing: -0.2px; }
  h2 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 1.1px;
       color: #A2502E; margin: 18px 0 7px; }
  .summary { font-size: 10.5pt; color: #3D4438; margin: 0 0 4px; }
  ol, ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 5px; }
  .obs { border-left: 2px solid #E0D8C8; padding: 0 0 0 10px; margin-bottom: 9px; }
  .refs { font-size: 8pt; color: #8A9080; margin-top: 2px; }
  .unsure { background: #F6F2E8; border-radius: 6px; padding: 9px 11px; font-size: 9pt; color: #5A6154; }
  footer { margin-top: 22px; border-top: 1px solid #DDD6C6; padding-top: 9px;
           font-size: 8pt; color: #7A8072; display: flex; justify-content: space-between; gap: 14px; }
  .qr { text-align: center; font-size: 7.5pt; color: #7A8072; }
  .qr img { display: block; width: 74px; height: 74px; margin-bottom: 3px; }
</style></head><body>

<header>
  <div>
    <div class="brand">AIDr.</div>
    <div style="font-size:8.5pt;color:#6A7163">Patient-prepared summary</div>
  </div>
  <div class="meta">
    Prepared ${escapeHTML(created)}<br>
    Model: ${escapeHTML(run.modelLabel ?? 'not recorded')}<br>
    Payload fingerprint: ${escapeHTML((run.redactedPayloadHash ?? '').slice(0, 16))}
  </div>
</header>

<h1>${escapeHTML(out.headline)}</h1>
${out.summary.map((s) => `<p class="summary">${escapeHTML(s)}</p>`).join('')}

${
  out.urgentSafetyMessage
    ? `<div style="border:1.5px solid #A44227;background:#F6E2DA;border-radius:6px;padding:10px 12px;margin:14px 0;font-size:10pt">
         <strong>Urgent:</strong> ${escapeHTML(out.urgentSafetyMessage)}
       </div>`
    : ''
}

${
  out.questionsForClinician.length
    ? `<h2>Questions the patient would like to discuss</h2>
       <ol>${out.questionsForClinician.map((q) => `<li>${escapeHTML(q)}</li>`).join('')}</ol>`
    : ''
}

${
  out.observations.length
    ? `<h2>Observations from patient-authorised data</h2>
       ${out.observations
         .map(
           (o) => `<div class="obs">
             ${escapeHTML(o.statement)}
             <div class="refs">${escapeHTML(o.confidence)} confidence · ${o.evidenceRefs.map(escapeHTML).join(' · ')}</div>
           </div>`,
         )
         .join('')}`
    : ''
}

${
  out.uncertainties.length
    ? `<h2>Stated limitations</h2>
       <div class="unsure"><ul>${out.uncertainties.map((u) => `<li>${escapeHTML(u)}</li>`).join('')}</ul></div>`
    : ''
}

<footer>
  <div style="flex:1">
    <strong>${escapeHTML(DISCLAIMER)}</strong><br>
    Generated by AIDr. from data the patient authorised on their own device. Observations compare the
    patient against their own historical range, not a population reference. Values quoted from a
    laboratory report retain that laboratory's printed reference range.
    ${
      expiresAt
        ? `<br><br>Secure link expires ${escapeHTML(new Date(expiresAt).toLocaleDateString())}. The patient can revoke future access at any time; revocation cannot retract a copy already saved.`
        : ''
    }
  </div>
  ${
    linkURL
      ? `<div class="qr">
           <img src="${qrDataURL(linkURL)}" alt="QR code linking to the secure copy">
           Scan for the secure copy
         </div>`
      : ''
  }
</footer>
</body></html>`;
}

/**
 * QR rendering. `qrcode` runs fine in RN, but generating the matrix here keeps
 * the PDF self-contained with no network fetch at print time.
 */
function qrDataURL(text: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const QR = require('qrcode-generator');
  const qr = QR(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(4, 0);
}

function escapeHTML(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
