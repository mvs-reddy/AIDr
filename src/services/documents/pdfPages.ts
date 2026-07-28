/**
 * PDF page rasterisation, native-bridged.
 *
 * iOS   PDFKit  → PDFPage.thumbnail(of:for:)
 * Android PdfRenderer → Page.render(bitmap, …, RENDER_MODE_FOR_DISPLAY)
 *
 * Rasterising rather than extracting the embedded text layer is deliberate:
 * clinic PDFs are very often scans with no text layer at all, and running one
 * path for both keeps OCR quality consistent. Pages are written to the cache
 * directory and deleted after OCR.
 */

import { NativeModules } from 'react-native';
import * as FileSystem from 'expo-file-system';

interface PdfNativeModule {
  renderPages(uri: string, maxPages: number, scale: number): Promise<string[]>;
  pageCount(uri: string): Promise<number>;
}

const Native = (NativeModules as Record<string, unknown>).AIDrPdf as PdfNativeModule | undefined;

export async function pdfPageImages(
  uri: string,
  opts: { maxPages?: number; scale?: number } = {},
): Promise<string[]> {
  if (!Native) return [];
  const { maxPages = 20, scale = 2 } = opts;
  try {
    return await Native.renderPages(uri, maxPages, scale);
  } catch {
    return [];
  }
}

export async function pdfPageCount(uri: string): Promise<number> {
  if (!Native) return 0;
  return Native.pageCount(uri).catch(() => 0);
}

/** Pages are transient — never leave rasterised PHI in the cache. */
export async function cleanupPages(uris: string[]): Promise<void> {
  await Promise.all(uris.map((u) => FileSystem.deleteAsync(u, { idempotent: true })));
}
