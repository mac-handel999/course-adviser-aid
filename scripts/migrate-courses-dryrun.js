/* =========================================================================
   Advyza — courses migration: Phase 1 DRY-RUN (read-only, no writes)

   Run:  node scripts/migrate-courses-dryrun.js
   Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as server/.env)

   This script groups existing results rows by
   (user_id, year, semester, course_code) and reports how many groups
   have a single consistent (title, unit) combination vs. conflicts
   where the same code maps to multiple titles/units.

   NO database writes are performed. Review the output before running
   the Phase 2 migration (scripts/migrate-courses.js).
   ========================================================================= */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

(async () => {
  try {
    const { data: results, error } = await supabaseAdmin
      .from('results')
      .select('created_by, year, semester, course_code, course_title, credit_unit')
      .not('course_code', 'is', null);

    if (error) {
      console.error('Supabase select error:', error.message);
      process.exit(1);
    }

    if (!results || results.length === 0) {
      console.log('No results rows with course_code found. Nothing to migrate.');
      return;
    }

    // Group by (user_id, year, semester, course_code)
    const groups = {};
    results.forEach(row => {
      const key = `${row.created_by}|${row.year}|${row.semester}|${row.course_code}`;
      if (!groups[key]) groups[key] = { user_id: row.created_by, year: row.year, semester: row.semester, course_code: row.course_code, combos: {}, rowCount: 0 };
      const comboKey = `${row.course_title || ''}|||${row.credit_unit != null ? row.credit_unit : ''}`;
      if (!groups[key].combos[comboKey]) groups[key].combos[comboKey] = { title: row.course_title, unit: row.credit_unit, count: 0 };
      groups[key].combos[comboKey].count++;
      groups[key].rowCount++;
    });

    const groupKeys = Object.keys(groups);
    const clean = [];
    const conflicts = [];

    groupKeys.forEach(key => {
      const combos = Object.keys(groups[key].combos);
      if (combos.length === 1) {
        clean.push(groups[key]);
      } else {
        conflicts.push(groups[key]);
      }
    });

    console.log('='.repeat(80));
    console.log('COURSES MIGRATION — DRY RUN REPORT');
    console.log('='.repeat(80));
    console.log(`Total results rows with course_code: ${results.length}`);
    console.log(`Total distinct (user/year/semester/course_code) groups: ${groupKeys.length}`);
    console.log(`  Clean groups (single title+unit):   ${clean.length}`);
    console.log(`  Conflict groups (multiple combos):    ${conflicts.length}`);
    console.log('='.repeat(80));

    if (conflicts.length > 0) {
      console.log('\nCONFLICT DETAILS — same course_code maps to different title/unit combinations:');
      conflicts.forEach((g, i) => {
        console.log(`\n  [${i + 1}] user_id=${g.user_id} | year=${g.year} | semester=${g.semester} | course_code=${g.course_code} | ${g.rowCount} rows, ${Object.keys(g.combos).length} distinct combos:`);
        Object.keys(g.combos).forEach(comboKey => {
          const c = g.combos[comboKey];
          console.log(`      - title="${c.title || '(null)'}", credit_unit=${c.unit != null ? c.unit : '(null)'} : ${c.count} rows`);
        });
      });
      console.log('\nNOTE: Phase 2 will resolve conflicts by choosing the MOST FREQUENTLY occurring combination.');
      console.log('Please review the conflicts above before proceeding.');
    } else {
      console.log('\nNo conflicts found. All course codes have consistent title/unit within each group.');
    }

    console.log('\nDry run complete. No database writes were performed.');
  } catch (err) {
    console.error('Dry-run error:', err.message);
    process.exit(1);
  }
})();
