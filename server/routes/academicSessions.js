const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('academic_sessions')
      .select('year, session_label, is_auto')
      .eq('user_id', req.user.id)
      .order('year', { ascending: true });

    if (error) {
      console.error('Academic sessions GET error:', error.message);
      return res.status(500).json({ error: 'Failed to load academic sessions' });
    }

    res.json(data || []);
  } catch (err) {
    console.error('Academic sessions server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { year, session_label } = req.body;
    if (!year || !session_label || String(session_label).trim() === '') {
      return res.status(400).json({ error: 'year and session_label are required.' });
    }

    const { data, error } = await supabaseAdmin
      .from('academic_sessions')
      .upsert(
        {
          user_id: req.user.id,
          year: String(year).trim(),
          session_label: String(session_label).trim(),
          is_auto: false
        },
        { onConflict: 'user_id,year' }
      )
      .select('year, session_label, is_auto')
      .single();

    if (error) {
      console.error('Academic sessions PUT error:', error.message);
      return res.status(500).json({ error: 'Failed to save academic session' });
    }

    res.json(data);
  } catch (err) {
    console.error('Academic sessions server error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
