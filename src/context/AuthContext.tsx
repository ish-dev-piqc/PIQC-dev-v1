import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  name: string;
  role: 'AUDITOR' | 'LEAD_AUDITOR' | 'OBSERVER';
  title: string | null;
  organization: string | null;
  timezone: string | null;
  phone: string | null;
  profile_completed_at: string | null;
  is_demo_user: boolean;
}

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: UserProfile | null;
  profileLoading: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  passwordRecoveryPending: boolean;
  completePasswordRecovery: () => void;
  sessionExpired: boolean;
  clearSessionExpired: () => void;
  profileFetchError: boolean;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  profile: null,
  profileLoading: false,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
  passwordRecoveryPending: false,
  completePasswordRecovery: () => {},
  sessionExpired: false,
  clearSessionExpired: () => {},
  profileFetchError: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordRecoveryPending, setPasswordRecoveryPending] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [profileFetchError, setProfileFetchError] = useState(false);
  // Set right before an explicit user-initiated signOut() call so the
  // subsequent SIGNED_OUT event isn't mistaken for a silent session expiry.
  const explicitSignOutRef = useRef(false);
  // Tracks the previous session across auth events so a SIGNED_OUT that
  // follows a real session (as opposed to the initial unauthenticated
  // state) can be distinguished from a background token-refresh failure.
  const previousSessionRef = useRef<Session | null>(null);

  const fetchProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    setProfileFetchError(false);
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, name, role, title, organization, timezone, phone, profile_completed_at, is_demo_user')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.error('Failed to load user profile', error);
      setProfile(null);
      setProfileFetchError(true);
    } else {
      setProfile((data as UserProfile | null) ?? null);
    }
    setProfileLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        setSession(data.session);
      })
      .catch((err) => {
        console.error('Failed to load initial session', err);
        setSession(null);
      })
      .finally(() => {
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecoveryPending(true);
      }
      if (event === 'SIGNED_OUT') {
        if (explicitSignOutRef.current) {
          explicitSignOutRef.current = false;
        } else if (previousSessionRef.current) {
          setSessionExpired(true);
        }
        setPasswordRecoveryPending(false);
      }
      previousSessionRef.current = newSession;
      setSession(newSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user?.id) {
      fetchProfile(session.user.id);
    } else {
      setProfile(null);
      setProfileFetchError(false);
    }
  }, [session?.user?.id, fetchProfile]);

  const signOut = async () => {
    explicitSignOutRef.current = true;
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setProfileFetchError(false);
    setPasswordRecoveryPending(false);
  };

  const refreshProfile = async () => {
    if (session?.user?.id) await fetchProfile(session.user.id);
  };

  const completePasswordRecovery = useCallback(() => {
    setPasswordRecoveryPending(false);
  }, []);

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        profileLoading,
        loading,
        signOut,
        refreshProfile,
        passwordRecoveryPending,
        completePasswordRecovery,
        sessionExpired,
        clearSessionExpired,
        profileFetchError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
