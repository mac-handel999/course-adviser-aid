const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');
const bcrypt = require('bcryptjs');
const { getOrCreateAdviserSettings, isSlugUnique } = require('../lib/adviserSettings');

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const settings = await getOrCreateAdviserSettings(req.user.id, req.user.email, req.user.user_metadata);
    res.json({
      portal_slug: settings.portal_slug,
      faculty: settings.faculty,
      department: settings.department,
      passcode_set: !!settings.passcode_hash,
      class_set: settings.class_set || null
    });
  } catch (err) {
    console.error('Settings GET error:', err.message);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { faculty, department, portal_slug, class_set } = req.body;
    if (!faculty || !department || !portal_slug) {
      return res.status(400).json({ error: 'faculty, department, and portal_slug are required.' });
    }

    const slug = slugify(portal_slug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(400).json({ error: 'portal_slug must contain only lowercase letters, numbers, and hyphens.' });
    }

    const unique = await isSlugUnique(slug, req.user.id);
    if (!unique) {
      return res.status(409).json({ error: 'That portal slug is already in use by another adviser.' });
    }

    await getOrCreateAdviserSettings(req.user.id, req.user.email, req.user.user_metadata);

    const updatePayload = {
      portal_slug: slug,
      faculty: String(faculty).trim(),
      department: String(department).trim()
    };

    if (class_set !== undefined && class_set !== null && String(class_set).trim() !== '') {
      updatePayload.class_set = String(class_set).trim();
    }

    const { data, error } = await supabaseAdmin
      .from('adviser_settings')
      .update(updatePayload)
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That portal slug is already in use by another adviser.' });
      }
      throw error;
    }

    if (updatePayload.class_set) {
      const startMatch = String(updatePayload.class_set || '').match(/^(\d{4})/);
      const startYear = startMatch ? parseInt(startMatch[1], 10) : null;
      if (startYear) {
        const { data: existingSessions } = await supabaseAdmin
          .from('academic_sessions')
          .select('year, is_auto')
          .eq('user_id', req.user.id)
          .in('is_auto', [true]);

        const autoYears = new Set((existingSessions || []).filter(s => s.is_auto).map(s => s.year));
        if (autoYears.size === 0) {
          const inserts = [];
          for (let i = 0; i < 10; i++) {
            inserts.push({
              user_id: req.user.id,
              year: `Year ${i + 1}`,
              session_label: `${startYear + i}/${startYear + i + 1}`,
              is_auto: true
            });
          }
          await supabaseAdmin.from('academic_sessions').insert(inserts);
        } else {
          const updates = [];
          for (const year of autoYears) {
            const idx = parseInt(String(year).replace('Year ', ''), 10) - 1;
            if (idx >= 0 && idx < 10) {
              updates.push({
                user_id: req.user.id,
                year,
                session_label: `${startYear + idx}/${startYear + idx + 1}`,
                is_auto: true
              });
            }
          }
          if (updates.length) {
            await supabaseAdmin.from('academic_sessions').upsert(updates, { onConflict: 'user_id,year' });
          }
        }
      }
    }

    res.json({
      portal_slug: data.portal_slug,
      faculty: data.faculty,
      department: data.department,
      passcode_set: !!data.passcode_hash,
      class_set: data.class_set || null
    });
  } catch (err) {
    console.error('Settings PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.put('/passcode', async (req, res) => {
  try {
    const { passcode } = req.body;
    if (!passcode || String(passcode).length < 6) {
      return res.status(400).json({ error: 'Passcode must be at least 6 characters.' });
    }

    const hash = await bcrypt.hash(String(passcode), 10);

    await getOrCreateAdviserSettings(req.user.id, req.user.email, req.user.user_metadata);

    const { error } = await supabaseAdmin
      .from('adviser_settings')
      .update({ passcode_hash: hash })
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('Settings passcode PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update passcode' });
  }
});

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = router;
