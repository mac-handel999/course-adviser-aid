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

checkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  checkError.textContent = '';

  const passcode = passcodeInput.value;
  const regNo = regNoInput.value.trim();

  if (!passcode || !regNo) {
    checkError.textContent = 'Please enter both passcode and registration number.';
    return;
  }

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
      faculty: data.faculty,
      department: data.department,
      results: data.results
    };

    document.getElementById('checkFaculty').textContent = data.faculty || '';
    document.getElementById('checkDepartment').textContent = data.department || '';
    document.getElementById('resultRegNo').textContent = data.regNo;

    const blocks = {};
    (data.results || []).forEach(r => {
      const yearKey = r.year;
      if (!blocks[yearKey]) blocks[yearKey] = {};
      const sem = r.semester;
      if (!blocks[yearKey][sem]) blocks[yearKey][sem] = [];
      blocks[yearKey][sem].push(r);
    });

    const YEAR_KEYS = Object.keys(blocks).sort();
    let html = '';
    let cumUnits = 0;
    let cumPoints = 0;

    YEAR_KEYS.forEach(yearKey => {
      let semHtml = '';
      const semesters = Object.keys(blocks[yearKey]).sort();
      semesters.forEach(sem => {
        const rows = blocks[yearKey][sem];
        let semUnits = 0;
        let semPoints = 0;
        let tableRows = '';
        rows.forEach(r => {
          const unit = parseFloat(r.credit_unit) || 0;
          const gi = gradeInfo(r.score);
          if (gi.point !== null) { semUnits += unit; semPoints += unit * gi.point; cumUnits += unit; cumPoints += unit * gi.point; }
          tableRows += `<tr><td>${escHtml(r.course_code)}</td><td>${escHtml(r.course_title)}</td><td style="text-align:center">${escHtml(r.credit_unit)}</td>
            <td style="text-align:center">${escHtml(r.score)}</td><td style="text-align:center;font-weight:600">${gi.grade}</td>
            <td style="text-align:center">${gi.point === null ? '' : gi.point}</td></tr>`;
        });
        const semGPA = semUnits > 0 ? (semPoints / semUnits).toFixed(2) : '—';
        semHtml += `
          <div class="t-sem-label">${sem}</div>
          <table><thead><tr><th>Code</th><th>Course Title</th><th>Unit</th><th>Score</th><th>Grade</th><th>Point</th></tr></thead>
          <tbody>${tableRows}</tbody></table>
          <div class="t-totals"><span>Units: <b>${semUnits}</b></span><span>Semester GPA: <b>${semGPA}</b></span></div>
        `;
      });
      html += `<div class="t-year-block"><h4>${yearKey}</h4>${semHtml}</div>`;
    });

    const cgpa = cumUnits > 0 ? (cumPoints / cumUnits).toFixed(2) : '—';
    document.getElementById('resultBlocks').innerHTML = html;
    document.getElementById('resultCgpa').textContent = cgpa;
    checkResult.style.display = 'block';
  } catch (err) {
    checkError.textContent = 'No results found for that passcode and registration number.';
    checkResult.style.display = 'none';
  }
});

function escHtml(v) { return (v === undefined || v === null) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ===================== EXCEL EXPORT ===================== */
async function exportResultsExcel() {
  if (!lastResultsData) return;
  const { regNo, faculty, department, results } = lastResultsData;

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Results');

  sheet.mergeCells('A1:G1');
  sheet.getCell('A1').value = 'FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  sheet.getCell('A1').alignment = { horizontal: 'center' };

  sheet.mergeCells('A2:G2');
  sheet.getCell('A2').value = faculty || '';
  sheet.getCell('A2').font = { bold: true, size: 12 };
  sheet.getCell('A2').alignment = { horizontal: 'center' };

  sheet.mergeCells('A3:G3');
  sheet.getCell('A3').value = department || '';
  sheet.getCell('A3').font = { bold: true, size: 12 };
  sheet.getCell('A3').alignment = { horizontal: 'center' };

  sheet.mergeCells('A4:G4');
  sheet.getCell('A4').value = 'UNOFFICIAL / STUDENT COPY — FOR REFERENCE ONLY, NOT AN OFFICIAL TRANSCRIPT';
  sheet.getCell('A4').font = { bold: true, color: { argb: 'FFFF0000' } };
  sheet.getCell('A4').alignment = { horizontal: 'center' };

  try {
    const response = await fetch('/assets/futo-logo.jpeg');
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const imageId = workbook.addImage({ buffer, extension: 'jpg' });
    sheet.addImage(imageId, { tl: { col: 0.5, row: 0.1 }, ext: { width: 48, height: 48 } });
  } catch (e) {
    console.error('Failed to embed logo in Excel:', e);
  }

  const headers = ['Code', 'Course Title', 'Unit', 'Score', 'Grade', 'Point', 'Semester'];
  const headerRow = sheet.getRow(6);
  headers.forEach((header, idx) => {
    const cell = headerRow.getCell(idx + 1);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFF3F1E9' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B4432' } };
  });

  const blocks = {};
  (results || []).forEach(r => {
    const yearKey = r.year;
    if (!blocks[yearKey]) blocks[yearKey] = {};
    const sem = r.semester;
    if (!blocks[yearKey][sem]) blocks[yearKey][sem] = [];
    blocks[yearKey][sem].push(r);
  });

  const sortedYears = Object.keys(blocks).sort();
  let excelRowIdx = 7;
  sortedYears.forEach(yearKey => {
    const semesters = Object.keys(blocks[yearKey]).sort();
    semesters.forEach(sem => {
      blocks[yearKey][sem].forEach(r => {
        const excelRow = sheet.getRow(excelRowIdx);
        const gi = gradeInfo(r.score);
        excelRow.getCell(1).value = r.course_code;
        excelRow.getCell(2).value = r.course_title;
        excelRow.getCell(3).value = r.credit_unit;
        excelRow.getCell(4).value = r.score;
        excelRow.getCell(5).value = gi.grade;
        excelRow.getCell(6).value = gi.point;
        excelRow.getCell(7).value = `${yearKey} - ${sem}`;
        excelRowIdx += 1;
      });
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
  a.download = `Results - ${regNo} (Student Copy).xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('excelBtn').addEventListener('click', exportResultsExcel);
