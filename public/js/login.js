// If already signed in, skip the login screen.
(async () => {
  const u = await currentUser();
  if (u) location.href = u.role === 'admin' ? '/admin' : '/dashboard';
})();

const form = document.getElementById('login-form');
const btn = document.getElementById('submit-btn');

document.getElementById('fill-admin').onclick = () => {
  document.getElementById('email').value = 'admin@vutto.demo';
  document.getElementById('password').value = 'Admin@123';
};
document.getElementById('fill-user').onclick = () => {
  document.getElementById('email').value = 'aarav@vutto.demo';
  document.getElementById('password').value = 'User@123';
};

form.onsubmit = async (e) => {
  e.preventDefault();
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    const { user } = await api('/auth/login', {
      method: 'POST',
      body: { email: document.getElementById('email').value, password: document.getElementById('password').value },
    });
    location.href = user.role === 'admin' ? '/admin' : '/dashboard';
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
};
