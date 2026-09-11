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

router.post('/', async (req, res) => {
  try {
    const payload = {
      ...req.body,
      created_by: req.user.id
    };

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

    const { data, error } = await supabaseAdmin
      .from('results')
      .insert(payload)
      .select()
      .single();

    if (error) {
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
