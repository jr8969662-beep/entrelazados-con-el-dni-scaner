#!/usr/bin/env node
/**
 * Registro DNI — usuarios y claves de los otros sistemas.
 *
 *   node servidor/usuarios.js agregar <usuario> <rol> "<Nombre y apellido>"   pide la contraseña
 *   node servidor/usuarios.js clave <usuario>                                cambia la contraseña
 *   node servidor/usuarios.js baja <usuario>                                 desactiva al usuario
 *   node servidor/usuarios.js lista
 *   node servidor/usuarios.js clave-sistema "<Nombre del sistema>"          crea una clave de solo lectura
 *
 * Roles: responsable (todo + registro de actividad + borrar), carga (carga y consulta), consulta (solo mira).
 */
'use strict';
process.removeAllListeners('warning');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const readline = require('node:readline');
const { DatabaseSync } = require('node:sqlite');

const DATOS = path.resolve(process.env.DATOS || path.join(__dirname, 'datos'));
fs.mkdirSync(DATOS, { recursive: true });
// abrir la base con el mismo esquema que el servidor
require('./servidor.js');
const db = new DatabaseSync(path.join(DATOS, 'registro.db'));
const ROLES = ['responsable', 'carga', 'consulta'];
const ahora = () => new Date().toISOString();

function preguntarClave(texto) {
  if (process.env.CLAVE_NUEVA) return Promise.resolve(process.env.CLAVE_NUEVA);   // para scripts
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = function (s) { if (!rl.stdoutMuted || /\n/.test(s)) rl.output.write(s); };
    rl.question(texto, (r) => { rl.close(); process.stdout.write('\n'); ok(r); });
    rl.stdoutMuted = false; process.stdout.write(texto); rl.stdoutMuted = true;
  });
}
async function claveValida() {
  const c = await preguntarClave('Contraseña (mínimo 10 caracteres): ');
  if (String(c).length < 10) { console.error('La contraseña tiene que tener al menos 10 caracteres.'); process.exit(1); }
  return c;
}
function guardarClave(usuario, clave) {
  const sal = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(clave), sal, 64).toString('hex');
  return { sal, hash };
}

(async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'agregar') {
    const usuario = String(a || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario) || !ROLES.includes(b)) { console.error('Uso: agregar <usuario> <responsable|carga|consulta> "<Nombre>"'); process.exit(1); }
    if (db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(usuario)) { console.error('Ese usuario ya existe.'); process.exit(1); }
    const { sal, hash } = guardarClave(usuario, await claveValida());
    db.prepare('INSERT INTO usuarios (usuario, nombre, rol, sal, hash, activo, creado) VALUES (?, ?, ?, ?, ?, 1, ?)').run(usuario, c || usuario, b, sal, hash, ahora());
    db.prepare('INSERT INTO auditoria (fecha, agente, accion, dni, ip) VALUES (?, ?, ?, ?, ?)').run(ahora(), 'consola', 'Creó el usuario ' + usuario + ' (' + b + ')', '', 'local');
    console.log(`Usuario ${usuario} creado con rol ${b}.`);
  } else if (cmd === 'clave') {
    const u = db.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').get(String(a || '').toLowerCase());
    if (!u) { console.error('No existe ese usuario.'); process.exit(1); }
    const { sal, hash } = guardarClave(a, await claveValida());
    db.prepare('UPDATE usuarios SET sal = ?, hash = ? WHERE usuario = ?').run(sal, hash, a.toLowerCase());
    db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(a.toLowerCase());
    console.log('Contraseña cambiada. Las sesiones abiertas se cerraron.');
  } else if (cmd === 'baja') {
    db.prepare('UPDATE usuarios SET activo = 0 WHERE usuario = ?').run(String(a || '').toLowerCase());
    db.prepare('DELETE FROM sesiones WHERE usuario = ?').run(String(a || '').toLowerCase());
    db.prepare('INSERT INTO auditoria (fecha, agente, accion, dni, ip) VALUES (?, ?, ?, ?, ?)').run(ahora(), 'consola', 'Dio de baja al usuario ' + a, '', 'local');
    console.log('Usuario desactivado.');
  } else if (cmd === 'lista') {
    db.prepare('SELECT usuario, nombre, rol, activo, creado FROM usuarios ORDER BY usuario').all()
      .forEach((u) => console.log(`${u.activo ? ' ' : 'x'} ${u.usuario.padEnd(20)} ${u.rol.padEnd(12)} ${u.nombre}`));
    db.prepare('SELECT nombre, activo, creado FROM claves_sistema ORDER BY creado').all()
      .forEach((k) => console.log(`${k.activo ? ' ' : 'x'} [sistema] ${k.nombre}`));
  } else if (cmd === 'clave-sistema') {
    if (!a) { console.error('Uso: clave-sistema "<Nombre del sistema>"'); process.exit(1); }
    const clave = 'rdni_' + crypto.randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO claves_sistema (clave_hash, nombre, activo, creado) VALUES (?, ?, 1, ?)').run(crypto.createHash('sha256').update(clave).digest('hex'), a, ahora());
    db.prepare('INSERT INTO auditoria (fecha, agente, accion, dni, ip) VALUES (?, ?, ?, ?, ?)').run(ahora(), 'consola', 'Creó una clave para el sistema ' + a, '', 'local');
    console.log('Clave de solo lectura para "' + a + '" (se muestra una sola vez, guardala en ese sistema):\n' + clave);
  } else {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*?/, '').replace(/^ \* ?/gm, ''));
  }
  process.exit(0);
})();
