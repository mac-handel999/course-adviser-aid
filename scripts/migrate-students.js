/* =========================================================================
   Advyza — students migration: Phase 2 (actual migration — WRITES)

   Run:  node scripts/migrate-students.js
   Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as server/.env)

   This script creates students table rows for each distinct
   (user_id, reg_no) group and backfills results.student_id.

   Conflict resolution: when a reg_no has multiple distinct
   (name, program) combinations within the same adviser, the MOST
   FREQUENTLY occurring combination is chosen as canonical.  Each
   resolution is logged.

   The script is safe to re-run:
     - students rows are inserted with upsert (skip if they already exist)
     - results rows that already have student_id set are skipped

   NO results rows have their reg_no, student_name, or program altered.
   Only student_id is populated.
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
    console.log('='.repeat(80));
    console.log('STUDENTS MIGRATION — PHASE 2 (WRITES)');
    console.log('='.repeat(80));

    // Step 1: Fetch all results rows that have reg_no but not yet student_id
    const { data: results, error: resultsError } = await supabaseAdmin
      .from('results')
      .select('id, created_by, reg_no, student_name, program')
      .not('reg_no', 'is', null)
      .is('student_id', null);

    if (resultsError) {
      console.error('Supabase results select error:', resultsError.message);
      process.exit(1);
    }

    if (!results || results.length === 0) {
      console.log('No results rows with reg_no and null student_id found. Nothing to migrate.');
      return;
    }

    console.log(`Total results rows needing student_id backfill: ${results.length}`);

    // Step 2: Group by (user_id, reg_no)
    const groups = {};
    results.forEach(row => {
      const key = `${row.created_by}|${row.reg_no}`;
      if (!groups[key]) groups[key] = { user_id: row.created_by, reg_no: row.reg_no, combos: {}, rows: [] };
      const comboKey = `${String(row.student_name || '').trim()}|||${String(row.program || '').trim()}`;
      if (!groups[key].combos[comboKey]) groups[key].combos[comboKey] = { name: row.student_name || '', program: row.program || '', count: 0 };
      groups[key].combos[comboKey].count++;
      groups[key].rows.push(row);
    });

    const groupKeys = Object.keys(groups);
    console.log(`Total distinct (user_id, reg_no) groups: ${groupKeys.length}`);

    // Step 3: For each group, determine canonical (name, program) and create/upsert a students row
    const studentMap = {}; // key -> students.id
    let studentsCreated = 0;
    let studentsSkipped = 0;
    let conflictsResolved = 0;

    for (const key of groupKeys) {
      const g = groups[key];
      const comboKeys = Object.keys(g.combos);

      let canonical;
      if (comboKeys.length === 1) {
        canonical = g.combos[comboKeys[0]];
      } else {
        // Conflict: pick most frequent combination
        conflictsResolved++;
        console.log(`\n  CONFLICT: user_id=${g.user_id} | reg_no=${g.reg_no}`);
        let maxCount = 0;
        let chosenComboKey = null;
        Object.keys(g.combos).forEach(ck => {
          console.log(`    - name="${g.combos[ck].name || '(null)'}", program="${g.combos[ck].program || '(null)'}" : ${g.combos[ck].count} rows`);
          if (g.combos[ck].count > maxCount) {
            maxCount = g.combos[ck].count;
            chosenComboKey = ck;
          }
        });
        canonical = g.combos[chosenComboKey];
        console.log(`    -> CHOSEN: name="${canonical.name || '(null)'}", program="${canonical.program || '(null)'}" (${maxCount} rows)`);
      }

      // Upsert the student row
      const { data: studentData, error: studentError } = await supabaseAdmin
        .from('students')
        .upsert(
          {
            user_id: g.user_id,
            reg_no: g.reg_no,
            full_name: canonical.name || '',
            program: canonical.program || null
          },
          { onConflict: 'user_id,reg_no' }
        )
        .select('id')
        .single();

      if (studentError) {
        console.error(`Failed to upsert student for reg_no=${g.reg_no}:`, studentError.message);
        continue;
      }

      studentMap[key] = studentData.id;
      studentsCreated++;
    }

    console.log(`\nStudents table rows: ${studentsCreated} created/upserted, ${conflictsResolved} conflict(s) resolved.`);

    // Step 4: Backfill results.student_id for rows that don't have it yet
    let rowsUpdated = 0;
    let rowsSkipped = 0;

    for (const row of results) {
      const key = `${row.created_by}|${row.reg_no}`;
      const studentId = studentMap[key];
      if (!studentId) continue;

      // Only update if student_id is null (defensive — we already filtered)
      const { data: updateData, error: updateError } = await supabaseAdmin
        .from('results')
        .update({ student_id: studentId })
        .eq('id', row.id)
        .is('student_id', null)
        .select('id')
        .single();

      if (updateError) {
        console.error(`Failed to update result row ${row.id}:`, updateError.message);
      } else if (updateData) {
        rowsUpdated++;
      } else {
        rowsSkipped++;
      }
    }

    console.log(`Results rows: ${rowsUpdated} updated, ${rowsSkipped} already had student_id (skipped).`);
    console.log('\nMigration complete. No results.reg_no/student_name/program values were modified.');
    console.log('='.repeat(80));
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  }
})();
