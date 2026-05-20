// Login — built-in + social. Mirrors src/app/(auth)/login/LoginForm.tsx.

function Login({ onLogin }) {
  const [email, setEmail] = React.useState('agent@example.com');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(null);
  const [pending, setPending] = React.useState(false);

  function submit(e) {
    e.preventDefault();
    setError(null);
    if (!password) { setError('Invalid email or password.'); return; }
    setPending(true);
    setTimeout(() => onLogin(email), 400);
  }

  return (
    <div className="max-w-md mx-auto bg-white rounded-lg border border-gray-200 p-6 mt-4">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Log in</h1>
      {error && <Banner tone="error">{error}</Banner>}
      <form onSubmit={submit} className="space-y-4">
        <Input id="login-email" label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email"/>
        <Input id="login-pass" label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password"/>
        <button type="submit" disabled={pending} className="w-full bg-blue-600 text-white rounded py-2 px-4 text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {pending ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <div className="mt-6">
        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"/></div>
          <div className="relative flex justify-center text-xs uppercase tracking-wider"><span className="bg-white px-2 text-gray-500">Or continue with</span></div>
        </div>
        <div className="space-y-2">
          <button type="button" className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded py-2 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">Sign in with Google</button>
          <button type="button" className="w-full flex items-center justify-center gap-2 border border-gray-300 rounded py-2 px-4 text-sm font-medium text-gray-700 hover:bg-gray-50">Sign in with GitHub</button>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <a href="#" className="text-blue-600 hover:text-blue-800 underline">Forgot password?</a>
        <a href="#" className="text-blue-600 hover:text-blue-800 underline">Don&rsquo;t have an account? Sign up</a>
      </div>
    </div>
  );
}

window.Login = Login;
