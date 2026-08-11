import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  api,
  hasAccessToken,
  hasSessionHint,
  restoreAccessToken,
  setAccessToken,
} from '../lib/api';

type User = {
  id: string;
  email: string;
  role: 'STUDENT' | 'ADMIN';
  onboardingCompletedAt?: string | null;
  profile?: { fullName: string };
};
type AuthValue = {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; fullName: string }): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const bootstrapped = useRef(false);
  const reload = async () => {
    if (!hasAccessToken() && !hasSessionHint()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      if (!hasAccessToken()) await restoreAccessToken();
      setUser(await api.get<User>('/auth/me'));
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void reload();
  }, []);
  const value = useMemo<AuthValue>(
    () => ({
      user,
      loading,
      reload,
      async login(email, password) {
        const result = await api.post<{ user: User; accessToken: string }>('/auth/login', {
          email,
          password,
        });
        setAccessToken(result.accessToken);
        setUser(result.user);
      },
      async register(input) {
        const result = await api.post<{ user: User; accessToken: string }>('/auth/register', input);
        setAccessToken(result.accessToken);
        setUser(result.user);
      },
      async logout() {
        await api.post('/auth/logout');
        setAccessToken(null);
        setUser(null);
      },
    }),
    [user, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
};
