document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('authForm');
  const modeToggle = document.getElementById('modeToggle');
  const title = document.getElementById('authTitle');
  const sub = document.getElementById('authSub');
  const submitBtn = document.getElementById('authSubmit');
  const fullNameLabel = document.getElementById('fullNameLabel');
  const fullNameInput = document.getElementById('fullName');
  let mode = 'signin';

  function updateMode() {
    if (mode === 'signin') {
      title.textContent = 'Sign in';
      sub.textContent = 'Access your department result records.';
      submitBtn.textContent = 'Sign in';
      modeToggle.textContent = 'Need an account? Create one';
      if (fullNameLabel) fullNameLabel.style.display = 'none';
      if (fullNameInput) fullNameInput.style.display = 'none';
    } else {
      title.textContent = 'Create account';
      sub.textContent = 'Set up access to the results portal.';
      submitBtn.textContent = 'Create account';
      modeToggle.textContent = 'Already have an account? Sign in';
      if (fullNameLabel) fullNameLabel.style.display = 'block';
      if (fullNameInput) fullNameInput.style.display = 'block';
    }
  }

  modeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    mode = mode === 'signin' ? 'signup' : 'signin';
    updateMode();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!supabaseClient) {
      alert('Supabase is not configured yet. Edit js/supabase-config.js with your project URL and anon key, then try again.');
      return;
    }

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const fullName = fullNameInput ? fullNameInput.value.trim() : '';

    if (mode === 'signup' && !fullName) {
      alert('Please enter your full name.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = mode === 'signin' ? 'Signing in…' : 'Creating account…';

    let data, error;
    if (mode === 'signin') {
      const result = await supabaseClient.auth.signInWithPassword({ email, password });
      data = result.data;
      error = result.error;
    } else {
      const result = await supabaseClient.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      data = result.data;
      error = result.error;
    }

    submitBtn.disabled = false;
    updateMode();

    if (error) {
      alert(error.message);
      return;
    }

    if (mode === 'signup' && !data.session) {
      alert('Account created. Check your email to confirm it, then sign in.');
      mode = 'signin';
      updateMode();
      return;
    }

    window.location.href = 'app.html';
  });

  updateMode();
});
