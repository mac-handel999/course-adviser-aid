const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('credit_load_settings')
      .select('year, semester, total_units')
      .eq('user_id', req.user.id)
      .order('year', { ascending: true })
      .order('semester', { ascending: true });

    if (error) {
      console.error('Credit load GET error:', error.message);
      return res.status(500).json({ error: 'Failed to load credit load settings' });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Credit load server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { year, semester, total_units } = req.body;
    if (!year || !semester || total_units === undefined || total_units === null) {
      return res.status(400).json({ error: 'year, semester, and total_units are required.' });
    }

    const numericUnits = parseFloat(total_units);
    if (isNaN(numericUnits) || numericUnits <= 0) {
      return res.status(400).json({ error: 'total_units must be a positive number.' });
    }

    const { data, error } = await supabaseAdmin
      .from('credit_load_settings')
      .upsert(
        {
          user_id: req.user.id,
          year: String(year).trim(),
          semester: String(semester).trim(),
          total_units: numericUnits
        },
        { onConflict: 'user_id,year,semester' }
      )
      .select('year, semester, total_units')
      .single();

    if (error) {
      console.error('Credit load PUT error:', error.message);
      return res.status(500).json({ error: 'Failed to save credit load setting' });
    }

    res.json(data);
  } catch (err) {
    console.error('Credit load server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
