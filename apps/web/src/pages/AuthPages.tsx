import { useState, type FormEvent } from 'react';
import { BookOpen } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { ErrorBox } from '../components/ui';
import { ThemeToggle } from '../app/theme';

function Frame({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <main className="relative grid min-h-screen place-items-center p-5">
      <ThemeToggle className="absolute right-5 top-5" />
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex justify-center gap-2 text-lg font-bold">
          <BookOpen className="text-brand-600" />
          UniMate AI
        </Link>
        <div className="card p-7">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </main>
  );
}
export function Login() {
  const auth = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  if (auth.user) return <Navigate to="/app" />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      await auth.login(String(f.get('email')), String(f.get('password')));
      nav('/app');
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame title="Welcome back" subtitle="Continue where you left off.">
      <form className="space-y-4" onSubmit={submit}>
        <ErrorBox error={error} />
        <label>
          <span className="label">Email</span>
          <input className="field" name="email" type="email" required />
        </label>
        <label>
          <span className="label">Password</span>
          <input className="field" name="password" type="password" required />
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Log in'}
        </button>
        <p className="text-center text-sm">
          New here?{' '}
          <Link className="text-brand-600" to="/register">
            Create account
          </Link>
        </p>
      </form>
    </Frame>
  );
}
export function Register() {
  const auth = useAuth();
  const nav = useNavigate();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  if (auth.user) return <Navigate to="/app" />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const f = new FormData(e.currentTarget);
    try {
      await auth.register({
        fullName: String(f.get('fullName')),
        email: String(f.get('email')),
        password: String(f.get('password')),
      });
      nav('/onboarding');
    } catch (x) {
      setError(x);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Frame title="Create your workspace" subtitle="Built for any university and any course.">
      <form className="space-y-4" onSubmit={submit}>
        <ErrorBox error={error} />
        <label>
          <span className="label">Full name</span>
          <input className="field" name="fullName" required />
        </label>
        <label>
          <span className="label">Email</span>
          <input className="field" name="email" type="email" required />
        </label>
        <label>
          <span className="label">Password</span>
          <input className="field" name="password" type="password" minLength={8} required />
        </label>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-center text-sm">
          Already registered?{' '}
          <Link className="text-brand-600" to="/login">
            Log in
          </Link>
        </p>
      </form>
    </Frame>
  );
}
