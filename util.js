// =========================================================
// Utilidades compartidas por todos los módulos
// =========================================================
export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const fmtMesBase = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
export const fmtMes = { format: (d) => fmtMesBase.format(d).replace(/^./, (c) => c.toUpperCase()) };
export const _fmtDia = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "noviembre de 2026" -> "Noviembre de 2026"; "sábado, 14 de noviembre" -> "Sábado, 14 de noviembre"
export const fmtDia = { format: (d) => cap(_fmtDia.format(d)) };

export function primerDiaMes(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export function ultimoDiaMes(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
export function pad(n) { return String(n).padStart(2, '0'); }
// Fecha local en formato YYYY-MM-DD (sin desfase de zona horaria)
export function isoLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function desdeIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
export function hoyIso() { return isoLocal(new Date()); }

export function parseImporte(txt) {
  // Acepta "12,50", "12.50", "1.234,56" y "1234.56"
  let s = String(txt).trim().replace(/\s|€/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
export function importeATexto(n) { return Number(n).toFixed(2).replace('.', ','); }

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer;
export function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), error ? 4000 : 2200);
}

export function fallo(err) {
  console.error(err);
  if (!navigator.onLine || /failed to fetch|network/i.test(err?.message || '')) {
    return toast('Sin conexión: no se pueden cargar ni guardar datos', true);
  }
  toast(err?.message || 'Algo ha fallado', true);
}

export const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
// [6, 12] -> "Jun y Dic"; null -> "Todos los meses"
export function textoMeses(meses) {
  if (!meses?.length || meses.length === 12) return 'Todos los meses';
  const n = [...meses].sort((a, b) => a - b).map((m) => MESES_CORTOS[m - 1]);
  return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
}


export const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
export const eur0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

export const diaSemana = (iso) => (desdeIso(iso).getDay() + 6) % 7; // 0 = lunes … 6 = domingo
export const esFinde = (iso) => diaSemana(iso) >= 5;

// Supabase devuelve como máximo 1000 filas por consulta: pide por páginas
export async function cargarRango(sb, desde, hasta, cols = 'fecha,tipo,importe,categoria_id,recurrente_id') {
  const filas = [];
  const PAG = 1000;
  for (let i = 0; ; i += PAG) {
    const { data, error } = await sb.from('movimientos').select(cols)
      .gte('fecha', desde).lte('fecha', hasta).order('id').range(i, i + PAG - 1);
    if (error) throw error;
    filas.push(...data);
    if (data.length < PAG) break;
  }
  return filas;
}

export const sumar = (lista) => lista.reduce((s, m) => s + Number(m.importe), 0);
export const addDias = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const diasEntre = (a, b) => Math.round((b - a) / 86400000); // fechas locales a medianoche
