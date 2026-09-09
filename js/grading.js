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
