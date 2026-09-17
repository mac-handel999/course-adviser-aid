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
       .select('year, semester, course_code, credit_unit, score, reg_no, student_name')
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

/* ===================== GET /api/dashboard/top-scores =====================
   For each course in scope, find the highest score among that course's results
   rows, using each student's LATEST counted attempt only (same chronological
   dedup as computeGpaStats in the frontend — latest by updated_at then
   created_at).  Returns course_code, course_title, top_score, and
   top_scorers (array of {reg_no, student_name}) — including ALL ties. */
router.get('/top-scores', async (req, res) => {
  try {
    const { year, semester } = req.query;
    const userId = req.user.id;

    let query = supabaseAdmin
      .from('results')
      .select('course_code, course_title, score, reg_no, student_name, updated_at, created_at')
      .eq('created_by', userId)
      .not('reg_no', 'is', null);

    if (year) {
      query = query.eq('year', year);
    }
    if (semester) {
      query = query.eq('semester', semester);
    }

    const { data: results, error } = await query;
    if (error) {
      console.error('Dashboard top-scores error:', error.message);
      return res.status(500).json({ error: 'Failed to load top scores' });
    }

    // Deduplicate: for each (reg_no, course_code) pick the latest by updated_at/created_at
    const YEAR_ORDER = ['Year 1','Year 2','Year 3','Year 4','Year 5','Year 6','Year 7','Year 8','Year 9','Year 10'];
    const SEMESTER_ORDER = ['Harmattan Semester','Rain Semester'];

    const latestByKey = {};
    (results || []).forEach(r => {
      if (!r.score && r.score !== 0) return;
      const key = `${r.reg_no || ''}||${r.course_code || ''}`;
      const existing = latestByKey[key];
      if (!existing) {
        latestByKey[key] = r;
        return;
      }
      const compare = (a, b) => {
        const at = a.updated_at || a.created_at || '';
        const bt = b.updated_at || b.created_at || '';
        if (!at && !bt) return 0;
        if (!at) return -1;
        if (!bt) return 1;
        return at < bt ? -1 : at > bt ? 1 : 0;
      };
      if (compare(r, existing) > 0) {
        latestByKey[key] = r;
      }
    });

    // Group by course_code and find max score per course
    const byCourse = {};
    Object.values(latestByKey).forEach(r => {
      const code = (r.course_code || '').trim().toUpperCase();
      if (!code) return;
      if (!byCourse[code]) byCourse[code] = [];
      byCourse[code].push(r);
    });

    const output = Object.keys(byCourse).map(code => {
      const rows = byCourse[code];
      const maxScore = Math.max(...rows.map(r => parseFloat(r.score)));
      const scorers = rows
        .filter(r => parseFloat(r.score) === maxScore)
        .map(r => ({ reg_no: r.reg_no || '', student_name: r.student_name || '' }));
      return {
        course_code: rows[0].course_code || '',
        course_title: rows[0].course_title || '',
        top_score: maxScore,
        top_scorers: scorers
      };
    }).sort((a, b) => {
      if (a.top_score !== b.top_score) return b.top_score - a.top_score;
      return a.course_code < b.course_code ? -1 : a.course_code > b.course_code ? 1 : 0;
    });

    res.json(output);
  } catch (err) {
    console.error('Dashboard top-scores server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
