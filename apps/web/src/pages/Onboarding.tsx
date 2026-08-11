import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../app/auth';
import { ErrorBox } from '../components/ui';
export function Onboarding() {
  const nav = useNavigate();
  const auth = useAuth();
  const [error, setError] = useState<unknown>();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api.patch('/profile', {
        universityName: f.get('universityName'),
        countryCode: f.get('countryCode'),
        program: f.get('program'),
        academicYear: f.get('academicYear') || null,
        studyLanguage: f.get('studyLanguage'),
      });
      await auth.reload();
      nav('/app');
    } catch (x) {
      setError(x);
    }
  }
  return (
    <main className="grid min-h-screen place-items-center p-5">
      <form onSubmit={submit} className="card w-full max-w-2xl space-y-5 p-8">
        <div>
          <p className="text-sm font-semibold text-brand-600">Welcome to UniMate</p>
          <h1 className="text-3xl font-bold">Personalize your study space</h1>
          <p className="text-slate-500">
            Your institution is profile context only; UniMate works with any university.
          </p>
        </div>
        <ErrorBox error={error} />
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">University</span>
            <input className="field" name="universityName" required />
          </label>
          <label>
            <span className="label">Country code</span>
            <input className="field" name="countryCode" maxLength={3} placeholder="RW" required />
          </label>
          <label>
            <span className="label">Degree or program</span>
            <input className="field" name="program" required />
          </label>
          <label>
            <span className="label">Academic year (optional)</span>
            <input className="field" name="academicYear" />
          </label>
          <label>
            <span className="label">Study language</span>
            <select className="field" name="studyLanguage">
              <option>English</option>
              <option>French</option>
              <option>Arabic</option>
            </select>
          </label>
        </div>
        <button className="btn-primary">Enter my workspace</button>
      </form>
    </main>
  );
}
