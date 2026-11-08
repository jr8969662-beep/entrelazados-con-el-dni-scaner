#!/usr/bin/env node
/**
 * Registro DNI — servidor de referencia.
 *
 * Guarda las fichas (una por DNI), las fotos del documento y los trámites en una base SQLite, con usuarios,
 * roles y registro de actividad. Es la API que usa la app (modo "Servidor de la institución") y la que
 * consultan los otros sistemas autorizados.
 *
 * Requisitos: Node.js 22.13 o más nuevo (trae SQLite). Sin dependencias externas.
 * Arranque:   node servidor/servidor.js            (ver servidor/LEEME.md)
 *
 * Variables de entorno:
 *   PUERTO        puerto HTTP (8080)
 *   DATOS         carpeta de la base y las fotos (servidor/datos)
 *   CLAVE_DATOS   64 caracteres hexadecimales: cifra las fotos en el disco (AES-256-GCM). Muy recomendado.
 *   ORIGENES      orígenes web permitidos, separados por coma (la página de la app). Vacío = solo el mismo servidor.
 *   SERVIR_APP    1 = también sirve la app (la carpeta de arriba) desde este mismo servidor
 *   HORAS_SESION  duración de la sesión de un agente (12)
 */
'use strict';
process.removeAllListeners('warning');   // el aviso "SQLite is experimental" no aporta en producción
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PUERTO = +(process.env.PUERTO || process.env.PORT || 8080);
const DATOS = path.resolve(process.env.DATOS || path.join(__dirname, 'datos'));
// 64 caracteres hexadecimales = la clave tal cual; cualquier otro texto largo se convierte en clave con SHA-256
const CLAVE = !process.env.CLAVE_DATOS ? null
  : /^[0-9a-f]{64}$/i.test(process.env.CLAVE_DATOS) ? Buffer.from(process.env.CLAVE_DATOS, 'hex')
  : process.env.CLAVE_DATOS.length >= 16 ? crypto.createHash('sha256').update(process.env.CLAVE_DATOS).digest() : null;
const ORIGENES = String(process.env.ORIGENES || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);
const HORAS_SESION = +(process.env.HORAS_SESION || 12);
const RAIZ_APP = path.resolve(__dirname, '..');
const TIPOS = ['Certificado de antecedentes', 'Certificado de residencia', 'Certificado de convivencia', 'Certificado de carencia de recursos', 'Exposición / denuncia', 'Otro'];
const ESTADOS = ['Iniciado', 'En revisión', 'Listo para entregar', 'Entregado'];
const CAMPOS = ['apellido', 'nombre', 'sexo', 'fechaNacimiento', 'nacionalidad', 'lugarNacimiento', 'domicilio', 'cuil', 'ejemplar', 'tramiteDNI', 'fechaEmision', 'fechaVencimiento', 'versionDNI', 'metodo', 'telefono'];
// qué puede hacer cada rol
const PUEDE = {
  responsable: ['leer', 'escribir', 'borrar', 'auditoria'],
  carga: ['leer', 'escribir'],
  consulta: ['leer'],
  sistema: ['leer']   // otros sistemas: solo consultan, con su clave
};

fs.mkdirSync(path.join(DATOS, 'fotos'), { recursive: true });
const db = abrirBase(path.join(DATOS, 'registro.db'));

function abrirBase(archivo) {
  const d = new DatabaseSync(archivo);
  d.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS usuarios (usuario TEXT PRIMARY KEY, nombre TEXT, rol TEXT NOT NULL, sal TEXT NOT NULL, hash TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sesiones (token_hash TEXT PRIMARY KEY, usuario TEXT NOT NULL, vence TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS claves_sistema (clave_hash TEXT PRIMARY KEY, nombre TEXT NOT NULL, activo INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS personas (dni TEXT PRIMARY KEY, datos TEXT NOT NULL, creado_en TEXT NOT NULL, creado_por TEXT, actualizado_en TEXT NOT NULL, actualizado_por TEXT);
    CREATE TABLE IF NOT EXISTS fotos (id TEXT PRIMARY KEY, dni TEXT NOT NULL, lado TEXT NOT NULL, actual INTEGER NOT NULL DEFAULT 1, creado TEXT NOT NULL, creado_por TEXT);
    CREATE INDEX IF NOT EXISTS fotos_dni ON fotos(dni);
    CREATE TABLE IF NOT EXISTS tramites (id TEXT PRIMARY KEY, numero TEXT NOT NULL, dni TEXT NOT NULL, tipo TEXT NOT NULL, estado TEXT NOT NULL, observaciones TEXT, fecha TEXT NOT NULL, agente TEXT, actualizado_en TEXT, actualizado_por TEXT);
    CREATE INDEX IF NOT EXISTS tramites_dni ON tramites(dni);
    CREATE TABLE IF NOT EXISTS auditoria (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL, agente TEXT, accion TEXT NOT NULL, dni TEXT, ip TEXT);
    CREATE TRIGGER IF NOT EXISTS auditoria_sin_cambios BEFORE UPDATE ON auditoria BEGIN SELECT RAISE(ABORT, 'el registro de actividad no se modifica'); END;
    CREATE TRIGGER IF NOT EXISTS auditoria_sin_borrar BEFORE DELETE ON auditoria BEGIN SELECT RAISE(ABORT, 'el registro de actividad no se borra'); END;
  `);
  return d;
}

// ---------- utilidades ----------
const ahora = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nuevoId = () => crypto.randomBytes(12).toString('hex');
const limpiarDni = (d) => String(d || '').replace(/\D/g, '');
function numeroTramite() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
function hashClave(clave, sal) { return crypto.scryptSync(String(clave), sal, 64).toString('hex'); }
function auditar(agente, accion, dni, ip) {
  db.prepare('INSERT INTO auditoria (fecha, agente, accion, dni, ip) VALUES (?, ?, ?, ?, ?)').run(ahora(), agente || '', accion, dni || '', ip || '');
}
// fotos en el disco, cifradas si hay CLAVE_DATOS (iv 12 bytes + tag 16 bytes + datos)
function guardarArchivoFoto(id, buf) {
  let salida = buf;
  if (CLAVE) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', CLAVE, iv);
    const cuerpo = Buffer.concat([c.update(buf), c.final()]);
    salida = Buffer.concat([Buffer.from('RDC1'), iv, c.getAuthTag(), cuerpo]);
  }
  fs.writeFileSync(path.join(DATOS, 'fotos', id + '.bin'), salida, { mode: 0o600 });
}
function leerArchivoFoto(id) {
  const buf = fs.readFileSync(path.join(DATOS, 'fotos', id + '.bin'));
  if (buf.subarray(0, 4).toString() !== 'RDC1') return buf;
  if (!CLAVE) throw new Error('La foto está cifrada y falta CLAVE_DATOS');
  const iv = buf.subarray(4, 16), tag = buf.subarray(16, 32), d = crypto.createDecipheriv('aes-256-gcm', CLAVE, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

function personaCompleta(dni, conTramites) {
  const fila = db.prepare('SELECT * FROM personas WHERE dni = ?').get(dni);
  if (!fila) return null;
  const p = Object.assign({ dni }, JSON.parse(fila.datos), {
    creadoEn: fila.creado_en, creadoPor: fila.creado_por, actualizadoEn: fila.actualizado_en, actualizadoPor: fila.actualizado_por
  });
  const fotos = db.prepare('SELECT id, lado, actual, creado FROM fotos WHERE dni = ? ORDER BY creado').all(dni);
  p.fotos = {}; p.fotosAnteriores = [];
  fotos.forEach((f) => { if (f.actual) p.fotos[f.lado] = f.id; else p.fotosAnteriores.push({ lado: f.lado, id: f.id, desde: f.creado }); });
  if (conTramites) p.tramites = db.prepare('SELECT * FROM tramites WHERE dni = ? ORDER BY fecha DESC').all(dni).map(tramiteJSON);
  return p;
}
function tramiteJSON(t) {
  return { id: t.id, numero: t.numero, dni: t.dni, tipo: t.tipo, estado: t.estado, observaciones: t.observaciones || '', fecha: t.fecha, agente: t.agente, actualizadoEn: t.actualizado_en, actualizadoPor: t.actualizado_por };
}

// ---------- sesión ----------
const intentos = new Map();   // ip -> [fechas de intentos fallidos]
function quienEs(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const h = sha256(m[1].trim());
  const s = db.prepare('SELECT s.usuario, s.vence, u.nombre, u.rol, u.activo FROM sesiones s JOIN usuarios u ON u.usuario = s.usuario WHERE s.token_hash = ?').get(h);
  if (s) {
    if (!s.activo || s.vence < ahora()) return null;
    return { usuario: s.usuario, nombre: s.nombre || s.usuario, rol: s.rol };
  }
  const k = db.prepare('SELECT nombre FROM claves_sistema WHERE clave_hash = ? AND activo = 1').get(h);
  if (k) return { usuario: 'sistema:' + k.nombre, nombre: k.nombre, rol: 'sistema' };
  return null;
}
const puede = (u, accion) => !!(u && (PUEDE[u.rol] || []).includes(accion));

// ---------- HTTP ----------
function cabecerasCORS(req, res) {
  const o = req.headers.origin;
  if (o && ORIGENES.includes(o.replace(/\/+$/, ''))) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}
function responder(res, codigo, obj) {
  const cuerpo = obj === undefined ? '' : JSON.stringify(obj);
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(cuerpo);
}
const error = (res, codigo, msg) => responder(res, codigo, { error: msg });
function leerCuerpo(req, max) {
  return new Promise((ok, no) => {
    const partes = []; let total = 0;
    req.on('data', (c) => { total += c.length; if (total > max) { no(Object.assign(new Error('El envío es demasiado grande'), { codigo: 413 })); req.destroy(); } else partes.push(c); });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', no);
  });
}
async function leerJSON(req) {
  const b = await leerCuerpo(req, 256 * 1024);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch (e) { throw Object.assign(new Error('JSON inválido'), { codigo: 400 }); }
}

async function api(req, res, ruta, ip) {
  const metodo = req.method;
  if (metodo === 'GET' && ruta === '/salud') return responder(res, 200, { ok: true, version: 1, fotosCifradas: !!CLAVE });

  // --- entrar ---
  if (metodo === 'POST' && ruta === '/sesion') {
    const lista = (intentos.get(ip) || []).filter((t) => Date.now() - t < 15 * 60 * 1000);
    if (lista.length >= 10) return error(res, 429, 'Demasiados intentos: esperá 15 minutos');
    const b = await leerJSON(req);
    const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(String(b.usuario || '').trim().toLowerCase());
    const ok = u && u.activo && crypto.timingSafeEqual(Buffer.from(hashClave(b.clave || '', u.sal), 'hex'), Buffer.from(u.hash, 'hex'));
    if (!ok) { lista.push(Date.now()); intentos.set(ip, lista); auditar(String(b.usuario || ''), 'Intento de entrada fallido', '', ip); return error(res, 401, 'Usuario o contraseña incorrectos'); }
    intentos.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sesiones WHERE vence < ?').run(ahora());
    db.prepare('INSERT INTO sesiones (token_hash, usuario, vence) VALUES (?, ?, ?)').run(sha256(token), u.usuario, new Date(Date.now() + HORAS_SESION * 3600e3).toISOString());
    auditar(u.usuario, 'Entró al sistema', '', ip);
    return responder(res, 200, { token, usuario: { usuario: u.usuario, nombre: u.nombre || u.usuario, rol: u.rol } });
  }

  const yo = quienEs(req);
  if (!yo) return error(res, 401, 'Falta iniciar sesión');
  const quien = yo.nombre;
  let m;

  // --- personas ---
  if (metodo === 'GET' && ruta === '/personas') {
    if (!puede(yo, 'leer')) return error(res, 403, 'Sin permiso');
    const q = String(new URL(req.url, 'http://x').searchParams.get('q') || '').trim().toUpperCase();
    const qd = limpiarDni(q);
    const filas = db.prepare(`SELECT p.dni, p.datos, p.actualizado_en, (SELECT COUNT(*) FROM tramites t WHERE t.dni = p.dni) AS n FROM personas p ORDER BY p.actualizado_en DESC LIMIT 500`).all();
    const personas = filas.map((f) => Object.assign({ dni: f.dni }, JSON.parse(f.datos), { actualizadoEn: f.actualizado_en, cantidadTramites: f.n }))
      .filter((p) => !q || (qd && p.dni.includes(qd)) || `${p.apellido || ''} ${p.nombre || ''}`.includes(q));
    if (q) auditar(quien, 'Buscó "' + q.slice(0, 40) + '"', '', ip);
    return responder(res, 200, { personas });
  }
  if ((m = /^\/personas\/(\d{7,8})$/.exec(ruta))) {
    const dni = m[1];
    if (metodo === 'GET') {
      if (!puede(yo, 'leer')) return error(res, 403, 'Sin permiso');
      const p = personaCompleta(dni, true);
      auditar(quien, p ? 'Consultó la ficha' : 'Consultó un DNI no registrado', dni, ip);
      return p ? responder(res, 200, p) : error(res, 404, 'La persona no existe en el Registro');
    }
    if (metodo === 'PUT') {
      if (!puede(yo, 'escribir')) return error(res, 403, 'Sin permiso para cargar');
      const b = await leerJSON(req);
      const prev = db.prepare('SELECT * FROM personas WHERE dni = ?').get(dni);
      const datos = Object.assign({}, prev ? JSON.parse(prev.datos) : {});
      CAMPOS.forEach((k) => { if (b[k] != null && String(b[k]).trim() !== '') datos[k] = String(b[k]).trim().slice(0, 300); });
      if (!datos.apellido || !datos.nombre) return error(res, 400, 'Faltan el apellido o el nombre');
      datos.apellido = datos.apellido.toUpperCase(); datos.nombre = datos.nombre.toUpperCase();
      if (prev) db.prepare('UPDATE personas SET datos = ?, actualizado_en = ?, actualizado_por = ? WHERE dni = ?').run(JSON.stringify(datos), ahora(), quien, dni);
      else db.prepare('INSERT INTO personas (dni, datos, creado_en, creado_por, actualizado_en, actualizado_por) VALUES (?, ?, ?, ?, ?, ?)').run(dni, JSON.stringify(datos), ahora(), quien, ahora(), quien);
      auditar(quien, prev ? 'Actualizó la ficha' : 'Registró a la persona', dni, ip);
      return responder(res, prev ? 200 : 201, personaCompleta(dni, true));
    }
    if (metodo === 'DELETE') {
      if (!puede(yo, 'borrar')) return error(res, 403, 'Solo el responsable puede borrar fichas');
      const fotos = db.prepare('SELECT id FROM fotos WHERE dni = ?').all(dni);
      fotos.forEach((f) => { try { fs.unlinkSync(path.join(DATOS, 'fotos', f.id + '.bin')); } catch (e) { /* ya no estaba */ } });
      db.prepare('DELETE FROM fotos WHERE dni = ?').run(dni);
      db.prepare('DELETE FROM tramites WHERE dni = ?').run(dni);
      db.prepare('DELETE FROM personas WHERE dni = ?').run(dni);
      auditar(quien, 'Borró la ficha', dni, ip);
      return responder(res, 200, { borrado: true });
    }
  }
  if ((m = /^\/personas\/(\d{7,8})\/fotos\/(frente|reverso)$/.exec(ruta)) && metodo === 'PUT') {
    if (!puede(yo, 'escribir')) return error(res, 403, 'Sin permiso para cargar');
    const [, dni, lado] = m;
    if (!db.prepare('SELECT 1 FROM personas WHERE dni = ?').get(dni)) return error(res, 404, 'Primero se guardan los datos de la persona');
    const buf = await leerCuerpo(req, 8 * 1024 * 1024);
    if (!(buf[0] === 0xff && buf[1] === 0xd8) && !(buf[0] === 0x89 && buf[1] === 0x50)) return error(res, 415, 'La foto tiene que ser JPEG o PNG');
    const id = nuevoId();
    guardarArchivoFoto(id, buf);
    db.prepare('UPDATE fotos SET actual = 0 WHERE dni = ? AND lado = ?').run(dni, lado);
    db.prepare('INSERT INTO fotos (id, dni, lado, actual, creado, creado_por) VALUES (?, ?, ?, 1, ?, ?)').run(id, dni, lado, ahora(), quien);
    db.prepare('UPDATE personas SET actualizado_en = ?, actualizado_por = ? WHERE dni = ?').run(ahora(), quien, dni);
    auditar(quien, 'Cargó la foto del ' + lado, dni, ip);
    return responder(res, 200, personaCompleta(dni, true));
  }
  if ((m = /^\/fotos\/([0-9a-f]{24})$/.exec(ruta)) && metodo === 'GET') {
    if (!puede(yo, 'leer')) return error(res, 403, 'Sin permiso');
    const f = db.prepare('SELECT * FROM fotos WHERE id = ?').get(m[1]);
    if (!f) return error(res, 404, 'La foto no existe');
    let buf;
    try { buf = leerArchivoFoto(f.id); } catch (e) { return error(res, 500, e.message); }
    auditar(quien, 'Vio la foto del ' + f.lado, f.dni, ip);
    res.writeHead(200, { 'Content-Type': buf[0] === 0x89 ? 'image/png' : 'image/jpeg', 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
    return res.end(buf);
  }

  // --- trámites ---
  if (ruta === '/tramites' && metodo === 'GET') {
    if (!puede(yo, 'leer')) return error(res, 403, 'Sin permiso');
    const sp = new URL(req.url, 'http://x').searchParams;
    const dni = limpiarDni(sp.get('dni')), estado = sp.get('estado') || '';
    let sql = 'SELECT * FROM tramites WHERE 1=1'; const args = [];
    if (dni) { sql += ' AND dni = ?'; args.push(dni); }
    if (estado) { sql += ' AND estado = ?'; args.push(estado); }
    return responder(res, 200, { tramites: db.prepare(sql + ' ORDER BY fecha DESC LIMIT 1000').all(...args).map(tramiteJSON) });
  }
  if (ruta === '/tramites' && metodo === 'POST') {
    if (!puede(yo, 'escribir')) return error(res, 403, 'Sin permiso para cargar');
    const b = await leerJSON(req);
    const dni = limpiarDni(b.dni);
    if (!db.prepare('SELECT 1 FROM personas WHERE dni = ?').get(dni)) return error(res, 404, 'La persona no existe en el Registro');
    if (!TIPOS.includes(b.tipo)) return error(res, 400, 'Tipo de trámite desconocido');
    const t = { id: nuevoId(), numero: numeroTramite(), dni, tipo: b.tipo, estado: 'Iniciado', observaciones: String(b.observaciones || '').slice(0, 500), fecha: ahora(), agente: quien };
    db.prepare('INSERT INTO tramites (id, numero, dni, tipo, estado, observaciones, fecha, agente) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(t.id, t.numero, t.dni, t.tipo, t.estado, t.observaciones, t.fecha, t.agente);
    db.prepare('UPDATE personas SET actualizado_en = ?, actualizado_por = ? WHERE dni = ?').run(ahora(), quien, dni);
    auditar(quien, 'Inició ' + t.tipo.toLowerCase() + ' (' + t.numero + ')', dni, ip);
    return responder(res, 201, t);
  }
  if ((m = /^\/tramites\/([0-9a-f]{24})$/.exec(ruta)) && metodo === 'PATCH') {
    if (!puede(yo, 'escribir')) return error(res, 403, 'Sin permiso para cargar');
    const b = await leerJSON(req);
    if (!ESTADOS.includes(b.estado)) return error(res, 400, 'Estado desconocido');
    const t = db.prepare('SELECT * FROM tramites WHERE id = ?').get(m[1]);
    if (!t) return error(res, 404, 'El trámite no existe');
    db.prepare('UPDATE tramites SET estado = ?, actualizado_en = ?, actualizado_por = ? WHERE id = ?').run(b.estado, ahora(), quien, t.id);
    auditar(quien, 'Cambió el estado de ' + t.numero + ' a ' + b.estado, t.dni, ip);
    return responder(res, 200, tramiteJSON(db.prepare('SELECT * FROM tramites WHERE id = ?').get(t.id)));
  }

  // --- registro de actividad ---
  if (ruta === '/auditoria' && metodo === 'GET') {
    if (!puede(yo, 'auditoria')) return error(res, 403, 'Solo el responsable ve el registro de actividad');
    const sp = new URL(req.url, 'http://x').searchParams;
    const dni = limpiarDni(sp.get('dni'));
    const filas = dni ? db.prepare('SELECT * FROM auditoria WHERE dni = ? ORDER BY id DESC LIMIT 500').all(dni) : db.prepare('SELECT * FROM auditoria ORDER BY id DESC LIMIT 500').all();
    return responder(res, 200, { auditoria: filas });
  }

  return error(res, 404, 'No existe esa dirección');
}

// la app, servida desde este mismo servidor (SERVIR_APP=1): solo archivos de la app, nunca servidor/ ni datos
const TIPOS_MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.traineddata': 'application/octet-stream', '.wasm': 'application/wasm' };
function servirApp(req, res, ruta) {
  let rel = decodeURIComponent(ruta).replace(/^\/+/, '') || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const archivo = path.resolve(RAIZ_APP, rel);
  if (!archivo.startsWith(RAIZ_APP + path.sep) || archivo.startsWith(path.join(RAIZ_APP, 'servidor')) || /(^|[\\/])\./.test(rel)) { res.writeHead(404); return res.end(); }
  fs.stat(archivo, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('No encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS_MIME[path.extname(archivo)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(archivo).pipe(res);
  });
}

const servidor = http.createServer(async (req, res) => {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const ruta = (req.url || '/').split('?')[0];
  cabecerasCORS(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (ruta.startsWith('/api/v1/')) return await api(req, res, ruta.slice(7), ip);
    if (process.env.SERVIR_APP === '1' && (req.method === 'GET' || req.method === 'HEAD')) return servirApp(req, res, ruta);
    error(res, 404, 'No existe esa dirección');
  } catch (e) {
    if (!res.headersSent) error(res, e.codigo || 500, e.codigo ? e.message : 'Error interno');
    if (!e.codigo) console.error(new Date().toISOString(), e);
  }
});

// Arranque sin consola (servidores de prueba en la nube): el primer usuario y una clave de sistema salen de variables de entorno.
//   ADMIN_USUARIO / ADMIN_CLAVE / ADMIN_NOMBRE  -> crea (o actualiza la contraseña de) un usuario responsable
//   SISTEMA_CLAVE / SISTEMA_NOMBRE             -> clave de solo lectura para un "otro sistema" de prueba
function arranqueDesdeEntorno() {
  const u = String(process.env.ADMIN_USUARIO || '').trim().toLowerCase(), c = process.env.ADMIN_CLAVE || '';
  if (u && c.length >= 10) {
    const sal = crypto.randomBytes(16).toString('hex'), hash = hashClave(c, sal);
    if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(u)) db.prepare('UPDATE usuarios SET sal = ?, hash = ?, activo = 1 WHERE usuario = ?').run(sal, hash, u);
    else db.prepare('INSERT INTO usuarios (usuario, nombre, rol, sal, hash, activo, creado) VALUES (?, ?, ?, ?, ?, 1, ?)').run(u, process.env.ADMIN_NOMBRE || u, 'responsable', sal, hash, ahora());
  } else if (u) console.log('AVISO: ADMIN_CLAVE tiene que tener al menos 10 caracteres.');
  const k = process.env.SISTEMA_CLAVE || '';
  if (k.length >= 16) {
    const h = sha256(k);
    if (!db.prepare('SELECT 1 FROM claves_sistema WHERE clave_hash = ?').get(h)) db.prepare('INSERT INTO claves_sistema (clave_hash, nombre, activo, creado) VALUES (?, ?, 1, ?)').run(h, process.env.SISTEMA_NOMBRE || 'Sistema de prueba', ahora());
  } else if (k) console.log('AVISO: SISTEMA_CLAVE tiene que tener al menos 16 caracteres.');
}

if (require.main === module) {
  arranqueDesdeEntorno();
  servidor.listen(PUERTO, () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
    console.log(`Registro DNI escuchando en el puerto ${PUERTO} · datos en ${DATOS}`);
    if (!CLAVE) console.log('AVISO: falta CLAVE_DATOS: las fotos se guardan sin cifrar.');
    if (!n) console.log('AVISO: no hay usuarios. Creá el primero:  node servidor/usuarios.js agregar <usuario> responsable "<Nombre>"');
  });
}
module.exports = { servidor, db };
