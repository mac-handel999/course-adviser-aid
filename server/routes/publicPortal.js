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
      .select('year, semester, course_code, course_title, credit_unit, score, is_carryover, student_name, reg_no, program, remark, student_id')
      .eq('created_by', settings.user_id)
      .ilike('reg_no', trimmedRegNo)
      .order('year', { ascending: true })
      .order('semester', { ascending: true });

    if (resultsError) {
      console.error('Public portal results error:', resultsError.message);
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    // Fetch the student record (if any) to get canonical program/name for
    // rows that have a student_id linked.  Falls back to results.program
    // for rows without student_id.
    let studentRecord = null;
    if (results && results.length > 0) {
      const studentId = results[0]?.student_id;
      if (studentId) {
        const { data: studentData, error: studentError } = await supabaseAdmin
          .from('students')
          .select('full_name, program')
          .eq('id', studentId)
          .eq('user_id', settings.user_id)
          .maybeSingle();
        if (studentError) {
          console.error('Public portal student lookup error:', studentError.message);
        } else {
          studentRecord = studentData;
        }
      }
    }

    const { data: academicSessions, error: academicSessionsError } = await supabaseAdmin
      .from('academic_sessions')
      .select('year, session_label')
      .eq('user_id', settings.user_id);

    if (academicSessionsError) {
      console.error('Public portal academic sessions error:', academicSessionsError.message);
    }

    if (!results || results.length === 0) {
      return res.status(401).json({ error: 'No results found for that passcode and registration number.' });
    }

    const academicSessionsMap = {};
    (academicSessions || []).forEach(row => {
      academicSessionsMap[row.year] = row.session_label;
    });

    // For each results row, use the student record's program if available
    // (row has student_id), otherwise fall back to the row's own program.
    const resultsWithProgram = (results || []).map(r => {
      if (r.student_id && studentRecord) {
        return { ...r, program: studentRecord.program || r.program || '' };
      }
      return r;
    });

    res.json({
      university: 'FEDERAL UNIVERSITY OF TECHNOLOGY OWERRI',
      faculty: settings.faculty,
      department: settings.department,
      regNo: trimmedRegNo,
      studentName: studentRecord?.full_name || results[0]?.student_name || '',
      results: resultsWithProgram,
      academicSessions: academicSessionsMap
    });
  } catch (err) {
    console.error('Public portal server error:', err);
    res.status(401).json({ error: 'No results found for that passcode and registration number.' });
  }
});

module.exports = router;
