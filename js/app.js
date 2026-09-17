/* =========================================================================
   Advyza — app logic

   Users must sign in via the Supabase auth flow (see js/auth.js).
   On load, initApp checks for an active session; if none is found the
   user is redirected to login.html.  Once signed in, edits are saved
   through the Express API to the Supabase database
   (see server/routes/results.js and sql/schema.sql).
   ========================================================================= */

const META = {
  university: 'FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI'
};
const YEAR_KEYS = Array.from({ length: 10 }, (_, i) => 'Year ' + (i + 1));
const SEMESTERS = ['Harmattan Semester', 'Rain Semester'];
const emptyRow = () => ({ id: null, regNo: '', name: '', code: '', title: '', unit: '', score: '', test_score: '', lab_score: '', exam_score: '', isCarryover: false, program: '', remark: '', studentId: null });

let state = { years: {}, courses: {}, currentView: 'Year 1', activeCourse: null, meta: { school: 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)', department: 'DEPARTMENT OF PUBLIC HEALTH' }, classSet: null, academicSessions: {} };
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
    accountHtml += `<button class="nav-btn dashboard" data-view="Dashboard" onclick="switchView('Dashboard')">Dashboard</button>`;
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
  } else if (state.currentView === 'Dashboard') {
    container.innerHTML = renderDashboardView();
    attachDashboardHandlers();
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

function showSaveIndicator() {
  const status = document.querySelector('.sync-status');
  if (!status) return;
  status.innerHTML = '<span class="dot"></span>Saved';
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
  { key: 'score', aliases: ['score', 'mark', 'score/mark', 'marks'] },
   { key: 'program', aliases: ['program', 'program of study', 'programme', 'programme of study'] },
   { key: 'remark', aliases: ['remark', 'remarks', 'note', 'notes'] },
   { key: 'test_score', aliases: ['test', 'test score', 'testscore', 't_score', 't'] },
   { key: 'lab_score', aliases: ['lab', 'lab score', 'labscore', 'l_score', 'l'] },
   { key: 'exam_score', aliases: ['exam', 'exam score', 'examscore', 'e_score', 'e'] }
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

function validateImportRows(rawRows, yearKey, sem, activeCourse, existingRows, hasComponentColumns, componentMismatch, studentRosterList) {
  const errors = [];
  const fileErrors = [];
  const valid = [];
  const warnings = [];
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

    if (componentMismatch) {
      rowErrors.push(`Component columns detected but course "${activeCourse.course_code}" is in single-score mode. Toggle "Use Test/Lab/Exam breakdown" on the course, or remove Test/Lab/Exam columns from the file.`);
    }

    if (!reg) rowErrors.push('Reg No is required.');
    else if (!/^\d{11}$/.test(reg)) rowErrors.push('Reg No must be exactly 11 digits.');

    const rowWarnings = [];

    // Roster mismatch checks: match by reg_no against the student roster
    if (reg && studentRosterList && studentRosterList.length) {
      const rosterEntry = studentRosterList.find(s => (s.reg_no || '').trim() === reg);
      if (rosterEntry) {
        const fileStudentName = String(row.name || '').trim();
        const rosterName = (rosterEntry.full_name || '').trim();
        if (fileStudentName && rosterName && fileStudentName.toLowerCase() !== rosterName.toLowerCase()) {
          rowWarnings.push(`Name mismatch: file has "${fileStudentName}" but roster has "${rosterName}". Roster name will be used.`);
        }
        const fileProgram = String(row.program || '').trim();
        const rosterProgram = (rosterEntry.program || '').trim();
        if (fileProgram && rosterProgram && fileProgram.toLowerCase() !== rosterProgram.toLowerCase()) {
          rowWarnings.push(`Program mismatch: file has "${fileProgram}" but roster has "${rosterProgram}". Roster program will be kept.`);
        }
      }
    }

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
      // Require student to exist on the Class Roster. Full Name in the file
      // is ignored — identity is sourced from the roster only.
      if (reg && studentRosterList && studentRosterList.length) {
        const rosterEntry = studentRosterList.find(s => (s.reg_no || '').trim() === reg);
        if (!rosterEntry) {
          rowErrors.push(`Reg No ${reg} is not on your Class Roster — add them via Settings → Class Roster first.`);
        }
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
      // Also require the student to be on the Class Roster for all imports
      if (reg && studentRosterList && studentRosterList.length) {
        const rosterEntry = studentRosterList.find(s => (s.reg_no || '').trim() === reg);
        if (!rosterEntry) {
          rowErrors.push(`Reg No ${reg} is not on your Class Roster — add them via Settings → Class Roster first.`);
        }
      }
    }

    // Score validation: component mode or single-score mode
    let computedScore = '';
    if (hasComponentColumns) {
      const testNum = row.test_score !== '' && row.test_score !== null && row.test_score !== undefined ? parseFloat(row.test_score) : 0;
      const labNum = row.lab_score !== '' && row.lab_score !== null && row.lab_score !== undefined ? parseFloat(row.lab_score) : 0;
      const examNum = row.exam_score !== '' && row.exam_score !== null && row.exam_score !== undefined ? parseFloat(row.exam_score) : 0;

      if (row.test_score !== '' && row.test_score !== null && row.test_score !== undefined) {
        const n = parseFloat(row.test_score);
        if (isNaN(n) || n < 0) rowErrors.push('Test score must be 0 or greater.');
      }
      if (row.lab_score !== '' && row.lab_score !== null && row.lab_score !== undefined) {
        const n = parseFloat(row.lab_score);
        if (isNaN(n) || n < 0) rowErrors.push('Lab score must be 0 or greater.');
      }
      if (row.exam_score !== '' && row.exam_score !== null && row.exam_score !== undefined) {
        const n = parseFloat(row.exam_score);
        if (isNaN(n) || n < 0) rowErrors.push('Exam score must be 0 or greater.');
      }

      computedScore = String(testNum + labNum + examNum);
      if (isNaN(parseFloat(computedScore)) || parseFloat(computedScore) < 0 || parseFloat(computedScore) > 100) {
        rowErrors.push('Combined Test+Lab+Exam must total a number between 0 and 100.');
      }
    }

    const finalScoreRaw = hasComponentColumns ? computedScore : scoreRaw;
    if (finalScoreRaw === '' || finalScoreRaw === null || finalScoreRaw === undefined) {
      rowErrors.push('Score is required.');
    } else {
      const scoreNum = parseFloat(finalScoreRaw);
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
        score: hasComponentColumns ? computedScore : (scoreRaw === '' || scoreRaw === null ? '' : String(scoreRaw)),
        test_score: hasComponentColumns ? (row.test_score === '' || row.test_score === null || row.test_score === undefined ? '' : String(row.test_score)) : '',
        lab_score: hasComponentColumns ? (row.lab_score === '' || row.lab_score === null || row.lab_score === undefined ? '' : String(row.lab_score)) : '',
        exam_score: hasComponentColumns ? (row.exam_score === '' || row.exam_score === null || row.exam_score === undefined ? '' : String(row.exam_score)) : '',
        program: String(row.program || '').trim(),
        remark: String(row.remark || '').trim(),
        warnings: rowWarnings
      });
    }
  });

  return { valid, errors, fileErrors, total: rawRows.length };
}

function renderImportPreview(parsed, yearKey, sem, activeCourse) {
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  const courseTag = activeCourse
    ? ` — into course <b>${escHtml(activeCourse.course_code)}</b>`
    : '';
  const hasComponentCols = parsed.valid.some(r => r.test_score !== '' || r.lab_score !== '' || r.exam_score !== '');
  const componentHeaders = hasComponentCols
    ? `<th>Test</th><th>Lab</th><th>Exam</th>`
    : '';
  const hasWarnings = parsed.valid.some(r => r.warnings && r.warnings.length);
  const warningCount = parsed.valid.reduce((sum, r) => sum + (r.warnings ? r.warnings.length : 0), 0);
  const showRosterStatus = !!activeCourse;
  const rosterStatusHeader = showRosterStatus ? '<th>Status</th>' : '';
  overlay.innerHTML = `
    <div class="import-modal">
      <h3>Import preview — ${yearKey} · ${sem}${courseTag}</h3>
      <div class="import-summary">
        <div><span class="num">${parsed.total}</span><span class="lbl">Total rows found</span></div>
        <div><span class="num ok">${parsed.valid.length}</span><span class="lbl">Valid rows</span></div>
        <div><span class="num err">${parsed.errors.length}</span><span class="lbl">Rows with errors</span></div>
      </div>
      ${parsed.fileErrors.length ? `
        <div class="import-errors">
          <strong>File-level errors</strong>
          <ul>
            ${parsed.fileErrors.map(e => `<li>${e}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${parsed.errors.length ? `
        <div class="import-errors">
          <strong>Errors</strong>
          <ul>
            ${parsed.errors.map(e => `<li><b>${e.index + 1}</b>: ${e.errors.join(' ')}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${hasWarnings ? `
        <div class="import-warnings">
          <strong>Mismatches found (${warningCount})</strong>
          <ul>
            ${parsed.valid.filter(r => r.warnings && r.warnings.length).map(r => `<li><b>${r.regNo}</b>: ${r.warnings.join(' ')}</li>`).join('')}
          </ul>
          <p class="settings-note">These rows will be imported using the roster's existing values for name and program. Click "Import" to confirm.</p>
        </div>
      ` : ''}
      <div class="import-table-wrap">
        <table>
          <thead>
            <tr><th>Reg No</th><th>Student Name</th><th>Code</th><th>Course Title</th><th>Unit</th>${componentHeaders}<th>Score</th><th>Program</th><th>Remark</th>${rosterStatusHeader}</tr>
          </thead>
          <tbody>
            ${parsed.valid.map(r => {
              // Check if this student is on the roster
              let rosterStatusHtml = '';
              if (showRosterStatus && studentRoster.all) {
                const onRoster = studentRoster.all.some(s => (s.reg_no || '').trim() === (r.regNo || '').trim());
                rosterStatusHtml = onRoster
                  ? '<td><span style="color:var(--ok);font-size:11px">On roster</span></td>'
                  : '<td><span style="color:var(--red);font-size:11px">Not on roster — skipped</span></td>';
              }
              return `<tr><td>${escHtml(r.regNo)}</td><td>${escHtml(r.name)}</td><td>${escHtml(r.code)}</td><td>${escHtml(r.title)}</td><td>${escHtml(r.unit)}</td>${hasComponentCols ? `<td>${escHtml(r.test_score)}</td><td>${escHtml(r.lab_score)}</td><td>${escHtml(r.exam_score)}</td>` : ''}<td>${escHtml(r.score)}</td><td>${escHtml(r.program)}</td><td>${escHtml(r.remark)}</td>${rosterStatusHtml}</tr>`;
            }).join('')}
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
  let skipped = 0;

  // Ensure student roster is loaded
  if (!studentRoster.loaded) {
    await loadStudents();
  }

  for (const r of rows) {
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

    // Match against the student roster by reg_no
    const regNoTrimmed = (newRow.regNo || '').trim();
    if (regNoTrimmed) {
      const rosterEntry = studentRoster.all.find(s => (s.reg_no || '').trim() === regNoTrimmed);
      if (rosterEntry) {
        // Existing roster student: link to student_id, use roster's canonical name
        newRow.studentId = rosterEntry.id;
        newRow.name = rosterEntry.full_name || newRow.name;
        // Use roster program if available, fall back to file program
        if (rosterEntry.program) {
          newRow.program = rosterEntry.program;
        }
      } else {
        // Student not on the roster: skip this row — do not auto-create
        // a roster entry during bulk import. Errors were flagged in the
        // preview; here we simply skip to the next row.
        console.warn(`Skipping import row for reg ${regNoTrimmed} — not on Class Roster`);
        skipped++;
        continue;
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
  }
  saveToLocalStorage();
  render();
  const parts = [];
  if (inserted) parts.push(`${inserted} inserted`);
  if (updated) parts.push(`${updated} updated`);
  if (skipped) parts.push(`${skipped} skipped (not on roster)`);
  alert(`${parts.join(', ')}.`);
  }

async function handleImageScan(input, yearKey, sem) {
  const file = input.files && input.files[0];
  if (!file) return;

  // Reject files that are too large for base64 upload to server
  const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
  if (file.size > MAX_BYTES) {
    alert(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Please use a smaller image.`);
    input.value = '';
    return;
  }

  const isImage = file.type.startsWith('image/');
  const isPdf = file.type === 'application/pdf';

  if (!isImage && !isPdf) {
    alert('Please select a JPG, PNG, or PDF file.');
    input.value = '';
    return;
  }

  showLoading('Scanning results…');
  try {
    let imageBase64, mimeType;

    if (isImage) {
      imageBase64 = await fileToBase64(file);
      mimeType = file.type || 'image/jpeg';
    } else {
      // PDF: render first page to canvas image using pdfjs
      imageBase64 = await pdfPageToBase64(file, 0);
      mimeType = 'image/jpeg';
    }

    const response = await apiFetch('/api/ocr/scan-result', {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType })
    });

    const { data } = response;
    if (!data || !data.length) {
      alert('No student records were detected in this image. Try a clearer photo with the table fully in frame.');
      input.value = '';
      return;
    }

    // Convert AI output to raw rows that mapRowFields can process
    const rawRows = data.map(row => ({
      'Reg No': row.reg_no,
      Test: row.test,
      Lab: row.lab,
      Exam: row.exam,
      Remark: row.remark || ''
    }));

    // Feed into the existing import pipeline
    const mapped = rawRows.map(r => mapRowFields(r));

    // Ensure student roster is loaded for cross-matching
    if (!studentRoster.loaded) {
      await loadStudents();
    }

    const activeCourse = (state.activeCourse && state.activeCourse.yearKey === yearKey && state.activeCourse.sem === sem)
      ? state.courses[yearKey]?.[sem]?.find(c => c.id === state.activeCourse.courseId)
      : null;

    // Detect component columns (Test/Lab/Exam present with non-zero values)
    const hasComponentColumns = mapped.some(r =>
      (r.test_score !== '' && r.test_score !== 0 && r.test_score !== undefined) ||
      (r.lab_score !== '' && r.lab_score !== 0 && r.lab_score !== undefined) ||
      (r.exam_score !== '' && r.exam_score !== 0 && r.exam_score !== undefined)
    );

    const existingRows = activeCourse
      ? state.years[yearKey][sem].filter(r => r.course_id === activeCourse.id)
      : [];

    const parsed = validateImportRows(mapped, yearKey, sem, activeCourse, existingRows, hasComponentColumns, false, studentRoster.all);
    if (!parsed.valid.length) {
      alert(`No valid rows extracted. ${parsed.errors.length} row(s) have errors:\n${parsed.errors.map(e => e.errors.join('; ')).join('\n')}`);
      input.value = '';
      return;
    }

    renderImportPreview(parsed, yearKey, sem, activeCourse);
  } catch (err) {
    alert((err && err.message) || 'Failed to scan image. Please try again.');
  } finally {
    hideLoading();
    input.value = '';
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

async function pdfPageToBase64(file, pageIndex) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF processing library not loaded. Please use an image file instead.');
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/jpeg', 0.85);
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

    // Detect Test/Lab/Exam columns in the file
    const hasComponentColumns = mapped.some(r =>
      (r.test_score !== undefined && r.test_score !== null && String(r.test_score).trim() !== '') ||
      (r.lab_score !== undefined && r.lab_score !== null && String(r.lab_score).trim() !== '') ||
      (r.exam_score !== undefined && r.exam_score !== null && String(r.exam_score).trim() !== '')
    );

    // Determine if we're importing from within an active course roster
    const activeCourse = (state.activeCourse && state.activeCourse.yearKey === yearKey && state.activeCourse.sem === sem)
      ? state.courses[yearKey]?.[sem]?.find(c => c.id === state.activeCourse.courseId)
      : null;

    // Mismatch check: component columns in file but course is single-score mode
    const componentMismatch = !!(activeCourse && hasComponentColumns && !activeCourse.use_score_components);

    // Get existing rows in the open course's roster for duplicate checking
    const existingRows = activeCourse
      ? state.years[yearKey][sem].filter(r => r.course_id === activeCourse.id)
      : [];

    // Ensure student roster is loaded for mismatch checks
    if (!studentRoster.loaded) {
      await loadStudents();
    }

    const parsed = validateImportRows(mapped, yearKey, sem, activeCourse, existingRows, hasComponentColumns, componentMismatch, studentRoster.all);
    if (!parsed.valid.length && (parsed.errors.length || parsed.fileErrors.length)) {
      if (parsed.fileErrors.length) {
        alert(parsed.fileErrors.join('\n'));
      } else {
        alert(`No valid rows found. ${parsed.errors.length} row(s) have errors.`);
      }
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
         <input type="text" id="new-course-school-${yearKey}-${semSlug}" placeholder="School offering course (optional)">
         <label class="checkbox-row" style="margin-top:6px">
           <input type="checkbox" id="new-course-components-${yearKey}-${semSlug}" style="margin-right:6px">
           <span style="font-size:12px;color:var(--muted)">Use Test/Lab/Exam breakdown instead of one score</span>
         </label>
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
          <button class="btn secondary" id="scan-btn-${yearKey}-${semSlug}" onclick="document.getElementById('scan-${yearKey}-${semSlug}').click()">AI Scan Results</button>
          <input type="file" id="scan-${yearKey}-${semSlug}" accept="image/*;capture=camera,.pdf" style="display:none" onchange="handleImageScan(this, '${yearKey}', '${sem}')">
          <button class="btn gold" onclick="exportSemesterExcel('${yearKey}','${sem}')">Export to Excel</button>
          <button class="btn secondary" onclick="printSemester('${yearKey}','${sem}')">Print / PDF</button>
        </div>
      </div>

      ${addCourseFormHtml}

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
  const emptyColspan = course.use_score_components ? 13 : 10;
  let rowsHtml = '';

  if (matched.length === 0) {
    rowsHtml = `<tr class="empty-row"><td colspan="${emptyColspan}">No students added yet — add a student below or import from file.</td></tr>`;
  } else {
    matched.forEach(({ r, idx }, sn) => {
      const gi = gradeInfo(r.score);
      const carryBadge = r.isCarryover ? ' <span class="carry-badge">C/O</span>' : '';
      const hasStudentId = !!r.studentId;
      const regNoCell = hasStudentId
        ? `<td>${escHtml(r.regNo)}</td>`
        : `<td><input value="${escAttr(r.regNo)}" placeholder="Reg No" maxlength="11" inputmode="numeric" pattern="\d{11}" oninput="updateCell('${yearKey}','${sem}',${idx},'regNo',sanitizeRegNo(this.value))" onblur="validateRegNo(this)"><span class="reg-no-warn" id="regNoWarn-${yearKey}-${sem}-${idx}" style="color:var(--red);font-size:11px"></span></td>`;
      const nameCell = hasStudentId
        ? `<td>${escHtml(r.name)}</td>`
        : `<td><input value="${escAttr(r.name)}" placeholder="Student name" oninput="updateCell('${yearKey}','${sem}',${idx},'name',this.value)"></td>`;
      if (course.use_score_components) {
        const testVal = r.test_score !== undefined && r.test_score !== null && r.test_score !== '' ? escAttr(r.test_score) : '';
        const labVal = r.lab_score !== undefined && r.lab_score !== null && r.lab_score !== '' ? escAttr(r.lab_score) : '';
        const examVal = r.exam_score !== undefined && r.exam_score !== null && r.exam_score !== '' ? escAttr(r.exam_score) : '';
        const totalVal = r.score !== '' && r.score !== null && r.score !== undefined ? escAttr(r.score) : '';
        rowsHtml += `
          <tr>
            <td class="sn-cell">${sn + 1}</td>
            ${regNoCell}
            ${nameCell}
            <td><input value="${escAttr(r.remark)}" placeholder="Remark" oninput="updateCell('${yearKey}','${sem}',${idx},'remark',this.value)"></td>
            <td class="narrow"><input type="number" value="${testVal}" placeholder="Test" min="0" oninput="updateComponent('${yearKey}','${sem}',${idx},'test_score',this.value)"></td>
            <td class="narrow"><input type="number" value="${labVal}" placeholder="Lab" min="0" oninput="updateComponent('${yearKey}','${sem}',${idx},'lab_score',this.value)"></td>
            <td class="narrow"><input type="number" value="${examVal}" placeholder="Exam" min="0" oninput="updateComponent('${yearKey}','${sem}',${idx},'exam_score',this.value)"></td>
            <td class="narrow"><input type="number" value="${totalVal}" placeholder="Total" readonly style="background:var(--line-soft);color:var(--ink)" id="total-${yearKey}-${sem}-${idx}"></td>
            <td class="grade-cell grade-${gi.grade}" id="grade-${yearKey}-${sem}-${idx}">${gi.grade}</td>
            <td class="point-cell" id="point-${yearKey}-${sem}-${idx}">${gi.point === null ? '' : gi.point}</td>
            <td class="narrow" style="text-align:center">${gi.grade === 'F' ? `<input type="checkbox" ${r.isCarryover ? 'checked' : ''} onchange="updateCarryover('${yearKey}','${sem}',${idx},this.checked)" title="Carry-over retit">` : ''}</td>
            <td><span id="score-warn-${yearKey}-${sem}-${idx}" style="color:var(--red);font-size:11px"></span></td>
            <td><button class="icon-btn" title="Delete row" onclick="deleteRow('${yearKey}','${sem}',${idx})">&#10005;</button></td>
          </tr>
        `;
      } else {
        rowsHtml += `
          <tr>
            <td class="sn-cell">${sn + 1}</td>
            ${regNoCell}
            ${nameCell}
            <td><input value="${escAttr(r.remark)}" placeholder="Remark" oninput="updateCell('${yearKey}','${sem}',${idx},'remark',this.value)"></td>
            <td class="narrow"><input type="number" value="${escAttr(r.score)}" placeholder="Score" oninput="updateScore('${yearKey}','${sem}',${idx},this.value)"></td>
            <td class="grade-cell grade-${gi.grade}" id="grade-${yearKey}-${sem}-${idx}">${gi.grade}</td>
            <td class="point-cell" id="point-${yearKey}-${sem}-${idx}">${gi.point === null ? '' : gi.point}</td>
            <td class="narrow" style="text-align:center">${gi.grade === 'F' ? `<input type="checkbox" ${r.isCarryover ? 'checked' : ''} onchange="updateCarryover('${yearKey}','${sem}',${idx},this.checked)" title="Carry-over retit">` : ''}</td>
            <td><span id="score-warn-${yearKey}-${sem}-${idx}" style="color:var(--red);font-size:11px"></span></td>
            <td><button class="icon-btn" title="Delete row" onclick="deleteRow('${yearKey}','${sem}',${idx})">&#10005;</button></td>
          </tr>
        `;
      }
    });
  }

  const rosterId = `roster-${course.id}`;
  return `
    <div class="semester" id="${rosterId}">
      <div class="semester-head">
        <h3>${sem}</h3>
         <div class="toolbar">
            <button class="btn gold" onclick="showAddStudentModal('${yearKey}','${sem}',false)">+ Add student to course</button>
            <button class="btn secondary" onclick="showAddStudentModal('${yearKey}','${sem}',true)">Add carry-over student</button>
            <button class="btn secondary" onclick="document.getElementById('import-${yearKey}-${semSlug}').click()">Import from file</button>
            <input type="file" id="import-${yearKey}-${semSlug}" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleImportFile(this, '${yearKey}', '${sem}')">
            <button class="btn secondary" id="scan-btn-${course.id}" onclick="document.getElementById('scan-${course.id}').click()">AI Scan Results</button>
            <input type="file" id="scan-${course.id}" accept="image/*;capture=camera,.pdf" style="display:none" onchange="handleImageScan(this, '${yearKey}', '${sem}')">
            <label class="checkbox-row" style="display:inline-flex;align-items:center;font-size:12px;color:var(--muted)" onclick="toggleCourseMode('${course.id}', event)">
            <input type="checkbox" id="mode-toggle-${course.id}" ${course.use_score_components ? 'checked' : ''} style="margin-right:4px">Use Test/Lab/Exam breakdown</label>
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

      <div class="table-scroll">
      <table class="course-table">
        <thead>
          <tr>
            <th style="width:4%">S/N</th>
            <th style="width:12%">Reg No</th>
            <th style="width:18%">Student Name</th>
            <th style="width:10%">Remark</th>
            ${course.use_score_components
              ? `<th style="width:6%">Test</th><th style="width:6%">Lab</th><th style="width:6%">Exam</th><th style="width:6%">Total</th>`
              : `<th style="width:8%">Score</th>`}
            <th style="width:6%">Grade</th>
            <th style="width:6%">Point</th>
            <th style="width:6%">C/O</th>
            <th style="width:8%"></th>
            <th style="width:16%"></th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      </div>
    </div>
  `;
}

function closeCourseRoster() {
  state.activeCourse = null;
  render();
}

async function toggleCourseMode(courseId, event) {
  event && event.stopPropagation();
  const cb = event && event.target ? event.target : document.getElementById(`mode-toggle-${courseId}`);
  if (!cb) return;
  const newMode = !cb.checked;
  cb.checked = !newMode; // revert visually until confirmed

  // Find the course in state and update
  let courseObj = null;
  for (const yearKey of YEAR_KEYS) {
    for (const sem of SEMESTERS) {
      const courseList = state.courses[yearKey]?.[sem] || [];
      const c = courseList.find(c => c.id === courseId);
      if (c) { courseObj = c; break; }
    }
    if (courseObj) break;
  }
  if (!courseObj) return;

  const wasUsingComponents = !!courseObj.use_score_components;
  const confirmed = confirm(
    wasUsingComponents
      ? 'Switch to single-score mode? Existing Test/Lab/Exam values stay in the database but will no longer be used for entry. Scores are preserved.'
      : 'Switch to Test/Lab/Exam breakdown mode? Existing scores are preserved as-is; component fields start blank until you fill them in.'
  );
  if (!confirmed) {
    cb.checked = wasUsingComponents;
    return;
  }
  cb.checked = !wasUsingComponents;

  courseObj.use_score_components = !wasUsingComponents;

  // Persist to backend
  if (currentUser && accessToken) {
    try {
      await apiFetch(`/api/courses/${encodeURIComponent(courseId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ use_score_components: courseObj.use_score_components })
      });
    } catch (err) {
      console.error('Failed to update course mode:', err.message);
      // Revert on failure
      courseObj.use_score_components = wasUsingComponents;
      cb.checked = wasUsingComponents;
    }
  }

  saveToLocalStorage();
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
  const schoolInput = document.getElementById(`new-course-school-${yearKey}-${semSlug}`);
  const componentsInput = document.getElementById(`new-course-components-${yearKey}-${semSlug}`);

  if (!codeInput) return;

  const course_code = codeInput.value.trim().toUpperCase();
  const course_title = titleInput ? titleInput.value.trim() : '';
  const credit_unit = unitInput && unitInput.value.trim() ? parseFloat(unitInput.value.trim()) : null;
  const offering_school = schoolInput ? schoolInput.value.trim() : '';
  const use_score_components = componentsInput ? !!componentsInput.checked : false;

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
        credit_unit,
        offering_school,
        use_score_components
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
      offering_school: data.offering_school || '',
      use_score_components: !!data.use_score_components,
      studentCount: 0
    });
    saveToLocalStorage();

    // Clear inputs
    codeInput.value = '';
    if (titleInput) titleInput.value = '';
    if (unitInput) unitInput.value = '';
    if (schoolInput) schoolInput.value = '';
    if (componentsInput) componentsInput.checked = false;

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

/* ===================== ADD STUDENT TO COURSE ===================== */
const studentSearchState = { select: null, modal: null };

function showAddStudentModal(yearKey, sem, isCarryover) {
  if (!state.activeCourse || state.activeCourse.yearKey !== yearKey || state.activeCourse.sem !== sem) return;

  const course = (state.courses[yearKey]?.[sem] || []).find(c => c.id === state.activeCourse.courseId);
  const modeLabel = isCarryover ? 'Add carry-over student' : 'Add student to course';

  const overlay = document.createElement('div');
  overlay.className = 'student-search-overlay';
  overlay.innerHTML = `
    <div class="student-search-modal">
      <h3>${escHtml(modeLabel)} — ${escHtml(course?.course_code || '')}</h3>
      <p class="student-search-note">Search for a student by registration number or name.</p>
      <div id="addStudentRegNoContainer"></div>
      <div id="addStudentNameDisplay" style="margin:12px 0;font-weight:600;color:var(--ink)"></div>
      <div class="student-search-actions">
        <button class="btn gold" id="confirmAddStudentBtn" disabled>Add to course</button>
        <button class="btn secondary" id="cancelAddStudentBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const regNoContainer = document.getElementById('addStudentRegNoContainer');
  studentSearchState.select = createSearchableSelect(regNoContainer, {
    inputId: 'addStudentRegNo',
    placeholder: 'Search by Reg No or name…',
    optionLabel: 'full_name',
    optionSublabel: 'reg_no',
    options: [],
    defaultValue: '',
    asyncProvider: async (term) => {
      const results = await loadStudents(term);
      return results;
    },
    onOptionSelect: (student) => {
      document.getElementById('addStudentNameDisplay').textContent = `${student.full_name || ''} (${student.reg_no || ''})`;
      studentSearchState.selectedStudent = student;
      const confirmBtn = document.getElementById('confirmAddStudentBtn');
      if (confirmBtn) confirmBtn.disabled = false;
    },
    onNoMatchCreate: async (regNo) => {
      createNewStudentFromRegNo(regNo, yearKey, sem, isCarryover, overlay);
    },
    onInputClear: () => {
      studentSearchState.selectedStudent = null;
      const display = document.getElementById('addStudentNameDisplay');
      if (display) display.textContent = '';
      const confirmBtn = document.getElementById('confirmAddStudentBtn');
      if (confirmBtn) confirmBtn.disabled = true;
    }
  });

  studentSearchState.modal = overlay;
  studentSearchState.selectedStudent = null;
  studentSearchState.isCarryover = isCarryover;
  studentSearchState.yearKey = yearKey;
  studentSearchState.sem = sem;

  document.getElementById('cancelAddStudentBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('confirmAddStudentBtn').addEventListener('click', () => {
    const student = studentSearchState.selectedStudent;
    if (!student) return;
    addStudentResultRow(student, yearKey, sem, isCarryover);
    overlay.remove();
  });
}

function createNewStudentFromRegNo(regNo, yearKey, sem, isCarryover, overlay) {
  const regNoTrimmed = regNo.trim();
  if (!/^\d{11}$/.test(regNoTrimmed)) {
    alert('Registration number must be exactly 11 digits.');
    return;
  }

  const name = prompt(`Enter the full name for Reg No ${regNoTrimmed}:`);
  if (!name || !name.trim()) {
    alert('Full name is required to create a new student.');
    return;
  }

  const program = prompt(`Enter the program for ${name.trim()} (optional — press Cancel to skip):`) || '';

  showLoading('Adding student to roster…');
  createStudent(regNoTrimmed, name.trim(), program.trim())
    .then(student => {
      hideLoading();
      addStudentResultRow(student, yearKey, sem, isCarryover);
      if (overlay) overlay.remove();
      studentRoster.loaded = false;
    })
    .catch(err => {
      hideLoading();
      console.error('Failed to create student:', err.message);
      alert('Failed to create student. ' + err.message);
    });
}

function addStudentResultRow(student, yearKey, sem, isCarryover) {
  const row = emptyRow();
  row.regNo = student.reg_no || '';
  row.name = student.full_name || '';
  row.studentId = student.id;
  row.program = student.program || '';

  // Pre-fill course metadata from the active course
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

  if (isCarryover) {
    row.isCarryover = true;
  }

  state.years[yearKey][sem].push(row);
  saveToLocalStorage();
  // Save remotely if signed in
  if (currentUser && accessToken && row.id === null) {
    scheduleSave(yearKey, sem, state.years[yearKey][sem].length - 1);
  }
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

/* ===================== EXCEL METADATA BLOCK ===================== */

const EXCEL_MIN_WIDTHS = {
  'Student Name': 28, 'Name': 28, 'Full Name': 28,
  'Reg No': 16,
  'Course Code': 12, 'Code': 12,
  'Course Title': 22, 'Title': 22,
  'Program': 22, 'Remark': 22, 'Remarks': 22,
  'Unit': 12, 'Credit Unit': 12,
  'Score': 10, 'Test': 10, 'Lab': 10, 'Exam': 10, 'Total': 10,
  'Grade': 12,
  'Grade Point': 12, 'Point': 12,
  'Carry-over': 12, 'C/O': 12,
  'S/N': 8,
  'Session': 14, 'Year': 10,
  'Semester': 18
};

const EXCEL_DEFAULT_MIN_WIDTH = 10;

function excelGetMinWidth(header) {
  return EXCEL_MIN_WIDTHS[header] || EXCEL_DEFAULT_MIN_WIDTH;
}

/* Writes a two-column label:value metadata block followed by a blank
   spacer row. Returns the row number of the data table header.

   Layout:
     Row 1   : "FEDERAL UNIVERSITY OF TECHNOLOGY, OWERRI" (merged, bold, centered)
     Row 2   : documentTitle (merged, bold, centered)
     Row 3   : School of Student: <faculty>  |  Semester: <semester>
     Row 4   : Department: <department>      |  Session: <session>  (+ Date for non-course-scoped)
     Row 5-6 : (course-scoped only)
     Last    : blank spacer row
     Return  : row after spacer (data header row)
*/
function excelWriteMetadataBlock(sheet, opts) {
  const {
    colCount,
    documentTitle,
    faculty,
    department,
    semester,
    session,
    isCourseScoped,
    courseTitle,
    courseCode,
    creditUnit,
    offeringSchool,
    exportDate
  } = opts;

  let row = 1;
  const exportDateStr = exportDate || new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  // Row 1: University name (merged across full width)
  excelMergeHeader(sheet, row, colCount, 'FEDERAL UNIVERSITY OF TECHNOLOGY, OWERRI', { font: { bold: true, size: 14 } });
  sheet.getRow(row).height = 40;
  row++;

  // Row 2: Document title (merged)
  excelMergeHeader(sheet, row, colCount, documentTitle, { font: { bold: true, size: 13 } });
  sheet.getRow(row).height = 28;
  row++;

  // Row 3: School of Student | Semester
  var r3 = sheet.getRow(row);
  r3.getCell(1).value = 'School of Student:';
  r3.getCell(2).value = faculty || '';
  r3.getCell(3).value = 'Semester:';
  r3.getCell(4).value = semester || '';
  [1, 3].forEach(c => { r3.getCell(c).font = { bold: true }; });
  sheet.getRow(row).height = 22;
  row++;

  // Row 4: Department | Session (+ Date for non-course-scoped)
  var r4 = sheet.getRow(row);
  r4.getCell(1).value = 'Department:';
  r4.getCell(2).value = department || '';
  r4.getCell(3).value = 'Session:';
  r4.getCell(4).value = session || '';
  if (!isCourseScoped) {
    r4.getCell(5).value = 'Date:';
    r4.getCell(6).value = exportDateStr;
    r4.getCell(5).font = { bold: true };
  }
  [1, 3].forEach(c => { r4.getCell(c).font = { bold: true }; });
  sheet.getRow(row).height = 22;
  row++;

  if (isCourseScoped) {
    // Row 5: Title of Course | Course Code | Units
    var r5 = sheet.getRow(row);
    r5.getCell(1).value = 'Title of Course:';
    r5.getCell(2).value = courseTitle || '';
    r5.getCell(3).value = 'Course Code:';
    r5.getCell(4).value = courseCode || '';
    r5.getCell(5).value = 'Units:';
    r5.getCell(6).value = creditUnit !== undefined && creditUnit !== null && creditUnit !== '' ? creditUnit : '';
    [1, 3, 5].forEach(c => { r5.getCell(c).font = { bold: true }; });
    sheet.getRow(row).height = 22;
    row++;

    // Row 6: School Offering Course | Date
    var r6 = sheet.getRow(row);
    r6.getCell(1).value = 'School Offering Course:';
    r6.getCell(2).value = offeringSchool || '';
    r6.getCell(3).value = 'Date:';
    r6.getCell(4).value = exportDateStr;
    [1, 3].forEach(c => { r6.getCell(c).font = { bold: true }; });
    sheet.getRow(row).height = 22;
    row++;
  }

  // Blank spacer row
  sheet.getRow(row).height = 14;
  row++;

  return row;
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

function excelContentWidths(headers, dataRows, useMinWidths) {
  const widths = headers.map(h => {
    const len = String(h === undefined || h === null ? '' : h).length;
    const base = Math.min(Math.max(len + 3, 8), 50);
    return useMinWidths ? Math.max(base, excelGetMinWidth(h)) : base;
  });
  if (dataRows) {
    dataRows.forEach(rowValues => {
      for (let i = 0; i < headers.length; i++) {
        const val = rowValues[i];
        if (val !== undefined && val !== null && val !== '') {
          const len = String(val).length;
          const computed = Math.min(len + 3, 50);
          if (useMinWidths) {
            widths[i] = Math.max(widths[i], Math.max(computed, excelGetMinWidth(headers[i])));
          } else if (len + 3 > widths[i]) {
            widths[i] = computed;
          }
        }
      }
    });
  }
  // Clip to max 60 for generous layout
  return widths.map(w => Math.min(w, 60));
}

function excelSetWidths(sheet, widths) {
  widths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w; });
}

function excelApplyMetadataWidths(widths, colCount) {
  // The metadata block writes label:value pairs in the first 6 columns.
  // Ensure those columns are wide enough for the longest metadata labels.
  const metaMins = [21, 20, 15, 16, 15, 26];
  for (let i = 0; i < Math.min(metaMins.length, widths.length); i++) {
    widths[i] = Math.max(widths[i], metaMins[i]);
  }
  return widths;
}

function excelAddLogosToSheet(workbook, sheet, colCount, logoBuffer) {
  if (!logoBuffer) return;
  try {
    const imageId = workbook.addImage({ buffer: logoBuffer, extension: 'jpg' });
    const logoSize = 32;
    const rightCol = Math.max(colCount - 0.3, 0.7);
    sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: logoSize, height: logoSize } });
    sheet.addImage(imageId, { tl: { col: rightCol, row: 0.1 }, ext: { width: logoSize, height: logoSize } });
  } catch (e) {
    console.error('Failed to embed logo in Excel:', e);
  }
}

async function excelAddLogos(workbook, sheet, colCount) {
  const logoBuffer = await getLogoBuffer();
  excelAddLogosToSheet(workbook, sheet, colCount, logoBuffer);
}

function excelSetRowHeights(sheet, headerRowNum, dataCount, headerHeight, dataHeight) {
  sheet.getRow(headerRowNum).height = headerHeight;
  for (let r = headerRowNum + 1; r <= headerRowNum + dataCount; r++) {
    sheet.getRow(r).height = dataHeight;
  }
}

function excelShouldIncludeProgramData(rows) {
  return (rows || []).some(r => (resolveProgram(r) || '').trim() !== '' || (r.remark || '').trim() !== '');
}

async function exportCourseExcel(courseId, courseCode, yearKey, sem) {
  const rows = getCourseRows(courseId);
  if (!rows || !rows.length) {
    alert('No student rows to export for this course.');
    return;
  }

  showLoading('Exporting to Excel…');
  try {
  const safeCode = courseCode.replace(/[:\\\/\?\*\[\]]/g, '');
  const safeYear = yearKey.replace(/[:\\\/\?\*\[\]]/g, '');
  const safeSem = sem.replace(/[:\\\/\?\*\[\]]/g, '');
  const session = state.academicSessions[yearKey] || '';

  const course = findCourseById(courseId) || { course_code: courseCode, course_title: '', credit_unit: '', offering_school: '', use_score_components: false };
  const useComponents = !!course.use_score_components;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(safeSem || 'Sheet1');

  const sortedRows = rows.slice().sort((a, b) => {
    const nameA = (a.name || '').trim().toLowerCase();
    const nameB = (b.name || '').trim().toLowerCase();
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
  });

  // Build headers: S/N | Full Name | Reg No | [Program] | <Score or Test|Lab|Exam|Total> | Grade | [Remark]
  const includeProgram = (sortedRows || []).some(r => (resolveProgram(r) || '').trim() !== '');
  const includeRemark = (sortedRows || []).some(r => (r.remark || '').trim() !== '');
  const headers = ['S/N', 'Full Name', 'Reg No'];
  if (includeProgram) headers.push('Program');
  if (useComponents) {
    headers.push('Test', 'Lab', 'Exam', 'Total');
  } else {
    headers.push('Score');
  }
  headers.push('Grade');
  if (includeRemark) headers.push('Remark');
  const colCount = headers.length;

  // Metadata block (course-scoped)
  const headerRowNum = excelWriteMetadataBlock(sheet, {
    colCount,
    documentTitle: 'OFFICIAL RESULT SHEET',
    faculty: state.meta.school,
    department: state.meta.department,
    semester: sem,
    session: session,
    isCourseScoped: true,
    courseTitle: course.course_title || '',
    courseCode: courseCode,
    creditUnit: course.credit_unit,
    offeringSchool: course.offering_school || '',
    exportDate: new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  });

  await excelAddLogos(workbook, sheet, colCount);

  // Header row
  excelHeaderRow(sheet, headerRowNum, headers);

  // Data rows
  const dataRowsForWidth = [];
  sortedRows.forEach((r, idx) => {
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const gi = gradeInfo(r.score);
    let col = 1;
    excelRow.getCell(col++).value = idx + 1;
    excelRow.getCell(col++).value = r.name;
    excelRow.getCell(col++).value = r.regNo;
    if (includeProgram) {
       excelRow.getCell(col++).value = resolveProgram(r) || '';
    }
    if (useComponents) {
      excelRow.getCell(col++).value = r.test_score !== '' && r.test_score !== null && r.test_score !== undefined ? parseFloat(r.test_score) : null;
      excelRow.getCell(col++).value = r.lab_score !== '' && r.lab_score !== null && r.lab_score !== undefined ? parseFloat(r.lab_score) : null;
      excelRow.getCell(col++).value = r.exam_score !== '' && r.exam_score !== null && r.exam_score !== undefined ? parseFloat(r.exam_score) : null;
      excelRow.getCell(col++).value = r.score === '' ? null : parseFloat(r.score);
    } else {
      excelRow.getCell(col++).value = r.score === '' ? null : parseFloat(r.score);
    }
    excelRow.getCell(col++).value = gi.grade || '';
    if (includeRemark) {
      excelRow.getCell(col++).value = r.remark || '';
    }
    excelStyleDataRow(excelRow, colCount);
    const rowData = [idx + 1, r.name, r.regNo];
    if (includeProgram) rowData.push(resolveProgram(r) || '');
    if (useComponents) {
      rowData.push(
        r.test_score !== '' && r.test_score !== null && r.test_score !== undefined ? parseFloat(r.test_score) : null,
        r.lab_score !== '' && r.lab_score !== null && r.lab_score !== undefined ? parseFloat(r.lab_score) : null,
        r.exam_score !== '' && r.exam_score !== null && r.exam_score !== undefined ? parseFloat(r.exam_score) : null,
        r.score === '' ? null : parseFloat(r.score)
      );
    } else {
      rowData.push(r.score === '' ? null : parseFloat(r.score));
    }
    rowData.push(gi.grade || '');
    if (includeRemark) rowData.push(r.remark || '');
    dataRowsForWidth.push(rowData);
  });

  // Generous column widths with metadata label minimums
  const colWidths = excelApplyMetadataWidths(excelContentWidths(headers, dataRowsForWidth, true), colCount);
  excelSetWidths(sheet, colWidths);

  // Row heights (only for table header + data rows, not metadata)
  excelSetRowHeights(sheet, headerRowNum, sortedRows.length, 24, 16);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeCode} - ${safeYear} - ${safeSem}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  } finally {
    hideLoading();
  }
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

  const useComponents = !!course.use_score_components;
  let tableRows = '';
  sortedRows.forEach((r, i) => {
    const gi = gradeInfo(r.score);
    const carryBadge = r.isCarryover ? ' <span class="carry-badge">C/O</span>' : '';
    if (useComponents) {
      const testVal = r.test_score !== '' && r.test_score !== null && r.test_score !== undefined ? r.test_score : '';
      const labVal = r.lab_score !== '' && r.lab_score !== null && r.lab_score !== undefined ? r.lab_score : '';
      const examVal = r.exam_score !== '' && r.exam_score !== null && r.exam_score !== undefined ? r.exam_score : '';
      tableRows += `
        <tr>
          <td style="text-align:center">${i + 1}</td>
          <td>${escHtml(r.regNo)}</td>
          <td>${escHtml(r.name)}</td>
          <td style="text-align:center">${escHtml(testVal)}</td>
          <td style="text-align:center">${escHtml(labVal)}</td>
          <td style="text-align:center">${escHtml(examVal)}</td>
          <td style="text-align:center;font-weight:600">${escHtml(r.score)}</td>
          <td style="text-align:center">${gi.grade}</td>
          <td style="text-align:center">${gi.point === null ? '' : gi.point}</td>
          <td style="text-align:center">${carryBadge}</td>
        </tr>
      `;
    } else {
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
    }
  });

  let printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) return;

  const base = new URL('.', window.location.href).href.replace(/\/$/, '');
  const logoUrl = base + '/assets/futo-logo.jpeg';

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
          <img src="${logoUrl}" class="logo" alt="FUTO Logo">
          <div class="center">
            <h2>FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI</h2>
            <p>${escHtml(state.meta.school)}</p>
            <p>${escHtml(state.meta.department)}</p>
            <div class="title-row">${escHtml(`${course.course_code} — ${course.course_title || ''} — ${course.yearKey}`)}</div>
            ${session ? `<p style="font-size:12px;color:#6B7168;font-style:italic">${escHtml(session)} SESSION</p>` : ''}
          </div>
          <img src="${logoUrl}" class="logo" alt="FUTO Logo">
        </div>
        <table>
          <thead>
            <tr>
              <th style="width:5%">S/N</th>
              <th style="width:18%">Reg No</th>
              <th style="width:26%">Student Name</th>
              ${useComponents
                ? `<th style="width:6%">Test</th><th style="width:6%">Lab</th><th style="width:6%">Exam</th><th style="width:7%">Total</th>`
                : `<th style="width:12%">Score</th>`}
              <th style="width:8%">Grade</th>
              <th style="width:6%">Point</th>
              <th style="width:4%">C/O</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `);

  printWindow.document.close();
  printWindow.focus();

  const images = Array.from(printWindow.document.images);
  if (images.length > 0) {
    let loaded = 0;
    const total = images.length;
    images.forEach(img => {
      if (img.complete) {
        loaded++;
        if (loaded === total) {
          printWindow.print();
          printWindow.close();
        }
      } else {
        img.onload = () => {
          loaded++;
          if (loaded === total) {
            printWindow.print();
            printWindow.close();
          }
        };
        img.onerror = () => {
          loaded++;
          if (loaded === total) {
            printWindow.print();
            printWindow.close();
          }
        };
      }
    });
  } else {
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 500);
  }
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

/* ===================== ROW EDITING ===================== */
function updateCell(yearKey, sem, idx, field, value) {
  state.years[yearKey][sem][idx][field] = value;
  saveToLocalStorage();
  scheduleSave(yearKey, sem, idx);
}

function updateCarryoverCell(yearKey, sem, idx, grade) {
  const gradeCell = document.getElementById(`grade-${yearKey}-${sem}-${idx}`);
  if (!gradeCell) return;
  const row = gradeCell.closest('tr');
  if (!row) return;
  const checkboxCell = row.querySelector('td.narrow[style*="text-align:center"]');
  if (!checkboxCell) return;
  if (grade === 'F') {
    const rowData = state.years[yearKey]?.[sem]?.[idx];
    if (!rowData) return;
    checkboxCell.innerHTML = `<input type="checkbox" ${rowData.isCarryover ? 'checked' : ''} onchange="updateCarryover('${yearKey}','${sem}',${idx},this.checked)" title="Carry-over retit">`;
  } else {
    checkboxCell.innerHTML = '';
  }
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
  const wasCarryover = row.isCarryover;
  if (gi.grade !== 'F' && wasCarryover) {
    row.isCarryover = false;
  }
  const gradeCell = document.getElementById(`grade-${yearKey}-${sem}-${idx}`);
  const pointCell = document.getElementById(`point-${yearKey}-${sem}-${idx}`);
  if (gradeCell) { gradeCell.textContent = gi.grade; gradeCell.className = 'grade-cell grade-' + gi.grade; }
  if (pointCell) { pointCell.textContent = gi.point === null ? '' : gi.point; }
  updateCarryoverCell(yearKey, sem, idx, gi.grade);
  saveToLocalStorage();
  scheduleSave(yearKey, sem, idx);
}

function updateComponent(yearKey, sem, idx, field, value) {
  const row = state.years[yearKey][sem][idx];
  const warn = document.getElementById(`score-warn-${yearKey}-${sem}-${idx}`);

  const num = parseFloat(value);
  if (value !== '' && (isNaN(num) || num < 0)) {
    if (warn) { warn.textContent = 'Component must be 0 or greater.'; warn.style.color = 'var(--red)'; }
    return;
  }
  if (warn) { warn.textContent = ''; }

  row[field] = value === '' ? '' : String(num);

  const testVal = row.test_score !== '' && row.test_score !== undefined ? parseFloat(row.test_score) : 0;
  const labVal = row.lab_score !== '' && row.lab_score !== undefined ? parseFloat(row.lab_score) : 0;
  const examVal = row.exam_score !== '' && row.exam_score !== undefined ? parseFloat(row.exam_score) : 0;
  const total = testVal + labVal + examVal;

  // Preserve existing score when no components have been entered yet (mode-switch edge case)
  const hasAnyComponent = row.test_score !== '' || row.lab_score !== '' || row.exam_score !== '';
  if (hasAnyComponent) {
    row.score = total > 0 ? String(total) : '';
    if (total > 100) {
      if (warn) { warn.textContent = 'Total score must be 0–100.'; warn.style.color = 'var(--red)'; }
    }
  } else {
    // Leave existing score untouched (from mode switch or fresh row)
  }

  const totalCell = document.getElementById(`total-${yearKey}-${sem}-${idx}`);
  if (totalCell) totalCell.value = row.score !== '' ? String(row.score) : '';

  const gi = gradeInfo(row.score === '' ? '' : row.score);
  const wasCarryover = row.isCarryover;
  if (gi.grade !== 'F' && wasCarryover) {
    row.isCarryover = false;
  }
  const gradeCell = document.getElementById(`grade-${yearKey}-${sem}-${idx}`);
  const pointCell = document.getElementById(`point-${yearKey}-${sem}-${idx}`);
  if (gradeCell) { gradeCell.textContent = gi.grade; gradeCell.className = 'grade-cell grade-' + gi.grade; }
  if (pointCell) { pointCell.textContent = gi.point === null ? '' : gi.point; }
  updateCarryoverCell(yearKey, sem, idx, gi.grade);

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
      await loadStudents();
      render();
    }
  }
}

async function saveRowRemote(yearKey, sem, idx) {
   if (!currentUser || !accessToken) return;
   const row = state.years[yearKey][sem][idx];
   if (!row) return;
       if (!row.regNo && !row.name && !row.code && !row.title && !row.unit && !row.score && !row.test_score && !row.lab_score && !row.exam_score && !row.studentId) return;

  // Skip saving while the reg_no is still being typed (partial entry).
  // The server enforces 11-digit format; sending a partial value only
  // produces an avoidable 400 round-trip.  Once the user finishes typing,
  // the next debounced save will carry the complete 11-digit value.
  const regNoTrimmed = (row.regNo || '').trim();
  if (regNoTrimmed && regNoTrimmed.length !== 11) return;

   // Client-side duplicate check: scoped to the currently-open course only.
   // Compare by object identity (r !== row) so the row being saved is never
   // compared against itself.  Using index-based exclusion (i !== idx) would
   // be wrong here because `i` is the position inside the *filtered* array,
   // while `idx` is the position in the full semester array — they only
   // coincide by accident when every row belongs to the same course.
   if (state.activeCourse && state.activeCourse.yearKey === yearKey && state.activeCourse.sem === sem && row.course_id) {
     const courseRows = state.years[yearKey][sem].filter(r => r.course_id === row.course_id);
     const isDuplicate = courseRows.some(r => r !== row && (r.regNo || '').trim() === (row.regNo || '').trim() && (r.regNo || '').trim() !== '');
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
    score: row.score === '' ? null : (isNaN(parseFloat(row.score)) ? null : parseFloat(row.score)),
    test_score: row.test_score === '' ? null : (row.test_score !== undefined && row.test_score !== null ? parseFloat(row.test_score) : null),
    lab_score: row.lab_score === '' ? null : (row.lab_score !== undefined && row.lab_score !== null ? parseFloat(row.lab_score) : null),
    exam_score: row.exam_score === '' ? null : (row.exam_score !== undefined && row.exam_score !== null ? parseFloat(row.exam_score) : null),
    is_carryover: !!row.isCarryover,
    course_id: row.course_id || null,
    student_id: row.studentId || null,
    program: row.program || null,
    remark: row.remark || null
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
        test_score: row.test_score ?? '',
        lab_score: row.lab_score ?? '',
        exam_score: row.exam_score ?? '',
        isCarryover: !!row.is_carryover,
        course_id: row.course_id || null,
        studentId: row.student_id || null,
        program: row.program || '',
        remark: row.remark || ''
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
        offering_school: c.offering_school || '',
        use_score_components: !!c.use_score_components,
        studentCount: c.studentCount || 0
      });
    });
  } catch (err) {
    console.error('Courses load failed:', err.message);
  }
}

/* ===================== STUDENT ROSTER ===================== */
let studentRoster = { all: [], loaded: false };
let realtimeChannels = [];

async function loadStudents(search) {
  try {
    const url = search
      ? `/api/students?search=${encodeURIComponent(search)}`
      : '/api/students';
    const data = await apiFetch(url);
    studentRoster.all = data || [];
    studentRoster.loaded = true;
    return data || [];
  } catch (err) {
    console.error('Students load failed:', err.message);
    return [];
  }
}

async function lookupStudentByRegNo(regNo) {
  try {
    const data = await apiFetch(`/api/students/reg/${encodeURIComponent(regNo)}`);
    return data;
  } catch (err) {
    return null;
  }
}

async function createStudent(regNo, fullName, program) {
  return await apiFetch('/api/students', {
    method: 'POST',
    body: JSON.stringify({ reg_no: regNo, full_name: fullName, program: program || null })
  });
}

/* ===================== REALTIME ===================== */
function setupRealtimeSubscriptions() {
  if (!supabaseClient) return;

  teardownRealtimeSubscriptions();

  const tables = ['students', 'results', 'courses', 'adviser_settings', 'academic_sessions'];

  tables.forEach(table => {
    const channel = supabaseClient.channel(`public:${table}:*`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        handleRealtimeChange(table, payload);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIPTION_ERROR') {
          console.warn(`Realtime subscription error for ${table}`);
        }
      });

    realtimeChannels.push(channel);
  });
}

function teardownRealtimeSubscriptions() {
  realtimeChannels.forEach(ch => {
    try { supabaseClient.removeChannel(ch); } catch { }
  });
  realtimeChannels = [];
}

function handleRealtimeChange(table, payload) {
  const current = state.currentView;

  switch (table) {
    case 'students':
      if (current === 'Settings') {
        refreshClassRoster();
      }
      if (current === 'Dashboard') {
        loadDashboardData();
      }
      break;
    case 'results':
      if (current === 'Dashboard') {
        loadDashboardData();
      }
      if (YEAR_KEYS.includes(current)) {
        loadFromApi();
      }
      break;
    case 'courses':
      if (current === 'Dashboard') {
        loadDashboardData();
      }
      loadCourses();
      break;
    case 'adviser_settings':
      loadSettings();
      break;
    case 'academic_sessions':
      loadSettings();
      break;
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
      status.style.display = 'none';
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
      // Reveal the app now that the session is confirmed
      const gate = document.getElementById('appLoadingGate');
      if (gate) gate.style.display = 'none';
      const app = document.getElementById('app');
      if (app) app.style.display = '';
      updateSyncUI();
      showLoading('Loading your results…');
      try {
        await loadFromApi();
        await loadCourses();
        await loadStudents();
        await loadSettings();
      } finally {
        hideLoading();
      }
      switchView('Dashboard');
      setupRealtimeSubscriptions();
      window.addEventListener('online', () => {
        updateSyncUI();
        replayOfflineQueue();
      });
      window.addEventListener('offline', updateSyncUI);
    } else {
      window.location.href = 'login.html';
    }
  } else {
    window.location.href = 'login.html';
  }
}

async function signOut() {
  teardownRealtimeSubscriptions();
  if (supabaseClient) await supabaseClient.auth.signOut();
  window.location.href = 'login.html';
}

/* ===================== DASHBOARD VIEW ===================== */
let dashboardState = { year: 'all', semester: 'all' };
let dashboardCharts = {};

function renderDashboardView() {
  return renderDashboardContent();
}

function renderDashboardContent() {
  const yearOptions = YEAR_KEYS.map(y => `<option value="${y}">${y}</option>`).join('');
  const semesterOptions = SEMESTERS.map(s => `<option value="${escAttr(s)}">${escHtml(s)}</option>`).join('');
  const sessionLabel = state.academicSessions[dashboardState.year] || '';

  return renderLetterhead('DASHBOARD', sessionLabel) + `
    <div class="dashboard-view">
      <div class="dashboard-filters">
        <div class="dashboard-year-filter">
          <label for="dashboardYear">Filter by Year</label>
          <select id="dashboardYear">
            <option value="all">All Years</option>
            ${yearOptions}
          </select>
        </div>
        <div class="dashboard-year-filter">
          <label for="dashboardSemester">Filter by Semester</label>
          <select id="dashboardSemester">
            <option value="all">All Semesters</option>
            ${semesterOptions}
          </select>
        </div>
      </div>

       <div class="dashboard-kpi-row">
         <div class="kpi-card">
           <div class="kpi-value" id="kpiTotalStudents">0</div>
           <div class="kpi-label">Total Students Tracked</div>
         </div>
         <div class="kpi-card">
           <div class="kpi-value" id="kpiRosterCount">0</div>
           <div class="kpi-label">Students in Roster</div>
         </div>
         <div class="kpi-card">
           <div class="kpi-value" id="kpiTotalCourses">0</div>
           <div class="kpi-label">Total Courses Launched</div>
         </div>
        <div class="kpi-card">
          <div class="kpi-value" id="kpiCarryovers">0</div>
          <div class="kpi-label">Active Carry-overs</div>
        </div>
      </div>

      <div class="dashboard-hero">
        <div class="hero-label">Overall Cohort GPA</div>
        <div class="hero-value" id="dashboardCohortGpa">—</div>
      </div>

      <div class="dashboard-charts">
        <div class="chart-card">
          <div class="chart-card-title">Average GPA by Year</div>
          <canvas id="chartGpaByYear" height="180"></canvas>
        </div>
        <div class="chart-card">
          <div class="chart-card-title">Grade Distribution</div>
          <canvas id="chartGradeDist" height="180"></canvas>
        </div>
      </div>

      <div class="dashboard-section">
        <h3 class="dashboard-section-title">Recent Activity</h3>
        <div id="dashboardActivity" class="dashboard-activity">
          <div class="dashboard-empty">Loading…</div>
        </div>
      </div>

      <div class="dashboard-section">
        <h3 class="dashboard-section-title">Carry-over Students</h3>
        <div id="dashboardCarryovers" class="dashboard-carryovers">
          <div class="dashboard-empty">Loading…</div>
        </div>
      </div>

      <div class="dashboard-section">
        <h3 class="dashboard-section-title">Top Performers</h3>
        <div id="dashboardTopPerformers" class="dashboard-top-performers">
          <div class="dashboard-empty">Loading…</div>
        </div>
      </div>

      <div class="dashboard-section">
        <h3 class="dashboard-section-title">Top Score Per Course</h3>
        <div id="dashboardTopScores" class="dashboard-top-scores">
          <div class="dashboard-empty">Loading…</div>
        </div>
      </div>
    </div>
  `;
}

async function loadDashboardData() {
  const params = new URLSearchParams();
  if (dashboardState.year !== 'all') params.set('year', dashboardState.year);
  if (dashboardState.semester !== 'all') params.set('semester', dashboardState.semester);
  const queryString = params.toString();
  const urlSuffix = queryString ? `?${queryString}` : '';
  try {
    const [summaryRes, gpaRes, topScoresRes] = await Promise.all([
      apiFetch(`/api/dashboard/summary${urlSuffix}`),
      apiFetch(`/api/dashboard/gpa-data${urlSuffix}`),
      apiFetch(`/api/dashboard/top-scores${urlSuffix}`)
    ]);

    const summary = summaryRes;
    const gpaRows = gpaRes || [];
    const topScores = topScoresRes || [];

    renderDashboardKpis(summary);
    renderDashboardCohortGpa(gpaRows);
    renderGradeDistributionChart(summary.gradeDistribution);
    renderGpaByYearChart(gpaRows);
    renderActivityTable(summary.recentActivity);
    renderCarryovers(summary.carryoverStudents, summary.carryoverStudentsTotal);
    renderTopPerformers(gpaRows);
    renderTopScores(topScores);
  } catch (err) {
    console.error('Dashboard data load error:', err.message);
    const activityEl = document.getElementById('dashboardActivity');
    if (activityEl) activityEl.innerHTML = '<div class="dashboard-empty">Unable to load dashboard data. Please try again.</div>';
    const carryoverEl = document.getElementById('dashboardCarryovers');
    if (carryoverEl) carryoverEl.innerHTML = '<div class="dashboard-empty">Unable to load data.</div>';
  }
}

function renderDashboardKpis(summary) {
  const kpiTotalStudents = document.getElementById('kpiTotalStudents');
  const kpiRosterCount = document.getElementById('kpiRosterCount');
  const kpiTotalCourses = document.getElementById('kpiTotalCourses');
  const kpiCarryovers = document.getElementById('kpiCarryovers');

  if (kpiTotalStudents) kpiTotalStudents.textContent = summary.totalStudents ?? 0;
  if (kpiRosterCount) kpiRosterCount.textContent = summary.totalRosterStudents ?? 0;
  if (kpiTotalCourses) kpiTotalCourses.textContent = summary.totalCourses ?? 0;
  if (kpiCarryovers) kpiCarryovers.textContent = summary.carryoverCount ?? 0;
}

function renderDashboardCohortGpa(gpaRows) {
  const el = document.getElementById('dashboardCohortGpa');
  if (!el) return;
  if (!gpaRows || gpaRows.length === 0) {
    el.textContent = '—';
    return;
  }
  const stats = computeGpaStats(gpaRows);
  el.textContent = stats.gpa !== null ? stats.gpa.toFixed(2) : '—';
  const labelEl = document.querySelector('.dashboard-hero .hero-label');
  if (labelEl) labelEl.textContent = getDashboardGpaLabel();
}

function getDashboardGpaLabel() {
  if (dashboardState.year === 'all') return 'CGPA';
  if (dashboardState.semester !== 'all') return 'Semester GPA';
  return 'Year GPA';
}

function renderTopPerformers(gpaRows) {
  const el = document.getElementById('dashboardTopPerformers');
  if (!el) return;

  if (!gpaRows || gpaRows.length === 0) {
    el.innerHTML = '<div class="dashboard-empty">No results data for this scope.</div>';
    return;
  }

  const gpaLabel = getDashboardGpaLabel();

  const byStudent = {};
  gpaRows.forEach(r => {
    const regNo = (r.reg_no || '').trim();
    if (!regNo) return;
    if (!byStudent[regNo]) byStudent[regNo] = [];
    byStudent[regNo].push(r);
  });

  const studentGpas = Object.keys(byStudent).map(regNo => {
    const rows = byStudent[regNo];
    const stats = computeGpaStats(rows);
    const name = (rows.find(r => r.student_name)?.student_name) || rows[0]?.student_name || '';
    return {
      regNo,
      name: name || '',
      gpa: stats.gpa,
      studentName: name || regNo
    };
  });

  studentGpas.sort((a, b) => {
    if (a.gpa === null) return 1;
    if (b.gpa === null) return -1;
    return b.gpa - a.gpa;
  });

  const valid = studentGpas.filter(s => s.gpa !== null);
  if (valid.length === 0) {
    el.innerHTML = '<div class="dashboard-empty">No GPA data available.</div>';
    return;
  }

  const topGpa = valid[0].gpa;
  const topPerformers = valid.filter(s => Math.abs(s.gpa - topGpa) < 0.001);

  const html = topPerformers.map(s => `
    <div class="top-performer-row">
      <span class="tp-name" title="${escAttr(s.studentName)}">${escHtml(s.studentName)}</span>
      <span class="tp-regno">${escHtml(s.regNo)}</span>
      <span class="tp-gpa">${gpaLabel}: <b>${s.gpa.toFixed(2)}</b></span>
    </div>
  `).join('');

  el.innerHTML = `
    <div class="top-performers-list">
      ${html}
    </div>
  `;
}

function renderTopScores(topScores) {
  const el = document.getElementById('dashboardTopScores');
  if (!el) return;

  if (!topScores || topScores.length === 0) {
    el.innerHTML = '<div class="dashboard-empty">No results data for this scope.</div>';
    return;
  }

  const html = topScores.map(c => {
    const topScore = c.top_score;
    const scorers = (c.top_scorers || []).map(s => `${s.student_name || s.reg_no || ''}`.trim()).filter(Boolean).join(', ');
    return `
      <div class="top-score-row">
        <span class="ts-code">${escHtml(c.course_code || '')}</span>
        <span class="ts-title">${escHtml(c.course_title || '')}</span>
        <span class="ts-score">${escHtml(String(topScore))}</span>
        <span class="ts-scorers" title="${escAttr(scorers)}">${escHtml(scorers)}</span>
      </div>
    `;
  }).join('');

  el.innerHTML = `
    <table class="top-scores-table">
      <thead><tr><th>Course</th><th>Title</th><th>Top Score</th><th>Scorer(s)</th></tr></thead>
      <tbody>${html}</tbody>
    </table>
  `;
}

function renderGpaByYearChart(gpaRows) {
  if (!gpaRows || gpaRows.length === 0) {
    const ctx = document.getElementById('chartGpaByYear');
    if (ctx) {
      if (dashboardCharts.gpaByYear) dashboardCharts.gpaByYear.destroy();
      dashboardCharts.gpaByYear = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: { plugins: { legend: { display: false } } }
      });
    }
    return;
  }

  const byYear = {};
  gpaRows.forEach(r => {
    if (!byYear[r.year]) byYear[r.year] = [];
    byYear[r.year].push(r);
  });

  const labels = Object.keys(byYear).sort();
  const data = labels.map(y => {
    const stats = computeGpaStats(byYear[y]);
    return stats.gpa !== null ? stats.gpa.toFixed(2) : '—';
  });

  const ctx = document.getElementById('chartGpaByYear');
  if (ctx) {
    if (dashboardCharts.gpaByYear) dashboardCharts.gpaByYear.destroy();
    dashboardCharts.gpaByYear = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'GPA',
          data,
          backgroundColor: '#0B4432',
          borderColor: '#0B4432',
          borderRadius: 4
        }]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true,
            max: 5,
            grid: { color: 'rgba(11, 68, 50, 0.08)' },
            ticks: { color: '#1C1F1D', font: { family: 'Inter' } }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#1C1F1D', font: { family: 'Inter' } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0B4432',
            titleFont: { family: 'Inter' },
            bodyFont: { family: 'Inter' }
          }
        }
      }
    });
  }
}

function renderGradeDistributionChart(dist) {
  const ctx = document.getElementById('chartGradeDist');
  const labels = ['A', 'B', 'C', 'D', 'E', 'F'];
  const data = labels.map(g => dist[g] ?? 0);

  if (ctx) {
    if (dashboardCharts.gradeDist) dashboardCharts.gradeDist.destroy();
    dashboardCharts.gradeDist = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Count',
          data,
          backgroundColor: '#0B4432',
          borderColor: '#0B4432',
          borderRadius: 4
        }]
      },
      options: {
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: 'rgba(11, 68, 50, 0.08)' },
            ticks: { color: '#1C1F1D', font: { family: 'Inter' } }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#1C1F1D', font: { family: 'Inter' } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0B4432',
            titleFont: { family: 'Inter' },
            bodyFont: { family: 'Inter' }
          }
        }
      }
    });
  }
}

function renderActivityTable(activity) {
  const el = document.getElementById('dashboardActivity');
  if (!el) return;

  if (!activity || activity.length === 0) {
    el.innerHTML = '<div class="dashboard-empty">No recent activity yet.</div>';
    return;
  }

  const rows = activity.map(item => {
    const timeAgo = formatRelativeTime(item.updated_at);
    return `
      <tr>
        <td>${escHtml(item.student_name || '')}</td>
        <td>${escHtml(item.reg_no || '')}</td>
        <td>${escHtml(item.course_code || '')}</td>
        <td>${escHtml(item.score !== '' && item.score !== null && item.score !== undefined ? item.score : '')}</td>
        <td>${escHtml(item.grade || '')}</td>
        <td>${escHtml(item.year || '')} / ${escHtml(item.semester || '')}</td>
        <td><span class="activity-time">${timeAgo}</span></td>
      </tr>
    `;
  }).join('');

  el.innerHTML = `
    <div class="table-scroll">
      <table class="activity-table">
        <thead>
          <tr>
            <th>Student Name</th>
            <th>Reg No</th>
            <th>Course</th>
            <th>Score</th>
            <th>Grade</th>
            <th>Year / Semester</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderCarryovers(students, totalCount) {
  const el = document.getElementById('dashboardCarryovers');
  if (!el) return;

  if (!students || students.length === 0) {
    el.innerHTML = '<div class="dashboard-empty">No carry-over students.</div>';
    return;
  }

  const avatars = students.map(s => {
    const name = s.student_name || '';
    const reg = s.reg_no || '';
    return `<div class="avatar-stack-item" title="${escAttr(name || reg)}">${generateInitialsAvatar(name, reg, 32)}</div>`;
  }).join('');

  const moreBadge = totalCount > students.length
    ? `<span class="avatar-more">+${totalCount - students.length} more</span>`
    : '';

  el.innerHTML = `
    <div class="avatar-stack">
      ${avatars}
      ${moreBadge}
    </div>
    <div class="carryover-count">Total: ${totalCount} student${totalCount !== 1 ? 's' : ''}</div>
  `;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return '—';
  const d = new Date(timestamp);
  if (isNaN(d)) return '—';
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr !== 1 ? 's' : ''} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function attachDashboardHandlers() {
  const yearSelect = document.getElementById('dashboardYear');
  if (yearSelect) {
    yearSelect.value = dashboardState.year;
    yearSelect.addEventListener('change', () => {
      dashboardState.year = yearSelect.value;
      dashboardState.semester = 'all';
      updateDashboardSemFilter();
      loadDashboardData();
    });
  }
  const semSelect = document.getElementById('dashboardSemester');
  if (semSelect) {
    semSelect.value = dashboardState.semester;
    semSelect.addEventListener('change', () => {
      dashboardState.semester = semSelect.value;
      loadDashboardData();
    });
  }
  updateDashboardSemFilter();
  loadDashboardData();
}

function updateDashboardSemFilter() {
  const semSelect = document.getElementById('dashboardSemester');
  if (semSelect) {
    const disabled = dashboardState.year === 'all';
    semSelect.disabled = disabled;
    semSelect.value = disabled ? 'all' : dashboardState.semester;
    semSelect.classList.toggle('dashboard-semester-disabled', disabled);
  }
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
  setupSettingsSelects();
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

  const sessionInputs = document.querySelectorAll('.session-inputs input[data-year]');
  const sessionTimers = {};
  sessionInputs.forEach(input => {
    input.addEventListener('input', () => {
      const year = input.dataset.year;
      const statusEl = document.querySelector(`.session-status[data-year="${year}"]`);
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

  const rosterSearch = document.getElementById('rosterSearch');
  if (rosterSearch) {
    let rosterTimer = null;
    rosterSearch.addEventListener('input', () => {
      clearTimeout(rosterTimer);
      rosterTimer = setTimeout(async () => {
        const term = rosterSearch.value.trim();
        await refreshClassRoster(term || undefined);
      }, 300);
    });
  }

  const addRosterBtn = document.getElementById('addRosterStudentBtn');
  if (addRosterBtn) addRosterBtn.addEventListener('click', showAddRosterStudentModal);

  const importRosterBtn = document.getElementById('importRosterBtn');
  if (importRosterBtn) {
    importRosterBtn.addEventListener('click', () => {
      document.getElementById('importRosterFile').click();
    });
  }

  const deleteAllBtn = document.getElementById('deleteAllStudentsBtn');
  if (deleteAllBtn) deleteAllBtn.addEventListener('click', deleteAllStudents);

  refreshClassRoster();
}

async function refreshClassRoster(search) {
  const body = document.getElementById('rosterTableBody');
  if (!body) return;

  try {
    const data = await apiFetch(search ? `/api/students?search=${encodeURIComponent(search)}` : '/api/students');
    studentRoster.all = data || [];
    renderClassRosterTable();
  } catch (err) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--red)">Failed to load roster: ${err.message}</td></tr>`;
  }
}

function renderClassRosterTable() {
  const body = document.getElementById('rosterTableBody');
  if (!body) return;

  const rows = studentRoster.all || [];
  if (rows.length === 0) {
    body.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--muted)">No students found.</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(s => `
    <tr data-student-id="${s.id}">
      <td>${escHtml(s.reg_no)}</td>
      <td class="roster-editable"><input type="text" value="${escAttr(s.full_name)}" data-field="full_name" placeholder="Full name"></td>
      <td class="roster-editable"><input type="text" value="${escAttr(s.program || '')}" data-field="program" placeholder="Program"></td>
      <td style="text-align:center">${s.courseCount || 0}</td>
      <td class="roster-save-btns">
        <button class="btn secondary" style="font-size:11px;padding:2px 8px" onclick="saveStudentEdit('${s.id}')">Save</button>
        <button class="btn secondary" style="font-size:11px;padding:2px 8px" onclick="deleteStudent('${s.id}')" title="Delete student">Delete</button>
      </td>
    </tr>
  `).join('');

  // Attach per-row edit listeners
  rows.forEach(s => {
    const row = body.querySelector(`tr[data-student-id="${s.id}"]`);
    if (!row) return;
    const nameInput = row.querySelector('input[data-field="full_name"]');
    const progInput = row.querySelector('input[data-field="program"]');
    [nameInput, progInput].forEach(input => {
      if (!input) return;
      let timer = null;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => saveStudentEdit(s.id), 600);
      });
    });
  });
}

async function saveStudentEdit(id) {
  const row = document.querySelector(`tr[data-student-id="${id}"]`);
  if (!row) return;
  const nameInput = row.querySelector('input[data-field="full_name"]');
  const progInput = row.querySelector('input[data-field="program"]');
  const fullName = nameInput ? nameInput.value.trim() : '';
  const program = progInput ? progInput.value.trim() : '';

  if (!fullName) {
    alert('Full name is required.');
    return;
  }

  try {
    const data = await apiFetch(`/api/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ full_name: fullName, program: program })
    });
    // Update local roster cache
    const idx = studentRoster.all.findIndex(s => s.id === id);
    if (idx >= 0) {
      studentRoster.all[idx].full_name = data.full_name;
      studentRoster.all[idx].program = data.program;
      // Re-render to reflect updated values
      renderClassRosterTable();
    }
    const statusEl = document.getElementById('rosterStatus');
    if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--ok)'; setTimeout(() => statusEl.textContent = '', 1500); }
  } catch (err) {
    console.error('Student edit failed:', err.message);
    alert('Failed to save: ' + err.message);
  }
}

async function deleteStudent(id) {
  const row = document.querySelector(`tr[data-student-id="${id}"]`);
  if (!row) return;
  const regNo = row.cells[0].textContent || '';

  if (!confirm(`Remove "${regNo}" from the roster? The student must have no results in any course.`)) return;

  try {
    await apiFetch(`/api/students/${id}`, { method: 'DELETE' });
    // Remove from local roster cache
    studentRoster.all = studentRoster.all.filter(s => s.id !== id);
    renderClassRosterTable();
    const statusEl = document.getElementById('rosterStatus');
    if (statusEl) { statusEl.textContent = 'Removed.'; statusEl.style.color = 'var(--ok)'; setTimeout(() => statusEl.textContent = '', 1500); }
  } catch (err) {
    console.error('Student delete failed:', err.message);
    alert(err.message || 'Failed to delete student.');
  }
}

async function deleteAllStudents() {
  const count = (studentRoster.all || []).length;
  if (count === 0) {
    alert('There are no students in the roster to delete.');
    return;
  }

  if (!confirm(`Delete ALL ${count} student${count === 1 ? '' : 's'} from your Class Roster?\n\nStudents linked to existing course results will be preserved — only those with no results will be removed.`)) return;

  showLoading('Removing students…');
  try {
    const result = await apiFetch('/api/students', { method: 'DELETE' });
    const deleted = result.deleted || 0;
    const skipped = result.skipped || 0;

    if (result.skippedStudents && result.skippedStudents.length > 0) {
      const skippedList = result.skippedStudents.map(s => `${s.reg_no} (${s.full_name})`).join(', ');
      alert(`Deleted ${deleted} student${deleted === 1 ? '' : 's'}.\n\n${skipped} student${skipped === 1 ? '' : 's'} still have linked results and could not be removed:\n${skippedList}`);
    } else {
      alert(`Deleted ${deleted} student${deleted === 1 ? '' : 's'} from your roster.`);
    }

    // Clear the local cache and re-render
    studentRoster.all = [];
    studentRoster.loaded = false;
    renderClassRosterTable();
  } catch (err) {
    console.error('Students delete-all failed:', err.message);
    alert(err.message || 'Failed to delete students.');
  } finally {
    hideLoading();
  }
}

function showAddRosterStudentModal() {
  const regNo = prompt('Enter Reg No (11 digits):');
  if (!regNo || !regNo.trim()) return;
  const regNoTrimmed = regNo.trim();
  if (!/^\d{11}$/.test(regNoTrimmed)) {
    alert('Reg No must be exactly 11 digits.');
    return;
  }

  const name = prompt(`Enter the full name for Reg No ${regNoTrimmed}:`);
  if (!name || !name.trim()) {
    alert('Full name is required.');
    return;
  }

  const program = prompt(`Enter the program for ${name.trim()} (optional — press Cancel to skip):`) || '';

  showLoading('Adding student…');
  createStudent(regNoTrimmed, name.trim(), program.trim())
    .then(() => {
      hideLoading();
      refreshClassRoster();
      const statusEl = document.getElementById('rosterStatus');
      if (statusEl) { statusEl.textContent = 'Student added.'; statusEl.style.color = 'var(--ok)'; setTimeout(() => statusEl.textContent = '', 1500); }
    })
    .catch(err => {
      hideLoading();
      console.error('Failed to create student:', err.message);
      alert('Failed to create student. ' + err.message);
    });
}

/* ===================== STUDENT IMPORT FROM FILE ===================== */

const STUDENT_IMPORT_FIELDS = [
  { key: 'regNo', aliases: ['reg no', 'registration number', 'reg_number', 'regno', 'reg no.', 'registration no', 'matric', 'matric number', 'matric_no'] },
  { key: 'name', aliases: ['student name', 'name', 'full name', 'student_name', 'fullname', 'full_name'] },
  { key: 'program', aliases: ['program', 'program of study', 'programme', 'programme of study', 'department', 'dept'] }
];

function mapStudentRowFields(rawRow) {
  const mapped = {};
  const sourceKeys = Object.keys(rawRow);
  sourceKeys.forEach(key => {
    const norm = normalizeColumnName(key);
    for (const field of STUDENT_IMPORT_FIELDS) {
      if (field.aliases.includes(norm)) {
        mapped[field.key] = rawRow[key];
        return;
      }
    }
    mapped[norm] = rawRow[key];
  });
  return mapped;
}

async function handleStudentImportFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;

  try {
    const rawRows = await parseImportFile(file);
    if (!rawRows || !rawRows.length) {
      alert('The uploaded file appears to be empty.');
      input.value = '';
      return;
    }

    const mapped = rawRows.map(r => mapStudentRowFields(r));
    const hasRequired = mapped.some(r => r.regNo || r.name);
    if (!hasRequired) {
      alert('The uploaded file does not contain recognizable student columns (Reg No and/or Full Name).');
      input.value = '';
      return;
    }

    // Ensure student roster is loaded for preview comparison
    if (!studentRoster.loaded) {
      await loadStudents();
    }

    const parsed = validateStudentImportRows(mapped);
    if (!parsed.valid.length && !parsed.conflictRows.length) {
      alert('No valid student rows found. All rows have errors.');
      input.value = '';
      return;
    }

    renderStudentImportPreview(parsed);
  } catch (err) {
    alert(err.message || 'Failed to import file.');
  } finally {
    input.value = '';
  }
}

function validateStudentImportRows(rawRows) {
  const valid = [];
  const errors = [];
  const conflictRows = [];
  const seenRegs = {};
  const existingRegs = {};

  // Build lookup of existing roster by reg_no
  (studentRoster.all || []).forEach(s => {
    const reg = (s.reg_no || '').trim();
    if (reg) existingRegs[reg] = s;
  });

  rawRows.forEach((raw, idx) => {
    const row = mapStudentRowFields(raw);
    const rowErrors = [];
    const rowWarnings = [];

    const reg = String(row.regNo || '').trim();
    const fullName = String(row.name || '').trim();
    const program = String(row.program || '').trim();

    // Reg No validation (same 11-digit rule as manual entry)
    if (!reg) {
      rowErrors.push('Reg No is required.');
    } else if (!/^\d{11}$/.test(reg)) {
      rowErrors.push('Reg No must be exactly 11 digits.');
    }

    if (!fullName) {
      rowErrors.push('Full Name is required.');
    }

    // Duplicate-within-file detection
    if (reg) {
      if (seenRegs[reg] !== undefined) {
        rowErrors.push(`Duplicate Reg No within file (also at row ${seenRegs[reg] + 1}).`);
      } else {
        seenRegs[reg] = idx;
      }
    }

    // If there are basic errors, report them and move on
    if (rowErrors.length > 0) {
      errors.push({ index: idx, row: { regNo: reg, fullName, program }, errors: rowErrors });
      return;
    }

    // Match against existing roster
    if (reg && /^\d{11}$/.test(reg)) {
      const existing = existingRegs[reg];
      if (existing) {
        // Check if name and program match
        const rosterName = (existing.full_name || '').trim();
        const rosterProgram = (existing.program || '').trim();

        const nameMatch = fullName ? rosterName.toLowerCase() === fullName.toLowerCase() : true;
        const programMatch = program ? rosterProgram.toLowerCase() === program.toLowerCase() : true;

        if (nameMatch && programMatch) {
          rowWarnings.push('Already on roster — no change.');
          valid.push({
            index: idx,
            regNo: reg,
            fullName,
            program,
            status: 'no-change',
            warnings: rowWarnings
          });
          return;
        }

        // There is a mismatch — flag for explicit confirmation
        conflictRows.push({
          index: idx,
          regNo: reg,
          fullName,
          program,
          status: 'mismatch',
          existing: { fullName: rosterName, program: rosterProgram, id: existing.id },
          mismatchDetails: [
            ...(!nameMatch ? [`name: file has "${fullName}" but roster has "${rosterName}"`] : []),
            ...(!programMatch ? [`program: file has "${program || '(blank)'}" but roster has "${rosterProgram || '(blank)'}"`] : [])
          ],
          warnings: rowWarnings
        });
        return;
      }
      // Not on roster — new student
      valid.push({
        index: idx,
        regNo: reg,
        fullName,
        program,
        status: 'new',
        warnings: rowWarnings
      });
    }
  });

  return {
    total: rawRows.length,
    valid,
    conflictRows,
    errors
  };
}

function renderStudentImportPreview(parsed) {
  const overlay = document.createElement('div');
  overlay.className = 'import-overlay';
  overlay.innerHTML = `
    <div class="import-modal">
      <h3>Student Import Preview</h3>
      <p class="settings-note">Only Reg No, Full Name, and Program are read from the file. No other columns are used.</p>
      <div class="import-summary">
        <div><span class="num">${parsed.total}</span><span class="lbl">Total rows</span></div>
        <div><span class="num ok">${parsed.valid.length}</span><span class="lbl">Valid (new + no-change)</span></div>
        <div><span class="num warn">${parsed.conflictRows.length}</span><span class="lbl">Name/program mismatches</span></div>
        <div><span class="num err">${parsed.errors.length}</span><span class="lbl">Invalid rows</span></div>
      </div>

      ${parsed.errors.length ? `
        <div class="import-errors">
          <strong>Errors</strong>
          <ul>
            ${parsed.errors.map(e => `<li><b>${e.index + 1}</b>: ${(e.errors || []).join(' ')}</li>`).join('')}</ul>
        </div>
      ` : ''}

      ${parsed.conflictRows.length ? `
        <div class="import-warnings">
          <strong>Mismatches with existing roster (${parsed.conflictRows.length})</strong>
          <p class="settings-note">These students already exist on your roster. Their name or program differs from the file. Choosing "Overwrite" will replace the roster's name and program for these students.</p>
          <table style="width:100%;font-size:12.5px;border-collapse:collapse">
            <thead><tr><th>Reg No</th><th>Name (file→roster)</th><th>Program (file→roster)</th></tr></thead>
            <tbody>
              ${parsed.conflictRows.map(c => `
                <tr>
                  <td>${escHtml(c.regNo)}</td>
                  <td>${escHtml(c.fullName)} → ${escHtml(c.existing.fullName || '(blank)')}</td>
                  <td>${escHtml(c.program || '(blank)')} → ${escHtml(c.existing.program || '(blank)')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}

      <div class="import-table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Reg No</th><th>Full Name</th><th>Program</th><th>Status</th></tr>
          </thead>
          <tbody>
            ${parsed.valid.map(v => `
              <tr>
                <td>${v.index + 1}</td>
                <td>${escHtml(v.regNo)}</td>
                <td>${escHtml(v.fullName)}</td>
                <td>${escHtml(v.program || '')}</td>
                <td>
                  ${v.status === 'new' ? '<span style="color:var(--ok);font-weight:600">New — will be added</span>' :
                    v.status === 'no-change' ? '<span style="color:var(--muted)">Already on roster</span>' :
                    '<span style="color:var(--ink)">Add</span>'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="import-actions">
        <button class="btn gold" id="confirmRosterImportBtn">Import students</button>
        <button class="btn secondary" id="cancelRosterImportBtn">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cancelRosterImportBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  document.getElementById('confirmRosterImportBtn').addEventListener('click', async () => {
    const confirmBtn = document.getElementById('confirmRosterImportBtn');
    const hasConflicts = parsed.conflictRows.length > 0;
    let overwrite = false;
    if (hasConflicts) {
      if (!confirm("This import includes students whose name or program differs from your existing roster. Overwrite the roster's existing data for these students?")) {
        return;
      }
      overwrite = true;
    }
    overlay.remove();
    await commitStudentImport(parsed.valid, parsed.conflictRows, overwrite);
  });
}

async function commitStudentImport(validRows, conflictRows, overwrite) {
  let added = 0;
  let skipped = 0;
  let updated = 0;

  const newStudents = validRows.filter(v => v.status === 'new' || v.status === 'add');
  const overwriteStudents = overwrite ? conflictRows : [];

  showLoading(`Importing ${newStudents.length + overwriteStudents.length} students…`);
  try {
    // Batch-create all new students in a single request
    if (newStudents.length > 0) {
      try {
        const batchResult = await apiFetch('/api/students/batch', {
          method: 'POST',
          body: JSON.stringify({
            students: newStudents.map(s => ({
              reg_no: s.regNo,
              full_name: s.fullName,
              program: s.program || null
            }))
          })
        });
        added += batchResult.added || 0;
        skipped += batchResult.skipped || 0;
      } catch (err) {
        console.error('Batch student create failed:', err.message);
        skipped += newStudents.length;
      }
    }

    // Batch-update overwritten students in parallel (chunks of 10)
    if (overwriteStudents.length > 0) {
      const CHUNK = 10;
      for (let i = 0; i < overwriteStudents.length; i += CHUNK) {
        const chunk = overwriteStudents.slice(i, i + CHUNK);
        const results = await Promise.allSettled(
          chunk.map(s => apiFetch(`/api/students/${s.existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ full_name: s.fullName, program: s.program || null })
          }))
        );
        results.forEach(result => {
          if (result.status === 'fulfilled') updated++;
          else skipped++;
        });
      }
    }
   } finally {
    hideLoading();
  }

  // Refresh the roster immediately so all new students appear
  showLoading('Updating roster…');
  try {
    studentRoster.loaded = false;
    await refreshClassRoster();
  } finally {
    hideLoading();
  }


  const statusEl = document.getElementById('rosterStatus');
  if (statusEl) {
    const parts = [];
    if (added) parts.push(`${added} added`);
    if (updated) parts.push(`${updated} updated`);
    if (skipped) parts.push(`${skipped} skipped`);
    statusEl.textContent = parts.length ? parts.join(', ') + ' complete.' : 'Done.';
    statusEl.style.color = 'var(--ok)';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
  }
}



function generateTranscript() {
  const regNo = document.getElementById('transcriptRegNo').value.trim();
  const output = document.getElementById('transcriptOutput');
  if (!regNo) { output.innerHTML = '<p class="no-record">Please enter a registration number.</p>'; return; }

   let studentName = '';
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

      const stats = computeGpaStats(rows);
      let tableRows = '';
      rows.forEach(r => {
        if (!studentName && r.name) studentName = r.name;
        const gi = gradeInfo(r.score);
        tableRows += `<tr><td>${escHtml(r.code)}</td><td>${escHtml(r.title)}</td><td style="text-align:center">${escHtml(r.unit)}</td>
          <td style="text-align:center">${escHtml(r.score)}</td><td style="text-align:center;font-weight:600">${gi.grade}</td>
          <td style="text-align:center">${gi.point === null ? '' : gi.point}</td></tr>`;
        flatRows.push({ Year: yearKey, Semester: sem, RegNo: regNo, Name: r.name, Code: r.code, Title: r.title, Unit: r.unit, Score: r.score, Grade: gi.grade, Point: gi.point, Program: resolveProgram(r) || '', Remark: r.remark || '' });
      });

      const semGpaText = stats.gpa !== null ? stats.gpa.toFixed(2) : '—';
      const semTotalsHtml = `<span>Units: <b>${stats.unitsEntered}</b></span><span>Semester GPA: <b>${semGpaText}</b></span>`;
      semHtml += `
        <div class="t-sem-label">${sem}</div>
        <div class="table-scroll"><table><thead><tr><th>Code</th><th>Course Title</th><th>Unit</th><th>Score</th><th>Grade</th><th>Point</th></tr></thead>
        <tbody>${tableRows}</tbody></table></div>
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

  const cumStats = computeGpaStats(allStudentRows);
  const cgpaText = cumStats.gpa !== null ? cumStats.gpa.toFixed(2) : '—';
  const cgpaHtml = `<div class="cgpa-banner"><div>Cumulative Grade Point Average (CGPA)</div><div class="big">${cgpaText}</div></div>`;

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

  showLoading('Exporting to Excel…');
  try {

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
  const includeProgRem = excelShouldIncludeProgramData(rows);
  const baseHeaders = ['S/N', 'Name', 'Reg No', ...codes];
  const headers = includeProgRem
    ? [...baseHeaders, 'Program', 'Remark', 'Remarks']
    : [...baseHeaders, 'Remarks'];
  const colCount = headers.length;

  // Metadata block (non-course-scoped: no course-specific rows)
  const headerRowNum = excelWriteMetadataBlock(sheet, {
    colCount,
    documentTitle: 'CUMULATIVE RESULT SHEET',
    faculty: state.meta.school,
    department: state.meta.department,
    semester: sem,
    session: session,
    isCourseScoped: false,
    exportDate: new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  });

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
    const remColIdx = 4 + codes.length;
    if (includeProgRem) {
       const prog = rows.find(r => (r.regNo || '').trim() === stu.regNo && (resolveProgram(r) || '').trim());
       excelRow.getCell(remColIdx).value = prog ? (resolveProgram(prog) || '') : '';
       excelRow.getCell(remColIdx).alignment = { horizontal: 'center', vertical: 'middle' };
       rowValues.push(prog ? (resolveProgram(prog) || '') : '');
      const remarkCell = excelRow.getCell(remColIdx + 1);
      const stuRemarks = rows.filter(r => (r.regNo || '').trim() === stu.regNo && (r.remark || '').trim());
      remarkCell.value = stuRemarks.length ? (stuRemarks[0].remark || '') : '';
      remarkCell.alignment = { horizontal: 'center', vertical: 'middle' };
      rowValues.push(stuRemarks.length ? (stuRemarks[0].remark || '') : '');
    }
    const computedRemarkCol = remColIdx + (includeProgRem ? 2 : 0);
    excelRow.getCell(computedRemarkCol).value = remark;
    excelRow.getCell(computedRemarkCol).alignment = { horizontal: 'center', vertical: 'middle' };
    rowValues.push(remark);
    excelRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    excelRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    excelRow.getCell(3).alignment = { horizontal: 'center', vertical: 'middle' };
    excelStyleDataRow(excelRow, 3);
    dataRowsForWidth.push(rowValues);
  });

  // Generous column widths with content-fit plus minimums, plus metadata label minimums
  const colWidths = excelApplyMetadataWidths(excelContentWidths(headers, dataRowsForWidth, true), colCount);
  // Course code columns (indices 3 to 3+codes.length-1) need minimum 12
  for (let i = 3; i < 3 + codes.length; i++) {
    colWidths[i] = Math.max(colWidths[i] || 0, 12);
  }
  excelSetWidths(sheet, colWidths);

  // Row heights (only for header + data rows, not metadata)
  excelSetRowHeights(sheet, headerRowNum, students.length, 24, 16);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Cumulative - ${yearKey} - ${sem}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  } finally {
    hideLoading();
  }
}

/* ===================== SEMESTER / YEAR / TRANSCRIPT EXCEL EXPORT ===================== */

async function exportSemesterExcel(yearKey, sem) {
  const rows = state.years[yearKey][sem];
  const session = state.academicSessions[yearKey] || '';

  showLoading('Exporting to Excel…');
  try {

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sem.replace(/[:\\\/\?\*\[\]]/g, '') || 'Sheet1');

  // Build headers (with optional Program/Remark columns)
  const headers = ['S/N', 'Reg No', 'Student Name'];
  const includeProgRem = excelShouldIncludeProgramData(rows);
  if (includeProgRem) headers.push('Program', 'Remark');
  headers.push('Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point');
  const colCount = headers.length;

  // Metadata block (non-course-scoped: no course-specific rows)
  const headerRowNum = excelWriteMetadataBlock(sheet, {
    colCount,
    documentTitle: 'OFFICIAL RESULT SHEET',
    faculty: state.meta.school,
    department: state.meta.department,
    semester: sem,
    session: session,
    isCourseScoped: false,
    exportDate: new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  });

  await excelAddLogos(workbook, sheet, colCount);
  excelHeaderRow(sheet, headerRowNum, headers);

  const dataRowsForWidth = [];
  rows.forEach((r, idx) => {
    const gi = gradeInfo(r.score);
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const scoreVal = r.score === '' ? null : parseFloat(r.score);
    const values = [idx + 1, r.regNo, r.name];
    if (includeProgRem) values.push(resolveProgram(r) || '', r.remark || '');
    values.push(r.code, r.title, r.unit, scoreVal, gi.grade || '', gi.point === null ? '' : gi.point);
    values.forEach((val, colIdx) => { excelRow.getCell(colIdx + 1).value = val; });
    excelStyleDataRow(excelRow, colCount);
    dataRowsForWidth.push(values);
  });

  excelSetWidths(sheet, excelApplyMetadataWidths(excelContentWidths(headers, dataRowsForWidth, true), colCount));
  excelSetRowHeights(sheet, headerRowNum, rows.length, 24, 16);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${yearKey} - ${sem}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  } finally {
    hideLoading();
  }
}

async function exportYearExcel(yearKey) {
  const session = state.academicSessions[yearKey] || '';
  const workbook = new ExcelJS.Workbook();
  const exportDateStr = new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  // Check all semesters for program/remark data
  const allRows = [];
  SEMESTERS.forEach(sem => { (state.years[yearKey][sem] || []).forEach(r => allRows.push(r)); });
  const includeProgRem = excelShouldIncludeProgramData(allRows);

  const headers = ['S/N', 'Reg No', 'Student Name'];
  if (includeProgRem) headers.push('Program', 'Remark');
  headers.push('Course Code', 'Course Title', 'Credit Unit', 'Score', 'Grade', 'Grade Point');
  const colCount = headers.length;

  showLoading('Exporting to Excel…');
  try {
  SEMESTERS.forEach(sem => {
    const rows = state.years[yearKey][sem];

    const safeSem = sem.replace(/[:\\\/\?\*\[\]]/g, '');
    const sheet = workbook.addWorksheet(safeSem || 'Sheet1');

    // Metadata block (non-course-scoped)
    const headerRowNum = excelWriteMetadataBlock(sheet, {
      colCount,
      documentTitle: 'OFFICIAL RESULT SHEET',
      faculty: state.meta.school,
      department: state.meta.department,
      semester: sem,
      session: session,
      isCourseScoped: false,
      exportDate: exportDateStr
    });

    excelHeaderRow(sheet, headerRowNum, headers);

    const dataRowsForWidth = [];
    rows.forEach((r, idx) => {
      const gi = gradeInfo(r.score);
      const excelRow = sheet.getRow(headerRowNum + 1 + idx);
      const scoreVal = r.score === '' ? null : parseFloat(r.score);
      const values = [idx + 1, r.regNo, r.name];
    if (includeProgRem) values.push(resolveProgram(r) || '', r.remark || '');
      values.push(r.code, r.title, r.unit, scoreVal, gi.grade || '', gi.point === null ? '' : gi.point);
      values.forEach((val, colIdx) => { excelRow.getCell(colIdx + 1).value = val; });
      excelStyleDataRow(excelRow, colCount);
      dataRowsForWidth.push(values);
    });

    excelSetWidths(sheet, excelApplyMetadataWidths(excelContentWidths(headers, dataRowsForWidth, true), colCount));
    excelSetRowHeights(sheet, headerRowNum, rows.length, 24, 16);
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
  } finally {
    hideLoading();
  }
}

async function exportTranscriptExcel() {
  if (!lastTranscript) return;
  showLoading('Exporting to Excel…');
  try {
  const sessionMap = {};
  const sessions = state.academicSessions || {};
  Object.keys(sessions).forEach(yk => {
    if (sessions[yk]) sessionMap[yk] = sessions[yk];
  });

  // Check for program/remark data
  const includeProgRem = excelShouldIncludeProgramData(lastTranscript.flatRows || []);

  // Build headers (with optional Program/Remark columns)
  const baseHeaders = ['Year', 'Semester', 'Reg No', 'Name', 'Session', 'Code', 'Title', 'Unit', 'Score', 'Grade', 'Point'];
  const headers = includeProgRem
    ? ['Year', 'Semester', 'Reg No', 'Name', 'Program', 'Remark', 'Session', 'Code', 'Title', 'Unit', 'Score', 'Grade', 'Point']
    : baseHeaders;
  const colCount = headers.length;
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Transcript');

  // Metadata block (non-course-scoped)
  const headerRowNum = excelWriteMetadataBlock(sheet, {
    colCount,
    documentTitle: 'TRANSCRIPT',
    faculty: state.meta.school,
    department: state.meta.department,
    semester: 'All Semesters',
    session: '',
    isCourseScoped: false,
    exportDate: new Date().toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  });

  await excelAddLogos(workbook, sheet, colCount);
  excelHeaderRow(sheet, headerRowNum, headers);

  const dataRowsForWidth = [];
  lastTranscript.flatRows.forEach((r, idx) => {
    const session = sessionMap[r.Year] || '';
    const excelRow = sheet.getRow(headerRowNum + 1 + idx);
    const scoreVal = r.Score === '' ? null : parseFloat(r.Score);
    const values = [r.Year, r.Semester, r.RegNo, r.Name];
    if (includeProgRem) values.push(r.Program || '', r.Remark || '');
    values.push(session, r.Code, r.Title, r.Unit, scoreVal, r.Grade || '', r.Point === null ? '' : r.Point);
    values.forEach((val, colIdx) => { excelRow.getCell(colIdx + 1).value = val; });
    excelStyleDataRow(excelRow, colCount);
    dataRowsForWidth.push(values);
  });

  excelSetWidths(sheet, excelApplyMetadataWidths(excelContentWidths(headers, dataRowsForWidth, true), colCount));
  excelSetRowHeights(sheet, headerRowNum, lastTranscript.flatRows.length, 24, 16);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Transcript - ${lastTranscript.regNo}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  } finally {
    hideLoading();
  }
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
           <div id="settingFacultyContainer"></div>
         </div>
         <div class="meta-field">
           <label for="settingDepartment">Department</label>
           <div id="settingDepartmentContainer"></div>
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
        <div class="session-grid">
          ${YEAR_KEYS.map(yearKey => {
            const session = state.academicSessions[yearKey] || '';
            return `
              <div class="session-row">
                <label>${yearKey}</label>
                <div class="session-inputs">
                  <input type="text" placeholder="Session" data-year="${yearKey}" value="${escAttr(session)}">
                </div>
                <span class="session-status" data-year="${yearKey}"></span>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <div class="settings-divider"></div>

      <h3>Class Roster</h3>
      <p class="settings-note">Manage the canonical list of students. Students added here can be searched when adding them to courses.</p>
       <div class="settings-form">
         <div class="meta-field">
           <label for="rosterSearch">Search students</label>
           <input id="rosterSearch" placeholder="Search by Reg No or name…">
         </div>
          <button class="btn gold" id="addRosterStudentBtn">+ Add Student</button>
          <button class="btn secondary" id="importRosterBtn" style="margin-bottom:12px">Import from file</button>
          <button class="btn secondary" id="deleteAllStudentsBtn" style="margin-bottom:12px">Delete All Students</button>
          <input type="file" id="importRosterFile" accept=".xlsx,.xls,.csv" style="display:none" onchange="handleStudentImportFile(this)">
         <span id="rosterStatus" class="settings-status"></span>
       </div>
      <div class="table-scroll" id="rosterTableWrap">
        <table class="roster-table">
          <thead>
            <tr>
              <th style="width:12%">Reg No</th>
              <th style="width:28%">Full Name</th>
              <th style="width:30%">Program</th>
              <th style="width:10%">Courses</th>
              <th style="width:20%"></th>
            </tr>
          </thead>
          <tbody id="rosterTableBody">
            <tr><td colspan="5" style="text-align:center;color:var(--muted)">Loading…</td></tr>
          </tbody>
        </table>
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

  showLoading('Saving settings…');
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
  } finally {
    hideLoading();
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

  showLoading('Updating passcode…');
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
  } finally {
    hideLoading();
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

function resolveProgram(row) {
  if (row.studentId) {
    const student = studentRoster.all.find(s => s.id === row.studentId);
    if (student && student.program) return student.program;
  }
  return (row.program || '');
}

/* ===================== SEARCHABLE SELECT COMPONENT ===================== */
let futoSchools = null;

async function loadFutoSchools() {
  if (futoSchools) return futoSchools;
  try {
    const res = await fetch('/assets/futo-schools.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    futoSchools = data.schools || [];
    return futoSchools;
  } catch (err) {
    console.error('Failed to load FUTO schools:', err.message);
    futoSchools = [];
    return futoSchools;
  }
}

  function createSearchableSelect(container, options) {
  const {
    inputId,
    placeholder = 'Type to search…',
    optionLabel = 'name',
    optionSublabel = null,
    options: opts = [],
    defaultValue = '',
    onOptionSelect = null,
    onInputClear = null,
    asyncProvider = null,
    onNoMatchCreate = null,
    initialDisabled = false
  } = options;

  let disabled = initialDisabled;
  let sublabelKey = optionSublabel;
  const safePlaceholder = placeholder || 'Type to search…';
  const safeInputId = inputId || `ss-input-${Math.random().toString(36).slice(2, 10)}`;

  container.innerHTML = `
    <div class="searchable-select" data-input-id="${safeInputId}" ${disabled ? 'data-disabled="true"' : ''}>
      <input type="text" id="${safeInputId}" class="ss-input" placeholder="${escAttr(safePlaceholder)}" autocomplete="off" ${disabled ? 'disabled' : ''}>
      <div class="ss-dropdown" style="display:none">
        <div class="ss-options"></div>
      </div>
    </div>
  `;

  const input = container.querySelector('.ss-input');
  const dropdown = container.querySelector('.ss-dropdown');
  const optionsList = container.querySelector('.ss-options');

  input.value = defaultValue || '';

  let filtered = [];
  let activeIndex = -1;

  function renderOptions() {
    optionsList.innerHTML = '';
    if (asyncProvider && filtered.length === 0 && input.value.trim() && onNoMatchCreate) {
      const term = input.value.trim();
      const div = document.createElement('div');
      div.className = 'ss-option ss-create';
      div.dataset.index = -1;
      div.innerHTML = `<span class="ss-create-label">Add "${escHtml(term)}" as a new student</span>`;
      div.addEventListener('mousedown', e => {
        e.preventDefault();
        onNoMatchCreate(term);
      });
      optionsList.appendChild(div);
      return;
    }
    if (filtered.length === 0) {
      optionsList.innerHTML = '<div class="ss-no-results">No matching option</div>';
      return;
    }
    filtered.forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = 'ss-option';
      if (i === activeIndex) div.classList.add('active');
      div.dataset.index = i;
      let labelHtml = escHtml(opt[optionLabel] || '');
      if (sublabelKey && opt[sublabelKey]) {
        labelHtml += ` <span class="ss-sublabel">${escHtml(opt[sublabelKey])}</span>`;
      }
      div.innerHTML = labelHtml;
      div.addEventListener('mousedown', e => {
        e.preventDefault();
        selectOption(i);
      });
      optionsList.appendChild(div);
    });
  }

  function filterOptions() {
    const term = input.value.toLowerCase().trim();
    if (asyncProvider) {
      if (!term) {
        filtered = [];
        renderOptions();
        updateActiveHighlight();
        return;
      }
      asyncProvider(term).then(results => {
        filtered = results || [];
        renderOptions();
        updateActiveHighlight();
      }).catch(() => {
        filtered = [];
        renderOptions();
        updateActiveHighlight();
      });
      return;
    }
    if (!term) {
      filtered = opts.slice();
    } else {
      filtered = opts.filter(opt =>
        (opt[optionLabel] || '').toLowerCase().includes(term)
      );
    }
    activeIndex = -1;
    renderOptions();
    updateActiveHighlight();
  }

  function selectOption(idx) {
    if (idx < 0 || idx >= filtered.length) return;
    const opt = filtered[idx];
    input.value = opt[optionLabel] || '';
    dropdown.style.display = 'none';
    activeIndex = -1;
    if (onOptionSelect) onOptionSelect(opt);
  }

  function openDropdown() {
    if (disabled) return;
    filterOptions();
    dropdown.style.display = 'block';
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
    activeIndex = -1;
    renderOptions();
  }

  function updateActiveHighlight() {
    const items = optionsList.querySelectorAll('.ss-option');
    items.forEach((item, i) => {
      item.classList.toggle('active', i === activeIndex);
    });
  }

  input.addEventListener('focus', () => {
    if (!disabled) openDropdown();
  });

  let asyncDebounce = null;

  input.addEventListener('input', () => {
    if (asyncProvider) {
      clearTimeout(asyncDebounce);
      asyncDebounce = setTimeout(() => filterOptions(), 300);
    } else {
      filterOptions();
    }
    if (onInputClear && input.value.trim() === '') {
      onInputClear();
    }
  });

  input.addEventListener('keydown', e => {
    if (!dropdown.style.display || dropdown.style.display === 'none') {
      if (e.key === 'ArrowDown' && !disabled) {
        e.preventDefault();
        openDropdown();
      }
      return;
    }

    if (e.key === 'Escape') {
      closeDropdown();
      input.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) return;
      activeIndex = activeIndex < filtered.length - 1 ? activeIndex + 1 : 0;
      updateActiveHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length === 0) return;
      activeIndex = activeIndex > 0 ? activeIndex - 1 : filtered.length - 1;
      updateActiveHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        selectOption(activeIndex);
      }
    }
  });

  document.addEventListener('click', e => {
    if (!container.contains(e.target)) {
      closeDropdown();
    }
  });

  return {
    input,
    getValue: () => input.value.trim(),
    setValue: (val) => { input.value = val || ''; },
    setOptions: (newOpts) => { filtered = []; opts.length = 0; opts.push(...newOpts); filterOptions(); },
    setPlaceholder: (text) => { input.placeholder = text || ''; },
    setSublabelKey: (key) => { sublabelKey = key; renderOptions(); },
    disable: (shouldDisable) => {
      disabled = shouldDisable;
      if (disabled) {
        input.disabled = true;
        closeDropdown();
      } else {
        input.disabled = false;
      }
    },
    open: openDropdown,
    close: closeDropdown
  };
}

/* ===================== SETTINGS SEARCHABLE SELECTS ===================== */
let schoolSelect = null;
let departmentSelect = null;
let allDepartments = [];

async function setupSettingsSelects() {
  await loadFutoSchools();
  buildAllDepartments();
  restoreSchoolSelect();
}

function buildAllDepartments() {
  const schools = futoSchools || [];
  allDepartments = [];
  schools.forEach(school => {
    if (school.departments) {
      school.departments.forEach(dept => {
        allDepartments.push({
          name: dept.name,
          code: dept.code,
          schoolName: school.name
        });
      });
    }
  });
}

function onSchoolSelected(school) {
  const depts = (school && school.departments) || [];

  if (departmentSelect) {
    departmentSelect.setOptions(depts);
    departmentSelect.setSublabelKey('code');
    departmentSelect.setPlaceholder('Search departments…');
    departmentSelect.disable(false);
    departmentSelect.setValue('');
  }

  if (school && depts.length) {
    const savedDept = state.meta.department || '';
    if (savedDept) {
      const match = depts.find(d => d.name === savedDept ||
        d.name.toLowerCase() === savedDept.toLowerCase());
      if (match && departmentSelect) {
        departmentSelect.setValue(savedDept);
      }
    }
  }
}

function onSchoolInputCleared() {
  if (!departmentSelect) return;
  departmentSelect.setOptions(allDepartments);
  departmentSelect.setSublabelKey('schoolName');
  departmentSelect.setPlaceholder('Search all departments…');
  departmentSelect.disable(false);
}

function restoreSchoolSelect() {
  const schools = futoSchools || [];
  const schoolOptions = schools.filter(s => s.type === 'school');

  const schoolContainer = document.getElementById('settingFacultyContainer');
  if (schoolContainer && !schoolSelect) {
    schoolSelect = createSearchableSelect(schoolContainer, {
      inputId: 'settingFaculty',
      placeholder: 'Search schools…',
      optionLabel: 'name',
      options: schoolOptions,
      defaultValue: state.meta.school || '',
      onOptionSelect: (school) => {
        onSchoolSelected(school);
      },
      onInputClear: onSchoolInputCleared
    });
  }

  const deptContainer = document.getElementById('settingDepartmentContainer');
  if (deptContainer && !departmentSelect) {
    departmentSelect = createSearchableSelect(deptContainer, {
      inputId: 'settingDepartment',
      placeholder: 'Search all departments…',
      optionLabel: 'name',
      optionSublabel: 'schoolName',
      options: allDepartments,
      defaultValue: state.meta.department || '',
      onOptionSelect: () => {
        if (departmentSelect && departmentSelect.input) {
          departmentSelect.input.blur();
        }
      }
    });
  }

  if (!schoolSelect) return;

  const currentSchool = state.meta.school || '';
  schoolSelect.setValue(currentSchool);

  const match = schoolOptions.find(s => s.name === currentSchool) ||
                schoolOptions.find(s => s.name.toLowerCase() === currentSchool.toLowerCase());

  if (match && departmentSelect) {
    departmentSelect.setOptions(match.departments || []);
    departmentSelect.setSublabelKey('code');
    departmentSelect.setPlaceholder('Search departments…');
    const savedDept = state.meta.department || '';
    if (savedDept) {
      departmentSelect.setValue(savedDept);
    } else {
      departmentSelect.setValue('');
    }
  }
}


/* ===================== INIT ===================== */
initApp();
