import { employeeEmail, normalizeCedula, normalizeCompanyCode } from "@domain/identity.ts";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type SessionInfo } from "./api";
import { supabase } from "./supabase";

/** Lo único que la app necesita de la sesión. Sin conexión se reconstruye desde el perfil guardado. */
type AuthSession = { user: { id: string } };

interface AuthState {
  /** undefined = cargando */
  session: AuthSession | null | undefined;
  info: SessionInfo | null;
  error: string | null;
  loginAdmin: (email: string, password: string) => Promise<void>;
  loginEmployee: (companyCode: string, cedula: string, pin: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const PROFILE_KEY = "marcaje.profile";

function readProfile(): { userId: string; info: SessionInfo } | null {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? "null");
  } catch {
    return null;
  }
}

function saveProfile(userId: string, info: SessionInfo) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ userId, info }));
  } catch {
    /* sin perfil guardado solo se pierde abrir sin conexión */
  }
}

function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* nada que limpiar */
  }
}

/** Con mala señal una llamada falla seguido; la sesión ya es válida, así que vale la pena insistir. */
const SESSION_RETRIES = 4;
const SESSION_RETRY_MS = 3000;

async function fetchSessionInfo(isCancelled: () => boolean): Promise<SessionInfo> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api.session();
    } catch (e) {
      const transient = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      if (!transient || attempt >= SESSION_RETRIES || isCancelled()) throw e;
      await new Promise((r) => setTimeout(r, SESSION_RETRY_MS));
    }
  }
}

function loginMessage(error: Error, invalid: string): string {
  if (isAuthRetryableFetchError(error) || /fetch/i.test(error.message)) return "No hay conexión. Para entrar por primera vez en este teléfono necesitas internet.";
  return error.message.includes("Invalid") ? invalid : error.message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  // Abre al instante con el perfil guardado. Renovar un token vencido sin red puede
  // tardar 30 s en fallar, y marcar no puede esperar eso.
  const [session, setSession] = useState<AuthSession | null | undefined>(() => {
    const p = readProfile();
    return p ? { user: { id: p.userId } } : undefined;
  });
  const [info, setInfo] = useState<SessionInfo | null>(() => readProfile()?.info ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error: err }) => {
      if (data.session) setSession(data.session);
      else if (err && isAuthRetryableFetchError(err) && readProfile()) return; // sin red: sigue la sesión guardada
      else {
        clearProfile();
        setInfo(null);
        setSession(null);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "INITIAL_SESSION") return; // ya lo resuelve getSession, que distingue "sin red"
      if (s) setSession(s);
      else if (event === "SIGNED_OUT") {
        clearProfile();
        setInfo(null);
        setSession(null);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Cada vez que cambia el usuario, preguntamos a NUESTRA API qué rol tiene.
  const userId = session?.user.id;
  useEffect(() => {
    if (session === undefined) return;
    if (!userId) {
      setInfo(null);
      return;
    }
    if (readProfile()?.userId !== userId) setInfo(null);
    let cancelled = false;
    fetchSessionInfo(() => cancelled)
      .then((i) => {
        if (cancelled) return;
        setInfo(i);
        setError(null);
        saveProfile(userId, i);
      })
      .catch(async (e: ApiError) => {
        if (cancelled) return;
        const cachedOk = readProfile()?.userId === userId;
        if (cachedOk && (e.status === 0 || e.status >= 500)) return; // sin servidor: vale el perfil guardado
        if (e.status === 401 || e.status === 403) {
          // Un 401 sin red para renovar el token no significa que la sesión terminó.
          const { error: err } = await supabase.auth.getSession();
          if (cachedOk && err && isAuthRetryableFetchError(err)) return;
          setError(e.message);
          clearProfile();
          await supabase.auth.signOut();
          return;
        }
        setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, session === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const loginAdmin = useCallback(async (email: string, password: string) => {
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error(loginMessage(error, "Correo o contraseña incorrectos."));
  }, []);

  const loginEmployee = useCallback(async (companyCode: string, cedula: string, pin: string) => {
    setError(null);
    const code = normalizeCompanyCode(companyCode);
    const ced = normalizeCedula(cedula);
    if (!code || !ced) throw new Error("Completa el código de empresa y tu cédula.");
    const { error } = await supabase.auth.signInWithPassword({ email: employeeEmail(code, ced), password: pin.trim() });
    if (error) throw new Error(loginMessage(error, "Código de empresa, cédula o PIN incorrectos."));
    try {
      localStorage.setItem("marcaje.companyCode", code);
      localStorage.setItem("marcaje.cedula", ced);
    } catch {
      /* almacenamiento no disponible: solo es una comodidad */
    }
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    clearProfile();
    setInfo(null);
    setSession(null);
  }, []);

  return <AuthContext.Provider value={{ session, info, error, loginAdmin, loginEmployee, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth fuera de AuthProvider");
  return ctx;
}

export function useAdmin() {
  const { info } = useAuth();
  if (info?.role !== "admin") throw new Error("Ruta solo para RRHH");
  return info;
}
