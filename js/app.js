/* =========================================================================
   Advyza — app logic

   Signed-in users: edits are saved through the Express API to the Supabase
   `results` table (see server/routes/results.js and sql/schema.sql).

   Guest mode (not signed in, or Supabase not configured yet): everything
   is saved to browser localStorage and reloaded on next visit.
   ========================================================================= */

const META = {
  university: 'FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI'
};
const YEAR_KEYS = Array.from({ length: 10 }, (_, i) => 'Year ' + (i + 1));
const SEMESTERS = ['Harmattan Semester', 'Rain Semester'];
const emptyRow = () => ({ id: null, regNo: '', name: '', code: '', title: '', unit: '', score: '', isCarryover: false });

let state = { years: {}, currentView: 'Year 1', meta: { school: 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)', department: 'DEPARTMENT OF PUBLIC HEALTH' }, creditLoad: {} };
YEAR_KEYS.forEach(y => {
  state.years[y] = {};
  SEMESTERS.forEach(s => { state.years[y][s] = [emptyRow()]; });
});

let currentUser = null;
let accessToken = null;
const saveTimers = {};
let saveIndicatorTimer = null;

/* ===================== LETTERHEAD ===================== */
function renderLetterhead(title) {
  return `
    <div class="letterhead">
      <img src="assets/futo-logo.jpeg" class="letterhead-logo" alt="FUTO Logo">
      <div class="letterhead-center">
        <h2>${META.university}</h2>
        <h3>${escHtml(state.meta.school)}</h3>
        <p>${escHtml(state.meta.department)}</p>
        <div class="title-row">${escHtml(title)}</div>
      </div>
      <img src="assets/futo-logo.jpeg" class="letterhead-logo" alt="FUTO Logo">
    </div>
  `;
}

/* ===================== NAV ===================== */
function buildNav() {
  const nav = document.getElementById('navGroup');
  if (!nav) return;
  let html = '<div class="nav-label">RESULT SHEETS</div>';
  YEAR_KEYS.forEach(y => {
    html += `<button class="nav-btn" data-view="${y}" onclick="switchView('${y}')">${y}</button>`;
  });
  nav.innerHTML = html;

  const accountNav = document.getElementById('accountNavGroup');
  if (accountNav) {
    let accountHtml = '<div class="nav-label">ACCOUNT</div>';
    accountHtml += `<button class="nav-btn transcript" data-view="Transcript" onclick="switchView('Transcript')">Transcript generator</button>`;
    accountHtml += `<button class="nav-btn cumulative" data-view="Cumulative" onclick="switchView('Cumulative')">Cumulative sheet</button>`;
    accountHtml += `<button class="nav-btn profile" data-view="Profile" onclick="switchView('Profile')">Profile</button>`;
    accountHtml += `<button class="nav-btn settings" data-view="Settings" onclick="switchView('Settings')">Settings</button>`;
    accountNav.innerHTML = accountHtml;
  }
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.bottom-tab-bar .tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  render();
}

/* ===================== RENDER ROOT ===================== */
function render() {
  const container = document.getElementById('viewsContainer');
  if (state.currentView === 'Profile') {
    container.innerHTML = renderProfileView();
    return;
  }
  if (state.currentView === 'Settings') {
    container.innerHTML = renderSettingsView();
    attachSettingsHandlers();
    return;
  }
  if (state.currentView === 'Cumulative') {
    container.innerHTML = renderCumulativeView();
    attachCumulativeHandlers();
    return;
  }
  if (state.currentView === 'Transcript') {
    container.innerHTML = renderTranscriptView();
    attachTranscriptHandlers();
  } else {
    container.innerHTML = renderYearView(state.currentView);
  }
}

/* ===================== LOCAL STORAGE ===================== */
function saveToLocalStorage() {
  try {
    localStorage.setItem('futo-ph-results-state', JSON.stringify(state));
    showSaveIndicator();
  } catch (e) {
    console.error('Failed to save to localStorage:', e);
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('futo-ph-results-state');
    if (!raw) return false;
    const loaded = JSON.parse(raw);
    if (loaded && loaded.years) {
      state = loaded;
      return true;
    }
  } catch (e) {
    console.error('Failed to load from localStorage:', e);
  }
  return false;
}

function showSaveIndicator() {
  const status = document.querySelector('.sync-status');
  if (!status) return;
  status.innerHTML = '<span class="dot"></span>Saved to browser storage';
  clearTimeout(saveIndicatorTimer);
  saveIndicatorTimer = setTimeout(() => {
    updateSyncUI();
  }, 1500);
}

/* ===================== BATCH IMPORT ===================== */
const IMPORT_FIELDS = [
  { key: 'regNo', aliases: ['reg no', 'registration number', 'reg_number', 'regno', 'reg no.', 'registration no'] },
  { key: 'name', aliases: ['student name', 'name', 'full name', 'student_name', 'fullname'] },
  { key: 'code', aliases: ['course code', 'code', 'course_code', 'coursecode', 'course code'] },
  { key: 'title', aliases: ['course title', 'title', 'course_title', 'coursetitle', 'course title'] },
  { key: 'unit', aliases: ['credit unit', 'unit', 'credit_unit', 'creditunit', 'credits', 'cu'] },
  { key: 'score', aliases: ['score', 'mark', 'score/mark', 'marks'] }
];

function normalizeColumnName(name) {
  return String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function mapRowFields(rawRow) {
  const mapped = {};
  const sourceKeys = Object.keys(rawRow);
  sourceKeys.forEach(key => {
    const norm = normalizeColumnName(key);
    for (const field of IMPORT_FIELDS) {
      if (field.aliases.includes(norm)) {
        mapped[field.key] = rawRow[key];
        return;
      }
    }
    mapped[norm] = rawRow[key];
  });
  return mapped;
}

function parseImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.onload = async e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        let headerRowIndex = -1;
        let headers = [];

        for (let i = 0; i < raw.length; i++) {
          const row = raw[i];
          const normalizedCells = row.map(cell => normalizeColumnName(cell));
          const matchCount = normalizedCells.filter(cell => {
            return IMPORT_FIELDS.some(field => field.aliases.includes(cell));
          }).length;

          if (matchCount >= 2) {
            headerRowIndex = i;
            headers = row.map((cell, idx) => String(cell || `col_${idx}`).trim());
            break;
          }
        }

        if (headerRowIndex === -1) {
          return reject(new Error('Could not detect header row. Please ensure your file contains columns like Reg No, Student Name, Course Code, etc.'));
        }

        const dataRows = raw.slice(headerRowIndex + 1).filter(row => row.some(cell => cell !== '' && cell !== null && cell !== undefined));

        const json = dataRows.map(row => {
          const obj = {};
          headers.forEach((header, idx) => {
            obj[header] = row[idx] !== undefined ? row[idx] : '';
          });
          return obj;
        });

        resolve(json);
      } catch (err) {
        reject(new Error('Failed to parse spreadsheet. Ensure it is a valid .xlsx or .csv file.'));
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function validateImportRows(rawRows, yearKey, sem) {
  const errors = [];
  const valid = [];
  const seenPairs = new Set();

  rawRows.forEach((raw, idx) => {
    const row = mapRowFields(raw);
    const rowLabel = `Row ${idx + 1}`;
    const rowErrors = [];
    const reg = String(row.regNo || '').trim();
    const code = String(row.code || '').trim();
    const unitRaw = row.unit;
    const scoreRaw = row.score;

    if (!reg) rowErrors.push('Reg No is required.');
    if (!code) rowErrors.push('Course Code is required.');
    if (unitRaw === '' || unitRaw === null || unitRaw === undefined) {
      rowErrors.push('Credit Unit is required.');
    } else {
      const unitNum = parseFloat(unitRaw);
      if (isNaN(unitNum) || unitNum <= 0) rowErrors.push('Credit Unit must be a number greater than 0.');
    }
    if (scoreRaw === '' || scoreRaw === null || scoreRaw === undefined) {
      rowErrors.push('Score is required.');
    } else {
      const scoreNum = parseFloat(scoreRaw);
      if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) rowErrors.push('Score must be a number between 0 and 100.');
    }

    const pairKey = `${reg}|||${code}`;
    if (!rowErrors.length) {
      if (seenPairs.has(pairKey)) rowErrors.push('Duplicate Reg No + Course Code within the uploaded file.');
      seenPairs.add(pairKey);
    }

    if (rowErrors.length) {
      errors.push({ index: idx, row: row, errors: rowErrors });
    } else {
      valid.push({
        regNo: reg,
        name: String(row.name || '').trim(),
        code,
        title: String(row.title || '').trim(),
        unit: unitRaw === '' || unitRaw === null ? '' : String(unitRaw),
        score: scoreRaw === '' || scoreRaw === null ? '' : String(scoreRaw)
      });
    }
  });

  return { valid, errors, total: rawRows.length };
}

function renderImportPreview(parsed, yearKey, sem) {
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  overlay.innerHTML = `
    <div class="import-modal">
      <h3>Import preview — ${yearKey} · ${sem}</h3>
      <div class="import-summary">
        <div><span class="num">${parsed.total}</span><span class="lbl">Total rows found</span></div>
        <div><span class="num ok">${parsed.valid.length}</span><span class="lbl">Valid rows</span></div>
        <div><span class="num err">${parsed.errors.length}</span><span class="lbl">Rows with errors</span></div>
      </div>
      ${parsed.errors.length ? `
        <div class="import-errors">
          <strong>Errors</strong>
          <ul>
            ${parsed.errors.map(e => `<li><b>${e.index + 1}</b>: ${e.errors.join(' ')}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      <div class="import-table-wrap">
        <table>
          <thead>
            <tr><th>Reg No</th><th>Student Name</th><th>Code</th><th>Course Title</th><th>Unit</th><th>Score</th></tr>
          </thead>
          <tbody>
            ${parsed.valid.map(r => `<tr><td>${escHtml(r.regNo)}</td><td>${escHtml(r.name)}</td><td>${escHtml(r.code)}</td><td>${escHtml(r.title)}</td><td>${escHtml(r.unit)}</td><td>${escHtml(r.score)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="import-actions">
        <button class="btn gold" id="confirmImportBtn">Import ${parsed.valid.length} valid rows</button>
        <button class="btn secondary" id="cancelImportBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cancelImportBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('confirmImportBtn').addEventListener('click', async () => {
    overlay.remove();
    await commitImport(parsed.valid, yearKey, sem);
  });
}

async function commitImport(rows, yearKey, sem) {
  if (!rows.length) return;
  let updated = 0;
  let inserted = 0;
  rows.forEach(r => {
    const newRow = { ...emptyRow(), ...r };
    const existingIndex = state.years[yearKey][sem].findIndex(row =>
      (row.regNo || '').trim() === (newRow.regNo || '').trim() &&
      (row.code || '').trim() === (newRow.code || '').trim()
    );
    if (existingIndex >= 0) {
      state.years[yearKey][sem][existingIndex] = newRow;
      scheduleSave(yearKey, sem, existingIndex);
      updated++;
    } else {
      state.years[yearKey][sem].push(newRow);
      const idx = state.years[yearKey][sem].length - 1;
      scheduleSave(yearKey, sem, idx);
      inserted++;
    }
  });
  saveToLocalStorage();
  render();
  const parts = [];
  if (inserted) parts.push(`${inserted} inserted`);
  if (updated) parts.push(`${updated} updated`);
  alert(`${parts.join(', ')}.`);
}

async function handleImportFile(input, yearKey, sem) {
  const file = input.files && input.files[0];
  if (!file) return;

  try {
    const rawRows = await parseImportFile(file);
    if (!rawRows || !rawRows.length) {
      alert('The uploaded file appears to be empty.');
      input.value = '';
      return;
    }

    const mapped = rawRows.map(r => mapRowFields(r));
    const hasRequired = mapped.some(r => r.regNo || r.code || r.unit || r.score);
    if (!hasRequired) {
      alert('The uploaded file does not contain recognizable result columns. Please ensure headers like Reg No, Course Code, Credit Unit, and Score are present.');
      input.value = '';
      return;
    }

    const parsed = validateImportRows(mapped, yearKey, sem);
    if (!parsed.valid.length && parsed.errors.length) {
      alert(`No valid rows found. ${parsed.errors.length} row(s) have errors.`);
      input.value = '';
      return;
    }

    renderImportPreview(parsed, yearKey, sem);
  } catch (err) {
    alert(err.message || 'Failed to import file.');
  } finally {
    input.value = '';
  }
}

/* ===================== YEAR VIEW ===================== */
function renderYearView(yearKey) {
  let html = renderLetterhead(`${yearKey.toUpperCase()} — RESULT COMPUTATION`);
  html += `<div class="year-actions">
    <button class="btn gold" onclick="exportYearExcel('${yearKey}')">Export ${yearKey} to Excel</button>
  </div>`;
  SEMESTERS.forEach(sem => { html += renderSemesterBlock(yearKey, sem); });
  return html;
}

function renderSemesterBlock(yearKey, sem) {
  const rows = state.years[yearKey][sem];
  rows.sort((a, b) => {
    const nameA = (a.name || '').trim().toLowerCase();
    const nameB = (b.name || '').trim().toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });
  const summary = computeSummary(rows, yearKey, sem);

  let rowsHtml = '';
  if (rows.length === 0) {
    rowsHtml = `<tr class="empty-row"><td colspan="11">No students added yet — click "Add student row" to begin.</td></tr>`;
  } else {
    const distinctCodes = Array.from(new Set(rows.map(r => (r.code || '').trim()).filter(Boolean))).sort();
    const datalistId = `code-list-${yearKey}-${semSlug}`;
    rows.forEach((r, i) => {
      const gi = gradeInfo(r.score);
      const carryBadge = r.isCarryover ? ' <span class="carry-badge">C/O</span>' : '';
      rowsHtml += `
        <tr>
          <td>${i + 1}</td>
          <td><input value="${escAttr(r.regNo)}" placeholder="Reg No" oninput="updateCell('${yearKey}','${sem}',${i},'regNo',this.value)"></td>
          <td><input value="${escAttr(r.name)}" placeholder="Student name" oninput="updateCell('${yearKey}','${sem}',${i},'name',this.value)"></td>
          <td class="narrow"><input value="${escAttr(r.code)}" placeholder="Code" list="${datalistId}" oninput="updateCell('${yearKey}','${sem}',${i},'code',this.value)">${carryBadge}</td>
          <td><input value="${escAttr(r.title)}" placeholder="Course title" oninput="updateCell('${yearKey}','${sem}',${i},'title',this.value)"></td>
          <td class="narrow"><input type="number" value="${escAttr(r.unit)}" placeholder="Unit" oninput="updateCell('${yearKey}','${sem}',${i},'unit',this.value)"></td>
          <td class="narrow"><input type="number" value="${escAttr(r.score)}" placeholder="Score" oninput="updateScore('${yearKey}','${sem}',${i},this.value)"></td>
          <td class="grade-cell grade-${gi.grade}" id="grade-${yearKey}-${sem}-${i}">${gi.grade}</td>
          <td class="point-cell" id="point-${yearKey}-${sem}-${i}">${gi.point === null ? '' : gi.point}</td>
          <td class="narrow" style="text-align:center"><input type="checkbox" ${r.isCarryover ? 'checked' : ''} onchange="updateCarryover('${yearKey}','${sem}',${i},this.checked)" title="Carry-over retake"></td>
          <td><span id="score-warn-${yearKey}-${sem}-${i}" style="color:var(--red);font-size:11px"></span></td>
          <td><button class="icon-btn" title="Delete row" onclick="deleteRow('${yearKey}','${sem}',${i})">&#10005;</button></td>
        </tr>
      `;
    });
  }

  const semSlug = sem.replace(/\s+/g, '-');
  const safeSem = sem.replace(/[:\\\/\?\*\[\]]/g, '');
  const distinctCodes = Array.from(new Set(rows.map(r => (r.code || '').trim()).filter(Boolean))).sort();
  const datalistId = `code-list-${yearKey}-${semSlug}`;
  const datalistHtml = distinctCodes.length ? `<datalist id="${datalistId}">${distinctCodes.map(c => `<option value="${escHtml(c)}">`).join('')}</datalist>` : '';
  return `
    <div class="semester" id="semester-${yearKey}-${semSlug}">
      ${datalistHtml}
      <div class="semester-head">
        <h3>${sem}</h3>
        <div class="toolbar">
          <button class="btn secondary" onclick="addRow('${yearKey}','${sem}')">+ Add student row</button>
          <button class="btn secondary" onclick="document.getElementById('import-${yearKey}-${semSlug}').click()">Import from file</button>
          <input type="file" id="import-${yearKey}-${semSlug}" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleImportFile(this, '${yearKey}', '${sem}')">
          <button class="btn gold" onclick="exportSemesterExcel('${yearKey}','${sem}')">Export to Excel</button>
          <button class="btn secondary" onclick="printSemester('${yearKey}','${sem}')">Print / PDF</button>
        </div>
      </div>

      <div class="summary-grid" id="summary-${yearKey}-${semSlug}">
        ${summaryCardsHtml(summary)}
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:5%">S/N</th>
            <th style="width:12%">Reg No</th>
            <th style="width:20%">Student Name</th>
            <th style="width:9%">Code</th>
            <th style="width:20%">Course Title</th>
            <th style="width:7%">Unit</th>
            <th style="width:8%">Score</th>
            <th style="width:6%">Grade</th>
            <th style="width:6%">Point</th>
            <th style="width:4%">C/O</th>
            <th style="width:4%"></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function summaryCardsHtml(s) {
  return `
    <div class="summary-card"><div class="num">${s.totalStudents}</div><div class="lbl">Total number of students</div></div>
    <div class="summary-card"><div class="num">${s.complete}</div><div class="lbl">Complete passes (no carryover)</div></div>
    <div class="summary-card"><div class="num">${s.incomplete}</div><div class="lbl">Incomplete passes</div></div>
    <div class="summary-card"><div class="num">${s.highest === null ? '—' : s.highest.toFixed(2)}</div><div class="lbl">Highest GPA</div></div>
    <div class="summary-card"><div class="num">${s.lowest === null ? '—' : s.lowest.toFixed(2)}</div><div class="lbl">Lowest GPA</div></div>
  `;
}

/* group semester rows by Reg No -> compute per-student GPA & pass status */
function computeSummary(rows, yearKey, sem) {
  const configuredTotal = (state.creditLoad[yearKey] && state.creditLoad[yearKey][sem]) || null;
  const byReg = {};
  rows.forEach(r => {
    const reg = (r.regNo || '').trim();
    if (!reg) return;
    if (!byReg[reg]) byReg[reg] = [];
    byReg[reg].push(r);
  });
  const regs = Object.keys(byReg);
  let complete = 0, incomplete = 0;
  const gpas = [];
  regs.forEach(reg => {
    const stats = computeGpaStats(byReg[reg], configuredTotal);
    const hasF = stats.dedupedRows.some(r => gradeInfo(r.score).grade === 'F');
    const hasBlank = stats.dedupedRows.some(r => gradeInfo(r.score).grade === '');
    if (hasF) incomplete++; else complete++;
    if (stats.gpa !== null) gpas.push(stats.gpa);
  });
  return {
    totalStudents: regs.length,
    complete, incomplete,
    highest: gpas.length ? Math.max(...gpas) : null,
    lowest: gpas.length ? Math.min(...gpas) : null
  };
}

/* ===================== ROW EDITING ===================== */
function updateCell(yearKey, sem, idx, field, value) {
  state.years[yearKey][sem][idx][field] = value;
  saveToLocalStorage();
  scheduleSave(yearKey, sem, idx);
}

function updateScore(yearKey, sem, idx, value) {
  const num = parseFloat(value);
  const row = state.years[yearKey][sem][idx];
  if (value !== '' && (!isNaN(num) && num > 100)) {
    const warn = document.getElementById(`score-warn-${yearKey}-${sem}-${idx}`);
    if (warn) { warn.textContent = 'Score cannot exceed 100.'; warn.style.color = 'var(--red)'; }
    return;
  }
  const warn = document.getElementById(`score-warn-${yearKey}-${sem}-${idx}`);
  if (warn) { warn.textContent = ''; }
  row.score = value;
  const gi = gradeInfo(value);
  const gradeCell = document.getElementById(`grade-${yearKey}-${sem}-${idx}`);
  const pointCell = document.getElementById(`point-${yearKey}-${sem}-${idx}`);
  if (gradeCell) { gradeCell.textContent = gi.grade; gradeCell.className = 'grade-cell grade-' + gi.grade; }
  if (pointCell) { pointCell.textContent = gi.point === null ? '' : gi.point; }
  refreshSummary(yearKey, sem);
  saveToLocalStorage();
  scheduleSave(yearKey, sem, idx);
}

function updateCarryover(yearKey, sem, idx, checked) {
  state.years[yearKey][sem][idx].isCarryover = !!checked;
  saveToLocalStorage();
  scheduleSave(yearKey, sem, idx);
  render();
}

function addRow(yearKey, sem) {
  state.years[yearKey][sem].push(emptyRow());
  saveToLocalStorage();
  render();
}

function deleteRow(yearKey, sem, idx) {
  const row = state.years[yearKey][sem][idx];
  if (row.id) deleteRowRemote(row.id);
  state.years[yearKey][sem].splice(idx, 1);
  saveToLocalStorage();
  render();
}

/* ===================== API SYNC =====================
   Guest mode (no sign-in, or Supabase not configured yet): everything
   stays in localStorage — use Save/Load data (.json) to back it up.
   Signed-in users sync through the Express API. */

function scheduleSave(yearKey, sem, idx) {
  if (!currentUser || !accessToken) return;
  const row = state.years[yearKey][sem][idx];
  const key = row.id || `new-${yearKey}-${sem}-${idx}`;
  clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => saveRowRemote(yearKey, sem, idx), 600);
}

async function apiFetch(path, options = {}) {
  const url = API_BASE ? `${API_BASE}${path}` : path;

  if (!navigator.onLine && options.method && options.method !== 'GET') {
    const queue = getOfflineQueue();
    queue.push({ url, options, timestamp: Date.now() });
    setOfflineQueue(queue);
    updateSyncUI();
    return;
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function getOfflineQueue() {
  try {
    const data = localStorage.getItem('advyza_offline_queue');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function setOfflineQueue(queue) {
  localStorage.setItem('advyza_offline_queue', JSON.stringify(queue));
}

async function replayOfflineQueue() {
  const queue = getOfflineQueue();
  if (!queue.length) return;

  const remaining = [];
  for (const item of queue) {
    try {
      await fetch(item.url, item.options);
    } catch {
      remaining.push(item);
    }
  }

  setOfflineQueue(remaining);
  if (remaining.length === 0) {
    updateSyncUI();
    if (currentUser && accessToken) {
      await loadFromApi();
      render();
    }
  }
}

async function saveRowRemote(yearKey, sem, idx) {
  if (!currentUser || !accessToken) return;
  const row = state.years[yearKey][sem][idx];
  if (!row) return;
  if (!row.regNo && !row.name && !row.code && !row.title && !row.unit && !row.score) return;

  const payload = {
    year: yearKey,
    semester: sem,
    reg_no: row.regNo || null,
    student_name: row.name || null,
    course_code: row.code || null,
    course_title: row.title || null,
    credit_unit: row.unit === '' ? null : parseFloat(row.unit),
    score: row.score === '' ? null : parseFloat(row.score),
    is_carryover: !!row.isCarryover
  };

  try {
    if (row.id) {
      const data = await apiFetch(`/api/results/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      Object.assign(row, data);
    } else {
      const data = await apiFetch('/api/results', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      row.id = data.id;
    }
  } catch (err) {
    console.error('Save failed:', err.message);
  }
}

async function deleteRowRemote(id) {
  if (!currentUser || !accessToken) return;
  try {
    await apiFetch(`/api/results/${id}`, { method: 'DELETE' });
  } catch (err) {
    console.error('Delete failed:', err.message);
  }
}

async function loadFromApi() {
  if (!currentUser || !accessToken) return;
  try {
    const data = await apiFetch('/api/results');
    YEAR_KEYS.forEach(y => { state.years[y] = {}; SEMESTERS.forEach(s => { state.years[y][s] = []; }); });

    (data || []).forEach(row => {
      if (!state.years[row.year] || !state.years[row.year][row.semester]) return;
      state.years[row.year][row.semester].push({
        id: row.id,
        regNo: row.reg_no || '',
        name: row.student_name || '',
        code: row.course_code || '',
        title: row.course_title || '',
        unit: row.credit_unit ?? '',
        score: row.score ?? '',
        isCarryover: !!row.is_carryover
      });
    });

    YEAR_KEYS.forEach(y => SEMESTERS.forEach(s => {
      if (state.years[y][s].length === 0) state.years[y][s].push(emptyRow());
    }));
  } catch (err) {
    console.error('Load failed:', err.message);
  }
}

function updateSyncUI() {
  const chip = document.getElementById('userChip');
  const status = document.querySelector('.sync-status');
  const displayName = (currentUser?.user_metadata?.full_name || currentUser?.email || '').trim();
  if (chip) chip.textContent = displayName || 'Not signed in';
  if (status) {
    if (currentUser) {
      status.innerHTML = '<span class="dot"></span>Signed in — synced via API';
    } else {
      status.innerHTML = '<span class="dot"></span>Working locally — saved to browser storage';
    }
  }
}

async function initApp() {
  buildNav();
  if (supabaseClient) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      currentUser = session.user;
      accessToken = session.access_token;
      await loadFromApi();
      await loadSettings();
    } else {
      loadFromLocalStorage();
    }
  } else {
    loadFromLocalStorage();
  }
  updateSyncUI();
  switchView('Year 1');

  window.addEventListener('online', () => {
    updateSyncUI();
    replayOfflineQueue();
  });
  window.addEventListener('offline', updateSyncUI);
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

function refreshSummary(yearKey, sem) {
  const semSlug = sem.replace(/\s+/g, '-');
  const el = document.getElementById(`summary-${yearKey}-${semSlug}`);
  if (el) el.innerHTML = summaryCardsHtml(computeSummary(state.years[yearKey][sem], yearKey, sem));
}

/* ===================== TRANSCRIPT VIEW ===================== */
function renderTranscriptView() {
  return renderLetterhead('STUDENT TRANSCRIPT GENERATOR') + `
    <div class="transcript-search">
      <div class="field">
        <label>Registration Number</label>
        <input id="transcriptRegNo" placeholder="e.g. PH/2025/001">
      </div>
      <button class="btn" id="generateBtn" onclick="generateTranscript()">Generate transcript</button>
      <button class="btn gold" id="printBtn" onclick="window.print()" style="display:none">Print</button>
      <button class="btn secondary" id="excelBtn" onclick="exportTranscriptExcel()" style="display:none">Export to Excel</button>
    </div>

    <div class="transcript-doc" id="transcriptOutput">
      <p class="no-record">Enter a registration number above and click "Generate transcript" to compile a student's full academic record across Year 1 to Year 10.</p>
    </div>
  `;
}

function attachTranscriptHandlers() {
  const input = document.getElementById('transcriptRegNo');
  if (input) {
    input.addEventListener('keydown', e => { if (e.key === 'Enter') generateTranscript(); });
  }
}

function attachSettingsHandlers() {
  const saveBtn = document.getElementById('saveSettingsBtn');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);

  const passcodeBtn = document.getElementById('savePasscodeBtn');
  if (passcodeBtn) passcodeBtn.addEventListener('click', savePasscode);

  const copyBtn = document.getElementById('copyLinkBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const input = document.getElementById('checkLink');
      if (input) {
        input.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied';
        setTimeout(() => copyBtn.textContent = 'Copy link', 1500);
      }
    });
  }

  const creditInputs = document.querySelectorAll('.credit-load-inputs input');
  const creditTimers = {};
  creditInputs.forEach(input => {
    input.addEventListener('input', () => {
      const year = input.dataset.year;
      const sem = input.dataset.sem;
      const statusEl = document.querySelector(`.credit-load-status[data-year="${year}"]`);
      if (statusEl) {
        statusEl.textContent = 'Saving…';
        statusEl.style.color = 'var(--muted)';
      }
      clearTimeout(creditTimers[`${year}-${sem}`]);
      creditTimers[`${year}-${sem}`] = setTimeout(async () => {
        const value = input.value.trim();
        if (!value) {
          if (statusEl) { statusEl.textContent = ''; }
          return;
        }
        const numeric = parseFloat(value);
        if (isNaN(numeric) || numeric <= 0) {
          if (statusEl) { statusEl.textContent = 'Must be > 0'; statusEl.style.color = 'var(--red)'; }
          return;
        }
        try {
          await apiFetch('/api/credit-load', {
            method: 'PUT',
            body: JSON.stringify({ year, semester: sem, total_units: numeric })
          });
          if (!state.creditLoad[year]) state.creditLoad[year] = {};
          state.creditLoad[year][sem] = numeric;
          if (statusEl) { statusEl.textContent = 'Saved'; statusEl.style.color = 'var(--ok)'; }
          setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 1500);
        } catch (err) {
          if (statusEl) { statusEl.textContent = err.message || 'Failed'; statusEl.style.color = 'var(--red)'; }
        }
      }, 600);
    });
  });

  document.querySelectorAll('.password-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.innerHTML = isPassword
        ? '<svg viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
    });
  });
}

let lastTranscript = null;

function generateTranscript() {
  const regNo = document.getElementById('transcriptRegNo').value.trim();
  const output = document.getElementById('transcriptOutput');
  if (!regNo) { output.innerHTML = '<p class="no-record">Please enter a registration number.</p>'; return; }

  let studentName = '';
  let cumConfiguredTotal = 0;
  let yearBlocksHtml = '';
  let foundAny = false;
  const flatRows = [];
  const allStudentRows = [];

  YEAR_KEYS.forEach(yearKey => {
    let yearHasData = false;
    let semHtml = '';
    SEMESTERS.forEach(sem => {
      const rows = state.years[yearKey][sem].filter(r => (r.regNo || '').trim() === regNo);
      if (rows.length === 0) return;
      yearHasData = true; foundAny = true;
      allStudentRows.push(...rows);

      const configuredTotal = (state.creditLoad[yearKey] && state.creditLoad[yearKey][sem]) || null;
      if (configuredTotal) cumConfiguredTotal += configuredTotal;

      const stats = computeGpaStats(rows, configuredTotal);
      let tableRows = '';
      rows.forEach(r => {
        if (!studentName && r.name) studentName = r.name;
        const gi = gradeInfo(r.score);
        tableRows += `<tr><td>${escHtml(r.code)}</td><td>${escHtml(r.title)}</td><td style="text-align:center">${escHtml(r.unit)}</td>
          <td style="text-align:center">${escHtml(r.score)}</td><td style="text-align:center;font-weight:600">${gi.grade}</td>
          <td style="text-align:center">${gi.point === null ? '' : gi.point}</td></tr>`;
        flatRows.push({ Year: yearKey, Semester: sem, RegNo: regNo, Name: r.name, Code: r.code, Title: r.title, Unit: r.unit, Score: r.score, Grade: gi.grade, Point: gi.point });
      });

      const semGpaText = stats.gpa !== null ? stats.gpa.toFixed(2) : '—';
      let semTotalsHtml = `<span>Units: <b>${stats.unitsEntered}</b></span><span>Semester GPA: <b>${semGpaText}</b></span>`;
      if (stats.unitsConfigured !== null) {
        semTotalsHtml += `<span>Completion: <b>${stats.unitsEntered} of ${stats.unitsConfigured} units (${stats.percentComplete}%)</b></span>`;
      }
      semHtml += `
        <div class="t-sem-label">${sem}</div>
        <table><thead><tr><th>Code</th><th>Course Title</th><th>Unit</th><th>Score</th><th>Grade</th><th>Point</th></tr></thead>
        <tbody>${tableRows}</tbody></table>
        <div class="t-totals">${semTotalsHtml}</div>
      `;
    });
    if (yearHasData) {
      yearBlocksHtml += `<div class="t-year-block"><h4>${yearKey}</h4>${semHtml}</div>`;
    }
  });

  if (!foundAny) {
    output.innerHTML = `<p class="no-record">No results found for Reg No "${escHtml(regNo)}". Check the entries in the year sheets.</p>`;
    document.getElementById('printBtn').style.display = 'none';
    document.getElementById('excelBtn').style.display = 'none';
    lastTranscript = null;
    return;
  }

  const cumStats = computeGpaStats(allStudentRows, cumConfiguredTotal || null);
  const cgpaText = cumStats.gpa !== null ? cumStats.gpa.toFixed(2) : '—';
  let cgpaHtml = `<div class="cgpa-banner"><div>Cumulative Grade Point Average (CGPA)</div><div class="big">${cgpaText}</div></div>`;
  if (cumStats.unitsConfigured !== null) {
    cgpaHtml = `<div class="cgpa-banner"><div>Cumulative Grade Point Average (CGPA)</div><div class="big">${cgpaText}</div><div class="completion">${cumStats.unitsEntered} of ${cumStats.unitsConfigured} units (${cumStats.percentComplete}%)</div></div>`;
  }

  output.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px;">
      <div><div class="hint">Registration Number</div><div style="font-size:15px;font-weight:600">${escHtml(regNo)}</div></div>
      <div><div class="hint">Student Name</div><div style="font-size:15px;font-weight:600">${escHtml(studentName) || '—'}</div></div>
    </div>
    ${yearBlocksHtml}
    ${cgpaHtml}
  `;
  document.getElementById('printBtn').style.display = 'inline-block';
  document.getElementById('excelBtn').style.display = 'inline-block';
  lastTranscript = { regNo, studentName, cgpa: cgpaText, flatRows };
}

/* ===================== CUMULATIVE RESULT SHEET ===================== */
let cumState = { yearKey: 'Year 1', sem: 'Harmattan Semester' };

function renderCumulativeView() {
  const yearKey = cumState.yearKey;
  const sem = cumState.sem;
  const rows = state.years[yearKey][sem] || [];
  const sorted = rows.slice().sort((a, b) => (a.name || '').trim().toLowerCase() < (b.name || '').trim().toLowerCase() ? -1 : 1);

  const codes = Array.from(new Set(rows.map(r => (r.code || '').trim()).filter(Boolean))).sort();
  const byReg = {};
  sorted.forEach(r => {
    const reg = (r.regNo || '').trim();
    if (!reg) return;
    if (!byReg[reg]) byReg[reg] = { name: r.name || '', regNo: reg, scores: {} };
    byReg[reg].scores[r.code] = r;
  });
  const students = Object.keys(byReg).map(reg => byReg[reg]).sort((a, b) => (a.name || '').trim().toLowerCase() < (b.name || '').trim().toLowerCase() ? -1 : 1);

  let tableRows = '';
  students.forEach((stu, idx) => {
    const fCount = rows.filter(r => (r.regNo || '').trim() === stu.regNo && gradeInfo(r.score).grade === 'F').length;
    const remark = fCount === 0 ? 'Pass' : `${fCount}F`;
    let cells = `<td>${idx + 1}</td><td>${escHtml(stu.name)}</td><td>${escHtml(stu.regNo)}</td>`;
    codes.forEach(code => {
      const r = stu.scores[code];
      if (r) {
        const gi = gradeInfo(r.score);
        cells += `<td style="text-align:center">${escHtml(r.score)} (${gi.grade})</td>`;
      } else {
        cells += `<td style="text-align:center;color:var(--muted)">—</td>`;
      }
    });
    cells += `<td><b>${remark}</b></td>`;
    tableRows += `<tr>${cells}</tr>`;
  });

  const yearOptions = YEAR_KEYS.map(y => `<option value="${y}" ${y === yearKey ? 'selected' : ''}>${y}</option>`).join('');
  const semOptions = SEMESTERS.map(s => `<option value="${s}" ${s === sem ? 'selected' : ''}>${s}</option>`).join('');

  return renderLetterhead('CUMULATIVE RESULT SHEET') + `
    <div class="cum-toolbar">
      <div class="cum-toggle">
        <select id="cumYear">${yearOptions}</select>
        <select id="cumSem">${semOptions}</select>
      </div>
      <div class="cum-actions">
        <button class="btn secondary" onclick="printCumulative()">Print / PDF</button>
        <button class="btn gold" onclick="exportCumulativeExcel()">Export to Excel</button>
      </div>
    </div>

    <div class="cum-table-wrap">
      <table>
        <thead>
          <tr>
            <th style="width:5%">S/N</th>
            <th style="width:20%">Name</th>
            <th style="width:15%">Reg No</th>
            ${codes.map(c => `<th style="width:${Math.max(6, Math.min(12, 100 / codes.length))}%">${escHtml(c)}</th>`).join('')}
            <th style="width:6%">Remarks</th>
          </tr>
        </thead>
        <tbody>${tableRows || '<tr><td colspan="4">No students added yet.</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

function attachCumulativeHandlers() {
  const yearSel = document.getElementById('cumYear');
  const semSel = document.getElementById('cumSem');
  if (yearSel) {
    yearSel.addEventListener('change', () => { cumState.yearKey = yearSel.value; render(); });
  }
  if (semSel) {
    semSel.addEventListener('change', () => { cumState.sem = semSel.value; render(); });
  }
}

function printCumulative() {
  const target = document.getElementById('viewsContainer');
  if (!target) return;
  const allViews = document.querySelectorAll('.semester, .transcript-doc, .settings-card, .profile-card, .cum-table-wrap');
  allViews.forEach(el => el.style.display = 'none');
  const cumWrap = target.querySelector('.cum-table-wrap');
  if (cumWrap) cumWrap.style.display = 'block';
  const restore = () => {
    allViews.forEach(el => el.style.display = '');
  };
  window.onafterprint = restore;
  setTimeout(() => window.print(), 300);
}

async function exportCumulativeExcel() {
  const yearKey = cumState.yearKey;
  const sem = cumState.sem;
  const rows = state.years[yearKey][sem] || [];
  const sorted = rows.slice().sort((a, b) => (a.name || '').trim().toLowerCase() < (b.name || '').trim().toLowerCase() ? -1 : 1);
  const codes = Array.from(new Set(rows.map(r => (r.code || '').trim()).filter(Boolean))).sort();
  const byReg = {};
  sorted.forEach(r => {
    const reg = (r.regNo || '').trim();
    if (!reg) return;
    if (!byReg[reg]) byReg[reg] = { name: r.name || '', regNo: reg, scores: {} };
    byReg[reg].scores[r.code] = r;
  });
  const students = Object.keys(byReg).map(reg => byReg[reg]).sort((a, b) => (a.name || '').trim().toLowerCase() < (b.name || '').trim().toLowerCase() ? -1 : 1);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sem.replace(/[:\\\/\?\*\[\]]/g, ''));

  sheet.mergeCells('A1:Z1');
  sheet.getCell('A1').value = META.university;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:Z2');
  sheet.getCell('A2').value = state.meta.school;
  sheet.getCell('A2').font = { bold: true, size: 12 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  sheet.mergeCells('A3:Z3');
  sheet.getCell('A3').value = state.meta.department;
  sheet.getCell('A3').font = { bold: true, size: 12 };
  sheet.getCell('A3').alignment = { horizontal: 'center' };

  sheet.mergeCells('A4:Z4');
  sheet.getCell('A4').value = `${yearKey} — ${sem}`;
  sheet.getCell('A4').font = { bold: true, size: 12 };
  sheet.getCell('A4').alignment = { horizontal: 'center' };

  const logoBuffer = await getLogoBuffer();
  if (logoBuffer) {
    try {
      const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'jpg' });
      sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: 48, height: 48 } });
      const rightCol = codes.length + 4;
      sheet.addImage(imageId, { tl: { col: Math.max(rightCol - 0.5, 7.5), row: 0.1 }, ext: { width: 48, height: 48 } });
    } catch (e) {
      console.error('Failed to embed logo in Excel:', e);
    }
  }

  const headerRow = sheet.getRow(6);
  ['S/N', 'Name', 'Reg No', ...codes].forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFF3F1E9' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };
  });
  headerRow.getCell(codes.length + 4).value = 'Remarks';
  headerRow.getCell(codes.length + 4).font = { bold: true, color: { argb: 'FFF3F1E9' } };
  headerRow.getCell(codes.length + 4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };

  students.forEach((stu, idx) => {
    const excelRow = sheet.getRow(7 + idx);
    const fCount = rows.filter(r => (r.regNo || '').trim() === stu.regNo && gradeInfo(r.score).grade === 'F').length;
    const remark = fCount === 0 ? 'Pass' : `${fCount}F`;
    excelRow.getCell(1).value = idx + 1;
    excelRow.getCell(2).value = stu.name;
    excelRow.getCell(3).value = stu.regNo;
    codes.forEach((code, ci) => {
      const r = stu.scores[code];
      const cell = excelRow.getCell(4 + ci);
      if (r) {
        const gi = gradeInfo(r.score);
        cell.value = `${r.score} (${gi.grade})`;
      } else {
        cell.value = '—';
      }
    });
    excelRow.getCell(4 + codes.length).value = remark;
  });

  sheet.columns.forEach(col => { col.width = 18; });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cumulative - ${yearKey} - ${sem}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===================== EXCEL EXPORT ===================== */
async function getLogoBuffer() {
  try {
    const response = await fetch('assets/futo-logo.jpeg');
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  } catch (e) {
    console.error('Failed to load logo for Excel export:', e);
    return null;
  }
}

async function exportSemesterExcel(yearKey, sem) {
  const rows = state.years[yearKey][sem];
  const data = rows.map((r, idx) => {
    const gi = gradeInfo(r.score);
    return { 'S/N': idx + 1, 'Reg No': r.regNo, 'Student Name': r.name, 'Course Code': r.code, 'Course Title': r.title,
      'Credit Unit': r.unit, 'Score': r.score, 'Grade': gi.grade, 'Grade Point': gi.point };
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sem.replace(/[:\\\/\?\*\[\]]/g, ''));

  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = META.university;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value = state.meta.school;
  sheet.getCell('A2').font = { bold: true, size: 12 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  sheet.mergeCells('A3:J3');
  sheet.getCell('A3').value = state.meta.department;
  sheet.getCell('A3').font = { bold: true, size: 12 };
  sheet.getCell('A3').alignment = { horizontal: 'center' };

  const logoBuffer = await getLogoBuffer();
  if (logoBuffer) {
    try {
      const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'jpg' });
      sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: 48, height: 48 } });
      sheet.addImage(imageId, { tl: { col: 9.5, row: 0.1 }, ext: { width: 48, height: 48 } });
    } catch (e) {
      console.error('Failed to embed logo in Excel:', e);
    }
  }

  const headerRow = sheet.getRow(5);
  ['S/N', 'Reg No', 'Student Name', 'Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point'].forEach((headerText, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = headerText;
    cell.font = { bold: true, color: { argb: 'FFF3F1E9' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };
  });

  data.forEach((row, idx) => {
    const excelRow = sheet.getRow(6 + idx);
    Object.values(row).forEach((val, colIdx) => {
      excelRow.getCell(colIdx + 1).value = val;
    });
  });

  sheet.columns.forEach(col => {
    col.width = 18;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${yearKey} - ${sem}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportYearExcel(yearKey) {
  const workbook = new ExcelJS.Workbook();
  const logoBuffer = await getLogoBuffer();

  SEMESTERS.forEach(sem => {
    const rows = state.years[yearKey][sem];
    const data = rows.map((r, idx) => {
      const gi = gradeInfo(r.score);
      return { 'S/N': idx + 1, 'Reg No': r.regNo, 'Student Name': r.name, 'Course Code': r.code, 'Course Title': r.title,
        'Credit Unit': r.unit, 'Score': r.score, 'Grade': gi.grade, 'Grade Point': gi.point };
    });

    const safeSem = sem.replace(/[:\\\/\?\*\[\]]/g, '');
    const sheet = workbook.addWorksheet(safeSem);

    sheet.mergeCells('A1:J1');
    sheet.getCell('A1').value = META.university;
    sheet.getCell('A1').font = { bold: true, size: 14 };
    sheet.getCell('A1').alignment = { horizontal: 'center' };

    sheet.mergeCells('A2:J2');
    sheet.getCell('A2').value = state.meta.school;
    sheet.getCell('A2').font = { bold: true, size: 12 };
    sheet.getCell('A2').alignment = { horizontal: 'center' };

    sheet.mergeCells('A3:J3');
    sheet.getCell('A3').value = state.meta.department;
    sheet.getCell('A3').font = { bold: true, size: 12 };
    sheet.getCell('A3').alignment = { horizontal: 'center' };

    sheet.mergeCells('A4:J4');
    sheet.getCell('A4').value = sem;
    sheet.getCell('A4').font = { bold: true, size: 12 };
    sheet.getCell('A4').alignment = { horizontal: 'center' };

    if (logoBuffer) {
      try {
        const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'jpg' });
        sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: 48, height: 48 } });
        sheet.addImage(imageId, { tl: { col: 9.5, row: 0.1 }, ext: { width: 48, height: 48 } });
      } catch (e) {
        console.error('Failed to embed logo in Excel:', e);
      }
    }

    const headerRow = sheet.getRow(6);
    ['S/N', 'Reg No', 'Student Name', 'Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point'].forEach((headerText, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = headerText;
      cell.font = { bold: true, color: { argb: 'FFF3F1E9' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };
    });

    data.forEach((row, idx) => {
      const excelRow = sheet.getRow(7 + idx);
      Object.values(row).forEach((val, colIdx) => {
        excelRow.getCell(colIdx + 1).value = val;
      });
    });

    sheet.columns.forEach(col => {
      col.width = 18;
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${yearKey} - All Semesters.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportTranscriptExcel() {
  if (!lastTranscript) return;
  const data = lastTranscript.flatRows.map(r => ({ 'Year': r.Year, 'Semester': r.Semester, 'Reg No': r.RegNo, 'Name': r.Name, 'Code': r.Code, 'Title': r.Title, 'Unit': r.Unit, 'Score': r.Score, 'Grade': r.Grade, 'Point': r.Point }));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transcript');

  sheet.mergeCells('A1:J1');
  sheet.getCell('A1').value = META.university;
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:J2');
  sheet.getCell('A2').value = state.meta.school;
  sheet.getCell('A2').font = { bold: true, size: 12 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  sheet.mergeCells('A3:J3');
  sheet.getCell('A3').value = state.meta.department;
  sheet.getCell('A3').font = { bold: true, size: 12 };
  sheet.getCell('A3').alignment = { horizontal: 'center' };

  const logoBuffer = await getLogoBuffer();
  if (logoBuffer) {
    try {
      const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'jpg' });
      sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: 48, height: 48 } });
      sheet.addImage(imageId, { tl: { col: 10.5, row: 0.1 }, ext: { width: 48, height: 48 } });
    } catch (e) {
      console.error('Failed to embed logo in Excel:', e);
    }
  }

  const headers = ['Year', 'Semester', 'Reg No', 'Name', 'Code', 'Title', 'Unit', 'Score', 'Grade', 'Point'];
  const headerRow = sheet.getRow(5);
  headers.forEach((header, idx) => {
    headerRow.getCell(idx + 1).value = header;
    headerRow.getCell(idx + 1).font = { bold: true, color: { argb: 'FFF3F1E9' } };
    headerRow.getCell(idx + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };
  });

  data.forEach((row, idx) => {
    const excelRow = sheet.getRow(6 + idx);
    Object.values(row).forEach((val, colIdx) => {
      excelRow.getCell(colIdx + 1).value = val;
    });
  });

  sheet.columns.forEach(col => {
    col.width = 18;
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Transcript - ${lastTranscript.regNo}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===================== PRINT SEMESTER ===================== */
function printSemester(yearKey, sem) {
  const semSlug = sem.replace(/\s+/g, '-');
  const target = document.getElementById(`semester-${yearKey}-${semSlug}`);
  if (!target) return;

  const allSemesters = document.querySelectorAll('.semester');
  allSemesters.forEach(el => el.style.display = 'none');
  target.style.display = 'block';
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const restore = () => {
    allSemesters.forEach(el => el.style.display = '');
  };

  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('print');
    if (mediaQuery.addListener) {
      mediaQuery.addListener(restore);
    }
  }
  window.onafterprint = restore;
  setTimeout(() => window.print(), 300);
}

/* ===================== JSON SAVE / LOAD (persistence) ===================== */
function exportAllJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'futo-public-health-results.json';
  a.click();
  URL.revokeObjectURL(url);
}

function importAllJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const loaded = JSON.parse(e.target.result);
      if (loaded && loaded.years) {
        state = loaded;
        saveToLocalStorage();
        render();
        alert('Data loaded successfully.');
      } else {
        alert('This file does not look like a valid export from this app.');
      }
    } catch (err) {
      alert('Could not read that file: ' + err.message);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

async function loadSettings() {
  if (!currentUser || !accessToken) return;
  try {
    const data = await apiFetch('/api/settings');
    if (data) {
      state.meta.school = data.faculty || state.meta.school;
      state.meta.department = data.department || state.meta.department;
      state.meta.portalSlug = data.portal_slug || state.meta.portalSlug;
      state.meta.passcodeSet = !!data.passcode_set;
    }
  } catch (err) {
    console.error('Failed to load settings:', err.message);
  }

  try {
    const creditData = await apiFetch('/api/credit-load');
    state.creditLoad = {};
    (creditData || []).forEach(row => {
      if (!state.creditLoad[row.year]) state.creditLoad[row.year] = {};
      state.creditLoad[row.year][row.semester] = row.total_units;
    });
  } catch (err) {
    console.error('Failed to load credit load settings:', err.message);
  }
}

/* ===================== SETTINGS VIEW ===================== */
function renderSettingsView() {
  const slug = state.meta.portalSlug || '';
  const checkUrl = slug ? `${window.location.origin}/students-results/${encodeURIComponent(slug)}` : '';
  return renderLetterhead('SETTINGS') + `
    <div class="settings-card">
      <h3>Portal settings</h3>
      <div class="settings-form">
        <div class="meta-field">
          <label for="settingFaculty">Faculty / School</label>
          <input id="settingFaculty" value="${escAttr(state.meta.school)}">
        </div>
        <div class="meta-field">
          <label for="settingDepartment">Department</label>
          <input id="settingDepartment" value="${escAttr(state.meta.department)}">
        </div>
        <div class="meta-field">
          <label for="settingSlug">Portal slug</label>
          <input id="settingSlug" value="${escAttr(slug)}" placeholder="e.g. mrs-adeyemi-ph">
          <small>This becomes the public link students use to check results.</small>
        </div>
        <button class="btn gold" id="saveSettingsBtn">Save settings</button>
        <span id="settingsStatus" class="settings-status"></span>
      </div>

      ${checkUrl ? `
        <div class="settings-link">
          <label>Student check link</label>
          <div class="link-row">
            <input id="checkLink" value="${escHtml(checkUrl)}" readonly>
            <button class="btn secondary" id="copyLinkBtn">Copy link</button>
          </div>
        </div>
      ` : ''}

      <div class="settings-divider"></div>

      <h3>Credit load</h3>
      <p class="settings-note">Set the expected total credit units per year and semester. This is used to show completion progress alongside GPA.</p>
      <div class="settings-form">
        <div class="credit-load-grid">
          ${YEAR_KEYS.map(yearKey => {
            const harm = state.creditLoad[yearKey]?.['Harmattan Semester'] || '';
            const rain = state.creditLoad[yearKey]?.['Rain Semester'] || '';
            return `
              <div class="credit-load-row">
                <label>${yearKey}</label>
                <div class="credit-load-inputs">
                  <input type="number" min="1" step="1" placeholder="Harmattan" data-year="${yearKey}" data-sem="Harmattan Semester" value="${escAttr(harm)}">
                  <input type="number" min="1" step="1" placeholder="Rain" data-year="${yearKey}" data-sem="Rain Semester" value="${escAttr(rain)}">
                </div>
                <span class="credit-load-status" data-year="${yearKey}"></span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <h3>Student passcode</h3>
      <p class="settings-note">Changing the passcode immediately invalidates the old one for all students.</p>
      <div class="settings-form">
        <div class="meta-field">
          <label for="newPasscode">New passcode</label>
          <div class="password-wrap">
            <input type="password" id="newPasscode" placeholder="Minimum 6 characters">
            <button type="button" class="password-toggle" aria-label="Toggle passcode visibility">
              <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
          </div>
        </div>
        <div class="meta-field">
          <label for="confirmPasscode">Confirm passcode</label>
          <div class="password-wrap">
            <input type="password" id="confirmPasscode" placeholder="Repeat passcode">
            <button type="button" class="password-toggle" aria-label="Toggle passcode visibility">
              <svg viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
            </button>
          </div>
        </div>
        <button class="btn gold" id="savePasscodeBtn">Update passcode</button>
        <span id="passcodeStatus" class="settings-status"></span>
      </div>
    </div>
  `;
}

async function saveSettings() {
  const faculty = document.getElementById('settingFaculty').value.trim();
  const department = document.getElementById('settingDepartment').value.trim();
  const portalSlug = document.getElementById('settingSlug').value.trim();
  const statusEl = document.getElementById('settingsStatus');

  if (!faculty || !department || !portalSlug) {
    statusEl.textContent = 'All fields are required.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  statusEl.textContent = 'Saving…';
  statusEl.style.color = 'var(--muted)';

  try {
    const data = await apiFetch('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({ faculty, department, portal_slug: portalSlug })
    });
    state.meta.school = data.faculty;
    state.meta.department = data.department;
    state.meta.portalSlug = data.portal_slug;
    statusEl.textContent = 'Saved.';
    statusEl.style.color = 'var(--ok)';
    render();
  } catch (err) {
    statusEl.textContent = err.message || 'Failed to save settings.';
    statusEl.style.color = 'var(--red)';
  }
}

async function savePasscode() {
  const passcode = document.getElementById('newPasscode').value;
  const confirm = document.getElementById('confirmPasscode').value;
  const statusEl = document.getElementById('passcodeStatus');

  if (!passcode || passcode.length < 6) {
    statusEl.textContent = 'Passcode must be at least 6 characters.';
    statusEl.style.color = 'var(--red)';
    return;
  }
  if (passcode !== confirm) {
    statusEl.textContent = 'Passcodes do not match.';
    statusEl.style.color = 'var(--red)';
    return;
  }

  statusEl.textContent = 'Updating…';
  statusEl.style.color = 'var(--muted)';

  try {
    await apiFetch('/api/settings/passcode', {
      method: 'PUT',
      body: JSON.stringify({ passcode })
    });
    state.meta.passcodeSet = true;
    statusEl.textContent = 'Passcode updated.';
    statusEl.style.color = 'var(--ok)';
    document.getElementById('newPasscode').value = '';
    document.getElementById('confirmPasscode').value = '';
  } catch (err) {
    statusEl.textContent = err.message || 'Failed to update passcode.';
    statusEl.style.color = 'var(--red)';
  }
}

/* ===================== PROFILE VIEW ===================== */
function renderProfileView() {
  const fullName = (currentUser?.user_metadata?.full_name || '').trim();
  const email = currentUser?.email || 'Not available';
  return renderLetterhead('PROFILE') + `
    <div class="profile-card">
      <div class="profile-row">
        <div class="profile-label">Full name</div>
        <div class="profile-value">${escHtml(fullName) || 'Not set'}</div>
      </div>
      <div class="profile-row">
        <div class="profile-label">Email</div>
        <div class="profile-value">${escHtml(email)}</div>
      </div>
    </div>

    <div class="profile-actions">
      <button class="btn secondary" onclick="signOut()">Log out</button>
      <button class="btn danger" onclick="deleteAccount()">Delete my account and data</button>
    </div>
  `;
}

async function deleteAccount() {
  if (!currentUser || !accessToken) return;
  const confirmed = confirm('This will permanently delete your account and all associated result data. Continue?');
  if (!confirmed) return;

  try {
    await apiFetch('/api/account/delete', { method: 'POST' });
    alert('Your account and data have been deleted.');
    if (supabaseClient) await supabaseClient.auth.signOut();
    window.location.href = 'index.html';
  } catch (err) {
    alert('Account deletion failed: ' + err.message);
  }
}

/* ===================== UTIL ===================== */
function escAttr(v) { return (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;'); }
function escHtml(v) { return (v === undefined || v === null) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ===================== INIT ===================== */
initApp();
