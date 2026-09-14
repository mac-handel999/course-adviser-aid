const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

/* ===================== GET /api/courses?year=&semester= =====================
   List this adviser's courses for the given year + semester.
   Returns course metadata plus a student-count per course:
   the count of distinct reg_no among results rows linked via course_id. */
router.get('/', async (req, res) => {
  try {
    const { year, semester } = req.query;

    let query = supabaseAdmin
      .from('courses')
      .select('id, year, semester, course_code, course_title, credit_unit, offering_school, use_score_components')
      .eq('user_id', req.user.id);

    if (year) query = query.eq('year', year);
    if (semester) query = query.eq('semester', semester);

    query = query.order('course_code', { ascending: true });

    const { data: courses, error } = await query;

    if (error) {
      console.error('Courses GET error:', error.message);
      return res.status(500).json({ error: 'Failed to load courses' });
    }

    // Fetch student counts from results table
    const courseIds = courses.map(c => c.id);
    let studentCounts = {};

    if (courseIds.length > 0) {
      const { data: countData, error: countError } = await supabaseAdmin
        .from('results')
        .select('course_id, reg_no')
        .in('course_id', courseIds)
        .not('reg_no', 'is', null);

      if (countError) {
        console.error('Courses student-count error:', countError.message);
      } else {
        const seen = {};
        (countData || []).forEach(r => {
          if (r.course_id && r.reg_no) {
            if (!seen[r.course_id]) seen[r.course_id] = new Set();
            seen[r.course_id].add(r.reg_no);
          }
        });
        Object.keys(seen).forEach(cid => {
          studentCounts[cid] = seen[cid].size;
        });
      }
    }

    const result = courses.map(c => ({
      ...c,
      studentCount: studentCounts[c.id] || 0
    }));

    res.json(result);
  } catch (err) {
    console.error('Courses server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== POST /api/courses =====================
   Create a new course for the current adviser.
   Accepts: { year, semester, course_code, course_title, credit_unit }
   Returns 409 if (year, semester, course_code) already exists for this user. */
router.post('/', async (req, res) => {
  try {
    const { year, semester, course_code, course_title, credit_unit, offering_school, use_score_components } = req.body;

    if (!year || !semester || !course_code) {
      return res.status(400).json({ error: 'year, semester, and course_code are required.' });
    }

    const normalizedCode = String(course_code).trim().toUpperCase();
    const normalizedTitle = String(course_title || '').trim();
    const normalizedUnit = credit_unit !== undefined && credit_unit !== null && String(credit_unit).trim() !== ''
      ? parseFloat(credit_unit)
      : null;
    const normalizedOfferingSchool = offering_school !== undefined && offering_school !== null && String(offering_school).trim() !== ''
      ? String(offering_school).trim()
      : null;

    if (normalizedUnit !== null && (isNaN(normalizedUnit) || normalizedUnit <= 0)) {
      return res.status(400).json({ error: 'credit_unit must be a positive number.' });
    }

    const { data: existing, error: checkError } = await supabaseAdmin
      .from('courses')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('year', String(year).trim())
      .eq('semester', String(semester).trim())
      .eq('course_code', normalizedCode)
      .maybeSingle();

    if (checkError) {
      console.error('Courses POST duplicate-check error:', checkError.message);
      return res.status(500).json({ error: 'Failed to check existing course' });
    }

    if (existing) {
      return res.status(409).json({ error: `Course ${normalizedCode} already exists in ${year} — ${semester} for this adviser.` });
    }

    const { data, error } = await supabaseAdmin
      .from('courses')
      .insert({
        user_id: req.user.id,
        year: String(year).trim(),
        semester: String(semester).trim(),
        course_code: normalizedCode,
        course_title: normalizedTitle || null,
        credit_unit: normalizedUnit,
        offering_school: normalizedOfferingSchool,
        use_score_components: !!use_score_components
      })
      .select('id, year, semester, course_code, course_title, credit_unit, offering_school, use_score_components')
      .single();

    if (error) {
      console.error('Courses POST insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create course' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Courses POST server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== DELETE /api/courses/:id =====================
   Delete a course AND all its associated results rows.
   Ownership-checked: returns 404 if the course doesn't belong to req.user.id.
   Returns { deletedResults: N } indicating how many results rows were removed. */
async function supabaseDeleteWithRetry(builderFn, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await builderFn();
    if (!result.error) return result;
    const msg = result.error.message || '';
    if (msg.includes('fetch failed') && attempt < maxRetries) {
      console.warn(`Supabase DELETE transient error (attempt ${attempt + 1}/${maxRetries}), retrying...`);
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    return result;
  }
  return { error: { message: 'Max retries reached' } };
}

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Verify ownership first (404, not 403, matching existing pattern)
    const { data: course, error: checkError } = await supabaseAdmin
      .from('courses')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle();

    if (checkError) {
      console.error('Courses DELETE ownership-check error:', checkError.message);
      return res.status(500).json({ error: 'Failed to verify course ownership' });
    }

    if (!course || course.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Delete all results rows linked to this course
    const { count: deletedResults, error: resultsDeleteError } = await supabaseDeleteWithRetry(() =>
      supabaseAdmin
        .from('results')
        .delete({ count: 'exact' })
        .eq('course_id', id)
        .eq('created_by', req.user.id)
    );

    if (resultsDeleteError) {
      console.error('Courses DELETE results error:', resultsDeleteError.message);
      return res.status(500).json({ error: 'Failed to delete associated results' });
    }

    // Delete the course itself
    const { error: courseDeleteError } = await supabaseDeleteWithRetry(() =>
      supabaseAdmin
        .from('courses')
        .delete()
        .eq('id', id)
        .eq('user_id', req.user.id)
    );

    if (courseDeleteError) {
      console.error('Courses DELETE course error:', courseDeleteError.message);
      return res.status(500).json({ error: 'Failed to delete course' });
    }

    res.json({ success: true, deletedResults: deletedResults || 0 });
  } catch (err) {
    console.error('Courses DELETE server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== PATCH /api/courses/:id =====================
   Update editable course metadata (course_title, credit_unit, offering_school,
   use_score_components).  Ownership-checked. */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { course_title, credit_unit, offering_school, use_score_components } = req.body;

    const { data: course, error: checkError } = await supabaseAdmin
      .from('courses')
      .select('user_id')
      .eq('id', id)
      .maybeSingle();

    if (checkError) {
      console.error('Courses PATCH ownership-check error:', checkError.message);
      return res.status(500).json({ error: 'Failed to verify course ownership' });
    }
    if (!course || course.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Course not found' });
    }

    const updates = {};
    if (course_title !== undefined) updates.course_title = String(course_title || '').trim() || null;
    if (credit_unit !== undefined) {
      const u = credit_unit !== null && String(credit_unit).trim() !== '' ? parseFloat(credit_unit) : null;
      if (u !== null && (isNaN(u) || u <= 0)) {
        return res.status(400).json({ error: 'credit_unit must be a positive number.' });
      }
      updates.credit_unit = u;
    }
    if (offering_school !== undefined) {
      updates.offering_school = String(offering_school || '').trim() !== '' ? String(offering_school).trim() : null;
    }
    if (use_score_components !== undefined) {
      updates.use_score_components = !!use_score_components;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    const { data, error } = await supabaseAdmin
      .from('courses')
      .update(updates)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .select('id, year, semester, course_code, course_title, credit_unit, offering_school, use_score_components')
      .single();

    if (error) {
      console.error('Courses PATCH update error:', error.message);
      return res.status(500).json({ error: 'Failed to update course' });
    }

    res.json(data);
  } catch (err) {
    console.error('Courses PATCH server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
