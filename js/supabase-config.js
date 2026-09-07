/* =========================================================================
   Supabase project connection.

   1. Create a project at https://supabase.com
   2. Go to Project Settings > API and copy the "Project URL" and the
      "anon public" key into the two constants below.
   3. Run sql/schema.sql in the Supabase SQL editor to create the table
      and its access policies.
   4. In Authentication > Providers, make sure Email is enabled (it is
      by default). Turn off "Confirm email" while testing if you don't
      want to click a confirmation link for every test account.
   ========================================================================= */

const SUPABASE_URL = 'https://xwqkqsmraxltfuftqrzi.supabase.co'; // e.g. https://abcdEFGH.supabase.co
const SUPABASE_ANON_KEY = 'sb_publishable_WSi0bVCnJXTF8tZsSfRKKA_E6C-vM1a';

const supabaseClient = (SUPABASE_URL.startsWith('http') && SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR-ANON-PUBLIC-KEY')
  ? supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

if (!supabaseClient) {
  console.warn('Supabase is not configured yet — edit js/supabase-config.js with your project URL and anon key. The app will keep working in local-only (guest) mode until then.');
}
