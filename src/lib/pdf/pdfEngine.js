import { isChunkLoadFailure, reportChunkFailure } from "../appVersionSignal.js";

let _pdfMakePromise = null;

async function loadPdfMake() {
  if (!_pdfMakePromise) {
    _pdfMakePromise = (async () => {
      const pdfMakeMod = await import("pdfmake/build/pdfmake");
      const vfsMod = await import("pdfmake/build/vfs_fonts");
      const pdfMake = pdfMakeMod.default || pdfMakeMod;
      const vfs =
        vfsMod?.default?.pdfMake?.vfs ||
        vfsMod?.pdfMake?.vfs ||
        vfsMod?.default?.vfs ||
        vfsMod?.vfs ||
        vfsMod?.default ||
        vfsMod;
      if (vfs) {
        if (typeof pdfMake.addVirtualFileSystem === "function") {
          pdfMake.addVirtualFileSystem(vfs);
        } else {
          pdfMake.vfs = vfs;
        }
      }
      return pdfMake;
    })().catch((err) => {
      if (isChunkLoadFailure(err)) reportChunkFailure();
      _pdfMakePromise = null;
      throw err;
    });
  }
  return _pdfMakePromise;
}

export async function downloadPdf(docDefinition, filename) {
  const pdfMake = await loadPdfMake();
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(docDefinition).download(filename, () => resolve());
    } catch (err) {
      reject(err);
    }
  });
}

export async function openPdf(docDefinition) {
  const pdfMake = await loadPdfMake();
  pdfMake.createPdf(docDefinition).open();
}

export function preloadPdfEngine() {
  return loadPdfMake()
    .then(() => true)
    .catch(() => false);
}
