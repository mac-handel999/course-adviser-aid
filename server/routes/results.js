const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('results')
      .select('*')
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Supabase select error:', error.message);
      return res.status(500).json({ error: 'Failed to load results' });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/* ===================== POST /api/results =====================
   Create a new result row.
   Accepts standard fields plus optional test_score, lab_score, exam_score.
   When component scores are provided, their sum must match `score`. */
router.post('/', async (req, res) => {
  try {
    const payload = {
      ...req.body,
      created_by: req.user.id
    };

    // Sanitize empty strings to null for numeric fields.  PostgreSQL
    // rejects "" for numeric columns with error 22P02 ("invalid input
    // syntax for type numeric"), which surfaces as a 500.  The client
    // *should* send null already, but this is a defensive guard so a
    // stray "" never crashes the insert.
    const numericFields = ['credit_unit', 'score', 'test_score', 'lab_score', 'exam_score'];
    numericFields.forEach(f => {
      if (payload[f] === '') payload[f] = null;
    });

    if (payload.reg_no !== undefined && payload.reg_no !== null && payload.reg_no !== '') {
      const regNo = String(payload.reg_no).trim();
      if (!/^\d{11}$/.test(regNo)) {
        return res.status(400).json({ error: 'Reg No must be exactly 11 digits.' });
      }
      payload.reg_no = regNo;
    }

    if (payload.score !== undefined && payload.score !== null) {
      const score = parseFloat(payload.score);
      if (isNaN(score) || score < 0 || score > 100) {
        return res.status(400).json({ error: 'Score must be a number between 0 and 100.' });
      }
    }

    // Validate component scores: each must be >= 0, and their sum must equal `score`
    const componentFields = ['test_score', 'lab_score', 'exam_score'];
    let componentSum = 0;
    let hasAnyComponent = false;
    for (const f of componentFields) {
      if (payload[f] !== undefined && payload[f] !== null && payload[f] !== '') {
        const n = parseFloat(payload[f]);
        if (isNaN(n) || n < 0) {
          return res.status(400).json({ error: `${f.replace('_', ' ')} must be 0 or greater.` });
        }
        componentSum += n;
        hasAnyComponent = true;
      }
    }

    if (hasAnyComponent && payload.score !== undefined && payload.score !== null && payload.score !== '') {
      const scoreNum = parseFloat(payload.score);
      if (!isNaN(scoreNum) && Math.abs(componentSum - scoreNum) > 0.001) {
        return res.status(400).json({ error: 'Sum of Test+Lab+Exam must equal the score being saved.' });
      }
    }

    // Server-side duplicate check: (course_id, reg_no) scoped to one course
    if (payload.course_id && payload.reg_no) {
      const { data: existing, error: dupCheckError } = await supabaseAdmin
        .from('results')
        .select('id')
        .eq('course_id', payload.course_id)
        .eq('reg_no', payload.reg_no)
        .eq('created_by', req.user.id)
        .maybeSingle();

      if (dupCheckError) {
        console.error('Duplicate check error:', dupCheckError.message);
        return res.status(500).json({ error: 'Failed to verify existing results.' });
      }

      if (existing) {
        return res.status(409).json({ error: `A result already exists for reg no ${payload.reg_no} in this course.` });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('results')
      .insert(payload)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        console.error('Supabase insert error (duplicate):', error.message);
        return res.status(409).json({ error: `A result already exists for reg no ${payload.reg_no} in this course.` });
      }
      console.error('Supabase insert error:', error.message);
      return res.status(500).json({ error: 'Failed to save result' });
    }

    res.status(201).json(data);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;

    // Sanitize empty strings to null for numeric fields (same guard as POST)
    const numericFields = ['credit_unit', 'score', 'test_score', 'lab_score', 'exam_score'];
    numericFields.forEach(f => {
      if (payload[f] === '') payload[f] = null;
    });

    if (payload.reg_no !== undefined && payload.reg_no !== null && payload.reg_no !== '') {
      const regNo = String(payload.reg_no).trim();
      if (!/^\d{11}$/.test(regNo)) {
        return res.status(400).json({ error: 'Reg No must be exactly 11 digits.' });
      }
      payload.reg_no = regNo;
    }

    if (payload.score !== undefined && payload.score !== null) {
      const score = parseFloat(payload.score);
      if (isNaN(score) || score < 0 || score > 100) {
        return res.status(400).json({ error: 'Score must be a number between 0 and 100.' });
      }
    }

    // Validate component scores: each must be >= 0, and their sum must equal `score`
    const componentFields = ['test_score', 'lab_score', 'exam_score'];
    let componentSum = 0;
    let hasAnyComponent = false;
    for (const f of componentFields) {
      if (payload[f] !== undefined && payload[f] !== null && payload[f] !== '') {
        const n = parseFloat(payload[f]);
        if (isNaN(n) || n < 0) {
          return res.status(400).json({ error: `${f.replace('_', ' ')} must be 0 or greater.` });
        }
        componentSum += n;
        hasAnyComponent = true;
      }
    }

    if (hasAnyComponent && payload.score !== undefined && payload.score !== null && payload.score !== '') {
      const scoreNum = parseFloat(payload.score);
      if (!isNaN(scoreNum) && Math.abs(componentSum - scoreNum) > 0.001) {
        return res.status(400).json({ error: 'Sum of Test+Lab+Exam must equal the score being saved.' });
      }
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('results')
      .select('id, created_by')
      .eq('id', id)
      .maybeSingle();

    if (existingError) {
      console.error('Supabase select existing error:', existingError.message);
      return res.status(500).json({ error: 'Failed to verify result ownership' });
    }

    if (!existing || existing.created_by !== req.user.id) {
      return res.status(404).json({ error: 'Result not found' });
    }

    const { data, error } = await supabaseAdmin
      .from('results')
      .update(payload)
      .eq('id', id)
      .eq('created_by', req.user.id)
      .select()
      .single();

    if (error) {
      console.error('Supabase update error:', error.message);
      return res.status(500).json({ error: 'Failed to update result' });
    }

    res.json(data);
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('results')
      .select('id, created_by')
      .eq('id', id)
      .maybeSingle();

    if (existingError) {
      console.error('Supabase select existing error:', existingError.message);
      return res.status(500).json({ error: 'Failed to verify result ownership' });
    }

    if (!existing || existing.created_by !== req.user.id) {
      return res.status(404).json({ error: 'Result not found' });
    }

    const { error } = await supabaseAdmin
      .from('results')
      .delete()
      .eq('id', id)
      .eq('created_by', req.user.id);

    if (error) {
      console.error('Supabase delete error:', error.message);
      return res.status(500).json({ error: 'Failed to delete result' });
    }

    res.status(204).send();
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
