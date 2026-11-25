// =========================================================
// Gráficos (SVG propio, sin librerías)
//  - Gasto acumulado del mes vs mes anterior (+ límite si existe)
//  - Gastos por categoría (donut)
//  - Ingresos y gastos de los últimos 12 meses
//  - Ahorro mensual
//  - Evolución de una categoría
// Al tocar/pasar por encima se muestra el valor (tooltip).
// =========================================================
import {
  $, eur, eur0, esc, isoLocal, desdeIso, ultimoDiaMes, hoyIso, MESES_CORTOS, MESES_LARGOS,
  cargarRango, sumar,
} from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const compacto = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });
const ejeEur = (v) => `${compacto.format(v)} €`;

let ctx;            // { sb, state, catPorId, SIN_CAT, limiteMensualTotal }
let cache = null;   // { clave, movs }
let soloVariables = false;
let catEvolucion = null;

export function initGraficos(c) {
  ctx = c;
  $('#gr-sin-fijos').addEventListener('change', (e) => { soloVariables = e.target.checked; renderGraficos(); });
  $('#gr-categoria').addEventListener('change', (e) => { catEvolucion = Number(e.target.value) || null; renderGraficos(); });
}

export function invalidarGraficos() { cache = null; }

let anchoPrevio = 0;
let temporizador;
window.addEventListener('resize', () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    if (ctx?.state.tab === 'graficos' && Math.abs(window.innerWidth - anchoPrevio) > 20) renderGraficos().catch(() => {});
  }, 200);
});

// Últimos 12 meses terminando en el mes visible
async function datos() {
  const mes = ctx.state.mes;
  const ini = new Date(mes.getFullYear(), mes.getMonth() - 11, 1);
  const fin = ultimoDiaMes(mes);
  const clave = isoLocal(ini) + isoLocal(fin);
  if (cache?.clave !== clave) {
    cache = { clave, ini, movs: await cargarRango(ctx.sb, isoLocal(ini), isoLocal(fin)) };
  }
  return cache;
}

const esGasto = (m) => m.tipo === 'gasto' && !(soloVariables && m.recurrente_id);

export async function renderGraficos() {
  const cont = $('#tab-graficos');
  anchoPrevio = window.innerWidth;
  cont.classList.add('cargando');
  let d;
  try { d = await datos(); } finally { cont.classList.remove('cargando'); }
  if (ctx.state.tab !== 'graficos') return;

  const mes = ctx.state.mes;
  const meses = Array.from({ length: 12 }, (_, i) => new Date(d.ini.getFullYear(), d.ini.getMonth() + i, 1));
  const claveMes = (f) => f.slice(0, 7);
  // Con poco ancho, inicial del mes (el nombre completo sale en el tooltip)
  const anchoMes = (anchoDe($('#gr-12meses')) - 60) / 12;
  const etiquetaMes = (m) => (anchoMes >= 32 ? MESES_CORTOS[m.getMonth()] : MESES_CORTOS[m.getMonth()][0]);

  // ---- 1. Gasto acumulado: este mes vs anterior ----
  const prev = new Date(mes.getFullYear(), mes.getMonth() - 1, 1);
  const nDias = Math.max(ultimoDiaMes(mes).getDate(), ultimoDiaMes(prev).getDate());
  const hoy = hoyIso();
  const acumulado = (m, cortarEnHoy) => {
    const pref = isoLocal(m).slice(0, 7);
    const ult = ultimoDiaMes(m).getDate();
    const porDia = Array(nDias).fill(0);
    for (const x of d.movs) if (esGasto(x) && x.fecha.startsWith(pref)) porDia[Number(x.fecha.slice(8)) - 1] += Number(x.importe);
    let s = 0;
    return porDia.map((v, i) => {
      const iso = `${pref}-${String(i + 1).padStart(2, '0')}`;
      if (i >= ult || (cortarEnHoy && iso > hoy)) return null;
      s += v;
      return Math.round(s * 100) / 100;
    });
  };
  const serieActual = acumulado(mes, true);
  const seriePrev = acumulado(prev, false);
  const limite = soloVariables ? null : ctx.limiteMensualTotal?.();
  grafLineas($('#gr-acumulado'), {
    etiquetas: Array.from({ length: nDias }, (_, i) => String(i + 1)),
    prefijoTooltip: 'Día ',
    series: [
      { nombre: MESES_LARGOS[mes.getMonth()], color: 'var(--serie-gasto)', valores: serieActual },
      { nombre: MESES_LARGOS[prev.getMonth()], color: 'var(--serie-neutra)', valores: seriePrev, discontinua: true },
    ],
    referencia: limite ? { valor: limite, etiqueta: `Límite ${eur0.format(limite)} €` } : null,
  });
  const actual = serieActual.filter((v) => v != null).at(-1) ?? 0;
  const diaHoy = serieActual.filter((v) => v != null).length;
  const prevMismoDia = diaHoy ? seriePrev[Math.min(diaHoy, seriePrev.length) - 1] ?? 0 : 0;
  const dif = actual - prevMismoDia;
  $('#gr-acumulado-resumen').innerHTML = diaHoy
    ? `Llevas <b>${eur.format(actual)}</b>, ${dif === 0 ? 'igual que' : `<b class="${dif > 0 ? 'negativo' : 'positivo'}">${eur.format(Math.abs(dif))} ${dif > 0 ? 'más' : 'menos'}</b> que`} el mes anterior a estas alturas.`
    : 'Este mes aún no ha empezado.';

  // ---- 2. Gastos por categoría del mes (donut) ----
  const prefMes = isoLocal(mes).slice(0, 7);
  const porCat = new Map();
  for (const x of d.movs) if (esGasto(x) && x.fecha.startsWith(prefMes)) porCat.set(x.categoria_id, (porCat.get(x.categoria_id) || 0) + Number(x.importe));
  let items = [...porCat.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => {
    const c = ctx.catPorId(id) || ctx.SIN_CAT;
    return { nombre: `${c.icono} ${c.nombre}`, color: c.color, valor: v };
  });
  if (items.length > 7) {
    const resto = items.slice(6).reduce((s, x) => s + x.valor, 0);
    items = [...items.slice(0, 6), { nombre: '📦 Resto', color: 'var(--serie-neutra)', valor: resto }];
  }
  grafDonut($('#gr-categorias'), items);

  // ---- 3. Ingresos y gastos 12 meses ----
  const ing = Array(12).fill(0);
  const gas = Array(12).fill(0);
  const idx = (f) => meses.findIndex((m) => isoLocal(m).slice(0, 7) === claveMes(f));
  for (const x of d.movs) {
    const i = idx(x.fecha);
    if (i < 0) continue;
    if (x.tipo === 'ingreso') ing[i] += Number(x.importe);
    else if (esGasto(x)) gas[i] += Number(x.importe);
  }
  const etiquetas = meses.map(etiquetaMes);
  grafBarras($('#gr-12meses'), {
    etiquetas,
    titulosTooltip: meses.map((m) => `${MESES_LARGOS[m.getMonth()]} ${m.getFullYear()}`),
    series: [
      { nombre: 'Ingresos', color: 'var(--serie-ingreso)', valores: ing },
      { nombre: 'Gastos', color: 'var(--serie-gasto)', valores: gas },
    ],
  });

  // ---- 4. Ahorro mensual (todos los gastos, también con "solo variables") ----
  const gasTodos = Array(12).fill(0);
  for (const x of d.movs) { const i = idx(x.fecha); if (i >= 0 && x.tipo === 'gasto') gasTodos[i] += Number(x.importe); }
  const ahorro = ing.map((v, i) => Math.round((v - gasTodos[i]) * 100) / 100);
  grafBarras($('#gr-ahorro'), {
    etiquetas,
    titulosTooltip: meses.map((m) => `${MESES_LARGOS[m.getMonth()]} ${m.getFullYear()}`),
    series: [{ nombre: 'Ahorro', valores: ahorro, colorPorValor: (v) => (v >= 0 ? 'var(--serie-ingreso)' : 'var(--serie-gasto)') }],
  });
  const totalAhorro = ahorro.reduce((s, v) => s + v, 0);
  const conDatos = ahorro.filter((_, i) => ing[i] || gasTodos[i]).length;
  $('#gr-ahorro-resumen').innerHTML = conDatos
    ? `En estos 12 meses: <b class="${totalAhorro >= 0 ? 'positivo' : 'negativo'}">${eur.format(totalAhorro)}</b> · media <b>${eur.format(totalAhorro / conDatos)}</b>/mes (${conDatos} ${conDatos === 1 ? 'mes' : 'meses'} con datos)`
    : '';

  // Tabla con los datos de los 12 meses
  $('#gr-tabla').innerHTML = `<table class="tabla">
    <thead><tr><th>Mes</th><th>Ingresos</th><th>Gastos</th><th>Ahorro</th></tr></thead>
    <tbody>${meses.map((m, i) => `<tr><td>${MESES_LARGOS[m.getMonth()]} ${m.getFullYear()}</td>
      <td>${eur.format(ing[i])}</td><td>${eur.format(gas[i])}</td>
      <td class="${ahorro[i] >= 0 ? 'positivo' : 'negativo'}">${eur.format(ahorro[i])}</td></tr>`).reverse().join('')}</tbody>
  </table>`;

  // ---- 5. Evolución de una categoría ----
  const sel = $('#gr-categoria');
  const catsGasto = ctx.state.categorias.filter((c) => c.tipo === 'gasto');
  if (!catEvolucion || !catsGasto.some((c) => c.id === catEvolucion)) {
    // por defecto, la categoría con más gasto del año
    const tot = new Map();
    for (const x of d.movs) if (esGasto(x) && x.categoria_id) tot.set(x.categoria_id, (tot.get(x.categoria_id) || 0) + Number(x.importe));
    catEvolucion = [...tot.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? catsGasto[0]?.id ?? null;
  }
  sel.innerHTML = catsGasto.map((c) => `<option value="${c.id}">${esc(c.icono)} ${esc(c.nombre)}</option>`).join('');
  if (catEvolucion) sel.value = String(catEvolucion);
  const cat = ctx.catPorId(catEvolucion);
  const evo = Array(12).fill(0);
  for (const x of d.movs) { const i = idx(x.fecha); if (i >= 0 && esGasto(x) && x.categoria_id === catEvolucion) evo[i] += Number(x.importe); }
  const conGasto = evo.filter((v) => v > 0);
  const media = conGasto.length ? sumar(conGasto.map((v) => ({ importe: v }))) / 12 : 0;
  grafBarras($('#gr-evolucion'), {
    etiquetas,
    titulosTooltip: meses.map((m) => `${MESES_LARGOS[m.getMonth()]} ${m.getFullYear()}`),
    series: [{ nombre: cat ? cat.nombre : 'Categoría', color: cat?.color || 'var(--serie-neutra)', valores: evo }],
    referencia: media ? { valor: media, etiqueta: `Media ${eur0.format(media)} €` } : null,
  });
}

// =========================================================
// Mini-librería de gráficos SVG
// =========================================================
function el(tag, attrs = {}, padre) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (padre) padre.appendChild(n);
  return n;
}

function pasoBonito(v) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
}

// Rango del eje Y: incluye el 0, ~4 divisiones de paso redondo
function escala(minV, maxV) {
  const lo = Math.min(0, minV), hi = Math.max(0, maxV, 100);
  const paso = pasoBonito((hi - lo) / 4);
  return { min: Math.floor(lo / paso) * paso, max: Math.ceil(hi / paso) * paso, paso };
}

// Ancho real del contenedor: 1 unidad del SVG = 1 píxel (texto legible en el móvil)
const anchoDe = (cont) => Math.max(300, Math.round(cont.clientWidth || cont.parentElement?.clientWidth || 600));

function preparar(cont, series, { conLeyenda = true, forma = 'linea' } = {}) {
  cont.innerHTML = '';
  cont.classList.add('grafico');
  if (conLeyenda && series.length > 1) {
    const ley = document.createElement('div');
    ley.className = 'leyenda';
    for (const s of series) {
      const it = document.createElement('span');
      const marca = document.createElement('i');
      marca.className = forma === 'linea' ? `marca-linea${s.discontinua ? ' discontinua' : ''}` : 'marca-barra';
      marca.style.setProperty('--c', s.color);
      it.append(marca, document.createTextNode(s.nombre));
      ley.appendChild(it);
    }
    cont.appendChild(ley);
  }
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.hidden = true;
  return tip;
}

function mostrarTooltip(cont, tip, svg, xSvg, W, titulo, filas) {
  tip.replaceChildren();
  const t = document.createElement('div');
  t.className = 'tooltip__titulo';
  t.textContent = titulo;
  tip.appendChild(t);
  for (const f of filas) {
    const r = document.createElement('div');
    r.className = 'tooltip__fila';
    const k = document.createElement('i');
    k.className = 'marca-linea';
    k.style.setProperty('--c', f.color);
    const v = document.createElement('b');
    v.textContent = f.valor;
    const n = document.createElement('span');
    n.textContent = f.nombre;
    r.append(k, v, n);
    tip.appendChild(r);
  }
  tip.hidden = false;
  const rc = svg.getBoundingClientRect();
  const rcont = cont.getBoundingClientRect();
  const x = rc.left - rcont.left + (xSvg / W) * rc.width;
  const ancho = tip.offsetWidth;
  tip.style.left = `${Math.max(0, Math.min(rcont.width - ancho, x - ancho / 2))}px`;
  tip.style.top = `${rc.top - rcont.top + 4}px`;
}

function ejeY(svg, { m, W, min, max, paso, y }) {
  for (let v = min; v <= max + paso / 2; v += paso) {
    const yy = y(v);
    el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: v === 0 ? 'eje-cero' : 'rejilla' }, svg);
    el('text', { x: m.l - 6, y: yy + 3.5, 'text-anchor': 'end', class: 'eje-texto' }, svg).textContent = ejeEur(v);
  }
}

function lineaReferencia(svg, { m, W, y, referencia }) {
  if (!referencia) return;
  const yy = y(referencia.valor);
  el('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: 'referencia' }, svg);
  el('text', { x: W - m.r, y: yy - 5, 'text-anchor': 'end', class: 'referencia-texto' }, svg).textContent = referencia.etiqueta;
}

// Curva monótona (Fritsch–Carlson): suave y sin "pasarse" de los datos
function curva(p) {
  if (p.length === 1) return `M${p[0][0]},${p[0][1]}`;
  const n = p.length;
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = p[i + 1][0] - p[i][0];
    m[i] = (p[i + 1][1] - p[i][1]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const c = dx[i] / 3;
    d += `C${(p[i][0] + c).toFixed(1)},${(p[i][1] + t[i] * c).toFixed(1)} ${(p[i + 1][0] - c).toFixed(1)},${(p[i + 1][1] - t[i + 1] * c).toFixed(1)} ${p[i + 1][0].toFixed(1)},${p[i + 1][1].toFixed(1)}`;
  }
  return d;
}

// ---------- Líneas ----------
function grafLineas(cont, { etiquetas, series, referencia, prefijoTooltip = '' }) {
  const tip = preparar(cont, series, { forma: 'linea' });
  const W = anchoDe(cont), H = 220, m = { l: 50, r: 10, t: 14, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = etiquetas.length;
  const todos = series.flatMap((s) => s.valores.filter((v) => v != null));
  const { min, max, paso } = escala(0, Math.max(...todos, referencia?.valor || 0));
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
  const y = (v) => m.t + ih - ((v - min) / (max - min)) * ih;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico__svg', role: 'img' });
  ejeY(svg, { m, W, min, max, paso, y });
  const cadaX = Math.ceil(n / Math.max(4, Math.floor(iw / 42)));
  etiquetas.forEach((e, i) => {
    if (i % cadaX === 0 || i === n - 1) el('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'eje-texto' }, svg).textContent = e;
  });
  lineaReferencia(svg, { m, W, y, referencia });

  const defs = el('defs', {}, svg);
  for (const s of [...series].reverse()) {
    // Tramos continuos (sin huecos) dibujados como curva suave
    const tramos = [];
    let actual = [];
    s.valores.forEach((v, i) => {
      if (v == null) { if (actual.length) tramos.push(actual); actual = []; return; }
      actual.push([x(i), y(v)]);
    });
    if (actual.length) tramos.push(actual);
    const d = tramos.map(curva).join('');
    // Relleno degradado bajo la serie principal
    if (!s.discontinua && tramos.length) {
      const id = `grad-${Math.random().toString(36).slice(2, 8)}`;
      const g = el('linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
      el('stop', { offset: 0, style: `stop-color:${s.color};stop-opacity:.22` }, g);
      el('stop', { offset: 1, style: `stop-color:${s.color};stop-opacity:0` }, g);
      for (const t of tramos) {
        el('path', { d: `${curva(t)}L${t.at(-1)[0]},${y(0)}L${t[0][0]},${y(0)}Z`, fill: `url(#${id})` }, svg);
      }
    }
    el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.discontinua ? '5 5' : null }, svg);
    // Etiqueta directa en el último punto
    const ult = s.valores.reduce((a, v, i) => (v != null ? i : a), -1);
    if (ult >= 0 && !s.discontinua) {
      el('circle', { cx: x(ult), cy: y(s.valores[ult]), r: 4, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2 }, svg);
    }
  }

  // Capa interactiva: línea vertical + puntos + tooltip
  const cruz = el('line', { y1: m.t, y2: m.t + ih, class: 'cruz', visibility: 'hidden' }, svg);
  const puntos = series.map((s) => el('circle', { r: 4.5, fill: s.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }, svg));
  const zona = el('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', class: 'zona' }, svg);
  const mover = (e) => {
    const rc = svg.getBoundingClientRect();
    const px = ((e.clientX - rc.left) / rc.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1))));
    cruz.setAttribute('x1', x(i)); cruz.setAttribute('x2', x(i)); cruz.setAttribute('visibility', 'visible');
    series.forEach((s, k) => {
      const v = s.valores[i];
      puntos[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
      if (v != null) { puntos[k].setAttribute('cx', x(i)); puntos[k].setAttribute('cy', y(v)); }
    });
    mostrarTooltip(cont, tip, svg, x(i), W, prefijoTooltip + etiquetas[i],
      series.filter((s) => s.valores[i] != null).map((s) => ({ nombre: s.nombre, color: s.color, valor: eur.format(s.valores[i]) })));
  };
  const salir = () => { cruz.setAttribute('visibility', 'hidden'); puntos.forEach((p) => p.setAttribute('visibility', 'hidden')); tip.hidden = true; };
  zona.addEventListener('pointermove', mover);
  zona.addEventListener('pointerdown', mover);
  zona.addEventListener('pointerleave', salir);

  cont.append(svg, tip);
}

// ---------- Barras (agrupadas; admite negativos) ----------
function grafBarras(cont, { etiquetas, titulosTooltip, series, referencia }) {
  const tip = preparar(cont, series, { forma: 'barra' });
  const W = anchoDe(cont), H = 220, m = { l: 50, r: 10, t: 14, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const n = etiquetas.length;
  const vals = series.flatMap((s) => s.valores);
  const { min, max, paso } = escala(Math.min(...vals), Math.max(...vals, referencia?.valor || 0));
  const y = (v) => m.t + ih - ((v - min) / (max - min)) * ih;
  const grupo = iw / n;
  const k = series.length;
  const anchoBarra = Math.min(22, (grupo * 0.72 - (k - 1) * 2) / k);
  const xBarra = (i, j) => m.l + i * grupo + (grupo - (anchoBarra * k + 2 * (k - 1))) / 2 + j * (anchoBarra + 2);

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'grafico__svg', role: 'img' });
  ejeY(svg, { m, W, min, max, paso, y });
  etiquetas.forEach((e, i) => {
    el('text', { x: m.l + i * grupo + grupo / 2, y: H - 6, 'text-anchor': 'middle', class: 'eje-texto' }, svg).textContent = e;
  });

  const grupos = [];
  for (let i = 0; i < n; i++) {
    const g = el('g', { class: 'grupo-barras' }, svg);
    series.forEach((s, j) => {
      const v = s.valores[i];
      if (!v) return;
      const x0 = xBarra(i, j), y0 = y(0), y1 = y(v);
      const r = Math.min(4, anchoBarra / 2, Math.abs(y0 - y1));
      const arriba = v > 0;
      // Extremo de datos redondeado, base recta sobre el eje
      const d = arriba
        ? `M${x0},${y0}V${y1 + r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + anchoBarra - r}Q${x0 + anchoBarra},${y1} ${x0 + anchoBarra},${y1 + r}V${y0}Z`
        : `M${x0},${y0}V${y1 - r}Q${x0},${y1} ${x0 + r},${y1}H${x0 + anchoBarra - r}Q${x0 + anchoBarra},${y1} ${x0 + anchoBarra},${y1 - r}V${y0}Z`;
      el('path', { d, fill: s.colorPorValor ? s.colorPorValor(v) : s.color }, g);
    });
    grupos.push(g);
  }
  lineaReferencia(svg, { m, W, y, referencia });

  // Zonas de toque: el grupo entero (más grande que la barra)
  for (let i = 0; i < n; i++) {
    const zona = el('rect', { x: m.l + i * grupo, y: m.t, width: grupo, height: ih, fill: 'transparent', class: 'zona' }, svg);
    const mover = () => {
      grupos.forEach((g, j) => g.classList.toggle('atenuado', j !== i));
      mostrarTooltip(cont, tip, svg, m.l + i * grupo + grupo / 2, W, titulosTooltip?.[i] || etiquetas[i],
        series.map((s) => ({ nombre: s.nombre, color: s.colorPorValor ? s.colorPorValor(s.valores[i]) : s.color, valor: eur.format(s.valores[i] || 0) })));
    };
    zona.addEventListener('pointermove', mover);
    zona.addEventListener('pointerdown', mover);
  }
  svg.addEventListener('pointerleave', () => { grupos.forEach((g) => g.classList.remove('atenuado')); tip.hidden = true; });

  cont.append(svg, tip);
}

// ---------- Donut ----------
function grafDonut(cont, items) {
  const tip = preparar(cont, [], {});
  if (!items.length) {
    cont.innerHTML = '<p class="ayuda" style="text-align:center">Sin gastos este mes</p>';
    return;
  }
  const total = items.reduce((s, x) => s + x.valor, 0);
  const W = 200, c = 100, R = 92, r = 60;
  const svg = el('svg', { viewBox: `0 0 ${W} ${W}`, class: 'donut__svg', role: 'img' });
  let ang = -Math.PI / 2;
  const punto = (a, rad) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
  const segmentos = items.map((it) => {
    const a0 = ang;
    const a1 = ang + (it.valor / total) * Math.PI * 2;
    ang = a1;
    let d;
    if (items.length === 1) {
      d = `M${c - R},${c}A${R},${R} 0 1 1 ${c + R},${c}A${R},${R} 0 1 1 ${c - R},${c}Z M${c - r},${c}A${r},${r} 0 1 0 ${c + r},${c}A${r},${r} 0 1 0 ${c - r},${c}Z`;
    } else {
      const grande = a1 - a0 > Math.PI ? 1 : 0;
      const [x0, y0] = punto(a0, R), [x1, y1] = punto(a1, R), [x2, y2] = punto(a1, r), [x3, y3] = punto(a0, r);
      d = `M${x0},${y0}A${R},${R} 0 ${grande} 1 ${x1},${y1}L${x2},${y2}A${r},${r} 0 ${grande} 0 ${x3},${y3}Z`;
    }
    return el('path', { d, fill: it.color, stroke: 'var(--surface)', 'stroke-width': 2, 'fill-rule': 'evenodd', class: 'segmento' }, svg);
  });
  el('text', { x: c, y: c - 4, 'text-anchor': 'middle', class: 'donut__total' }, svg).textContent = eur0.format(total) + ' €';
  el('text', { x: c, y: c + 16, 'text-anchor': 'middle', class: 'eje-texto' }, svg).textContent = 'gastado';

  const leyenda = document.createElement('ul');
  leyenda.className = 'donut__leyenda';
  const activar = (i) => {
    segmentos.forEach((s, j) => s.classList.toggle('atenuado', i != null && j !== i));
    [...leyenda.children].forEach((li, j) => li.classList.toggle('activo', j === i));
  };
  items.forEach((it, i) => {
    const li = document.createElement('li');
    const marca = document.createElement('i');
    marca.className = 'marca-barra';
    marca.style.setProperty('--c', it.color);
    const nombre = document.createElement('span');
    nombre.textContent = it.nombre;
    const valor = document.createElement('b');
    valor.textContent = eur.format(it.valor);
    const pct = document.createElement('small');
    pct.textContent = `${Math.round((it.valor / total) * 100)} %`;
    li.append(marca, nombre, valor, pct);
    li.addEventListener('pointerenter', () => activar(i));
    li.addEventListener('pointerleave', () => activar(null));
    leyenda.appendChild(li);
    segmentos[i].addEventListener('pointerenter', () => activar(i));
    segmentos[i].addEventListener('pointerdown', () => activar(i));
    segmentos[i].addEventListener('pointerleave', () => activar(null));
  });

  const caja = document.createElement('div');
  caja.className = 'donut';
  caja.append(svg, leyenda);
  cont.append(caja, tip);
}
