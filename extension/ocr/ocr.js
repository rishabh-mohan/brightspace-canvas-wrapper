// File text reader (ocr.html, framed and hidden by src/filetext.js): turns a course file's bytes
// into searchable text, entirely on this computer. PDFs give their text layer through pdf.js;
// a PDF with (almost) no text layer is a scan, so its pages are drawn and read with Tesseract,
// as are images. This frame never fetches anything: the page around it downloads the file and
// posts the bytes here, and gets plain text back.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const vendor = (file) => new URL(`../vendor/tesseract/${file}`, import.meta.url).href;

const MAX_OCR_PAGES = 15; // shortcut: scans past page 15 are not read; raise if long scanned readers matter
const SCALE = 2; // render scale for OCR: about 150 dpi for a letter page, where Tesseract does well
// Under this many characters a page, a PDF counts as scanned (page numbers and headers alone are short).
const SCANNED_CHARS_PER_PAGE = 40;

let ocrWorker = null;
function tesseract() {
  // One worker, made on first use and kept: loading the engine and English data takes a few seconds.
  ocrWorker = ocrWorker || Tesseract.createWorker('eng', 1, {
    workerPath: vendor('worker.min.js'),
    corePath: vendor('tesseract-core-simd-lstm.wasm.js'),
    langPath: vendor(''),
    workerBlobURL: false, // extension pages may only run their own files
    cacheMethod: 'none', // the data is a local file already
  });
  ocrWorker.catch(() => (ocrWorker = null));
  return ocrWorker;
}
const ocr = async (image) => (await (await tesseract()).recognize(image)).data.text;

const tidy = (s) => s.replace(/[ \t\f\v]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((i) => (i.str || '') + (i.hasEOL ? '\n' : ' ')).join(''));
      page.cleanup();
    }
    const text = tidy(pages.join('\n'));
    if (text.length >= SCANNED_CHARS_PER_PAGE * doc.numPages) return { text, pages: doc.numPages, ocr: false };
    // A scan: read the page images.
    const read = [];
    for (let n = 1; n <= Math.min(doc.numPages, MAX_OCR_PAGES); n++) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      // 'print' draws without waiting for animation frames, which browsers pause in a hidden frame.
      await page.render({ canvasContext: canvas.getContext('2d'), viewport, intent: 'print' }).promise;
      read.push(await ocr(canvas));
      canvas.width = canvas.height = 0; // frees the page image now rather than at the next GC
      page.cleanup();
    }
    return { text: tidy(read.join('\n')), pages: doc.numPages, ocr: true, partial: doc.numPages > MAX_OCR_PAGES };
  } finally {
    doc.destroy();
  }
}

async function imageText(bytes, type) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: type || 'image/png' }));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  const text = tidy(await ocr(canvas));
  canvas.width = canvas.height = 0;
  return { text, pages: 1, ocr: true };
}

// One file at a time: OCR is heavy, and the page around waits for each answer anyway.
let queue = Promise.resolve();
addEventListener('message', (ev) => {
  const m = ev.data;
  if (ev.source !== parent || !m || m.type !== 'bsx-text' || !(m.bytes instanceof ArrayBuffer)) return;
  const reply = (body) => parent.postMessage({ type: 'bsx-text', id: m.id, ...body }, ev.origin);
  queue = queue.then(async () => {
    try {
      reply(m.kind === 'pdf' ? await pdfText(m.bytes) : await imageText(m.bytes, m.mime));
    } catch (e) {
      reply({ error: String((e && e.message) || e) });
    }
  });
});
parent.postMessage({ type: 'bsx-text-ready' }, '*');
