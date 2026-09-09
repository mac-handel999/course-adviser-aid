const supabaseAdmin = require('./supabaseAdmin');
const crypto = require('crypto');

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateRandomSuffix() {
  return crypto.randomBytes(2).toString('hex').slice(0, 4);
}

async function isSlugUnique(slug, excludeUserId) {
  const { data, error } = await supabaseAdmin
    .from('adviser_settings')
    .select('user_id')
    .neq('user_id', excludeUserId)
    .eq('portal_slug', slug)
    .maybeSingle();

  if (error) throw error;
  return !data;
}

async function getOrCreateAdviserSettings(userId, email, userMetadata) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('adviser_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  const fullName = (userMetadata && userMetadata.full_name) ? String(userMetadata.full_name).trim() : '';
  const baseName = fullName || (email ? String(email).split('@')[0] : `user-${userId}`);
  const baseSlug = slugify(baseName) || `user-${userId}`;

  let slug = `${baseSlug}-${generateRandomSuffix()}`;
  let counter = 1;
  const maxAttempts = 8;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const unique = await isSlugUnique(slug, userId);
    if (unique) break;
    slug = `${baseSlug}-${generateRandomSuffix()}`;
    if (attempt === maxAttempts - 1) {
      slug = `${baseSlug}-${counter}`;
      counter += 1;
    }
  }

  let finalSlug = slug;
  let unique = await isSlugUnique(finalSlug, userId);
  while (!unique && counter < 1000) {
    finalSlug = `${baseSlug}-${counter}`;
    counter += 1;
    unique = await isSlugUnique(finalSlug, userId);
  }

  const { data, error } = await supabaseAdmin
    .from('adviser_settings')
    .insert({
      user_id: userId,
      portal_slug: finalSlug,
      faculty: 'SCHOOL OF HEALTH TECHNOLOGY (SOHT)',
      department: 'DEPARTMENT OF PUBLIC HEALTH'
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = {
  getOrCreateAdviserSettings,
  isSlugUnique
};
