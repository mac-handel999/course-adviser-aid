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

let state = { years: {}, courses: {}, currentView: 'Year 1', activeCourse: null, meta: { school: 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)', department: 'DEPARTMENT OF PUBLIC HEALTH' }, creditLoad: {}, classSet: null, academicSessions: {} };
YEAR_KEYS.forEach(y => {
  state.years[y] = {};
  state.courses[y] = {};
  SEMESTERS.forEach(s => { state.years[y][s] = [emptyRow()]; state.courses[y][s] = []; });
});

let currentUser = null;
let accessToken = null;
const saveTimers = {};
let saveIndicatorTimer = null;

/* ===================== LETTERHEAD ===================== */
function renderLetterhead(title, session) {
  const sessionHtml = session
    ? `<p class="letterhead-session">${escHtml(session)}</p>`
    : '';
  return `
    <div class="letterhead">
      <img src="assets/futo-logo.jpeg" class="letterhead-logo" alt="FUTO Logo">
      <div class="letterhead-center">
        <h2>${META.university}</h2>
        <h3>${escHtml(state.meta.school)}</h3>
        <p>${escHtml(state.meta.department)}</p>
        <div class="title-row">${escHtml(title)}</div>
        ${sessionHtml}
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

function sanitizeRegNo(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function validateRegNo(input) {
  const value = sanitizeRegNo(input.value);
  input.value = value;
  const warn = input.parentElement.querySelector('.reg-no-warn');
  if (value.length > 0 && value.length !== 11) {
    if (warn) { warn.textContent = 'Registration number must be exactly 11 digits.'; warn.style.color = 'var(--red)'; }
    return false;
  }
  if (warn) { warn.textContent = ''; }
  return true;
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
      // Ensure courses structure exists (for backward compatibility with old saves)
      if (!state.courses) {
        state.courses = {};
        YEAR_KEYS.forEach(y => {
          state.courses[y] = {};
          SEMESTERS.forEach(s => { state.courses[y][s] = []; });
        });
      }
      if (!state.activeCourse) state.activeCourse = null;
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

function validateImportRows(rawRows, yearKey, sem, activeCourse, existingRows) {
  const errors = [];
  const valid = [];
  const seenPairs = new Set();
  const existingRegs = new Set();

  if (activeCourse && existingRows) {
    existingRows.forEach(r => {
      if ((r.regNo || '').trim()) existingRegs.add((r.regNo || '').trim());
    });
  }

  rawRows.forEach((raw, idx) => {
    const row = mapRowFields(raw);
    const rowLabel = `Row ${idx + 1}`;
    const rowErrors = [];
    const reg = String(row.regNo || '').trim();
    const code = String(row.code || '').trim();
    const unitRaw = row.unit;
    const scoreRaw = row.score;

    if (!reg) rowErrors.push('Reg No is required.');
    else if (!/^\d{11}$/.test(reg)) rowErrors.push('Reg No must be exactly 11 digits.');

    if (activeCourse) {
      // Importing into a specific course: only Reg No + Score are required.
      // Course Code/Title/Unit come from the course context, not the file.
      // If the file includes Course Code, validate it matches the open course.
      if (code) {
        const openCourseCode = (activeCourse.course_code || '').trim().toUpperCase();
        if (openCourseCode && code.toUpperCase() !== openCourseCode) {
          rowErrors.push(`Course code mismatch: file has "${code}" but this course is "${openCourseCode}".`);
        }
      }
      // Check against existing rows in the open course's roster
      if (reg && existingRegs.has(reg)) {
        rowErrors.push(`Duplicate: reg no ${reg} already exists in this course — will be skipped.`);
      }
    } else {
      // Flat-table import (no active course): all columns required
      if (!code) rowErrors.push('Course Code is required.');
      if (unitRaw === '' || unitRaw === null || unitRaw === undefined) {
        rowErrors.push('Credit Unit is required.');
      } else {
        const unitNum = parseFloat(unitRaw);
        if (isNaN(unitNum) || unitNum <= 0) rowErrors.push('Credit Unit must be a number greater than 0.');
      }
    }

    if (scoreRaw === '' || scoreRaw === null || scoreRaw === undefined) {
      rowErrors.push('Score is required.');
    } else {
      const scoreNum = parseFloat(scoreRaw);
      if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) rowErrors.push('Score must be a number between 0 and 100.');
    }

    const pairKey = `${reg}|||${code || '(none)'}`;
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

function renderImportPreview(parsed, yearKey, sem, activeCourse) {
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  const courseTag = activeCourse
    ? ` — into course <b>${escHtml(activeCourse.course_code)}</b>`
    : '';
  overlay.innerHTML = `
    <div class="import-modal">
      <h3>Import preview — ${yearKey} · ${sem}${courseTag}</h3>
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

    // If importing from within a course roster, link rows to the active course
    if (state.activeCourse && state.activeCourse.yearKey === yearKey && state.activeCourse.sem === sem) {
      const courses = state.courses[yearKey]?.[sem] || [];
      const course = courses.find(c => c.id === state.activeCourse.courseId);
      if (course) {
        newRow.code = course.course_code || '';
        newRow.title = course.course_title || '';
        newRow.unit = course.credit_unit ?? '';
        newRow.course_id = course.id;
      }
    }

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
      alert('The uploaded file does not contain recognizable result columns. Please ensure headers like Reg No, Student Name, Course Code, etc. are present.');
      input.value = '';
      return;
    }

    // Determine if we're importing from within an active course roster
    const activeCourse = (state.activeCourse && state.activeCourse.yearKey === yearKey && state.activeCourse.sem === sem)
      ? state.courses[yearKey]?.[sem]?.find(c => c.id === state.activeCourse.courseId)
      : null;

    // Get existing rows in the open course's roster for duplicate checking
    const existingRows = activeCourse
      ? state.years[yearKey][sem].filter(r => r.course_id === activeCourse.id)
      : [];

    const parsed = validateImportRows(mapped, yearKey, sem, activeCourse, existingRows);
    if (!parsed.valid.length && parsed.errors.length) {
      alert(`No valid rows found. ${parsed.errors.length} row(s) have errors.`);
      input.value = '';
      return;
    }

    renderImportPreview(parsed, yearKey, sem, activeCourse);
  } catch (err) {
    alert(err.message || 'Failed to import file.');
  } finally {
    input.value = '';
  }
}

/* ===================== YEAR VIEW ===================== */
function renderYearView(yearKey) {
  const session = state.academicSessions[yearKey] || '';
  const title = session ? `${yearKey.toUpperCase()} — ${session.toUpperCase()} SESSION` : `${yearKey.toUpperCase()} — RESULT COMPUTATION`;
  let html = renderLetterhead(title, session);
  html += `<div class="year-actions">
    <button class="btn gold" onclick="exportYearExcel('${yearKey}')">Export ${yearKey} to Excel</button>
  </div>`;
  SEMESTERS.forEach(sem => { html += renderSemesterBlock(yearKey, sem); });
  return html;
}

function renderSemesterBlock(yearKey, sem) {
  const semSlug = sem.replace(/\s+/g, '-');
  const rows = state.years[yearKey][sem];
  const courses = state.courses[yearKey]?.[sem] || [];

  // Sort rows alphabetically by student_name for consistent display
  rows.sort((a, b) => {
    const nameA = (a.name || '').trim().toLowerCase();
    const nameB = (b.name || '').trim().toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  const summary = computeSummary(rows, yearKey, sem);

  // Check if a course is currently open for this semester
  const isOpen = state.activeCourse &&
    state.activeCourse.yearKey === yearKey &&
    state.activeCourse.sem === sem;

  if (isOpen) {
    return renderCourseRoster(yearKey, sem);
  }

  // Course card view
  const courseCardsHtml = renderCourseCards(yearKey, sem, courses, rows);

  let addCourseFormHtml = '';
  if (currentUser) {
    addCourseFormHtml = `
      <div class="add-course-form" id="add-course-form-${yearKey}-${semSlug}">
        <input type="text" id="new-course-code-${yearKey}-${semSlug}" placeholder="Course Code (e.g. PHY101)" maxlength="20">
        <input type="text" id="new-course-title-${yearKey}-${semSlug}" placeholder="Course Title">
        <input type="number" id="new-course-unit-${yearKey}-${semSlug}" placeholder="Unit" min="1" step="1">
        <button class="btn gold" onclick="launchCourse('${yearKey}', '${sem}', '${semSlug}')">Launch Course</button>
      </div>
    `;
  }

  return `
    <div class="semester" id="semester-${yearKey}-${semSlug}">
      <div class="semester-head">
        <h3>${sem}</h3>
        <div class="toolbar">
          <button class="btn secondary" onclick="document.getElementById('import-${yearKey}-${semSlug}').click()">Import from file</button>
          <input type="file" id="import-${yearKey}-${semSlug}" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleImportFile(this, '${yearKey}', '${sem}')">
          <button class="btn gold" onclick="exportSemesterExcel('${yearKey}','${sem}')">Export to Excel</button>
          <button class="btn secondary" onclick="printSemester('${yearKey}','${sem}')">Print / PDF</button>
        </div>
      </div>

      ${addCourseFormHtml}

      <div class="summary-grid" id="summary-${yearKey}-${semSlug}">
        ${summaryCardsHtml(summary)}
      </div>

      ${courseCardsHtml}
    </div>
  `;
}

function renderCourseCards(yearKey, sem, courses, rows) {
  if (!courses.length) {
    return `
      <div class="course-cards-empty">
        <p>No courses launched yet. Add a course above to start entering results.</p>
      </div>
    `;
  }

  const cards = courses.map(course => {
    const courseRows = (rows || []).filter(r => r.course_id === course.id || (!r.course_id && (r.code || '').trim().toUpperCase() === (course.course_code || '').trim().toUpperCase()));
    const studentCount = courseRows.filter(r => (r.regNo || '').trim()).length;
    const displayCount = course.studentCount || studentCount;

    return `
      <div class="course-card" data-course-id="${course.id}">
        <div class="course-card-body" onclick="openCourse('${yearKey}', '${sem.replace(/'/g, "\\'")}', '${course.id}')">
          <div class="course-code">${escHtml(course.course_code)}</div>
          <div class="course-title">${escHtml(course.course_title || '')}</div>
          <div class="course-unit">Unit: ${escHtml(course.credit_unit ?? '')}</div>
          <div class="course-students">${displayCount} student${displayCount !== 1 ? 's' : ''}</div>
        </div>
        <div class="course-card-actions">
          <button class="btn gold" onclick="exportCourseExcel('${course.id}', '${escAttr(course.course_code)}', '${yearKey}', '${sem.replace(/'/g, "\\'")}')">Export</button>
          <button class="btn secondary" onclick="printCourse('${course.id}')">Print</button>
          <button class="btn btn-danger" title="Delete this course and all its results" onclick="deleteCourseConfirm('${course.id}', '${escAttr(course.course_code)}', ${displayCount})">Delete</button>
        </div>
      </div>
    `;
  });

  return `<div class="course-cards">${cards.join('')}</div>`;
}

function renderCourseRoster(yearKey, sem) {
  const courseId = state.activeCourse.courseId;
  const courses = state.courses[yearKey]?.[sem] || [];
  const course = courses.find(c => c.id === courseId);

  if (!course) {
    return `
      <div class="semester" id="semester-${yearKey}-${sem.replace(/\s+/g, '-')}">
        <div class="semester-head">
          <h3>${sem}</h3>
          <button class="btn secondary" onclick="closeCourseRoster()">← Back to courses</button>
        </div>
        <p class="course-not-found">Course not found.</p>
      </div>
    `;
  }

  const allRows = state.years[yearKey][sem];
  // Filter rows that belong to this course (by course_id or fallback code match).
  // Preserve the full-array index so event handlers operate on the correct row
  // in state.years[yearKey][sem] — the filtered roster order does not match
  // the order of the full semester array.
  const matched = allRows
    .map((r, idx) => ({ r, idx }))
    .filter(({ r }) => r.course_id === course.id || (!r.course_id && (r.code || '').trim().toUpperCase() === (course.course_code || '').trim().toUpperCase()));

  // Sort alphabetically by student_name
  matched.sort((a, b) => {
    const nameA = (a.r.name || '').trim().toLowerCase();
    const nameB = (b.r.name || '').trim().toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  const semSlug = sem.replace(/\s+/g, '-');
  let rowsHtml = '';

  if (matched.length === 0) {
    rowsHtml = `<tr class="empty-row"><td colspan="9">No students added yet — add a row below or import from file.</td></tr>`;
  } else {
    matched.forEach(({ r, idx }, sn) => {
      const gi = gradeInfo(r.score);
      const carryBadge = r.isCarryover ? ' <span class="carry-badge">C/O</span>' : '';
      rowsHtml += `
        <tr>
          <td class="sn-cell">${sn + 1}</td>
          <td><input value="${escAttr(r.regNo)}" placeholder="Reg No" maxlength="11" inputmode="numeric" pattern="\d{11}" oninput="updateCell('${yearKey}','${sem}',${idx},'regNo',sanitizeRegNo(this.value))" onblur="validateRegNo(this)"><span class="reg-no-warn" id="regNoWarn-${yearKey}-${sem}-${idx}" style="color:var(--red);font-size:11px"></span></td>
          <td><input value="${escAttr(r.name)}" placeholder="Student name" oninput="updateCell('${yearKey}','${sem}',${idx},'name',this.value)"></td>
          <td class="narrow"><input type="number" value="${escAttr(r.score)}" placeholder="Score" oninput="updateScore('${yearKey}','${sem}',${idx},this.value)"></td>
          <td class="grade-cell grade-${gi.grade}" id="grade-${yearKey}-${sem}-${idx}">${gi.grade}</td>
          <td class="point-cell" id="point-${yearKey}-${sem}-${idx}">${gi.point === null ? '' : gi.point}</td>
          <td class="narrow" style="text-align:center"><input type="checkbox" ${r.isCarryover ? 'checked' : ''} onchange="updateCarryover('${yearKey}','${sem}',${idx},this.checked)" title="Carry-over retake"></td>
          <td><span id="score-warn-${yearKey}-${sem}-${idx}" style="color:var(--red);font-size:11px"></span></td>
          <td><button class="icon-btn" title="Delete row" onclick="deleteRow('${yearKey}','${sem}',${idx})">&#10005;</button></td>
        </tr>
      `;
    });
  }

  const rosterId = `roster-${course.id}`;
  return `
    <div class="semester" id="${rosterId}">
      <div class="semester-head">
        <h3>${sem}</h3>
        <div class="toolbar">
          <button class="btn gold" onclick="addRow('${yearKey}','${sem}')">+ Add student row</button>
          <button class="btn secondary" onclick="document.getElementById('import-${yearKey}-${semSlug}').click()">Import from file</button>
          <input type="file" id="import-${yearKey}-${semSlug}" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleImportFile(this, '${yearKey}', '${sem}')">
          <button class="btn gold" onclick="exportCourseExcel('${course.id}', '${escAttr(course.course_code)}', '${yearKey}', '${sem}')">Export to Excel</button>
          <button class="btn secondary" onclick="printCourse('${course.id}')">Print / PDF</button>
          <button class="btn secondary" onclick="closeCourseRoster()">← Back to courses</button>
        </div>
      </div>

      <div class="course-roster-header">
        <div class="course-code">${escHtml(course.course_code)}</div>
        <div class="course-title">${escHtml(course.course_title || '')}</div>
        <div class="course-unit">Credit Unit: ${escHtml(course.credit_unit ?? '')}</div>
      </div>

      <table class="course-table">
        <thead>
          <tr>
            <th style="width:4%">S/N</th>
            <th style="width:12%">Reg No</th>
            <th style="width:28%">Student Name</th>
            <th style="width:10%">Score</th>
            <th style="width:8%">Grade</th>
            <th style="width:8%">Point</th>
            <th style="width:8%">C/O</th>
            <th style="width:12%"></th>
            <th style="width:20%"></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function closeCourseRoster() {
  state.activeCourse = null;
  render();
}

function openCourse(yearKey, sem, courseId) {
  state.activeCourse = { yearKey, sem, courseId };
  render();
}

async function launchCourse(yearKey, sem, semSlug) {
  if (!currentUser) return;

  const codeInput = document.getElementById(`new-course-code-${yearKey}-${semSlug}`);
  const titleInput = document.getElementById(`new-course-title-${yearKey}-${semSlug}`);
  const unitInput = document.getElementById(`new-course-unit-${yearKey}-${semSlug}`);

  if (!codeInput) return;

  const course_code = codeInput.value.trim().toUpperCase();
  const course_title = titleInput ? titleInput.value.trim() : '';
  const credit_unit = unitInput && unitInput.value.trim() ? parseFloat(unitInput.value.trim()) : null;

  if (!course_code) {
    alert('Course code is required.');
    codeInput.focus();
    return;
  }

  try {
    const data = await apiFetch('/api/courses', {
      method: 'POST',
      body: JSON.stringify({
        year: yearKey,
        semester: sem,
        course_code,
        course_title,
        credit_unit
      })
    });

    // Add to local state
    if (!state.courses[yearKey]) state.courses[yearKey] = {};
    if (!state.courses[yearKey][sem]) state.courses[yearKey][sem] = [];
    state.courses[yearKey][sem].push({
      id: data.id,
      course_code: data.course_code,
      course_title: data.course_title || '',
      credit_unit: data.credit_unit ?? '',
      studentCount: 0
    });
    saveToLocalStorage();

    // Clear inputs
    codeInput.value = '';
    if (titleInput) titleInput.value = '';
    if (unitInput) unitInput.value = '';

    // Open the newly created course's roster
    state.activeCourse = { yearKey, sem, courseId: data.id };
    render();
  } catch (err) {
    if (err.message && err.message.includes('409')) {
      alert('A course with this code already exists for this year and semester.');
    } else {
      alert('Failed to launch course: ' + (err.message || 'Unknown error'));
    }
  }
}

function deleteCourseConfirm(courseId, courseCode, studentCount) {
  const confirmed = confirm(
    `Delete course "${courseCode}"?\n\n` +
    `This will permanently remove ${studentCount} student result${studentCount !== 1 ? 's' : ''} for this course.\n\n` +
    `This action cannot be undone.`
  );
  if (!confirmed) return;
  deleteCourse(courseId);
}

async function deleteCourse(courseId) {
  if (!currentUser || !accessToken) return;
  try {
    const response = await apiFetch(`/api/courses/${encodeURIComponent(courseId)}`, {
      method: 'DELETE'
    });

    // Remove course from local state
    for (const yearKey of YEAR_KEYS) {
      for (const sem of SEMESTERS) {
        const courseList = state.courses[yearKey]?.[sem] || [];
        state.courses[yearKey][sem] = courseList.filter(c => c.id !== courseId);
      }
    }

    // Also remove all results rows that were linked to this course
    YEAR_KEYS.forEach(yearKey => {
      SEMESTERS.forEach(sem => {
        if (state.years[yearKey] && state.years[yearKey][sem]) {
          state.years[yearKey][sem] = state.years[yearKey][sem].filter(r => r.course_id !== courseId);
          if (state.years[yearKey][sem].length === 0) state.years[yearKey][sem].push(emptyRow());
        }
      });
    });

    // Close the course roster if it was open
    if (state.activeCourse && state.activeCourse.courseId === courseId) {
      state.activeCourse = null;
    }

    saveToLocalStorage();
    render();
  } catch (err) {
    if (err.message && err.message.includes('404')) {
      alert('Course not found or already deleted.');
    } else {
      alert('Failed to delete course: ' + (err.message || 'Unknown error'));
    }
  }
}

/* ===================== COURSE ROSTER ROW EDITING =====================
   Row editing operates on the flat state.years[yearKey][sem] array.
   When the user is inside a course roster, the roster's addRow/deleteRow
   still operate on the full semester array; the roster simply filters
   to show only the rows matching the active course.
   New rows created in the roster context are linked to the active course
   via course_id, and course_code/course_title/credit_unit are copied
   from the course metadata. */
function addRow(yearKey, sem) {
  const row = emptyRow();
  // If a course is open, pre-fill course metadata
  if (state.activeCourse && state.activeCourse.yearKey === yearKey && state.activeCourse.sem === sem) {
    const courses = state.courses[yearKey]?.[sem] || [];
    const course = courses.find(c => c.id === state.activeCourse.courseId);
    if (course) {
      row.code = course.course_code || '';
      row.title = course.course_title || '';
      row.unit = course.credit_unit ?? '';
      row.course_id = course.id;
    }
  }
  state.years[yearKey][sem].push(row);
  saveToLocalStorage();
  render();
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

function excelColLetter(n) { return String.fromCharCode(64 + n); }
function excelSpan(colCount, row) { return `A${row}:${excelColLetter(colCount)}${row}`; }

function excelMergeHeader(sheet, rowNum, colCount, value, fontOpts) {
  sheet.mergeCells(excelSpan(colCount, rowNum));
  const cell = sheet.getCell(`A${rowNum}`);
  cell.value = value;
  cell.font = (fontOpts && fontOpts.font) || { bold: true, size: 12 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  if (fontOpts && fontOpts.fill) cell.fill = fontOpts.fill;
}

function excelHeaderRow(sheet, rowNum, headers) {
  const row = sheet.getRow(rowNum);
  headers.forEach((headerText, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = headerText;
    cell.font = { bold: true, color: { argb: 'FFF3F1E9' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  return row;
}

function excelStyleDataRow(row, colCount) {
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
  }
}

function excelContentWidths(headers, dataRows) {
  const widths = headers.map(h => {
    const len = String(h === undefined || h === null ? '' : h).length;
    return Math.min(Math.max(len + 3, 8), 50);
  });
  if (dataRows) {
    dataRows.forEach(rowValues => {
      for (let i = 0; i < headers.length; i++) {
        const val = rowValues[i];
        if (val !== undefined && val !== null && val !== '') {
          const len = String(val).length;
          if (len + 3 > widths[i]) widths[i] = Math.min(len + 3, 50);
        }
      }
    });
  }
  return widths;
}

function excelSetWidths(sheet, widths) {
  widths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w; });
}

function excelAddLogosToSheet(workbook, sheet, colCount, logoBuffer) {
  if (!logoBuffer) return;
  try {
    const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'jpg' });
    const rightCol = Math.max(colCount - 1.5, 3.5);
    sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: 48, height: 48 } });
    sheet.addImage(imageId, { tl: { col: rightCol, row: 0.1 }, ext: { width: 48, height: 48 } });
  } catch (e) {
    console.error('Failed to embed logo in Excel:', e);
  }
}

async function excelAddLogos(workbook, sheet, colCount) {
  const logoBuffer = await getLogoBuffer();
  excelAddLogosToSheet(workbook, sheet, colCount, logoBuffer);
}

function excelSetRowHeights(sheet, startRow, dataCount, headerHeight, dataHeight) {
  for (let r = 1; r <= startRow; r++) {
    sheet.getRow(r).height = headerHeight;
  }
  for (let r = startRow + 1; r <= startRow + dataCount; r++) {
    sheet.getRow(r).height = dataHeight;
  }
}

async function exportCourseExcel(courseId, courseCode, yearKey, sem) {
  const rows = getCourseRows(courseId);
  if (!rows || !rows.length) {
    alert('No student rows to export for this course.');
    return;
  }

  const safeCode = courseCode.replace(/[:\\\/\?\*\[\]]/g, '');
  const safeYear = yearKey.replace(/[:\\\/\?\*\[\]]/g, '');
  const safeSem = sem.replace(/[:\\\/\?\*\[\]]/g, '');
  const session = state.academicSessions[yearKey] || '';
  const title = `${yearKey} — ${sem} — ${courseCode}`;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(safeSem || 'Sheet1');

  const headers = ['Reg No', 'Student Name', 'Score', 'Grade', 'Grade Point', 'Carry-over'];
  const colCount = headers.length;
  const sortedRows = rows.slice().sort((a, b) => {
    const nameA = (a.name || '').trim().toLowerCase();
    const nameB = (b.name || '').trim().toLowerCase();
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  });

  // Letterhead (dynamic span, session, logos)
  excelMergeHeader(sheet, 1, colCount, META.university, { font: { bold: true, size: 14 } });
  excelMergeHeader(sheet, 2, colCount, state.meta.school);
  excelMergeHeader(sheet, 3, colCount, state.meta.department);
  excelMergeHeader(sheet, 4, colCount, title);

  let headerRowNum = 5;
  if (session) {
    excelMergeHeader(sheet, 5, colCount, session, { font: { italic: true, size: 11 } });
    headerRowNum = 6;
  }

  await excelAddLogos(workbook, sheet, colCount);

  // Header row
  excelHeaderRow(sheet, headerRowNum, headers);

  // Data rows
  const dataRowsForWidth = [];
  sortedRows.forEach((r, idx) => {
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const gi = gradeInfo(r.score);
    excelRow.getCell(1).value = r.regNo;
    excelRow.getCell(2).value = r.name;
    excelRow.getCell(3).value = r.score === '' ? null : parseFloat(r.score);
    excelRow.getCell(4).value = gi.grade || '';
    excelRow.getCell(5).value = gi.point === null ? '' : gi.point;
    excelRow.getCell(6).value = r.isCarryover ? 'Yes' : 'No';
    excelStyleDataRow(excelRow, colCount);
    dataRowsForWidth.push([r.regNo, r.name, r.score === '' ? null : parseFloat(r.score), gi.grade || '', gi.point === null ? '' : gi.point, r.isCarryover ? 'Yes' : 'No']);
  });

  // Content-based column widths
  const colWidths = excelContentWidths(headers, dataRowsForWidth);
  excelSetWidths(sheet, colWidths);

  // Row heights
  excelSetRowHeights(sheet, headerRowNum, sortedRows.length, 18, 16);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeCode} - ${safeYear} - ${safeSem}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
function getCourseRows(courseId) {
  const courses = state.courses;
  for (const yearKey of YEAR_KEYS) {
    for (const sem of SEMESTERS) {
      const courseList = courses[yearKey]?.[sem] || [];
      const course = courseList.find(c => c.id === courseId);
      if (course) {
        const allRows = state.years[yearKey][sem] || [];
        return allRows.filter(r => r.course_id === course.id || (!r.course_id && (r.code || '').trim().toUpperCase() === (course.course_code || '').trim().toUpperCase()));
      }
    }
  }
  return [];
}

function printCourse(courseId) {
  const rows = getCourseRows(courseId);
  if (!rows || !rows.length) {
    alert('No student rows to print for this course.');
    return;
  }

  const course = findCourseById(courseId);
  if (!course) return;
  const session = state.academicSessions[course.yearKey] || '';

  const sortedRows = rows.slice().sort((a, b) => {
    const nameA = (a.name || '').trim().toLowerCase();
    const nameB = (b.name || '').trim().toLowerCase();
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  });

  let tableRows = '';
  sortedRows.forEach((r, i) => {
    const gi = gradeInfo(r.score);
    const carryBadge = r.isCarryover ? ' <span class="carry-badge">C/O</span>' : '';
    tableRows += `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escHtml(r.regNo)}</td>
        <td>${escHtml(r.name)}</td>
        <td style="text-align:center">${escHtml(r.score)}</td>
        <td style="text-align:center;font-weight:600">${gi.grade}</td>
        <td style="text-align:center">${gi.point === null ? '' : gi.point}</td>
        <td style="text-align:center">${carryBadge}</td>
      </tr>
    `;
  });

  let printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) return;

  printWindow.document.write(`
    <html>
      <head>
        <title>Print: ${course.course_code}</title>
        <style>
          body { font-family: 'Inter', sans-serif; margin: 20px; color: #1C1F1D; }
          .letterhead-print { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #0B4432; padding-bottom: 16px; margin-bottom: 22px; }
          .logo { width: 56px; height: 56px; object-fit: cover; border-radius: 50%; }
          .center { flex: 1; text-align: center; }
          .center h2 { margin: 0; font-size: 19px; color: #0B4432; }
          .center p { margin: 3px 0; font-size: 13px; }
          .title-row { margin-top: 10px; font-size: 13px; font-weight: 600; color: #B0812E; }
          table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 16px; }
          th { background: #0B4432; color: #F3F1E9; font-weight: 600; text-align: left; padding: 8px 8px; font-size: 11.5px; }
          td { border-bottom: 1px solid #ECE8DD; padding: 5px 6px; }
          .carry-badge { display: inline-block; background: #D4870D; color: #fff; font-size: 10px; font-weight: 700; padding: 1px 5px; border-radius: 4px; }
          .watermark-print { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 28px; font-weight: 700; color: rgba(160, 60, 40, 0.18); white-space: nowrap; pointer-events: none; z-index: 5; }
        </style>
      </head>
      <body>
        <div class="letterhead-print">
          <img src="assets/futo-logo.jpeg" class="logo" alt="FUTO Logo">
          <div class="center">
            <h2>FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI</h2>
            <p>${escHtml(state.meta.school)}</p>
            <p>${escHtml(state.meta.department)}</p>
            <div class="title-row">${escHtml(`${course.course_code} — ${course.course_title || ''} — ${course.yearKey}`)}</div>
            ${session ? `<p style="font-size:12px;color:#6B7168;font-style:italic">${escHtml(session)} SESSION</p>` : ''}
          </div>
          <img src="assets/futo-logo.jpeg" class="logo" alt="FUTO Logo">
        </div>
        <div class="watermark-print">UNOFFICIAL / STUDENT COPY — FOR REFERENCE ONLY</div>
        <table>
          <thead>
            <tr>
              <th style="width:5%">S/N</th>
              <th style="width:18%">Reg No</th>
              <th style="width:30%">Student Name</th>
              <th style="width:12%">Score</th>
              <th style="width:10%">Grade</th>
              <th style="width:10%">Point</th>
              <th style="width:10%">C/O</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  printWindow.close();
}

function findCourseById(courseId) {
  for (const yearKey of YEAR_KEYS) {
    for (const sem of SEMESTERS) {
      const courseList = state.courses[yearKey]?.[sem] || [];
      const course = courseList.find(c => c.id === courseId);
      if (course) {
        return { ...course, yearKey, sem };
      }
    }
  }
  return null;
}

function yearKeyForCourse(courseId) {
  const c = findCourseById(courseId);
  return c ? c.yearKey : '';
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
  const warn = document.getElementById(`score-warn-${yearKey}-${sem}-${idx}`);

  if (value !== '' && (isNaN(num) || num < 0 || num > 100)) {
    if (warn) { warn.textContent = 'Score must be a number between 0 and 100.'; warn.style.color = 'var(--red)'; }
    return;
  }
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

function deleteRow(yearKey, sem, idx) {
  const row = state.years[yearKey][sem][idx];
  if (row.id) deleteRowRemote(row.id);
  state.years[yearKey][sem].splice(idx, 1);
  saveToLocalStorage();
  render();
}

/* ===================== API SYNC =====================
   Signed-in users sync data through the Express API. */

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
      await loadCourses();
      render();
    }
  }
}

async function saveRowRemote(yearKey, sem, idx) {
  if (!currentUser || !accessToken) return;
  const row = state.years[yearKey][sem][idx];
  if (!row) return;
  if (!row.regNo && !row.name && !row.code && !row.title && !row.unit && !row.score) return;

  // Client-side duplicate check: scoped to the currently-open course only
  if (state.activeCourse && state.activeCourse.yearKey === yearKey && state.activeCourse.sem === sem && row.course_id) {
    const courseRows = state.years[yearKey][sem].filter(r => r.course_id === row.course_id);
    const isDuplicate = courseRows.some((r, i) => i !== idx && (r.regNo || '').trim() === (row.regNo || '').trim() && (r.regNo || '').trim() !== '');
    const warnEl = document.getElementById(`regNoWarn-${yearKey}-${sem}-${idx}`);
    if (isDuplicate) {
      if (warnEl) { warnEl.textContent = `Duplicate: reg no ${(row.regNo || '').trim()} already exists in this course.`; warnEl.style.color = 'var(--red)'; }
      return;
    }
    if (warnEl) { warnEl.textContent = ''; }
  }

  const payload = {
    year: yearKey,
    semester: sem,
    reg_no: row.regNo || null,
    student_name: row.name || null,
    course_code: row.code || null,
    course_title: row.title || null,
    credit_unit: row.unit === '' ? null : parseFloat(row.unit),
    score: row.score === '' ? null : parseFloat(row.score),
    is_carryover: !!row.isCarryover,
    course_id: row.course_id || null
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
    YEAR_KEYS.forEach(y => { state.years[y] = {}; state.courses[y] = {}; SEMESTERS.forEach(s => { state.years[y][s] = []; state.courses[y][s] = []; }); });

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
        isCarryover: !!row.is_carryover,
        course_id: row.course_id || null
      });
    });

    YEAR_KEYS.forEach(y => SEMESTERS.forEach(s => {
      if (state.years[y][s].length === 0) state.years[y][s].push(emptyRow());
    }));
  } catch (err) {
    console.error('Load failed:', err.message);
  }
}

async function loadCourses() {
  if (!currentUser || !accessToken) return;
  try {
    const data = await apiFetch('/api/courses');
    YEAR_KEYS.forEach(y => {
      if (!state.courses[y]) state.courses[y] = {};
      SEMESTERS.forEach(s => { state.courses[y][s] = []; });
    });

    (data || []).forEach(c => {
      if (!state.courses[c.year] || !state.courses[c.year][c.semester]) return;
      state.courses[c.year][c.semester].push({
        id: c.id,
        course_code: c.course_code || '',
        course_title: c.course_title || '',
        credit_unit: c.credit_unit ?? '',
        studentCount: c.studentCount || 0
      });
    });
  } catch (err) {
    console.error('Courses load failed:', err.message);
  }
}

function updateSyncUI() {
  const chip = document.getElementById('userChip');
  const status = document.querySelector('.sync-status');
  if (chip) {
    const fullName = (currentUser?.user_metadata?.full_name || '').trim();
    const email = currentUser?.email || '';
    const displayName = fullName || email || 'Not signed in';
    const avatar = currentUser ? generateInitialsAvatar(fullName, email, 28) : '';
    chip.innerHTML = `${avatar}<span style="margin-left:8px">${displayName}</span>`;
  }
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
      await loadCourses();
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
        <input id="transcriptRegNo" placeholder="e.g. 20241234567" maxlength="11" inputmode="numeric" pattern="\d{11}">
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
    input.addEventListener('input', () => { input.value = sanitizeRegNo(input.value); });
    input.addEventListener('blur', () => validateRegNo(input));
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

  const creditInputs = document.querySelectorAll('.credit-load-inputs input[data-sem]');
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

  const sessionInputs = document.querySelectorAll('.credit-load-inputs input[data-year]:not([data-sem])');
  const sessionTimers = {};
  sessionInputs.forEach(input => {
    input.addEventListener('input', () => {
      const year = input.dataset.year;
      const statusEl = document.querySelector(`.credit-load-status[data-year="${year}"][data-type="session"]`);
      if (statusEl) {
        statusEl.textContent = 'Saving…';
        statusEl.style.color = 'var(--muted)';
      }
      clearTimeout(sessionTimers[year]);
      sessionTimers[year] = setTimeout(async () => {
        const value = input.value.trim();
        if (!value) {
          if (statusEl) { statusEl.textContent = ''; }
          return;
        }
        try {
          await apiFetch('/api/academic-sessions', {
            method: 'PUT',
            body: JSON.stringify({ year, session_label: value })
          });
          if (!state.academicSessions[year]) state.academicSessions[year] = value;
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
      const session = state.academicSessions[yearKey] || '';
      const yearTitle = session ? `${yearKey} — ${session}` : yearKey;
      yearBlocksHtml += `<div class="t-year-block"><h4>${yearTitle}</h4>${semHtml}</div>`;
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
  const session = state.academicSessions[yearKey] || '';
  const title = session ? `CUMULATIVE RESULT SHEET — ${session.toUpperCase()} SESSION` : 'CUMULATIVE RESULT SHEET';
  const rows = state.years[yearKey][sem] || [];
  const sorted = rows.slice().sort((a, b) => (a.name || '').trim().toLowerCase() < (b.name || '').trim().toLowerCase() ? -1 : 1);

  // Source course codes from the courses table for stable, deliberate column order
  // (falls back to deriving distinct codes from results rows if no courses table data)
  const courseList = state.courses[yearKey]?.[sem] || [];
  let codes;
  if (courseList.length) {
    codes = courseList.map(c => (c.course_code || '').trim()).filter(Boolean);
  } else {
    codes = Array.from(new Set(rows.map(r => (r.code || '').trim()).filter(Boolean))).sort();
  }

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

  return renderLetterhead(title, session) + `
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

  // Source course codes from the courses table for stable column order
  const courseList = state.courses[yearKey]?.[sem] || [];
  let codes;
  if (courseList.length) {
    codes = courseList.map(c => (c.course_code || '').trim()).filter(Boolean);
  } else {
    codes = Array.from(new Set(rows.map(r => (r.code || '').trim()).filter(Boolean))).sort();
  }

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

  const session = state.academicSessions[yearKey] || '';
  const colCount = codes.length + 4;
  const headers = ['S/N', 'Name', 'Reg No', ...codes, 'Remarks'];

  excelMergeHeader(sheet, 1, colCount, META.university, { font: { bold: true, size: 14 } });
  excelMergeHeader(sheet, 2, colCount, state.meta.school);
  excelMergeHeader(sheet, 3, colCount, state.meta.department);
  excelMergeHeader(sheet, 4, colCount, `${yearKey} — ${sem}`);

  let headerRowNum = 5;
  if (session) {
    excelMergeHeader(sheet, 5, colCount, session, { font: { italic: true, size: 11 } });
    headerRowNum = 6;
  }

  await excelAddLogos(workbook, sheet, colCount);
  excelHeaderRow(sheet, headerRowNum, headers);

  const dataRowsForWidth = [];
  students.forEach((stu, idx) => {
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const fCount = rows.filter(r => (r.regNo || '').trim() === stu.regNo && gradeInfo(r.score).grade === 'F').length;
    const remark = fCount === 0 ? 'Pass' : `${fCount}F`;
    excelRow.getCell(1).value = idx + 1;
    excelRow.getCell(2).value = stu.name;
    excelRow.getCell(3).value = stu.regNo;
    const rowValues = [idx + 1, stu.name, stu.regNo];
    codes.forEach((code, ci) => {
      const r = stu.scores[code];
      const cell = excelRow.getCell(4 + ci);
      if (r) {
        const gi = gradeInfo(r.score);
        cell.value = `${r.score} (${gi.grade})`;
        rowValues.push(`${r.score} (${gi.grade})`);
      } else {
        cell.value = '—';
        rowValues.push('—');
      }
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    excelRow.getCell(4 + codes.length).value = remark;
    excelRow.getCell(4 + codes.length).alignment = { horizontal: 'center', vertical: 'middle' };
    rowValues.push(remark);
    excelRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    excelRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    excelRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
    excelStyleDataRow(excelRow, 3);
    dataRowsForWidth.push(rowValues);
  });

  excelSetWidths(sheet, excelContentWidths(headers, dataRowsForWidth));
  excelSetRowHeights(sheet, headerRowNum, students.length, 18, 16);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cumulative - ${yearKey} - ${sem}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ===================== SEMESTER / YEAR / TRANSCRIPT EXCEL EXPORT ===================== */

async function exportSemesterExcel(yearKey, sem) {
  const rows = state.years[yearKey][sem];
  const session = state.academicSessions[yearKey] || '';
  const title = `${yearKey} — ${sem}`

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sem.replace(/[:\\\/\?\*\[\]]/g, '') || 'Sheet1');

  const headers = ['S/N', 'Reg No', 'Student Name', 'Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point'];
  const colCount = headers.length;

  excelMergeHeader(sheet, 1, colCount, META.university, { font: { bold: true, size: 14 } });
  excelMergeHeader(sheet, 2, colCount, state.meta.school);
  excelMergeHeader(sheet, 3, colCount, state.meta.department);
  excelMergeHeader(sheet, 4, colCount, title);

  let headerRowNum = 5;
  if (session) {
    excelMergeHeader(sheet, 5, colCount, session, { font: { italic: true, size: 11 } });
    headerRowNum = 6;
  }

  await excelAddLogos(workbook, sheet, colCount);
  excelHeaderRow(sheet, headerRowNum, headers);

  const dataRowsForWidth = [];
  rows.forEach((r, idx) => {
    const gi = gradeInfo(r.score);
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const scoreVal = r.score === '' ? null : parseFloat(r.score);
    const values = [idx + 1, r.regNo, r.name, r.code, r.title, r.unit, scoreVal, gi.grade || '', gi.point === null ? '' : gi.point];
    values.forEach((val, colIdx) => { excelRow.getCell(colIdx + 1).value = val; });
    excelStyleDataRow(excelRow, colCount);
    dataRowsForWidth.push(values);
  });

  excelSetWidths(sheet, excelContentWidths(headers, dataRowsForWidth));
  excelSetRowHeights(sheet, headerRowNum, rows.length, 18, 16);

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
  const session = state.academicSessions[yearKey] || '';
  const workbook = new ExcelJS.Workbook();
  const headers = ['S/N', 'Reg No', 'Student Name', 'Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point'];
  const colCount = headers.length;

  SEMESTERS.forEach(sem => {
    const rows = state.years[yearKey][sem];
    const title = `${yearKey} — ${sem}`

    const safeSem = sem.replace(/[:\\\/\?\*\[\]]/g, '');
    const sheet = workbook.addWorksheet(safeSem || 'Sheet1');

    excelMergeHeader(sheet, 1, colCount, META.university, { font: { bold: true, size: 14 } });
    excelMergeHeader(sheet, 2, colCount, state.meta.school);
    excelMergeHeader(sheet, 3, colCount, state.meta.department);
    excelMergeHeader(sheet, 4, colCount, title);

    let headerRowNum = 5;
    if (session) {
      excelMergeHeader(sheet, 5, colCount, session, { font: { italic: true, size: 11 } });
      headerRowNum = 6;
    }

    excelHeaderRow(sheet, headerRowNum, headers);

    const dataRowsForWidth = [];
    rows.forEach((r, idx) => {
      const gi = gradeInfo(r.score);
      const excelRow = sheet.getRow(headerRowNum + 1 + idx);
      const scoreVal = r.score === '' ? null : parseFloat(r.score);
      const values = [idx + 1, r.regNo, r.name, r.code, r.title, r.unit, scoreVal, gi.grade || '', gi.point === null ? '' : gi.point];
      values.forEach((val, colIdx) => { excelRow.getCell(colIdx + 1).value = val; });
      excelStyleDataRow(excelRow, colCount);
      dataRowsForWidth.push(values);
    });

    excelSetWidths(sheet, excelContentWidths(headers, dataRowsForWidth));
    excelSetRowHeights(sheet, headerRowNum, rows.length, 18, 16);
  });

  const logoBuffer = await getLogoBuffer();
  workbook.worksheets.forEach(sheet => {
    excelAddLogosToSheet(workbook, sheet, colCount, logoBuffer);
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
  const sessionMap = {};
  const sessions = state.academicSessions || {};
  Object.keys(sessions).forEach(yk => {
    if (sessions[yk]) sessionMap[yk] = sessions[yk];
  });

  const headers = ['Year', 'Semester', 'Reg No', 'Name', 'Session', 'Code', 'Title', 'Unit', 'Score', 'Grade', 'Point'];
  const colCount = headers.length;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transcript');

  excelMergeHeader(sheet, 1, colCount, META.university, { font: { bold: true, size: 14 } });
  excelMergeHeader(sheet, 2, colCount, state.meta.school);
  excelMergeHeader(sheet, 3, colCount, state.meta.department);
  excelMergeHeader(sheet, 4, colCount, 'STUDENT TRANSCRIPT GENERATOR');

  const headerRowNum = 5;
  await excelAddLogos(workbook, sheet, colCount);
  excelHeaderRow(sheet, headerRowNum, headers);

  const dataRowsForWidth = [];
  lastTranscript.flatRows.forEach((r, idx) => {
    const session = sessionMap[r.Year] || '';
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const scoreVal = r.Score === '' ? null : parseFloat(r.Score);
    const values = [r.Year, r.Semester, r.RegNo, r.Name, session, r.Code, r.Title, r.Unit, scoreVal, r.Grade || '', r.Point === null ? '' : r.Point];
    values.forEach((val, colIdx) => { excelRow.getCell(colIdx + 1).value = val; });
    excelStyleDataRow(excelRow, colCount);
    dataRowsForWidth.push(values);
  });

  excelSetWidths(sheet, excelContentWidths(headers, dataRowsForWidth));
  excelSetRowHeights(sheet, headerRowNum, lastTranscript.flatRows.length, 18, 16);

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

async function loadSettings() {
  if (!currentUser || !accessToken) return;
  try {
    const data = await apiFetch('/api/settings');
    if (data) {
      state.meta.school = data.faculty || state.meta.school;
      state.meta.department = data.department || state.meta.department;
      state.meta.portalSlug = data.portal_slug || state.meta.portalSlug;
      state.meta.passcodeSet = !!data.passcode_set;
      state.classSet = data.class_set || null;
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

  try {
    const sessionData = await apiFetch('/api/academic-sessions');
    state.academicSessions = {};
    (sessionData || []).forEach(row => {
      state.academicSessions[row.year] = row.session_label;
    });
  } catch (err) {
    console.error('Failed to load academic sessions:', err.message);
  }
}

/* ===================== SETTINGS VIEW ===================== */
function renderSettingsView() {
  const slug = state.meta.portalSlug || '';
  const checkUrl = slug ? `${window.location.origin}/students-results/${encodeURIComponent(slug)}` : '';
  const classSet = state.classSet || '';
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
        <div class="meta-field">
          <label for="settingClassSet">Class Set</label>
          <input id="settingClassSet" value="${escAttr(classSet)}" placeholder="e.g. 2024/2025">
          <small>Admission cohort session. Used to auto-label each year's session.</small>
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

      <h3>Academic sessions</h3>
      <p class="settings-note">Set the academic session label for each year. These appear on official documents.</p>
      <div class="settings-form">
        <div class="credit-load-grid">
          ${YEAR_KEYS.map(yearKey => {
            const session = state.academicSessions[yearKey] || '';
            return `
              <div class="credit-load-row">
                <label>${yearKey}</label>
                <div class="credit-load-inputs">
                  <input type="text" placeholder="Session" data-year="${yearKey}" value="${escAttr(session)}">
                </div>
                <span class="credit-load-status" data-year="${yearKey}" data-type="session"></span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

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

    <div class="settings-divider"></div>

    <h3>Help &amp; legal</h3>
    <div class="settings-form">
      <div class="profile-actions-row">
        <a href="docs.html" class="btn secondary">Documentation</a>
        <a href="terms.html" class="btn secondary">Terms &amp; Conditions</a>
        <a href="privacy.html" class="btn secondary">Privacy Policy</a>
      </div>
    </div>
  `;
}

async function saveSettings() {
  const faculty = document.getElementById('settingFaculty').value.trim();
  const department = document.getElementById('settingDepartment').value.trim();
  const portalSlug = document.getElementById('settingSlug').value.trim();
  const classSet = document.getElementById('settingClassSet').value.trim();
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
      body: JSON.stringify({ faculty, department, portal_slug: portalSlug, class_set: classSet })
    });
    state.meta.school = data.faculty;
    state.meta.department = data.department;
    state.meta.portalSlug = data.portal_slug;
    state.classSet = data.class_set || null;
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
  const avatar = generateInitialsAvatar(fullName, email, 80);
  const displayName = fullName || email;
  const slug = state.meta.portalSlug || '';
  const portalUrl = slug ? `${window.location.origin}/students-results/${encodeURIComponent(slug)}` : '';

  return renderLetterhead('PROFILE') + `
    <div class="profile-card">
      <div class="profile-header">
        ${avatar}
        <div>
          <div class="profile-name">${escHtml(displayName)}</div>
          <div class="profile-email">${escHtml(email)}</div>
        </div>
      </div>

      <div class="profile-row">
        <div class="profile-label">Full name</div>
        <div class="profile-value">${escHtml(fullName) || 'Not set'}</div>
      </div>
      <div class="profile-row">
        <div class="profile-label">Email</div>
        <div class="profile-value">${escHtml(email)}</div>
      </div>
      <div class="profile-row">
        <div class="profile-label">Student passphrase set?</div>
        <div class="profile-value">${state.meta.passcodeSet ? 'Yes' : 'No'}</div>
      </div>
    </div>

    <div class="profile-card">
      <h3 style="margin:0 0 14px 0;font-size:15px">Student Results Portal</h3>
      ${portalUrl ? `
        <div class="profile-row">
          <div class="profile-label">Shareable link</div>
          <div class="profile-value">
            <a href="${escAttr(portalUrl)}" target="_blank" rel="noopener noreferrer">${escHtml(portalUrl)}</a>
          </div>
        </div>
        <div class="profile-actions-row">
          <button class="btn secondary" onclick="copyPortalLinkFromProfile()">Copy Link</button>
          <a href="${escAttr(portalUrl)}" target="_blank" rel="noopener noreferrer" class="btn gold">Visit Portal</a>
        </div>
      ` : `
        <div class="profile-row">
          <div class="profile-label">Shareable link</div>
          <div class="profile-value" style="color:var(--muted)">Not configured — set a portal slug in Settings.</div>
        </div>
      `}
    </div>

    <div class="profile-card">
      <h3 style="margin:0 0 14px 0;font-size:15px">Student Passphrase</h3>
      <p class="settings-note">For security, passphrases can't be displayed once set. If you or your students have
        forgotten it, set a new one here — this immediately replaces the old one for everyone.</p>
      <div class="profile-actions-row">
        <button class="btn gold" onclick="resetPasscodeFromProfile()">Set a new passphrase</button>
      </div>
    </div>

      <div class="profile-actions">
      <button class="btn secondary" onclick="signOut()">Log out</button>
      <button class="btn danger" onclick="deleteAccount()">Delete my account and data</button>
    </div>

    <div class="profile-card">
      <h3 style="margin:0 0 14px 0;font-size:15px">Help</h3>
      <div class="profile-actions-row">
        <a href="docs.html" class="btn secondary">Documentation</a>
        <a href="terms.html" class="btn secondary">Terms &amp; Conditions</a>
        <a href="privacy.html" class="btn secondary">Privacy Policy</a>
      </div>
    </div>
  `;
}

async function copyPortalLinkFromProfile() {
  const slug = state.meta.portalSlug || '';
  const url = slug ? `${window.location.origin}/students-results/${encodeURIComponent(slug)}` : '';
  if (!url) {
    alert('Configure a portal slug in Settings first.');
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    alert('Link copied to clipboard.');
  } catch (err) {
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('Link copied to clipboard.');
  }
}

async function resetPasscodeFromProfile() {
  const newPass = prompt('Enter a new passphrase (minimum 6 characters). This immediately replaces the old one for all students.');
  if (!newPass) return;
  if (newPass.length < 6) {
    alert('Passphrase must be at least 6 characters.');
    return;
  }
  if (!confirm('Set this as the new passphrase? This immediately replaces the old one for everyone.')) return;
  try {
    await apiFetch('/api/settings/passcode', {
      method: 'PUT',
      body: JSON.stringify({ passcode: newPass })
    });
    state.meta.passcodeSet = true;
    alert('Passphrase updated.');
    render();
  } catch (err) {
    alert('Failed to update passphrase: ' + err.message);
  }
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

/* ===================== AVATAR ===================== */
function generateInitialsAvatar(name, email, sizePx) {
  const fullName = (name || '').trim();
  let initials;
  if (fullName) {
    const words = fullName.split(/\s+/).filter(Boolean);
    if (words.length === 1) {
      initials = words[0][0].toUpperCase();
    } else {
      initials = words[0][0].toUpperCase() + words[words.length - 1][0].toUpperCase();
    }
  } else {
    initials = ((email || '?')[0] || '?').toUpperCase();
  }
  const fontSize = Math.round(sizePx * 0.42);
  return `<div class="avatar" style="width:${sizePx}px;height:${sizePx}px;font-size:${fontSize}px" title="${escAttr(fullName || email || '')}">${escHtml(initials)}</div>`;
}

/* ===================== UTIL ===================== */
function escAttr(v) { return (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;'); }
function escHtml(v) { return (v === undefined || v === null) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ===================== INIT ===================== */
initApp();
