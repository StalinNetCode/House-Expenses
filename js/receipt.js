/* Receipt helpers: image downscaling, OCR (Tesseract.js, lazy-loaded) and text parsing. */
(function (root) {
  const STORES = [
    // [pattern, display name, category]
    [/\baldi\b/i, 'ALDI', 'Daily Home Expenses'],
    [/\blidl\b/i, 'LIDL', 'Daily Home Expenses'],
    [/\btesco\b/i, 'TESCO', 'Daily Home Expenses'],
    [/sainsbury/i, "SAINSBURY'S", 'Daily Home Expenses'],
    [/\basda\b/i, 'ASDA', 'Daily Home Expenses'],
    [/morrisons/i, 'MORRISONS', 'Daily Home Expenses'],
    [/waitrose/i, 'WAITROSE', 'Daily Home Expenses'],
    [/marks\s*&?\s*spencer|\bm&s\b/i, 'M&S', 'Daily Home Expenses'],
    [/\bco-?op\b/i, 'CO-OP', 'Daily Home Expenses'],
    [/iceland/i, 'ICELAND', 'Daily Home Expenses'],
    [/\bboots\b/i, 'BOOTS', 'Healthcare & Toileteries'],
    [/superdrug/i, 'SUPERDRUG', 'Healthcare & Toileteries'],
    [/pharmacy|chemist/i, 'PHARMACY', 'Healthcare & Toileteries'],
    [/\bshell\b|\bbp\b|\besso\b|\btexaco\b|petrol|fuel|unleaded|diesel/i, 'FUEL', 'Transport'],
    [/\bikea\b/i, 'IKEA', 'Furniture & home Appliance'],
    [/argos|currys|dunelm|b&q|wickes|homebase/i, null, 'Furniture & home Appliance'],
    [/primark|\bnext\b|h&m|zara|tk\s*maxx|matalan|clarks|sports direct/i, null, 'Clothes & Shoes'],
    [/butcher|halal meat/i, 'BUTCHER', 'Meat'],
    [/restaurant|cafe|coffee|costa|starbucks|pret|mcdonald|nando|kfc|pizza|greggs|subway/i, null, 'Meal & Entertainment'],
    [/vodafone|\bee\b|\bo2\b|three|virgin media|bt\b/i, null, 'Mobile & Internet'],
  ];

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function toNum(s) { return Number(String(s).replace(',', '.')); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fullYear(y) { y = Number(y); return y < 100 ? 2000 + y : y; }

  function validDate(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const now = new Date();
    if (y < 2000 || y > now.getFullYear() + 1) return null;
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function findDate(text) {
    // UK order dd/mm/yy(yy), dd.mm.yy, dd-mm-yyyy
    for (const m of text.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g)) {
      const d = validDate(fullYear(m[3]), Number(m[2]), Number(m[1]));
      if (d) return d;
    }
    // ISO yyyy-mm-dd
    for (const m of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) {
      const d = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
      if (d) return d;
    }
    // 9 Oct 2026 / 09 October 26
    for (const m of text.matchAll(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{2,4})\b/g)) {
      const mo = MONTHS[m[2].toLowerCase()];
      const d = mo && validDate(fullYear(m[3]), mo, Number(m[1]));
      if (d) return d;
    }
    return null;
  }

  const AMT = '(?:£|gbp)?\\s*(\\d{1,5}[.,]\\d{2})\\b';

  function findTotal(lines) {
    const tries = [
      new RegExp('^(?!.*sub\\s*-?\\s*total).*\\b(?:grand\\s+)?total(?:\\s+to\\s+pay|\\s+due)?\\b[^0-9£]*' + AMT, 'i'),
      new RegExp('\\b(?:amount\\s+due|balance\\s+due|to\\s+pay|amount\\s+paid|you\\s+paid)\\b[^0-9£]*' + AMT, 'i'),
      new RegExp('\\b(?:goods|card\\s+sales?|contactless|visa|mastercard|amex|debit|credit)\\b[^0-9£]*' + AMT, 'i'),
    ];
    for (const re of tries) {
      let found = null;
      for (const l of lines) { const m = re.exec(l); if (m) found = toNum(m[1]); }
      if (found != null) return found;
    }
    // A "Total" label on its own line with the amount on the next line
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\s*t\s*o\s*t\s*a\s*l\s*$/i.test(lines[i])) {
        const m = new RegExp('^\\s*' + AMT).exec(lines[i + 1]);
        if (m) return toNum(m[1]);
      }
    }
    // fallback: largest money-looking number
    let max = null;
    for (const m of lines.join('\n').matchAll(/(?:£\s*)?(\d{1,5}[.,]\d{2})\b/g)) {
      const v = toNum(m[1]);
      if (v < 10000 && (max == null || v > max)) max = v;
    }
    return max;
  }

  function findStore(lines, text) {
    for (const [re, name, cat] of STORES) {
      const m = re.exec(text);
      if (m) return { name: name || m[0].toUpperCase(), category: cat };
    }
    const first = lines.find((l) => /[A-Za-z]{3,}/.test(l));
    return { name: first ? first.replace(/[^A-Za-z0-9&' ]/g, '').trim().slice(0, 30).toUpperCase() : '', category: null };
  }

  function findTown(lines) {
    const head = lines.slice(0, 6);
    for (const l of head.slice(1)) {
      const t = l.trim();
      if (/^[A-Za-z][A-Za-z .'-]{2,24}$/.test(t) && !/(stores?|ltd|limited|plc|vat|tel)/i.test(t)) return t;
    }
    return '';
  }

  function findPayment(text) {
    if (/american\s+express|\bamex\b/i.test(text)) return 'Card(AMEX)';
    if (/mastercard/i.test(text)) return 'Card(Mastercard)';
    if (/\bvisa\b/i.test(text)) return 'Card(Visa)';
    if (/\bcash\b/i.test(text) && !/cashback/i.test(text)) return 'Cash';
    return 'Card';
  }

  function parseReceipt(text) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const store = findStore(lines, text);
    const town = findTown(lines);
    const total = findTotal(lines);
    const date = findDate(text);
    const pay = findPayment(text);
    const remarks = `${pay}: ${store.name}${town ? '|' + town : ''}`;
    return { total, date, store: store.name, town, category: store.category, remarks };
  }

  /** Downscale big phone photos (keeps uploads small & OCR fast). Returns a JPEG Blob. */
  async function downscale(file, maxSide = 2000, quality = 0.85) {
    if (!file.type.startsWith('image/')) return file;
    const bmp = await createImageBitmap(file).catch(() => null);
    if (!bmp) return file;
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return new Promise((res) => canvas.toBlob((b) => res(b || file), 'image/jpeg', quality));
  }

  let tesseractLoading = null;
  function loadTesseract() {
    if (root.Tesseract) return Promise.resolve();
    if (!tesseractLoading) {
      tesseractLoading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
        s.onload = res; s.onerror = () => rej(new Error('Could not load the OCR engine'));
        document.head.appendChild(s);
      });
    }
    return tesseractLoading;
  }

  async function ocr(image, onProgress) {
    await loadTesseract();
    const { data } = await root.Tesseract.recognize(image, 'eng', {
      logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
    });
    return data.text || '';
  }

  const api = { parseReceipt, downscale, ocr };
  if (typeof module !== 'undefined') module.exports = api; else root.Receipt = api;
})(typeof window !== 'undefined' ? window : globalThis);
