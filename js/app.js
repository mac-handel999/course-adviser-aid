/* =========================================================================
   FUTO Public Health Results Portal — app logic

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
const emptyRow = () => ({ id: null, regNo: '', name: '', code: '', title: '', unit: '', score: '' });

let state = { years: {}, currentView: 'Year 1', meta: { school: 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)', department: 'DEPARTMENT OF PUBLIC HEALTH' } };
YEAR_KEYS.forEach(y => {
  state.years[y] = {};
  SEMESTERS.forEach(s => { state.years[y][s] = [emptyRow()]; });
});

let currentUser = null;
let accessToken = null;
const saveTimers = {};
let saveIndicatorTimer = null;

/* ===================== GRADING SCALE (5-point) ===================== */
function gradeInfo(score) {
  const s = parseFloat(score);
  if (isNaN(s)) return { grade: '', point: null };
  if (s >= 70) return { grade: 'A', point: 5 };
  if (s >= 60) return { grade: 'B', point: 4 };
  if (s >= 50) return { grade: 'C', point: 3 };
  if (s >= 45) return { grade: 'D', point: 2 };
  if (s >= 40) return { grade: 'E', point: 1 };
  return { grade: 'F', point: 0 };
}

/* ===================== NAV ===================== */
function buildNav() {
  const nav = document.getElementById('navGroup');
  let html = '<div class="nav-label">RESULT SHEETS</div>';
  YEAR_KEYS.forEach(y => {
    html += `<button class="nav-btn" data-view="${y}" onclick="switchView('${y}')">${y}</button>`;
  });
  html += `<button class="nav-btn transcript" data-view="Transcript" onclick="switchView('Transcript')">Transcript generator</button>`;
  html += `<button class="nav-btn profile" data-view="Profile" onclick="switchView('Profile')">Profile</button>`;
  nav.innerHTML = html;
}

function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  render();
}

/* ===================== RENDER ROOT ===================== */
function render() {
  const container = document.getElementById('viewsContainer');
  if (state.currentView === 'Profile') {
    container.innerHTML = renderProfileView();
    return;
  }
  if (state.currentView === 'Transcript') {
    container.innerHTML = renderTranscriptView();
    attachTranscriptHandlers();
  } else {
    container.innerHTML = renderYearView(state.currentView);
  }
}

/* ===================== META / REPORT SETTINGS ===================== */
function buildMetaUI() {
  const panel = document.getElementById('reportSettings');
  if (!panel) return;
  panel.innerHTML = `
    <div class="report-settings">
      <strong>Report settings</strong>
      <div class="meta-field">
        <label for="metaSchool">Faculty / School</label>
        <input id="metaSchool" value="${escAttr(state.meta.school)}" placeholder="e.g. SCHOOL OF HEALTH TECHNOLOGY (SOHT)">
      </div>
      <div class="meta-field">
        <label for="metaDepartment">Department</label>
        <input id="metaDepartment" value="${escAttr(state.meta.department)}" placeholder="e.g. DEPARTMENT OF PUBLIC HEALTH">
      </div>
    </div>
  `;

  const schoolInput = document.getElementById('metaSchool');
  const deptInput = document.getElementById('metaDepartment');
  if (schoolInput) {
    schoolInput.addEventListener('input', e => {
      state.meta.school = e.target.value;
      saveToLocalStorage();
      render();
    });
  }
  if (deptInput) {
    deptInput.addEventListener('input', e => {
      state.meta.department = e.target.value;
      saveToLocalStorage();
      render();
    });
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

/* ===================== YEAR VIEW ===================== */
function renderYearView(yearKey) {
  let html = `
    <div class="letterhead">
      <img src="assets/futo-logo.jpeg" class="letterhead-logo" alt="FUTO Logo">
      <h2>${META.university}</h2>
      <h3>${escHtml(state.meta.school)}</h3>
      <p>${escHtml(state.meta.department)}</p>
      <div class="title-row">${yearKey.toUpperCase()} — RESULT COMPUTATION</div>
    </div>
  `;
  SEMESTERS.forEach(sem => { html += renderSemesterBlock(yearKey, sem); });
  return html;
}

function renderSemesterBlock(yearKey, sem) {
  const rows = state.years[yearKey][sem];
  const summary = computeSummary(rows);

  let rowsHtml = '';
  if (rows.length === 0) {
    rowsHtml = `<tr class="empty-row"><td colspan="9">No students added yet — click "Add student row" to begin.</td></tr>`;
  } else {
    rows.forEach((r, i) => {
      const gi = gradeInfo(r.score);
      rowsHtml += `
        <tr>
          <td><input value="${escAttr(r.regNo)}" placeholder="Reg No" oninput="updateCell('${yearKey}','${sem}',${i},'regNo',this.value)"></td>
          <td><input value="${escAttr(r.name)}" placeholder="Student name" oninput="updateCell('${yearKey}','${sem}',${i},'name',this.value)"></td>
          <td class="narrow"><input value="${escAttr(r.code)}" placeholder="Code" oninput="updateCell('${yearKey}','${sem}',${i},'code',this.value)"></td>
          <td><input value="${escAttr(r.title)}" placeholder="Course title" oninput="updateCell('${yearKey}','${sem}',${i},'title',this.value)"></td>
          <td class="narrow"><input type="number" value="${escAttr(r.unit)}" placeholder="Unit" oninput="updateCell('${yearKey}','${sem}',${i},'unit',this.value)"></td>
          <td class="narrow"><input type="number" value="${escAttr(r.score)}" placeholder="Score" oninput="updateScore('${yearKey}','${sem}',${i},this.value)"></td>
          <td class="grade-cell grade-${gi.grade}" id="grade-${yearKey}-${sem}-${i}">${gi.grade}</td>
          <td class="point-cell" id="point-${yearKey}-${sem}-${i}">${gi.point === null ? '' : gi.point}</td>
          <td><button class="icon-btn" title="Delete row" onclick="deleteRow('${yearKey}','${sem}',${i})">&#10005;</button></td>
        </tr>
      `;
    });
  }

  const semSlug = sem.replace(/\s+/g, '-');
  const safeSem = sem.replace(/[:\\\/\?\*\[\]]/g, '');
  return `
    <div class="semester" id="semester-${yearKey}-${semSlug}">
      <div class="semester-head">
        <h3>${sem}</h3>
        <div class="toolbar">
          <button class="btn secondary" onclick="addRow('${yearKey}','${sem}')">+ Add student row</button>
          <button class="btn gold" onclick="exportSemesterExcel('${yearKey}','${sem}')">Export to Excel</button>
          <button class="btn secondary" onclick="exportSemesterCSV('${yearKey}','${sem}')">Export to CSV</button>
          <button class="btn secondary" onclick="printSemester('${yearKey}','${sem}')">Print / PDF</button>
        </div>
      </div>

      <div class="summary-grid" id="summary-${yearKey}-${semSlug}">
        ${summaryCardsHtml(summary)}
      </div>

      <table>
        <thead>
          <tr>
            <th style="width:12%">Reg No</th>
            <th style="width:20%">Student Name</th>
            <th style="width:9%">Code</th>
            <th style="width:20%">Course Title</th>
            <th style="width:7%">Unit</th>
            <th style="width:8%">Score</th>
            <th style="width:6%">Grade</th>
            <th style="width:6%">Point</th>
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
function computeSummary(rows) {
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
    const courses = byReg[reg];
    let totalUnits = 0, totalPoints = 0, hasF = false, hasBlank = false;
    courses.forEach(c => {
      const unit = parseFloat(c.unit) || 0;
      const gi = gradeInfo(c.score);
      if (gi.grade === 'F') hasF = true;
      if (gi.grade === '') hasBlank = true;
      if (gi.point !== null) { totalUnits += unit; totalPoints += unit * gi.point; }
    });
    if (hasF) incomplete++; else complete++;
    if (totalUnits > 0 && !hasBlank) gpas.push(totalPoints / totalUnits);
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
  state.years[yearKey][sem][idx].score = value;
  const gi = gradeInfo(value);
  const gradeCell = document.getElementById(`grade-${yearKey}-${sem}-${idx}`);
  const pointCell = document.getElementById(`point-${yearKey}-${sem}-${idx}`);
  if (gradeCell) { gradeCell.textContent = gi.grade; gradeCell.className = 'grade-cell grade-' + gi.grade; }
  if (pointCell) { pointCell.textContent = gi.point === null ? '' : gi.point; }
  refreshSummary(yearKey, sem);
  saveToLocalStorage();
  scheduleSave(yearKey, sem, idx);
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
    score: row.score === '' ? null : parseFloat(row.score)
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
        score: row.score ?? ''
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
  buildMetaUI();
  if (supabaseClient) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      currentUser = session.user;
      accessToken = session.access_token;
      await loadFromApi();
    } else {
      loadFromLocalStorage();
    }
  } else {
    loadFromLocalStorage();
  }
  updateSyncUI();
  switchView('Year 1');
}

async function signOut() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

function refreshSummary(yearKey, sem) {
  const semSlug = sem.replace(/\s+/g, '-');
  const el = document.getElementById(`summary-${yearKey}-${semSlug}`);
  if (el) el.innerHTML = summaryCardsHtml(computeSummary(state.years[yearKey][sem]));
}

/* ===================== TRANSCRIPT VIEW ===================== */
function renderTranscriptView() {
  return `
    <div class="letterhead">
      <img src="assets/futo-logo.jpeg" class="letterhead-logo" alt="FUTO Logo">
      <h2>${META.university}</h2>
      <h3>${escHtml(state.meta.school)}</h3>
      <p>${escHtml(state.meta.department)}</p>
      <div class="title-row">STUDENT TRANSCRIPT GENERATOR</div>
    </div>

    <div class="transcript-search">
      <div class="field">
        <label>Registration Number</label>
        <input id="transcriptRegNo" placeholder="e.g. PH/2025/001">
      </div>
      <button class="btn" id="generateBtn" onclick="generateTranscript()">Generate transcript</button>
      <button class="btn gold" id="printBtn" onclick="window.print()" style="display:none">Print</button>
      <button class="btn secondary" id="excelBtn" onclick="exportTranscriptExcel()" style="display:none">Export to Excel</button>
      <button class="btn secondary" id="csvBtn" onclick="exportTranscriptCSV()" style="display:none">Export to CSV</button>
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

let lastTranscript = null;

function generateTranscript() {
  const regNo = document.getElementById('transcriptRegNo').value.trim();
  const output = document.getElementById('transcriptOutput');
  if (!regNo) { output.innerHTML = '<p class="no-record">Please enter a registration number.</p>'; return; }

  let studentName = '';
  let cumUnits = 0, cumPoints = 0;
  let yearBlocksHtml = '';
  let foundAny = false;
  const flatRows = [];

  YEAR_KEYS.forEach(yearKey => {
    let yearHasData = false;
    let semHtml = '';
    SEMESTERS.forEach(sem => {
      const rows = state.years[yearKey][sem].filter(r => (r.regNo || '').trim() === regNo);
      if (rows.length === 0) return;
      yearHasData = true; foundAny = true;
      let semUnits = 0, semPoints = 0;
      let tableRows = '';
      rows.forEach(r => {
        if (!studentName && r.name) studentName = r.name;
        const unit = parseFloat(r.unit) || 0;
        const gi = gradeInfo(r.score);
        if (gi.point !== null) { semUnits += unit; semPoints += unit * gi.point; cumUnits += unit; cumPoints += unit * gi.point; }
        tableRows += `<tr><td>${escHtml(r.code)}</td><td>${escHtml(r.title)}</td><td style="text-align:center">${escHtml(r.unit)}</td>
          <td style="text-align:center">${escHtml(r.score)}</td><td style="text-align:center;font-weight:600">${gi.grade}</td>
          <td style="text-align:center">${gi.point === null ? '' : gi.point}</td></tr>`;
        flatRows.push({ Year: yearKey, Semester: sem, RegNo: regNo, Name: r.name, Code: r.code, Title: r.title, Unit: r.unit, Score: r.score, Grade: gi.grade, Point: gi.point });
      });
      const semGPA = semUnits > 0 ? (semPoints / semUnits).toFixed(2) : '—';
      semHtml += `
        <div class="t-sem-label">${sem}</div>
        <table><thead><tr><th>Code</th><th>Course Title</th><th>Unit</th><th>Score</th><th>Grade</th><th>Point</th></tr></thead>
        <tbody>${tableRows}</tbody></table>
        <div class="t-totals"><span>Units: <b>${semUnits}</b></span><span>Semester GPA: <b>${semGPA}</b></span></div>
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
    document.getElementById('csvBtn').style.display = 'none';
    lastTranscript = null;
    return;
  }

  const cgpa = cumUnits > 0 ? (cumPoints / cumUnits).toFixed(2) : '—';
  output.innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px;">
      <div><div class="hint">Registration Number</div><div style="font-size:15px;font-weight:600">${escHtml(regNo)}</div></div>
      <div><div class="hint">Student Name</div><div style="font-size:15px;font-weight:600">${escHtml(studentName) || '—'}</div></div>
    </div>
    ${yearBlocksHtml}
    <div class="cgpa-banner">
      <div>Cumulative Grade Point Average (CGPA)</div>
      <div class="big">${cgpa}</div>
    </div>
  `;
  document.getElementById('printBtn').style.display = 'inline-block';
  document.getElementById('excelBtn').style.display = 'inline-block';
  document.getElementById('csvBtn').style.display = 'inline-block';
  lastTranscript = { regNo, studentName, cgpa, flatRows };
}

/* ===================== EXCEL EXPORT ===================== */
async function getLogoBase64() {
  try {
    const response = await fetch('assets/futo-logo.jpeg');
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Failed to load logo for Excel export:', e);
    return null;
  }
}

function buildExportAoa(headers, dataRows) {
  const aoa = [
    [META.university],
    [state.meta.school],
    [state.meta.department],
    [''],
    headers,
    ...dataRows
  ];
  return aoa;
}

async function exportSemesterExcel(yearKey, sem) {
  const rows = state.years[yearKey][sem];
  const data = rows.map(r => {
    const gi = gradeInfo(r.score);
    return [r.regNo, r.name, r.code, r.title, r.unit, r.score, gi.grade, gi.point];
  });
  const headers = ['Reg No', 'Student Name', 'Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point'];
  const ws = XLSX.utils.aoa_to_sheet(buildExportAoa(headers, data));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sem.replace(/[:\\\/\?\*\[\]]/g, ''));

  const logo = await getLogoBase64();
  if (logo) {
    try {
      XLSX.utils.add_image(wb, logo, {
        sheet: wb.SheetNames[0],
        tl: { col: 0.5, row: 0.1 },
        ext: { width: 48, height: 48 }
      });
    } catch (e) {
      console.error('Failed to embed logo in Excel:', e);
    }
  }

  XLSX.writeFile(wb, `${yearKey} - ${sem}.xlsx`);
}

async function exportTranscriptExcel() {
  if (!lastTranscript) return;
  const data = lastTranscript.flatRows.map(r => [r.Year, r.Semester, r.RegNo, r.Name, r.Code, r.Title, r.Unit, r.Score, r.Grade, r.Point]);
  const headers = ['Year', 'Semester', 'Reg No', 'Name', 'Code', 'Title', 'Unit', 'Score', 'Grade', 'Point'];
  const ws = XLSX.utils.aoa_to_sheet(buildExportAoa(headers, data));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transcript');

  const logo = await getLogoBase64();
  if (logo) {
    try {
      XLSX.utils.add_image(wb, logo, {
        sheet: wb.SheetNames[0],
        tl: { col: 0.5, row: 0.1 },
        ext: { width: 48, height: 48 }
      });
    } catch (e) {
      console.error('Failed to embed logo in Excel:', e);
    }
  }

  XLSX.writeFile(wb, `Transcript - ${lastTranscript.regNo}.xlsx`);
}

/* ===================== CSV EXPORT ===================== */
function exportSemesterCSV(yearKey, sem) {
  const rows = state.years[yearKey][sem];
  const data = rows.map(r => {
    const gi = gradeInfo(r.score);
    return [r.regNo, r.name, r.code, r.title, r.unit, r.score, gi.grade, gi.point];
  });
  const headers = ['Reg No', 'Student Name', 'Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point'];
  const aoa = [
    ['FUTO Public Health Results Portal — Logo: assets/futo-logo.jpeg'],
    [META.university],
    [state.meta.school],
    [state.meta.department],
    [''],
    headers,
    ...data
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const csv = XLSX.utils.sheet_to_csv(ws);
  downloadBlob(csv, `${yearKey} - ${sem}.csv`, 'text/csv');
}

function exportTranscriptCSV() {
  if (!lastTranscript) return;
  const data = lastTranscript.flatRows.map(r => [r.Year, r.Semester, r.RegNo, r.Name, r.Code, r.Title, r.Unit, r.Score, r.Grade, r.Point]);
  const headers = ['Year', 'Semester', 'Reg No', 'Name', 'Code', 'Title', 'Unit', 'Score', 'Grade', 'Point'];
  const aoa = [
    ['FUTO Public Health Results Portal — Logo: assets/futo-logo.jpeg'],
    [META.university],
    [state.meta.school],
    [state.meta.department],
    [''],
    headers,
    ...data
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const csv = XLSX.utils.sheet_to_csv(ws);
  downloadBlob(csv, `Transcript - ${lastTranscript.regNo}.csv`, 'text/csv');
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
  const reportSettings = document.getElementById('reportSettings');
  allSemesters.forEach(el => el.style.display = 'none');
  if (reportSettings) reportSettings.style.display = 'none';
  target.style.display = 'block';
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const restore = () => {
    allSemesters.forEach(el => el.style.display = '');
    if (reportSettings) reportSettings.style.display = '';
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
        buildMetaUI();
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

/* ===================== PROFILE VIEW ===================== */
function renderProfileView() {
  const fullName = (currentUser?.user_metadata?.full_name || '').trim();
  const email = currentUser?.email || 'Not available';
  return `
    <div class="letterhead">
      <img src="assets/futo-logo.jpeg" class="letterhead-logo" alt="FUTO Logo">
      <h2>${META.university}</h2>
      <h3>${escHtml(state.meta.school)}</h3>
      <p>${escHtml(state.meta.department)}</p>
      <div class="title-row">PROFILE</div>
    </div>

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
