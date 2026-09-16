/* =========================================================================
   Advyza — students migration: Phase 1 DRY-RUN (read-only, no writes)

   Run:  node scripts/migrate-students-dryrun.js
   Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as server/.env)

   This script groups existing results rows by (user_id, reg_no) and
   reports how many distinct (student_name, program) combinations exist
   for each reg_no.  A conflict is when the same reg_no has more than
   one combination — e.g. a spelling variant across different course
   imports, or a program change recorded with a stale name.

   NO database writes are performed.  Review the output before running
   the Phase 2 migration (scripts/migrate-students.js).
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
      .select('created_by, reg_no, student_name, program')
      .not('reg_no', 'is', null);

    if (error) {
      console.error('Supabase select error:', error.message);
      process.exit(1);
    }

    if (!results || results.length === 0) {
      console.log('No results rows with reg_no found. Nothing to migrate.');
      return;
    }

    // Group by (user_id, reg_no)
    const groups = {};
    results.forEach(row => {
      if (!row.reg_no || String(row.reg_no).trim() === '') return;
      const key = `${row.created_by}|${row.reg_no}`;
      if (!groups[key]) groups[key] = { user_id: row.created_by, reg_no: row.reg_no, combos: {}, rowCount: 0 };
      const comboKey = `${String(row.student_name || '').trim()}|||${String(row.program || '').trim()}`;
      if (!groups[key].combos[comboKey]) groups[key].combos[comboKey] = { name: row.student_name || '', program: row.program || '', count: 0 };
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
    console.log('STUDENTS MIGRATION — DRY RUN REPORT');
    console.log('='.repeat(80));
    console.log(`Total results rows with reg_no: ${results.length}`);
    console.log(`Total distinct (user_id, reg_no) groups: ${groupKeys.length}`);
    console.log(`  Clean groups (single name+program):   ${clean.length}`);
    console.log(`  Conflict groups (multiple combos):     ${conflicts.length}`);
    console.log('='.repeat(80));

    if (conflicts.length > 0) {
      console.log('\nCONFLICT DETAILS — same reg_no maps to different (name, program) combinations:');
      conflicts.forEach((g, i) => {
        console.log(`\n  [${i + 1}] user_id=${g.user_id} | reg_no=${g.reg_no} | ${g.rowCount} rows, ${Object.keys(g.combos).length} distinct combos:`);
        Object.keys(g.combos).forEach(comboKey => {
          const c = g.combos[comboKey];
          console.log(`      - name="${c.name || '(null)'}", program="${c.program || '(null)'}" : ${c.count} rows`);
        });
      });
      console.log('\nNOTE: Phase 2 will resolve conflicts by choosing the MOST FREQUENTLY occurring combination.');
      console.log('      If two combos have the same count, the first encountered will be chosen.');
      console.log('      Please review the conflicts above before proceeding.');
    } else {
      console.log('\nNo conflicts found. All reg numbers have a consistent name+program within each group.');
    }

    console.log('\nDry run complete. No database writes were performed.');
  } catch (err) {
    console.error('Dry-run error:', err.message);
    process.exit(1);
  }
})();
