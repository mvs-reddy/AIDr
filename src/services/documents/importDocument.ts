/**
 * Document acquisition and OCR (spec §12).
 *
 * Order matters and is fixed: acquire → normalise image → OCR locally →
 * classify → extract → redact → review → context. Nothing here touches the
 * network. The original file is copied into the local vault and stays there
 * unless the user explicitly exports it.
 */

import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import TextRecognition from '@react-native-ml-kit/text-recognition';
import { Alert } from 'react-native';

import { documentsRepo, DOCUMENT_VAULT, ensureVault, newId } from '../persistence/db';
import { redactionService } from '../redaction/RedactionService';
import type { ImportedDocument } from '../../domain/models';
import { parseLabReport } from './labParser';

export interface ImportResult {
  id: string;
  text: string;
  pageCount: number;
  classifiedAs: ImportedDocument['classifiedAs'];
  duplicate: boolean;
}

export async function importDocument(): Promise<ImportResult | null> {
  return new Promise((resolve) => {
    Alert.alert('Add a document', 'Where should AIDr. read it from?', [
      { text: 'Scan with camera', onPress: () => resolve(fromCamera()) },
      { text: 'Choose a photo', onPress: () => resolve(fromPhotos()) },
      { text: 'Choose a file', onPress: () => resolve(fromFiles()) },
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

async function fromCamera(): Promise<ImportResult | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false });
  if (res.canceled || !res.assets[0]) return null;
  return ingestImage(res.assets[0].uri);
}

async function fromPhotos(): Promise<ImportResult | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.9,
  });
  if (res.canceled || !res.assets[0]) return null;
  return ingestImage(res.assets[0].uri);
}

async function fromFiles(): Promise<ImportResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf', 'image/*', 'text/plain'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];

  if (asset.mimeType?.startsWith('image/')) return ingestImage(asset.uri);
  if (asset.mimeType === 'text/plain') {
    const text = await FileSystem.readAsStringAsync(asset.uri);
    return persist(asset.uri, 'text/plain', text, 1);
  }
  // PDF: rasterise page by page through the native bridge, then OCR each page.
  // `pdfPageImages` is implemented with PDFKit on iOS and PdfRenderer on Android.
  const { pdfPageImages } = await import('./pdfPages');
  const pages = await pdfPageImages(asset.uri, { maxPages: 20 });
  const texts: string[] = [];
  for (const pageUri of pages) {
    texts.push(await ocr(pageUri));
  }
  return persist(asset.uri, 'application/pdf', texts.join('\n\n'), pages.length);
}

async function ingestImage(uri: string): Promise<ImportResult | null> {
  // §12 "normalise image" — upscale small captures and flatten to a clean JPEG
  // so ML Kit gets consistent input. Contrast handling is left to the OCR engine.
  const normalised = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG },
  );
  const text = await ocr(normalised.uri);
  if (!text.trim()) {
    Alert.alert(
      'No text found',
      'AIDr. could not read any text from that image. Try again with more light, a straighter angle, or paste the text instead.',
    );
    return null;
  }
  return persist(normalised.uri, 'image/jpeg', text, 1);
}

async function ocr(uri: string): Promise<string> {
  try {
    const result = await TextRecognition.recognize(uri);
    return result.blocks.map((b) => b.text).join('\n');
  } catch {
    return '';
  }
}

async function persist(
  sourceURI: string,
  mimeType: string,
  ocrText: string,
  pageCount: number,
): Promise<ImportResult> {
  await ensureVault();

  const checksum = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${ocrText.length}:${ocrText.slice(0, 4000)}`,
  );

  const id = newId();
  const vaultURI = `${DOCUMENT_VAULT}${id}${extensionFor(mimeType)}`;
  await FileSystem.copyAsync({ from: sourceURI, to: vaultURI });

  // Redact immediately on import, so nothing unredacted is ever persisted
  // alongside a field that could be sent.
  await redactionService.prepare();
  const redaction = await redactionService.redact(ocrText);

  const classifiedAs = classify(ocrText);

  const doc: ImportedDocument = {
    id,
    localURI: vaultURI,
    mimeType,
    ocrTextLocal: ocrText,
    redactedText: redaction.redactedText,
    pageCount,
    checksum,
    classifiedAs,
    importedAt: new Date().toISOString(),
    excludedFromBackup: true,
  };

  const { inserted, id: storedId } = await documentsRepo.saveIfNew(doc);

  // Lab rows are parsed on device and stored structurally, so the timeline works
  // offline and the printed reference range survives verbatim.
  if (classifiedAs === 'labReport') {
    await parseLabReport(ocrText, storedId);
  }

  return {
    id: storedId,
    text: redaction.redactedText,
    pageCount,
    classifiedAs,
    duplicate: !inserted,
  };
}

/** Lightweight, entirely local classification (§12 "classify document type"). */
function classify(text: string): ImportedDocument['classifiedAs'] {
  const t = text.toLowerCase();
  const labSignals = ['reference range', 'ref range', 'result', 'units', 'specimen', 'haemoglobin', 'hemoglobin', 'creatinine', 'analyte'];
  const rxSignals = ['rx', 'take one', 'tablet', 'sig:', 'dispense', 'refill', 'prescriber'];
  const dischargeSignals = ['discharge summary', 'admission date', 'discharge date'];

  const score = (words: string[]) => words.filter((w) => t.includes(w)).length;
  if (score(dischargeSignals) >= 1) return 'discharge';
  if (score(labSignals) >= 3) return 'labReport';
  if (score(rxSignals) >= 2) return 'prescription';
  if (t.length > 200) return 'clinicNote';
  return 'unknown';
}

function extensionFor(mime: string): string {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'text/plain') return '.txt';
  return '.jpg';
}
