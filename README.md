# House Expenses

A small web app (GitHub Pages + Supabase) for tracking household expenses.

**Live site:** https://housexpenses.sklss.co.uk/ (also https://stalinnetcode.github.io/House-Expenses/)

## Features
- **Sign-in required** (Supabase Auth). Only e-mails listed under *Settings → Household members* can see or change data.
- **Scan receipts** – photo or PDF. The image is stored privately in Supabase Storage and read in the browser (Tesseract OCR) to pre-fill amount, date, shop and category. Always check before saving.
- **Excel export** – fills every month sheet (`Jan_2026` … `Dec_2026`, columns A–E from row 4) of *your own workbook template* by editing the file's XML directly, so styles, drop-downs, merged cells, formulas and the Summary sheet are untouched. Excel recalculates totals on open. A 2026 template is reused for 2027 automatically (`_2026` → `_2027`).
- **PDF report** (month or year) with category totals, charts and all entries.
- **Charts** – spending per month (stacked by category), pie by category, by person, year-by-year; PNG/PDF export.
- **WhatsApp sharing** – on a phone the share sheet sends the Excel/PDF file to WhatsApp; on desktop the file downloads and WhatsApp Web opens with a summary. A text summary can be sent directly.
- CSV export.

## Structure
```
index.html          app shell
css/styles.css
js/config.js        Supabase URL + public anon key (data is protected by RLS)
js/app.js           UI, data, charts, PDF, sharing
js/xlsx-export.js   template-preserving Excel writer/reader (JSZip)
js/receipt.js       OCR + receipt parsing
supabase/schema.sql database schema, RLS policies and storage buckets
```

No personal data is stored in this repository – the workbook template and receipts live in private Supabase Storage buckets.
