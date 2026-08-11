import { ArrowRight, BookOpen, BrainCircuit, FileQuestion, Layers3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '../app/theme';
export function Landing() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#dff7ea,transparent_35%)] dark:bg-none">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold">
          <BookOpen className="text-brand-600" />
          UniMate AI
        </Link>
        <div className="flex gap-2">
          <ThemeToggle />
          <Link className="btn-secondary" to="/login">
            Log in
          </Link>
          <Link className="btn-primary" to="/register">
            Get started
          </Link>
        </div>
      </header>
      <main>
        <section className="mx-auto max-w-5xl px-5 pb-24 pt-20 text-center">
          <span className="rounded-full bg-brand-50 px-4 py-2 text-sm font-semibold text-brand-700 dark:bg-brand-700/20 dark:text-brand-50">
            Your course materials, made interactive
          </span>
          <h1 className="mx-auto mt-7 max-w-4xl text-5xl font-bold tracking-tight sm:text-7xl">
            Turn university materials into your personal{' '}
            <span className="text-brand-600">AI tutor.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
            Upload lectures, ask grounded questions, make flashcards, practise quizzes, and focus on
            what needs work.
          </p>
          <Link className="btn-primary mt-9 px-6 py-3" to="/register">
            Start studying smarter <ArrowRight size={18} />
          </Link>
        </section>
        <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-24 md:grid-cols-3">
          {[
            [Layers3, 'Everything in one course workspace'],
            [BrainCircuit, 'Answers grounded in your sources'],
            [FileQuestion, 'Practice that reveals weak topics'],
          ].map(([Icon, title]) => {
            const I = Icon as typeof Layers3;
            return (
              <div className="card" key={title as string}>
                <I className="mb-4 text-brand-600" />
                <h2 className="text-lg font-semibold">{title as string}</h2>
              </div>
            );
          })}
        </section>
      </main>
    </div>
  );
}
