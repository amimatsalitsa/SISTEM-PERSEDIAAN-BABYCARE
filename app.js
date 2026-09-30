const TABLES = {
  categories: 'categories',
  suppliers: 'suppliers',
  products: 'products',
  movements: 'stock_movements'
};
const VIEW_META = {
  categories: { title: 'Kategori', description: 'Kelompokkan perlengkapan bayi agar lebih mudah ditemukan.', table: TABLES.categories },
  suppliers: { title: 'Pemasok', description: 'Simpan informasi mitra pemasok perlengkapan bayi.', table: TABLES.suppliers },
  products: { title: 'Produk', description: 'Pantau katalog produk dan jumlah stok yang tersedia.', table: TABLES.products },
  movements: { title: 'Pergerakan Stok', description: 'Catat barang masuk dan keluar; stok produk diperbarui otomatis.', table: TABLES.movements }
};
const data = { categories: [], suppliers: [], products: [], movements: [] };
let currentView = 'dashboard';
let activeForm = null;
let searchTerm = '';
let categoryFilter = '';
const page = document.querySelector('#page-content');
const recordDialog = document.querySelector('#record-dialog');
const settingsDialog = document.querySelector('#settings-dialog');
const recordForm = document.querySelector('#record-form');
const settingsForm = document.querySelector('#settings-form');

const iconBottle = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M18 5h12v5l-2 3v5.1c6 3.1 9 8.6 9 15.1A10.8 10.8 0 0 1 26.2 44h-4.4A10.8 10.8 0 0 1 11 33.2c0-6.5 3-12 9-15.1V13l-2-3V5Z"/><path d="M19 10h10M20 24h8M18 32h12"/></svg>';
const fields = {
  categories: [
    { name: 'name', label: 'Nama kategori', required: true, placeholder: 'Contoh: Perawatan' },
    { name: 'description', label: 'Deskripsi', type: 'textarea', placeholder: 'Keterangan singkat (opsional)' }
  ],
  suppliers: [
    { name: 'name', label: 'Nama pemasok', required: true },
    { name: 'contact_name', label: 'Nama kontak' },
    { name: 'phone', label: 'Nomor telepon', type: 'tel' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'address', label: 'Alamat', type: 'textarea' }
  ],
  products: [
    { name: 'sku', label: 'SKU / kode produk', required: true },
    { name: 'name', label: 'Nama produk', required: true },
    { name: 'category_id', label: 'Kategori', type: 'select', source: 'categories', required: true },
    { name: 'supplier_id', label: 'Pemasok', type: 'select', source: 'suppliers', required: true },
    { name: 'unit', label: 'Satuan', required: true, placeholder: 'Contoh: pcs, pak, botol' },
    { name: 'varian', label: 'Varian', placeholder: 'Contoh: Newborn, ukuran S, warna sage' },
    { name: 'tanggal_kadaluarsa', label: 'Tanggal kedaluwarsa', type: 'date' },
    { name: 'price', label: 'Harga jual (Rp)', type: 'text', inputmode: 'numeric', required: true },
    { name: 'min_stock', label: 'Batas minimum stok', type: 'number', min: 0, step: 1, required: true }
  ],
  movements: [
    { name: 'product_id', label: 'Produk', type: 'select', source: 'products', required: true },
    { name: 'type', label: 'Jenis pergerakan', type: 'select', options: [{ value: 'in', label: 'Barang masuk' }, { value: 'out', label: 'Barang keluar' }], required: true },
    { name: 'quantity', label: 'Jumlah', type: 'number', min: 1, step: 1, required: true },
    { name: 'notes', label: 'Catatan', type: 'textarea', placeholder: 'Contoh: pembelian dari pemasok' }
  ]
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatGroupedInteger(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? new Intl.NumberFormat(recordForm.dataset.priceLocale || 'id-ID').format(Number(digits)) : '';
}
function caretAfterDigitCount(value, digitCount) {
  if (!digitCount) return 0;
  let currentDigitCount = 0;
  for (let index = 0; index < value.length; index++) {
    if (/\d/.test(value[index])) currentDigitCount++;
    if (currentDigitCount === digitCount) return index + 1;
  }
  return value.length;
}
function money(value) { return `Rp ${formatGroupedInteger(value) || '0'}`; }
function dateLabel(value) { return value ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '-'; }
function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  document.querySelector('#toast-region').append(toast);
  window.setTimeout(() => toast.remove(), 3800);
}
function setConnection(connected, label = connected ? 'Terhubung' : 'Belum terhubung') {
  const status = document.querySelector('#connection-status');
  status.classList.toggle('connected', connected);
  status.querySelector('span').textContent = label;
}
function getConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('babycare-supabase') || 'null');
    if (saved?.url && saved?.key) return saved;
  } catch { /* Use the shared config if browser storage is unavailable. */ }
  const shared = window.BABYCARE_SUPABASE_CONFIG;
  return shared?.url && shared?.publishableKey ? { url: shared.url, key: shared.publishableKey } : null;
}
async function request(table, method = 'GET', query = '', body = null) {
  const config = getConfig();
  if (!config?.url || !config?.key) throw new Error('Lengkapi koneksi Supabase terlebih dahulu.');
  const headers = { apikey: config.key, Accept: 'application/json' };
  if (!config.key.startsWith('sb_publishable_')) headers.Authorization = `Bearer ${config.key}`;
  if (body !== null) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers.Prefer = 'return=representation';
  const response = await fetch(`${config.url}/rest/v1/${table}${query ? `?${query}` : ''}`, { method, headers, body: body === null ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let result = null;
  try { result = text ? JSON.parse(text) : null; } catch { result = text; }
  if (!response.ok) throw new Error(result?.message || result?.hint || `Supabase merespons ${response.status}.`);
  return result;
}
function rowsFrom(result) { return Array.isArray(result) ? result : []; }
async function loadData() {
  const results = await Promise.all([
    request(TABLES.categories, 'GET', 'select=id,name,description,created_at&order=name.asc'),
    request(TABLES.suppliers, 'GET', 'select=id,name,contact_name,phone,email,address,created_at&order=name.asc'),
    request(TABLES.products, 'GET', 'select=id,sku,name,category_id,supplier_id,unit,varian,tanggal_kadaluarsa,price,stock,min_stock,created_at,category:categories(name),supplier:suppliers(name)&order=tanggal_kadaluarsa.asc.nullslast,name.asc'),
    request(TABLES.movements, 'GET', 'select=id,product_id,type,quantity,notes,created_at,product:products(name,sku)&order=created_at.desc&limit=100')
  ]);
  [data.categories, data.suppliers, data.products, data.movements] = results.map(rowsFrom);
}
function renderSetup(error = '') {
  setConnection(false, getConfig() ? 'Koneksi gagal' : 'Belum terhubung');
  page.innerHTML = `<div class="setup-card"><div class="setup-bottle">${iconBottle}</div><span class="eyebrow">SISTEM PERSEDIAAN PERLENGKAPAN BAYI</span><h1>Selamat datang di BabyCare</h1><p>Hubungkan project Supabase untuk mulai mengelola kategori, pemasok, produk, dan pergerakan stok dari satu dashboard.</p><button class="button button-primary" type="button" id="setup-connect">Atur koneksi Supabase</button>${error ? `<p class="connection-error">${escapeHtml(error)}</p>` : ''}</div>`;
  document.querySelector('#setup-connect').addEventListener('click', openSettings);
}
function isLowStock(product) { return Number(product.stock) < Number(product.min_stock); }
function expirationState(date) {
  if (!date) return '';
  const expiration = new Date(`${date}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysRemaining = Math.ceil((expiration.getTime() - today.getTime()) / 86400000);
  if (daysRemaining < 0) return 'expired';
  if (daysRemaining <= 30) return 'expiring';
  return 'safe';
}
function expirationBadge(date) {
  if (!date) return '<span class="muted-value">-</span>';
  const status = expirationState(date);
  const label = status === 'expired' ? `Kedaluwarsa · ${dateLabel(date)}` : status === 'expiring' ? `≤ 30 hari · ${dateLabel(date)}` : dateLabel(date);
  return `<span class="badge expiry ${status}">${escapeHtml(label)}</span>`;
}
function sortProductsFefo(products) {
  return [...products].sort((first, second) => (first.tanggal_kadaluarsa || '9999-12-31').localeCompare(second.tanggal_kadaluarsa || '9999-12-31'));
}
function renderDashboard() {
  const lowStock = data.products.filter(isLowStock);
  const alertProducts = sortProductsFefo(data.products.filter((product) => isLowStock(product) || ['expired', 'expiring'].includes(expirationState(product.tanggal_kadaluarsa))));
  const recent = data.movements.slice(0, 5);
  const stockRows = alertProducts.length ? alertProducts.slice(0, 6).map((product) => {
    const alerts = [];
    if (isLowStock(product)) alerts.push(`Stok ${Number(product.stock)} / min. ${Number(product.min_stock)}`);
    if (expirationState(product.tanggal_kadaluarsa) === 'expired') alerts.push('Sudah kedaluwarsa');
    else if (expirationState(product.tanggal_kadaluarsa) === 'expiring') alerts.push(`Kedaluwarsa ${dateLabel(product.tanggal_kadaluarsa)}`);
    return `<div class="stock-row"><strong>${escapeHtml(product.name)}${product.varian ? ` · ${escapeHtml(product.varian)}` : ''}</strong><small>${escapeHtml(product.sku)} · ${escapeHtml(product.unit)}</small><span class="stock-badge">${escapeHtml(alerts.join(' · '))}</span></div>`;
  }).join('') : '<div class="empty-state">Stok aman dan tidak ada produk yang segera kedaluwarsa.</div>';
  const movementRows = recent.length ? recent.map((movement) => `<tr><td><strong>${escapeHtml(movement.product?.name || 'Produk dihapus')}</strong></td><td><span class="badge ${movement.type === 'in' ? 'in' : 'out'}">${movement.type === 'in' ? 'Masuk' : 'Keluar'}</span></td><td>${Number(movement.quantity)}</td><td>${dateLabel(movement.created_at)}</td></tr>`).join('') : '<tr><td colspan="4" class="table-empty">Belum ada pergerakan stok.</td></tr>';
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow">RINGKASAN TOKO</span><h1>Selamat datang, BabyCare</h1><p>Ringkasan persediaan perlengkapan si kecil hari ini.</p></div><button class="button button-primary" type="button" data-add="movements">＋ Catat pergerakan</button></div>
    <div class="stats-grid"><article class="stat-card"><div class="stat-top"><span class="stat-label">Total produk</span><span class="stat-mark">▤</span></div><div class="stat-value">${data.products.length}</div><div class="stat-foot">Produk aktif di katalog</div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Unit persediaan</span><span class="stat-mark">▧</span></div><div class="stat-value">${data.products.reduce((sum, item) => sum + Number(item.stock || 0), 0)}</div><div class="stat-foot">Jumlah seluruh stok</div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Stok menipis</span><span class="stat-mark">!</span></div><div class="stat-value">${lowStock.length}</div><div class="stat-foot">Produk mencapai batas minimum</div></article><article class="stat-card"><div class="stat-top"><span class="stat-label">Pemasok</span><span class="stat-mark">♧</span></div><div class="stat-value">${data.suppliers.length}</div><div class="stat-foot">Mitra pemasok terdaftar</div></article></div>
    <div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Pergerakan terbaru</h2><p>Catatan stok terakhir</p></div><button class="text-link" type="button" data-view="movements">Lihat semua →</button></div><div class="table-wrap"><table><thead><tr><th>Produk</th><th>Jenis</th><th>Jumlah</th><th>Tanggal</th></tr></thead><tbody>${movementRows}</tbody></table></div></section><section class="panel"><div class="panel-heading"><div><h2>Peringatan inventaris</h2><p>${alertProducts.length} peringatan stok / kedaluwarsa</p></div><button class="text-link" type="button" data-view="products">Produk →</button></div><div class="stock-list">${stockRows}</div></section></div>
    <div class="quick-strip"><strong>Akses cepat</strong><button type="button" data-add="products">＋ Produk</button><button type="button" data-add="categories">＋ Kategori</button><button type="button" data-add="suppliers">＋ Pemasok</button></div>`;
}
function filterRows(rows) {
  if (currentView === 'products') {
    const filtered = rows.filter((row) => {
      const searchable = [row.name, row.sku, row.varian, row.category?.name, row.supplier?.name].join(' ').toLowerCase();
      return (!searchTerm || searchable.includes(searchTerm.toLowerCase())) && (!categoryFilter || String(row.category_id) === categoryFilter);
    });
    return sortProductsFefo(filtered);
  }
  if (!searchTerm) return rows;
  return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(searchTerm.toLowerCase()));
}
function columnsFor(view) {
  if (view === 'categories') return [
    ['name', 'Nama kategori', (row) => `<strong>${escapeHtml(row.name)}</strong>`], ['description', 'Deskripsi', (row) => escapeHtml(row.description || '-')], ['products', 'Produk', (row) => data.products.filter((product) => product.category_id === row.id).length]
  ];
  if (view === 'suppliers') return [
    ['name', 'Nama pemasok', (row) => `<strong>${escapeHtml(row.name)}</strong>`], ['contact', 'Kontak', (row) => escapeHtml(row.contact_name || '-')], ['phone', 'Telepon', (row) => escapeHtml(row.phone || '-')], ['email', 'Email', (row) => escapeHtml(row.email || '-')], ['products', 'Produk', (row) => data.products.filter((product) => product.supplier_id === row.id).length]
  ];
  if (view === 'products') return [
    ['sku', 'SKU', (row) => `<strong>${escapeHtml(row.sku)}</strong>`], ['name', 'Nama produk', (row) => escapeHtml(row.name)], ['variant', 'Varian', (row) => escapeHtml(row.varian || '-')], ['category', 'Kategori', (row) => escapeHtml(row.category?.name || '-')], ['supplier', 'Pemasok', (row) => escapeHtml(row.supplier?.name || '-')], ['expiry', 'Kedaluwarsa', (row) => expirationBadge(row.tanggal_kadaluarsa)], ['price', 'Harga', (row) => money(row.price)], ['stock', 'Stok', (row) => `<span class="badge ${isLowStock(row) ? 'low-stock' : 'stock-safe'}">${Number(row.stock)} ${escapeHtml(row.unit)}${isLowStock(row) ? ` · min ${Number(row.min_stock)}` : ''}</span>`]
  ];
  return [
    ['date', 'Tanggal', (row) => dateLabel(row.created_at)], ['product', 'Produk', (row) => `<strong>${escapeHtml(row.product?.name || 'Produk dihapus')}</strong><br><small>${escapeHtml(row.product?.sku || '')}</small>`], ['type', 'Jenis', (row) => `<span class="badge ${row.type === 'in' ? 'in' : 'out'}">${row.type === 'in' ? 'Barang masuk' : 'Barang keluar'}</span>`], ['quantity', 'Jumlah', (row) => Number(row.quantity)], ['notes', 'Catatan', (row) => escapeHtml(row.notes || '-')]
  ];
}
function renderMaster(view) {
  const meta = VIEW_META[view];
  const records = filterRows(data[view]);
  const columns = columnsFor(view);
  const headings = columns.map(([, label]) => `<th>${label}</th>`).join('');
  const readOnly = view === 'movements';
  const actionHeader = readOnly ? '' : '<th>Aksi</th>';
  const body = records.length ? records.map((row) => `<tr>${columns.map(([, , render]) => `<td>${render(row)}</td>`).join('')}${readOnly ? '' : `<td><div class="row-actions"><button type="button" data-edit="${escapeHtml(row.id)}">Ubah</button><button class="delete-action" type="button" data-delete="${escapeHtml(row.id)}">Hapus</button></div></td>`}</tr>`).join('') : `<tr><td class="table-empty" colspan="${columns.length + (readOnly ? 0 : 1)}">${searchTerm || categoryFilter ? 'Tidak ada data yang cocok dengan filter.' : 'Belum ada data. Tambahkan data pertama untuk memulai.'}</td></tr>`;
  const categoryOptions = data.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${String(category.id) === categoryFilter ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('');
  const categoryControl = view === 'products' ? `<select class="search-input category-filter" id="category-filter" aria-label="Filter berdasarkan kategori"><option value="">Semua kategori</option>${categoryOptions}</select>` : '';
  const searchPlaceholder = view === 'products' ? 'Cari nama, SKU, atau varian...' : `Cari ${meta.title.toLowerCase()}...`;
  const addLabel = view === 'movements' ? '＋ Catat stok' : '＋ Tambah data';
  page.innerHTML = `<div class="page-heading"><div><span class="eyebrow">MASTER DATA</span><h1>${meta.title}</h1><p>${meta.description}${readOnly ? ' · Riwayat bersifat permanen.' : ''}</p></div><div class="toolbar"><input class="search-input" id="table-search" type="search" placeholder="${searchPlaceholder}" value="${escapeHtml(searchTerm)}" aria-label="${searchPlaceholder}">${categoryControl}<button class="button button-primary" type="button" data-add="${view}">${addLabel}</button></div></div><section class="panel data-panel"><div class="table-wrap"><table class="data-table"><thead><tr>${headings}${actionHeader}</tr></thead><tbody>${body}</tbody></table></div></section>`;
  const search = document.querySelector('#table-search');
  search.addEventListener('input', () => { searchTerm = search.value.trim(); const cursor = search.selectionStart; renderMaster(view); const nextSearch = document.querySelector('#table-search'); nextSearch.focus(); nextSearch.setSelectionRange(cursor, cursor); });
  document.querySelector('#category-filter')?.addEventListener('change', (event) => { categoryFilter = event.target.value; renderMaster(view); });
}
function render() {
  document.querySelector('#page-crumb').textContent = currentView === 'dashboard' ? 'Dashboard' : VIEW_META[currentView].title;
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === currentView));
  if (currentView === 'dashboard') renderDashboard(); else renderMaster(currentView);
}
function selectOptions(field, selectedValue) {
  const rows = data[field.source] || [];
  const options = field.options || rows.map((row) => ({ value: row.id, label: field.source === 'products' ? `${row.sku} · ${row.name}` : row.name }));
  return `<option value="">Pilih ${field.label.toLowerCase()}</option>${options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(selectedValue) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}`;
}
function openRecordForm(view, record = null) {
  if (view === 'products' && (!data.categories.length || !data.suppliers.length)) { showToast('Tambahkan kategori dan pemasok terlebih dahulu.', true); return; }
  if (view === 'movements' && !data.products.length) { showToast('Tambahkan produk terlebih dahulu.', true); return; }
  activeForm = { view, record };
  document.querySelector('#dialog-eyebrow').textContent = view === 'movements' ? 'CATATAN STOK' : 'MASTER DATA';
  document.querySelector('#dialog-title').textContent = `${record ? 'Ubah' : 'Tambah'} ${VIEW_META[view].title.toLowerCase()}`;
  document.querySelector('#form-fields').innerHTML = fields[view].map((field) => {
    const value = record?.[field.name] ?? (field.name === 'quantity' ? 1 : field.name === 'min_stock' ? 5 : '');
    const displayValue = field.name === 'price' && value !== '' ? formatGroupedInteger(value) : value;
    const required = field.required ? 'required' : '';
    const placeholder = field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : '';
    const inputmode = field.inputmode ? `inputmode="${field.inputmode}"` : '';
    let control;
    if (field.type === 'select') control = `<select name="${field.name}" ${required}>${selectOptions(field, value)}</select>`;
    else if (field.type === 'textarea') control = `<textarea name="${field.name}" ${placeholder}>${escapeHtml(value)}</textarea>`;
    else control = `<input name="${field.name}" type="${field.type || 'text'}" value="${escapeHtml(displayValue)}" ${inputmode} ${field.min !== undefined ? `min="${field.min}"` : ''} ${field.step ? `step="${field.step}"` : ''} ${required} ${placeholder}>`;
    return `<label class="field"><span>${field.label}</span>${control}</label>`;
  }).join('');
  recordDialog.showModal();
}
function openSettings() {
  const config = getConfig();
  settingsForm.elements.url.value = config?.url || '';
  settingsForm.elements.key.value = config?.key || '';
  settingsDialog.showModal();
}
async function saveRecord(event) {
  event.preventDefault();
  if (!activeForm) return;
  const { view, record } = activeForm;
  const payload = Object.fromEntries(new FormData(recordForm).entries());
  for (const field of fields[view]) {
    if (field.name === 'price') payload[field.name] = Number(String(payload[field.name] ?? '').replace(/\D/g, ''));
    else if (field.type === 'number') payload[field.name] = Number(payload[field.name]);
    if (payload[field.name] === '') payload[field.name] = null;
  }
  try {
    const method = record ? 'PATCH' : 'POST';
    await request(VIEW_META[view].table, method, record ? `id=eq.${encodeURIComponent(record.id)}` : '', payload);
    recordDialog.close();
    showToast(`${VIEW_META[view].title} berhasil ${record ? 'diperbarui' : 'ditambahkan'}.`);
    await refreshData();
  } catch (error) { showToast(error.message, true); }
}
async function deleteRecord(view, id) {
  const row = data[view].find((item) => String(item.id) === String(id));
  if (!row || !window.confirm(`Hapus data "${row.name || row.sku || row.product?.name || 'ini'}"?`)) return;
  try {
    await request(VIEW_META[view].table, 'DELETE', `id=eq.${encodeURIComponent(id)}`);
    showToast('Data berhasil dihapus.');
    await refreshData();
  } catch (error) { showToast(error.message, true); }
}
async function refreshData() {
  try {
    await loadData();
    setConnection(true);
    render();
  } catch (error) {
    setConnection(false, 'Koneksi gagal');
    renderSetup(error.message);
  }
}
async function connectSupabase(url, key) {
  const cleanUrl = url.trim().replace(/\/$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(cleanUrl)) throw new Error('Gunakan URL project Supabase, contoh https://project-id.supabase.co.');
  const config = { url: cleanUrl, key: key.trim() };
  try { localStorage.setItem('babycare-supabase', JSON.stringify(config)); }
  catch { window.BABYCARE_SUPABASE_CONFIG = { url: cleanUrl, publishableKey: key.trim() }; }
  await loadData();
  setConnection(true);
  settingsDialog.close();
  currentView = 'dashboard';
  render();
  showToast('BabyCare berhasil terhubung ke Supabase.');
}

document.querySelector('#today-year').textContent = new Date().getFullYear();
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { currentView = button.dataset.view; searchTerm = ''; categoryFilter = ''; render(); document.querySelector('#sidebar').classList.remove('open'); }));
document.querySelector('#menu-toggle').addEventListener('click', () => document.querySelector('#sidebar').classList.toggle('open'));
document.querySelector('#open-settings').addEventListener('click', openSettings);
page.addEventListener('click', (event) => {
  const add = event.target.closest('[data-add]');
  const nav = event.target.closest('[data-view]');
  const edit = event.target.closest('[data-edit]');
  const remove = event.target.closest('[data-delete]');
  if (add) openRecordForm(add.dataset.add);
  else if (edit) openRecordForm(currentView, data[currentView].find((row) => String(row.id) === edit.dataset.edit));
  else if (remove) deleteRecord(currentView, remove.dataset.delete);
  else if (nav) { currentView = nav.dataset.view; searchTerm = ''; categoryFilter = ''; render(); }
});
document.querySelector('#form-fields').addEventListener('input', (event) => {
  const input = event.target;
  if (input.name !== 'price') return;
  const digitCount = input.value.slice(0, input.selectionStart ?? input.value.length).replace(/\D/g, '').length;
  input.value = formatGroupedInteger(input.value);
  const caret = caretAfterDigitCount(input.value, digitCount);
  input.setSelectionRange(caret, caret);
});
recordForm.addEventListener('submit', saveRecord);
settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = settingsForm.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Menghubungkan...';
  try { await connectSupabase(settingsForm.elements.url.value, settingsForm.elements.key.value); }
  catch (error) { showToast(error.message, true); }
  finally { submit.disabled = false; submit.textContent = 'Simpan & hubungkan'; }
});

if (getConfig()) refreshData(); else renderSetup();
