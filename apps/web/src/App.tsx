import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './app/auth';
import { Loading } from './components/ui';
import { AppLayout } from './layouts/AppLayout';

const Landing = lazy(() =>
  import('./pages/Landing').then((module) => ({ default: module.Landing })),
);
const Login = lazy(() => import('./pages/AuthPages').then((module) => ({ default: module.Login })));
const Register = lazy(() =>
  import('./pages/AuthPages').then((module) => ({ default: module.Register })),
);
const Onboarding = lazy(() =>
  import('./pages/Onboarding').then((module) => ({ default: module.Onboarding })),
);
const Dashboard = lazy(() =>
  import('./pages/Dashboard').then((module) => ({ default: module.Dashboard })),
);
const Semesters = lazy(() =>
  import('./pages/Semesters').then((module) => ({ default: module.Semesters })),
);
const CoursePage = lazy(() =>
  import('./pages/Course').then((module) => ({ default: module.CoursePage })),
);
const QuizAttempt = lazy(() =>
  import('./pages/QuizAttempt').then((module) => ({ default: module.QuizAttempt })),
);
const SearchPage = lazy(() =>
  import('./pages/Misc').then((module) => ({ default: module.SearchPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/Misc').then((module) => ({ default: module.SettingsPage })),
);
const AiUsage = lazy(() =>
  import('./pages/AiUsage').then((module) => ({ default: module.AiUsage })),
);

function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'ADMIN' ? children : <Navigate to="/app" replace />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? children : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/onboarding"
          element={
            <Protected>
              <Onboarding />
            </Protected>
          }
        />
        <Route
          path="/app"
          element={
            <Protected>
              <AppLayout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="semesters" element={<Semesters />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="ai-usage"
            element={
              <AdminOnly>
                <AiUsage />
              </AdminOnly>
            }
          />
          <Route path="quiz-attempts/:attemptId" element={<QuizAttempt />} />
          <Route path="courses/:id" element={<CoursePage />} />
          {[
            'sources',
            'chat',
            'explain',
            'notes',
            'summaries',
            'flashcards',
            'quizzes',
            'progress',
          ].map((tab) => (
            <Route key={tab} path={`courses/:id/${tab}`} element={<CoursePage tab={tab} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
