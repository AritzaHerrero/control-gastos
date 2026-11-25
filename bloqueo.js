// =========================================================
// Bloqueo de la app con PIN y huella (por dispositivo)
//
// - El PIN se guarda como hash PBKDF2 con sal: no se puede leer.
// - La huella usa WebAuthn (el lector del propio móvil): el navegador
//   solo dice "sí" si el sistema reconoce tu huella o bloqueo de pantalla.
// - Es una capa extra para quien coja tu móvil: tus datos siguen
//   protegidos por tu usuario y contraseña de Supabase.
// =========================================================
import { $, toast } from './util.js';

const CLAVE = 'gastos.bloqueo';
const ITER = 150000;
const MAX_FALLOS = 5;

let cfg = leer();
let pinTecleado = '';
let fallos = 0;
let bloqueadoHasta = 0;
let ocultaDesde = null;
let alCerrarSesion = () => {};

function leer() {
  try { return JSON.parse(localStorage.getItem(CLAVE)) || null; } catch { return null; }
}
function guardarCfg(c) {
  cfg = c;
  try {
    if (c) localStorage.setItem(CLAVE, JSON.stringify(c));
    else localStorage.removeItem(CLAVE);
  } catch { /* sin almacenamiento: no hay bloqueo */ }
}

// ---------- Utilidades criptográficas ----------
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));

async function hashPin(pin, salB64) {
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: deB64(salB64), iterations: ITER }, clave, 256);
  return b64(bits);
}

// Comparación en tiempo constante
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------- API pública ----------
export const tienePin = () => !!cfg?.hash;
export const tieneHuella = () => !!cfg?.credId;
export const minutosBloqueo = () => cfg?.minutos ?? 1;

export async function huellaDisponible() {
  try {
    return !!window.PublicKeyCredential
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

export async function configurarPin(pin) {
  const sal = b64(aleatorio(16));
  const hash = await hashPin(pin, sal);
  guardarCfg({ ...(cfg || {}), sal, hash, minutos: cfg?.minutos ?? 1 });
}

export function quitarBloqueo() { guardarCfg(null); }

export function ponerMinutos(min) {
  if (cfg) guardarCfg({ ...cfg, minutos: min });
}

export async function activarHuella() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: aleatorio(32),
      rp: { name: 'Control de gastos', id: location.hostname },
      user: { id: aleatorio(16), name: 'control-gastos', displayName: 'Control de gastos' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'discouraged',
      },
      timeout: 60000,
      attestation: 'none',
    },
  });
  guardarCfg({ ...cfg, credId: b64(cred.rawId) });
}

export function desactivarHuella() {
  if (cfg) { const { credId, ...resto } = cfg; guardarCfg(resto); }
}

async function verificarHuella() {
  await navigator.credentials.get({
    publicKey: {
      challenge: aleatorio(32),
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: deB64(cfg.credId), transports: ['internal'] }],
      userVerification: 'required',
      timeout: 60000,
    },
  });
}

// ---------- Pantalla de bloqueo ----------
export function initBloqueo({ onCerrarSesion }) {
  alCerrarSesion = onCerrarSesion;
  const v = $('#vista-bloqueo');

  v.querySelector('.teclado').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tecla) teclear(b.dataset.tecla);
    else if (b.dataset.accion === 'borrar') { pinTecleado = pinTecleado.slice(0, -1); pintarPuntos(); }
    else if (b.dataset.accion === 'huella') probarHuella();
  });

  // Teclado físico (ordenador)
  document.addEventListener('keydown', (e) => {
    if (v.hidden) return;
    if (/^\d$/.test(e.key)) teclear(e.key);
    else if (e.key === 'Backspace') { pinTecleado = pinTecleado.slice(0, -1); pintarPuntos(); }
    else if (e.key === 'Enter') comprobar();
  });

  $('#bloqueo-olvido').addEventListener('click', async () => {
    if (!confirm('Se quitará el bloqueo y se cerrará la sesión. Tendrás que entrar con tu email y contraseña. ¿Continuar?')) return;
    quitarBloqueo();
    v.hidden = true;
    await alCerrarSesion();
  });

  // Bloqueo automático al volver tras un rato en segundo plano
  document.addEventListener('visibilitychange', () => {
    if (!tienePin()) return;
    if (document.visibilityState === 'hidden') ocultaDesde = Date.now();
    else if (ocultaDesde && Date.now() - ocultaDesde >= minutosBloqueo() * 60000) bloquear();
  });

}

export function estaBloqueada() { return !$('#vista-bloqueo').hidden; }

export function bloquear() {
  if (!tienePin()) return;
  pinTecleado = '';
  pintarPuntos();
  $('#bloqueo-msg').textContent = 'Introduce tu PIN';
  $('#bloqueo-msg').classList.remove('error');
  $('#vista-bloqueo').hidden = false;
  $('#btn-huella').hidden = !tieneHuella();
  document.body.classList.add('con-bloqueo');
  // Intenta la huella directamente; si el navegador lo impide, queda el botón
  if (tieneHuella()) setTimeout(probarHuella, 300);
}

function desbloquear() {
  fallos = 0;
  pinTecleado = '';
  $('#vista-bloqueo').hidden = true;
  document.body.classList.remove('con-bloqueo');
  ocultaDesde = null;
}

function teclear(d) {
  if (Date.now() < bloqueadoHasta) return;
  if (pinTecleado.length >= 6) return;
  pinTecleado += d;
  pintarPuntos();
  if (pinTecleado.length === (cfg?.largo || 0)) comprobar();
}

function pintarPuntos() {
  const largo = Math.max(cfg?.largo || 4, pinTecleado.length);
  $('#bloqueo-puntos').innerHTML = Array.from({ length: largo }, (_, i) =>
    `<span class="${i < pinTecleado.length ? 'lleno' : ''}"></span>`).join('');
}

let comprobando = false;
async function comprobar() {
  if (comprobando || !pinTecleado) return;
  if (Date.now() < bloqueadoHasta) return;
  comprobando = true;
  try {
    const ok = iguales(await hashPin(pinTecleado, cfg.sal), cfg.hash);
    if (ok) return desbloquear();
    fallos++;
    pinTecleado = '';
    pintarPuntos();
    const msg = $('#bloqueo-msg');
    msg.classList.add('error');
    $('#bloqueo-puntos').classList.remove('agitar');
    void $('#bloqueo-puntos').offsetWidth;
    $('#bloqueo-puntos').classList.add('agitar');
    if (fallos >= MAX_FALLOS) {
      bloqueadoHasta = Date.now() + 30000;
      fallos = 0;
      msg.textContent = 'Demasiados intentos. Espera 30 segundos';
      setTimeout(() => { msg.textContent = 'Introduce tu PIN'; msg.classList.remove('error'); }, 30000);
    } else {
      msg.textContent = `PIN incorrecto (${MAX_FALLOS - fallos} ${MAX_FALLOS - fallos === 1 ? 'intento' : 'intentos'})`;
    }
  } finally { comprobando = false; }
}

let probandoHuella = false;
async function probarHuella() {
  if (!tieneHuella() || probandoHuella || $('#vista-bloqueo').hidden) return;
  probandoHuella = true;
  try {
    await verificarHuella();
    desbloquear();
  } catch { /* cancelada o no reconocida: queda el PIN */ }
  finally { probandoHuella = false; }
}

// El largo del PIN se guarda para validar al teclear el último dígito
export async function guardarPinNuevo(pin) {
  await configurarPin(pin);
  guardarCfg({ ...cfg, largo: pin.length });
  toast('PIN guardado');
}
