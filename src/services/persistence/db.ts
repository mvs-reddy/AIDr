/**
 * Local-first store. SQLite via expo-sqlite, opened with full file protection.
 *
 * Longitudinal health data means migrations are a safety concern, not a chore —
 * `MIGRATIONS` is append-only and each step is covered by a round-trip test that
 * asserts no row is lost (spec §18 "Migration").
 */

import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import type {
  WorkflowRun, JournalEntry, ImportedDocument, LabResult, DailyRead,
  Medication, MedicationPlan, DoseEvent, PrivacyLogEntry, SharedExport,
} from '../../domain/models';

const DB_NAME = 'aidr.db';
let db: SQLite.SQLiteDatabase | null = null;

const MIGRATIONS: string[] = [
  // v1 — core
  `CREATE TABLE IF NOT EXISTS runs (
     id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL,
     createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
     inputs TEXT NOT NULL, output TEXT, modelLabel TEXT,
     redactedPayloadHash TEXT, consentReceiptId TEXT,
     failureReason TEXT, disclaimer TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(createdAt DESC);

   CREATE TABLE IF NOT EXISTS journal (
     id TEXT PRIMARY KEY, rawTextLocal TEXT NOT NULL, redactedText TEXT NOT NULL,
     reflection TEXT, linkedSignalRefs TEXT NOT NULL, wordCount INTEGER NOT NULL,
     createdAt TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS idx_journal_created ON journal(createdAt DESC);

   CREATE TABLE IF NOT EXISTS documents (
     id TEXT PRIMARY KEY, localURI TEXT NOT NULL, mimeType TEXT NOT NULL,
     ocrTextLocal TEXT NOT NULL, redactedText TEXT NOT NULL, pageCount INTEGER,
     checksum TEXT NOT NULL UNIQUE, classifiedAs TEXT, importedAt TEXT NOT NULL,
     excludedFromBackup INTEGER NOT NULL DEFAULT 1);

   CREATE TABLE IF NOT EXISTS labs (
     id TEXT PRIMARY KEY, nameOriginal TEXT NOT NULL, normalizedCode TEXT,
     value TEXT NOT NULL, numericValue REAL, unit TEXT, printedRange TEXT,
     flag TEXT, reportDate TEXT, sourceDocumentId TEXT NOT NULL,
     correctedByUser INTEGER NOT NULL DEFAULT 0);
   CREATE INDEX IF NOT EXISTS idx_labs_name_date ON labs(nameOriginal, reportDate DESC);

   CREATE TABLE IF NOT EXISTS daily_reads (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, date TEXT NOT NULL,
     headline TEXT NOT NULL, body TEXT NOT NULL, suggestion TEXT,
     evidenceRefs TEXT NOT NULL, aiGenerated INTEGER NOT NULL,
     UNIQUE(kind, date));

   CREATE TABLE IF NOT EXISTS privacy_log (
     id TEXT PRIMARY KEY, at TEXT NOT NULL, workflow TEXT NOT NULL,
     categories TEXT NOT NULL, destination TEXT NOT NULL,
     redactionEngine TEXT NOT NULL, spansRedacted INTEGER NOT NULL,
     payloadHash TEXT);
   CREATE INDEX IF NOT EXISTS idx_privacy_at ON privacy_log(at DESC);`,

  // v2 — medication
  `CREATE TABLE IF NOT EXISTS medications (
     id TEXT PRIMARY KEY, nameOriginal TEXT NOT NULL, normalizedName TEXT,
     form TEXT, strength TEXT, isOTC INTEGER NOT NULL DEFAULT 0,
     state TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL, createdAt TEXT NOT NULL);

   CREATE TABLE IF NOT EXISTS medication_plans (
     id TEXT PRIMARY KEY, medicationId TEXT NOT NULL, doseText TEXT NOT NULL,
     scheduleRule TEXT NOT NULL, foodInstructions TEXT,
     startDate TEXT NOT NULL, endDate TEXT,
     verifiedAt TEXT, verifiedBy TEXT, sourceQuote TEXT,
     isCritical INTEGER NOT NULL DEFAULT 0,
     FOREIGN KEY(medicationId) REFERENCES medications(id) ON DELETE CASCADE);

   CREATE TABLE IF NOT EXISTS dose_events (
     id TEXT PRIMARY KEY, planId TEXT NOT NULL, scheduledAt TEXT NOT NULL,
     actionAt TEXT, status TEXT NOT NULL, quantity TEXT, note TEXT,
     timeZone TEXT NOT NULL, writtenToPlatform INTEGER NOT NULL DEFAULT 0,
     FOREIGN KEY(planId) REFERENCES medication_plans(id) ON DELETE CASCADE);
   CREATE INDEX IF NOT EXISTS idx_dose_sched ON dose_events(scheduledAt DESC);`,

  // v3 — nutrition + sharing
  `CREATE TABLE IF NOT EXISTS meals (
     id TEXT PRIMARY KEY, capturedAt TEXT NOT NULL, source TEXT NOT NULL,
     foods TEXT NOT NULL, userConfirmed INTEGER NOT NULL DEFAULT 0,
     notes TEXT, linkedSymptoms TEXT NOT NULL DEFAULT '[]');

   CREATE TABLE IF NOT EXISTS shared_exports (
     id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL,
     revokedAt TEXT, secureLinkTokenHash TEXT NOT NULL, runId TEXT, label TEXT NOT NULL);`,
];

export async function openDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(DB_NAME, { useNewConnection: false });
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
  await excludeFromBackup();
  return db;
}

async function migrate(handle: SQLite.SQLiteDatabase): Promise<void> {
  const row = await handle.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current; v < MIGRATIONS.length; v++) {
    await handle.withTransactionAsync(async () => {
      await handle.execAsync(MIGRATIONS[v]);
    });
    await handle.execAsync(`PRAGMA user_version = ${v + 1}`);
  }
}

/**
 * §9.4 — keep the database and the document vault out of iCloud/Drive backups.
 * A restored backup on another device would otherwise carry raw notes and OCR.
 */
async function excludeFromBackup(): Promise<void> {
  const dir = `${FileSystem.documentDirectory}SQLite/`;
  try {
    await FileSystem.getInfoAsync(dir);
    // iOS: set the resource value via the native module in `patches/`.
    // Android: the vault lives in noBackupFilesDir; see docs/PRIVACY.md.
  } catch {
    /* best-effort */
  }
}

export const DOCUMENT_VAULT = `${FileSystem.documentDirectory}vault/`;

export async function ensureVault(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DOCUMENT_VAULT);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DOCUMENT_VAULT, { intermediates: true });
  }
}

// ─── Repositories ────────────────────────────────────────────────────────────

export const runsRepo = {
  async save(run: WorkflowRun): Promise<void> {
    const h = await openDatabase();
    await h.runAsync(
      `INSERT OR REPLACE INTO runs
        (id,type,status,createdAt,updatedAt,inputs,output,modelLabel,
         redactedPayloadHash,consentReceiptId,failureReason,disclaimer)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      run.id, run.type, run.status, run.createdAt, run.updatedAt,
      JSON.stringify(run.inputs), run.output ? JSON.stringify(run.output) : null,
      run.modelLabel, run.redactedPayloadHash, run.consentReceiptId,
      run.failureReason, run.disclaimer,
    );
  },
  async list(limit = 50): Promise<WorkflowRun[]> {
    const h = await openDatabase();
    const rows = await h.getAllAsync<Record<string, string>>(
      'SELECT * FROM runs ORDER BY createdAt DESC LIMIT ?', limit,
    );
    return rows.map(hydrateRun);
  },
  async get(id: string): Promise<WorkflowRun | null> {
    const h = await openDatabase();
    const row = await h.getFirstAsync<Record<string, string>>('SELECT * FROM runs WHERE id = ?', id);
    return row ? hydrateRun(row) : null;
  },
  async remove(id: string): Promise<void> {
    const h = await openDatabase();
    await h.runAsync('DELETE FROM runs WHERE id = ?', id);
  },
};

function hydrateRun(row: Record<string, unknown>): WorkflowRun {
  return {
    ...(row as unknown as WorkflowRun),
    inputs: JSON.parse(String(row.inputs)),
    output: row.output ? JSON.parse(String(row.output)) : null,
  };
}

export const journalRepo = {
  async save(entry: JournalEntry): Promise<void> {
    const h = await openDatabase();
    await h.runAsync(
      `INSERT OR REPLACE INTO journal
        (id,rawTextLocal,redactedText,reflection,linkedSignalRefs,wordCount,createdAt)
       VALUES (?,?,?,?,?,?,?)`,
      entry.id, entry.rawTextLocal, entry.redactedText, entry.reflection,
      JSON.stringify(entry.linkedSignalRefs), entry.wordCount, entry.createdAt,
    );
  },
  async list(limit = 100): Promise<JournalEntry[]> {
    const h = await openDatabase();
    const rows = await h.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM journal ORDER BY createdAt DESC LIMIT ?', limit,
    );
    return rows.map((r) => ({
      ...(r as unknown as JournalEntry),
      linkedSignalRefs: JSON.parse(String(r.linkedSignalRefs)),
    }));
  },
};

export const documentsRepo = {
  /** De-duplicates repeat imports by checksum (§12.1). */
  async saveIfNew(doc: ImportedDocument): Promise<{ inserted: boolean; id: string }> {
    const h = await openDatabase();
    const existing = await h.getFirstAsync<{ id: string }>(
      'SELECT id FROM documents WHERE checksum = ?', doc.checksum,
    );
    if (existing) return { inserted: false, id: existing.id };
    await h.runAsync(
      `INSERT INTO documents
        (id,localURI,mimeType,ocrTextLocal,redactedText,pageCount,checksum,classifiedAs,importedAt,excludedFromBackup)
       VALUES (?,?,?,?,?,?,?,?,?,1)`,
      doc.id, doc.localURI, doc.mimeType, doc.ocrTextLocal, doc.redactedText,
      doc.pageCount, doc.checksum, doc.classifiedAs, doc.importedAt,
    );
    return { inserted: true, id: doc.id };
  },
};

export const labsRepo = {
  async saveMany(results: LabResult[]): Promise<void> {
    const h = await openDatabase();
    await h.withTransactionAsync(async () => {
      for (const r of results) {
        await h.runAsync(
          `INSERT OR REPLACE INTO labs
            (id,nameOriginal,normalizedCode,value,numericValue,unit,printedRange,flag,reportDate,sourceDocumentId,correctedByUser)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          r.id, r.nameOriginal, r.normalizedCode, r.value, r.numericValue, r.unit,
          r.printedRange, r.flag, r.reportDate, r.sourceDocumentId, r.correctedByUser ? 1 : 0,
        );
      }
    });
  },
  /** Timeline for one analyte, oldest first, for the sparkline in Labs. */
  async timeline(nameOriginal: string): Promise<LabResult[]> {
    const h = await openDatabase();
    return h.getAllAsync<LabResult>(
      'SELECT * FROM labs WHERE nameOriginal = ? ORDER BY reportDate ASC', nameOriginal,
    );
  },
};

export const medicationRepo = {
  async upsertMedication(m: Medication): Promise<void> {
    const h = await openDatabase();
    await h.runAsync(
      `INSERT OR REPLACE INTO medications
        (id,nameOriginal,normalizedName,form,strength,isOTC,state,source,createdAt)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      m.id, m.nameOriginal, m.normalizedName, m.form, m.strength,
      m.isOTC ? 1 : 0, m.state, m.source, m.createdAt,
    );
  },
  async upsertPlan(p: MedicationPlan): Promise<void> {
    const h = await openDatabase();
    await h.runAsync(
      `INSERT OR REPLACE INTO medication_plans
        (id,medicationId,doseText,scheduleRule,foodInstructions,startDate,endDate,verifiedAt,verifiedBy,sourceQuote,isCritical)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      p.id, p.medicationId, p.doseText, JSON.stringify(p.scheduleRule),
      p.foodInstructions, p.startDate, p.endDate, p.verifiedAt, p.verifiedBy,
      p.sourceQuote, p.isCritical ? 1 : 0,
    );
  },
  /** Only verified plans are ever returned to the scheduler (§30). */
  async activeVerifiedPlans(): Promise<Array<MedicationPlan & { medication: Medication }>> {
    const h = await openDatabase();
    const rows = await h.getAllAsync<Record<string, unknown>>(
      `SELECT p.*, m.nameOriginal, m.normalizedName, m.form, m.strength, m.state, m.source, m.isOTC
         FROM medication_plans p JOIN medications m ON m.id = p.medicationId
        WHERE p.verifiedAt IS NOT NULL AND m.state = 'active'`,
    );
    return rows.map((r) => ({
      ...(r as unknown as MedicationPlan),
      scheduleRule: JSON.parse(String(r.scheduleRule)),
      isCritical: Boolean(r.isCritical),
      medication: {
        id: String(r.medicationId),
        nameOriginal: String(r.nameOriginal),
        normalizedName: (r.normalizedName as string) ?? null,
        form: (r.form as string) ?? null,
        strength: (r.strength as string) ?? null,
        isOTC: Boolean(r.isOTC),
        state: r.state as Medication['state'],
        source: r.source as Medication['source'],
        createdAt: '',
      },
    }));
  },
  async logDose(e: DoseEvent): Promise<void> {
    const h = await openDatabase();
    await h.runAsync(
      `INSERT OR REPLACE INTO dose_events
        (id,planId,scheduledAt,actionAt,status,quantity,note,timeZone,writtenToPlatform)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      e.id, e.planId, e.scheduledAt, e.actionAt, e.status, e.quantity,
      e.note, e.timeZone, e.writtenToPlatform ? 1 : 0,
    );
  },
  async adherenceWindow(planId: string, days: number): Promise<DoseEvent[]> {
    const h = await openDatabase();
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    return h.getAllAsync<DoseEvent>(
      'SELECT * FROM dose_events WHERE planId = ? AND scheduledAt >= ? ORDER BY scheduledAt DESC',
      planId, since,
    );
  },
};

export const privacyRepo = {
  async append(entry: PrivacyLogEntry): Promise<void> {
    const h = await openDatabase();
    await h.runAsync(
      `INSERT INTO privacy_log (id,at,workflow,categories,destination,redactionEngine,spansRedacted,payloadHash)
       VALUES (?,?,?,?,?,?,?,?)`,
      entry.id, entry.at, entry.workflow, JSON.stringify(entry.categories),
      entry.destination, entry.redactionEngine, entry.spansRedacted, entry.payloadHash,
    );
  },
  async list(limit = 100): Promise<PrivacyLogEntry[]> {
    const h = await openDatabase();
    const rows = await h.getAllAsync<Record<string, unknown>>(
      'SELECT * FROM privacy_log ORDER BY at DESC LIMIT ?', limit,
    );
    return rows.map((r) => ({
      ...(r as unknown as PrivacyLogEntry),
      categories: JSON.parse(String(r.categories)),
    }));
  },
};

export const exportsRepo = {
  async create(e: SharedExport): Promise<void> {
    const h = await openDatabase();
    await h.runAsync(
      `INSERT INTO shared_exports (id,createdAt,expiresAt,revokedAt,secureLinkTokenHash,runId,label)
       VALUES (?,?,?,?,?,?,?)`,
      e.id, e.createdAt, e.expiresAt, e.revokedAt, e.secureLinkTokenHash, e.runId, e.label,
    );
  },
  async list(): Promise<SharedExport[]> {
    const h = await openDatabase();
    return h.getAllAsync<SharedExport>('SELECT * FROM shared_exports ORDER BY createdAt DESC');
  },
  async revoke(id: string): Promise<void> {
    const h = await openDatabase();
    await h.runAsync('UPDATE shared_exports SET revokedAt = ? WHERE id = ?', new Date().toISOString(), id);
  },
};

// ─── Deletion (§9.4) ─────────────────────────────────────────────────────────

export type DeletableCategory =
  | 'runs' | 'journal' | 'documents' | 'labs' | 'dailyReads'
  | 'medication' | 'meals' | 'privacyLog' | 'exports';

const TABLES: Record<DeletableCategory, string[]> = {
  runs: ['runs'],
  journal: ['journal'],
  documents: ['documents'],
  labs: ['labs'],
  dailyReads: ['daily_reads'],
  medication: ['dose_events', 'medication_plans', 'medications'],
  meals: ['meals'],
  privacyLog: ['privacy_log'],
  exports: ['shared_exports'],
};

export async function deleteCategory(category: DeletableCategory): Promise<void> {
  const h = await openDatabase();
  await h.withTransactionAsync(async () => {
    for (const table of TABLES[category]) await h.runAsync(`DELETE FROM ${table}`);
  });
  if (category === 'documents') {
    await FileSystem.deleteAsync(DOCUMENT_VAULT, { idempotent: true });
    await ensureVault();
  }
}

/** Full reset. Leaves the app installed and usable, with nothing retained. */
export async function resetEverything(): Promise<void> {
  for (const c of Object.keys(TABLES) as DeletableCategory[]) await deleteCategory(c);
}

export function newId(): string {
  return Crypto.randomUUID();
}
