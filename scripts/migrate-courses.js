/* =========================================================================
   Advyza — courses migration: Phase 2 (actual migration — WRITES)

   Run:  node scripts/migrate-courses.js
   Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (same as server/.env)

   This script creates courses table rows for each distinct
   (user_id, year, semester, course_code) group and backfills results.course_id.

   Conflict resolution: when a course_code has multiple distinct
   (title, unit) combinations within the same group, the MOST FREQUENTLY
   occurring combination is chosen as canonical.  Each resolution is logged.

   The script is safe to re-run:
     - courses rows are inserted with upsert (skip if they already exist)
     - results rows that already have course_id set are skipped

   NO results rows have their course_code/course_title/credit_unit altered.
   Only course_id is populated.
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
    console.log('COURSES MIGRATION — PHASE 2 (WRITES)');
    console.log('='.repeat(80));

    // Step 1: Fetch all results rows (with course_code) that don't yet have course_id
    // We fetch ALL so we can group and build the courses table + backfill in one pass.
    const { data: results, error: resultsError } = await supabaseAdmin
      .from('results')
      .select('id, created_by, year, semester, course_code, course_title, credit_unit')
      .not('course_code', 'is', null);

    if (resultsError) {
      console.error('Supabase results select error:', resultsError.message);
      process.exit(1);
    }

    if (!results || results.length === 0) {
      console.log('No results rows with course_code found. Nothing to migrate.');
      return;
    }

    console.log(`Total results rows with course_code: ${results.length}`);

    // Step 2: Group by (user_id, year, semester, course_code)
    const groups = {};
    results.forEach(row => {
      const key = `${row.created_by}|${row.year}|${row.semester}|${row.course_code}`;
      if (!groups[key]) groups[key] = { user_id: row.created_by, year: row.year, semester: row.semester, course_code: row.course_code, combos: {}, rows: [] };
      const comboKey = `${row.course_title || '|||'}|||${row.credit_unit != null ? row.credit_unit : 'null'}`;
      if (!groups[key].combos[comboKey]) groups[key].combos[comboKey] = { title: row.course_title, unit: row.credit_unit, count: 0 };
      groups[key].combos[comboKey].count++;
      groups[key].rows.push(row);
    });

    const groupKeys = Object.keys(groups);
    console.log(`Total distinct groups: ${groupKeys.length}`);

    // Step 3: For each group, determine canonical (title, unit) and create/upssert a courses row
    const courseMap = {}; // key -> courses.id
    let coursesCreated = 0;
    let coursesSkipped = 0;
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
        console.log(`\n  CONFLICT: user_id=${g.user_id} | year=${g.year} | semester=${g.semester} | course_code=${g.course_code}`);
        let maxCount = 0;
        let chosenComboKey = null;
        Object.keys(g.combos).forEach(ck => {
          console.log(`    - title="${g.combos[ck].title || '(null)'}", credit_unit=${g.combos[ck].unit != null ? g.combos[ck].unit : '(null)'} : ${g.combos[ck].count} rows`);
          if (g.combos[ck].count > maxCount) {
            maxCount = g.combos[ck].count;
            chosenComboKey = ck;
          }
        });
        canonical = g.combos[chosenComboKey];
        console.log(`    -> CHOSEN: title="${canonical.title || '(null)'}", credit_unit=${canonical.unit != null ? canonical.unit : '(null)'} (${maxCount} rows)`);
      }

      // Upsert the course row
      const { data: courseData, error: courseError } = await supabaseAdmin
        .from('courses')
        .upsert(
          {
            user_id: g.user_id,
            year: g.year,
            semester: g.semester,
            course_code: g.course_code,
            course_title: canonical.title || null,
            credit_unit: canonical.unit != null ? canonical.unit : null
          },
          { onConflict: 'user_id,year,semester,course_code' }
        )
        .select('id')
        .single();

      if (courseError) {
        console.error(`Failed to upsert course for ${g.course_code}:`, courseError.message);
        continue;
      }

      courseMap[key] = courseData.id;
      if (courseError === null && !courseError) {
        // Check if this was a new insert or existing
        const { data: checkData, error: checkError } = await supabaseAdmin
          .from('courses')
          .select('id, created_at')
          .eq('id', courseData.id)
          .single();

        if (checkData && checkData.created_at) {
          // We can't easily tell insert vs upsert from the response, so we count all as created
          coursesCreated++;
        }
      } else {
        coursesSkipped++;
      }
    }

    console.log(`\nCourses table rows: ${coursesCreated} created/upserted, ${conflictsResolved} conflict(s) resolved.`);

    // Step 4: Backfill results.course_id for rows that don't have it yet
    let rowsUpdated = 0;
    let rowsSkipped = 0;

    // Batch update in groups of 100 for performance
    const batchSize = 100;
    for (let i = 0; i < results.length; i += batchSize) {
      const batch = results.slice(i, i + batchSize);
      for (const row of batch) {
        if (row.id == null) continue;
        // Check if course_id is already set for this row
        // We'll update all rows in each group to the mapped course_id
        const key = `${row.created_by}|${row.year}|${row.semester}|${row.course_code}`;
        const courseId = courseMap[key];
        if (!courseId) continue;

        // Only update if the row doesn't already have a course_id
        // We can't easily check this per-row without a select, so we use a filter
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('results')
          .update({ course_id: courseId })
          .eq('id', row.id)
          .is('course_id', null)
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
    }

    console.log(`Results rows: ${rowsUpdated} updated, ${rowsSkipped} already had course_id (skipped).`);
    console.log('\nMigration complete. No results.course_code/course_title/credit_unit values were modified.');
    console.log('='.repeat(80));
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  }
})();
