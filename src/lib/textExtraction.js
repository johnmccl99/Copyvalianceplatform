import { isChunkLoadFailure, reportChunkFailure } from "./appVersionSignal.js";

const DEFAULT_MAX_CHARS = 5000;

function extOf(filename) {
  if (!filename) return "";
  const m = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

async function extractFromPdf(file, maxChars) {
  try {
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      const workerUrl = (
        await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
      ).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data }).promise;
    let combined = "";
    const maxPagesToScan = Math.min(doc.numPages, 20);
    for (let i = 1; i <= maxPagesToScan && combined.length < maxChars; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it) => it.str).join(" ");
      combined += pageText + "\n\n";
    }
    return { text: combined.slice(0, maxChars), pages: doc.numPages };
  } catch (err) {
    if (isChunkLoadFailure(err)) reportChunkFailure();
    return { text: "", error: `PDF extraction failed: ${err?.message || err}` };
  }
}

async function extractFromDocx(file, maxChars) {
  try {
    const mammoth = await import("mammoth/mammoth.browser.js");
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { text: (result.value || "").slice(0, maxChars) };
  } catch (err) {
    if (isChunkLoadFailure(err)) reportChunkFailure();
    return {
      text: "",
      error: `DOCX extraction failed: ${err?.message || err}`,
    };
  }
}

const MAX_XLSX_BYTES = 20 * 1024 * 1024;

async function extractFromXlsx(file, maxChars) {
  try {
    if (file.size > MAX_XLSX_BYTES) {
      return {
        text: "",
        error: `XLSX too large (>${Math.round(MAX_XLSX_BYTES / 1024 / 1024)} MB); refusing to parse.`,
      };
    }
    const XLSX = await import("xlsx");
    const ab = await file.arrayBuffer();
    const wb = XLSX.read(ab, {
      type: "array",
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetRows: 10000,
    });
    const sheets = wb.SheetNames || [];
    let combined = "";
    for (const name of sheets) {
      if (combined.length >= maxChars) break;
      const ws = wb.Sheets[name];
      const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
      combined += `=== Sheet: ${name} ===\n${csv}\n\n`;
    }
    return { text: combined.slice(0, maxChars), sheets };
  } catch (err) {
    if (isChunkLoadFailure(err)) reportChunkFailure();
    return {
      text: "",
      error: `XLSX extraction failed: ${err?.message || err}`,
    };
  }
}

async function extractFromText(file, maxChars) {
  try {
    const text = await file.text();
    return { text: (text || "").slice(0, maxChars) };
  } catch (err) {
    return {
      text: "",
      error: `Text extraction failed: ${err?.message || err}`,
    };
  }
}

export async function extractTextFromFile(file, opts = {}) {
  const maxChars = opts.maxChars || DEFAULT_MAX_CHARS;
  if (!file) return { text: "", error: "No file provided" };

  const ext = extOf(file.name);
  const mime = (file.type || "").toLowerCase();

  if (ext === "pdf" || mime.includes("pdf"))
    return extractFromPdf(file, maxChars);

  if (ext === "docx" || mime.includes("officedocument.wordprocessingml")) {
    return extractFromDocx(file, maxChars);
  }

  if (
    ["xlsx", "xls", "csv", "tsv"].includes(ext) ||
    mime.includes("spreadsheetml") ||
    mime.includes("ms-excel") ||
    mime === "text/csv"
  ) {
    return extractFromXlsx(file, maxChars);
  }

  if (
    mime.startsWith("text/") ||
    ["txt", "md", "json", "yaml", "yml", "xml", "html"].includes(ext)
  ) {
    return extractFromText(file, maxChars);
  }

  return {
    text: "",
    error: `Unsupported file type for text extraction: ${ext || mime || "unknown"}`,
  };
}

export async function tryExtractText(file, opts = {}) {
  try {
    const r = await extractTextFromFile(file, opts);
    return r.text || "";
  } catch (_) {
    return "";
  }
}
