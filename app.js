// =========================================================
// Control de gastos — lógica de la app
// HTML + CSS + JS sin framework, datos en Supabase
// =========================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// La clave publicable es pública por diseño: la seguridad la dan
// el login y las políticas RLS de la base de datos.
const SUPABASE_URL = 'https://midcwxxcnqunkptrfkwf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KuBhTzrQqGVF_iEzhWI34Q_GZVpBAc9';

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

// Si el index.html es de una versión anterior (caché), avisa en vez de fallar
if (!document.querySelector('#cal-grid')) {
  document.body.insertAdjacentHTML('afterbegin',
    '<p style="background:#dc2626;color:#fff;padding:12px;margin:0;text-align:center">' +
    'El index.html está desactualizado. Sustitúyelo y recarga con Ctrl+F5.</p>');
}

// ---------- Estado ----------
const state = {
  user: null,
  mes: primerDiaMes(new Date()),
  tab: 'resumen',
  filtro: 'todos',
  categorias: [],
  movimientos: [],
  fijos: [],
  cal: {
    vista: 'mes',       // 'mes' | 'anio'
    sinFijos: false,    // excluir gastos generados por fijos
    diaSel: null,       // 'YYYY-MM-DD' seleccionado en el calendario
    anio: null,         // { anio, movs } caché de la vista año
  },
};

const CATEGORIAS_INICIALES = [
  { tipo: 'gasto', icono: '🛒', nombre: 'Supermercado', color: '#16a34a' },
  { tipo: 'gasto', icono: '🍽️', nombre: 'Restaurantes', color: '#ea580c' },
  { tipo: 'gasto', icono: '🏠', nombre: 'Casa', color: '#7c3aed' },
  { tipo: 'gasto', icono: '💡', nombre: 'Suministros', color: '#ca8a04' },
  { tipo: 'gasto', icono: '🚗', nombre: 'Transporte', color: '#2563eb' },
  { tipo: 'gasto', icono: '📱', nombre: 'Suscripciones', color: '#db2777' },
  { tipo: 'gasto', icono: '🛍️', nombre: 'Compras', color: '#0891b2' },
  { tipo: 'gasto', icono: '🎉', nombre: 'Ocio', color: '#e11d48' },
  { tipo: 'gasto', icono: '⚽', nombre: 'Deporte', color: '#059669' },
  { tipo: 'gasto', icono: '💊', nombre: 'Salud', color: '#dc2626' },
  { tipo: 'gasto', icono: '✈️', nombre: 'Viajes', color: '#0284c7' },
  { tipo: 'gasto', icono: '📦', nombre: 'Otros', color: '#64748b' },
  { tipo: 'ingreso', icono: '💼', nombre: 'Nómina', color: '#15803d' },
  { tipo: 'ingreso', icono: '🎁', nombre: 'Paga Extra', color: '#16a34a' },
  { tipo: 'ingreso', icono: '↩️', nombre: 'Devoluciones', color: '#0d9488' },
  { tipo: 'ingreso', icono: '💰', nombre: 'Otros ingresos', color: '#65a30d' },
];

// ---------- Utilidades ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const eur = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const fmtMesBase = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' });
const fmtMes = { format: (d) => fmtMesBase.format(d).replace(/^./, (c) => c.toUpperCase()) };
const _fmtDia = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// "noviembre de 2026" -> "Noviembre de 2026"; "sábado, 14 de noviembre" -> "Sábado, 14 de noviembre"
const fmtDia = { format: (d) => cap(_fmtDia.format(d)) };

function primerDiaMes(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function ultimoDiaMes(d) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function pad(n) { return String(n).padStart(2, '0'); }
// Fecha local en formato YYYY-MM-DD (sin desfase de zona horaria)
function isoLocal(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function desdeIso(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function hoyIso() { return isoLocal(new Date()); }

function parseImporte(txt) {
  // Acepta "12,50", "12.50", "1.234,56" y "1234.56"
  let s = String(txt).trim().replace(/\s|€/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
function importeATexto(n) { return Number(n).toFixed(2).replace('.', ','); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), error ? 4000 : 2200);
}

function fallo(err) {
  console.error(err);
  if (!navigator.onLine || /failed to fetch|network/i.test(err?.message || '')) {
    return toast('Sin conexión: no se pueden cargar ni guardar datos', true);
  }
  toast(err?.message || 'Algo ha fallado', true);
}

const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
// [6, 12] -> "Jun y Dic"; null -> "Todos los meses"
function textoMeses(meses) {
  if (!meses?.length || meses.length === 12) return 'Todos los meses';
  const n = [...meses].sort((a, b) => a - b).map((m) => MESES_CORTOS[m - 1]);
  return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} y ${n.at(-1)}`;
}

const catPorId = (id) => state.categorias.find((c) => c.id === id);
const SIN_CAT = { nombre: 'Sin categoría', icono: '❔', color: '#94a3b8' };

// ---------- Autenticación ----------
sb.auth.onAuthStateChange((_evento, session) => {
  // No hacer llamadas a Supabase dentro del callback: se difieren.
  setTimeout(() => {
    if (session?.user && !state.user) {
      state.user = session.user;
      iniciar();
    } else if (!session) {
      state.user = null;
      $('#app').hidden = true;
      $('#vista-login').hidden = false;
    }
  }, 0);
});

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = f.querySelector('button');
  $('#login-error').textContent = '';
  btn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({
    email: f.email.value.trim(),
    password: f.password.value,
  });
  btn.disabled = false;
  if (error) $('#login-error').textContent = 'Email o contraseña incorrectos';
  else f.reset();
});

$('#btn-salir').addEventListener('click', async () => {
  if (confirm('¿Cerrar sesión?')) await sb.auth.signOut();
});

async function iniciar() {
  $('#vista-login').hidden = true;
  $('#app').hidden = false;
  try {
    await asegurarCategorias();
    await generarFijos();
    await Promise.all([cargarCategorias(), cargarFijos()]);
    await cargarMes();
    aplicarAtajo();
    render();
  } catch (err) { fallo(err); }
}

// Accesos directos del icono (mantener pulsado): ?tab=calendario o ?accion=nuevo
function aplicarAtajo() {
  const p = new URLSearchParams(location.search);
  const tab = p.get('tab');
  if (['resumen', 'calendario', 'fijos', 'categorias'].includes(tab)) state.tab = tab;
  if (p.get('accion') === 'nuevo') setTimeout(() => abrirMovimiento(), 0);
  if (tab || p.has('accion')) history.replaceState(null, '', location.pathname);
}

// ---------- PWA: service worker e instalación ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW no registrado', err));
}

let eventoInstalar = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();          // mostramos nuestro propio botón
  eventoInstalar = e;
  $('#btn-instalar').hidden = false;
});
$('#btn-instalar').addEventListener('click', async () => {
  if (!eventoInstalar) return;
  eventoInstalar.prompt();
  await eventoInstalar.userChoice;
  eventoInstalar = null;
  $('#btn-instalar').hidden = true;
});
window.addEventListener('appinstalled', () => {
  $('#btn-instalar').hidden = true;
  toast('App instalada');
});

// ---------- Datos ----------
async function asegurarCategorias() {
  const { count, error } = await sb.from('categorias').select('id', { count: 'exact', head: true });
  if (error) throw error;
  if (count === 0) {
    const { error: e2 } = await sb.from('categorias').insert(CATEGORIAS_INICIALES);
    if (e2) throw e2;
  }
}

async function generarFijos() {
  const { error } = await sb.rpc('generar_recurrentes');
  if (error) throw error;
}

async function cargarCategorias() {
  const { data, error } = await sb.from('categorias').select('*').order('nombre');
  if (error) throw error;
  state.categorias = data;
}

async function cargarFijos() {
  const { data, error } = await sb.from('recurrentes').select('*')
    .order('activo', { ascending: false }).order('dia_mes');
  if (error) throw error;
  state.fijos = data;
}

async function cargarMes() {
  const { data, error } = await sb.from('movimientos').select('*')
    .gte('fecha', isoLocal(state.mes))
    .lte('fecha', isoLocal(ultimoDiaMes(state.mes)))
    .order('fecha', { ascending: false })
    .order('id', { ascending: false });
  if (error) throw error;
  state.movimientos = data;
  state.cal.anio = null; // los datos han podido cambiar: recargar la vista año
}

// Supabase devuelve como máximo 1000 filas por consulta: pide por páginas
async function cargarAnio(anio) {
  const filas = [];
  const PAG = 1000;
  for (let desde = 0; ; desde += PAG) {
    const { data, error } = await sb.from('movimientos')
      .select('fecha,tipo,importe,recurrente_id,categoria_id')
      .gte('fecha', `${anio}-01-01`).lte('fecha', `${anio}-12-31`)
      .order('id').range(desde, desde + PAG - 1);
    if (error) throw error;
    filas.push(...data);
    if (data.length < PAG) break;
  }
  state.cal.anio = { anio, movs: filas };
}

// ---------- Render ----------
function render() {
  const vistaAnio = state.tab === 'calendario' && state.cal.vista === 'anio';
  $('#mes-titulo').textContent = vistaAnio ? String(state.mes.getFullYear()) : fmtMes.format(state.mes);
  const conSelector = state.tab === 'resumen' || state.tab === 'calendario';
  $('#selector-mes').hidden = !conSelector;
  $('#titulo-seccion').hidden = conSelector;
  $('#titulo-seccion').textContent = state.tab === 'fijos' ? 'Fijos mensuales' : 'Categorías';

  $$('.tab').forEach((t) => { t.hidden = t.id !== `tab-${state.tab}`; });
  $$('.bottom-nav__item').forEach((b) => b.classList.toggle('activo', b.dataset.tab === state.tab));

  if (state.tab === 'resumen') renderResumen();
  if (state.tab === 'calendario') renderCalendario();
  if (state.tab === 'fijos') renderFijos();
  if (state.tab === 'categorias') renderCategorias();
}

function renderResumen() {
  const movs = state.movimientos;
  const ingresos = movs.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.importe), 0);
  const gastos = movs.filter((m) => m.tipo === 'gasto').reduce((s, m) => s + Number(m.importe), 0);
  const balance = ingresos - gastos;

  $('#total-ingresos').textContent = eur.format(ingresos);
  $('#total-gastos').textContent = eur.format(gastos);
  const bal = $('#total-balance');
  bal.textContent = eur.format(balance);
  bal.className = 'tarjeta__valor ' + (balance >= 0 ? 'positivo' : 'negativo');

  // Gastos por categoría
  const porCat = new Map();
  for (const m of movs.filter((m) => m.tipo === 'gasto')) {
    porCat.set(m.categoria_id, (porCat.get(m.categoria_id) || 0) + Number(m.importe));
  }
  const filas = [...porCat.entries()].sort((a, b) => b[1] - a[1]);
  $('#por-categoria').innerHTML = filas.length
    ? filas.map(([id, total]) => {
        const c = catPorId(id) || SIN_CAT;
        const pct = gastos ? (total / gastos) * 100 : 0;
        return `<div class="barra">
          <div class="barra__cab">
            <span>${esc(c.icono)} ${esc(c.nombre)}<small>${pct.toFixed(0)} %</small></span>
            <strong>${eur.format(total)}</strong>
          </div>
          <div class="barra__pista"><div class="barra__relleno" style="width:${pct}%;background:${esc(c.color)}"></div></div>
        </div>`;
      }).join('')
    : '<p class="ayuda" style="text-align:center">Sin gastos este mes</p>';

  // Lista agrupada por día
  const visibles = state.filtro === 'todos' ? movs : movs.filter((m) => m.tipo === state.filtro);
  if (!visibles.length) {
    $('#lista-movimientos').innerHTML = '<div class="vacio">No hay movimientos. Pulsa <b>+</b> para añadir uno.</div>';
    return;
  }
  const grupos = new Map();
  for (const m of visibles) {
    if (!grupos.has(m.fecha)) grupos.set(m.fecha, []);
    grupos.get(m.fecha).push(m);
  }
  $('#lista-movimientos').innerHTML = [...grupos.entries()].map(([fecha, lista]) => `
    <h3 class="grupo-fecha">${esc(fmtDia.format(desdeIso(fecha)))}</h3>
    <ul class="lista">${lista.map(itemMovimiento).join('')}</ul>
  `).join('');
}

function itemMovimiento(m) {
  const c = catPorId(m.categoria_id) || SIN_CAT;
  const titulo = m.descripcion || c.nombre;
  const signo = m.tipo === 'gasto' ? '−' : '+';
  return `<li><button class="item" data-mov="${m.id}">
    <span class="item__icono" style="background:${esc(c.color)}22">${esc(c.icono)}</span>
    <span class="item__texto">
      <span class="item__titulo">${esc(titulo)}</span>
      <span class="item__sub">${esc(c.nombre)}${m.recurrente_id ? '<span class="badge">Fijo</span>' : ''}</span>
    </span>
    <span class="item__importe ${m.tipo === 'gasto' ? 'negativo' : 'positivo'}">${signo}${eur.format(m.importe)}</span>
  </button></li>`;
}

function renderFijos() {
  const activos = state.fijos.filter((f) => f.activo);
  const suma = (lista, tipo) => lista.filter((f) => f.tipo === tipo).reduce((s, f) => s + Number(f.importe), 0);
  // Tarjetas: solo lo que se repite todos los meses
  const mensuales = activos.filter((f) => !f.meses);
  const ing = suma(mensuales, 'ingreso');
  const gas = suma(mensuales, 'gasto');

  // Fijos de algunos meses (pagas extra, seguros anuales…): total al año
  const parciales = activos.filter((f) => f.meses);
  const anual = (tipo) => parciales.filter((f) => f.tipo === tipo)
    .reduce((s, f) => s + Number(f.importe) * f.meses.length, 0);
  const pIng = anual('ingreso');
  const pGas = anual('gasto');
  const p = $('#fijos-parciales');
  p.hidden = !parciales.length;
  p.innerHTML = `Además, en algunos meses: <b class="positivo">+${eur.format(pIng)}</b> y <b class="negativo">−${eur.format(pGas)}</b> al año.`;
  $('#fijos-ingresos').textContent = eur.format(ing);
  $('#fijos-gastos').textContent = eur.format(gas);
  const margen = $('#fijos-margen');
  margen.textContent = eur.format(ing - gas);
  margen.className = 'tarjeta__valor ' + (ing - gas >= 0 ? 'positivo' : 'negativo');

  if (!state.fijos.length) {
    $('#lista-fijos').innerHTML = '<div class="vacio">Añade tu nómina, alquiler o suscripciones con <b>+</b>.</div>';
    return;
  }
  const bloque = (tipo, titulo) => {
    const lista = state.fijos.filter((f) => f.tipo === tipo);
    if (!lista.length) return '';
    return `<h2 class="seccion-titulo">${titulo}</h2><ul class="lista">${lista.map((f) => {
      const c = catPorId(f.categoria_id) || SIN_CAT;
      const estado = !f.activo ? ' · Pausado' : (f.fecha_fin ? ` · hasta ${esc(fmtCorta(f.fecha_fin))}` : '');
      return `<li><button class="item ${f.activo ? '' : 'item--inactivo'}" data-fijo="${f.id}">
        <span class="item__icono" style="background:${esc(c.color)}22">${esc(c.icono)}</span>
        <span class="item__texto">
          <span class="item__titulo">${esc(f.nombre)}</span>
          <span class="item__sub">Día ${f.dia_mes}${f.meses ? ` · ${esc(textoMeses(f.meses))}` : ''} · ${esc(c.nombre)}${estado}</span>
        </span>
        <span class="item__importe ${tipo === 'gasto' ? 'negativo' : 'positivo'}">${eur.format(f.importe)}</span>
      </button></li>`;
    }).join('')}</ul>`;
  };
  $('#lista-fijos').innerHTML = bloque('ingreso', 'Ingresos') + bloque('gasto', 'Gastos');
}

// ---------- Calendario y análisis ----------
const DIAS_SEMANA = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MESES_LARGOS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio',
  'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const eur0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });

const diaSemana = (iso) => (desdeIso(iso).getDay() + 6) % 7; // 0 = lunes … 6 = domingo
const esFinde = (iso) => diaSemana(iso) >= 5;

// Gastos que cuentan en el calendario (respeta "Solo gastos variables")
const gastosCal = (movs) => movs.filter((m) => m.tipo === 'gasto' && !(state.cal.sinFijos && m.recurrente_id));

// Días del mes visible que ya han pasado (incluido hoy)
function diasTranscurridos(mes) {
  const hoy = new Date();
  const finMes = ultimoDiaMes(mes);
  if (finMes < new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) return finMes.getDate();
  if (mes.getFullYear() === hoy.getFullYear() && mes.getMonth() === hoy.getMonth()) return hoy.getDate();
  return 0;
}

function barra({ etiqueta, valor, pct, color, extra = '', actual = false }) {
  return `<div class="barra ${actual ? 'barra--actual' : ''}">
    <div class="barra__cab"><span>${etiqueta}${extra ? `<small>${extra}</small>` : ''}</span><strong>${eur.format(valor)}</strong></div>
    <div class="barra__pista"><div class="barra__relleno" style="width:${pct}%;background:${color}"></div></div>
  </div>`;
}

function renderCalendario() {
  $$('#cal-vista .chip').forEach((c) => c.classList.toggle('activo', c.dataset.vista === state.cal.vista));
  $('#cal-sin-fijos').checked = state.cal.sinFijos;
  $('#cal-mes').hidden = state.cal.vista !== 'mes';
  $('#cal-anio').hidden = state.cal.vista !== 'anio';
  if (state.cal.vista === 'mes') renderCalMes();
  else renderCalAnio().catch(fallo);
}

function renderCalMes() {
  const mes = state.mes;
  const nDias = ultimoDiaMes(mes).getDate();
  const transcurridos = diasTranscurridos(mes);
  const hoy = hoyIso();
  const gastos = gastosCal(state.movimientos);

  // Totales por día
  const porDia = new Map();
  for (const m of gastos) porDia.set(m.fecha, (porDia.get(m.fecha) || 0) + Number(m.importe));
  const diasConIngreso = new Set(state.movimientos.filter((m) => m.tipo === 'ingreso').map((m) => m.fecha));

  const total = [...porDia.values()].reduce((s, v) => s + v, 0);
  let totLab = 0, totFinde = 0, nLab = 0, nFinde = 0;
  for (const [f, v] of porDia) { if (esFinde(f)) totFinde += v; else totLab += v; }
  for (let d = 1; d <= transcurridos; d++) {
    if (esFinde(isoLocal(new Date(mes.getFullYear(), mes.getMonth(), d)))) nFinde++; else nLab++;
  }
  const diasConGasto = [...porDia.values()].filter((v) => v > 0).length;

  // Tarjetas
  $('#cal-total').textContent = eur.format(total);
  $('#cal-total-sub').textContent = `${diasConGasto} ${diasConGasto === 1 ? 'día' : 'días'} con gasto`;
  $('#cal-media').textContent = eur.format(transcurridos ? total / transcurridos : 0);
  $('#cal-media-sub').textContent = transcurridos
    ? `en ${transcurridos} ${transcurridos === 1 ? 'día' : 'días'}${transcurridos < nDias ? ` · previsión ${eur0.format(total / transcurridos * nDias)} €` : ''}`
    : 'mes sin empezar';
  $('#cal-laborable').textContent = eur.format(totLab);
  $('#cal-laborable-sub').textContent = `${eur.format(nLab ? totLab / nLab : 0)} por día`;
  $('#cal-finde').textContent = eur.format(totFinde);
  $('#cal-finde-sub').textContent = `${eur.format(nFinde ? totFinde / nFinde : 0)} por día`;

  // Cuadrícula (semanas de lunes a domingo)
  const max = Math.max(0, ...porDia.values());
  const huecos = diaSemana(isoLocal(mes));
  let html = '<span class="dia dia--vacio"></span>'.repeat(huecos);
  for (let d = 1; d <= nDias; d++) {
    const iso = isoLocal(new Date(mes.getFullYear(), mes.getMonth(), d));
    const v = porDia.get(iso) || 0;
    const intensidad = v && max ? Math.round(15 + 70 * (v / max)) : 0;
    const clases = ['dia',
      esFinde(iso) && 'dia--finde',
      iso === hoy && 'dia--hoy',
      iso === state.cal.diaSel && 'dia--sel',
      iso > hoy && 'dia--futuro',
      intensidad > 55 && 'dia--fuerte',
      diasConIngreso.has(iso) && 'dia--ingreso',
    ].filter(Boolean).join(' ');
    const fondo = intensidad ? `style="background:color-mix(in srgb, var(--negativo) ${intensidad}%, var(--surface))"` : '';
    html += `<button class="${clases}" data-dia="${iso}" ${fondo} aria-label="${d}: ${eur.format(v)}">
      <span class="dia__num">${d}</span><span class="dia__imp">${v ? eur0.format(v) : ''}</span>
    </button>`;
  }
  $('#cal-grid').innerHTML = html;

  renderDetalleDia();

  // Por semana (tramos lunes-domingo dentro del mes)
  const semanas = [];
  let ini = 1;
  while (ini <= nDias) {
    const dow = diaSemana(isoLocal(new Date(mes.getFullYear(), mes.getMonth(), ini)));
    const fin = Math.min(nDias, ini + (6 - dow));
    let suma = 0;
    for (let d = ini; d <= fin; d++) suma += porDia.get(isoLocal(new Date(mes.getFullYear(), mes.getMonth(), d))) || 0;
    const desde = isoLocal(new Date(mes.getFullYear(), mes.getMonth(), ini));
    const hasta = isoLocal(new Date(mes.getFullYear(), mes.getMonth(), fin));
    semanas.push({ ini, fin, suma, actual: hoy >= desde && hoy <= hasta });
    ini = fin + 1;
  }
  const maxSem = Math.max(0, ...semanas.map((s) => s.suma));
  const mesCorto = MESES_CORTOS[mes.getMonth()].toLowerCase();
  $('#cal-semanas').innerHTML = semanas.map((s, i) => barra({
    etiqueta: `Semana ${i + 1}`,
    extra: s.ini === s.fin ? `${s.ini} ${mesCorto}` : `${s.ini}–${s.fin} ${mesCorto}`,
    valor: s.suma,
    pct: maxSem ? (s.suma / maxSem) * 100 : 0,
    color: 'var(--negativo)',
    actual: s.actual,
  })).join('');

  // Por día de la semana: total y media por cada día transcurrido
  const totDow = Array(7).fill(0);
  const nDow = Array(7).fill(0);
  for (const [f, v] of porDia) totDow[diaSemana(f)] += v;
  for (let d = 1; d <= transcurridos; d++) nDow[diaSemana(isoLocal(new Date(mes.getFullYear(), mes.getMonth(), d)))]++;
  const maxDow = Math.max(0, ...totDow);
  $('#cal-dias-semana').innerHTML = DIAS_SEMANA.map((nombre, i) => barra({
    etiqueta: nombre,
    extra: nDow[i] ? `media ${eur.format(totDow[i] / nDow[i])}` : '',
    valor: totDow[i],
    pct: maxDow ? (totDow[i] / maxDow) * 100 : 0,
    color: i >= 5 ? 'var(--primary)' : 'var(--negativo)',
  })).join('');
}

function renderDetalleDia() {
  const mesIso = isoLocal(state.mes).slice(0, 7);
  // Por defecto, hoy si está en el mes visible
  if (!state.cal.diaSel || state.cal.diaSel.slice(0, 7) !== mesIso) {
    state.cal.diaSel = hoyIso().slice(0, 7) === mesIso ? hoyIso() : null;
  }
  const cont = $('#cal-dia');
  if (!state.cal.diaSel) {
    cont.innerHTML = '<p class="ayuda" style="text-align:center">Toca un día para ver sus movimientos.</p>';
    return;
  }
  const movs = state.movimientos.filter((m) => m.fecha === state.cal.diaSel);
  const gasto = gastosCal(movs).reduce((s, m) => s + Number(m.importe), 0);
  cont.innerHTML = `<div class="detalle-dia">
    <div class="detalle-dia__cab">
      <h3>${esc(fmtDia.format(desdeIso(state.cal.diaSel)))}</h3>
      <strong class="negativo">${gasto ? '−' + eur.format(gasto) : ''}</strong>
    </div>
    ${movs.length
      ? `<ul class="lista">${movs.map(itemMovimiento).join('')}</ul>`
      : '<div class="vacio">Sin movimientos este día. Pulsa <b>+</b> para añadir uno.</div>'}
  </div>`;
}

async function renderCalAnio() {
  const anio = state.mes.getFullYear();
  if (state.cal.anio?.anio !== anio) {
    $('#anio-meses').innerHTML = '<p class="ayuda" style="text-align:center">Cargando…</p>';
    await cargarAnio(anio);
    if (state.tab !== 'calendario' || state.cal.vista !== 'anio') return;
  }
  const movs = state.cal.anio.movs;
  const gastos = gastosCal(movs);
  const ingresos = movs.filter((m) => m.tipo === 'ingreso');
  const sum = (l) => l.reduce((s, m) => s + Number(m.importe), 0);

  const gMes = Array(12).fill(0);
  const iMes = Array(12).fill(0);
  for (const m of gastos) gMes[Number(m.fecha.slice(5, 7)) - 1] += Number(m.importe);
  for (const m of ingresos) iMes[Number(m.fecha.slice(5, 7)) - 1] += Number(m.importe);

  const totG = sum(gastos);
  const totI = sum(ingresos);
  const totGTodos = sum(movs.filter((m) => m.tipo === 'gasto')); // el ahorro siempre con todos los gastos
  const ahorro = totI - totGTodos;

  const hoy = new Date();
  const mesesTransc = anio < hoy.getFullYear() ? 12 : anio === hoy.getFullYear() ? hoy.getMonth() + 1 : 0;

  $('#anio-ingresos').textContent = eur.format(totI);
  $('#anio-gastos').textContent = eur.format(totG);
  const a = $('#anio-ahorro');
  a.textContent = eur.format(ahorro);
  a.className = 'tarjeta__valor ' + (ahorro >= 0 ? 'positivo' : 'negativo');
  $('#anio-ahorro-sub').textContent = totI ? `${Math.round((ahorro / totI) * 100)} % de los ingresos` : '';
  $('#anio-media').textContent = eur.format(mesesTransc ? totG / mesesTransc : 0);
  $('#anio-media-sub').textContent = mesesTransc ? `en ${mesesTransc} ${mesesTransc === 1 ? 'mes' : 'meses'}` : 'año sin empezar';

  // Mes a mes (pulsar abre el calendario de ese mes)
  const max = Math.max(0, ...gMes, ...iMes);
  $('#anio-meses').innerHTML = MESES_LARGOS.map((nombre, i) => {
    const actual = anio === hoy.getFullYear() && i === hoy.getMonth();
    const vacio = !gMes[i] && !iMes[i];
    return `<button class="barra barra--clic ${actual ? 'barra--actual' : ''}" data-ir-mes="${i}" ${vacio ? 'style="opacity:.5"' : ''}>
      <div class="barra__cab">
        <span>${nombre}</span>
        <span class="valores"><b class="positivo">+${eur0.format(iMes[i])}</b><b class="negativo">−${eur0.format(gMes[i])}</b></span>
      </div>
      <div class="barra__pista barra__pista--fina"><div class="barra__relleno" style="width:${max ? (iMes[i] / max) * 100 : 0}%;background:var(--positivo)"></div></div>
      <div class="barra__pista barra__pista--fina"><div class="barra__relleno" style="width:${max ? (gMes[i] / max) * 100 : 0}%;background:var(--negativo)"></div></div>
    </button>`;
  }).join('');

  // Categorías del año
  const porCat = new Map();
  for (const m of gastos) porCat.set(m.categoria_id, (porCat.get(m.categoria_id) || 0) + Number(m.importe));
  const filas = [...porCat.entries()].sort((x, y) => y[1] - x[1]);
  $('#anio-categorias').innerHTML = filas.length
    ? filas.map(([id, v]) => {
        const c = catPorId(id) || SIN_CAT;
        return barra({
          etiqueta: `${esc(c.icono)} ${esc(c.nombre)}`,
          extra: `${totG ? Math.round((v / totG) * 100) : 0} % · ${eur0.format(mesesTransc ? v / mesesTransc : 0)} €/mes`,
          valor: v,
          pct: totG ? (v / filas[0][1]) * 100 : 0,
          color: esc(c.color),
        });
      }).join('')
    : '<p class="ayuda" style="text-align:center">Sin gastos este año</p>';
}

$('#cal-vista').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.cal.vista = chip.dataset.vista;
  render();
});

$('#cal-sin-fijos').addEventListener('change', (e) => {
  state.cal.sinFijos = e.target.checked;
  renderCalendario();
});

function fmtCorta(iso) {
  return desdeIso(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderCategorias() {
  for (const tipo of ['gasto', 'ingreso']) {
    const lista = state.categorias.filter((c) => c.tipo === tipo);
    $(`#lista-cat-${tipo}`).innerHTML = lista.map((c) => `
      <li><button class="item" data-cat="${c.id}">
        <span class="item__icono" style="background:${esc(c.color)}22">${esc(c.icono)}</span>
        <span class="item__texto"><span class="item__titulo">${esc(c.nombre)}</span></span>
        <span style="width:14px;height:14px;border-radius:50%;background:${esc(c.color)}"></span>
      </button></li>`).join('');
  }
}

// ---------- Navegación ----------
$$('.bottom-nav__item').forEach((b) => b.addEventListener('click', () => {
  state.tab = b.dataset.tab;
  render();
  window.scrollTo(0, 0);
}));

$('#mes-anterior').addEventListener('click', () => cambiarMes(-1));
$('#mes-siguiente').addEventListener('click', () => cambiarMes(1));
async function cambiarMes(delta) {
  // En la vista año las flechas cambian de año
  if (state.tab === 'calendario' && state.cal.vista === 'anio') delta *= 12;
  state.mes = new Date(state.mes.getFullYear(), state.mes.getMonth() + delta, 1);
  state.cal.diaSel = null;
  try { await cargarMes(); render(); } catch (err) { fallo(err); }
}

$('#filtros').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  state.filtro = chip.dataset.filtro;
  $$('#filtros .chip').forEach((c) => c.classList.toggle('activo', c === chip));
  renderResumen();
});

$('#fab').addEventListener('click', () => {
  if (state.tab === 'resumen') abrirMovimiento();
  else if (state.tab === 'calendario') abrirMovimiento(null, state.cal.vista === 'mes' ? state.cal.diaSel : null);
  else if (state.tab === 'fijos') abrirFijo();
  else abrirCategoria();
});

// Clic en elementos de las listas (delegación)
document.addEventListener('click', (e) => {
  const mov = e.target.closest('[data-mov]');
  if (mov) return abrirMovimiento(state.movimientos.find((m) => m.id === Number(mov.dataset.mov)));
  const fijo = e.target.closest('[data-fijo]');
  if (fijo) return abrirFijo(state.fijos.find((f) => f.id === Number(fijo.dataset.fijo)));
  const cat = e.target.closest('[data-cat]');
  if (cat) return abrirCategoria(catPorId(Number(cat.dataset.cat)));
  const dia = e.target.closest('[data-dia]');
  if (dia) {
    state.cal.diaSel = dia.dataset.dia;
    $$('.dia--sel').forEach((d) => d.classList.remove('dia--sel'));
    dia.classList.add('dia--sel');
    return renderDetalleDia();
  }
  const irMes = e.target.closest('[data-ir-mes]');
  if (irMes) {
    state.mes = new Date(state.mes.getFullYear(), Number(irMes.dataset.irMes), 1);
    state.cal.vista = 'mes';
    state.cal.diaSel = null;
    cargarMes().then(render).catch(fallo);
  }
});

// Botones "Cancelar" y clic fuera del modal
$$('dialog').forEach((dlg) => {
  dlg.querySelectorAll('[data-cerrar]').forEach((b) => b.addEventListener('click', () => dlg.close()));
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
});

// ---------- Selects de categoría ----------
function rellenarCategorias(select, tipo, seleccionada) {
  const lista = state.categorias.filter((c) => c.tipo === tipo);
  select.innerHTML = lista.map((c) =>
    `<option value="${c.id}">${esc(c.icono)} ${esc(c.nombre)}</option>`).join('')
    + '<option value="">❔ Sin categoría</option>';
  select.value = seleccionada != null && lista.some((c) => c.id === seleccionada) ? String(seleccionada) : (lista[0]?.id ?? '');
}

function enlazarTipo(form) {
  form.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', () => {
    rellenarCategorias(form.categoria_id, form.tipo.value);
  }));
}
enlazarTipo($('#form-movimiento'));
enlazarTipo($('#form-fijo'));

// ---------- Modal movimiento ----------
let movEditando = null;

function abrirMovimiento(m = null, fechaDefecto = null) {
  movEditando = m;
  const f = $('#form-movimiento');
  f.reset();
  $('#mov-titulo').textContent = m ? 'Editar movimiento' : 'Nuevo movimiento';
  $('#mov-eliminar').hidden = !m;
  $('#mov-aviso-fijo').hidden = !m?.recurrente_id;

  const tipo = m?.tipo || 'gasto';
  f.tipo.value = tipo;
  rellenarCategorias(f.categoria_id, tipo, m?.categoria_id);
  f.importe.value = m ? importeATexto(m.importe) : '';
  f.descripcion.value = m?.descripcion || '';
  // Por defecto: hoy si estás viendo el mes actual, si no el día 1 del mes visible
  const hoy = new Date();
  const mesActual = state.mes.getFullYear() === hoy.getFullYear() && state.mes.getMonth() === hoy.getMonth();
  f.fecha.value = m?.fecha || fechaDefecto || (mesActual ? hoyIso() : isoLocal(state.mes));

  $('#dlg-movimiento').showModal();
  if (!m) setTimeout(() => f.importe.focus(), 50);
}

$('#form-movimiento').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const importe = parseImporte(f.importe.value);
  if (!(importe > 0)) return toast('Importe no válido', true);

  const datos = {
    tipo: f.tipo.value,
    importe,
    fecha: f.fecha.value,
    categoria_id: f.categoria_id.value ? Number(f.categoria_id.value) : null,
    descripcion: f.descripcion.value.trim() || null,
  };
  await guardar(f, async () => {
    const q = movEditando
      ? sb.from('movimientos').update(datos).eq('id', movEditando.id)
      : sb.from('movimientos').insert(datos);
    const { error } = await q;
    if (error) throw error;
    $('#dlg-movimiento').close();
    await cargarMes();
    render();
    toast(movEditando ? 'Movimiento actualizado' : 'Movimiento guardado');
  });
});

$('#mov-eliminar').addEventListener('click', async () => {
  if (!movEditando || !confirm('¿Eliminar este movimiento?')) return;
  try {
    const { error } = await sb.from('movimientos').delete().eq('id', movEditando.id);
    if (error) throw error;
    $('#dlg-movimiento').close();
    await cargarMes();
    render();
    toast('Movimiento eliminado');
  } catch (err) { fallo(err); }
});

// ---------- Modal fijo ----------
let fijoEditando = null;

function abrirFijo(fx = null) {
  fijoEditando = fx;
  const f = $('#form-fijo');
  f.reset();
  $('#fijo-titulo').textContent = fx ? 'Editar fijo mensual' : 'Nuevo fijo mensual';
  $('#fijo-eliminar').hidden = !fx;

  const tipo = fx?.tipo || 'gasto';
  f.tipo.value = tipo;
  rellenarCategorias(f.categoria_id, tipo, fx?.categoria_id);
  f.nombre.value = fx?.nombre || '';
  f.importe.value = fx ? importeATexto(fx.importe) : '';
  f.dia_mes.value = fx?.dia_mes || new Date().getDate();
  // Por defecto desde el día 1 de este mes: si el día ya pasó, se apunta el de este mes
  f.fecha_inicio.value = fx?.fecha_inicio || isoLocal(primerDiaMes(new Date()));
  f.fecha_fin.value = fx?.fecha_fin || '';
  f.activo.checked = fx ? fx.activo : true;
  ponerMeses(f, fx?.meses || null);
  $('#atajo-paga-extra').hidden = !!fx;

  $('#dlg-fijo').showModal();
}

// Marca "todos los meses" (null) o los meses concretos
function ponerMeses(f, meses) {
  f.frecuencia.value = meses ? 'algunos' : 'todos';
  f.querySelectorAll('input[name="meses"]').forEach((c) => { c.checked = !!meses?.includes(Number(c.value)); });
  $('#fijo-meses').hidden = !meses;
}

$('#form-fijo').querySelectorAll('input[name="frecuencia"]').forEach((r) => r.addEventListener('change', () => {
  $('#fijo-meses').hidden = $('#form-fijo').frecuencia.value !== 'algunos';
}));

// Atajo: rellena una paga extra de junio y diciembre
$('#atajo-paga-extra').addEventListener('click', () => {
  const f = $('#form-fijo');
  f.tipo.value = 'ingreso';
  const cat = state.categorias.find((c) => c.tipo === 'ingreso' && /paga extra/i.test(c.nombre))
    || state.categorias.find((c) => c.tipo === 'ingreso' && /n[oó]mina/i.test(c.nombre));
  rellenarCategorias(f.categoria_id, 'ingreso', cat?.id);
  if (!f.nombre.value.trim()) f.nombre.value = 'Paga extra';
  ponerMeses(f, [6, 12]);
  f.importe.focus();
});

$('#form-fijo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const importe = parseImporte(f.importe.value);
  const dia = Number(f.dia_mes.value);
  if (!(importe > 0)) return toast('Importe no válido', true);
  if (!(dia >= 1 && dia <= 31)) return toast('Día del mes entre 1 y 31', true);
  if (f.fecha_fin.value && f.fecha_fin.value < f.fecha_inicio.value) return toast('"Hasta" es anterior a "Desde"', true);

  let meses = null;
  if (f.frecuencia.value === 'algunos') {
    meses = [...f.querySelectorAll('input[name="meses"]:checked')].map((c) => Number(c.value));
    if (!meses.length) return toast('Elige al menos un mes', true);
    if (meses.length === 12) meses = null; // los 12 = todos los meses
  }

  const datos = {
    tipo: f.tipo.value,
    nombre: f.nombre.value.trim(),
    importe,
    dia_mes: dia,
    categoria_id: f.categoria_id.value ? Number(f.categoria_id.value) : null,
    fecha_inicio: f.fecha_inicio.value,
    fecha_fin: f.fecha_fin.value || null,
    activo: f.activo.checked,
    meses,
  };
  await guardar(f, async () => {
    const q = fijoEditando
      ? sb.from('recurrentes').update(datos).eq('id', fijoEditando.id)
      : sb.from('recurrentes').insert(datos);
    const { error } = await q;
    if (error) throw error;
    $('#dlg-fijo').close();
    await generarFijos();
    await Promise.all([cargarFijos(), cargarMes()]);
    render();
    toast(fijoEditando ? 'Fijo actualizado' : 'Fijo creado');
  });
});

$('#fijo-eliminar').addEventListener('click', async () => {
  if (!fijoEditando) return;
  if (!confirm(`¿Eliminar "${fijoEditando.nombre}"?\nLos movimientos ya apuntados se conservan.`)) return;
  try {
    const { error } = await sb.from('recurrentes').delete().eq('id', fijoEditando.id);
    if (error) throw error;
    $('#dlg-fijo').close();
    await Promise.all([cargarFijos(), cargarMes()]);
    render();
    toast('Fijo eliminado');
  } catch (err) { fallo(err); }
});

// ---------- Modal categoría ----------
let catEditando = null;

function abrirCategoria(c = null) {
  catEditando = c;
  const f = $('#form-categoria');
  f.reset();
  $('#cat-titulo').textContent = c ? 'Editar categoría' : 'Nueva categoría';
  $('#cat-eliminar').hidden = !c;
  $('#cat-aviso').hidden = !c;
  f.tipo.value = c?.tipo || 'gasto';
  f.icono.value = c?.icono || '📦';
  f.nombre.value = c?.nombre || '';
  f.color.value = c?.color || '#64748b';
  $('#dlg-categoria').showModal();
}

$('#form-categoria').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const datos = {
    tipo: f.tipo.value,
    icono: f.icono.value.trim() || '📦',
    nombre: f.nombre.value.trim(),
    color: f.color.value,
  };
  await guardar(f, async () => {
    const q = catEditando
      ? sb.from('categorias').update(datos).eq('id', catEditando.id)
      : sb.from('categorias').insert(datos);
    const { error } = await q;
    if (error) {
      if (error.code === '23505') throw new Error('Ya existe una categoría con ese nombre');
      throw error;
    }
    $('#dlg-categoria').close();
    await cargarCategorias();
    render();
    toast('Categoría guardada');
  });
});

$('#cat-eliminar').addEventListener('click', async () => {
  if (!catEditando || !confirm(`¿Eliminar la categoría "${catEditando.nombre}"?`)) return;
  try {
    const { error } = await sb.from('categorias').delete().eq('id', catEditando.id);
    if (error) throw error;
    $('#dlg-categoria').close();
    await Promise.all([cargarCategorias(), cargarFijos(), cargarMes()]);
    render();
    toast('Categoría eliminada');
  } catch (err) { fallo(err); }
});

// Desactiva el botón Guardar mientras se guarda y muestra errores
async function guardar(form, fn) {
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  try { await fn(); } catch (err) { fallo(err); } finally { btn.disabled = false; }
}

// Al volver a la app (p. ej. desde segundo plano) apunta los fijos que toquen
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !state.user) return;
  try {
    await generarFijos();
    await cargarMes();
    render();
  } catch { /* silencioso */ }
});
