  /* ===================== DATA MODEL ===================== */
        const META = {
            university: 'FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI',
            school: 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)',
            department: 'DEPARTMENT OF PUBLIC HEALTH'
        };
        const YEAR_KEYS = Array.from({ length: 10 }, (_, i) => 'Year ' + (i + 1));
        const SEMESTERS = ['Harmattan Semester', 'Rain Semester'];
        const emptyRow = () => ({ regNo: '', name: '', code: '', title: '', unit: '', score: '' });

        let state = { years: {}, currentView: 'Year 1' };
        YEAR_KEYS.forEach(y => {
            state.years[y] = {};
            SEMESTERS.forEach(s => { state.years[y][s] = [emptyRow()]; });
        });

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
            html += `<button class="nav-btn transcript" data-view="Transcript" onclick="switchView('Transcript')">🎓 Transcript Generator</button>`;
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
            if (state.currentView === 'Transcript') {
                container.innerHTML = renderTranscriptView();
                attachTranscriptHandlers();
            } else {
                container.innerHTML = renderYearView(state.currentView);
            }
        }

        /* ===================== YEAR VIEW ===================== */
        function renderYearView(yearKey) {
            let html = `
    <div class="letterhead">
      <img src="assets/advyza-logo.svg" class="letterhead-logo" alt="Advyza Logo">
      <h2>${META.university}</h2>
      <h3>${META.school}</h3>
      <p>${META.department}</p>
      <div class="title-row">${yearKey.toUpperCase()} — RESULT COMPUTATION</div>
    </div>
  `;
            SEMESTERS.forEach(sem => {
                html += renderSemesterBlock(yearKey, sem);
            });
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
          <td><input value="${escAttr(r.regNo)}" placeholder="Reg No" maxlength="11" inputmode="numeric" pattern="\d{11}" oninput="updateCell('${yearKey}','${sem}',${i},'regNo',this.value)"></td>
          <td><input value="${escAttr(r.name)}" placeholder="Student name" oninput="updateCell('${yearKey}','${sem}',${i},'name',this.value)"></td>
          <td class="narrow"><input value="${escAttr(r.code)}" placeholder="Code" oninput="updateCell('${yearKey}','${sem}',${i},'code',this.value)"></td>
          <td><input value="${escAttr(r.title)}" placeholder="Course title" oninput="updateCell('${yearKey}','${sem}',${i},'title',this.value)"></td>
          <td class="narrow"><input type="number" value="${escAttr(r.unit)}" placeholder="Unit" oninput="updateCell('${yearKey}','${sem}',${i},'unit',this.value)"></td>
          <td class="narrow"><input type="number" value="${escAttr(r.score)}" placeholder="Score" oninput="updateScore('${yearKey}','${sem}',${i},this.value)"></td>
          <td class="grade-cell grade-${gi.grade}" id="grade-${yearKey}-${sem}-${i}">${gi.grade}</td>
          <td class="point-cell" id="point-${yearKey}-${sem}-${i}">${gi.point === null ? '' : gi.point}</td>
          <td><button class="icon-btn" title="Delete row" onclick="deleteRow('${yearKey}','${sem}',${i})">✕</button></td>
        </tr>
      `;
                });
            }

            const semSlug = sem.replace(/\s+/g, '-');
            return `
    <div class="semester">
      <div class="semester-head">
        <h3>${sem}</h3>
        <div class="toolbar">
          <button class="btn secondary" onclick="addRow('${yearKey}','${sem}')">+ Add student row</button>
          <button class="btn gold" onclick="exportSemesterExcel('${yearKey}','${sem}')">Export to Excel</button>
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
        }

        function updateScore(yearKey, sem, idx, value) {
            state.years[yearKey][sem][idx].score = value;
            const gi = gradeInfo(value);
            const gradeCell = document.getElementById(`grade-${yearKey}-${sem}-${idx}`);
            const pointCell = document.getElementById(`point-${yearKey}-${sem}-${idx}`);
            if (gradeCell) { gradeCell.textContent = gi.grade; gradeCell.className = 'grade-cell grade-' + gi.grade; }
            if (pointCell) { pointCell.textContent = gi.point === null ? '' : gi.point; }
            refreshSummary(yearKey, sem);
        }

        function addRow(yearKey, sem) {
            state.years[yearKey][sem].push(emptyRow());
            render();
        }

        function deleteRow(yearKey, sem, idx) {
            state.years[yearKey][sem].splice(idx, 1);
            render();
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
      <img src="assets/advyza-logo.svg" class="letterhead-logo" alt="Advyza Logo">
      <h2>${META.university}</h2>
      <h3>${META.school}</h3>
      <p>${META.department}</p>
      <div class="title-row">STUDENT TRANSCRIPT GENERATOR</div>
    </div>

    <div class="transcript-search">
      <div class="field">
        <label>Registration Number</label>
        <input id="transcriptRegNo" placeholder="e.g. 20241234567">
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

        let lastTranscript = null;

        function generateTranscript() {
            const regNo = document.getElementById('transcriptRegNo').value.trim();
            const output = document.getElementById('transcriptOutput');
            if (!regNo) { output.innerHTML = '<p class="no-record">Please enter a registration number.</p>'; return; }

            let studentName = '';
            let cumUnits = 0, cumPoints = 0;
            let yearBlocksHtml = '';
            let foundAny = false;
            const flatRows = []; // for excel export

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
            lastTranscript = { regNo, studentName, cgpa, flatRows };
        }

        /* ===================== EXCEL EXPORT ===================== */
        function exportSemesterExcel(yearKey, sem) {
            const rows = state.years[yearKey][sem];
            const data = rows.map(r => {
                const gi = gradeInfo(r.score);
                return {
                    'Reg No': r.regNo, 'Student Name': r.name, 'Course Code': r.code, 'Course Title': r.title,
                    'Credit Unit': r.unit, 'Score': r.score, 'Grade': gi.grade, 'Grade Point': gi.point
                };
            });
            const ws = XLSX.utils.json_to_sheet(data);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, sem.replace(/[:\\\/\?\*\[\]]/g, ''));
            XLSX.writeFile(wb, `${yearKey} - ${sem}.xlsx`);
        }

        function exportTranscriptExcel() {
            if (!lastTranscript) return;
            const ws = XLSX.utils.json_to_sheet(lastTranscript.flatRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Transcript');
            XLSX.writeFile(wb, `Transcript - ${lastTranscript.regNo}.xlsx`);
        }

        /* ===================== UTIL ===================== */
        function escAttr(v) { return (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;'); }
        function escHtml(v) { return (v === undefined || v === null) ? '' : String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

        /* ===================== INIT ===================== */
        buildNav();
        switchView('Year 1');