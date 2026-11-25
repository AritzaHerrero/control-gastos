// =========================================================
// Objetivos
//  - limite : no gastar más de X por semana/mes/trimestre/año/fechas
//             (total o de una categoría; opcionalmente sin fijos)
//  - ahorro : ahorrar al menos X por periodo (ingresos − gastos)
//  - hucha  : reunir X con aportaciones (fecha objetivo opcional)
//
// Los fijos pendientes del periodo (nómina, alquiler…) se tienen en
// cuenta para decirte cuánto puedes gastar todavía.
// =========================================================
import {
  $, eur, eur0, esc, toast, fallo, isoLocal, desdeIso, hoyIso, ultimoDiaMes, primerDiaMes,
  parseImporte, importeATexto, cargarRango, addDias, diasEntre, diaSemana, MESES_LARGOS,
} from './util.js';

let ctx;              // { sb, state, catPorId, SIN_CAT, guardar, irA }
let objetivos = [];
let aportaciones = [];
let cache = null;     // { clave, movs }
let editando = null;
let aportando = null; // { objetivo, signo }

const PERIODOS = { semana: 'Semanal', mes: 'Mensual', trimestre: 'Trimestral', anio: 'Anual', rango: 'Fechas concretas' };
const ICONO_TIPO = { limite: '🚦', ahorro: '💰', hucha: '🐷' };

export function initObjetivos(c) {
  ctx = c;
  const f = $('#form-objetivo');
  f.querySelectorAll('input[name="tipo"]').forEach((r) => r.addEventListener('change', () => ajustarFormulario(true)));
  f.periodo.addEventListener('change', () => ajustarFormulario(false));
  f.addEventListener('submit', guardarObjetivo);
  $('#obj-eliminar').addEventListener('click', eliminarObjetivo);
  $('#form-aportacion').addEventListener('submit', guardarAportacion);

  document.addEventListener('click', (e) => {
    const card = e.target.closest('[data-obj]');
    const ap = e.target.closest('[data-aportar]');
    const borrarAp = e.target.closest('[data-borrar-ap]');
    if (ap) {
      e.stopPropagation();
      return abrirAportacion(objetivos.find((o) => o.id === Number(ap.dataset.aportar)), Number(ap.dataset.signo));
    }
    if (borrarAp) {
      e.stopPropagation();
      return borrarAportacion(Number(borrarAp.dataset.borrarAp));
    }
    if (card) return abrirObjetivo(objetivos.find((o) => o.id === Number(card.dataset.obj)));
    if (e.target.closest('[data-ir-objetivos]')) ctx.irA('objetivos');
  });
}

export function invalidarObjetivos() { cache = null; }

export async function cargarObjetivos() {
  const [o, a] = await Promise.all([
    ctx.sb.from('objetivos').select('*').order('created_at'),
    ctx.sb.from('aportaciones').select('*').order('fecha', { ascending: false }).order('id', { ascending: false }),
  ]);
  if (o.error) throw o.error;
  if (a.error) throw a.error;
  objetivos = o.data;
  aportaciones = a.data;
  cache = null;
}

// Límite mensual sobre el total de gastos (para la línea del gráfico)
export function limiteMensualTotal() {
  const o = objetivos.find((x) => x.activo && x.tipo === 'limite' && x.periodo === 'mes' && !x.categoria_id);
  return o ? Number(o.importe) : null;
}

// ---------- Periodos ----------
function periodoActual(o, hoy) {
  const y = hoy.getFullYear(), m = hoy.getMonth();
  switch (o.periodo) {
    case 'semana': { const ini = addDias(hoy, -diaSemana(isoLocal(hoy))); return { ini, fin: addDias(ini, 6) }; }
    case 'mes': return { ini: new Date(y, m, 1), fin: ultimoDiaMes(hoy) };
    case 'trimestre': { const q = Math.floor(m / 3) * 3; return { ini: new Date(y, q, 1), fin: new Date(y, q + 3, 0) }; }
    case 'anio': return { ini: new Date(y, 0, 1), fin: new Date(y, 11, 31) };
    case 'rango': return { ini: desdeIso(o.fecha_inicio), fin: desdeIso(o.fecha_fin) };
    default: return null;
  }
}

function textoPeriodo(o, p) {
  const f = (d) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  switch (o.periodo) {
    case 'semana': return `Semana del ${f(p.ini)} al ${f(p.fin)}`;
    case 'mes': return MESES_LARGOS[p.ini.getMonth()];
    case 'trimestre': return `${Math.floor(p.ini.getMonth() / 3) + 1}.º trimestre`;
    case 'anio': return String(p.ini.getFullYear());
    default: return `Del ${f(p.ini)} al ${f(p.fin)}`;
  }
}

// Importes de fijos que aún no se han apuntado (fecha > hoy) dentro del periodo
function fijosPendientes(ini, fin, hoy, filtro) {
  let total = 0;
  const desde = addDias(hoy, 1) > ini ? addDias(hoy, 1) : ini;
  if (desde > fin) return 0;
  for (const fx of ctx.state.fijos) {
    if (!fx.activo || !filtro(fx)) continue;
    for (let mes = primerDiaMes(desde); mes <= fin; mes = new Date(mes.getFullYear(), mes.getMonth() + 1, 1)) {
      const dia = Math.min(fx.dia_mes, ultimoDiaMes(mes).getDate());
      const f = new Date(mes.getFullYear(), mes.getMonth(), dia);
      const iso = isoLocal(f);
      if (f < desde || f > fin) continue;
      if (iso < fx.fecha_inicio || (fx.fecha_fin && iso > fx.fecha_fin)) continue;
      if (fx.meses && !fx.meses.includes(f.getMonth() + 1)) continue;
      total += Number(fx.importe);
    }
  }
  return total;
}

async function movimientosNecesarios(hoy) {
  const periodos = objetivos.filter((o) => o.activo && o.tipo !== 'hucha').map((o) => periodoActual(o, hoy));
  if (!periodos.length) return [];
  const ini = isoLocal(new Date(Math.min(...periodos.map((p) => p.ini))));
  const fin = isoLocal(new Date(Math.max(...periodos.map((p) => p.fin))));
  const clave = ini + fin;
  if (cache?.clave !== clave) cache = { clave, movs: await cargarRango(ctx.sb, ini, fin) };
  return cache.movs;
}

// ---------- Cálculo del progreso ----------
function calcular(o, movs, hoy) {
  if (o.tipo === 'hucha') {
    const aps = aportaciones.filter((a) => a.objetivo_id === o.id);
    const aportado = aps.reduce((s, a) => s + Number(a.importe), 0);
    const falta = Math.max(0, o.importe - aportado);
    let detalle = '';
    let estado = aportado >= o.importe ? 'ok' : 'neutro';
    if (aportado >= o.importe) detalle = '🎉 ¡Conseguido!';
    else if (o.fecha_fin) {
      const fin = desdeIso(o.fecha_fin);
      const meses = (fin.getFullYear() - hoy.getFullYear()) * 12 + fin.getMonth() - hoy.getMonth() + (fin.getDate() >= hoy.getDate() ? 1 : 0);
      if (fin < hoy) { detalle = `La fecha (${fin.toLocaleDateString('es-ES')}) ya pasó. Faltan ${eur.format(falta)}.`; estado = 'mal'; }
      else detalle = `Faltan <b>${eur.format(falta)}</b>: ${eur.format(falta / Math.max(1, meses))} al mes hasta el ${fin.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
    } else detalle = `Faltan <b>${eur.format(falta)}</b>.`;
    return { valor: aportado, pct: aportado / o.importe, estado, detalle, aps };
  }

  const p = periodoActual(o, hoy);
  const ini = isoLocal(p.ini), fin = isoLocal(p.fin), hoyS = isoLocal(hoy);
  const enPeriodo = movs.filter((m) => m.fecha >= ini && m.fecha <= fin);
  const diasTot = diasEntre(p.ini, p.fin) + 1;
  const empezado = hoyS >= ini;
  const terminado = hoyS > fin;
  const diasPas = !empezado ? 0 : terminado ? diasTot : diasEntre(p.ini, hoy) + 1;
  const diasRest = diasTot - diasPas;
  const periodoTxt = textoPeriodo(o, p);
  const avance = diasPas / diasTot;

  if (!empezado) {
    return { valor: 0, pct: 0, estado: 'neutro', periodoTxt, avance: 0, detalle: `Empieza el ${p.ini.toLocaleDateString('es-ES')}.` };
  }

  if (o.tipo === 'limite') {
    const cuenta = (m) => m.tipo === 'gasto' && (!o.categoria_id || m.categoria_id === o.categoria_id) && !(o.solo_variables && m.recurrente_id);
    const gastos = enPeriodo.filter(cuenta);
    const gastado = gastos.reduce((s, m) => s + Number(m.importe), 0);
    const gastadoFijos = gastos.filter((m) => m.recurrente_id).reduce((s, m) => s + Number(m.importe), 0);
    const pend = o.solo_variables ? 0 : fijosPendientes(p.ini, p.fin, hoy,
      (fx) => fx.tipo === 'gasto' && (!o.categoria_id || fx.categoria_id === o.categoria_id));
    const disponible = o.importe - gastado - pend;
    const prevision = gastadoFijos + pend + ((gastado - gastadoFijos) / Math.max(1, diasPas)) * diasTot;
    const estado = gastado > o.importe ? 'mal' : (prevision > o.importe || gastado >= o.importe * 0.8) ? 'aviso' : 'ok';
    let detalle;
    if (terminado) detalle = gastado <= o.importe ? `✅ Cumplido: gastaste ${eur.format(gastado)}.` : `❌ Te pasaste ${eur.format(gastado - o.importe)}.`;
    else if (disponible < 0) detalle = `Te has pasado <b class="negativo">${eur.format(-disponible)}</b>${pend ? ` (contando ${eur.format(pend)} de fijos pendientes)` : ''}.`;
    else {
      detalle = `Te quedan <b>${eur.format(disponible)}</b>`
        + (diasRest > 0 ? ` · <b>${eur.format(disponible / (diasRest + 1))}</b>/día` : '')
        + (pend ? ` <small>(ya descontados ${eur.format(pend)} de fijos pendientes)</small>` : '')
        + `<br><small>A este ritmo acabarás en ${eur0.format(prevision)} €</small>`;
    }
    return { valor: gastado, pct: gastado / o.importe, estado, detalle, periodoTxt, avance };
  }

  // ahorro
  const ing = enPeriodo.filter((m) => m.tipo === 'ingreso').reduce((s, m) => s + Number(m.importe), 0);
  const gas = enPeriodo.filter((m) => m.tipo === 'gasto').reduce((s, m) => s + Number(m.importe), 0);
  const ahorro = ing - gas;
  const pendIng = fijosPendientes(p.ini, p.fin, hoy, (fx) => fx.tipo === 'ingreso');
  const pendGas = fijosPendientes(p.ini, p.fin, hoy, (fx) => fx.tipo === 'gasto');
  const margen = ahorro + pendIng - pendGas - o.importe;
  const estado = terminado ? (ahorro >= o.importe ? 'ok' : 'mal') : margen < 0 ? 'mal' : margen < o.importe * 0.2 ? 'aviso' : 'ok';
  let detalle;
  if (terminado) detalle = ahorro >= o.importe ? `✅ Cumplido: ahorraste ${eur.format(ahorro)}.` : `❌ Ahorraste ${eur.format(ahorro)}, te faltaron ${eur.format(o.importe - ahorro)}.`;
  else if (margen >= 0) {
    detalle = `Puedes gastar hasta <b>${eur.format(margen)}</b> más en variables`
      + (diasRest > 0 ? ` (<b>${eur.format(margen / (diasRest + 1))}</b>/día)` : '') + ' y lo cumples.'
      + (pendIng || pendGas ? `<br><small>Contando fijos pendientes: +${eur0.format(pendIng)} € / −${eur0.format(pendGas)} €</small>` : '');
  } else {
    detalle = `Aunque no gastes nada más, te faltarán <b class="negativo">${eur.format(-margen)}</b>.`;
  }
  return { valor: Math.max(0, ahorro), pct: Math.max(0, ahorro) / o.importe, estado, detalle, periodoTxt, avance, ahorro };
}

// ---------- Render ----------
function tarjeta(o, r) {
  const cat = o.categoria_id ? ctx.catPorId(o.categoria_id) : null;
  const sub = o.tipo === 'hucha'
    ? (o.fecha_fin ? `Hucha · hasta ${desdeIso(o.fecha_fin).toLocaleDateString('es-ES')}` : 'Hucha')
    : `${PERIODOS[o.periodo]}${o.tipo === 'limite' ? ` · ${cat ? `${esc(cat.icono)} ${esc(cat.nombre)}` : 'Todos los gastos'}${o.solo_variables ? ' · sin fijos' : ''}` : ''}`;
  const pct = Math.min(100, Math.max(0, r.pct * 100));
  const verbo = o.tipo === 'limite' ? 'gastado' : o.tipo === 'ahorro' ? 'ahorrado' : 'reunido';
  const valorTxt = o.tipo === 'ahorro' && r.ahorro < 0 ? `${eur.format(r.ahorro)}` : eur.format(r.valor);
  const ultimas = (r.aps || []).slice(0, 3);
  return `<article class="objetivo objetivo--${r.estado} ${o.activo ? '' : 'objetivo--pausado'}" data-obj="${o.id}">
    <header class="objetivo__cab">
      <span class="objetivo__icono">${esc(o.icono)}</span>
      <div class="objetivo__texto">
        <h3>${esc(o.nombre)}</h3>
        <small>${sub}${r.periodoTxt ? ` · ${esc(r.periodoTxt)}` : ''}${o.activo ? '' : ' · Pausado'}</small>
      </div>
      <span class="objetivo__estado" aria-label="estado">${{ ok: '✓', aviso: '!', mal: '✕', neutro: '' }[r.estado]}</span>
    </header>
    <div class="objetivo__cifras"><b class="${r.ahorro < 0 ? 'negativo' : ''}">${valorTxt}</b> <span>${r.ahorro < 0 ? `balance por ahora · meta ${eur.format(o.importe)}` : `${verbo} de ${eur.format(o.importe)}`}</span><span class="objetivo__pct">${Math.round(r.pct * 100)} %</span></div>
    <div class="progreso">
      <div class="progreso__relleno" style="width:${pct}%"></div>
      ${r.avance != null && r.avance < 1 && o.tipo === 'limite' ? `<i class="progreso__ritmo" style="left:${r.avance * 100}%" title="Dónde deberías ir"></i>` : ''}
    </div>
    <p class="objetivo__detalle">${r.detalle}</p>
    ${o.tipo === 'hucha' ? `<div class="objetivo__acciones">
      <button class="btn btn--peque" data-aportar="${o.id}" data-signo="1">+ Aportar</button>
      <button class="btn btn--peque" data-aportar="${o.id}" data-signo="-1">− Retirar</button>
    </div>
    ${ultimas.length ? `<ul class="aportaciones">${ultimas.map((a) => `<li>
      <span>${desdeIso(a.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}${a.nota ? ` · ${esc(a.nota)}` : ''}</span>
      <b class="${a.importe >= 0 ? 'positivo' : 'negativo'}">${a.importe >= 0 ? '+' : ''}${eur.format(a.importe)}</b>
      <button class="icon-btn icon-btn--peque" data-borrar-ap="${a.id}" aria-label="Borrar aportación">×</button>
    </li>`).join('')}</ul>` : ''}` : ''}
  </article>`;
}

export async function renderObjetivos() {
  const cont = $('#lista-objetivos');
  if (!objetivos.length) {
    cont.innerHTML = `<div class="vacio">
      <p>Aún no tienes objetivos. Pulsa <b>+</b> para crear uno:</p>
      <p>🚦 <b>Límite de gasto</b>: "No más de 250 € al mes en restaurantes".<br>
      💰 <b>Ahorro</b>: "Ahorrar 400 € cada mes".<br>
      🐷 <b>Hucha</b>: "Viaje a Roma: 1.200 € para junio".</p></div>`;
    return;
  }
  const hoy = desdeIso(hoyIso());
  let movs;
  try { movs = await movimientosNecesarios(hoy); } catch (err) { fallo(err); movs = []; }
  const bloque = (tipo, titulo) => {
    const lista = objetivos.filter((o) => o.tipo === tipo).sort((a, b) => b.activo - a.activo);
    if (!lista.length) return '';
    return `<h2 class="seccion-titulo">${ICONO_TIPO[tipo]} ${titulo}</h2>${lista.map((o) => tarjeta(o, calcular(o, movs, hoy))).join('')}`;
  };
  cont.innerHTML = bloque('limite', 'Límites de gasto') + bloque('ahorro', 'Ahorro') + bloque('hucha', 'Huchas');
}

// Resumen compacto en la pestaña Mes (solo mes actual)
export async function renderMiniObjetivos(visible) {
  const cont = $('#resumen-objetivos');
  const activos = objetivos.filter((o) => o.activo && o.tipo !== 'hucha');
  if (!visible || !activos.length) { cont.hidden = true; return; }
  const hoy = desdeIso(hoyIso());
  let movs;
  try { movs = await movimientosNecesarios(hoy); } catch { cont.hidden = true; return; }
  cont.hidden = false;
  cont.innerHTML = `<div class="cabecera-lista"><h2 class="seccion-titulo">Objetivos</h2>
    <button class="enlace" data-ir-objetivos>Ver todos</button></div>
    <div class="barras">${activos.slice(0, 4).map((o) => {
      const r = calcular(o, movs, hoy);
      const pct = Math.min(100, Math.max(0, r.pct * 100));
      return `<div class="barra mini-obj mini-obj--${r.estado}" data-obj="${o.id}">
        <div class="barra__cab"><span>${esc(o.icono)} ${esc(o.nombre)}<small>${Math.round(r.pct * 100)} %</small></span>
        <strong>${eur0.format(r.valor)} / ${eur0.format(o.importe)} €</strong></div>
        <div class="barra__pista"><div class="barra__relleno" style="width:${pct}%"></div></div>
      </div>`;
    }).join('')}</div>`;
}

// ---------- Formulario de objetivo ----------
function ajustarFormulario(cambioTipo) {
  const f = $('#form-objetivo');
  const tipo = f.tipo.value;
  const hucha = tipo === 'hucha';
  $('#obj-periodo').hidden = hucha;
  $('#obj-categoria').hidden = tipo !== 'limite';
  $('#obj-sin-fijos').hidden = tipo !== 'limite';
  const rango = !hucha && f.periodo.value === 'rango';
  $('#obj-fechas').hidden = !hucha && !rango;
  $('#obj-inicio').hidden = hucha;
  f.fecha_inicio.required = rango;
  f.fecha_fin.required = rango;
  $('#obj-fin-label').firstChild.textContent = hucha ? 'Fecha objetivo (opcional)' : 'Hasta';
  $('#obj-importe-label').firstChild.textContent = { limite: 'Máximo a gastar (€)', ahorro: 'Ahorrar al menos (€)', hucha: 'Cantidad a reunir (€)' }[tipo];
  f.nombre.placeholder = { limite: 'Restaurantes, gasto total…', ahorro: 'Ahorro mensual', hucha: 'Viaje, coche, emergencias…' }[tipo];
  if (cambioTipo && !editando) f.icono.value = { limite: '🚦', ahorro: '💰', hucha: '🐷' }[tipo];
}

export function abrirObjetivo(o = null) {
  editando = o;
  const f = $('#form-objetivo');
  f.reset();
  $('#obj-titulo').textContent = o ? 'Editar objetivo' : 'Nuevo objetivo';
  $('#obj-eliminar').hidden = !o;
  $('#obj-activo').hidden = !o;
  f.tipo.value = o?.tipo || 'limite';
  f.nombre.value = o?.nombre || '';
  f.icono.value = o?.icono || ICONO_TIPO[f.tipo.value];
  f.importe.value = o ? importeATexto(o.importe) : '';
  f.periodo.value = o?.periodo || 'mes';
  f.fecha_inicio.value = o?.fecha_inicio || '';
  f.fecha_fin.value = o?.fecha_fin || '';
  f.solo_variables.checked = !!o?.solo_variables;
  f.activo.checked = o ? o.activo : true;
  const cats = ctx.state.categorias.filter((c) => c.tipo === 'gasto');
  f.categoria_id.innerHTML = '<option value="">Todos los gastos</option>'
    + cats.map((c) => `<option value="${c.id}">${esc(c.icono)} ${esc(c.nombre)}</option>`).join('');
  f.categoria_id.value = o?.categoria_id ? String(o.categoria_id) : '';
  ajustarFormulario(false);
  $('#dlg-objetivo').showModal();
}

async function guardarObjetivo(e) {
  e.preventDefault();
  const f = e.target;
  const tipo = f.tipo.value;
  const importe = parseImporte(f.importe.value);
  if (!(importe > 0)) return toast('Importe no válido', true);
  const periodo = tipo === 'hucha' ? null : f.periodo.value;
  const fi = periodo === 'rango' ? f.fecha_inicio.value : null;
  const ff = (periodo === 'rango' || tipo === 'hucha') ? (f.fecha_fin.value || null) : null;
  if (periodo === 'rango' && (!fi || !ff)) return toast('Indica las dos fechas', true);
  if (fi && ff && ff < fi) return toast('"Hasta" es anterior a "Desde"', true);
  const datos = {
    tipo,
    nombre: f.nombre.value.trim(),
    icono: f.icono.value.trim() || ICONO_TIPO[tipo],
    importe,
    periodo,
    fecha_inicio: fi,
    fecha_fin: ff,
    categoria_id: tipo === 'limite' && f.categoria_id.value ? Number(f.categoria_id.value) : null,
    solo_variables: tipo === 'limite' && f.solo_variables.checked,
    activo: f.activo.checked,
  };
  await ctx.guardar(f, async () => {
    const q = editando
      ? ctx.sb.from('objetivos').update(datos).eq('id', editando.id)
      : ctx.sb.from('objetivos').insert(datos);
    const { error } = await q;
    if (error) throw error;
    $('#dlg-objetivo').close();
    await cargarObjetivos();
    ctx.alCambiar();
    toast(editando ? 'Objetivo actualizado' : 'Objetivo creado');
  });
}

async function eliminarObjetivo() {
  if (!editando || !confirm(`¿Eliminar el objetivo "${editando.nombre}"?`)) return;
  try {
    const { error } = await ctx.sb.from('objetivos').delete().eq('id', editando.id);
    if (error) throw error;
    $('#dlg-objetivo').close();
    await cargarObjetivos();
    ctx.alCambiar();
    toast('Objetivo eliminado');
  } catch (err) { fallo(err); }
}

// ---------- Aportaciones a huchas ----------
function abrirAportacion(o, signo) {
  if (!o) return;
  aportando = { objetivo: o, signo };
  const f = $('#form-aportacion');
  f.reset();
  $('#ap-titulo').textContent = `${signo > 0 ? 'Aportar a' : 'Retirar de'} ${o.nombre}`;
  f.fecha.value = hoyIso();
  $('#dlg-aportacion').showModal();
  setTimeout(() => f.importe.focus(), 50);
}

async function guardarAportacion(e) {
  e.preventDefault();
  const f = e.target;
  const importe = parseImporte(f.importe.value);
  if (!(importe > 0)) return toast('Importe no válido', true);
  await ctx.guardar(f, async () => {
    const { error } = await ctx.sb.from('aportaciones').insert({
      objetivo_id: aportando.objetivo.id,
      importe: importe * aportando.signo,
      fecha: f.fecha.value,
      nota: f.nota.value.trim() || null,
    });
    if (error) throw error;
    $('#dlg-aportacion').close();
    await cargarObjetivos();
    ctx.alCambiar();
    toast(aportando.signo > 0 ? 'Aportación guardada' : 'Retirada guardada');
  });
}

async function borrarAportacion(id) {
  if (!confirm('¿Borrar este movimiento de la hucha?')) return;
  try {
    const { error } = await ctx.sb.from('aportaciones').delete().eq('id', id);
    if (error) throw error;
    await cargarObjetivos();
    ctx.alCambiar();
  } catch (err) { fallo(err); }
}
