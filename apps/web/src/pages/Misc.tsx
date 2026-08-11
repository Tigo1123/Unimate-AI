import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Empty } from '../components/ui';
type Results = {
  courses: { id: string; name: string }[];
  sources: { id: string; displayName: string }[];
  notes: { id: string; title: string }[];
};
export function SearchPage() {
  const [q, setQ] = useState('');
  const query = useQuery({
    queryKey: ['search', q],
    queryFn: () => api.get<Results>(`/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setQ(String(new FormData(e.currentTarget).get('q')).trim());
  }
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Search</h1>
        <p className="text-slate-500">Find your courses, sources, and notes.</p>
      </header>
      <form className="flex gap-2" onSubmit={submit}>
        <input className="field" name="q" placeholder="Search your workspace…" />
        <button className="btn-primary">Search</button>
      </form>
      {query.data ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(query.data).map(([type, items]) => (
            <section className="card" key={type}>
              <h2 className="mb-3 font-bold capitalize">{type}</h2>
              {items.length ? (
                items.map((item: any) => (
                  <p className="border-b border-slate-100 py-2 text-sm last:border-0" key={item.id}>
                    {item.name ?? item.displayName ?? item.title}
                  </p>
                ))
              ) : (
                <p className="text-sm text-slate-500">No matches</p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <Empty title="Search across your workspace" />
      )}
    </div>
  );
}
export function SettingsPage() {
  const [message, setMessage] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api.patch('/profile', {
      fullName: f.get('fullName'),
      aiResponseLanguage: f.get('language'),
    });
    setMessage('Settings saved.');
  }
  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Profile & settings</h1>
        <p className="text-slate-500">Control your identity and study preferences.</p>
      </header>
      <form className="card space-y-4" onSubmit={submit}>
        <label>
          <span className="label">Full name</span>
          <input className="field" name="fullName" required />
        </label>
        <label>
          <span className="label">AI response language</span>
          <select className="field" name="language">
            <option>English</option>
            <option>French</option>
            <option>Arabic</option>
          </select>
        </label>
        <button className="btn-primary">Save settings</button>
        {message && <p className="text-sm text-green-700">{message}</p>}
      </form>
      <section className="card border-red-200">
        <h2 className="font-bold text-red-700">Data management</h2>
        <p className="my-3 text-sm text-slate-500">
          Account deletion will remove your profile and private study data.
        </p>
        <button className="btn-secondary text-red-700" disabled>
          Delete account (coming before production)
        </button>
      </section>
    </div>
  );
}
