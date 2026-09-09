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
      passcode_set: !!settings.passcode_hash
    });
  } catch (err) {
    console.error('Settings GET error:', err.message);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/', async (req, res) => {
  try {
    const { faculty, department, portal_slug } = req.body;
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

    const { data, error } = await supabaseAdmin
      .from('adviser_settings')
      .update({
        portal_slug: slug,
        faculty: String(faculty).trim(),
        department: String(department).trim()
      })
      .eq('user_id', req.user.id)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That portal slug is already in use by another adviser.' });
      }
      throw error;
    }

    res.json({
      portal_slug: data.portal_slug,
      faculty: data.faculty,
      department: data.department,
      passcode_set: !!data.passcode_hash
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
