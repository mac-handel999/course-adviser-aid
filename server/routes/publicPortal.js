const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many lookup attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

router.use(publicLimiter);

router.post('/portal/:slug/lookup', async (req, res) => {
  try {
    const { slug } = req.params;
    const { passcode, regNo } = req.body;

    if (!passcode || !regNo) {
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    const trimmedRegNo = String(regNo).trim();

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from('adviser_settings')
      .select('user_id, passcode_hash, faculty, department')
      .eq('portal_slug', slug)
      .maybeSingle();

    if (settingsError) {
      console.error('Public portal settings error:', settingsError.message);
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    if (!settings || !settings.passcode_hash) {
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    const passcodeMatch = await bcrypt.compare(String(passcode), settings.passcode_hash);
    if (!passcodeMatch) {
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    const { data: results, error: resultsError } = await supabaseAdmin
      .from('results')
      .select('year, semester, course_code, course_title, credit_unit, score')
      .eq('created_by', settings.user_id)
      .ilike('reg_no', trimmedRegNo)
      .order('year', { ascending: true })
      .order('semester', { ascending: true });

    if (resultsError) {
      console.error('Public portal results error:', resultsError.message);
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    if (!results || results.length === 0) {
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    res.json({
      university: 'FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI',
      faculty: settings.faculty,
      department: settings.department,
      regNo: trimmedRegNo,
      results
    });
  } catch (err) {
    console.error('Public portal server error:', err);
    res.status(401).json({ error: 'No results found for that passcode and registration number.' });
  }
});

module.exports = router;
