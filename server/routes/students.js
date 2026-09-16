const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

/* ===================== GET /api/students?search=<optional> =====================
   List the adviser's full student roster, optionally filtered by a
   case-insensitive substring match against reg_no or full_name.
   Includes a courseCount per student: how many distinct courses they have
   results in (via results.student_id, falling back to reg_no for
   results not yet linked). */
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const userId = req.user.id;

    let query = supabaseAdmin
      .from('students')
      .select('id, reg_no, full_name, program, created_at')
      .eq('user_id', userId)
      .order('full_name', { ascending: true });

    if (search && String(search).trim()) {
      const term = String(search).trim();
      query = query.or(`reg_no.ilike.%${term}%,full_name.ilike.%${term}%`);
    }

    const { data: students, error } = await query;

    if (error) {
      console.error('Students GET error:', error.message);
      return res.status(500).json({ error: 'Failed to load students' });
    }

    // Fetch course counts: how many distinct courses each student has results in
    const studentIds = (students || []).map(s => s.id);
    let courseCounts = {};

    if (studentIds.length > 0) {
      const { data: countData, error: countError } = await supabaseAdmin
        .from('results')
        .select('course_id, student_id', { count: 'exact' })
        .in('student_id', studentIds)
        .not('course_id', 'is', null);

      if (countError) {
        console.error('Students course-count error:', countError.message);
      } else {
        const seen = {};
        (countData || []).forEach(r => {
          if (r.student_id && r.course_id) {
            if (!seen[r.student_id]) seen[r.student_id] = new Set();
            seen[r.student_id].add(r.course_id);
          }
        });
        Object.keys(seen).forEach(sid => {
          courseCounts[sid] = seen[sid].size;
        });
      }
    }

    const result = (students || []).map(s => ({
      ...s,
      courseCount: courseCounts[s.id] || 0
    }));

    res.json(result);
  } catch (err) {
    console.error('Students GET server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== GET /api/students/reg/:reg_no =====================
   Look up one student by exact reg_no within the current adviser's roster.
   Used for the "does this student already exist" check. */
router.get('/reg/:reg_no', async (req, res) => {
  try {
    const { reg_no } = req.params;
    const userId = req.user.id;

    const { data: student, error } = await supabaseAdmin
      .from('students')
      .select('id, reg_no, full_name, program, created_at')
      .eq('user_id', userId)
      .eq('reg_no', reg_no)
      .maybeSingle();

    if (error) {
      console.error('Student lookup error:', error.message);
      return res.status(500).json({ error: 'Failed to look up student' });
    }

    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json(student);
  } catch (err) {
    console.error('Student lookup server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== POST /api/students =====================
   Create a new roster entry { reg_no, full_name, program }.
   Rejects with 409 if (user_id, reg_no) already exists. */
router.post('/', async (req, res) => {
  try {
    const { reg_no, full_name, program } = req.body;
    const userId = req.user.id;

    if (!reg_no || !full_name) {
      return res.status(400).json({ error: 'reg_no and full_name are required.' });
    }

    const regNo = String(reg_no).trim();
    if (!/^\d{11}$/.test(regNo)) {
      return res.status(400).json({ error: 'Reg No must be exactly 11 digits.' });
    }

    const { data: existing, error: checkError } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('user_id', userId)
      .eq('reg_no', regNo)
      .maybeSingle();

    if (checkError) {
      console.error('Students POST duplicate-check error:', checkError.message);
      return res.status(500).json({ error: 'Failed to check existing student' });
    }

    if (existing) {
      return res.status(409).json({
        error: `A student with reg no ${regNo} already exists in your roster. Use edit instead.`,
        student: existing
      });
    }

    const { data, error } = await supabaseAdmin
      .from('students')
      .insert({
        user_id: userId,
        reg_no: regNo,
        full_name: String(full_name).trim(),
        program: program !== undefined && program !== null && String(program).trim() !== ''
          ? String(program).trim()
          : null
      })
      .select('id, reg_no, full_name, program, created_at')
      .single();

    if (error) {
      console.error('Students POST insert error:', error.message);
      return res.status(500).json({ error: 'Failed to create student' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Students POST server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== PATCH /api/students/:id =====================
   Update full_name / program for an existing roster entry.
   Ownership-checked: returns 404 if the student doesn't belong to req.user.id. */
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, program } = req.body;
    const userId = req.user.id;

    const { data: student, error: checkError } = await supabaseAdmin
      .from('students')
      .select('user_id')
      .eq('id', id)
      .maybeSingle();

    if (checkError) {
      console.error('Students PATCH ownership-check error:', checkError.message);
      return res.status(500).json({ error: 'Failed to verify student ownership' });
    }

    if (!student || student.user_id !== userId) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const updates = {};
    if (full_name !== undefined) updates.full_name = String(full_name || '').trim() || null;
    if (program !== undefined) {
      updates.program = program !== null && String(program).trim() !== ''
        ? String(program).trim()
        : null;
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No updatable fields provided.' });
    }

    const { data, error } = await supabaseAdmin
      .from('students')
      .update(updates)
      .eq('id', id)
      .eq('user_id', userId)
      .select('id, reg_no, full_name, program, created_at')
      .single();

    if (error) {
      console.error('Students PATCH update error:', error.message);
      return res.status(500).json({ error: 'Failed to update student' });
    }

    res.json(data);
  } catch (err) {
    console.error('Students PATCH server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== DELETE /api/students (all) ====================
   Delete ALL students belonging to the current adviser.  Students that
   still have linked results rows are skipped (same safety check as the
   single-delete endpoint — results are never cascade-deleted).  Returns a
   summary of how many were deleted, how many were skipped, and which
   reg_no values still had linked results. */
router.delete('/', async (req, res) => {
  try {
    const userId = req.user.id;

    // Load the full roster for this adviser
    const { data: students, error: loadError } = await supabaseAdmin
      .from('students')
      .select('id, reg_no, full_name')
      .eq('user_id', userId);

    if (loadError) {
      console.error('Students DELETE-all load error:', loadError.message);
      return res.status(500).json({ error: 'Failed to load roster for deletion' });
    }

    if (!students || students.length === 0) {
      return res.json({ deleted: 0, skipped: 0, skippedStudents: [] });
    }

    // Identify which students have linked results
    const studentIds = students.map(s => s.id);
    const { data: linkedRows, error: linkError } = await supabaseAdmin
      .from('results')
      .select('student_id')
      .in('student_id', studentIds)
      .not('student_id', 'is', null);

    if (linkError) {
      console.error('Students DELETE-all link-check error:', linkError.message);
      return res.status(500).json({ error: 'Failed to check linked results' });
    }

    const linkedIds = new Set((linkedRows || []).map(r => r.student_id));

    const toDelete = students.filter(s => !linkedIds.has(s.id));
    const toSkip = students.filter(s => linkedIds.has(s.id));

    if (toDelete.length === 0) {
      return res.status(400).json({
        error: 'No students could be deleted — all have linked results. Remove students from all courses first.',
        deleted: 0,
        skipped: toSkip.length,
        skippedStudents: toSkip.map(s => ({ reg_no: s.reg_no, full_name: s.full_name }))
      });
    }

    const toDeleteIds = toDelete.map(s => s.id);
    const { error: deleteError } = await supabaseAdmin
      .from('students')
      .delete()
      .in('id', toDeleteIds)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Students DELETE-all delete error:', deleteError.message);
      return res.status(500).json({ error: 'Failed to delete students' });
    }

    res.json({
      deleted: toDelete.length,
      skipped: toSkip.length,
      skippedStudents: toSkip.map(s => ({ reg_no: s.reg_no, full_name: s.full_name }))
    });
  } catch (err) {
    console.error('Students DELETE-all server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== DELETE /api/students/:id =====================
   Only deletes if the student has zero linked results rows.
   If they have existing results, returns a clear error explaining the
   student must be removed from all courses first — does NOT cascade-delete
   results as a side effect. */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const { data: student, error: checkError } = await supabaseAdmin
      .from('students')
      .select('user_id')
      .eq('id', id)
      .maybeSingle();

    if (checkError) {
      console.error('Students DELETE ownership-check error:', checkError.message);
      return res.status(500).json({ error: 'Failed to verify student ownership' });
    }

    if (!student || student.user_id !== userId) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Check for linked results rows
    const { count: resultCount, error: countError } = await supabaseAdmin
      .from('results')
      .select('*', { count: 'exact', head: true })
      .eq('student_id', id);

    if (countError) {
      console.error('Students DELETE results-count error:', countError.message);
      return res.status(500).json({ error: 'Failed to check linked results' });
    }

    if (resultCount && resultCount > 0) {
      return res.status(400).json({
        error: `Cannot delete this student — they are linked to ${resultCount} result row(s) across existing courses. Remove them from all courses first.`,
        linkedResults: resultCount
      });
    }

    const { error: deleteError } = await supabaseAdmin
      .from('students')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (deleteError) {
      console.error('Students DELETE error:', deleteError.message);
      return res.status(500).json({ error: 'Failed to delete student' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Students DELETE server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
