/* =========================================================================
   Advyza — student check results page

   Public lookup via /api/public/portal/:slug/lookup with passcode +
   registration number. No Supabase auth required.

   The canonical URL shape is /students-results/:slug, served through the
   Vercel rewrite in vercel.json. That rewrite is NOT honored by plain
   static-file servers (VS Code Live Server, python -m http.server, etc.),
   so this script also accepts ?portal=<slug> as a fallback for local
   testing without vercel dev.

   The passcode and regNo are submitted together in one request. This is
   deliberate: splitting them into two separate server checks would let a
   student confirm a valid passcode independently of a reg no, which would
   reopen the enumeration risk the combined generic-error design was built
   to prevent.
   ========================================================================= */

function getPortalSlug() {
  const pathSlug = (window.location.pathname || '').split('/').filter(Boolean).pop() || '';
  if (pathSlug && pathSlug !== 'check-results.html') {
    return pathSlug;
  }
  const params = new URLSearchParams(window.location.search);
  const querySlug = (params.get('portal') || '').trim();
  if (querySlug) {
    return querySlug;
  }
  return '';
}

const portalSlug = getPortalSlug();

if (!portalSlug) {
  document.getElementById('checkFaculty').textContent = 'Invalid portal link.';
  document.getElementById('checkDepartment').textContent = '';
}

const checkForm = document.getElementById('checkForm');
const checkError = document.getElementById('checkError');
const checkResult = document.getElementById('checkResult');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const continueBtn = document.getElementById('continueBtn');
const passcodeInput = document.getElementById('passcode');
const regNoInput = document.getElementById('regNo');

function sanitizeRegNo(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

function validateRegNo(input) {
  const value = sanitizeRegNo(input.value);
  input.value = value;
  if (value.length > 0 && value.length !== 11) {
    checkError.textContent = 'Registration number must be exactly 11 digits.';
    return false;
  }
  return true;
}

if (regNoInput) {
  regNoInput.addEventListener('input', () => {
    regNoInput.value = sanitizeRegNo(regNoInput.value);
  });
  regNoInput.addEventListener('blur', () => validateRegNo(regNoInput));
}

function showStep2() {
  if (!passcodeInput.value.trim()) {
    checkError.textContent = 'Please enter your passcode.';
    return;
  }
  checkError.textContent = '';
  step1.style.display = 'none';
  step2.style.display = 'block';
  regNoInput.focus();
}

if (continueBtn) {
  continueBtn.addEventListener('click', (e) => {
    e.preventDefault();
    showStep2();
  });
}

let lastResultsData = null;
let currentYearFilter = 'all';

function buildBlocks(results) {
  const blocks = {};
  (results || []).forEach(r => {
    const yearKey = r.year;
    if (!blocks[yearKey]) blocks[yearKey] = {};
    const sem = r.semester;
    if (!blocks[yearKey][sem]) blocks[yearKey][sem] = [];
    blocks[yearKey][sem].push(r);
  });
  return blocks;
}

function buildSemesterHtml(rows, yearKey, sem, creditLoad, academicSessions) {
  const configuredTotal = (creditLoad && creditLoad[yearKey] && creditLoad[yearKey][sem]) || null;
  const stats = computeGpaStats(rows, configuredTotal);
  let tableRows = '';
  rows.forEach(r => {
    const gi = gradeInfo(r.score);
    const carryBadge = r.is_carryover ? ' <span class="carry-badge">C/O</span>' : '';
    tableRows += `<tr><td>${escHtml(r.course_code)}${carryBadge}</td><td>${escHtml(r.course_title)}</td><td style="text-align:center">${escHtml(r.credit_unit)}</td>
      <td style="text-align:center">${escHtml(r.score)}</td><td style="text-align:center;font-weight:600">${gi.grade}</td>
      <td style="text-align:center">${gi.point === null ? '' : gi.point}</td></tr>`;
  });

  const semGpaText = stats.gpa !== null ? stats.gpa.toFixed(2) : '—';
  let semTotalsHtml = `<span>Units: <b>${stats.unitsEntered}</b></span><span>Semester GPA: <b>${semGpaText}</b></span>`;
  if (stats.unitsConfigured !== null) {
    semTotalsHtml += `<span>Completion: <b>${stats.unitsEntered} of ${stats.unitsConfigured} units (${stats.percentComplete}%)</b></span>`;
  }

  const sessionPart = academicSessions && academicSessions[yearKey] ? ` — ${academicSessions[yearKey]}` : '';

  return `
    <div class="t-sem-label">${sem}${sessionPart}</div>
    <table><thead><tr><th>Code</th><th>Course Title</th><th>Unit</th><th>Score</th><th>Grade</th><th>Point</th></tr></thead>
    <tbody>${tableRows}</tbody></table>
    <div class="t-totals">${semTotalsHtml}</div>
  `;
}

function renderResultsBlocks(blocks, creditLoad, academicSessions) {
  const YEAR_KEYS = Object.keys(blocks).sort();
  let html = '';

  YEAR_KEYS.forEach(yearKey => {
    let semHtml = '';
    const semesters = Object.keys(blocks[yearKey]).sort();
    semesters.forEach(sem => {
      semHtml += buildSemesterHtml(blocks[yearKey][sem], yearKey, sem, creditLoad, academicSessions);
    });
    const yearLabel = `${yearKey}${academicSessions && academicSessions[yearKey] ? ' — ' + academicSessions[yearKey] : ''}`;
    html += `<div class="t-year-block" data-year="${escHtml(yearKey)}"><h4>${yearLabel}</h4>${semHtml}</div>`;
  });

  return html;
}

function computeOverallStats(blocks, creditLoad, academicSessions) {
  const allStudentRows = [];
  let cumConfiguredTotal = 0;
  const YEAR_KEYS = Object.keys(blocks).sort();

  YEAR_KEYS.forEach(yearKey => {
    const semesters = Object.keys(blocks[yearKey]).sort();
    semesters.forEach(sem => {
      const rows = blocks[yearKey][sem];
      allStudentRows.push(...rows);
      const configuredTotal = (creditLoad && creditLoad[yearKey] && creditLoad[yearKey][sem]) || null;
      if (configuredTotal) cumConfiguredTotal += configuredTotal;
    });
  });

  return { allStudentRows, cumConfiguredTotal };
}

function populateYearFilter(blocks, academicSessions) {
  const filterSelect = document.getElementById('yearFilter');
  if (!filterSelect) return;

  const YEAR_KEYS = Object.keys(blocks).sort();
  filterSelect.innerHTML = '<option value="all">All Years</option>';

  YEAR_KEYS.forEach(yearKey => {
    const sessionLabel = academicSessions && academicSessions[yearKey]
      ? ` — ${academicSessions[yearKey]}`
      : '';
    const option = document.createElement('option');
    option.value = yearKey;
    option.textContent = `Year ${yearKey}${sessionLabel}`;
    filterSelect.appendChild(option);
  });
}

function applyYearFilter(blocks, creditLoad, academicSessions) {
  const yearBlocks = document.querySelectorAll('#resultBlocks .t-year-block');
  const filterSelect = document.getElementById('yearFilter');
  const selectedYear = filterSelect ? filterSelect.value : 'all';

  yearBlocks.forEach(block => {
    const blockYear = block.getAttribute('data-year');
    if (selectedYear === 'all' || blockYear === selectedYear) {
      block.classList.remove('hidden-print');
    } else {
      block.classList.add('hidden-print');
    }
  });

  const cgpaBanner = document.getElementById('cgpaBanner');
  const cgpaLabel = document.getElementById('cgpaLabel');
  const cgpaValue = document.getElementById('resultCgpa');

  if (selectedYear === 'all') {
    cgpaLabel.textContent = 'Cumulative Grade Point Average (CGPA)';
    const { allStudentRows, cumConfiguredTotal } = computeOverallStats(blocks, creditLoad, academicSessions);
    const cumStats = computeGpaStats(allStudentRows, cumConfiguredTotal || null);
    const cgpaText = cumStats.gpa !== null ? cumStats.gpa.toFixed(2) : '—';
    let cgpaHtml = `<span>CGPA: <b>${cgpaText}</b></span>`;
    if (cumStats.unitsConfigured !== null) {
      cgpaHtml = `<span>CGPA: <b>${cgpaText}</b></span><span>Completion: <b>${cumStats.unitsEntered} of ${cumStats.unitsConfigured} units (${cumStats.percentComplete}%)</b></span>`;
    }
    cgpaValue.innerHTML = cgpaHtml;
  } else {
    cgpaLabel.textContent = 'Year GPA';
    const yearRows = [];
    let yearConfiguredTotal = 0;
    const semesters = Object.keys(blocks[selectedYear]).sort();
    semesters.forEach(sem => {
      const rows = blocks[selectedYear][sem];
      yearRows.push(...rows);
      const configuredTotal = (creditLoad && creditLoad[selectedYear] && creditLoad[selectedYear][sem]) || null;
      if (configuredTotal) yearConfiguredTotal += configuredTotal;
    });
    const yearStats = computeGpaStats(yearRows, yearConfiguredTotal || null);
    const yearGpaText = yearStats.gpa !== null ? yearStats.gpa.toFixed(2) : '—';
    let yearHtml = `<span>Year GPA: <b>${yearGpaText}</b></span>`;
    if (yearStats.unitsConfigured !== null) {
      yearHtml = `<span>Year GPA: <b>${yearGpaText}</b></span><span>Completion: <b>${yearStats.unitsEntered} of ${yearStats.unitsConfigured} units (${yearStats.percentComplete}%)</b></span>`;
    }
    cgpaValue.innerHTML = yearHtml;
  }
}

checkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  checkError.textContent = '';

  const passcode = passcodeInput.value;
  const regNo = sanitizeRegNo(regNoInput.value);

  if (!passcode || !regNo) {
    checkError.textContent = 'Please enter both passcode and registration number.';
    return;
  }

  if (regNo.length !== 11) {
    checkError.textContent = 'Registration number must be exactly 11 digits.';
    return;
  }

  regNoInput.value = regNo;
  showLoading('Checking results…');
  try {
    const res = await fetch(`/api/public/portal/${encodeURIComponent(portalSlug)}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode, regNo })
    });

    const data = await res.json();

    if (!res.ok) {
      checkError.textContent = data.error || 'No results found for that passcode and registration number.';
      checkResult.style.display = 'none';
      return;
    }

    lastResultsData = {
      regNo: data.regNo,
      studentName: data.studentName,
      faculty: data.faculty,
      department: data.department,
      results: data.results,
      creditLoad: data.creditLoad || {},
      academicSessions: data.academicSessions || {}
    };

    document.getElementById('checkFaculty').textContent = data.faculty || '';
    document.getElementById('checkDepartment').textContent = data.department || '';
    document.getElementById('resultRegNo').textContent = data.regNo || '';
    document.getElementById('resultStudentName').textContent = data.studentName || '';
    document.getElementById('studentNameDisplay').textContent = data.studentName || '';

    const blocks = buildBlocks(data.results);
    populateYearFilter(blocks, data.academicSessions || {});

    document.getElementById('resultBlocks').innerHTML = renderResultsBlocks(blocks, data.creditLoad || {}, data.academicSessions || {});

    const yearFilterWrap = document.querySelector('.year-filter-wrap');
    if (yearFilterWrap) yearFilterWrap.style.display = 'block';

    currentYearFilter = 'all';
    document.getElementById('yearFilter').value = 'all';
    applyYearFilter(blocks, data.creditLoad || {}, data.academicSessions || {});

    checkResult.style.display = 'block';
  } catch (err) {
    checkError.textContent = 'No results found for that passcode and registration number.';
    checkResult.style.display = 'none';
  } finally {
    hideLoading();
  }
});

document.getElementById('yearFilter').addEventListener('change', function() {
  if (!lastResultsData) return;
  const blocks = buildBlocks(lastResultsData.results || []);
  currentYearFilter = this.value;
  applyYearFilter(blocks, lastResultsData.creditLoad || {}, lastResultsData.academicSessions || {});
});

function escHtml(v) { return (v === undefined || v === null) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ===================== EXCEL EXPORT ===================== */
function crExcelColLetter(n) { return String.fromCharCode(64 + n); }
function crExcelSpan(colCount, row) { return `A${row}:${crExcelColLetter(colCount)}${row}`; }
function crExcelHeaderRow(sheet, rowNum, headers) {
  const row = sheet.getRow(rowNum);
  headers.forEach((headerText, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = headerText;
    cell.font = { bold: true, color: { argb: 'FFF3F1E9' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
}
function crExcelContentWidths(headers, dataRows) {
  const widths = headers.map(h => {
    const len = String(h === undefined || h === null ? '' : h).length;
    const base = Math.min(Math.max(len + 3, 8), 50);
    return Math.max(base, crExcelGetMinWidth(h));
  });
  if (dataRows) {
    dataRows.forEach(rowValues => {
      for (let i = 0; i < headers.length; i++) {
        const val = rowValues[i];
        if (val !== undefined && val !== null && val !== '') {
          const len = String(val).length;
          const computed = Math.min(len + 3, 50);
          widths[i] = Math.max(widths[i], Math.max(computed, crExcelGetMinWidth(headers[i])));
        }
      }
    });
  }
  return widths.map(w => Math.min(w, 60));
}

const CR_EXCEL_MIN_WIDTHS = {
  'Student Name': 28, 'Name': 28,
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
const CR_EXCEL_DEFAULT_MIN = 10;
function crExcelGetMinWidth(header) {
  return CR_EXCEL_MIN_WIDTHS[header] || CR_EXCEL_DEFAULT_MIN;
}

function crExcelWriteMetadataBlock(sheet, colCount, documentTitle, faculty, department, semester, session, exportDateStr) {
  let row = 1;
  const exportDate = exportDateStr || new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  sheet.mergeCells(crExcelSpan(colCount, row));
  var cell = sheet.getCell('A' + row);
  cell.value = 'FEDERAL UNIVERSITY OF TECHNOLOGY, OWERRI';
  cell.font = { bold: true, size: 14 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(row).height = 40;
  row++;

  sheet.mergeCells(crExcelSpan(colCount, row));
  cell = sheet.getCell('A' + row);
  cell.value = documentTitle;
  cell.font = { bold: true, size: 13 };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(row).height = 28;
  row++;

  var r3 = sheet.getRow(row);
  r3.getCell(1).value = 'School of Student:';
  r3.getCell(2).value = faculty || '';
  r3.getCell(3).value = 'Semester:';
  r3.getCell(4).value = semester || '';
  [1, 3].forEach(function (c) { r3.getCell(c).font = { bold: true }; });
  sheet.getRow(row).height = 22;
  row++;

  var r4 = sheet.getRow(row);
  r4.getCell(1).value = 'Department:';
  r4.getCell(2).value = department || '';
  r4.getCell(3).value = 'Session:';
  r4.getCell(4).value = session || '';
  r4.getCell(5).value = 'Date:';
  r4.getCell(6).value = exportDate;
  [1, 3, 5].forEach(function (c) { r4.getCell(c).font = { bold: true }; });
  sheet.getRow(row).height = 22;
  row++;

  // Blank spacer row
  sheet.getRow(row).height = 14;
  row++;

  return row;
}

async function exportResultsExcel() {
  if (!lastResultsData) return;
  showLoading('Exporting to Excel…');
  try {
  const { regNo, studentName, faculty, department, results, academicSessions } = lastResultsData;

  // Build headers (with optional Program/Remark columns)
  const includeProgRem = results.length > 0 && results.some(r => (r.program || '').trim() !== '' || (r.remark || '').trim() !== '');
  const headers = ['Code', 'Course Title', 'Unit', 'Score', 'Grade', 'Point'];
  if (includeProgRem) headers.push('Program', 'Remark');
  headers.push('Semester', 'Session');
  const colCount = headers.length;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');

  // Metadata block (non-course-scoped)
  const headerRowNum = crExcelWriteMetadataBlock(sheet, colCount, 'STUDENT RESULTS', faculty, department, 'All Semesters', '', new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  }));

  // Watermark note row (bold red, centered)
  sheet.mergeCells(crExcelSpan(colCount, headerRowNum));
  var wmCell = sheet.getCell('A' + headerRowNum);
  wmCell.value = 'UNOFFICIAL / STUDENT COPY — FOR REFERENCE ONLY, NOT AN OFFICIAL TRANSCRIPT';
  wmCell.font = { bold: true, color: { argb: 'FFFF0000' } };
  wmCell.alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(headerRowNum).height = 20;
  const dataHeaderRowNum = headerRowNum + 1;

  // Fetch and embed logos
  try {
    const response = await fetch('/assets/futo-logo.jpeg');
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const imageId = workbook.addImage({ buffer, extension: 'jpg' });
    const logoSize = 32;
    const rightCol = Math.max(colCount - 0.3, 0.7);
    sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: logoSize, height: logoSize } });
    sheet.addImage(imageId, { tl: { col: rightCol, row: 0.1 }, ext: { width: logoSize, height: logoSize } });
  } catch (e) {
    console.error('Failed to embed logo in Excel:', e);
  }

  crExcelHeaderRow(sheet, dataHeaderRowNum, headers);

  const blocks = buildBlocks(results);
  const sortedYears = Object.keys(blocks).sort();

  const exportYears = currentYearFilter === 'all' ? sortedYears : [currentYearFilter];
  const dataRowsForWidth = [];
  let excelRowIdx = dataHeaderRowNum + 1;

  exportYears.forEach(yearKey => {
    const session = academicSessions[yearKey] || '';
    const semesters = Object.keys(blocks[yearKey]).sort();
    semesters.forEach(sem => {
      blocks[yearKey][sem].forEach(r => {
        const excelRow = sheet.getRow(excelRowIdx);
        const gi = gradeInfo(r.score);
        const scoreVal = r.score === '' ? null : parseFloat(r.score);
        const pointVal = gi.point === null ? '' : gi.point;
        const values = [r.course_code, r.course_title, r.credit_unit, scoreVal, gi.grade || '', pointVal];
        if (includeProgRem) {
          values.push(r.program || '', r.remark || '');
        }
        values.push(`${yearKey} - ${sem}`, session);
        values.forEach((val, colIdx) => { excelRow.getCell(colIdx + 1).value = val; });
        for (let c = 1; c <= colCount; c++) { excelRow.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' }; }
        dataRowsForWidth.push(values);
        excelRowIdx += 1;
      });
    });
  });

  // Apply generous column widths with metadata label minimums
  const colWidths = crExcelContentWidths(headers, dataRowsForWidth);
  // Metadata block uses label:value pairs in first 6 columns; ensure wide enough
  const metaMins = [18, 20, 15, 16, 15, 26];
  for (let i = 0; i < Math.min(metaMins.length, colWidths.length); i++) {
    colWidths[i] = Math.max(colWidths[i], metaMins[i]);
  }
  excelSetWidths(sheet, colWidths);

  // Row heights
  sheet.getRow(dataHeaderRowNum).height = 24;
  for (let r = dataHeaderRowNum + 1; r < excelRowIdx; r++) { sheet.getRow(r).height = 16; }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;

  const filterLabel = currentYearFilter === 'all'
    ? 'All Years'
    : `Year ${currentYearFilter}`;
  a.download = `Results - ${regNo} - ${filterLabel}.xlsx`;

  a.click();
  URL.revokeObjectURL(url);
  } finally {
    hideLoading();
  }
}

function excelSetWidths(sheet, widths) {
  widths.forEach((w, idx) => { sheet.getColumn(idx + 1).width = w; });
}

document.getElementById('excelBtn').addEventListener('click', exportResultsExcel);
