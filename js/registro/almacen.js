/**
 * Registro DNI — dónde se guardan las fichas.
 *
 * Dos modos, con las mismas funciones:
 *  - 'local'    : en este celular / navegador (IndexedDB). Para probar sin servidor. Nada sale del equipo.
 *  - 'servidor' : en el servidor de la institución (carpeta servidor/ del repositorio), con usuario y contraseña.
 *
 * Una persona = una ficha, identificada por su número de DNI. Cada ficha tiene sus fotos (frente y reverso)
 * y sus trámites. Cada alta, cambio, consulta y exportación queda en el registro de actividad.
 */
const Almacen = (() => {
  'use strict';

  const CFG_KEY = 'registro_config';
  const leerCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { return {}; } };
  const guardarCfg = (c) => { try { localStorage.setItem(CFG_KEY, JSON.stringify(c)); } catch (e) { /* nada */ } };
  let cfg = Object.assign({ modo: 'local', url: '', token: '', usuario: null, agente: '' }, leerCfg());

  // ---------- utilidades ----------
  const ahora = () => new Date().toISOString();
  const limpiarDni = (d) => String(d || '').replace(/\D/g, '');
  function nuevoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function numeroTramite() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  async function aBlobJPEG(foto, ladoMax) {
    if (!foto) return null;
    let src = foto;
    if (foto instanceof Blob) src = URL.createObjectURL(foto);
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = src; });
    if (foto instanceof Blob) URL.revokeObjectURL(src);
    const k = Math.min(1, (ladoMax || 2000) / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.86));
  }
  // campos de la ficha que vienen del escáner
  const CAMPOS = ['dni', 'apellido', 'nombre', 'sexo', 'fechaNacimiento', 'nacionalidad', 'lugarNacimiento', 'domicilio', 'cuil',
    'ejemplar', 'tramiteDNI', 'fechaEmision', 'fechaVencimiento', 'versionDNI', 'metodo', 'telefono'];
  function soloCampos(d) {
    const o = {};
    CAMPOS.forEach((k) => { if (d[k] != null && d[k] !== '') o[k] = String(d[k]).trim(); });
    if (o.apellido) o.apellido = o.apellido.toUpperCase();
    if (o.nombre) o.nombre = o.nombre.toUpperCase();
    o.dni = limpiarDni(d.dni);
    return o;
  }

  // =====================================================================
  // MODO LOCAL (IndexedDB)
  // =====================================================================
  let dbp = null;
  function abrir() {
    if (dbp) return dbp;
    dbp = new Promise((ok, no) => {
      const r = indexedDB.open('registro-dni', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('personas', { keyPath: 'dni' });
        const t = db.createObjectStore('tramites', { keyPath: 'id' }); t.createIndex('dni', 'dni');
        db.createObjectStore('auditoria', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('fotos', { keyPath: 'id' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    return dbp;
  }
  const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  async function st(nombre, modo) { const db = await abrir(); return db.transaction(nombre, modo || 'readonly').objectStore(nombre); }

  const local = {
    async auditar(accion, dni) { try { (await st('auditoria', 'readwrite')).add({ accion, dni: dni || '', agente: cfg.agente || 'este equipo', fecha: ahora() }); } catch (e) { /* nada */ } },
    async persona(dni) {
      const p = await req((await st('personas')).get(limpiarDni(dni)));
      if (!p) return null;
      p.tramites = await local.tramites({ dni: p.dni });
      return p;
    },
    async personas(q) {
      const todas = await req((await st('personas')).getAll());
      const tr = await req((await st('tramites')).getAll());
      const cuenta = {}; tr.forEach((t) => { cuenta[t.dni] = (cuenta[t.dni] || 0) + 1; });
      const Q = String(q || '').trim().toUpperCase(), QD = limpiarDni(Q);
      return todas
        .filter((p) => !Q || (QD && p.dni.includes(QD)) || `${p.apellido || ''} ${p.nombre || ''}`.includes(Q))
        .map((p) => Object.assign({}, p, { cantidadTramites: cuenta[p.dni] || 0 }))
        .sort((a, b) => String(b.actualizadoEn).localeCompare(String(a.actualizadoEn)));
    },
    async guardarPersona(datos, fotos) {
      const nuevo = soloCampos(datos);
      const prev = await req((await st('personas')).get(nuevo.dni));
      const p = Object.assign({}, prev || {}, nuevo);
      p.fotos = Object.assign({}, prev && prev.fotos);
      p.fotosAnteriores = (prev && prev.fotosAnteriores) || [];
      for (const lado of ['frente', 'reverso']) {
        if (!fotos || !fotos[lado]) continue;
        const blob = await aBlobJPEG(fotos[lado], 2000);
        if (!blob) continue;
        const id = nuevoId();
        await req((await st('fotos', 'readwrite')).put({ id, blob, tipo: 'image/jpeg' }));
        if (p.fotos[lado]) p.fotosAnteriores.push({ lado, id: p.fotos[lado], hasta: ahora() });
        p.fotos[lado] = id;
      }
      p.creadoEn = (prev && prev.creadoEn) || ahora(); p.creadoPor = (prev && prev.creadoPor) || cfg.agente || 'este equipo';
      p.actualizadoEn = ahora(); p.actualizadoPor = cfg.agente || 'este equipo';
      delete p.tramites; delete p.cantidadTramites;
      await req((await st('personas', 'readwrite')).put(p));
      await local.auditar(prev ? 'Actualizó la ficha' : 'Registró a la persona', p.dni);
      return p;
    },
    async fotoUrl(id) {
      if (!id) return null;
      const f = await req((await st('fotos')).get(id));
      return f ? URL.createObjectURL(f.blob) : null;
    },
    async tramites(filtro) {
      const f = filtro || {};
      const s = await st('tramites');
      const lista = f.dni ? await req(s.index('dni').getAll(limpiarDni(f.dni))) : await req(s.getAll());
      return lista.filter((t) => !f.estado || t.estado === f.estado).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    },
    async nuevoTramite(dni, tipo, observaciones) {
      const t = { id: nuevoId(), numero: numeroTramite(), dni: limpiarDni(dni), tipo, estado: 'Iniciado', observaciones: observaciones || '', fecha: ahora(), agente: cfg.agente || 'este equipo' };
      await req((await st('tramites', 'readwrite')).put(t));
      const p = await req((await st('personas')).get(t.dni));
      if (p) { p.actualizadoEn = ahora(); await req((await st('personas', 'readwrite')).put(p)); }
      await local.auditar('Inició ' + tipo.toLowerCase(), t.dni);
      return t;
    },
    async cambiarEstado(id, estado) {
      const s = await st('tramites', 'readwrite');
      const t = await req(s.get(id));
      if (!t) throw new Error('El trámite no existe');
      t.estado = estado; t.actualizadoEn = ahora(); t.actualizadoPor = cfg.agente || 'este equipo';
      await req((await st('tramites', 'readwrite')).put(t));
      await local.auditar('Cambió el estado a ' + estado, t.dni);
      return t;
    },
    async auditoria() {
      const l = await req((await st('auditoria')).getAll());
      return l.sort((a, b) => b.id - a.id).slice(0, 200);
    },
    async borrarPersona(dni) {
      const d = limpiarDni(dni);
      const p = await req((await st('personas')).get(d));
      if (!p) return;
      const ids = [...Object.values(p.fotos || {}), ...(p.fotosAnteriores || []).map((x) => x.id)];
      for (const id of ids) await req((await st('fotos', 'readwrite')).delete(id));
      for (const t of await local.tramites({ dni: d })) await req((await st('tramites', 'readwrite')).delete(t.id));
      await req((await st('personas', 'readwrite')).delete(d));
      await local.auditar('Borró la ficha', d);
    }
  };

  // =====================================================================
  // MODO SERVIDOR (API de la carpeta servidor/)
  // =====================================================================
  async function api(ruta, opc) {
    const o = opc || {};
    const h = Object.assign({}, o.headers || {});
    if (cfg.token) h.Authorization = 'Bearer ' + cfg.token;
    if (o.json !== undefined) { h['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.json); }
    let r;
    try { r = await fetch(cfg.url.replace(/\/+$/, '') + '/api/v1' + ruta, { method: o.method || 'GET', headers: h, body: o.body }); }
    catch (e) { const err = new Error('No hay conexión con el servidor'); err.code = 'sin_conexion'; throw err; }
    if (r.status === 401) { const err = new Error('La sesión venció: volvé a entrar'); err.code = 'sesion'; throw err; }
    if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) { /* nada */ } const err = new Error(m || ('Error del servidor (' + r.status + ')')); err.code = 'servidor'; throw err; }
    if (o.crudo) return r;
    return r.status === 204 ? null : r.json();
  }
  const fotoCache = new Map();
  const servidor = {
    async persona(dni) { try { return await api('/personas/' + limpiarDni(dni)); } catch (e) { if (/no existe|404/.test(e.message)) return null; throw e; } },
    async personas(q) { return (await api('/personas?q=' + encodeURIComponent(q || ''))).personas; },
    async guardarPersona(datos, fotos) {
      const campos = soloCampos(datos);
      let p = await api('/personas/' + campos.dni, { method: 'PUT', json: campos });
      for (const lado of ['frente', 'reverso']) {
        if (!fotos || !fotos[lado]) continue;
        const blob = await aBlobJPEG(fotos[lado], 2000);
        if (blob) p = await api('/personas/' + campos.dni + '/fotos/' + lado, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' } });
      }
      return p;
    },
    async fotoUrl(id) {
      if (!id) return null;
      if (fotoCache.has(id)) return fotoCache.get(id);
      const r = await api('/fotos/' + encodeURIComponent(id), { crudo: true });
      const u = URL.createObjectURL(await r.blob());
      fotoCache.set(id, u);
      return u;
    },
    async tramites(f) {
      const q = new URLSearchParams(); if (f && f.dni) q.set('dni', limpiarDni(f.dni)); if (f && f.estado) q.set('estado', f.estado);
      return (await api('/tramites?' + q.toString())).tramites;
    },
    async nuevoTramite(dni, tipo, observaciones) { return api('/tramites', { method: 'POST', json: { dni: limpiarDni(dni), tipo, observaciones } }); },
    async cambiarEstado(id, estado) { return api('/tramites/' + encodeURIComponent(id), { method: 'PATCH', json: { estado } }); },
    async auditoria() { return (await api('/auditoria')).auditoria; },
    async borrarPersona(dni) { return api('/personas/' + limpiarDni(dni), { method: 'DELETE' }); },
    async auditar() { /* el servidor registra todo por su cuenta */ }
  };

  const driver = () => (cfg.modo === 'servidor' ? servidor : local);

  return {
    config: () => Object.assign({}, cfg, { token: cfg.token ? '•••' : '' }),
    modo: () => cfg.modo,
    conectado: () => cfg.modo === 'local' || !!cfg.token,
    usarLocal(agente) { cfg = Object.assign(cfg, { modo: 'local', agente: agente || cfg.agente || '' }); guardarCfg(cfg); },
    async entrar(url, usuario, clave) {
      cfg.url = String(url || '').trim().replace(/\/+$/, '');
      cfg.token = '';
      // primero se comprueba que en esa dirección haya un servidor del Registro (si no, el error 405/404 no le dice nada a nadie)
      let salud = null;
      try { const r = await fetch(cfg.url + '/api/v1/salud', { cache: 'no-store' }); if (r.ok) salud = await r.json().catch(() => null); } catch (e) { salud = null; }
      if (!salud || !salud.ok) {
        const enGithub = /github\.io$/i.test(location.hostname);
        const err = new Error(!cfg.url
          ? (enGithub ? 'Esta página está en GitHub, no en el servidor. Escribí la dirección del servidor (por ejemplo, la de Render: https://…onrender.com).' : 'En esta dirección no hay un servidor del Registro. Escribí la dirección del servidor.')
          : 'No se encontró el servidor del Registro en ' + cfg.url + '. Revisá la dirección; si el servidor estaba dormido, esperá un minuto y probá de nuevo.');
        err.code = 'sin_servidor'; throw err;
      }
      const r = await api('/sesion', { method: 'POST', json: { usuario, clave } });
      cfg = Object.assign(cfg, { modo: 'servidor', token: r.token, usuario: r.usuario, agente: (r.usuario && (r.usuario.nombre || r.usuario.usuario)) || usuario });
      guardarCfg(cfg);
      return r.usuario;
    },
    salir() { cfg = Object.assign(cfg, { token: '', usuario: null }); guardarCfg(cfg); },
    rol: () => (cfg.modo === 'local' ? 'responsable' : ((cfg.usuario && cfg.usuario.rol) || 'consulta')),
    persona: (dni) => driver().persona(dni),
    personas: (q) => driver().personas(q),
    guardarPersona: (d, f) => driver().guardarPersona(d, f),
    fotoUrl: (id) => driver().fotoUrl(id),
    tramites: (f) => driver().tramites(f),
    nuevoTramite: (dni, tipo, obs) => driver().nuevoTramite(dni, tipo, obs),
    cambiarEstado: (id, e) => driver().cambiarEstado(id, e),
    auditoria: () => driver().auditoria(),
    borrarPersona: (dni) => driver().borrarPersona(dni),
    auditar: (accion, dni) => driver().auditar(accion, dni),
    // ficha en el formato que reciben los otros sistemas (igual que GET /api/v1/personas/{dni})
    fichaParaSistemas(p) {
      if (!p) return null;
      return {
        dni: p.dni, apellido: p.apellido || null, nombre: p.nombre || null, sexo: p.sexo || null,
        fechaNacimiento: p.fechaNacimiento || null, nacionalidad: p.nacionalidad || null, lugarNacimiento: p.lugarNacimiento || null,
        domicilio: p.domicilio || null, cuil: p.cuil || null, telefono: p.telefono || null,
        documento: { version: p.versionDNI || null, ejemplar: p.ejemplar || null, tramite: p.tramiteDNI || null, emision: p.fechaEmision || null, vencimiento: p.fechaVencimiento || null, leidoDe: p.metodo || 'manual' },
        fotos: { frente: p.fotos && p.fotos.frente ? '/api/v1/fotos/' + p.fotos.frente : null, reverso: p.fotos && p.fotos.reverso ? '/api/v1/fotos/' + p.fotos.reverso : null },
        tramites: (p.tramites || []).map((t) => ({ numero: t.numero, tipo: t.tipo, estado: t.estado, fecha: t.fecha, observaciones: t.observaciones || '' })),
        registro: { creado: p.creadoEn || null, actualizado: p.actualizadoEn || null }
      };
    },
    TIPOS: ['Certificado de antecedentes', 'Certificado de residencia', 'Certificado de convivencia', 'Certificado de carencia de recursos', 'Exposición / denuncia', 'Otro'],
    ESTADOS: ['Iniciado', 'En revisión', 'Listo para entregar', 'Entregado']
  };
})();
