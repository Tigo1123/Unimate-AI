import { useQuery } from '@tanstack/react-query';
import { ArrowRight, BookOpen, FileText, Plus, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { Empty, Loading } from '../components/ui';
import { api } from '../lib/api';
type DashboardData = {
  activeSemester?: { name: string } | null;
  courses: {
    id: string;
    name: string;
    code?: string;
    color?: string;
    _count: { sources: number; quizzes: number };
  }[];
  activities: { id: string; type: string; createdAt: string; metadata?: { name?: string } }[];
  recentSources: unknown[];
  recentQuizzes: unknown[];
};
export function Dashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
  });
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">
            {data?.activeSemester?.name ?? 'No active semester'}
          </p>
          <h1 className="text-3xl font-bold">
            Welcome back, {user?.profile?.fullName?.split(' ')[0] ?? 'student'}.
          </h1>
          <p className="mt-1 text-slate-500">What will you understand better today?</p>
        </div>
        <Link to="/app/semesters" className="btn-primary">
          <Plus size={17} />
          Add course
        </Link>
      </header>
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Your courses</h2>
          <Link className="text-sm font-semibold text-brand-600" to="/app/semesters">
            Manage semesters
          </Link>
        </div>
        {data?.courses.length ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.courses.map((c) => (
              <Link className="card group" key={c.id} to={`/app/courses/${c.id}`}>
                <span
                  className="mb-8 grid size-11 place-items-center rounded-xl text-white"
                  style={{ backgroundColor: c.color ?? '#178354' }}
                >
                  <BookOpen size={20} />
                </span>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {c.code || 'Course'}
                </p>
                <h3 className="mt-1 text-lg font-bold group-hover:text-brand-600">{c.name}</h3>
                <div className="mt-4 flex gap-4 text-xs text-slate-500">
                  <span>{c._count.sources} sources</span>
                  <span>{c._count.quizzes} quizzes</span>
                  <ArrowRight className="ml-auto" size={16} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <Empty title="Create your first course">
            Add a semester and course to begin uploading study materials.
          </Empty>
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="card">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold">
            <Sparkles className="text-brand-600" />
            Continue studying
          </h2>
          {data?.courses[0] ? (
            <Link
              className="flex items-center justify-between rounded-xl bg-brand-50 p-4 text-brand-700 dark:bg-brand-700/20 dark:text-brand-50"
              to={`/app/courses/${data.courses[0].id}/chat`}
            >
              <span>
                <b>{data.courses[0].name}</b>
                <small className="block">Ask a question from your material</small>
              </span>
              <ArrowRight />
            </Link>
          ) : (
            <p className="text-sm text-slate-500">Your next study action will appear here.</p>
          )}
        </section>
        <section className="card">
          <h2 className="mb-4 text-lg font-bold">Recent activity</h2>
          {data?.activities.length ? (
            <ul className="space-y-4">
              {data.activities.slice(0, 5).map((a) => (
                <li className="flex gap-3 text-sm" key={a.id}>
                  <FileText className="mt-0.5 text-slate-400" size={17} />
                  <span>
                    {a.type.toLowerCase().replaceAll('_', ' ')}
                    <small className="block text-slate-400">
                      {new Date(a.createdAt).toLocaleDateString()}
                    </small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No study activity yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
