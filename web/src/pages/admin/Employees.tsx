import { useMemo, useRef, useState, type FormEvent } from "react";
import { summarizeWeek } from "@domain/schedule.ts";
import { PIN_REQUESTS_CHANGED } from "../../components/AdminLayout";
import { ScheduleEditor } from "../../components/ScheduleEditor";
import { ShiftChangeRequests } from "../../components/ShiftChangeRequests";
import { Empty, ErrorBanner, Modal, Spinner, useAsync } from "../../components/ui";
import { api, type Employee, type WeekSchedule } from "../../lib/api";
import { useAdmin } from "../../lib/auth";
import { formatInstant } from "../../lib/format";
import { parseEmployeeList } from "../../lib/shiftForm";

interface Credentials {
  name: string;
  cedula: string;
  pin: string;
}

const byName = (a: Employee, b: Employee) => a.name.localeCompare(b.name, "es");

export function Employees() {
  const admin = useAdmin();
  const { data, error, loading, reload, setData } = useAsync(() => api.employees(), []);
  const pins = useAsync(() => api.pinRequests(), []);
  const schedules = useAsync(() => api.schedules(), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scheduling, setScheduling] = useState<{ employees: Employee[]; initial: WeekSchedule | null } | null>(null);
  const [savingTolerance, setSavingTolerance] = useState(false);
  const [pinBusy, setPinBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [cedula, setCedula] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials[] | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [search, setSearch] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);

  const addToList = (employee: Employee) => setData((d) => ({ employees: [...(d?.employees ?? []), employee].sort(byName) }));

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.createEmployee({ name, cedula });
      setCredentials([{ name: res.employee.name, cedula: res.employee.cedula, pin: res.pin }]);
      setName("");
      setCedula("");
      addToList(res.employee);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetPin(emp: Employee) {
    if (!confirm(`¿Generar un PIN nuevo para ${emp.name}? El anterior dejará de funcionar.`)) return;
    setActionError(null);
    try {
      const res = await api.resetPin(emp.id);
      setCredentials([{ name: emp.name, cedula: emp.cedula, pin: res.pin }]);
      await pins.reload(); // pudo tener una solicitud pendiente
      window.dispatchEvent(new Event(PIN_REQUESTS_CHANGED));
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function answerRequest(id: string, fn: () => Promise<void>) {
    setPinBusy(id);
    setActionError(null);
    try {
      await fn();
      await pins.reload();
      window.dispatchEvent(new Event(PIN_REQUESTS_CHANGED));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setPinBusy(null);
    }
  }

  async function toggleActive(emp: Employee) {
    if (emp.active && !confirm(`¿Desactivar a ${emp.name}? No podrá entrar ni marcar. Sus marcajes se conservan.`)) return;
    setActionError(null);
    try {
      const { employee } = await api.updateEmployee(emp.id, { active: !emp.active });
      setData((d) => ({ employees: (d?.employees ?? []).map((e) => (e.id === employee.id ? employee : e)) }));
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  const weekOf = (id: string) => schedules.data?.schedules.find((s) => s.employeeId === id)?.week ?? null;

  function toggleSelected(id: string) {
    setSelected((all) => {
      const next = new Set(all);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function saveTolerance(minutes: number) {
    setSavingTolerance(true);
    setActionError(null);
    try {
      await api.saveTolerance(minutes);
      await schedules.reload();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setSavingTolerance(false);
    }
  }

  const q = search.trim().toLowerCase();
  const employees = (data?.employees ?? []).filter((e) => (showInactive || e.active) && (!q || e.name.toLowerCase().includes(q) || e.cedula.includes(q)));
  const inactiveCount = data?.employees.filter((e) => !e.active).length ?? 0;
  const loginLink = `${window.location.origin}/c/${admin.company.code}`;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Equipo{data ? ` · ${data.employees.filter((e) => e.active).length} activos` : ""}</span>
          <h1>Colaboradores</h1>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => setBulkOpen(true)}>
            Pegar una lista
          </button>
        </div>
      </div>

      <ShiftChangeRequests />

      {!!pins.data?.requests.length && (
        <section className="card pin-requests">
          <h2 className="h3">Solicitudes de PIN · {pins.data.requests.length}</h2>
          <p className="muted small">Confirma que sea esa persona antes de entregarle el PIN. Generar uno nuevo invalida el anterior.</p>
          <ul className="list">
            {pins.data.requests.map((r) => (
              <li key={r.id} className="list-row">
                <div className="grow">
                  <strong>{r.employee.name}</strong>
                  <div className="muted small">
                    C.I. {r.employee.cedula} · {formatInstant(r.createdAt)}
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={pinBusy === r.id}
                    onClick={() =>
                      answerRequest(r.id, async () => {
                        const res = await api.resetPin(r.employee.id);
                        setCredentials([{ name: r.employee.name, cedula: r.employee.cedula, pin: res.pin }]);
                      })
                    }
                  >
                    Generar PIN
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={pinBusy === r.id}
                    onClick={() =>
                      answerRequest(r.id, async () => {
                        await api.dismissPinRequest(r.id);
                      })
                    }
                  >
                    Descartar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form className="card form-inline" onSubmit={create}>
        <label className="grow">
          Nombre completo
          <input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Pérez" required minLength={2} autoComplete="off" />
        </label>
        <label>
          Cédula
          <input value={cedula} onChange={(e) => setCedula(e.target.value)} placeholder="12345678" inputMode="numeric" required autoComplete="off" />
        </label>
        <button className="btn btn-primary" disabled={busy}>
          {busy ? "Creando…" : "Dar de alta"}
        </button>
        <ErrorBanner error={formError} />
      </form>

      <ErrorBanner error={actionError} />
      {schedules.data && (
        <div className="tolerance">
          <span className="small">Tolerancia para llegar tarde o salir antes:</span>
          <div className="chips">
            {[0, 5, 10, 15, 30].map((m) => (
              <button key={m} className={`chip chip-sm${schedules.data!.toleranceMin === m ? " active" : ""}`} aria-pressed={schedules.data!.toleranceMin === m} disabled={savingTolerance} onClick={() => saveTolerance(m)}>
                {m} min
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="hint team-link">
        Tu equipo entra en <a href={loginLink}>{loginLink.split("//")[1]}</a> con su cédula y PIN.
      </p>

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner error={error} onRetry={reload} />
      ) : !data?.employees.length ? (
        <Empty>Aún no hay colaboradores. Da de alta al primero con su nombre y cédula, o pega una lista.</Empty>
      ) : (
        <>
          {data.employees.length > 6 && <input className="search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o cédula" aria-label="Buscar colaborador" />}
          {selected.size > 0 && (
            <div className="bulk-bar">
              <span className="small">{selected.size} seleccionado{selected.size === 1 ? "" : "s"}</span>
              <button className="btn btn-primary btn-sm" onClick={() => setScheduling({ employees: (data?.employees ?? []).filter((e) => selected.has(e.id)), initial: null })}>
                Asignar horario
              </button>
              <button className="link-btn" onClick={() => setSelected(new Set())}>
                Limpiar
              </button>
            </div>
          )}
          <div className="card flush">
            <table className="table">
              <thead>
                <tr>
                  <th aria-label="Seleccionar" />
                  <th>Nombre</th>
                  <th>Cédula</th>
                  <th>Horario</th>
                  <th>Estado</th>
                  <th className="right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id} className={e.active ? "" : "inactive"}>
                    <td className="select-cell">
                      {e.active && <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggleSelected(e.id)} aria-label={`Seleccionar a ${e.name}`} />}
                    </td>
                    <td data-label="Nombre">{e.name}</td>
                    <td data-label="Cédula">{e.cedula}</td>
                    <td data-label="Horario">
                      {e.active ? (
                        <button className="link-btn schedule-link" onClick={() => setScheduling({ employees: [e], initial: weekOf(e.id) })}>
                          {weekOf(e.id) ? summarizeWeek(weekOf(e.id)) : "Asignar"}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td data-label="Estado">{e.active ? <span className="badge st-in">Activo</span> : <span className="badge st-none">Inactivo</span>}</td>
                    <td className="right actions">
                      {e.active && (
                        <button className="link-btn" onClick={() => resetPin(e)}>
                          Nuevo PIN
                        </button>
                      )}
                      <button className="link-btn" onClick={() => toggleActive(e)}>
                        {e.active ? "Desactivar" : "Reactivar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {inactiveCount > 0 && (
        <label className="check small">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Mostrar inactivos ({inactiveCount})
        </label>
      )}

      {scheduling && (
        <ScheduleEditor
          employees={scheduling.employees}
          initial={scheduling.initial}
          onClose={() => setScheduling(null)}
          onSaved={() => {
            setScheduling(null);
            setSelected(new Set());
            void schedules.reload();
          }}
        />
      )}

      {bulkOpen && (
        <BulkAdd
          onCreated={addToList}
          onDone={(creds) => {
            setBulkOpen(false);
            if (creds.length) setCredentials(creds);
          }}
        />
      )}

      {credentials && (
        <CredentialsModal
          credentials={credentials}
          companyName={admin.company.name}
          companyCode={admin.company.code}
          loginLink={loginLink}
          onClose={() => {
            setCredentials(null);
            nameRef.current?.focus(); // listo para el siguiente
          }}
        />
      )}
    </>
  );
}

function BulkAdd({ onCreated, onDone }: { onCreated: (e: Employee) => void; onDone: (c: Credentials[]) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failures, setFailures] = useState<string[]>([]);
  const createdRef = useRef<Credentials[]>([]);
  const parsed = useMemo(() => parseEmployeeList(text), [text]);
  const valid = parsed.filter((p) => !p.error);
  const invalid = parsed.filter((p) => p.error);

  async function run() {
    setBusy(true);
    setFailures([]);
    const created: Credentials[] = [];
    const failed: string[] = [];
    // De a uno: cada alta crea un usuario de Auth y queremos reportar los errores por persona.
    for (const [i, p] of valid.entries()) {
      setProgress(i + 1);
      try {
        const res = await api.createEmployee({ name: p.name!, cedula: p.cedula! });
        onCreated(res.employee);
        created.push({ name: res.employee.name, cedula: res.employee.cedula, pin: res.pin });
      } catch (err) {
        failed.push(`${p.name} (${p.cedula}): ${(err as Error).message}`);
      }
    }
    setBusy(false);
    createdRef.current = created;
    if (failed.length) setFailures(failed); // los PIN de los que sí se crearon se muestran al continuar
    else onDone(created);
  }

  return (
    <Modal
      title="Pegar una lista"
      onClose={() => !busy && onDone(createdRef.current)}
      footer={
        failures.length ? (
          <button className="btn btn-primary" onClick={() => onDone(createdRef.current)}>
            Continuar
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" onClick={() => onDone([])} disabled={busy}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={run} disabled={busy || valid.length === 0}>
              {busy ? `Creando ${progress} de ${valid.length}…` : `Dar de alta a ${valid.length}`}
            </button>
          </>
        )
      }
    >
      {failures.length ? (
        <div className="banner banner-error stack">
          <strong>No se pudieron crear:</strong>
          <ul className="inline-list">
            {failures.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="form">
          <label>
            Una persona por línea: nombre y cédula
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} disabled={busy} placeholder={"Ana Pérez; 12345678\nLuis Gómez; V-20.111.222"} />
            <span className="hint">Puedes copiar dos columnas de Excel y pegarlas aquí.</span>
          </label>
          {invalid.length > 0 && (
            <div className="banner banner-warn stack">
              <strong>{invalid.length} línea(s) se omitirán:</strong>
              <ul className="inline-list">
                {invalid.slice(0, 5).map((p) => (
                  <li key={p.line}>
                    “{p.line}”: {p.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function CredentialsModal({ credentials, companyName, companyCode, loginLink, onClose }: { credentials: Credentials[]; companyName: string; companyCode: string; loginLink: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const single = credentials.length === 1 ? credentials[0] : null;
  const message = single
    ? `Hola ${single.name}. Ya puedes marcar tu entrada y salida en ${companyName}.\nEntra en ${loginLink}\nCédula: ${single.cedula}\nPIN: ${single.pin}`
    : `Marcaje de ${companyName}: ${loginLink}\n\n${credentials.map((c) => `${c.name} · Cédula ${c.cedula} · PIN ${c.pin}`).join("\n")}`;

  async function copy() {
    await navigator.clipboard?.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal
      title={single ? `Acceso de ${single.name}` : `${credentials.length} accesos creados`}
      onClose={onClose}
      footer={
        <button className="btn btn-ghost" onClick={onClose}>
          Listo
        </button>
      }
    >
      <p className="small">
        El PIN <strong>solo se muestra ahora</strong>. Si se pierde, genera uno nuevo.
      </p>
      {single ? (
        <dl className="credentials">
          <dt>Enlace</dt>
          <dd>
            <code>{loginLink}</code>
          </dd>
          <dt>Código de empresa</dt>
          <dd>
            <code>{companyCode}</code>
          </dd>
          <dt>Cédula</dt>
          <dd>
            <code>{single.cedula}</code>
          </dd>
          <dt>PIN</dt>
          <dd>
            <code className="pin">{single.pin}</code>
          </dd>
        </dl>
      ) : (
        <ul className="list credentials-list">
          {credentials.map((c) => (
            <li key={c.cedula} className="list-row">
              <span>
                {c.name} <span className="muted small">· {c.cedula}</span>
              </span>
              <code className="pin pin-sm">{c.pin}</code>
            </li>
          ))}
        </ul>
      )}
      <div className="share">
        {single && (
          <a className="btn btn-primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">
            Enviar por WhatsApp
          </a>
        )}
        <button className={`btn ${single ? "btn-ghost" : "btn-primary"}`} onClick={copy}>
          {copied ? "¡Copiado!" : single ? "Copiar mensaje" : "Copiar todos"}
        </button>
      </div>
    </Modal>
  );
}
