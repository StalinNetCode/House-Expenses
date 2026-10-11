/*
 * Writes expense rows into the original workbook template WITHOUT changing its formatting.
 * Works directly on the .xlsx XML (via JSZip) so styles, merged cells, data-validation
 * drop-downs, column widths, formulas and the Summary sheet are left untouched.
 * Only the values in columns A–E (Date, Category, Price, Purchase by, Remarks) of each
 * month sheet (e.g. "Oct_2026") are replaced, starting at row 4.
 */
(function () {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const FIRST_ROW = 4;
  const LAST_STYLED_ROW = 149; // template formulas use SUMIF(B4:$B$150, ...)
  const COLS = ['A', 'B', 'C', 'D', 'E'];

  function colIndex(ref) {
    const letters = ref.replace(/[0-9]/g, '');
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n;
  }

  function excelSerial(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  function templateYear(sheetNames) {
    for (const n of sheetNames) {
      const m = /^[A-Z][a-z]{2}_(\d{4})$/.exec(n);
      if (m) return m[1];
    }
    return null;
  }

  function clearCell(c) {
    while (c.firstChild) c.removeChild(c.firstChild);
    c.removeAttribute('t');
  }

  function getRow(doc, sheetData, rowNum) {
    const rows = sheetData.getElementsByTagName('row');
    let before = null;
    for (const r of rows) {
      const n = Number(r.getAttribute('r'));
      if (n === rowNum) return r;
      if (n > rowNum) { before = r; break; }
    }
    const row = doc.createElementNS(NS, 'row');
    row.setAttribute('r', String(rowNum));
    sheetData.insertBefore(row, before);
    return row;
  }

  function getCell(doc, row, col, rowNum, styleFallback) {
    const ref = col + rowNum;
    const target = colIndex(col);
    let before = null;
    for (const c of row.getElementsByTagName('c')) {
      const r = c.getAttribute('r');
      if (r === ref) return c;
      if (colIndex(r) > target) { before = c; break; }
    }
    const c = doc.createElementNS(NS, 'c');
    c.setAttribute('r', ref);
    if (styleFallback) c.setAttribute('s', styleFallback);
    row.insertBefore(c, before);
    return c;
  }

  function setString(doc, c, text) {
    clearCell(c);
    if (text == null || text === '') return;
    c.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is');
    const t = doc.createElementNS(NS, 't');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = String(text);
    is.appendChild(t);
    c.appendChild(is);
  }

  function setNumber(doc, c, num) {
    clearCell(c);
    if (num == null || num === '') return;
    const v = doc.createElementNS(NS, 'v');
    v.textContent = String(num);
    c.appendChild(v);
  }

  function setFormula(doc, c, formula) {
    clearCell(c);
    const f = doc.createElementNS(NS, 'f');
    f.textContent = formula;
    c.appendChild(f);
  }

  /** Drop cached results of every formula so nothing stale is shown; Excel recalculates on open. */
  function stripCachedValues(doc) {
    for (const f of Array.from(doc.getElementsByTagName('f'))) {
      const c = f.parentNode;
      for (const v of Array.from(c.getElementsByTagName('v'))) c.removeChild(v);
      if (c.getAttribute('t') === 'str' || c.getAttribute('t') === 'n' || c.getAttribute('t') === 'b' || c.getAttribute('t') === 'e') c.removeAttribute('t');
    }
  }

  function writeSheet(doc, rows) {
    const sheetData = doc.getElementsByTagName('sheetData')[0];
    // remember the styles of the last styled row so overflow rows look the same
    const lastRow = getRow(doc, sheetData, LAST_STYLED_ROW);
    const fallbackStyles = {};
    for (const col of COLS) {
      for (const cc of lastRow.getElementsByTagName('c')) {
        if (cc.getAttribute('r') === col + LAST_STYLED_ROW) fallbackStyles[col] = cc.getAttribute('s');
      }
    }
    // 1. clear existing values in A–E (keep style attribute)
    for (const r of Array.from(sheetData.getElementsByTagName('row'))) {
      const n = Number(r.getAttribute('r'));
      if (n < FIRST_ROW) continue;
      for (const c of Array.from(r.getElementsByTagName('c'))) {
        const col = c.getAttribute('r').replace(/[0-9]/g, '');
        if (COLS.includes(col)) clearCell(c);
      }
    }
    // 2. write rows
    rows.forEach((e, i) => {
      const rowNum = FIRST_ROW + i;
      const row = getRow(doc, sheetData, rowNum);
      const cell = (col) => getCell(doc, row, col, rowNum, fallbackStyles[col]);
      setNumber(doc, cell('A'), e.expense_date ? excelSerial(e.expense_date) : null);
      setString(doc, cell('B'), e.category);
      if (e.amount_formula) setFormula(doc, cell('C'), e.amount_formula);
      else setNumber(doc, cell('C'), e.amount);
      setString(doc, cell('D'), e.purchased_by);
      setString(doc, cell('E'), e.remarks);
    });
    // 3. keep <dimension> valid
    const dim = doc.getElementsByTagName('dimension')[0];
    const lastWritten = FIRST_ROW + rows.length - 1;
    if (dim && lastWritten > LAST_STYLED_ROW) {
      const m = /^([A-Z]+\d+):([A-Z]+)(\d+)$/.exec(dim.getAttribute('ref'));
      if (m && Number(m[3]) < lastWritten) dim.setAttribute('ref', `${m[1]}:${m[2]}${lastWritten}`);
    }
  }

  /**
   * @param {ArrayBuffer|Blob} template  original workbook
   * @param {number|string} year        year to export
   * @param {Object<string, Array>} bySheet  { 'Oct_2026': [expense, ...], ... }
   * @returns {Promise<{blob: Blob, warnings: string[]}>}
   */
  async function buildWorkbook(template, year, bySheet) {
    const zip = await JSZip.loadAsync(template);
    const warnings = [];
    const parser = new DOMParser();
    const ser = new XMLSerializer();

    let wbXml = await zip.file('xl/workbook.xml').async('string');
    const sheetNames = Array.from(wbXml.matchAll(/<sheet [^>]*name="([^"]+)"/g)).map((m) => m[1]);
    const tYear = templateYear(sheetNames);
    const y = String(year);

    // Year roll-over: template for 2026 can be reused for 2027 by renaming "_2026" → "_2027"
    const sheetFiles = Object.keys(zip.files).filter((p) => /^xl\/worksheets\/sheet\d+\.xml$/.test(p));
    const renameYear = tYear && tYear !== y;
    const swap = (s) => (renameYear ? s.split('_' + tYear).join('_' + y) : s);
    wbXml = swap(wbXml);

    // map sheet name → file
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const rels = {};
    for (const m of relsXml.matchAll(/<Relationship [^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0])[1];
      const target = /Target="([^"]+)"/.exec(m[0])[1];
      rels[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
    }
    const nameToFile = {};
    for (const m of wbXml.matchAll(/<sheet [^>]*>/g)) {
      const name = /name="([^"]+)"/.exec(m[0])[1].replace(/&amp;/g, '&');
      const rid = /r:id="([^"]+)"/.exec(m[0])[1];
      nameToFile[name] = rels[rid];
    }

    for (const path of sheetFiles) {
      let xml = swap(await zip.file(path).async('string'));
      const sheetName = Object.keys(nameToFile).find((n) => nameToFile[n] === path);
      const doc = parser.parseFromString(xml, 'application/xml');
      if (sheetName && MONTHS.some((mo) => sheetName === `${mo}_${y}`)) {
        const rows = (bySheet[sheetName] || []).slice();
        if (FIRST_ROW + rows.length - 1 > LAST_STYLED_ROW + 1) {
          warnings.push(`${sheetName}: ${rows.length} rows — rows after 150 are outside the sheet's SUMIF range.`);
        }
        writeSheet(doc, rows);
      }
      stripCachedValues(doc);
      xml = ser.serializeToString(doc);
      if (!xml.startsWith('<?xml')) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
      zip.file(path, xml, { createFolders: false });
    }

    // force full recalculation when opened
    if (/<calcPr[^>]*\/>/.test(wbXml)) {
      wbXml = wbXml.replace(/<calcPr([^>]*?)\s*\/>/, (m, attrs) =>
        `<calcPr${attrs.replace(/\s*fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"/>`);
    } else {
      wbXml = wbXml.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    }
    zip.file('xl/workbook.xml', wbXml, { createFolders: false });

    // calcChain lists formula cells; it is optional and would be out of date → remove it
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      zip.file('xl/_rels/workbook.xml.rels', relsXml.replace(/<Relationship [^>]*Target="calcChain\.xml"[^>]*\/>/, ''), { createFolders: false });
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace(/<Override [^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''), { createFolders: false });
    }

    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    return { blob, warnings, templateYear: tYear };
  }

  /** Read rows (A–E from row 4) of every month sheet — used for "Import from workbook". */
  async function readWorkbook(file) {
    const zip = await JSZip.loadAsync(file);
    const parser = new DOMParser();
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const rels = {};
    for (const m of relsXml.matchAll(/<Relationship [^>]*>/g)) {
      rels[/Id="([^"]+)"/.exec(m[0])[1]] = 'xl/' + /Target="([^"]+)"/.exec(m[0])[1].replace(/^\/?xl\//, '');
    }
    let shared = [];
    if (zip.file('xl/sharedStrings.xml')) {
      const sdoc = parser.parseFromString(await zip.file('xl/sharedStrings.xml').async('string'), 'application/xml');
      shared = Array.from(sdoc.getElementsByTagName('si')).map((si) =>
        Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join(''));
    }
    const out = {};
    for (const m of wbXml.matchAll(/<sheet [^>]*>/g)) {
      const name = /name="([^"]+)"/.exec(m[0])[1];
      if (!/^[A-Z][a-z]{2}_\d{4}$/.test(name)) continue;
      const path = rels[/r:id="([^"]+)"/.exec(m[0])[1]];
      const doc = parser.parseFromString(await zip.file(path).async('string'), 'application/xml');
      const rows = [];
      for (const r of doc.getElementsByTagName('row')) {
        const n = Number(r.getAttribute('r'));
        if (n < FIRST_ROW) continue;
        const vals = {};
        for (const c of r.getElementsByTagName('c')) {
          const col = c.getAttribute('r').replace(/[0-9]/g, '');
          if (!COLS.includes(col)) continue;
          const t = c.getAttribute('t');
          const f = c.getElementsByTagName('f')[0];
          const v = c.getElementsByTagName('v')[0];
          let val = null;
          if (t === 's' && v) val = shared[Number(v.textContent)];
          else if (t === 'inlineStr') val = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent).join('');
          else if (v) val = v.textContent;
          vals[col] = { val, formula: f ? f.textContent : null };
        }
        if (!COLS.some((c) => vals[c] && (vals[c].val != null || vals[c].formula))) continue;
        const serial = Number(vals.A && vals.A.val);
        const date = serial ? new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10) : null;
        let amount = vals.C ? Number(vals.C.val) : 0;
        const formula = vals.C && vals.C.formula;
        if ((!amount || Number.isNaN(amount)) && formula && /^[0-9+\-*/(). ]+$/.test(formula)) {
          amount = Function('"use strict";return (' + formula + ')')();
        }
        rows.push({
          sheet_name: name, expense_date: date, category: vals.B && vals.B.val,
          amount: Math.round((amount || 0) * 100) / 100, amount_formula: formula || null,
          purchased_by: vals.D && vals.D.val, remarks: vals.E && vals.E.val, sort_order: n,
        });
      }
      out[name] = rows;
    }
    return out;
  }

  window.XlsxExport = { buildWorkbook, readWorkbook, excelSerial, MONTHS };
})();
