import { useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Logo } from "../components/Logo";
import { ErrorBanner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

const PIN_LENGTH = 6;

export function Login() {
  const { code: codeParam } = useParams();
  const { session, info, error: authError, loginAdmin, loginEmployee } = useAuth();
  const [mode, setMode] = useState<"employee" | "admin">("employee");
  const [code, setCode] = useState((codeParam ?? stored("marcaje.companyCode")).toUpperCase());
  // Si ya conocemos la empresa (enlace o visita anterior) no se la volvemos a pedir.
  const [editingCode, setEditingCode] = useState(!code);
  const [cedula, setCedula] = useState(stored("marcaje.cedula"));
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (codeParam) {
      setCode(codeParam.toUpperCase());
      setEditingCode(false);
      setMode("employee");
    }
  }, [codeParam]);

  if (info) return <Navigate to={info.role === "admin" ? "/admin" : "/marcar"} replace />;

  // Validar las credenciales no es entrar: falta consultar el rol, y con mala señal tarda.
  const entering = busy || (!!session && !authError);

  async function requestPin() {
    setError(null);
    setRequested(false);
    if (!code.trim() || !cedula.trim()) {
      setEditingCode(!code.trim());
      setError("Escribe el código de tu empresa y tu cédula para solicitar el PIN.");
      return;
    }
    setRequesting(true);
    try {
      await api.requestPin({ companyCode: code, cedula });
      setRequested(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRequesting(false);
    }
  }

  async function attempt(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    attempt(() => (mode === "employee" ? loginEmployee(code, cedula, pin) : loginAdmin(email, password)));
  }

  function changePin(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, PIN_LENGTH);
    setPin(digits);
    // Al completar el PIN entra solo: un toque menos.
    if (digits.length === PIN_LENGTH && code && cedula && !entering) attempt(() => loginEmployee(code, cedula, digits));
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <Logo large />
        <h1>
          Tus horas, <em>listas</em> para la nómina.
        </h1>
        <p>El equipo marca su entrada y su salida desde el celular. RRHH cierra el período sin contar horas a mano.</p>
        <ul className="auth-points">
          <li>Horas extra y nocturnas calculadas solas</li>
          <li>Correcciones con motivo y registro</li>
          <li>CSV listo para el motor de nómina</li>
        </ul>
      </section>

      <div className="auth-card">
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={mode === "employee"} className={mode === "employee" ? "active" : ""} onClick={() => setMode("employee")}>
            Soy colaborador
          </button>
          <button role="tab" aria-selected={mode === "admin"} className={mode === "admin" ? "active" : ""} onClick={() => setMode("admin")}>
            Soy RRHH
          </button>
        </div>

        <form onSubmit={submit} className="form">
          {mode === "employee" ? (
            <>
              {editingCode ? (
                <label>
                  Código de empresa
                  <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="organization" placeholder="EMPRESAA" required autoFocus />
                </label>
              ) : (
                <div className="known-company">
                  <span className="muted small">Empresa</span>
                  <strong>{code}</strong>
                  <button type="button" className="link-btn" onClick={() => setEditingCode(true)}>
                    Cambiar
                  </button>
                </div>
              )}
              <label>
                Cédula
                <input value={cedula} onChange={(e) => setCedula(e.target.value)} inputMode="numeric" autoComplete="username" placeholder="12345678" required autoFocus={!editingCode && !cedula} />
              </label>
              <label>
                PIN
                <input className="pin-input" value={pin} onChange={(e) => changePin(e.target.value)} type="password" inputMode="numeric" autoComplete="current-password" placeholder="••••••" required autoFocus={!editingCode && !!cedula} />
              </label>
            </>
          ) : (
            <>
              <label>
                Correo
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" required autoFocus />
              </label>
              <label>
                Contraseña
                <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
              </label>
            </>
          )}
          <ErrorBanner error={error ?? authError} />
          <button className="btn btn-primary btn-block" disabled={entering} aria-busy={entering}>
            {entering && <span className="btn-spinner" aria-hidden />}
            {entering ? "Entrando…" : "Entrar"}
          </button>
        </form>

        {mode === "admin" ? (
          <p className="muted small center">
            ¿Tu empresa aún no usa Marcaje? <Link to="/registro">Regístrala</Link>
          </p>
        ) : (
          <div className="pin-help">
            {requested ? (
              <div className="banner banner-ok" role="status">
                Listo. Avisamos a Recursos Humanos: ellos te darán tu PIN.
              </div>
            ) : (
              <button type="button" className="link-btn" onClick={requestPin} disabled={requesting}>
                {requesting && <span className="btn-spinner" aria-hidden />}
                {requesting ? "Enviando solicitud…" : "¿No tienes PIN? Solicítalo a RRHH"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
