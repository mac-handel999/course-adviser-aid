const express = require('express');
const router = express.Router();
const supabaseAdmin = require('../lib/supabaseAdmin');

router.post('/delete', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid authorization token' });
    }
    const token = authHeader.split(' ')[1];
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const userId = user.id;
    const { error: deleteResultsError } = await supabaseAdmin
      .from('results')
      .delete()
      .eq('created_by', userId);

    if (deleteResultsError) {
      console.error('Supabase delete results error:', deleteResultsError.message);
      return res.status(500).json({ error: 'Failed to delete results' });
    }

    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      console.error('Supabase delete user error:', deleteUserError.message);
      return res.status(500).json({ error: 'Failed to delete user' });
    }

    res.status(204).send();
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
