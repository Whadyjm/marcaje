import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { ErrorBanner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";

export function Register() {
  const { loginAdmin } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ companyName: "", adminName: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.register(form);
      await loginAdmin(form.email, form.password);
      navigate("/admin/colaboradores", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page single">
      <div className="auth-card">
        <Logo large />
        <h1 className="h2">Registra tu empresa</h1>
        <p className="muted small">Serás el administrador de RRHH. Luego das de alta a tu equipo.</p>
        <form onSubmit={submit} className="form">
          <label>
            Nombre de la empresa
            <input value={form.companyName} onChange={set("companyName")} required minLength={2} autoComplete="organization" autoFocus />
          </label>
          <label>
            Tu nombre
            <input value={form.adminName} onChange={set("adminName")} required minLength={2} autoComplete="name" />
          </label>
          <label>
            Correo
            <input value={form.email} onChange={set("email")} type="email" required autoComplete="email" />
          </label>
          <label>
            Contraseña
            <input value={form.password} onChange={set("password")} type="password" required minLength={8} autoComplete="new-password" />
            <span className="hint">Mínimo 8 caracteres.</span>
          </label>
          <ErrorBanner error={error} />
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Creando…" : "Crear empresa"}
          </button>
        </form>
        <p className="muted small center">
          ¿Ya tienes cuenta? <Link to="/entrar">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
