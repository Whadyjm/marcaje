import { describe, expect, it } from "vitest";
import { addToTime, hasReason, outDateFor, parseEmployeeList, toggleReason } from "../web/src/lib/shiftForm.ts";

describe("atajos del formulario de turnos", () => {
  it("suma horas dando la vuelta a medianoche", () => {
    expect(addToTime("08:00", 480)).toBe("16:00");
    expect(addToTime("22:00", 480)).toBe("06:00");
  });

  it("deduce la fecha de salida: si no es posterior a la entrada, terminó al día siguiente", () => {
    expect(outDateFor("2026-10-05", "08:00", "17:00")).toBe("2026-10-05");
    expect(outDateFor("2026-10-06", "14:00", "00:30")).toBe("2026-10-07");
    expect(outDateFor("2026-10-31", "22:00", "06:00")).toBe("2026-11-01");
    expect(outDateFor("2026-10-05", "08:00", "08:00")).toBe("2026-10-06"); // 24 h exactas
  });

  it("los motivos se agregan y se quitan sin borrar lo escrito", () => {
    let t = toggleReason("", "Olvidó marcar la salida");
    expect(t).toBe("Olvidó marcar la salida");
    t = toggleReason(t, "Confirmado por el supervisor");
    expect(t).toBe("Olvidó marcar la salida. Confirmado por el supervisor");
    expect(hasReason(t, "Confirmado por el supervisor")).toBe(true);
    expect(toggleReason(t, "Olvidó marcar la salida")).toBe("Confirmado por el supervisor");
    expect(toggleReason("Salió a las 5", "Marcó por error")).toBe("Salió a las 5. Marcó por error");
  });
});

describe("alta masiva", () => {
  it("acepta columnas de Excel, punto y coma y coma, en cualquier orden", () => {
    const r = parseEmployeeList("Nombre\tCédula\nAna Pérez\t12345678\nLuis Gómez; V-20.111.222\n18555666, María Rodríguez");
    expect(r).toEqual([
      { line: "Ana Pérez\t12345678", name: "Ana Pérez", cedula: "12345678" },
      { line: "Luis Gómez; V-20.111.222", name: "Luis Gómez", cedula: "20111222" },
      { line: "18555666, María Rodríguez", name: "María Rodríguez", cedula: "18555666" },
    ]);
  });

  it("señala líneas inválidas y cédulas repetidas", () => {
    const r = parseEmployeeList("Ana Pérez\nAna Pérez; 123\n12345678\nAna; 12345678\nOtra Ana; 12345678");
    expect(r.map((x) => x.error)).toEqual(["Cédula inválida o faltante", "Cédula inválida o faltante", "Falta el nombre", undefined, "Cédula repetida en la lista"]);
  });
});
