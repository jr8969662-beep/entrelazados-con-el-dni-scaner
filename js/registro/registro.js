/**
 * Registro DNI — pantalla.
 *  1) Panel "Registro" dentro de la ficha que arma el escáner: guarda a la persona con sus fotos y el trámite.
 *  2) Botón "Registro" arriba: personas, trámites, actividad y ajustes (dónde se guarda).
 * El escáner (main.js) no se toca: se lee lo que leyó con window.EscanerDNI.actual().
 */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dniPts = (d) => String(d || '').replace(/\D/g, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fecha = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || '—'); };
  const fechaHora = (iso) => { try { const d = new Date(iso); if (isNaN(d)) return '—'; return d.toLocaleDateString('es-AR') + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); } catch (e) { return '—'; } };
  const edad = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); if (!m) return null; const h = new Date(); let e = h.getFullYear() - +m[1]; if (h.getMonth() + 1 < +m[2] || (h.getMonth() + 1 === +m[2] && h.getDate() < +m[3])) e--; return e; };
  const claseEstado = (e) => 'reg-est reg-est-' + String(e || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '-');
  function toast(t, tipo) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.className = 'toast ' + (tipo === 'error' ? 'error' : 'success'); el.textContent = t; el.hidden = false;
    setTimeout(() => el.classList.add('visible'), 10);
    clearTimeout(toast.t); toast.t = setTimeout(() => { el.classList.remove('visible'); setTimeout(() => { el.hidden = true; }, 300); }, 2800);
  }
  const puedeCargar = () => Almacen.rol() !== 'consulta' && Almacen.rol() !== 'sistema';

  // DNI viejo o nuevo: lo que dijo el escáner; si no, por cómo se leyó; si no, el tipo elegido arriba
  function versionDe(d) {
    if (d.versionDNI === 'viejo' || d.versionDNI === 'nuevo') return d.versionDNI;
    if (String(d.metodo || '').toLowerCase() === 'pdf417') return 'viejo';
    if (d.formatoQR === 'nuevo' || d.esNuevoDNI === true) return 'nuevo';
    try { const t = localStorage.getItem('tipo_dni'); if (t === 'viejo' || t === 'nuevo') return t; } catch (e) { /* nada */ }
    return null;
  }
  const chip = (v) => v === 'viejo' ? '<span class="reg-chip viejo">DNI viejo</span>' : v === 'nuevo' ? '<span class="reg-chip nuevo">DNI nuevo</span>' : '';
  // ---------- lo que leyó el escáner, en campos del registro ----------
  function lecturaActual() {
    const a = window.EscanerDNI && window.EscanerDNI.actual();
    if (!a || !a.datos) return null;
    const d = a.datos;
    const dni = String(d.dni || d.numero || '').replace(/\D/g, '');
    if (!/^\d{7,8}$/.test(dni) || (d.pais && d.pais !== 'ARG')) return null;
    return {
      datos: {
        dni, apellido: d.apellido, nombre: d.nombre, sexo: d.sexo, fechaNacimiento: d.fechaNacimiento, nacionalidad: d.nacionalidad,
        lugarNacimiento: d.lugarNacimiento, domicilio: d.domicilio, cuil: d.cuil, ejemplar: d.ejemplar, tramiteDNI: d.tramite,
        fechaEmision: d.fechaEmision, fechaVencimiento: d.fechaVencimiento, versionDNI: versionDe(d), metodo: d.metodo
      },
      fotos: a.fotos || {}
    };
  }

  // =====================================================================
  // 1) PANEL EN LA FICHA DEL ESCÁNER
  // =====================================================================
  const extras = { frente: null, reverso: null };   // fotos agregadas a mano en el panel
  let dniPanel = null, guardadoDni = null;

  function armarPanel() {
    const acciones = document.querySelector('#resultado .result-actions');
    if (!acciones || $('#registro-panel')) return;
    const div = document.createElement('div');
    div.className = 'group registro-panel'; div.id = 'registro-panel';
    div.innerHTML = `
      <div class="group-title"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg><span>Guardar en el Registro</span></div>
      <p class="reg-donde" id="reg-donde"></p>
      <div class="reg-aviso" id="reg-existe" hidden></div>
      <div class="reg-fotos">
        <label class="reg-foto" id="reg-foto-frente"><span class="reg-foto-estado"></span><input type="file" accept="image/*" capture="environment" data-lado="frente"></label>
        <label class="reg-foto" id="reg-foto-reverso"><span class="reg-foto-estado"></span><input type="file" accept="image/*" capture="environment" data-lado="reverso"></label>
      </div>
      <div class="reg-campos">
        <label class="reg-campo"><span>Trámite que inicia</span><select id="reg-tipo"></select></label>
        <label class="reg-campo"><span>Teléfono de contacto</span><input id="reg-tel" inputmode="tel" autocomplete="off" placeholder="Opcional"></label>
        <label class="reg-campo reg-ancho"><span>Observaciones</span><input id="reg-obs" autocomplete="off" placeholder="Motivo, destino del certificado…"></label>
      </div>
      <label class="reg-check"><input type="checkbox" id="reg-consent"><span>La persona fue informada de que sus datos y la foto de su DNI se guardan para este trámite (Ley 25.326).</span></label>
      <p class="reg-error" id="reg-error" hidden></p>
      <div class="reg-botones">
        <button type="button" class="btn btn-primary" id="reg-guardar">Guardar en el Registro</button>
        <button type="button" class="btn btn-secondary btn-sm" id="reg-ver" hidden>Ver ficha</button>
        <button type="button" class="btn btn-secondary btn-sm" id="reg-otra" hidden>Escanear otra persona</button>
      </div>`;
    acciones.parentNode.insertBefore(div, acciones);
    $('#reg-tipo').innerHTML = Almacen.TIPOS.map((t) => `<option>${esc(t)}</option>`).join('') + '<option value="">Sin trámite (solo registrar)</option>';
    div.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      extras[ev.target.dataset.lado] = f;
      pintarFotosPanel();
    }));
    $('#reg-guardar').addEventListener('click', guardarDesdePanel);
    $('#reg-ver').addEventListener('click', () => { if (guardadoDni) abrirRegistro(guardadoDni); });
    $('#reg-otra').addEventListener('click', () => { window.EscanerDNI && window.EscanerDNI.nuevaLectura(); });
  }

  function pintarDonde() {
    const el = $('#reg-donde'); if (!el) return;
    const c = Almacen.config();
    el.innerHTML = c.modo === 'servidor'
      ? `Se guarda en el <b>servidor</b> como <b>${esc(c.agente || 'usuario')}</b>.`
      : `Se guarda <b>en este equipo</b> (modo de prueba). <button type="button" class="reg-link" data-abrir="ajustes">Cambiar</button>`;
    const b = el.querySelector('[data-abrir]'); if (b) b.addEventListener('click', () => abrirRegistro(null, 'ajustes'));
  }

  function pintarFotosPanel() {
    const l = lecturaActual();
    ['frente', 'reverso'].forEach((lado) => {
      const tiene = !!(extras[lado] || (l && l.fotos[lado]));
      const el = $('#reg-foto-' + lado); if (!el) return;
      el.classList.toggle('ok', tiene);
      el.querySelector('.reg-foto-estado').textContent = tiene ? `Foto del ${lado} ✓ · cambiar` : `Falta la foto del ${lado} · sacar`;
    });
  }

  async function actualizarPanel() {
    armarPanel();
    const panel = $('#registro-panel'); if (!panel) return;
    const l = lecturaActual();
    panel.hidden = !l;
    if (!l) return;
    if (l.datos.dni !== dniPanel) {   // otra persona: el panel arranca de cero
      dniPanel = l.datos.dni; guardadoDni = null; extras.frente = null; extras.reverso = null;
      $('#reg-consent').checked = false; $('#reg-obs').value = ''; $('#reg-tel').value = '';
      $('#reg-guardar').hidden = false; $('#reg-ver').hidden = true; $('#reg-otra').hidden = true; $('#reg-error').hidden = true;
    }
    pintarDonde(); pintarFotosPanel();
    $('#reg-guardar').disabled = !puedeCargar() || !Almacen.conectado();
    const aviso = $('#reg-existe');
    try {
      const p = await Almacen.persona(l.datos.dni);
      if (lecturaActual() && lecturaActual().datos.dni !== l.datos.dni) return;
      if (p) {
        const n = (p.tramites || []).length;
        aviso.className = 'reg-aviso info';
        aviso.innerHTML = `<b>Ya está registrada.</b> ${n} trámite${n === 1 ? '' : 's'} · última vez ${esc(fechaHora(p.actualizadoEn))}. Se actualiza su ficha y el trámite nuevo se suma.`;
        if (p.telefono && !$('#reg-tel').value) $('#reg-tel').value = p.telefono;
      } else { aviso.className = 'reg-aviso'; aviso.innerHTML = 'Persona nueva: todavía no está en el Registro.'; }
      aviso.hidden = false;
    } catch (e) {
      aviso.className = 'reg-aviso error'; aviso.textContent = e.message || 'No se pudo consultar el Registro.'; aviso.hidden = false;
    }
    if (!Almacen.conectado()) { aviso.className = 'reg-aviso error'; aviso.innerHTML = 'No hay sesión en el servidor. <button type="button" class="reg-link" id="reg-a-ajustes">Entrar</button>'; aviso.hidden = false; $('#reg-a-ajustes').addEventListener('click', () => abrirRegistro(null, 'ajustes')); }
  }

  async function guardarDesdePanel() {
    const err = $('#reg-error'); err.hidden = true;
    const falla = (t) => { err.textContent = t; err.hidden = false; };
    const l = lecturaActual();
    if (!l) return falla('No hay un DNI argentino leído.');
    if (!l.datos.apellido || !l.datos.nombre) return falla('Faltan el apellido o el nombre: escaneá el frente o el reverso del DNI.');
    if (!$('#reg-consent').checked) return falla('Marcá que la persona fue informada del uso de sus datos.');
    const btn = $('#reg-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      const datos = Object.assign({}, l.datos, { telefono: $('#reg-tel').value.trim() });
      const fotos = { frente: extras.frente || l.fotos.frente || null, reverso: extras.reverso || l.fotos.reverso || null };
      await Almacen.guardarPersona(datos, fotos);
      const tipo = $('#reg-tipo').value;
      if (tipo) await Almacen.nuevoTramite(datos.dni, tipo, $('#reg-obs').value.trim());
      guardadoDni = datos.dni;
      toast('✓ Guardado en el Registro' + (tipo ? ' · ' + tipo : ''), 'success');
      btn.hidden = true; $('#reg-ver').hidden = false; $('#reg-otra').hidden = false;
      const aviso = $('#reg-existe'); aviso.className = 'reg-aviso ok'; aviso.innerHTML = `<b>Guardado.</b> ${esc(datos.apellido)}, ${esc(datos.nombre)} quedó en el Registro${tipo ? ' con el trámite ' + esc(tipo.toLowerCase()) : ''}.`; aviso.hidden = false;
    } catch (e) {
      falla(e.message || 'No se pudo guardar. Probá de nuevo.');
    } finally { btn.disabled = false; btn.textContent = 'Guardar en el Registro'; }
  }

  window.addEventListener('dni:leido', actualizarPanel);
  window.addEventListener('dni:fotos', pintarFotosPanel);

  // =====================================================================
  // 2) PANTALLA DEL REGISTRO
  // =====================================================================
  let vista = 'personas', fichaDni = null;
  const urlsFotos = [];

  function armarModal() {
    if ($('#modal-registro')) return;
    const m = document.createElement('div');
    m.className = 'modal reg-modal'; m.id = 'modal-registro'; m.hidden = true;
    m.innerHTML = `
      <div class="modal-content reg-modal-content">
        <div class="modal-header">
          <h2>Registro</h2>
          <button type="button" class="icon-btn-close" id="reg-cerrar" aria-label="Cerrar">✕</button>
        </div>
        <nav class="reg-tabs" role="tablist">
          <button type="button" role="tab" data-v="personas">Personas</button>
          <button type="button" role="tab" data-v="tramites">Trámites</button>
          <button type="button" role="tab" data-v="actividad">Actividad</button>
          <button type="button" role="tab" data-v="sistemas">Otros sistemas</button>
          <button type="button" role="tab" data-v="ajustes">Ajustes</button>
        </nav>
        <div class="modal-body reg-cuerpo" id="reg-cuerpo"></div>
      </div>`;
    document.body.appendChild(m);
    $('#reg-cerrar').addEventListener('click', cerrarRegistro);
    m.addEventListener('click', (ev) => { if (ev.target === m) cerrarRegistro(); });
    m.querySelectorAll('.reg-tabs button').forEach((b) => b.addEventListener('click', () => { fichaDni = null; vista = b.dataset.v; pintar(); }));
    $('#reg-cuerpo').addEventListener('click', clicCuerpo);
    $('#reg-cuerpo').addEventListener('change', cambioCuerpo);
    $('#reg-cuerpo').addEventListener('submit', enviarCuerpo);
    $('#reg-cuerpo').addEventListener('input', (ev) => { if (ev.target.id === 'reg-buscar') { clearTimeout(armarModal.t); armarModal.t = setTimeout(pintarListaPersonas, 200); } });
  }
  function abrirRegistro(dni, v) {
    armarModal();
    vista = v || 'personas'; fichaDni = dni || null;
    $('#modal-registro').hidden = false; document.body.style.overflow = 'hidden';
    pintar();
  }
  function cerrarRegistro() {
    $('#modal-registro').hidden = true; document.body.style.overflow = '';
    urlsFotos.splice(0).forEach((u) => { if (Almacen.modo() === 'local') URL.revokeObjectURL(u); });
    actualizarPanel(); marcarNav();
  }

  function pintar() {
    marcarNav();
    document.querySelectorAll('.reg-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === vista)));
    const c = $('#reg-cuerpo');
    if (vista !== 'ajustes' && !Almacen.conectado()) { vista = 'ajustes'; return pintar(); }
    if (fichaDni) return pintarFicha();
    if (vista === 'personas') {
      c.innerHTML = `<div class="reg-pad"><input type="search" class="reg-buscar" id="reg-buscar" placeholder="Buscar por DNI, apellido o nombre" autocomplete="off"></div><div id="reg-lista" class="reg-lista"><p class="empty-state">Cargando…</p></div>`;
      pintarListaPersonas();
    } else if (vista === 'tramites') pintarTramites();
    else if (vista === 'actividad') pintarActividad();
    else if (vista === 'sistemas') pintarSistemas();
    else pintarAjustes();
  }

  async function pintarListaPersonas() {
    const el = $('#reg-lista'); if (!el) return;
    const q = ($('#reg-buscar') || {}).value || '';
    try {
      const lista = await Almacen.personas(q);
      if (!lista.length) { el.innerHTML = `<p class="empty-state">${q ? 'Nadie coincide con la búsqueda. Probá con el DNI sin puntos.' : 'Todavía no hay personas en el Registro. Escaneá un DNI y tocá "Guardar en el Registro".'}</p>`; return; }
      el.innerHTML = lista.map((p) => `
        <button type="button" class="reg-item" data-dni="${esc(p.dni)}">
          <span class="reg-item-dni">${esc(dniPts(p.dni))}</span>
          <span class="reg-item-nom">${esc(p.apellido || '')}, ${esc(p.nombre || '')}<small>${p.cantidadTramites || 0} trámite${p.cantidadTramites === 1 ? '' : 's'} · ${esc(fechaHora(p.actualizadoEn))}</small></span>
          ${chip(p.versionDNI)}
        </button>`).join('');
    } catch (e) { el.innerHTML = `<p class="empty-state">${esc(e.message)}</p>`; }
  }

  async function pintarFicha() {
    const c = $('#reg-cuerpo');
    c.innerHTML = '<p class="empty-state">Cargando ficha…</p>';
    let p;
    try { p = await Almacen.persona(fichaDni); } catch (e) { c.innerHTML = `<p class="empty-state">${esc(e.message)}</p>`; return; }
    if (!p) { c.innerHTML = '<div class="reg-pad"><button type="button" class="btn btn-secondary btn-sm" data-acc="volver">← Personas</button></div><p class="empty-state">Esta persona no está en el Registro.</p>'; return; }
    Almacen.auditar('Consultó la ficha', p.dni);
    const ed = edad(p.fechaNacimiento);
    const dato = (t, v, mono) => `<div class="reg-dato"><span>${t}</span><b${mono ? ' class="mono"' : ''}>${v ? esc(v) : '—'}</b></div>`;
    const trs = p.tramites || [];
    c.innerHTML = `
      <div class="reg-pad reg-ficha">
        <div class="reg-fila"><button type="button" class="btn btn-secondary btn-sm" data-acc="volver">← Personas</button>
          <span class="reg-spacer"></span>
          <button type="button" class="btn btn-secondary btn-sm" data-acc="json">Datos para otros sistemas</button></div>
        <div class="reg-ident">
          <div class="reg-ident-dni">${esc(dniPts(p.dni))}</div>
          <div class="reg-ident-nom">${esc(p.apellido || '')}, ${esc(p.nombre || '')}</div>
          <div class="reg-ident-sub">${ed != null ? ed + ' años' : ''}${ed != null && p.versionDNI ? ' · ' : ''}${chip(p.versionDNI)}</div>
        </div>
        <div class="reg-fotos-ficha">
          <figure data-foto="${esc((p.fotos || {}).frente || '')}"><div class="reg-sin-foto">Sin foto del frente</div><figcaption>Frente</figcaption></figure>
          <figure data-foto="${esc((p.fotos || {}).reverso || '')}"><div class="reg-sin-foto">Sin foto del reverso</div><figcaption>Reverso</figcaption></figure>
        </div>
        <div class="reg-datos">
          ${dato('Sexo', p.sexo)}${dato('Nacimiento', fecha(p.fechaNacimiento))}${dato('Nacionalidad', p.nacionalidad)}
          ${dato('Lugar de nacimiento', p.lugarNacimiento)}${dato('CUIL', p.cuil, true)}${dato('Teléfono', p.telefono)}
          ${dato('Ejemplar', p.ejemplar, true)}${dato('N° de trámite del DNI', p.tramiteDNI, true)}${dato('Emisión', fecha(p.fechaEmision))}
          ${dato('Vencimiento', fecha(p.fechaVencimiento))}
          <div class="reg-dato reg-ancho"><span>Domicilio</span><b>${p.domicilio ? esc(p.domicilio) : '—'}</b></div>
        </div>
        <p class="reg-nota">Registrada el ${esc(fechaHora(p.creadoEn))} por ${esc(p.creadoPor || '—')} · actualizada el ${esc(fechaHora(p.actualizadoEn))} por ${esc(p.actualizadoPor || '—')}${(p.fotosAnteriores || []).length ? ' · ' + p.fotosAnteriores.length + ' foto(s) anteriores guardadas' : ''}</p>
        <h3 class="reg-h3">Trámites (${trs.length})</h3>
        <div class="reg-tramites">${trs.length ? trs.map((t) => `
          <div class="reg-tramite">
            <div><b>${esc(t.tipo)}</b> <span class="mono reg-sub">${esc(t.numero || '')}</span><br><span class="reg-sub">${esc(fechaHora(t.fecha))} · ${esc(t.agente || '—')}${t.observaciones ? ' · ' + esc(t.observaciones) : ''}</span></div>
            ${puedeCargar() ? `<select data-estado="${esc(t.id)}" aria-label="Estado">${Almacen.ESTADOS.map((e) => `<option${e === t.estado ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select>` : `<span class="${claseEstado(t.estado)}">${esc(t.estado)}</span>`}
          </div>`).join('') : '<p class="reg-sub">Sin trámites todavía.</p>'}</div>
        ${puedeCargar() ? `<form class="reg-nuevo" data-form="tramite">
          <label class="reg-campo"><span>Nuevo trámite</span><select id="reg-nt-tipo">${Almacen.TIPOS.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
          <label class="reg-campo"><span>Observaciones</span><input id="reg-nt-obs" autocomplete="off"></label>
          <button type="submit" class="btn btn-primary btn-sm">Iniciar trámite</button>
        </form>` : ''}
        ${Almacen.rol() === 'responsable' ? `<div class="reg-borrar"><button type="button" class="btn btn-secondary btn-sm" data-acc="borrar">Borrar esta ficha</button><span id="reg-conf-borrar" hidden>¿Seguro? Se borran sus datos, fotos y trámites. <button type="button" class="btn btn-sm reg-btn-peligro" data-acc="borrar-si">Sí, borrar</button></span></div>` : ''}
        <pre class="reg-json" id="reg-json" hidden></pre>
      </div>`;
    c.dataset.ficha = JSON.stringify(Almacen.fichaParaSistemas(p));
    c.querySelectorAll('[data-foto]').forEach(async (fig) => {
      const id = fig.dataset.foto; if (!id) return;
      try {
        const u = await Almacen.fotoUrl(id); if (!u) return;
        urlsFotos.push(u);
        fig.querySelector('.reg-sin-foto').outerHTML = `<button type="button" class="reg-foto-btn" data-ver="${esc(u)}"><img src="${esc(u)}" alt="${esc(fig.querySelector('figcaption').textContent)} del DNI"></button>`;
      } catch (e) { /* queda "sin foto" */ }
    });
  }

  async function pintarTramites() {
    const c = $('#reg-cuerpo');
    c.innerHTML = `<div class="reg-pad reg-fila"><label class="reg-sub" for="reg-filtro">Estado</label><select id="reg-filtro"><option value="">Todos</option>${Almacen.ESTADOS.map((e) => `<option>${esc(e)}</option>`).join('')}</select></div><div id="reg-tabla"><p class="empty-state">Cargando…</p></div>`;
    pintarTablaTramites();
  }
  async function pintarTablaTramites() {
    const el = $('#reg-tabla'); if (!el) return;
    try {
      const [ts, ps] = await Promise.all([Almacen.tramites({ estado: ($('#reg-filtro') || {}).value || '' }), Almacen.personas('')]);
      const nom = {}; ps.forEach((p) => { nom[p.dni] = `${p.apellido || ''}, ${p.nombre || ''}`; });
      if (!ts.length) { el.innerHTML = '<p class="empty-state">No hay trámites.</p>'; return; }
      el.innerHTML = `<div class="reg-tabla-c"><table class="reg-tabla"><thead><tr><th>Fecha</th><th>Trámite</th><th>Persona</th><th>Estado</th></tr></thead><tbody>${ts.map((t) => `
        <tr><td>${esc(fechaHora(t.fecha))}<br><span class="mono reg-sub">${esc(t.numero || '')}</span></td><td>${esc(t.tipo)}</td>
        <td><button type="button" class="reg-link" data-dni="${esc(t.dni)}">${esc(nom[t.dni] || 'DNI')}</button><br><span class="mono reg-sub">${esc(dniPts(t.dni))}</span></td>
        <td><span class="${claseEstado(t.estado)}">${esc(t.estado)}</span></td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) { el.innerHTML = `<p class="empty-state">${esc(e.message)}</p>`; }
  }

  async function pintarActividad() {
    const c = $('#reg-cuerpo');
    if (Almacen.rol() !== 'responsable') { c.innerHTML = '<p class="empty-state">El registro de actividad lo ve solo el responsable.</p>'; return; }
    c.innerHTML = '<p class="empty-state">Cargando…</p>';
    try {
      const l = await Almacen.auditoria();
      c.innerHTML = l.length ? `<div class="reg-tabla-c"><table class="reg-tabla"><thead><tr><th>Fecha y hora</th><th>Acción</th><th>DNI</th><th>Agente</th></tr></thead><tbody>${l.map((a) => `<tr><td>${esc(fechaHora(a.fecha))}</td><td>${esc(a.accion)}</td><td class="mono">${esc(dniPts(a.dni))}</td><td>${esc(a.agente || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-state">Sin actividad todavía.</p>';
    } catch (e) { c.innerHTML = `<p class="empty-state">${esc(e.message)}</p>`; }
  }

  async function pintarSistemas() {
    const c = $('#reg-cuerpo');
    let ejemplo = 'Todavía no hay personas en el Registro.';
    try { const l = await Almacen.personas(''); if (l.length) ejemplo = JSON.stringify(Almacen.fichaParaSistemas(await Almacen.persona(l[0].dni)), null, 2); } catch (e) { /* nada */ }
    c.innerHTML = `<div class="reg-pad reg-texto">
      <p>Cada persona está una sola vez, identificada por su DNI, con sus datos, las fotos del documento y todos sus trámites. Con el servidor de la carpeta <span class="mono">servidor/</span>, otro sistema autorizado pide la ficha así:</p>
      <pre class="reg-json">GET https://&lt;servidor&gt;/api/v1/personas/{dni}
Authorization: Bearer &lt;clave del sistema&gt;</pre>
      <p>Y recibe esto (ejemplo con la primera persona del Registro):</p>
      <pre class="reg-json">${esc(ejemplo)}</pre>
      <p class="reg-sub">Las fotos se piden aparte, con la misma clave, en la dirección que trae cada una. Cada consulta queda en el registro de actividad.</p>
    </div>`;
  }

  function pintarAjustes() {
    const c = $('#reg-cuerpo'), cfg = Almacen.config();
    c.innerHTML = `<div class="reg-pad reg-texto">
      <h3 class="reg-h3">Dónde se guardan las fichas</h3>
      <p>Ahora: <b>${cfg.modo === 'servidor' ? 'en el servidor ' + esc(cfg.url) + (Almacen.conectado() ? ', como ' + esc(cfg.agente) + ' (' + esc(Almacen.rol()) + ')' : ', sin sesión') : 'en este equipo (modo de prueba)'}</b>.</p>
      <form class="reg-ajuste" data-form="local">
        <h4>En este equipo (prueba)</h4>
        <p class="reg-sub">Las fichas quedan solo en este celular o navegador. Sirve para probar; no lo uses con datos reales de otras personas.</p>
        <label class="reg-campo"><span>Tu nombre (queda en cada carga)</span><input id="reg-agente" value="${esc(cfg.modo === 'local' ? cfg.agente : '')}" autocomplete="name"></label>
        <button type="submit" class="btn btn-secondary btn-sm">Usar este equipo</button>
      </form>
      <form class="reg-ajuste" data-form="servidor">
        <h4>Servidor de la institución</h4>
        <p class="reg-sub">Con el servidor instalado (carpeta <span class="mono">servidor/</span> del proyecto), las fichas quedan en un solo lugar para todos los agentes.</p>
        <label class="reg-campo"><span>Dirección del servidor</span><input id="reg-url" type="url" value="${esc(cfg.url)}" placeholder="https://registro.ejemplo.gob.ar" autocomplete="url"></label>
        <label class="reg-campo"><span>Usuario</span><input id="reg-usuario" autocomplete="username"></label>
        <label class="reg-campo"><span>Contraseña</span><input id="reg-clave" type="password" autocomplete="current-password"></label>
        <div class="reg-fila"><button type="submit" class="btn btn-primary btn-sm">Entrar</button>${cfg.modo === 'servidor' && Almacen.conectado() ? '<button type="button" class="btn btn-secondary btn-sm" data-acc="salir">Cerrar sesión</button>' : ''}</div>
        <p class="reg-error" id="reg-err-srv" hidden></p>
      </form>
    </div>`;
  }

  async function clicCuerpo(ev) {
    const ver = ev.target.closest('[data-ver]');
    if (ver) { if (window.VisorFoto && VisorFoto.abrir) { try { VisorFoto.abrir(ver.dataset.ver, 'DNI_' + (fichaDni || 'registro')); return; } catch (e) { /* sigue */ } } window.open(ver.dataset.ver, '_blank'); return; }
    const d = ev.target.closest('[data-dni]');
    if (d) { fichaDni = d.dataset.dni; pintar(); return; }
    const b = ev.target.closest('[data-acc]'); if (!b) return;
    const acc = b.dataset.acc;
    if (acc === 'volver') { fichaDni = null; vista = 'personas'; pintar(); }
    if (acc === 'json') { const pre = $('#reg-json'); pre.textContent = JSON.stringify(JSON.parse($('#reg-cuerpo').dataset.ficha || 'null'), null, 2); pre.hidden = !pre.hidden; }
    if (acc === 'borrar') $('#reg-conf-borrar').hidden = false;
    if (acc === 'borrar-si') { try { await Almacen.borrarPersona(fichaDni); toast('Ficha borrada', 'success'); fichaDni = null; vista = 'personas'; pintar(); } catch (e) { toast(e.message, 'error'); } }
    if (acc === 'salir') { Almacen.salir(); toast('Sesión cerrada', 'success'); pintar(); }
  }
  async function cambioCuerpo(ev) {
    if (ev.target.id === 'reg-filtro') return pintarTablaTramites();
    const s = ev.target.closest('[data-estado]'); if (!s) return;
    try { await Almacen.cambiarEstado(s.dataset.estado, s.value); toast('Estado: ' + s.value, 'success'); } catch (e) { toast(e.message, 'error'); }
  }
  async function enviarCuerpo(ev) {
    const f = ev.target.closest('[data-form]'); if (!f) return;
    ev.preventDefault();
    if (f.dataset.form === 'tramite') {
      try { await Almacen.nuevoTramite(fichaDni, $('#reg-nt-tipo').value, $('#reg-nt-obs').value.trim()); toast('Trámite iniciado', 'success'); pintarFicha(); } catch (e) { toast(e.message, 'error'); }
    }
    if (f.dataset.form === 'local') { Almacen.usarLocal($('#reg-agente').value.trim()); toast('Se guarda en este equipo', 'success'); pintar(); actualizarPanel(); }
    if (f.dataset.form === 'servidor') {
      const er = $('#reg-err-srv'); er.hidden = true;
      try { const u = await Almacen.entrar($('#reg-url').value, $('#reg-usuario').value.trim(), $('#reg-clave').value); toast('Sesión iniciada: ' + (u.nombre || u.usuario), 'success'); vista = 'personas'; pintar(); actualizarPanel(); }
      catch (e) { er.textContent = e.message; er.hidden = false; }
    }
  }

  // ---------- botón "Registro" en la barra de arriba ----------
  function armarBoton() {
    const acciones = document.querySelector('.header-actions');
    if (!acciones || $('#btn-registro')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'icon-action reg-btn-barra'; b.id = 'btn-registro'; b.title = 'Registro de personas';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg><span>Registro</span>';
    b.addEventListener('click', () => abrirRegistro());
    acciones.insertBefore(b, acciones.firstChild);
  }


  // ---------- barra de navegación de abajo: Escanear · Personas · Trámites · Ajustes ----------
  const ICON = {
    escanear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><rect x="7" y="8" width="10" height="8" rx="1.5"/></svg>',
    personas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    tramites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M9 12l2 2 4-4M9 17h6"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  };
  function armarNav() {
    if ($('#reg-nav')) return;
    const n = document.createElement('nav');
    n.className = 'reg-nav'; n.id = 'reg-nav'; n.setAttribute('aria-label', 'Secciones');
    n.innerHTML = [['escanear', 'Escanear'], ['personas', 'Personas'], ['tramites', 'Trámites'], ['ajustes', 'Ajustes']]
      .map(([k, t]) => `<button type="button" data-nav="${k}">${ICON[k]}<span>${t}</span></button>`).join('');
    document.body.appendChild(n); document.body.classList.add('con-nav');
    n.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-nav]'); if (!b) return;
      const k = b.dataset.nav;
      if (k === 'escanear') { const m = $('#modal-registro'); if (m && !m.hidden) cerrarRegistro(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      else abrirRegistro(null, k);
      marcarNav();
    });
    marcarNav();
  }
  function marcarNav() {
    const m = $('#modal-registro'), abierto = m && !m.hidden;
    const actual = !abierto ? 'escanear' : (vista === 'tramites' ? 'tramites' : vista === 'ajustes' ? 'ajustes' : 'personas');
    document.querySelectorAll('#reg-nav [data-nav]').forEach((b) => { if (b.dataset.nav === actual) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  }
  // el Registro es para el DNI argentino: si quedó elegido otro país, se vuelve a Argentina
  function asegurarArgentina() {
    try { if ((localStorage.getItem('pais_escaner') || 'arg') !== 'arg') { const c = document.querySelector('.country-chip[data-country="arg"]'); if (c) c.click(); } } catch (e) { /* nada */ }
    const c = document.querySelector('.country-chip[data-country="arg"]');
    if (c && !c.classList.contains('active')) c.click();
  }

  function iniciar() { asegurarArgentina(); armarBoton(); armarNav(); armarPanel(); actualizarPanel(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
  window.RegistroDNI = { abrir: abrirRegistro, actualizar: actualizarPanel };
})();
