/**
 * Identidad de los colaboradores.
 *
 * Los colaboradores no tienen (ni necesitan) correo: inician sesión con el
 * código de su empresa, su cédula y un PIN. Supabase Auth exige un email, así
 * que derivamos uno sintético y determinista que nunca recibe correos.
 * El cliente y el backend usan esta misma función.
 */

export const EMPLOYEE_EMAIL_DOMAIN = "colaborador.marcaje.app";

/** Acepta "V-12.345.678", "12345678", "e 1234567"… y devuelve solo dígitos. */
export function normalizeCedula(input: string): string {
  return input.replace(/[^0-9]/g, "").replace(/^0+/, "");
}

export function isValidCedula(cedula: string): boolean {
  return /^[0-9]{5,10}$/.test(cedula);
}

export function normalizeCompanyCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function employeeEmail(companyCode: string, cedula: string): string {
  return `${normalizeCedula(cedula)}.${normalizeCompanyCode(companyCode).toLowerCase()}@${EMPLOYEE_EMAIL_DOMAIN}`;
}
