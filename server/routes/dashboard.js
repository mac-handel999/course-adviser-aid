const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

/* =========================================================================
   Grade thresholds — MUST be kept in sync with gradeInfo() in js/grading.js.
   Threshold duplication risk: if the grading scale ever changes, update BOTH
   this file and js/grading.js. There is no single source of truth shared
   across the Node backend and browser frontend in this project's architecture.
   ========================================================================= */
function gradeFromScore(score) {
  const s = parseFloat(score);
  if (isNaN(s)) return null;
  if (s >= 70) return 'A';
  if (s >= 60) return 'B';
  if (s >= 50) return 'C';
  if (s >= 45) return 'D';
  if (s >= 40) return 'E';
  return 'F';
}

/* ===================== GET /api/dashboard/summary ===================== */
router.get('/summary', async (req, res) => {
  try {
    const { year, semester } = req.query;
    const userId = req.user.id;

    const resultsQuery = supabaseAdmin
      .from('results')
      .select('reg_no, student_name, course_code, course_title, score, is_carryover, updated_at, created_at, year, semester')
      .eq('created_by', userId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false });

    if (year) {
      resultsQuery.eq('year', year);
    }
    if (semester) {
      resultsQuery.eq('semester', semester);
    }

    const { data: results, error: resultsError } = await resultsQuery;
    if (resultsError) {
      console.error('Dashboard summary results error:', resultsError.message);
      return res.status(500).json({ error: 'Failed to load summary data' });
    }

    const rows = results || [];

    /* --- totalStudents: count of DISTINCT reg_no --- */
    const regSet = new Set();
    const carryoverStudents = new Map();
    rows.forEach(r => {
      const reg = (r.reg_no || '').trim();
      if (reg) regSet.add(reg);
      if (r.is_carryover) {
        const key = `${reg}||${(r.student_name || '').trim()}`;
        if (reg && !carryoverStudents.has(reg)) {
          carryoverStudents.set(reg, { reg_no: reg, student_name: r.student_name || '' });
        }
      }
    });

    /* --- totalCourses: count of courses rows in scope --- */
    let coursesQuery = supabaseAdmin
      .from('courses')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (year) {
      coursesQuery = coursesQuery.eq('year', year);
    }
    if (semester) {
      coursesQuery = coursesQuery.eq('semester', semester);
    }
    const { count: coursesCount, error: coursesError } = await coursesQuery;
    if (coursesError) {
      console.error('Dashboard summary courses error:', coursesError.message);
      return res.status(500).json({ error: 'Failed to load summary data' });
    }

    /* --- carryoverCount: results rows where is_carryover = true --- */
    const carryoverCount = rows.filter(r => r.is_carryover).length;

    /* --- gradeDistribution: A/B/C/D/E/F counts --- */
    const gradeDistribution = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
    rows.forEach(r => {
      if (r.score !== null && r.score !== undefined && r.score !== '') {
        const grade = gradeFromScore(r.score);
        if (grade && gradeDistribution.hasOwnProperty(grade)) {
          gradeDistribution[grade]++;
        }
      }
    });

    /* --- recentActivity: 8 most recently updated/created results --- */
    const recentActivity = rows.slice(0, 8).map(r => ({
      student_name: r.student_name || '',
      reg_no: r.reg_no || '',
      course_code: r.course_code || '',
      score: r.score !== null && r.score !== undefined ? r.score : '',
      grade: (r.score !== null && r.score !== undefined && r.score !== '')
        ? gradeFromScore(r.score) || ''
        : '',
      year: r.year || '',
      semester: r.semester || '',
      updated_at: r.updated_at
    }));

    /* --- carryoverStudents: up to 5 distinct pairs + total count --- */
    const carryoverList = Array.from(carryoverStudents.values());
    const carryoverStudentsOut = carryoverList.slice(0, 5);

    /* --- totalRosterStudents: count of students in the canonical roster --- */
    const { count: rosterCount, error: rosterError } = await supabaseAdmin
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (rosterError) {
      console.error('Dashboard summary roster-count error:', rosterError.message);
    }

    res.json({
      totalStudents: regSet.size,
      totalRosterStudents: rosterCount || 0,
      totalCourses: coursesCount || 0,
      carryoverCount,
      gradeDistribution,
      recentActivity,
      carryoverStudents: carryoverStudentsOut,
      carryoverStudentsTotal: carryoverList.length
    });
  } catch (err) {
    console.error('Dashboard summary server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== GET /api/dashboard/gpa-data ===================== */
router.get('/gpa-data', async (req, res) => {
  try {
    const { year, semester } = req.query;
    const userId = req.user.id;

    let query = supabaseAdmin
      .from('results')
      .select('year, semester, course_code, credit_unit, score')
      .eq('created_by', userId)
      .not('reg_no', 'is', null);

    if (year) {
      query = query.eq('year', year);
    }
    if (semester) {
      query = query.eq('semester', semester);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Dashboard gpa-data error:', error.message);
      return res.status(500).json({ error: 'Failed to load GPA data' });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Dashboard gpa-data server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
