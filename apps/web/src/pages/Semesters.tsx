import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Empty, ErrorBox, Loading } from '../components/ui';
import { api } from '../lib/api';
type Semester = {
  id: string;
  name: string;
  academicYear: string;
  status: string;
  _count: { courses: number };
};
type Course = { id: string; name: string; code?: string; semesterId: string };
export function Semesters() {
  const qc = useQueryClient();
  const [semesterId, setSemesterId] = useState('');
  const [error, setError] = useState<unknown>();
  const semesters = useQuery({
    queryKey: ['semesters'],
    queryFn: () => api.get<Semester[]>('/semesters'),
  });
  const courses = useQuery({ queryKey: ['courses'], queryFn: () => api.get<Course[]>('/courses') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['semesters'] });
    void qc.invalidateQueries({ queryKey: ['courses'] });
  };
  const createSemester = useMutation({
    mutationFn: (x: unknown) => api.post('/semesters', x),
    onSuccess: refresh,
    onError: setError,
  });
  const createCourse = useMutation({
    mutationFn: (x: unknown) => api.post('/courses', x),
    onSuccess: refresh,
    onError: setError,
  });
  if (semesters.isLoading || courses.isLoading) return <Loading />;
  function sem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    createSemester.mutate({ name: f.get('name'), academicYear: f.get('academicYear') });
    e.currentTarget.reset();
  }
  function course(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    createCourse.mutate({ name: f.get('name'), code: f.get('code') || null, semesterId });
    e.currentTarget.reset();
  }
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-bold">Semesters & courses</h1>
        <p className="text-slate-500">Organize your workspace in the way your university works.</p>
      </header>
      <ErrorBox error={error} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form className="card space-y-4" onSubmit={sem}>
          <h2 className="font-bold">New semester</h2>
          <input className="field" name="name" placeholder="Semester 1" required />
          <input className="field" name="academicYear" placeholder="2026–2027" required />
          <button className="btn-primary">
            <Plus size={16} />
            Create semester
          </button>
        </form>
        <form className="card space-y-4" onSubmit={course}>
          <h2 className="font-bold">New course</h2>
          <select
            className="field"
            value={semesterId}
            onChange={(e) => setSemesterId(e.target.value)}
            required
          >
            <option value="">Select semester</option>
            {semesters.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input className="field" name="name" placeholder="Database Administration" required />
          <input className="field" name="code" placeholder="CSC302 (optional)" />
          <button className="btn-primary">
            <Plus size={16} />
            Create course
          </button>
        </form>
      </div>
      {semesters.data?.length ? (
        <div className="space-y-5">
          {semesters.data.map((s) => (
            <section className="card" key={s.id}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">{s.name}</h2>
                  <p className="text-sm text-slate-500">
                    {s.academicYear} · {s.status.toLowerCase()}
                  </p>
                </div>
                {s.status !== 'ACTIVE' && (
                  <button
                    className="btn-secondary"
                    onClick={() => void api.post(`/semesters/${s.id}/activate`).then(refresh)}
                  >
                    Set active
                  </button>
                )}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {courses.data
                  ?.filter((c) => c.semesterId === s.id)
                  .map((c) => (
                    <Link
                      className="rounded-xl border border-slate-200 p-4 hover:border-brand-500 dark:border-slate-700"
                      key={c.id}
                      to={`/app/courses/${c.id}`}
                    >
                      <b>{c.name}</b>
                      <span className="ml-2 text-xs text-slate-500">{c.code}</span>
                    </Link>
                  ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Empty title="No semesters yet">Create one above to begin.</Empty>
      )}
    </div>
  );
}
