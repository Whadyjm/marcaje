import { useId, useState, type InputHTMLAttributes, type ReactNode } from "react";

/** Campo de contraseña o PIN con botón para mostrar u ocultar lo escrito. */
export function PasswordInput({ label, name, hint, className, ...input }: { label: string; name: string; hint?: ReactNode } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "name">) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const action = `${visible ? "Ocultar" : "Mostrar"} ${name}`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input {...input} id={id} className={className} type={visible ? "text" : "password"} />
        <button
          type="button"
          className="password-toggle"
          aria-label={action}
          title={action}
          aria-pressed={visible}
          onMouseDown={(e) => e.preventDefault()} // conserva el foco en el campo
          onClick={() => setVisible(!visible)}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
            {visible && <path d="m3 3 18 18" />}
          </svg>
        </button>
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
