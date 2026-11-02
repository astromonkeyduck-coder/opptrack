export type ExtractionWord = { text: string; x: number; y: number; width: number; height: number };

/** sha256 identifies the original asset, not the text or a rendered derivative. */
export type ExtractionUnit = {
  assetId: string;
  page: number | null;
  /** Original pdfinfo count, repeated on every known PDF page for downstream completeness checks. */
  expectedPages?: number;
  /** True once visual preparation/native work started, even if its final outcome is blocked. */
  attempted?: boolean;
  status: 'processed' | 'failed' | 'blocked';
  text: string;
  method: 'ocr' | 'pdf-text-and-ocr' | 'provided-text';
  sha256: string | null;
  issues: string[];
  /** Coordinates use the bounded normalized/rendered image, not original pixels. */
  words?: ExtractionWord[];
};

export type MediaAsset = { assetId: string; bytes: Uint8Array; mimeType: string; expectedSha256?: string };
