/* House Expenses – main app */
(function () {
  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const MONTHS = XlsxExport.MONTHS;
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const PALETTE = ['#1f6f54', '#d08c2b', '#3c6fb6', '#b4432f', '#7a5aa6', '#2a9d8f', '#c4577f', '#6b8e23', '#8c6d46', '#4f9fd1',
    '#e07a5f', '#5a6c7d', '#9c9a3a', '#a64d79', '#3d405b', '#81b29a', '#f2a541'];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const gbp = (n) => '£' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const sheetFor = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]}_${iso.slice(0, 4)}`;
  const monthOf = (sheet) => MONTHS.indexOf(sheet.slice(0, 3));

  const state = {
    user: null, year: new Date().getFullYear(), month: MONTHS[new Date().getMonth()],
    categories: [], people: [], expenses: [], allYears: [], receiptFile: null, ocrText: '', charts: {},
  };

  /* ---------------- helpers ---------------- */
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function setMsg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || 'Working…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }
  function parseAmount(raw) {
    const s = String(raw).replace(/£|,/g, '').trim();
    if (!s) return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) return { amount: Math.round(Number(s) * 100) / 100, formula: null };
    if (/^[0-9+\-*/(). ]+$/.test(s)) {
      try {
        const v = Function('"use strict";return (' + s + ')')();
        if (Number.isFinite(v)) return { amount: Math.round(v * 100) / 100, formula: s.replace(/\s+/g, '') };
      } catch (_) { /* fallthrough */ }
    }
    return null;
  }
  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  /** Share a file through the phone's share sheet (pick WhatsApp). Falls back to download + WhatsApp text. */
  async function shareFile(blob, filename, text) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename, text }); return; }
      catch (e) { if (e.name === 'AbortError') return; }
    }
    download(blob, filename);
    toast('File downloaded — attach it in WhatsApp');
    window.open('https://wa.me/?text=' + encodeURIComponent(text + '\n(' + filename + ' attached)'), '_blank', 'noopener');
  }
  const spentOnly = (rows) => rows.filter((r) => !cfg.EXCLUDE_FROM_SPENT.includes(r.category));
  const sum = (rows) => rows.reduce((a, r) => a + Number(r.amount || 0), 0);
  function groupSum(rows, key) {
    const m = new Map();
    for (const r of rows) m.set(r[key] || '—', (m.get(r[key] || '—') || 0) + Number(r.amount || 0));
    return m;
  }
  function rowsForPeriod(period) {
    return period === 'year' ? state.expenses : state.expenses.filter((e) => e.sheet_name === `${period}_${state.year}`);
  }
  function periodLabel(period) { return period === 'year' ? `Year ${state.year}` : `${MONTH_NAMES[MONTHS.indexOf(period)]} ${state.year}`; }

  /* ---------------- auth ---------------- */
  let signUpMode = false;
  function showOnly(id) {
    ['#auth-view', '#denied-view', '#app'].forEach((s) => $(s).classList.toggle('hidden', s !== id));
  }
  $('#auth-toggle').onclick = () => {
    signUpMode = !signUpMode;
    $('#auth-submit').textContent = signUpMode ? 'Create account' : 'Sign in';
    $('#auth-toggle').textContent = signUpMode ? 'I already have an account' : 'Create an account';
    $('#auth-password').autocomplete = signUpMode ? 'new-password' : 'current-password';
  };
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim(); const password = $('#auth-password').value;
    const msg = $('#auth-msg'); const btn = $('#auth-submit');
    busy(btn, true);
    try {
      if (signUpMode) {
        const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) setMsg(msg, 'Check your inbox and confirm your email, then sign in.', 'ok');
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) { setMsg(msg, err.message, 'error'); }
    busy(btn, false);
  };
  $('#auth-forgot').onclick = async () => {
    const email = $('#auth-email').value.trim();
    if (!email) return setMsg($('#auth-msg'), 'Type your email first.', 'error');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    setMsg($('#auth-msg'), error ? error.message : 'Password reset email sent.', error ? 'error' : 'ok');
  };
  const signOut = async () => { await sb.auth.signOut(); location.reload(); };
  $('#signout').onclick = signOut;
  $('#denied-signout').onclick = signOut;

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      const pw = prompt('Enter a new password (min 6 characters)');
      if (pw) { const { error } = await sb.auth.updateUser({ password: pw }); alert(error ? error.message : 'Password updated.'); }
    }
    if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') handleSession(session);
  });

  let started = false;
  async function handleSession(session) {
    if (!session) { started = false; showOnly('#auth-view'); return; }
    if (started) return;
    state.user = session.user;
    const { data: ok, error } = await sb.rpc('is_member');
    if (error || !ok) { $('#denied-email').textContent = session.user.email; showOnly('#denied-view'); return; }
    started = true;
    showOnly('#app');
    await boot();
  }

  /* ---------------- data ---------------- */
  async function loadLookups() {
    const [c, p] = await Promise.all([
      sb.from('categories').select('*').order('sort'),
      sb.from('people').select('*').order('sort'),
    ]);
    state.categories = (c.data || []).map((x) => x.name);
    state.people = (p.data || []).map((x) => x.name);
  }
  async function loadYear() {
    const { data, error } = await sb.from('expenses').select('*')
      .like('sheet_name', `%_${state.year}`).order('sort_order').order('created_at').limit(5000);
    if (error) { toast(error.message); return; }
    state.expenses = data;
  }
  async function loadAllYears() {
    const { data } = await sb.from('expenses').select('sheet_name,category,amount').limit(20000);
    state.allYears = data || [];
  }
  async function refresh() {
    await Promise.all([loadYear(), loadAllYears()]);
    renderYearSelect(); renderList(); renderCharts(); renderSummary();
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    await loadLookups();
    fillSelect($('#f-category'), state.categories);
    fillSelect($('#f-person'), state.people);
    fillSelect($('#list-category'), state.categories, 'All categories');
    renderSheetSelect();
    resetForm();
    renderMonthChips();
    renderPeriodSelects();
    await refresh();
    renderSettings();
  }
  function fillSelect(sel, items, allLabel) {
    sel.innerHTML = (allLabel ? `<option value="">${esc(allLabel)}</option>` : '') + items.map((i) => `<option>${esc(i)}</option>`).join('');
  }
  function renderSheetSelect() {
    const years = [state.year - 1, state.year, state.year + 1];
    $('#f-sheet').innerHTML = years.map((y) => `<optgroup label="${y}">${MONTHS.map((m) => `<option value="${m}_${y}">${m}_${y}</option>`).join('')}</optgroup>`).join('');
  }
  function renderYearSelect() {
    const ys = new Set([new Date().getFullYear(), state.year]);
    for (const r of state.allYears) ys.add(Number(r.sheet_name.slice(-4)));
    const sel = $('#year-select');
    sel.innerHTML = [...ys].sort().map((y) => `<option ${y === state.year ? 'selected' : ''}>${y}</option>`).join('');
  }
  $('#year-select').onchange = async (e) => {
    state.year = Number(e.target.value);
    renderSheetSelect(); renderPeriodSelects();
    await refresh();
  };
  function renderPeriodSelects() {
    const opts = `<option value="year">Whole year ${state.year}</option>` + MONTHS.map((m, i) => `<option value="${m}">${MONTH_NAMES[i]} ${state.year}</option>`).join('');
    for (const id of ['#chart-period', '#pdf-period', '#sum-period']) {
      const sel = $(id); const prev = sel.value; sel.innerHTML = opts; sel.value = prev || 'year';
    }
  }

  /* ---------------- tabs ---------------- */
  $$('#tabs button').forEach((b) => (b.onclick = () => {
    $$('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.view').forEach((v) => v.classList.add('hidden'));
    $('#view-' + b.dataset.view).classList.remove('hidden');
    if (b.dataset.view === 'charts') renderCharts();
    window.scrollTo({ top: 0 });
  }));
  function goTo(view) { $(`#tabs button[data-view="${view}"]`).click(); }

  /* ---------------- receipt + form ---------------- */
  const dz = $('#dropzone');
  ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleReceipt(e.dataTransfer.files[0]); });
  $('#receipt-input').onchange = (e) => { if (e.target.files[0]) handleReceipt(e.target.files[0]); e.target.value = ''; };
  $('#receipt-clear').onclick = clearReceipt;

  function clearReceipt() {
    state.receiptFile = null; state.ocrText = '';
    $('#receipt-preview').classList.add('hidden'); $('#ocr-raw-wrap').classList.add('hidden'); $('#ocr-status').classList.add('hidden');
    updateReceiptNote();
  }
  function updateReceiptNote() {
    const editing = state.editing;
    let t = '';
    if (state.receiptFile) t = '📎 Receipt will be saved with this expense.';
    else if (editing && editing.receipt_path) t = '📎 This expense already has a receipt.';
    $('#f-receipt-note').textContent = t;
  }

  async function handleReceipt(file) {
    const isPdf = file.type === 'application/pdf';
    const blob = isPdf ? file : await Receipt.downscale(file);
    state.receiptFile = isPdf ? file : new File([blob], (file.name || 'receipt').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    $('#receipt-preview').classList.remove('hidden');
    $('#receipt-img').classList.toggle('hidden', isPdf);
    if (!isPdf) $('#receipt-img').src = URL.createObjectURL(blob);
    updateReceiptNote();
    if (isPdf) { toast('PDF attached — enter the details below'); return; }

    $('#ocr-status').classList.remove('hidden'); $('#ocr-bar').style.width = '5%'; $('#ocr-text').textContent = 'Reading receipt…';
    try {
      const text = await Receipt.ocr(blob, (p) => { $('#ocr-bar').style.width = Math.round(10 + p * 90) + '%'; });
      state.ocrText = text;
      $('#ocr-raw').textContent = text; $('#ocr-raw-wrap').classList.remove('hidden');
      const r = Receipt.parseReceipt(text);
      if (r.date) { $('#f-date').value = r.date; $('#f-sheet').value = sheetFor(r.date); ensureSheetOption(sheetFor(r.date)); }
      if (r.total != null) $('#f-amount').value = r.total.toFixed(2);
      if (r.category && state.categories.includes(r.category)) $('#f-category').value = r.category;
      if (r.remarks) $('#f-remarks').value = r.remarks;
      $('#ocr-text').textContent = `Found ${r.total != null ? gbp(r.total) : 'no total'}${r.date ? ' on ' + r.date.split('-').reverse().join('/') : ''}${r.store ? ' at ' + r.store : ''}. Please check before saving.`;
      $('#ocr-bar').style.width = '100%';
    } catch (err) {
      $('#ocr-text').textContent = 'Could not read the receipt automatically (' + err.message + '). Please type the details.';
    }
  }
  function ensureSheetOption(sheet) {
    if (![...$('#f-sheet').options].some((o) => o.value === sheet)) {
      $('#f-sheet').insertAdjacentHTML('beforeend', `<option value="${sheet}">${sheet}</option>`);
    }
    $('#f-sheet').value = sheet;
  }
  $('#f-date').onchange = (e) => { if (e.target.value) ensureSheetOption(sheetFor(e.target.value)); };

  function resetForm() {
    state.editing = null;
    $('#expense-form').reset();
    $('#f-id').value = '';
    $('#f-date').value = today();
    ensureSheetOption(sheetFor(today()));
    const me = (state.user?.email || '').toLowerCase();
    const guess = state.people.find((p) => me.includes(p.toLowerCase()));
    if (guess) $('#f-person').value = guess;
    $('#form-title').textContent = 'New expense';
    $('#f-save').textContent = 'Save expense';
    $('#f-cancel').classList.add('hidden');
    clearReceipt();
  }
  $('#f-cancel').onclick = resetForm;

  function startEdit(e) {
    state.editing = e;
    $('#f-id').value = e.id;
    $('#f-date').value = e.expense_date;
    ensureSheetOption(e.sheet_name);
    if (!state.categories.includes(e.category)) $('#f-category').insertAdjacentHTML('beforeend', `<option>${esc(e.category)}</option>`);
    $('#f-category').value = e.category;
    $('#f-amount').value = e.amount_formula || Number(e.amount).toFixed(2);
    if (e.purchased_by && ![...$('#f-person').options].some((o) => o.value === e.purchased_by)) {
      $('#f-person').insertAdjacentHTML('beforeend', `<option>${esc(e.purchased_by)}</option>`);
    }
    $('#f-person').value = e.purchased_by || '';
    $('#f-remarks').value = e.remarks || '';
    $('#form-title').textContent = 'Edit expense';
    $('#f-save').textContent = 'Update expense';
    $('#f-cancel').classList.remove('hidden');
    state.receiptFile = null;
    $('#receipt-preview').classList.add('hidden');
    updateReceiptNote();
    goTo('add');
  }

  async function uploadReceipt(file, sheet) {
    const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
    const uid = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const path = `${sheet.slice(-4)}/${sheet}/${uid}.${ext}`;
    const { error } = await sb.storage.from('receipts').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  }

  $('#expense-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const msg = $('#form-msg'); const btn = $('#f-save');
    const amt = parseAmount($('#f-amount').value);
    if (!amt) return setMsg(msg, 'Enter a valid price, e.g. 12.50 or 32.9+23.41', 'error');
    const sheet = $('#f-sheet').value;
    const rec = {
      sheet_name: sheet, expense_date: $('#f-date').value, category: $('#f-category').value,
      amount: amt.amount, amount_formula: amt.formula, purchased_by: $('#f-person').value, remarks: $('#f-remarks').value.trim() || null,
    };
    busy(btn, true, 'Saving…');
    try {
      if (state.receiptFile) {
        rec.receipt_path = await uploadReceipt(state.receiptFile, sheet);
        rec.ocr_text = state.ocrText || null;
      }
      const id = $('#f-id').value;
      if (id) {
        if (state.editing && state.editing.sheet_name !== sheet) rec.sort_order = await nextSortOrder(sheet);
        const { error } = await sb.from('expenses').update(rec).eq('id', id);
        if (error) throw error;
        if (rec.receipt_path && state.editing?.receipt_path) await sb.storage.from('receipts').remove([state.editing.receipt_path]);
        toast('Expense updated');
      } else {
        rec.sort_order = await nextSortOrder(sheet);
        const { error } = await sb.from('expenses').insert(rec);
        if (error) throw error;
        toast(`Saved to ${sheet}`);
      }
      setMsg(msg, '');
      resetForm();
      if (Number(sheet.slice(-4)) !== state.year) { state.year = Number(sheet.slice(-4)); renderPeriodSelects(); }
      state.month = sheet.slice(0, 3);
      await refresh();
      renderMonthChips();
    } catch (err) { setMsg(msg, err.message, 'error'); }
    busy(btn, false);
  };
  async function nextSortOrder(sheet) {
    const { data } = await sb.from('expenses').select('sort_order').eq('sheet_name', sheet).order('sort_order', { ascending: false }).limit(1);
    return data && data.length ? data[0].sort_order + 1 : 4;
  }

  /* ---------------- list ---------------- */
  function renderMonthChips() {
    $('#month-chips').innerHTML = MONTHS.map((m) => `<button data-m="${m}" class="${m === state.month ? 'active' : ''}">${m}</button>`).join('');
    $$('#month-chips button').forEach((b) => (b.onclick = () => { state.month = b.dataset.m; renderMonthChips(); renderList(); }));
    const active = $('#month-chips .active'); if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }
  $('#list-search').oninput = renderList;
  $('#list-category').onchange = renderList;

  function renderList() {
    const sheet = `${state.month}_${state.year}`;
    const rows = state.expenses.filter((e) => e.sheet_name === sheet);
    const q = $('#list-search').value.trim().toLowerCase();
    const cat = $('#list-category').value;
    const shown = rows.filter((e) => (!cat || e.category === cat) &&
      (!q || [e.category, e.remarks, e.purchased_by, String(e.amount)].join(' ').toLowerCase().includes(q)));
    const spent = sum(spentOnly(rows));
    const savings = sum(rows) - spent;
    const daily = sum(rows.filter((r) => ['Daily Home Expenses', 'Healthcare & Toileteries', 'Meat', 'Drinks', 'Meal & Entertainment'].includes(r.category)));
    $('#list-stats').innerHTML = `
      <div class="stat"><small>${esc(sheet)} spent</small><b>${gbp(spent)}</b></div>
      <div class="stat"><small>Daily house expenses</small><b>${gbp(daily)}</b></div>
      <div class="stat"><small>Savings</small><b>${gbp(savings)}</b></div>
      <div class="stat"><small>Entries</small><b>${rows.length}</b></div>`;
    $('#expense-table tbody').innerHTML = shown.map((e) => `
      <tr data-id="${e.id}">
        <td class="date">${e.expense_date.split('-').reverse().join('/')}</td>
        <td class="cat"><span class="tag">${esc(e.category)}</span></td>
        <td class="num">${gbp(e.amount)}</td>
        <td class="by">${esc(e.purchased_by)}</td>
        <td class="remarks">${esc(e.remarks)}</td>
        <td class="acts">${e.receipt_path ? '<button class="link" data-act="receipt">Receipt</button>' : ''}<button class="link" data-act="edit">Edit</button><button class="link danger" data-act="del">Delete</button></td>
      </tr>`).join('');
    $('#list-empty').classList.toggle('hidden', shown.length > 0);
  }
  $('#expense-table').addEventListener('click', async (ev) => {
    const btn = ev.target.closest('button[data-act]'); if (!btn) return;
    const e = state.expenses.find((x) => x.id === btn.closest('tr').dataset.id); if (!e) return;
    if (btn.dataset.act === 'edit') startEdit(e);
    if (btn.dataset.act === 'receipt') {
      const w = window.open('', '_blank');
      const { data, error } = await sb.storage.from('receipts').createSignedUrl(e.receipt_path, 3600);
      if (error) { w && w.close(); return toast(error.message); }
      if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
    }
    if (btn.dataset.act === 'del') {
      if (!confirm(`Delete ${gbp(e.amount)} – ${e.category}${e.remarks ? ' (' + e.remarks + ')' : ''}?`)) return;
      const { error } = await sb.from('expenses').delete().eq('id', e.id);
      if (error) return toast(error.message);
      if (e.receipt_path) await sb.storage.from('receipts').remove([e.receipt_path]);
      toast('Deleted'); await refresh();
    }
  });

  /* ---------------- charts ---------------- */
  Chart.defaults.font.family = 'Manrope, system-ui, sans-serif';
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const catColor = (c) => PALETTE[Math.max(0, state.categories.indexOf(c)) % PALETTE.length] || PALETTE[0];
  const money = (v) => '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 });

  function chartConfigs(period, includeSavings, forPrint) {
    const ink = forPrint ? '#1d2420' : css('--ink');
    const grid = forPrint ? '#e4dccb' : css('--line');
    const keep = (rows) => (includeSavings ? rows : spentOnly(rows));
    const yearRows = keep(state.expenses);
    const rows = keep(rowsForPeriod(period));
    const cats = state.categories.concat([...new Set(yearRows.map((r) => r.category))].filter((c) => !state.categories.includes(c)))
      .filter((c) => includeSavings || !cfg.EXCLUDE_FROM_SPENT.includes(c));
    const scales = (stacked, horizontal) => {
      const val = { stacked, grid: { color: grid }, ticks: { color: ink, callback: money }, beginAtZero: true };
      const lab = { stacked, grid: { display: false }, ticks: { color: ink } };
      return horizontal ? { x: val, y: lab } : { x: lab, y: val };
    };
    const base = (extra) => Object.assign({
      responsive: !forPrint, maintainAspectRatio: false, animation: forPrint ? false : { duration: 300 }, devicePixelRatio: forPrint ? 1 : undefined,
      plugins: { legend: { labels: { color: ink, boxWidth: 12 } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${gbp(c.raw)}` } } },
    }, extra);

    // monthly stacked by category
    const monthly = {
      type: 'bar',
      data: {
        labels: MONTHS,
        datasets: cats.map((c) => ({
          label: c, backgroundColor: catColor(c), borderRadius: 3,
          data: MONTHS.map((m) => sum(yearRows.filter((r) => r.sheet_name === `${m}_${state.year}` && r.category === c))),
        })).filter((d) => d.data.some((v) => v > 0)),
      },
      options: base({ scales: scales(true), plugins: { legend: { position: 'bottom', labels: { color: ink, boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${gbp(c.raw)}`, footer: (items) => items.length ? 'Month total: ' + gbp(items[0].chart.data.datasets.reduce((s, d) => s + d.data[items[0].dataIndex], 0)) : '' } } } }),
    };
    const byCat = [...groupSum(rows, 'category').entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const pie = {
      type: 'doughnut',
      data: { labels: byCat.map((x) => x[0]), datasets: [{ data: byCat.map((x) => Math.round(x[1] * 100) / 100), backgroundColor: byCat.map((x) => catColor(x[0])), borderColor: forPrint ? '#fff' : css('--surface'), borderWidth: 2 }] },
      options: base({ cutout: '55%', plugins: { legend: { position: 'right', labels: { color: ink, boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => { const t = c.dataset.data.reduce((a, b) => a + b, 0); return `${c.label}: ${gbp(c.raw)} (${((c.raw / t) * 100).toFixed(1)}%)`; } } } } }),
    };
    const catbar = {
      type: 'bar',
      data: { labels: byCat.map((x) => x[0]), datasets: [{ label: 'Spent', data: byCat.map((x) => Math.round(x[1] * 100) / 100), backgroundColor: byCat.map((x) => catColor(x[0])), borderRadius: 4 }] },
      options: base({ indexAxis: 'y', scales: scales(false, true), plugins: { legend: { display: false } } }),
    };
    const byPerson = new Map();
    for (const r of rows) { const k = String(r.purchased_by || '—').toUpperCase(); byPerson.set(k, (byPerson.get(k) || 0) + Number(r.amount)); }
    const pp = [...byPerson.entries()].sort((a, b) => b[1] - a[1]);
    const person = {
      type: 'bar',
      data: { labels: pp.map((x) => x[0]), datasets: [{ label: 'Spent', data: pp.map((x) => Math.round(x[1] * 100) / 100), backgroundColor: PALETTE.slice(0, pp.length), borderRadius: 4 }] },
      options: base({ scales: scales(false), plugins: { legend: { display: false } } }),
    };
    const yearsMap = new Map();
    for (const r of keep(state.allYears)) { const y = r.sheet_name.slice(-4); yearsMap.set(y, (yearsMap.get(y) || 0) + Number(r.amount)); }
    const ys = [...yearsMap.keys()].sort();
    const years = {
      type: 'bar',
      data: { labels: ys, datasets: [{ label: 'Total', data: ys.map((y) => Math.round(yearsMap.get(y) * 100) / 100), backgroundColor: PALETTE[0], borderRadius: 4 }] },
      options: base({ scales: scales(false), plugins: { legend: { display: false } } }),
    };
    return { monthly, pie, catbar, person, years, rows, byCat };
  }

  function renderCharts() {
    if ($('#view-charts').classList.contains('hidden')) return;
    const period = $('#chart-period').value || 'year';
    const inc = $('#chart-savings').checked;
    const c = chartConfigs(period, inc, false);
    $('#pie-title').textContent = 'By category – ' + periodLabel(period);
    const ids = { monthly: '#chart-monthly', pie: '#chart-pie', catbar: '#chart-catbar', person: '#chart-person', years: '#chart-years' };
    for (const [k, sel] of Object.entries(ids)) {
      if (state.charts[k]) state.charts[k].destroy();
      state.charts[k] = new Chart($(sel), c[k]);
    }
    const total = sum(c.rows);
    const months = period === 'year' ? new Set(c.rows.map((r) => r.sheet_name)).size || 1 : 1;
    $('#chart-stats').innerHTML = `
      <div class="stat"><small>${esc(periodLabel(period))}</small><b>${gbp(total)}</b></div>
      <div class="stat"><small>${period === 'year' ? 'Average / month' : 'Entries'}</small><b>${period === 'year' ? gbp(total / months) : c.rows.length}</b></div>
      <div class="stat"><small>Top category</small><b style="font-size:1rem">${esc(c.byCat[0] ? c.byCat[0][0] : '—')}</b></div>`;
  }
  $('#chart-period').onchange = renderCharts;
  $('#chart-savings').onchange = renderCharts;
  $$('[data-png]').forEach((b) => (b.onclick = () => {
    const ch = state.charts[b.dataset.png]; if (!ch) return;
    const url = exportChartImage(ch);
    fetch(url).then((r) => r.blob()).then((blob) => download(blob, `${b.dataset.png}_${$('#chart-period').value}_${state.year}.png`));
  }));
  function exportChartImage(chart) {
    // draw on a solid background so the PNG is readable anywhere
    const src = chart.canvas; const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d'); ctx.fillStyle = css('--surface') || '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0);
    return c.toDataURL('image/png');
  }

  /** Render charts off-screen (light theme) for PDF reports. */
  function printCharts(period, includeSavings) {
    const c = chartConfigs(period, includeSavings, true);
    const out = {};
    for (const [k, size] of Object.entries({ monthly: [1400, 620], pie: [1000, 620], catbar: [1000, 620], person: [1000, 520] })) {
      const canvas = document.createElement('canvas'); canvas.width = size[0]; canvas.height = size[1];
      canvas.style.width = size[0] + 'px'; canvas.style.height = size[1] + 'px';
      const holder = document.createElement('div'); holder.style.cssText = 'position:fixed;left:-99999px;top:0;';
      holder.appendChild(canvas); document.body.appendChild(holder);
      const ch = new Chart(canvas, c[k]);
      const bg = document.createElement('canvas'); bg.width = size[0]; bg.height = size[1];
      const ctx = bg.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size[0], size[1]); ctx.drawImage(canvas, 0, 0);
      out[k] = { img: bg.toDataURL('image/png'), w: size[0], h: size[1] };
      ch.destroy(); holder.remove();
    }
    return out;
  }

  /* ---------------- PDF ---------------- */
  function buildPdf(period, withCharts, chartsOnly) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const all = rowsForPeriod(period);
    const spent = sum(spentOnly(all));
    const accent = [31, 95, 74];
    doc.setFillColor(...accent); doc.rect(0, 0, W, 26, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.text(cfg.WORKBOOK_TITLE, 14, 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`${periodLabel(period)}  ·  generated ${new Date().toLocaleDateString('en-GB')}`, 14, 19);
    doc.setTextColor(30);
    let y = 34;
    doc.setFontSize(11);
    doc.text(`Total spent: ${gbp(spent)}     Savings: ${gbp(sum(all) - spent)}     Entries: ${all.length}`, 14, y);
    y += 6;

    // category summary (mirrors the workbook "Types of Expenses" block)
    const cats = state.categories.concat([...new Set(all.map((r) => r.category))].filter((c) => !state.categories.includes(c)));
    const ytdRows = state.expenses;
    doc.autoTable({
      startY: y, theme: 'grid', headStyles: { fillColor: accent }, styles: { fontSize: 9 },
      head: [['Types of Expenses', period === 'year' ? `Total ${state.year}` : 'Total this month', `Total ${state.year}`]],
      body: cats.map((c) => [c, gbp(sum(all.filter((r) => r.category === c))), gbp(sum(ytdRows.filter((r) => r.category === c)))])
        .concat([['Total Spent (excl. savings)', gbp(spent), gbp(sum(spentOnly(ytdRows)))]]),
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      didParseCell: (d) => { if (d.row.index === cats.length) d.cell.styles.fontStyle = 'bold'; },
    });
    y = doc.lastAutoTable.finalY + 8;

    if (period === 'year') {
      doc.autoTable({
        startY: y, theme: 'striped', headStyles: { fillColor: accent }, styles: { fontSize: 9 },
        head: [['Month', 'Spent', 'Savings', 'Entries']],
        body: MONTHS.map((m) => { const r = state.expenses.filter((e) => e.sheet_name === `${m}_${state.year}`); const s = sum(spentOnly(r)); return [`${m}_${state.year}`, gbp(s), gbp(sum(r) - s), r.length]; }),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      });
      y = doc.lastAutoTable.finalY + 8;
    }

    if (withCharts) {
      const imgs = printCharts(period, false);
      doc.addPage(); y = 16;
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(`Charts – ${periodLabel(period)} (excl. savings)`, 14, y); y += 6;
      const place = (key, title) => {
        const im = imgs[key]; const w = W - 28; const h = (im.h / im.w) * w;
        if (y + h + 8 > doc.internal.pageSize.getHeight() - 10) { doc.addPage(); y = 16; }
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(title, 14, y + 4);
        doc.addImage(im.img, 'PNG', 14, y + 6, w, h); y += h + 12;
      };
      place('monthly', `Spending per month ${state.year}`);
      place('pie', 'Share by category');
      place('catbar', 'By category (£)');
      place('person', 'By person');
    }

    if (!chartsOnly) {
      doc.addPage();
      doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.text(`Expenses – ${periodLabel(period)}`, 14, 16);
      doc.autoTable({
        startY: 21, theme: 'striped', headStyles: { fillColor: accent }, styles: { fontSize: 8, cellPadding: 1.6 },
        head: [['Sheet', 'Date', 'Category', 'Price', 'Purchase by', 'Remarks/Details']],
        body: all.map((e) => [e.sheet_name, e.expense_date.split('-').reverse().join('/'), e.category, gbp(e.amount), e.purchased_by || '', e.remarks || '']),
        columnStyles: { 3: { halign: 'right' }, 5: { cellWidth: 62 } },
      });
    }
    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120); doc.text(`Page ${i} of ${pages}`, W - 14, doc.internal.pageSize.getHeight() - 6, { align: 'right' }); }
    return doc.output('blob');
  }
  const pdfName = (period, suffix = '') => `${cfg.FILE_PREFIX}_${period === 'year' ? state.year : period + '_' + state.year}${suffix}.pdf`;

  $('#pdf-download').onclick = () => {
    const p = $('#pdf-period').value; download(buildPdf(p, $('#pdf-charts').checked), pdfName(p));
  };
  $('#pdf-share').onclick = () => {
    const p = $('#pdf-period').value;
    shareFile(buildPdf(p, $('#pdf-charts').checked), pdfName(p), `House expenses – ${periodLabel(p)}: ${gbp(sum(spentOnly(rowsForPeriod(p))))} spent`);
  };
  $('#charts-pdf').onclick = () => {
    const p = $('#chart-period').value; download(buildPdf(p, true, true), pdfName(p, '_charts'));
  };
  $('#charts-share').onclick = () => {
    const p = $('#chart-period').value;
    shareFile(buildPdf(p, true, true), pdfName(p, '_charts'), `House expenses charts – ${periodLabel(p)}`);
  };

  /* ---------------- Excel ---------------- */
  async function getTemplate() {
    const { data, error } = await sb.storage.from('templates').download(cfg.TEMPLATE_PATH);
    if (error || !data) return null;
    return data;
  }
  async function buildExcel() {
    const tpl = await getTemplate();
    if (!tpl) throw new Error('No workbook template yet — upload it under Settings first.');
    const bySheet = {};
    for (const e of state.expenses) (bySheet[e.sheet_name] = bySheet[e.sheet_name] || []).push(e);
    const { blob, warnings } = await XlsxExport.buildWorkbook(await tpl.arrayBuffer(), state.year, bySheet);
    return { blob, warnings, name: `${cfg.FILE_PREFIX}_${state.year}.xlsx` };
  }
  $('#xlsx-download').onclick = async (ev) => {
    const btn = ev.currentTarget; busy(btn, true, 'Building…');
    try { const r = await buildExcel(); download(r.blob, r.name); setMsg($('#xlsx-msg'), r.warnings.join(' ') || `${r.name} downloaded.`, r.warnings.length ? 'error' : 'ok'); }
    catch (err) { setMsg($('#xlsx-msg'), err.message, 'error'); }
    busy(btn, false);
  };
  $('#xlsx-share').onclick = async (ev) => {
    const btn = ev.currentTarget; busy(btn, true, 'Building…');
    try { const r = await buildExcel(); busy(btn, false); await shareFile(r.blob, r.name, `House expenses workbook ${state.year}`); }
    catch (err) { setMsg($('#xlsx-msg'), err.message, 'error'); busy(btn, false); }
  };

  /* ---------------- summary / CSV ---------------- */
  function summaryText(period) {
    const rows = rowsForPeriod(period);
    const spent = sum(spentOnly(rows));
    const lines = [`🏠 *House expenses – ${periodLabel(period)}*`, `Total spent: *${gbp(spent)}*`, ''];
    const byCat = [...groupSum(spentOnly(rows), 'category').entries()].sort((a, b) => b[1] - a[1]);
    for (const [c, v] of byCat) lines.push(`• ${c}: ${gbp(v)}`);
    const sav = sum(rows) - spent;
    if (sav) lines.push('', `Savings: ${gbp(sav)}`);
    return lines.join('\n');
  }
  function renderSummary() { $('#sum-preview').textContent = summaryText($('#sum-period').value || 'year'); }
  $('#sum-period').onchange = renderSummary;
  $('#sum-share').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(summaryText($('#sum-period').value)), '_blank', 'noopener');
  $('#csv-download').onclick = () => {
    const p = $('#sum-period').value; const rows = rowsForPeriod(p);
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = ['Sheet,Date,Category,Price,Purchase by,Remarks/Details', ...rows.map((e) => [e.sheet_name, e.expense_date, e.category, e.amount, e.purchased_by, e.remarks].map(q).join(','))].join('\r\n');
    download(new Blob(['﻿' + csv], { type: 'text/csv' }), `${cfg.FILE_PREFIX}_${p === 'year' ? state.year : p + '_' + state.year}.csv`);
  };

  /* ---------------- settings ---------------- */
  async function renderSettings() {
    const tpl = await sb.storage.from('templates').list('', { search: cfg.TEMPLATE_PATH });
    const found = tpl.data && tpl.data.find((f) => f.name === cfg.TEMPLATE_PATH);
    const st = $('#tpl-status');
    st.textContent = found ? `Template uploaded · ${new Date(found.updated_at || found.created_at).toLocaleDateString('en-GB')}` : 'No template uploaded yet';
    st.className = 'pill ' + (found ? 'ok' : 'warn');

    const { data: members } = await sb.from('household_members').select('*').order('created_at');
    $('#members-list').innerHTML = (members || []).map((m) => `<li>${esc(m.email)}<button data-email="${esc(m.email)}" title="Remove">×</button></li>`).join('');
    $('#categories-list').innerHTML = state.categories.map((c) => `<li>${esc(c)}<button data-cat="${esc(c)}" title="Remove">×</button></li>`).join('');
    $('#people-list').innerHTML = state.people.map((c) => `<li>${esc(c)}<button data-person="${esc(c)}" title="Remove">×</button></li>`).join('');
  }
  $('#tpl-input').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try { await JSZip.loadAsync(f); } catch (_) { return toast('That is not a valid .xlsx file'); }
    const { error } = await sb.storage.from('templates').upload(cfg.TEMPLATE_PATH, f, { upsert: true, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    toast(error ? error.message : 'Template saved'); renderSettings();
  };
  $('#import-input').onchange = async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    const msg = $('#import-msg');
    try {
      const sheets = await XlsxExport.readWorkbook(f);
      const names = Object.keys(sheets);
      if (!names.length) throw new Error('No month sheets (like Oct_2026) found in that file.');
      const count = names.reduce((a, n) => a + sheets[n].length, 0);
      if (!confirm(`Replace the database rows for ${names.length} sheets (${names[0]} … ${names[names.length - 1]}) with ${count} rows from this file?`)) return;
      setMsg(msg, 'Importing…');
      for (const n of names) {
        const { error: dErr } = await sb.from('expenses').delete().eq('sheet_name', n).is('receipt_path', null);
        if (dErr) throw dErr;
        // entries with receipts were kept – don't import them twice
        const { data: kept } = await sb.from('expenses').select('expense_date,amount,category').eq('sheet_name', n);
        const key = (r) => `${r.expense_date}|${Number(r.amount).toFixed(2)}|${r.category}`;
        const keptKeys = new Set((kept || []).map(key));
        const rows = sheets[n].filter((r) => r.expense_date && r.category && !keptKeys.has(key(r)))
          .map((r) => ({ ...r, purchased_by: r.purchased_by || null }));
        if (rows.length) { const { error } = await sb.from('expenses').insert(rows); if (error) throw error; }
      }
      setMsg(msg, `Imported ${count} rows. Entries that have receipts were kept.`, 'ok');
      await refresh();
    } catch (err) { setMsg(msg, err.message, 'error'); }
  };
  $('#member-form').onsubmit = async (e) => {
    e.preventDefault();
    const email = $('#member-email').value.trim().toLowerCase();
    const { error } = await sb.from('household_members').insert({ email });
    toast(error ? error.message : `${email} can now sign in`); $('#member-email').value = ''; renderSettings();
  };
  $('#members-list').onclick = async (e) => {
    const b = e.target.closest('button[data-email]'); if (!b) return;
    if (b.dataset.email.toLowerCase() === state.user.email.toLowerCase() && !confirm('Remove yourself? You will lose access.')) return;
    if (!confirm(`Remove ${b.dataset.email}?`)) return;
    const { error } = await sb.from('household_members').delete().eq('email', b.dataset.email);
    toast(error ? error.message : 'Removed'); renderSettings();
  };
  async function addLookup(table, input) {
    const name = input.value.trim(); if (!name) return;
    const { error } = await sb.from(table).insert({ name, sort: 100 });
    if (error) return toast(error.message);
    input.value = ''; await loadLookups();
    fillSelect($('#f-category'), state.categories); fillSelect($('#f-person'), state.people);
    fillSelect($('#list-category'), state.categories, 'All categories'); renderSettings();
  }
  $('#category-form').onsubmit = (e) => { e.preventDefault(); addLookup('categories', $('#category-name')); };
  $('#person-form').onsubmit = (e) => { e.preventDefault(); addLookup('people', $('#person-name')); };
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-cat], button[data-person]'); if (!b) return;
    const [table, name] = b.dataset.cat ? ['categories', b.dataset.cat] : ['people', b.dataset.person];
    if (!confirm(`Remove "${name}" from the list? Existing expenses keep their value.`)) return;
    const { error } = await sb.from(table).delete().eq('name', name);
    if (error) return toast(error.message);
    await loadLookups(); fillSelect($('#f-category'), state.categories); fillSelect($('#f-person'), state.people); renderSettings();
  });

  // re-theme charts if the OS theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderCharts);
})();
