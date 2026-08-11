import {
  BarChart3,
  BookOpen,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Search,
  Settings,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../app/auth';
import { ThemeToggle } from '../app/theme';

export function AppLayout() {
  const { user, logout } = useAuth();
  const links = [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/semesters', label: 'Semesters', icon: GraduationCap },
    { to: '/app/search', label: 'Search', icon: Search },
    ...(user?.role === 'ADMIN'
      ? [{ to: '/app/ai-usage', label: 'AI usage', icon: BarChart3 }]
      : []),
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[250px_1fr]">
      <aside className="border-b border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900 lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="mb-6 flex items-center justify-between gap-2 px-2">
          <NavLink to="/app" className="flex items-center gap-2 text-lg font-bold">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-600 text-white">
              <BookOpen size={19} />
            </span>
            UniMate AI
          </NavLink>
          <ThemeToggle className="lg:hidden" />
        </div>
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              end={to === '/app'}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-700/20 dark:text-brand-50' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-8 hidden border-t border-slate-200 pt-4 dark:border-slate-800 lg:block">
          <p className="truncate px-2 text-sm font-semibold">{user?.profile?.fullName}</p>
          <p className="truncate px-2 text-xs text-slate-500">{user?.email}</p>
          <div className="mt-3 flex">
            <ThemeToggle />
            <button className="btn px-2 text-red-600" onClick={() => void logout()}>
              <LogOut size={17} /> Logout
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0">
        <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
