import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PeriodPicker, presets, type Period as PeriodT } from "../../components/PeriodPicker";
import { Empty, ErrorBanner, Spinner, useAsync } from "../../components/ui";
import { api } from "../../lib/api";
import { useAdmin } from "../../lib/auth";
import { formatDay, formatHours } from "../../lib/format";
import { useAutoRefresh } from "../../lib/useAutoRefresh";

export function Period() {
  const admin = useAdmin();
  const [params] = useSearchParams();
  const [period, setPeriod] = useState<PeriodT>(() => {
    const from = params.get("from");
    const to = params.get("to");
    return from && to ? { from, to } : presets()[1].period; // semana anterior: lo típico al cerrar nómina
  });
  const { data, error, loading, reload, refresh } = useAsync(() => api.report(period.from, period.to), [period.from, period.to]);
  useAutoRefresh(refresh);
  const [downloading, setDownloading] = useState(false);
  const [dlError, setDlError] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setDlError(null);
    try {
      await api.downloadCsv(period.from, period.to, admin.company.code);
      await reload(); // la exportación queda registrada: el aviso de cambios vuelve a cero
    } catch (e) {
      setDlError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  const totals = data?.rows.reduce(
    (t, r) => ({
      overtimeDay: t.overtimeDay + r.hours.overtimeDay,
      overtimeNight: t.overtimeNight + r.hours.overtimeNight,
      nightShift: t.nightShift + r.hours.nightShift,
    }),
    { overtimeDay: 0, overtimeNight: 0, nightShift: 0 },
  );
  const range = `from=${period.from}&to=${period.to}`;

  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            Período · {formatDay(period.from)} → {formatDay(period.to)}
          </span>
          <h1>Horas listas para la nómina</h1>
        </div>
      </div>

      <div className="card filters">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      <ErrorBanner error={dlError} />

      {loading && !data ? (
        <Spinner label="Calculando…" />
      ) : error ? (
        <ErrorBanner error={error} onRetry={reload} />
      ) : !data ? null : (
        <>
          {data.openShifts > 0 && (
            <div className="banner banner-warn">
              <span>
                <strong>
                  {data.openShifts} turno{data.openShifts > 1 ? "s" : ""} sin salida.
                </strong>{" "}
                No se suman hasta completarlos.
              </span>
              <Link className="btn btn-ghost btn-sm" to={`/admin/marcajes?${range}&only=open`}>
                Completar ahora
              </Link>
            </div>
          )}
          {data.reviewShifts > 0 && (
            <div className="banner banner-warn">
              <span>
                <strong>
                  {data.reviewShifts} turno{data.reviewShifts > 1 ? "s" : ""} por revisar.
                </strong>{" "}
                Se hicieron sin conexión y no se suman hasta que los resuelvas.
              </span>
              <Link className="btn btn-ghost btn-sm" to="/admin/marcajes">
                Revisar
              </Link>
            </div>
          )}
          {data.changedSinceExport > 0 && (
            <div className="banner banner-warn">
              <span>
                <strong>
                  {data.changedSinceExport} turno{data.changedSinceExport > 1 ? "s" : ""} cambiaron después de tu última exportación.
                </strong>{" "}
                El archivo enviado a nómina ya no coincide. Descárgalo de nuevo.
              </span>
            </div>
          )}
          {data.alerts.length > 0 && (
            <div className="banner banner-warn">
              <div>
                <strong>Más de 10 h extra en una semana</strong> (no bloquea la exportación):{" "}
                {data.alerts.map((a) => `${a.name}: ${formatHours(a.overtimeHours)} h, semana del ${formatDay(a.weekStart)}`).join(" · ")}
              </div>
            </div>
          )}

          <div className="card file-row">
            <span className="file-type">CSV</span>
            <div className="grow">
              <strong>Archivo para el motor de nómina</strong>
              <div className="muted small">
                marcaje_{admin.company.code}_{period.from}_{period.to}.csv · {data.rows.length} fila{data.rows.length === 1 ? "" : "s"}
              </div>
            </div>
            <button className="btn btn-primary" onClick={download} disabled={downloading}>
              {downloading ? "Generando…" : "Descargar"}
            </button>
          </div>

          {data.rows.length === 0 ? (
            <Empty>No hay colaboradores en este período.</Empty>
          ) : (
            <div className="card flush">
              <table className="table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Cédula</th>
                    <th className="right">Turnos</th>
                    <th className="right">Total</th>
                    <th className="right">Ordinarias</th>
                    <th className="right" title="overtimeDayHours">
                      Extra diurna
                    </th>
                    <th className="right" title="overtimeNightHours">
                      Extra nocturna
                    </th>
                    <th className="right" title="nightShiftHours">
                      Nocturna ord.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.employeeId} className={r.alert ? "row-alert" : ""}>
                      <td data-label="Colaborador">
                        <span>
                          <Link to={`/admin/marcajes?${range}&employeeId=${r.employeeId}`} title="Ver sus marcajes">
                            {r.name}
                          </Link>
                          {r.alert && <span className="badge st-warn">+10 h extra</span>}
                          {r.openShiftIds.length > 0 && <span className="badge st-warn">{r.openShiftIds.length} sin salida</span>}
                          {r.reviewShiftIds.length > 0 && <span className="badge st-warn">{r.reviewShiftIds.length} por revisar</span>}
                          {!r.active && <span className="badge st-none">inactivo</span>}
                        </span>
                      </td>
                      <td data-label="Cédula">{r.cedula}</td>
                      <td data-label="Turnos" className="right num">
                        {r.shiftCount}
                      </td>
                      <td data-label="Total" className="right num">
                        {formatHours(r.hours.total)}
                      </td>
                      <td data-label="Ordinarias" className="right num">
                        {formatHours(r.hours.ordinary)}
                      </td>
                      <td data-label="Extra diurna" className="right num strong">
                        {formatHours(r.hours.overtimeDay)}
                      </td>
                      <td data-label="Extra nocturna" className="right num strong">
                        {formatHours(r.hours.overtimeNight)}
                      </td>
                      <td data-label="Nocturna ord." className="right num strong">
                        {formatHours(r.hours.nightShift)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {totals && (
                  <tfoot>
                    <tr>
                      <td colSpan={5}>Total del período</td>
                      <td className="right num" data-label="Extra diurna">
                        {formatHours(totals.overtimeDay)}
                      </td>
                      <td className="right num" data-label="Extra nocturna">
                        {formatHours(totals.overtimeNight)}
                      </td>
                      <td className="right num" data-label="Nocturna ord.">
                        {formatHours(totals.nightShift)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          <p className="hint">Los turnos cuentan en el día en que empiezan. El redondeo a 2 decimales se hace al final del período.</p>
        </>
      )}
    </>
  );
}
