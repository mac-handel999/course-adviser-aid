/* =========================================================================
    Advyza — shared grading logic

    Grading scale (5-point):
    Score >= 70  -> A (5)
    Score >= 60  -> B (4)
    Score >= 50  -> C (3)
    Score >= 45  -> D (2)
    Score >= 40  -> E (1)
    Score < 40   -> F (0)

    Used by both the adviser app (js/app.js) and the public student
    check-results page (js/check-results.js).
    ========================================================================= */

const YEAR_ORDER = ['Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7','Year 8','Year 9','Year 10'];
const SEMESTER_ORDER = ['Harmattan Semester','Rain Semester'];

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

function rowKey(row) {
  const year = String(row.year || '').trim();
  const sem = String(row.semester || '').trim();
  const code = String(row.course_code || row.code || '').trim().toUpperCase();
  return { year, sem, code };
}

function compareRows(a, b) {
  const ay = YEAR_ORDER.indexOf(a.year) >= 0 ? YEAR_ORDER.indexOf(a.year) : 999;
  const by = YEAR_ORDER.indexOf(b.year) >= 0 ? YEAR_ORDER.indexOf(b.year) : 999;
  if (ay !== by) return ay - by;
  const as = SEMESTER_ORDER.indexOf(a.semester) >= 0 ? SEMESTER_ORDER.indexOf(a.semester) : 999;
  const bs = SEMESTER_ORDER.indexOf(b.semester) >= 0 ? SEMESTER_ORDER.indexOf(b.semester) : 999;
  if (as !== bs) return as - bs;
  const at = a.updated_at || a.created_at || '';
  const bt = b.updated_at || b.created_at || '';
  if (at && bt) return at < bt ? -1 : at > bt ? 1 : 0;
  return 0;
}

function computeGpaStats(rows, configuredTotalUnits) {
  if (!rows || !rows.length) {
    return { gpa: null, unitsEntered: 0, unitsConfigured: configuredTotalUnits ?? null, isIncomplete: false, percentComplete: null, dedupedRows: [] };
  }

  const byCode = {};
  rows.forEach(r => {
    const code = String(r.course_code || r.code || '').trim().toUpperCase();
    if (!code) return;
    if (!byCode[code]) byCode[code] = [];
    byCode[code].push(r);
  });

  const dedupedRows = [];
  Object.keys(byCode).sort().forEach(code => {
    const group = byCode[code];
    group.sort(compareRows);
    dedupedRows.push(group[group.length - 1]);
  });

  let unitsEntered = 0;
  let totalPoints = 0;
  dedupedRows.forEach(r => {
    const unit = parseFloat(r.credit_unit || r.unit) || 0;
    const gi = gradeInfo(r.score);
    if (gi.point !== null) {
      unitsEntered += unit;
      totalPoints += unit * gi.point;
    }
  });

  const gpa = unitsEntered > 0 ? totalPoints / unitsEntered : null;
  const unitsConfigured = configuredTotalUnits ?? null;
  const isIncomplete = unitsConfigured !== null && unitsEntered < unitsConfigured;
  const percentComplete = unitsConfigured ? Math.round((unitsEntered / unitsConfigured) * 100) : null;

  return { gpa, unitsEntered, unitsConfigured, isIncomplete, percentComplete, dedupedRows };
}
