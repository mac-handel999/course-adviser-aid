const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');
const requireAuth = require('../middleware/requireAuth');
const bcrypt = require('bcryptjs');

router.use(requireAuth);

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isSlugUnique(slug, excludeUserId) {
  return supabaseAdmin
    .from('adviser_settings')
    .select('user_id')
    .neq('user_id', excludeUserId)
    .eq('portal_slug', slug)
    .maybeSingle();
}

async function ensureSettingsRow(userId, email) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('adviser_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const baseSlug = slugify(email || `user-${userId}`);
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const { data: slugCheck } = await isSlugUnique(slug, userId);
    if (!slugCheck) break;
    slug = `${baseSlug}-${counter}`;
    counter += 1;
  }

  const { data, error } = await supabaseAdmin
    .from('adviser_settings')
    .insert({
      user_id: userId,
      portal_slug: slug,
      faculty: 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)',
      department: 'DEPARTMENT OF PUBLIC HEALTH'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

router.get('/', async (req, res) => {
  try {
    const settings = await ensureSettingsRow(req.user.id, req.user.email);
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

    const { data: existing, error: existingError } = await isSlugUnique(slug, req.user.id);
    if (existingError) throw existingError;
    if (existing) {
      return res.status(409).json({ error: 'That portal slug is already in use by another adviser.' });
    }

    const { data, error } = await supabaseAdmin
      .from('adviser_settings')
      .upsert({
        user_id: req.user.id,
        portal_slug: slug,
        faculty: String(faculty).trim(),
      department: String(department).trim()
      }, { onConflict: 'user_id' })
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

    const { error } = await supabaseAdmin
      .from('adviser_settings')
      .upsert({
        user_id: req.user.id,
        passcode_hash: hash
      }, { onConflict: 'user_id' });

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('Settings passcode PUT error:', err.message);
    res.status(500).json({ error: 'Failed to update passcode' });
  }
});

module.exports = router;
