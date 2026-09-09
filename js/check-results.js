/* =========================================================================
   FUTO Public Health Results Portal — student check results page

   Public lookup via /api/public/portal/:slug/lookup with passcode +
   registration number. No Supabase auth required.
   ========================================================================= */

const portalSlug = (window.location.pathname || '').split('/').filter(Boolean).pop() || '';

if (!portalSlug) {
  document.getElementById('checkFaculty').textContent = 'Invalid portal link.';
  document.getElementById('checkDepartment').textContent = '';
}

const checkForm = document.getElementById('checkForm');
const checkError = document.getElementById('checkError');
const checkResult = document.getElementById('checkResult');

checkForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  checkError.textContent = '';

  const passcode = document.getElementById('passcode').value;
  const regNo = document.getElementById('regNo').value.trim();

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
