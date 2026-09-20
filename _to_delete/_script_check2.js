
// ══════════════════════════════════════════════════════════
//  MANEJADOR GLOBAL DE ERRORES
// ══════════════════════════════════════════════════════════
window.addEventListener("error", e => {
  console.error("Error global JS:", e.message, e.filename, e.lineno);
});
window.addEventListener("unhandledrejection", e => {
  console.error("Promise sin manejar:", e.reason);
});

// ══════════════════════════════════════════════════════════
//  MODO OSCURO
// ══════════════════════════════════════════════════════════
function aplicarModoOscuro(oscuro) {
  document.body.classList.toggle("oscuro", oscuro);
  const btn = document.getElementById("modoToggleTrack");
  if (btn) {
    btn.setAttribute("aria-checked", oscuro ? "true" : "false");
    btn.title = oscuro ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
    const ico = btn.querySelector(".modo-ico");
    if (ico) ico.textContent = oscuro ? "☀️" : "🌙";
  }
  try { localStorage.setItem("symes_modo_oscuro", oscuro ? "1" : "0"); } catch(e) {}
}

function toggleModoOscuro() {
  const estaOscuro = document.body.classList.contains("oscuro");
  aplicarModoOscuro(!estaOscuro);
}

// Aplicar modo guardado al cargar
(function() {
  const guardado = localStorage.getItem("symes_modo_oscuro");
  // Si tiene preferencia guardada, usarla; si no, respetar preferencia del sistema
  if (guardado === "1") {
    aplicarModoOscuro(true);
  } else if (guardado === null && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    aplicarModoOscuro(true);
  }
})();

// ══════════════════════════════════════════════════════════
//  CONSTANTES
// ══════════════════════════════════════════════════════════
const API_URL    = "https://square-glade-7ba9.arevaloojedabrandonsebastian.workers.dev";
// SEGURIDAD: El PIN admin ya NO está en el frontend.
// La validación de admin se realiza 100% en el backend (Worker).
// negocio.esAdmin se determina por la respuesta del servidor en login.
const ADMIN_NAME = "brandon";

const CONFIG_DEFECTO = {
  precioGrasa:11500, divisorGrasa:1000,
  porcentajeMixtos:25, porcentajeAzules:35,
  seguridadQ1:0, seguridadQ2:0,
  reglasMixtos:[
    {original:40000,rebajado:40000},{original:45000,rebajado:40000},
    {original:50000,rebajado:45000},{original:55000,rebajado:45000},
    {original:60000,rebajado:50000},{original:70000,rebajado:56000}
  ]
};

let cuentas   = JSON.parse(localStorage.getItem("symes_cuentas")) || {};
let cuentaAct = localStorage.getItem("symes_cuenta_actual") || null;
let negocio   = cuentaAct ? cuentas[cuentaAct] : null;
let ultimoCalc = null;
let mixtosAct  = [];
let azulesAct  = [];
let pestaniasAbiertas = [];
let pestaniaActiva    = null;
let resultadosQuincenales = []; // para guardar después

// ══════════════════════════════════════════════════════════
//  MEMORIA AUTOCOMPLETE GLOBAL
// ══════════════════════════════════════════════════════════
// ══ MEMORIA CON FRECUENCIA ══
// Formato nuevo: objeto {valor: conteo}
// Retrocompatible con arrays anteriores
function _memKey(clave){ return "symes_mem_"+(cuentaAct||"_global")+"_"+clave; }
function semillarMemoria(){
  const limpiarYSembrar=(clave,vals,excluir=[])=>{
    const raw=localStorage.getItem(_memKey(clave)); let freq={};
    if(raw){ try{ const p=JSON.parse(raw); if(!Array.isArray(p)) freq=p; else p.forEach((v,i)=>{ freq[v]=p.length-i; }); }catch(e){} }
    // Eliminar cortas y valores de otras categorias
    Object.keys(freq).forEach(k=>{ if(k.trim().length<3||excluir.includes(k.toLowerCase())) delete freq[k]; });
    // Normalizar capitalizacion: fusionar variantes del mismo predefinido
    const newFreq={}; const valsLow=vals.map(v=>v.toLowerCase());
    Object.entries(freq).forEach(([k,v])=>{
      const idx=valsLow.indexOf(k.toLowerCase());
      const normKey=idx>=0?vals[idx]:k.charAt(0).toUpperCase()+k.slice(1);
      newFreq[normKey]=(newFreq[normKey]||0)+v;
    });
    freq=newFreq;
    // Sembrar predefinidos con prioridad alta
    vals.forEach((v,i)=>{ if(!freq[v]||freq[v]<=2) freq[v]=vals.length-i+10; });
    localStorage.setItem(_memKey(clave),JSON.stringify(freq));
  };
  limpiarYSembrar("tipos_vehiculo",TIPOS_VEHICULO,["mixto","azul","sintetico"]);
  limpiarYSembrar("descripciones",DESCRIPCIONES,["mixto","azul","sintetico","carro","mula","camion","volqueta","moto"]);
  limpiarYSembrar("observaciones",["Efectivo","Transferencia",...(negocio?.creditos?.empresas||[])],[]);
  // Limpiar placas: eliminar entradas cortas (teclas sueltas, no placas reales)
  try{
    const rawPl=localStorage.getItem(_memKey("placas"));
    if(rawPl){
      const p=JSON.parse(rawPl); const freq=Array.isArray(p)?{}:p;
      const nFreq={};
      Object.entries(freq).forEach(([k,v])=>{ if(k.replace(/\s/g,"").length>=6) nFreq[k]=v; });
      localStorage.setItem(_memKey("placas"),JSON.stringify(nFreq));
    }
  }catch(e){}
}
function getMemoria(clave) {
  try {
    const data = localStorage.getItem(_memKey(clave));
    if (!data) return [];
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) {
      // migrar formato viejo → frecuencia (el primero tiene más peso)
      const freq = {};
      parsed.forEach((v, i) => { freq[v] = parsed.length - i; });
      localStorage.setItem(_memKey(clave), JSON.stringify(freq));
      return parsed;
    }
    // Ordenar por frecuencia descendente
    return Object.entries(parsed)
      .sort((a, b) => b[1] - a[1])
      .map(([v]) => v);
  } catch(e) { return []; }
}
function agregarMemoria(clave, valor) {
  if (!valor || !valor.trim() || valor.trim().length < 2) return;
  try {
    const data = localStorage.getItem(_memKey(clave));
    let freq = {};
    if (data) {
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed)) {
        parsed.forEach((v, i) => { freq[v] = parsed.length - i; });
      } else {
        freq = parsed;
      }
    }
    const key = valor.trim();
    freq[key] = (freq[key] || 0) + 1;
    // Mantener máx 50 entradas (eliminar las menos usadas)
    const entries = Object.entries(freq).sort((a,b)=>b[1]-a[1]).slice(0,50);
    localStorage.setItem(_memKey(clave), JSON.stringify(Object.fromEntries(entries)));
  } catch(e) {}
}

const TIPOS_VEHICULO   = ["Mula","Camión","Volqueta","Patineta","Carro","Camioneta","Bus","Buseta","Tractomula","Furgón","Otro"];
const DESCRIPCIONES    = ["General","Crucetas","Cabezote","Engrase completo","Engrase parcial","Cambio de aceite","Lavado","Revisión","Cambio filtro"];
const NOTAS_ADELANTO   = ["Adelanto quincena","Préstamo","Descuento uniforme","Descuento herramientas"];

// ══════════════════════════════════════════════════════════
//  AUTOCOMPLETE MEJORADO CON FLECHAS
// ══════════════════════════════════════════════════════════
// El desplegable se posiciona con position:fixed calculado desde las coordenadas
// reales del input, así no queda recortado por contenedores con scroll (ej: la
// tabla de la planilla, que tiene overflow-x:auto). Se usa un único listener
// global de scroll/resize (no uno por input) para no acumular listeners cada
// vez que se re-renderizan las filas.
let _acAbierto=null; // {input,lista} del autocomplete visible actualmente
function _acPosicionar(input,lista){
  const r=input.getBoundingClientRect();
  const espacioAbajo=window.innerHeight-r.bottom;
  const ponerArriba=espacioAbajo<160 && r.top>espacioAbajo;
  lista.style.left=r.left+'px';
  lista.style.width=r.width+'px';
  if(ponerArriba){ lista.style.top='auto'; lista.style.bottom=(window.innerHeight-r.top+3)+'px'; }
  else { lista.style.bottom='auto'; lista.style.top=(r.bottom+3)+'px'; }
}
if(!window._acListenersListos){
  window._acListenersListos=true;
  const _acReposicionarSiAbierto=()=>{ if(_acAbierto) _acPosicionar(_acAbierto.input,_acAbierto.lista); };
  window.addEventListener('scroll',_acReposicionarSiAbierto,true);
  window.addEventListener('resize',_acReposicionarSiAbierto);
}
function setupAC(input, _fuente, onSelect, claveMem, minGuardar) {
  if(minGuardar===undefined) minGuardar=3;
  if (!input.parentElement.classList.contains('ac-wrap')) {
    const w=document.createElement('div'); w.className='ac-wrap';
    input.parentNode.insertBefore(w,input); w.appendChild(input);
  }
  const wrap=input.parentElement;
  let lista=wrap.querySelector('.ac-lista');
  if(!lista){lista=document.createElement('div');lista.className='ac-lista';wrap.appendChild(lista);}
  let sel=-1;

  const getSugs=()=>{
    if(_fuente&&_fuente.length) return _fuente;
    if(!claveMem) return [];
    try{
      const raw=localStorage.getItem(_memKey(claveMem));
      if(!raw) return [];
      const p=JSON.parse(raw);
      if(Array.isArray(p)) return p;
      return Object.entries(p).sort((a,b)=>b[1]-a[1]).map(([v])=>v);
    }catch(e){return [];}
  };

  const cerrar=()=>{lista.style.display='none';sel=-1;if(_acAbierto&&_acAbierto.lista===lista)_acAbierto=null;};

  const mostrar=()=>{
    const val=input.value.trim();
    const sugs=getSugs();
    if(!sugs.length){cerrar();return;}
    let res;
    if(!val){
      res=sugs.slice(0,6);
    } else {
      const low=val.toLowerCase();
      const pre=sugs.filter(s=>s.toLowerCase().startsWith(low));
      const con=val.length>=2?sugs.filter(s=>!s.toLowerCase().startsWith(low)&&s.toLowerCase().includes(low)):[];
      res=[...pre,...con].slice(0,6);
    }
    if(!res.length){cerrar();return;}
    sel=-1;
    lista.innerHTML=res.map(t=>
      '<div class="ac-item" data-val="'+t.replace(/"/g,'&quot;')+'">'+t+'</div>'
    ).join('');
    _acAbierto={input,lista};
    _acPosicionar(input,lista);
    lista.style.display='block';
    lista.querySelectorAll('.ac-item').forEach(item=>{
      item.addEventListener('mousedown',e=>{
        e.preventDefault();
        const v=item.dataset.val; input.value=v; cerrar();
        if(claveMem) agregarMemoria(claveMem,v);
        if(onSelect) onSelect(v);
      });
    });
  };

  const elegir=()=>{
    const items=lista.querySelectorAll('.ac-item');
    if(sel>=0&&items[sel]){
      const v=items[sel].dataset.val; input.value=v; cerrar();
      if(claveMem) agregarMemoria(claveMem,v);
      if(onSelect) onSelect(v);
      return true;
    }
    return false;
  };

  input.addEventListener('input',mostrar);
  input.addEventListener('blur',()=>{ const v=input.value.trim(); if(v.length>=minGuardar&&claveMem) agregarMemoria(claveMem,v); });
  input.addEventListener('focus',mostrar);
  input.addEventListener('blur',()=>setTimeout(cerrar,180));
  input.addEventListener('keydown',e=>{
    const items=lista.querySelectorAll('.ac-item');
    const abierto=lista.style.display!=='none'&&items.length;
    if(e.key==='ArrowDown'&&abierto){
      e.preventDefault(); sel=(sel+1)%items.length;
      items.forEach((it,i)=>it.classList.toggle('ac-activo',i===sel));
      items[sel]?.scrollIntoView({block:'nearest'});
    } else if(e.key==='ArrowUp'&&abierto){
      e.preventDefault(); sel=(sel-1+items.length)%items.length;
      items.forEach((it,i)=>it.classList.toggle('ac-activo',i===sel));
      items[sel]?.scrollIntoView({block:'nearest'});
    } else if(e.key==='Enter'){
      if(abierto&&sel>=0){ e.preventDefault(); elegir(); }
    } else if(e.key==='Tab'&&abierto&&sel>=0){
      e.preventDefault(); elegir();
    } else if(e.key==='Escape'&&abierto){
      e.preventDefault(); cerrar();
    }
  });
}


// ══════════════════════════════════════════════════════════
//  MODAL CONFIRMACIÓN
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
//  PERFILES — quién está usando el sistema (para trazabilidad, no login).
//  El perfil activo se guarda POR DISPOSITIVO (localStorage), no en la nube:
//  es "quién está sentado en este computador ahora mismo".
// ══════════════════════════════════════════════════════════
function _turnoActual(){
  const d=new Date();
  const h=d.getHours();
  const fmt=(dt)=>dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
  if(h>=6 && h<18) return fmt(d)+'_dia';
  const base=new Date(d);
  if(h<6) base.setDate(base.getDate()-1); // antes de las 6am = sigue siendo el turno noche que empezó ayer
  return fmt(base)+'_noche';
}
function _perfilStorageKey(){ return `symes_perfil_${negocio?.id||cuentaAct||'x'}`; }
function _perfilGuardado(){
  try{ const raw=localStorage.getItem(_perfilStorageKey()); return raw?JSON.parse(raw):null; }catch(e){ return null; }
}
function perfilActivo(){ return _perfilGuardado()?.nombre || null; }
// Restringe el acceso a ciertas páginas solo a perfiles concretos. Si el negocio
// no tiene sistema de perfiles activo (nadie eligió uno), no restringe nada.
function _perfilTienePermiso(...nombresPermitidos){
  const activo=perfilActivo();
  if(!activo) return true;
  const norm=activo.trim().toLowerCase();
  return nombresPermitidos.some(n=>n.toLowerCase()===norm);
}
function _puedeVerPaginasRestringidas(){
  return _perfilTienePermiso("Admin","Loren");
}
function _guardarPerfilActivo(nombre){
  localStorage.setItem(_perfilStorageKey(), JSON.stringify({nombre, turno:_turnoActual()}));
}
function _actualizarBadgePerfil(){
  const el=document.getElementById("badgePerfil"); if(!el) return;
  if(!negocio?.perfiles?.length){ el.style.display="none"; return; }
  const nombre=perfilActivo();
  el.style.display="inline-flex";
  el.innerHTML=`👤 ${cap(sanitizarTexto(nombre||"Sin perfil"))}`;
}
function _revisarPerfilActivo(){
  if(!negocio) return;
  if(!negocio.perfiles || !negocio.perfiles.length) return; // nadie configuró perfiles todavía, no forzar nada
  const g=_perfilGuardado();
  if(!g || g.turno!==_turnoActual()) _abrirModalPerfil();
}
function _abrirModalPerfil(){
  const cont=document.getElementById("listaPerfilesModal"); if(!cont) return;
  const perfiles=negocio.perfiles||[];
  if(!perfiles.length) return;
  cont.innerHTML=perfiles.map((p,i)=>`<button class="btn-verde" style="width:100%;text-align:left;padding:12px 16px;margin:0;" onclick="_elegirPerfil(${i})">${cap(sanitizarTexto(p))}</button>`).join("");
  document.getElementById("modalPerfil").classList.add("abierto");
}
function _elegirPerfil(i){
  const nombre=(negocio.perfiles||[])[i]; if(!nombre) return;
  _guardarPerfilActivo(nombre);
  cerrarModal("modalPerfil");
  _actualizarBadgePerfil();
  _renderMenuInicio();
  // Si el perfil elegido ya no tiene permiso para la página en la que está, sacarlo a Inicio
  const paginaActual=document.querySelector(".pagina:not(.oculto)");
  if(paginaActual && (paginaActual.id==="paginaCreditos"||paginaActual.id==="paginaPrecios"||paginaActual.id==="paginaCierreMes") && !_puedeVerPaginasRestringidas()){
    mostrarPagina("paginaInicio");
  }
  toast(`Perfil activo: ${cap(sanitizarTexto(nombre))}`,"ok");
}
function agregarPerfil(){
  const input=document.getElementById("nombrePerfilNuevo");
  const nombre=(input?.value||"").trim();
  if(!nombre){toast("Escribe el nombre del perfil","error");return;}
  if(nombre.length>40){toast("El nombre es demasiado largo (máx 40 caracteres)","error");return;}
  if(!negocio.perfiles) negocio.perfiles=[];
  const nombreNorm=nombre.toLowerCase();
  if(negocio.perfiles.some(p=>p.toLowerCase()===nombreNorm)){toast("Ya existe un perfil con ese nombre","error");return;}
  negocio.perfiles.push(nombre);
  input.value="";
  guardar(); mostrarPerfiles(); _actualizarBadgePerfil();
  toast("Perfil agregado ✅","ok");
  guardarEvento({tipoRegistro:"perfiles",perfiles:negocio.perfiles});
}
function eliminarPerfil(idx){
  const nombre=(negocio.perfiles||[])[idx]; if(nombre==null) return;
  confirmar("Eliminar perfil",`¿Eliminar el perfil "${cap(sanitizarTexto(nombre))}"? Las planillas, adelantos y cobros ya registrados a su nombre no cambian, solo deja de estar disponible para elegir.`,()=>{
    negocio.perfiles=negocio.perfiles.filter((p,i)=>i!==idx);
    guardar(); mostrarPerfiles(); _actualizarBadgePerfil();
    toast("Perfil eliminado","ok");
    guardarEvento({tipoRegistro:"perfiles",perfiles:negocio.perfiles});
  });
}
function mostrarPerfiles(){
  const cont=document.getElementById("listaPerfiles"); if(!cont) return;
  const perfiles=negocio?.perfiles||[];
  if(!perfiles.length){ cont.innerHTML="<p style='color:var(--gris);'>No hay perfiles registrados.</p>"; return; }
  const activo=perfilActivo();
  cont.innerHTML=perfiles.map((p,idx)=>`<div class="item" style="display:flex;align-items:center;justify-content:space-between;">
    <span>${cap(sanitizarTexto(p))}${activo===p?' <strong style="color:var(--verde);font-size:12px;">(activo en este dispositivo)</strong>':''}</span>
    <button class="btn-rojo btn-sm" onclick="eliminarPerfil(${idx})">🗑️</button>
  </div>`).join("");
}

// ══════════════════════════════════════════════════════════
//  MÓDULO PRECIOS
// ══════════════════════════════════════════════════════════
let _productoEditando = null;

function _calcularPrecioVenta(precioCompra, modo, porcentaje, manual){
  if(modo==="manual") return Math.max(0, Math.round(Number(manual)||0));
  const p=Number(porcentaje)||0;
  return Math.max(0, Math.round((Number(precioCompra)||0)*(1+p/100)));
}
function _modoPrecioActual(){
  return document.querySelector('input[name="prodModo"]:checked')?.value || "porcentaje";
}
function _cambiarModoPrecio(){
  const modo=_modoPrecioActual();
  document.getElementById("wrapProdPorcentaje")?.classList.toggle("oculto", modo!=="porcentaje");
  document.getElementById("wrapProdManual")?.classList.toggle("oculto", modo!=="manual");
  _actualizarPreviewPrecio();
}
function _actualizarPreviewPrecio(){
  const compra=_leerNum("prodPrecioCompra");
  const modo=_modoPrecioActual();
  const porcentaje=Number(document.getElementById("prodPorcentaje")?.value)||0;
  const manual=_leerNum("prodPrecioVentaManual");
  const venta=_calcularPrecioVenta(compra,modo,porcentaje,manual);
  const el=document.getElementById("prodPreviewVenta");
  if(el) el.textContent="$"+(fmtMiles(venta)||"0");
}
async function guardarProducto(){
  const nombre=(document.getElementById("prodNombre").value||"").trim();
  if(!nombre){toast("Escribe el nombre del producto","error");return;}
  if(nombre.length>60){toast("El nombre es demasiado largo (máx 60 caracteres)","error");return;}
  const unidad=(document.getElementById("prodUnidad").value||"").trim().slice(0,30);
  const precioCompra=_leerNum("prodPrecioCompra");
  const modo=_modoPrecioActual();
  const porcentaje=Number(document.getElementById("prodPorcentaje").value)||0;
  const manual=_leerNum("prodPrecioVentaManual");
  const precioVenta=_calcularPrecioVenta(precioCompra,modo,porcentaje,manual);
  const categoria=document.getElementById("prodCategoria")?.value || _categoriasProductoActuales()[0];
  if(!negocio.productos) negocio.productos=[];
  const nombreNorm=nombre.toLowerCase();
  const dupe=negocio.productos.some(pr=>pr.nombre.toLowerCase()===nombreNorm && pr.id!==_productoEditando);
  if(dupe){toast("Ya existe un producto con ese nombre","error");return;}
  const datos={nombre,unidad,precioCompra,modo,porcentaje,precioVentaManual:manual,precioVenta,categoria};
  if(_productoEditando){
    const idx=negocio.productos.findIndex(pr=>pr.id===_productoEditando);
    if(idx>=0) negocio.productos[idx]=Object.assign({},negocio.productos[idx],datos);
    toast("Producto actualizado ✅","ok");
  } else {
    negocio.productos.push(Object.assign({id:generarId()},datos));
    toast("Producto agregado ✅","ok");
  }
  guardar(); cancelarEdicionProducto(); actualizarTodo();
  const r=await guardarEvento({tipoRegistro:"productos",productos:negocio.productos,categorias:negocio.categoriasProductos});
  if(!r||!r.ok) toast("⚠️ Sin conexión: el producto se guardó solo en este dispositivo","aviso");
}
function editarProducto(id){
  const p=(negocio.productos||[]).find(x=>x.id===id); if(!p) return;
  _productoEditando=id;
  document.getElementById("prodNombre").value=p.nombre;
  document.getElementById("prodUnidad").value=p.unidad||"";
  document.getElementById("prodPrecioCompra").value=fmtMiles(p.precioCompra)||"";
  document.querySelectorAll('input[name="prodModo"]').forEach(r=>{r.checked=(r.value===p.modo);});
  document.getElementById("prodPorcentaje").value=p.porcentaje||0;
  document.getElementById("prodPrecioVentaManual").value=fmtMiles(p.precioVentaManual||p.precioVenta)||"";
  _poblarSelectCategorias();
  const selCat=document.getElementById("prodCategoria");
  if(selCat) selCat.value=p.categoria||_categoriasProductoActuales()[0];
  _cambiarModoPrecio();
  document.getElementById("btnGuardarProducto").textContent="💾 Guardar cambios";
  document.getElementById("btnCancelarEdicionProducto").classList.remove("oculto");
  document.getElementById("prodNombre").scrollIntoView({behavior:"smooth",block:"center"});
}
function cancelarEdicionProducto(){
  _productoEditando=null;
  document.getElementById("prodNombre").value="";
  document.getElementById("prodUnidad").value="";
  document.getElementById("prodPrecioCompra").value="";
  document.getElementById("prodPrecioVentaManual").value="";
  document.getElementById("prodPorcentaje").value=30;
  document.querySelectorAll('input[name="prodModo"]').forEach(r=>{r.checked=(r.value==="porcentaje");});
  _poblarSelectCategorias();
  const selCatReset=document.getElementById("prodCategoria");
  if(selCatReset) selCatReset.value=_categoriasProductoActuales()[0];
  _cambiarModoPrecio();
  document.getElementById("btnGuardarProducto").textContent="➕ Agregar producto";
  document.getElementById("btnCancelarEdicionProducto").classList.add("oculto");
}
async function eliminarProducto(id){
  const p=(negocio.productos||[]).find(x=>x.id===id); if(!p) return;
  confirmar("Eliminar producto",`¿Eliminar "${cap(sanitizarTexto(p.nombre))}" de la lista de precios?`,async()=>{
    negocio.productos=negocio.productos.filter(x=>x.id!==id);
    if(_productoEditando===id) cancelarEdicionProducto();
    guardar(); actualizarTodo();
    toast("Producto eliminado","ok");
    const r=await guardarEvento({tipoRegistro:"productos",productos:negocio.productos,categorias:negocio.categoriasProductos});
    if(!r||!r.ok) toast("⚠️ Sin conexión: eliminación guardada solo en este dispositivo","aviso");
  });
}
let _filtroCategoriaProducto = "";
function _categoriasProductoActuales(){
  if(!negocio.categoriasProductos || !negocio.categoriasProductos.length) negocio.categoriasProductos=["General"];
  return negocio.categoriasProductos;
}
function _poblarSelectCategorias(){
  const sel=document.getElementById("prodCategoria"); if(!sel) return;
  const cats=_categoriasProductoActuales();
  const actual=sel.value;
  sel.innerHTML=cats.map(c=>`<option value="${sanitizarTexto(c)}">${cap(sanitizarTexto(c))}</option>`).join("");
  sel.value=cats.includes(actual)?actual:cats[0];
}
function _poblarFiltroCategoriasPrecio(){
  const sel=document.getElementById("selFiltroCategoriaPrecio"); if(!sel) return;
  const cats=_categoriasProductoActuales();
  sel.innerHTML=`<option value="">🏷️ Todas</option>`+cats.map(c=>`<option value="${sanitizarTexto(c)}" ${_filtroCategoriaProducto===c?'selected':''}>${cap(sanitizarTexto(c))}</option>`).join("");
}
async function agregarCategoriaProducto(){
  const input=document.getElementById("nombreCategoriaProducto");
  const nombre=(input?.value||"").trim();
  if(!nombre){toast("Escribe el nombre de la categoría","error");return;}
  if(nombre.length>30){toast("El nombre es demasiado largo (máx 30 caracteres)","error");return;}
  const cats=_categoriasProductoActuales();
  const nombreNorm=nombre.toLowerCase();
  if(cats.some(c=>c.toLowerCase()===nombreNorm)){toast("Ya existe esa categoría","error");return;}
  cats.push(nombre);
  input.value="";
  guardar(); actualizarTodo();
  toast("Categoría agregada ✅","ok");
  const r=await guardarEvento({tipoRegistro:"productos",productos:negocio.productos||[],categorias:negocio.categoriasProductos});
  if(!r||!r.ok) toast("⚠️ Sin conexión: la categoría se guardó solo en este dispositivo","aviso");
}
async function eliminarCategoriaProducto(idx){
  const cats=_categoriasProductoActuales();
  const nombre=cats[idx]; if(nombre==null) return;
  if(cats.length<=1){toast("Debe quedar al menos una categoría","error");return;}
  const enUso=(negocio.productos||[]).some(p=>(p.categoria||"General")===nombre);
  if(enUso){toast(`No puedes eliminar "${cap(sanitizarTexto(nombre))}": hay productos usándola`,"error");return;}
  confirmar("Eliminar categoría",`¿Eliminar la categoría "${cap(sanitizarTexto(nombre))}"?`,async()=>{
    negocio.categoriasProductos=cats.filter((c,i)=>i!==idx);
    if(_filtroCategoriaProducto===nombre) _filtroCategoriaProducto="";
    guardar(); actualizarTodo();
    toast("Categoría eliminada","ok");
    const r=await guardarEvento({tipoRegistro:"productos",productos:negocio.productos||[],categorias:negocio.categoriasProductos});
    if(!r||!r.ok) toast("⚠️ Sin conexión: eliminación guardada solo en este dispositivo","aviso");
  });
}
function mostrarPrecios(){
  const cont=document.getElementById("listaPrecios"); if(!cont) return;
  if(!negocio.productos) negocio.productos=[];
  _categoriasProductoActuales();
  _poblarSelectCategorias();
  _poblarFiltroCategoriasPrecio();
  const catCont=document.getElementById("listaCategoriasProducto");
  if(catCont){
    catCont.innerHTML=negocio.categoriasProductos.map((c,i)=>`<div class="item" style="display:flex;align-items:center;gap:8px;margin:0;padding:8px 14px;">
      <span>${cap(sanitizarTexto(c))}</span>
      <button class="btn-rojo btn-sm" onclick="eliminarCategoriaProducto(${i})">🗑️</button>
    </div>`).join("");
  }
  const q=(document.getElementById("buscarProducto")?.value||"").trim().toLowerCase();
  let productos=negocio.productos.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre));
  if(_filtroCategoriaProducto) productos=productos.filter(p=>(p.categoria||"General")===_filtroCategoriaProducto);
  if(q) productos=productos.filter(p=>p.nombre.toLowerCase().includes(q));
  const titulo=document.getElementById("tituloListaPrecios");
  if(titulo) titulo.textContent=(_filtroCategoriaProducto||q)?`Productos guardados (${productos.length} de ${negocio.productos.length})`:`Productos guardados (${negocio.productos.length})`;
  if(!productos.length){
    cont.innerHTML="<p style='color:var(--gris);'>"+((q||_filtroCategoriaProducto)?"No hay productos que coincidan.":"No hay productos guardados todavía.")+"</p>";
    return;
  }
  cont.innerHTML=productos.map(p=>{
    const ganancia=Number(p.precioVenta||0)-Number(p.precioCompra||0);
    const gananciaPct=p.precioCompra>0?(ganancia/p.precioCompra*100):0;
    return `<div class="item">
      <div class="fp-nombre">
        <span class="fp-nombre-txt">${cap(sanitizarTexto(p.nombre))}</span>
        ${p.unidad?`<span class="fp-unidad">(${sanitizarTexto(p.unidad)})</span>`:""}
        <span class="badge-categoria-precio">🏷️ ${cap(sanitizarTexto(p.categoria||"General"))}</span>
      </div>
      <div class="fp-cifras">
        <span>Compra <b>$${fmtMiles(p.precioCompra)||'0'}</b></span>
        <span>Venta <b>$${fmtMiles(p.precioVenta)||'0'}</b></span>
        <span class="fp-ganancia">Ganancia <b>$${fmtMiles(ganancia)||'0'} (${gananciaPct.toFixed(0)}%)</b></span>
      </div>
      <div class="fp-acciones">
        <button class="btn-sm" onclick="editarProducto('${p.id}')">✏️ Editar</button>
        <button class="btn-rojo btn-sm" onclick="eliminarProducto('${p.id}')">🗑️ Eliminar</button>
      </div>
    </div>`;
  }).join("");
}

function confirmar(titulo, msg, cb) {
  document.getElementById("modalConfirmTitulo").innerText = titulo;
  document.getElementById("modalConfirmMsg").innerText    = msg;
  document.getElementById("modalConfirmOk").onclick = () => { cerrarModal("modalConfirm"); cb(); };
  document.getElementById("modalConfirm").classList.add("abierto");
  setTimeout(()=>{ document.getElementById("modalConfirmOk").focus(); }, 60);
}
function cerrarModal(id) { document.getElementById(id).classList.remove("abierto"); }

// ══════════════════════════════════════════════════════════
//  TOAST (notificaciones flotantes) — usa #toastContainer del HTML
// ══════════════════════════════════════════════════════════
function toast(msg, tipo, duracion) {
  const cont = document.getElementById("toastContainer");
  if (!cont) { console.warn("toast:", msg); return; }
  tipo = tipo || "info";
  const iconos = { ok:"✅", error:"❌", info:"ℹ️", aviso:"⚠️" };
  const el = document.createElement("div");
  el.className = "toast " + tipo;
  const icono = document.createElement("span");
  icono.textContent = iconos[tipo] || iconos.info;
  const texto = document.createElement("span");
  texto.textContent = String(msg == null ? "" : msg);
  el.appendChild(icono);
  el.appendChild(texto);
  const vida = duracion || 3100;
  if (duracion) el.style.animation = `toastIn .28s ease, toastOut .28s ease ${Math.max(0,(duracion-280))/1000}s forwards`;
  cont.appendChild(el);
  setTimeout(() => { el.remove(); }, vida);
}

// ══════════════════════════════════════════════════════════
//  PERSISTENCIA
// ══════════════════════════════════════════════════════════
function guardar() {
  try {
    localStorage.setItem("symes_cuentas", JSON.stringify(cuentas));
    if (cuentaAct) localStorage.setItem("symes_cuenta_actual", cuentaAct);
  } catch(e) {
    console.error("Error guardando en localStorage:", e);
    toast("Advertencia: no se pudo guardar localmente. Espacio insuficiente.","aviso");
  }
}
function validarPin(p) { return /^[0-9]{6}$/.test(p); }
function mesActual() { const f=new Date(); return f.getFullYear()+"-"+String(f.getMonth()+1).padStart(2,"0"); }
// Mes que se debe mostrar/pagar por defecto en Pagos, Historial y Cierre.
// Los primeros dias del mes (1 a 3) todavia se paga la 2a quincena (16-fin) del
// mes anterior, asi que por defecto mostramos ese mes anterior hasta que el
// usuario cambie el selector manualmente. Evita que "Pagos" salga en $0 el 1 o 2.
function _mesAnteriorA(mes){
  const [y,m]=mes.split("-").map(Number);
  const d=new Date(y, m-2, 1);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
}
function mesPagoSugerido(){
  const dia=new Date().getDate();
  return dia<=3 ? _mesAnteriorA(mesActual()) : mesActual();
}
function generarId() { return Date.now().toString(36)+Math.random().toString(36).substr(2,5); }
// Sanitiza texto de usuario para uso seguro en DOM (nunca usar en innerHTML)
function cap(s){ return s ? s.replace(/(^|\s)\S/g, l => l.toUpperCase()) : (s||""); }
function capPrimera(s){ if(!s) return s||""; return s.charAt(0).toUpperCase()+s.slice(1); }
function formatPlaca(s){ if(!s) return ""; const c=s.toUpperCase().replace(/[^A-Z0-9]/g,""); return c.length>3?c.slice(0,3)+" "+c.slice(3):c; }
function fmtMiles(n){
  // Si ya es un número (resultado de cálculos), redondear directo — nunca tratar
  // el punto decimal como separador de miles (ese era el bug: convertía
  // 1234.56 en "1.234.560.000..." al quitarle el punto decimal por error).
  var x = (typeof n === "number") ? Math.round(n) : Math.round(Number(String(n).replace(/\./g,'').replace(/,/g,''))||0);
  return x>0?x.toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.'):''
}
// Reformatea un <input> con puntos de miles MIENTRAS se escribe, preservando
// la posición del cursor (cuenta dígitos antes del cursor y los reubica tras
// reformatear). Solo toca dígitos — cualquier otro caracter se descarta.
function _formatearValorEnVivo(el){
  const cursorOrig=el.selectionStart==null?el.value.length:el.selectionStart;
  const digitosAntes=(el.value.slice(0,cursorOrig).match(/\d/g)||[]).length;
  const soloDigitos=el.value.replace(/\D/g,'');
  const formateado=fmtMiles(soloDigitos?Number(soloDigitos):0);
  el.value=formateado;
  if(!digitosAntes){ el.setSelectionRange(0,0); return; }
  let contados=0,pos=formateado.length;
  for(let k=0;k<formateado.length;k++){
    if(/\d/.test(formateado[k])) contados++;
    if(contados===digitosAntes){ pos=k+1; break; }
  }
  el.setSelectionRange(pos,pos);
}
function _leerNum(id){
  const el=document.getElementById(id); if(!el) return 0;
  const n=Number(String(el.value||'').replace(/\./g,'').replace(/,/g,''));
  return isNaN(n)?0:n;
}
function labelEngrase(e){ return e==="azul"?"Azul":e==="mixto_r"?"Mixto":"Sintético"; }
function sanitizarTexto(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[<>"'&]/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','&':'&amp;'}[c]));
}
// Valida que un valor numérico sea positivo y razonable
function validarNumero(v, max=9999999) {
  const n = Number(v);
  return !isNaN(n) && n >= 0 && n <= max;
}

// ══════════════════════════════════════════════════════════
//  TRIAL POR DISPOSITIVO
// ══════════════════════════════════════════════════════════
function getDeviceKey() {
  let k=localStorage.getItem("symes_device_key");
  if(!k){k="dev_"+generarId();localStorage.setItem("symes_device_key",k);}
  return k;
}
function periodoGratisUsado() { return localStorage.getItem("symes_trial_used")==="1"; }
function marcarPeriodoGratisUsado() { localStorage.setItem("symes_trial_used","1"); }

// ══════════════════════════════════════════════════════════
//  NUBE
// ══════════════════════════════════════════════════════════
async function nubePost(ep, body) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(()=>ctrl.abort(), 12000); // 12s timeout
    const r = await fetch(`${API_URL}/${ep}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:ctrl.signal});
    clearTimeout(tid);
    const d = await r.json(); return {ok:r.ok,data:d};
  } catch(e) {
    if(e.name==="AbortError") return {ok:false,error:"Tiempo de espera agotado. Verifica tu conexión."};
    return {ok:false,error:e.message};
  }
}
async function nubeGet(ep) {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(()=>ctrl.abort(), 12000);
    const r = await fetch(`${API_URL}/${ep}`,{signal:ctrl.signal}); clearTimeout(tid); const d = await r.json(); return {ok:r.ok,data:d};
  } catch(e) { return {ok:false,error:e.message}; }
}
async function _guardarEventoRemoto(ev, total, ganTrab) {
  return nubePost("liquidaciones",{usuario_id:negocio.id,trabajador_id:null,descripcion:JSON.stringify(ev),total:Number(total)||1,ganancia_trabajador:Number(ganTrab)||0,ganancia_negocio:0});
}
async function guardarEvento(ev, total=1, ganTrab=0) {
  if (!negocio?.id) return {ok:false};
  const r = await _guardarEventoRemoto(ev, total, ganTrab);
  if (!r.ok) {
    // Conexión inestable: el cambio ya se aplicó en pantalla, pero no llegó a la nube.
    // Se encola para reintentar en el próximo login/sincronización — si no se hiciera esto,
    // el cambio quedaría "atrapado" en este equipo y nunca lo verían los demás.
    if (!negocio.eventosPendientes) negocio.eventosPendientes = [];
    negocio.eventosPendientes.push({ev, total, ganTrab});
    guardar();
  }
  return r;
}
// Reintenta subir a la nube los eventos (adelantos, pagos, etc.) que quedaron guardados
// solo en este equipo por una falla de conexión. Los que logran subir dejan de encolarse;
// los que siguen fallando se re-aplican localmente para no desaparecer de la pantalla
// mientras se recupera la conexión.
async function _sincronizarEventosPendientes() {
  const pendientes = negocio.eventosPendientes || [];
  if (!pendientes.length) return;
  const siguen = [];
  for (const p of pendientes) {
    const r = await _guardarEventoRemoto(p.ev, p.total, p.ganTrab);
    if (!r.ok) { siguen.push(p); procesarEvento(p.ev); }
  }
  negocio.eventosPendientes = siguen;
  guardar();
}

// ══════════════════════════════════════════════════════════
//  REGISTRO / LOGIN / SESIÓN RECORDADA
// ══════════════════════════════════════════════════════════
// Autocomplete en los campos de nombre del negocio
function iniciarACLogin() {
  const nom = document.getElementById("loginNombre");
  const reg = document.getElementById("regNombre");
  const nombres = Object.keys(cuentas);
  if (nom) setupAC(nom, nombres, null, "neg_nombres");
  if (reg) setupAC(reg, nombres, null, "neg_nombres");
}

function mostrarRegistro() {
  ocultarVistas();
  document.getElementById("vistaRegistro").classList.remove("oculto");
  setTimeout(iniciarACLogin, 50);
}
function mostrarLogin() {
  ocultarVistas();
  // Ocultar menú de cuenta (no relevante fuera del sistema)
  const md=document.getElementById("menuDerecha");
  if(md) md.style.display="none";
  document.getElementById("vistaLogin").classList.remove("oculto");
  cargarSesionRecordada();
  setTimeout(iniciarACLogin, 50);
}
function ocultarVistas() {
  ["menuInicial","vistaRegistro","vistaLogin","sistema"].forEach(id => {
    const el=document.getElementById(id);
    if(el) el.classList.add("oculto");
  });
}
function volverMenu() {
  ["vistaRegistro","vistaLogin","sistema"].forEach(id => document.getElementById(id).classList.add("oculto"));
  document.getElementById("menuInicial").classList.remove("oculto");
  document.getElementById("menuDerecha").style.display = "none";
  const _st=document.getElementById("sidebarTrigger"); if(_st) _st.style.display="none";
  const _cm=document.getElementById("contenidoMenu"); if(_cm) _cm.classList.remove("sidebar-abierto");
}
function irAlInicio() {
  const enSistema = !document.getElementById("sistema").classList.contains("oculto");
  if (enSistema) {
    mostrarPagina("paginaInicio");
    cerrarMenu();
  } else {
    volverMenu();
  }
}

function cargarSesionRecordada() {
  const guardada = localStorage.getItem("symes_sesion_recordada");
  if (!guardada) return;
  try {
    const s = JSON.parse(guardada);
    const ni = document.getElementById("loginNombre");
    const badge = document.getElementById("sesionRecordadaBadge");
    if (ni && s.nombre) ni.value = s.nombre;
    if (badge) { badge.classList.remove("oculto"); badge.textContent = `Sesión recordada para ${s.nombre} — ingresa tu PIN`; }
  } catch(e) {}
}

async function registrarCuenta() {
  const nombre = document.getElementById("regNombre").value.trim();
  const pin    = document.getElementById("regPin").value.trim();

  if (!nombre || !pin) {
    toast("Completa todos los campos","error");
    return;
  }

  if (!validarPin(pin)) {
    toast("El PIN debe tener exactamente 6 dígitos","error");
    return;
  }

  if (periodoGratisUsado()) {
    toast("Este dispositivo ya usó el período de prueba gratuito.","aviso");
    return;
  }

  const r = await nubePost("register", {
    negocio: nombre,
    usuario: nombre,
    password: pin
  });

  if (!r.ok) {
    toast(r.data?.error || "No se pudo registrar","error");
    return;
  }

  await fetch(API_URL + "/solicitudes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      negocio: nombre,
      propietario: nombre,
      telefono: "No registrado"
    })
  });

  marcarPeriodoGratisUsado();

  agregarMemoria("neg_nombres", nombre);

  toast("Cuenta registrada. Ahora inicia sesión.","ok");

  document.getElementById("regNombre").value = "";
  document.getElementById("regPin").value = "";

  mostrarLogin();
}

function normalizarCuenta(nombre, dataU, pin) {
  const g = cuentas[nombre] || {};
  // esAdmin viene del backend (campo is_admin en el Worker), no se determina por PIN
  const esAdmin = !!(dataU.esAdmin || dataU.is_admin || nombre.toLowerCase() === ADMIN_NAME);
  cuentas[nombre] = {
    id:dataU.id, nombreNegocio:dataU.negocio, negocio:dataU.negocio,
    usuario:dataU.usuario, pin,
    esAdmin,
    trabajadores:g.trabajadores||[], historial:g.historial||[], planillas:g.planillas||[],
    configuracion:g.configuracion||JSON.parse(JSON.stringify(CONFIG_DEFECTO)),
    cierresMes:g.cierresMes||{},
    plan:g.plan||"pro_trial", trialInicio:g.trialInicio||new Date().toISOString()
  };
}

async function iniciarSesion() {
  const nombre = document.getElementById("loginNombre").value.trim();
  const pin    = document.getElementById("loginPin").value.trim();
  const recordar = document.getElementById("recordarSesion")?.checked;
  if (!nombre||!pin) { toast("Completa todos los campos","error"); return; }
  const r = await nubePost("login",{usuario:nombre,password:pin});
  if (!r.ok) { toast(r.data?.error||"Usuario o PIN incorrecto","error"); return; }
  // Bloqueo defensivo por si el backend marca la cuenta como desactivada
  if (r.data?.activo===0 || r.data?.activo===false || r.data?.usuario?.activo===0) {
    toast("Esta cuenta está desactivada. Contacta al administrador.","error");
    return;
  }
  normalizarCuenta(nombre, r.data.usuario, pin);
  cuentaAct = nombre; negocio = cuentas[nombre];
  if (recordar) {
    // Solo guardamos el nombre, nunca el PIN en texto plano
    localStorage.setItem("symes_sesion_recordada", JSON.stringify({nombre}));
  } else {
    localStorage.removeItem("symes_sesion_recordada");
  }
  agregarMemoria("neg_nombres", nombre);
  await cargarTrabajadores();
  await cargarLiquidaciones();
  await _sincronizarEventosPendientes();
  await _sincronizarEliminaciones();
  guardar();
  document.getElementById("loginNombre").value = "";
  document.getElementById("loginPin").value    = "";
  entrarSistema();
}

// ══════════════════════════════════════════════════════════
//  SISTEMA
// ══════════════════════════════════════════════════════════
function prepararDatos() {
  if (!negocio.trabajadores)  negocio.trabajadores  = [];
  if (!negocio.historial)     negocio.historial     = [];
  if (!negocio.planillas)     negocio.planillas     = [];
  if (!negocio.configuracion) negocio.configuracion = JSON.parse(JSON.stringify(CONFIG_DEFECTO));
  if (!negocio.cierresMes)    negocio.cierresMes    = {};
  if (!negocio.creditos)      negocio.creditos      = {empresas:[], historial:[]};
  if (!negocio.perfiles)      negocio.perfiles      = ["Admin"];
  if (!negocio.adelantosPerfiles) negocio.adelantosPerfiles = {}; // adelantos a perfiles (secretarias), no admin
  if (!negocio.pagosPerfiles) negocio.pagosPerfiles = {}; // valor manual + estado de pago por quincena, perfiles (secretarias)
  if (!negocio.productos)     negocio.productos     = [];
  if (!negocio.categoriasProductos) negocio.categoriasProductos = ["General"];
  negocio.trabajadores.forEach(t => { if(!t.pagos) t.pagos={}; if(!t.adelantos) t.adelantos={}; if(!t.pagosQuincena) t.pagosQuincena={}; });
  guardar();
}

function _renderMenuInicio() {
  const esAdmin = negocio.esAdmin;
  const PAGINAS_RESTRINGIDAS = ["paginaCreditos","paginaPrecios","paginaCierreMes"];
  const puedeVerRestringidas = _puedeVerPaginasRestringidas();

  const tarjetas = [
    {id:"paginaPlanillas",    icono:"📋", titulo:"Planillas",        desc:"Registra servicios y liquida automáticamente."},
    {id:"paginaLiquidacion",  icono:"🧾", titulo:"Liquidación",      desc:"Liquida planillas y consulta liquidaciones guardadas."},

    {id:"paginaCierreMes",    icono:"💵", titulo:"Pagos",    desc:"Paga por quincena o todo lo que se debe — engrasadores y perfiles."},
    {id:"paginaTrabajadores", icono:"👷", titulo:"Engrasadores",     desc:"Registra los trabajadores del engrasadero."},
    {id:"paginaAdelantos",    icono:"➖", titulo:"Adelantos",        desc:"Registra descuentos o anticipos."},
    {id:"paginaCreditos",     icono:"💳", titulo:"Créditos",         desc:"Servicios a crédito por empresa, para cobrar después."},
    {id:"paginaPrecios",      icono:"🏷️", titulo:"Precios",          desc:"Productos con precio de compra y de venta, a la mano."},
    {id:"paginaPerfiles",     icono:"👤", titulo:"Perfiles",         desc:"Quién usa el sistema — queda registrado en planillas, adelantos y cobros."},
    {id:"paginaConfiguracion",icono:"⚙️", titulo:"Configuración",   desc:"Precios, porcentajes y cambio de contraseña."},
    ...(esAdmin ? [{id:"paginaAdmin",icono:"👑",titulo:"Superadmin",desc:"Gestión de usuarios del sistema."}] : [])
  ].filter(t => puedeVerRestringidas || !PAGINAS_RESTRINGIDAS.includes(t.id));
  document.getElementById("tarjetasInicio").innerHTML = tarjetas.map(t =>
    `<div class="tarjeta" onclick="mostrarPagina('${t.id}')"><h3>${t.icono} ${t.titulo}</h3></div>`
  ).join("");

  const menuItems = [
    {icono:"🏠",label:"Inicio",        pagina:"paginaInicio"},
    {icono:"📋",label:"Planillas",     pagina:"paginaPlanillas"},
    {icono:"🧾",label:"Liquidación",   pagina:"paginaLiquidacion"},
    {icono:"💵",label:"Pagos",         pagina:"paginaCierreMes"},
    {icono:"👷",label:"Engrasadores",  pagina:"paginaTrabajadores"},
    {icono:"➖",label:"Adelantos",     pagina:"paginaAdelantos"},
    {icono:"💳",label:"Créditos",      pagina:"paginaCreditos"},
    {icono:"🏷️",label:"Precios",       pagina:"paginaPrecios"},
    {icono:"👤",label:"Perfiles",       pagina:"paginaPerfiles"},
    {icono:"⚙️",label:"Configuración", pagina:"paginaConfiguracion"},
    ...(esAdmin ? [{icono:"👑",label:"Superadmin",pagina:"paginaAdmin"}] : [])
  ].filter(m => puedeVerRestringidas || !PAGINAS_RESTRINGIDAS.includes(m.pagina));
  document.getElementById("contenidoMenu").innerHTML =
    menuItems.map(m=>`<button onclick="mostrarPagina('${m.pagina}')">${m.icono} ${m.label}</button>`).join("") +
    `<div class="divisor-menu"></div><button class="rojo-menu" onclick="cerrarSesion()">🚪 Cerrar sesión</button>`;
}

function entrarSistema() {
  prepararDatos();
  ["menuInicial","vistaRegistro","vistaLogin"].forEach(id => document.getElementById(id).classList.add("oculto"));
  document.getElementById("sistema").classList.remove("oculto");
  document.getElementById("menuDerecha").style.display = "block";
  if(window.innerWidth >= 769){ const st=document.getElementById("sidebarTrigger"); if(st) st.style.display="flex"; }
  document.getElementById("tituloCuenta").innerText = cap(negocio.nombreNegocio||"");
  document.getElementById("descInicio").innerText   = "Sistema de liquidaciones — Panel principal";

  _renderMenuInicio();

  const navItems = [
    {icono:"🏠",label:"Inicio",   pagina:"paginaInicio"},
    {icono:"📋",label:"Planillas",pagina:"paginaPlanillas"},

    ...(_puedeVerPaginasRestringidas() ? [{icono:"💵",label:"Pagos",    pagina:"paginaCierreMes"}] : []),
    {icono:"☰", label:"Menú",    accion:"menu"},
  ];
  document.getElementById("navInferior").innerHTML = navItems.map(n=>
    `<button class="nav-item" onclick="${n.accion?'toggleMenu()':`mostrarPagina('${n.pagina}')`}" data-pagina="${n.pagina||''}"><span class="nav-icono">${n.icono}</span><span>${n.label}</span></button>`
  ).join("");
  document.getElementById("navInferior").style.display = "flex";

  actualizarBannerPlan();
  const m = mesPagoSugerido();
  ["mesTrabajo","mesHistorial","mesCierre"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=m; });
  cargarConfigEnPantalla();
  // Limpiar historial de navegación previo y poner inicio como base
  const urlBase = window.location.href.split("?")[0];
  history.replaceState({ pagina: "paginaInicio" }, "", urlBase + "?p=paginaInicio");
  mostrarPagina("paginaInicio", true);
  setTimeout(iniciarNotificaciones, 3000);

  // Perfiles: badge + verificación obligatoria de turno (6am / 6pm)
  _actualizarBadgePerfil();
  _revisarPerfilActivo();
  if(!window._perfilIntervaloListo){
    window._perfilIntervaloListo=true;
    setInterval(_revisarPerfilActivo, 60000);
  }

  // AC en adelantos
  setTimeout(() => {
    const notaEl = document.getElementById("notaAdelanto");
    if (notaEl) setupAC(notaEl, NOTAS_ADELANTO, null, "notas_adelanto");
    const nomTEl = document.getElementById("nombreTrabajador");
    if (nomTEl) setupAC(nomTEl, getSugerenciasEngrasadores(), null, "nombres_engrasadores");
  }, 200);
}

function actualizarBannerPlan() {
  // Planes eliminados — función desactivada
}

function cerrarSesion() {
  // 1. Reset variables de negocio
  cuentaAct=null; negocio=null; ultimoCalc=null;
  mixtosAct=[]; azulesAct=[]; pestaniasAbiertas=[]; pestaniaActiva=null;

  // 2. Limpiar sesion persistida
  localStorage.removeItem("symes_cuenta_actual");
  localStorage.removeItem("symes_sesion_recordada");

  // 3. Vaciar contenido renderizado del sistema
  ["contenidoPlanillaActiva","tabsPlanillas","listaEngrasadores",
   "listaPagos","historialContenido","contenidoMenu","resultado",
   "panelAdminContenido","cierreContenido"].forEach(id=>{
    const el=document.getElementById(id); if(el) el.innerHTML="";
  });

  // 4. Ocultar todas las vistas y paginas internas
  ["menuInicial","vistaRegistro","vistaLogin","sistema"].forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.classList.add("oculto"); el.removeAttribute("style"); }
  });
  document.querySelectorAll(".pagina").forEach(p=>p.classList.add("oculto"));

  // 5. Ocultar menu de cuenta
  const md=document.getElementById("menuDerecha");
  if(md) md.style.display="none";

  // 6. Limpiar historial del navegador
  history.replaceState(null,"",window.location.href.split("?")[0]);

  // 7. Mostrar solo login
  mostrarLogin();
}

function toggleMenu() {
  const m=document.getElementById("contenidoMenu");
  m.classList.toggle("sidebar-abierto");
}
// Variable para evitar loop en popstate
let _navegandoAtras = false;

function mostrarPagina(id, sinHistorial=false) {
  // Route guard: si no hay sesión activa, redirigir al login
  if (!negocio) { mostrarLogin(); return; }
  // Route guard: Créditos y Precios solo para perfiles autorizados
  if ((id==="paginaCreditos" || id==="paginaPrecios" || id==="paginaCierreMes") && !_puedeVerPaginasRestringidas()) {
    toast("No tienes permiso para acceder a esta sección","error");
    id="paginaInicio";
  }
  document.querySelectorAll(".pagina").forEach(p=>p.classList.add("oculto"));
  const el=document.getElementById(id); if(el) el.classList.remove("oculto");
  window.scrollTo(0,0);
  document.getElementById("contenidoMenu").classList.remove("sidebar-abierto");
  document.querySelectorAll(".nav-item").forEach(n=>n.classList.toggle("activo",n.dataset.pagina===id));
  if (id==="paginaPlanillas") { renderTabsPlanillas(); mostrarListaPlanillas(); }
  if (id==="paginaLiquidacion") sincronizarMeses();
  if (id==="paginaAdelantos") { const fe=document.getElementById("fechaAdelanto"); if(fe) fe.value=new Date().toLocaleDateString("en-CA"); }
  if (id==="paginaConfiguracion") cargarConfigEnPantalla();
  if (id==="paginaPlanes") actualizarEstadoPlanes();
  if (id==="paginaAdmin" && negocio?.esAdmin) cargarSolicitudesAdmin();
  actualizarTodo();
  // Empujar al historial del navegador para que "atrás" funcione
  if (!sinHistorial && !_navegandoAtras) {
    const estado = { pagina: id };
    const urlActual = window.location.href.split("?")[0];
    history.pushState(estado, "", urlActual + "?p=" + id);
  }
}

// Escuchar el botón "atrás" del navegador / celular
window.addEventListener("popstate", function(e) {
  // Solo actuar si el sistema está visible (usuario logueado)
  const sistemaDom = document.getElementById("sistema");
  if (!sistemaDom || sistemaDom.classList.contains("oculto")) return;
  _navegandoAtras = true;
  if (e.state && e.state.pagina) {
    mostrarPagina(e.state.pagina, true);
  } else {
    // Si no hay estado previo, ir a inicio (no salir de la app)
    mostrarPagina("paginaInicio", true);
    // Evitar que retroceda fuera de la app: poner un state vacío
    history.replaceState({ pagina: "paginaInicio" }, "", window.location.href.split("?")[0] + "?p=paginaInicio");
  }
  _navegandoAtras = false;
});
function actualizarTodo() {
  if(!negocio) return;
  semillarMemoria(); actualizarEngrasadores(); mostrarHistorial(); mostrarAdelantos(); mostrarReglas(); mostrarCierreMes(); mostrarListaPlanillas(); mostrarCreditos(); mostrarPerfiles(); mostrarPrecios(); _poblarDatalistProductos(); refrescarDropdownsPlanilla();
}

// Refresca solo los selects de engrasador de las planillas abiertas (sin re-renderizar toda la planilla)
function refrescarDropdownsPlanilla(){
  const nombresE=(negocio.trabajadores||[]).map(t=>cap(sanitizarTexto(t.nombre))).filter(Boolean);
  const optsE=`<option value="">— Ninguno —</option>`+nombresE.map(n=>`<option value="${n}">${n}</option>`).join("");
  pestaniasAbiertas.forEach(p=>{
    const pl=negocio.planillas.find(x=>x.id===p.id); if(!pl) return;
    [1,2,3,4].forEach(n=>{
      const sel=document.getElementById(`planE${n}_${pl.id}`); if(!sel) return;
      const cur=sel.value;
      sel.innerHTML=optsE;
      if(cur) sel.value=cur; // conservar selección actual
    });
  });
}

// ══ MESES ══
function sincronizarMeses() {
  const ids=["mesTrabajo","mesHistorial","mesCierre"];
  const vals=ids.map(id=>document.getElementById(id)?.value).filter(Boolean);
  const base=vals[0]||mesPagoSugerido();
  ids.forEach(id=>{ const el=document.getElementById(id); if(el&&!el.value) el.value=base; });
}
function getMes() { sincronizarMeses(); return document.getElementById("mesTrabajo")?.value||mesPagoSugerido(); }
function cambiarMesPagos()    { const m=document.getElementById("mesTrabajo").value; if(m){["mesHistorial","mesCierre"].forEach(id=>{const el=document.getElementById(id);if(el)el.value=m;}); } actualizarTodo(); }
function cambiarMesCierre()   { const m=document.getElementById("mesCierre").value;  if(m){["mesTrabajo","mesHistorial"].forEach(id=>{const el=document.getElementById(id);if(el)el.value=m;}); } actualizarTodo(); }
function cambiarMesHistorial(){ const m=document.getElementById("mesHistorial").value; if(m){["mesTrabajo","mesCierre"].forEach(id=>{const el=document.getElementById(id);if(el)el.value=m;}); } actualizarTodo(); }

// ══ NUBE CARGA ══
async function cargarTrabajadores() {
  if (!negocio?.id) return;
  const loc=negocio.trabajadores||[];
  const eliminados=new Set((negocio.trabajadoresEliminados||[]).map(n=>n.toLowerCase()));
  const r=await nubeGet(`trabajadores?usuario_id=${negocio.id}&_=${Date.now()}`);
  if(!r.ok){toast("No se pudieron cargar engrasadores","error");return;}
  // Construir lista desde D1 conservando pagos/adelantos locales
  const d1List=r.data.map(t=>{
    const l=loc.find(tl=>tl.nombre.toLowerCase()===t.nombre.toLowerCase()||tl.id===t.id);
    return {id:t.id,nombre:t.nombre,porcentaje:t.porcentaje||50,pagos:l?.pagos||{},adelantos:l?.adelantos||{},sinSeguridad:l?.sinSeguridad||false};
  });
  // Preservar trabajadores locales que D1 aún no tiene (recién agregados, sync pendiente)
  const d1Nombres=new Set(d1List.map(t=>t.nombre.toLowerCase()));
  const soloLocales=loc.filter(t=>!d1Nombres.has(t.nombre.toLowerCase())&&!eliminados.has(t.nombre.toLowerCase()));
  negocio.trabajadores=[...d1List,...soloLocales].filter(t=>!eliminados.has(t.nombre.toLowerCase()));
  // Reintentar guardar en D1 los que no llegaron
  for(const t of soloLocales){
    nubePost("trabajadores",{usuario_id:negocio.id,nombre:t.nombre,porcentaje:t.porcentaje||50});
  }
  guardar();
}
async function cargarLiquidaciones() {
  if(!negocio?.id) return;
  const r=await nubeGet(`liquidaciones?usuario_id=${negocio.id}&_=${Date.now()}`);
  if(!r.ok){toast("No se pudieron cargar liquidaciones","error");return;}
  limpiarPagosLocales();
  const planillasEliminadas=new Set();
  const trabEliminadosCloud=new Set();
  _trabElimNube=new Set(); _planillaElimNube=new Set(); // reset globales
  r.data.slice().reverse().forEach(item=>{
    try {
      const ev=JSON.parse(item.descripcion);
      if(ev.tipoRegistro==="eliminarPlanilla"&&ev.planillaId){ planillasEliminadas.add(ev.planillaId); _planillaElimNube.add(ev.planillaId); }
      if(ev.tipoRegistro==="eliminarTrabajador"&&ev.nombre){ trabEliminadosCloud.add(ev.nombre.toLowerCase()); _trabElimNube.add(ev.nombre.toLowerCase()); }
      if(ev.tipoRegistro==="agregarTrabajador"&&ev.nombre){ trabEliminadosCloud.delete(ev.nombre.toLowerCase()); _trabElimNube.delete(ev.nombre.toLowerCase()); }
      procesarEvento(ev);
    } catch(e){console.error("Evento inválido:",e);}
  });
  // Filtrar planillas eliminadas al final (two-pass igual que trabajadores)
  if(planillasEliminadas.size>0){
    negocio.planillas=(negocio.planillas||[]).filter(p=>!planillasEliminadas.has(p.id));
  }
  // Respaldo: filtrar también por IDs eliminados guardados en localStorage
  const localEliminadas=negocio.planillasEliminadas||[];
  if(localEliminadas.length>0){
    const localSet=new Set(localEliminadas);
    negocio.planillas=(negocio.planillas||[]).filter(p=>!localSet.has(p.id));
  }
  // Filtrar engrasadores eliminados - two-pass (cloud + localStorage)
  if(trabEliminadosCloud.size>0){
    negocio.trabajadores=(negocio.trabajadores||[]).filter(t=>!trabEliminadosCloud.has(t.nombre.toLowerCase()));
  }
  const localElimT=(negocio.trabajadoresEliminados||[]).map(n=>n.toLowerCase());
  if(localElimT.length>0){
    negocio.trabajadores=(negocio.trabajadores||[]).filter(t=>!localElimT.includes(t.nombre.toLowerCase()));
  }
  guardar();
}
function limpiarPagosLocales() {
  negocio.trabajadores?.forEach(t=>{t.pagos={};t.adelantos={};});
  negocio.adelantosPerfiles={}; // evita duplicar adelantos de perfiles al re-sincronizar (bug: se acumulaban en cada carga)
  negocio.historial=[];
  negocio.planillas=[];
}
function procesarEvento(ev) {
  try {
    if (!ev || typeof ev !== "object") return;
    if (ev.tipoRegistro==="liquidacion"){ aplicarLiquidacion(ev.calculo,true); return; }
    if (!ev.tipoRegistro&&ev.mes&&ev.totalFinal!==undefined){ aplicarLiquidacion(ev,true); return; }
    if (ev.tipoRegistro==="adelanto"){
      if(!ev.trabajadorNombre||!ev.mes) return;
      const t=getTrabPorNombre(ev.trabajadorNombre);
      if(t){if(!t.adelantos)t.adelantos={};if(!t.adelantos[ev.mes])t.adelantos[ev.mes]=[];t.adelantos[ev.mes].push({valor:Number(ev.valor||0),nota:ev.nota||"",fecha:ev.fecha||"",ts:ev.ts||null,creadoPor:ev.creadoPor||null});}
      return;
    }
    if (ev.tipoRegistro==="eliminarAdelanto"){
      if(!ev.trabajadorNombre||!ev.mes) return;
      const t=getTrabPorNombre(ev.trabajadorNombre);
      const lista=t?.adelantos?.[ev.mes];
      if(!lista||!lista.length) return;
      let idx=-1;
      if(ev.ts) idx=lista.findIndex(a=>a.ts===ev.ts);
      if(idx<0) idx=lista.findIndex(a=>Number(a.valor||0)===Number(ev.valor||0)&&(a.nota||"")===(ev.nota||"")&&(a.fecha||"")===(ev.fecha||""));
      if(idx>=0) lista.splice(idx,1);
      return;
    }
    if (ev.tipoRegistro==="adelantoPerfil"){
      if(!ev.perfilNombre||!ev.mes) return;
      if(!negocio.adelantosPerfiles) negocio.adelantosPerfiles={};
      if(!negocio.adelantosPerfiles[ev.perfilNombre]) negocio.adelantosPerfiles[ev.perfilNombre]={};
      if(!negocio.adelantosPerfiles[ev.perfilNombre][ev.mes]) negocio.adelantosPerfiles[ev.perfilNombre][ev.mes]=[];
      negocio.adelantosPerfiles[ev.perfilNombre][ev.mes].push({valor:Number(ev.valor||0),nota:ev.nota||"",fecha:ev.fecha||"",ts:ev.ts||null,creadoPor:ev.creadoPor||null});
      return;
    }
    if (ev.tipoRegistro==="eliminarAdelantoPerfil"){
      if(!ev.perfilNombre||!ev.mes) return;
      const lista=negocio.adelantosPerfiles?.[ev.perfilNombre]?.[ev.mes];
      if(!lista||!lista.length) return;
      let idx=-1;
      if(ev.ts) idx=lista.findIndex(a=>a.ts===ev.ts);
      if(idx<0) idx=lista.findIndex(a=>Number(a.valor||0)===Number(ev.valor||0)&&(a.nota||"")===(ev.nota||"")&&(a.fecha||"")===(ev.fecha||""));
      if(idx>=0) lista.splice(idx,1);
      return;
    }
    if (ev.tipoRegistro==="pagoQuincenaTrabajador"){
      if(!ev.nombre||!ev.mes||!ev.q) return;
      const t=getTrabPorNombre(ev.nombre);
      if(t){ if(!t.pagosQuincena)t.pagosQuincena={}; if(!t.pagosQuincena[ev.mes])t.pagosQuincena[ev.mes]={}; t.pagosQuincena[ev.mes][ev.q]=(ev.pagado==="unida")?"unida":!!ev.pagado; }
      return;
    }
    if (ev.tipoRegistro==="valorQuincenaPerfil"){
      if(!ev.perfilNombre||!ev.mes||!ev.q) return;
      if(!negocio.pagosPerfiles) negocio.pagosPerfiles={};
      if(!negocio.pagosPerfiles[ev.perfilNombre]) negocio.pagosPerfiles[ev.perfilNombre]={};
      if(!negocio.pagosPerfiles[ev.perfilNombre][ev.mes]) negocio.pagosPerfiles[ev.perfilNombre][ev.mes]={};
      if(!negocio.pagosPerfiles[ev.perfilNombre][ev.mes][ev.q]) negocio.pagosPerfiles[ev.perfilNombre][ev.mes][ev.q]={valor:0,pagado:false};
      negocio.pagosPerfiles[ev.perfilNombre][ev.mes][ev.q].valor=Number(ev.valor||0);
      return;
    }
    if (ev.tipoRegistro==="pagoQuincenaPerfil"){
      if(!ev.perfilNombre||!ev.mes||!ev.q) return;
      if(!negocio.pagosPerfiles) negocio.pagosPerfiles={};
      if(!negocio.pagosPerfiles[ev.perfilNombre]) negocio.pagosPerfiles[ev.perfilNombre]={};
      if(!negocio.pagosPerfiles[ev.perfilNombre][ev.mes]) negocio.pagosPerfiles[ev.perfilNombre][ev.mes]={};
      if(!negocio.pagosPerfiles[ev.perfilNombre][ev.mes][ev.q]) negocio.pagosPerfiles[ev.perfilNombre][ev.mes][ev.q]={valor:0,pagado:false};
      negocio.pagosPerfiles[ev.perfilNombre][ev.mes][ev.q].pagado=!!ev.pagado;
      return;
    }
    if (ev.tipoRegistro==="configuracion"){
      if(!ev.configuracion) return;
      negocio.configuracion=Object.assign(JSON.parse(JSON.stringify(CONFIG_DEFECTO)),ev.configuracion||{});
      return;
    }
    if (ev.tipoRegistro==="productos"){
      if(!Array.isArray(ev.productos)) return;
      negocio.productos=ev.productos;
      if(Array.isArray(ev.categorias)&&ev.categorias.length) negocio.categoriasProductos=ev.categorias;
      else if(!negocio.categoriasProductos||!negocio.categoriasProductos.length) negocio.categoriasProductos=["General"];
      return;
    }
    if (ev.tipoRegistro==="creditos"){
      if(!ev.creditos) return;
      negocio.creditos={empresas:ev.creditos.empresas||[],historial:ev.creditos.historial||[]};
      return;
    }
    if (ev.tipoRegistro==="perfiles"){
      if(!ev.perfiles) return;
      negocio.perfiles=Array.isArray(ev.perfiles)?ev.perfiles:[];
      return;
    }
    if (ev.tipoRegistro==="trabajadorFlags"){
      if(!ev.nombre) return;
      const t=getTrabPorNombre(ev.nombre);
      if(t) t.sinSeguridad=!!ev.sinSeguridad;
      return;
    }
    if (ev.tipoRegistro==="cierreMes"){ if(!ev.mes) return; if(!negocio.cierresMes)negocio.cierresMes={}; negocio.cierresMes[ev.mes]=ev.estado||"Pendiente"; return; }
    if (ev.tipoRegistro==="reinicioMes"){ if(!ev.mes) return; negocio.trabajadores?.forEach(t=>{if(!t.pagos)t.pagos={};if(!t.adelantos)t.adelantos={};t.pagos[ev.mes]=0;t.adelantos[ev.mes]=[]; }); return; }
    if (ev.tipoRegistro==="borrarHistorialMes"){ if(!ev.mes) return; negocio.historial=(negocio.historial||[]).filter(c=>c.mes!==ev.mes); return; }
    if (ev.tipoRegistro==="planilla"){
      if(!ev.planilla?.id) return;
      if(!negocio.planillas)negocio.planillas=[];
      const idx=negocio.planillas.findIndex(p=>p.id===ev.planilla.id);
      if(idx>=0)negocio.planillas[idx]=ev.planilla; else negocio.planillas.unshift(ev.planilla);
      return;
    }
    if (ev.tipoRegistro==="eliminarPlanilla"){
      if(!ev.planillaId) return;
      negocio.planillas=(negocio.planillas||[]).filter(p=>p.id!==ev.planillaId);
      return;
    }
    if (ev.tipoRegistro==="eliminarLiquidacion"){
      const idx=(negocio.historial||[]).findIndex(c=>c.planillaId===ev.planillaId&&c.fecha===ev.fecha);
      if(idx>=0){
        const c=negocio.historial[idx];
        const descontar=(nom,val)=>{ const t=getTrabPorNombre(nom); if(t){if(!t.pagos)t.pagos={};if(!t.pagos[c.mes])t.pagos[c.mes]=0;t.pagos[c.mes]=Math.max(0,t.pagos[c.mes]-Number(val||0));} };
        descontar(c.trabajadorNombre1,c.pagoTrabajador1);
        if(c.trabajadorNombre2) descontar(c.trabajadorNombre2,c.pagoTrabajador2);
        if(c.trabajadorNombre3) descontar(c.trabajadorNombre3,c.pagoTrabajador3);
        if(c.trabajadorNombre4) descontar(c.trabajadorNombre4,c.pagoTrabajador4);
        negocio.historial.splice(idx,1);
      }
      return;
    }
    if (ev.tipoRegistro==="eliminarTrabajador"){
      if(!ev.nombre) return;
      const nl=ev.nombre.toLowerCase();
      negocio.trabajadores=(negocio.trabajadores||[]).filter(t=>t.nombre.toLowerCase()!==nl);
      return;
    }
    if (ev.tipoRegistro==="agregarTrabajador"){
      if(!ev.nombre) return;
      const nl=ev.nombre.toLowerCase();
      const ya=(negocio.trabajadores||[]).some(t=>t.nombre.toLowerCase()===nl);
      if(!ya){ if(!negocio.trabajadores)negocio.trabajadores=[]; negocio.trabajadores.push({nombre:ev.nombre,porcentaje:ev.porcentaje||50,pagos:{},adelantos:{}}); }
      return;
    }
  } catch(e) { console.error("Error procesando evento:", e, ev); }
}

// ══ ENGRASADORES ══
function getTrabPorNombre(n){ if(!n)return null; const nl=n.toLowerCase(); return negocio.trabajadores.find(t=>t.nombre.toLowerCase()===nl); }
function sumarPago(n,mes,v){ const t=getTrabPorNombre(n); if(!t)return; if(!t.pagos)t.pagos={}; if(!t.pagos[mes])t.pagos[mes]=0; t.pagos[mes]+=Number(v||0); }
function aplicarLiquidacion(c, hist=true) {
  if(!c||!negocio) return;
  const mes=c.mes||getMes();
  sumarPago(c.trabajadorNombre1,mes,c.pagoTrabajador1);
  if(c.trabajadorNombre2) sumarPago(c.trabajadorNombre2,mes,c.pagoTrabajador2);
  if(c.trabajadorNombre3) sumarPago(c.trabajadorNombre3,mes,c.pagoTrabajador3);
  if(c.trabajadorNombre4) sumarPago(c.trabajadorNombre4,mes,c.pagoTrabajador4);
  if(hist){ if(!negocio.historial)negocio.historial=[]; negocio.historial.push(c); }
}
function getPago(t,mes){ return t.pagos?.[mes]||0; }
function getAdelantos(t,mes){ return (t.adelantos?.[mes]||[]).reduce((s,a)=>s+Number(a.valor),0); }
function getSugerenciasEngrasadores(){ return negocio?.trabajadores?.map(t=>t.nombre)||[]; }

async function agregarTrabajador() {
  const nombre=document.getElementById("nombreTrabajador").value.trim();
  if(!nombre){toast("Escribe el nombre","error");return;}
  if(nombre.length > 60){toast("El nombre es demasiado largo (máx 60 caracteres)","error");return;}
  if(!negocio?.id){toast("Inicia sesión primero","error");return;}
  const nombreNorm=nombre.toLowerCase().replace(/\s+/g," ").trim();
  if(negocio.trabajadores.some(t=>t.nombre.toLowerCase().replace(/\s+/g," ").trim()===nombreNorm)){
    toast("Ya existe un engrasador con ese nombre","error");return;
  }
  const r=await nubePost("trabajadores",{usuario_id:negocio.id,nombre,porcentaje:50});
  // Guardar también como evento en liquidaciones (fuente de verdad alternativa si falla D1 trabajadores)
  await guardarEvento({tipoRegistro:"agregarTrabajador",nombre,porcentaje:50});
  if(!r.ok) console.warn("trabajadores POST falló, pero evento guardado en liquidaciones");
  // Si este nombre estaba en la lista de eliminados, quitarlo
  if(negocio.trabajadoresEliminados){
    negocio.trabajadoresEliminados=negocio.trabajadoresEliminados.filter(n=>n.toLowerCase()!==nombreNorm);
  }
  negocio.trabajadores.push({nombre,pagos:{},adelantos:{}});
  agregarMemoria("nombres_engrasadores", nombre);
  document.getElementById("nombreTrabajador").value="";
  guardar(); actualizarTodo(); toast("Engrasador guardado ✅","ok");
}
function actualizarEngrasadores() {
  const mes=getMes();
  const lista=document.getElementById("listaTrabajadores"); if(!lista) return;
  const s1=document.getElementById("selTrab1"), s2=document.getElementById("selTrab2"), s3=document.getElementById("selTrab3"), s4=document.getElementById("selTrab4"), sA=document.getElementById("selAdelanto");
  lista.innerHTML="";
  if(s1) s1.innerHTML=`<option value="">Seleccione</option>`;
  if(s2) s2.innerHTML=`<option value="">Seleccione</option>`;
  if(s3) s3.innerHTML=`<option value="">Seleccione</option>`;
  if(s4) s4.innerHTML=`<option value="">Seleccione</option>`;
  if(sA) sA.innerHTML=`<option value="">Seleccione</option>`;
  if(!negocio.trabajadores.length){lista.innerHTML="<p>No hay engrasadores.</p>";return;}
  negocio.trabajadores.forEach((t,i)=>{
    const b=getPago(t,mes), a=getAdelantos(t,mes), n=b-a;
    const nomSafe=sanitizarTexto(t.nombre);
    const inicial = nomSafe.charAt(0).toUpperCase();
    lista.innerHTML+=`<div class="item">
      <div class="item-header">
        <div class="item-avatar">${inicial}</div>
        <div>
          <div class="item-nombre">${nomSafe}</div>
        </div>
      </div>
      <div class="item-stats">
        <div class="item-stat"><span>Ganado</span><strong>$${b.toLocaleString()}</strong></div>
        <div class="item-stat"><span>Adelantos</span><strong>$${a.toLocaleString()}</strong></div>
        <div class="item-stat neto"><span>A pagar</span><strong>$${n.toLocaleString()}</strong></div>
      </div>
      <div class="item-acciones">
        <button onclick="editarEngrasador(${i})">✏️ Editar</button>
        <button class="btn-rojo" onclick="eliminarEngrasador(${i})">🗑️ Eliminar</button>
      </div>
    </div>`;
    if(s1) s1.innerHTML+=`<option value="${i}">${nomSafe}</option>`;
    if(s2) s2.innerHTML+=`<option value="${i}">${nomSafe}</option>`;
    if(s3) s3.innerHTML+=`<option value="${i}">${nomSafe}</option>`;
    if(s4) s4.innerHTML+=`<option value="${i}">${nomSafe}</option>`;
    if(sA) sA.innerHTML+=`<option value="${i}">${nomSafe}</option>`;
  });
  // Perfiles (secretarias) tambien pueden recibir adelantos, excepto Admin
  if(sA){
    const perfilesSecretarias=(negocio.perfiles||[]).filter(p=>p.toLowerCase()!=="admin");
    if(perfilesSecretarias.length){
      sA.innerHTML+=`<option disabled>── Otros perfiles ──</option>`;
      perfilesSecretarias.forEach(p=>{ sA.innerHTML+=`<option value="p:${sanitizarTexto(p)}">${sanitizarTexto(p)} (perfil)</option>`; });
    }
  }
}
function editarEngrasador(i){
  const t=negocio.trabajadores[i], n=prompt("Nuevo nombre:",t.nombre);
  if(!n) return;
  const nn=n.trim();
  if(!nn){toast("El nombre no puede estar vacío","error");return;}
  if(negocio.trabajadores.some((tt,ii)=>ii!==i&&tt.nombre.toLowerCase()===nn.toLowerCase())){toast("Ya existe con ese nombre","error");return;}
  t.nombre=nn; guardar(); actualizarTodo(); toast("Nombre actualizado","ok");
}
function eliminarEngrasador(i){
  const nombreE=negocio.trabajadores[i].nombre;
  confirmar("Eliminar engrasador",`¿Eliminar a ${cap(sanitizarTexto(nombreE))}?`,async()=>{
    negocio.trabajadores.splice(i,1);
    // Respaldo local: guardar nombre en lista de eliminados
    if(!negocio.trabajadoresEliminados) negocio.trabajadoresEliminados=[];
    if(!negocio.trabajadoresEliminados.includes(nombreE)) negocio.trabajadoresEliminados.push(nombreE);
    guardar(); actualizarTodo(); toast("Eliminado","ok");
    const r=await guardarEvento({tipoRegistro:"eliminarTrabajador",nombre:nombreE});
    if(!r||!r.ok) toast("⚠️ Sin conexión: eliminación guardada localmente","error");
  });
}

// ══════════════════════════════════════════════════════════
//  MÓDULO PLANILLAS
// ══════════════════════════════════════════════════════════
function nuevaPlanilla() {
  const id=generarId();
  const ahora=new Date();
  const fecha=ahora.toLocaleDateString("es-CO",{day:"2-digit",month:"2-digit",year:"numeric"});
  const mes=mesActual();
  const filaVacia=()=>({placa:"",tipoVehiculo:"",descripcion:"",tipoEngrase:"azul",valor:0,valorRaw:"",engrasador:"",observaciones:"",adicionalDesc:"",adicionalValor:0,adicionalValorRaw:"",adicionalProductos:[],creditoCobrado:false,creditoCobroId:null});
  const planilla={id,fecha,mes,nombre:"Nueva planilla",vehiculos:Array.from({length:10},filaVacia),engrasador1:"",engrasador2:"",engrasador3:"",engrasador4:"",carcamos:[],grasaAntes:0,grasaQuedo:0,total:0,liquidada:false,creadoPor:perfilActivo()};
  if(!negocio.planillas) negocio.planillas=[];
  negocio.planillas.unshift(planilla);
  guardar();
  abrirPestania(id);
  renderTabsPlanillas();
  mostrarListaPlanillas();
}
function abrirPestania(id) {
  const ya=pestaniasAbiertas.find(p=>p.id===id);
  if(!ya){ const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return; pestaniasAbiertas.push({id,nombre:pl.nombre||pl.fecha}); }
  pestaniaActiva=id; renderTabsPlanillas(); renderPlanillaActiva();
}
function cerrarPestania(id,e) {
  if(e) e.stopPropagation();
  pestaniasAbiertas=pestaniasAbiertas.filter(p=>p.id!==id);
  if(pestaniaActiva===id) pestaniaActiva=pestaniasAbiertas.length?pestaniasAbiertas[pestaniasAbiertas.length-1].id:null;
  renderTabsPlanillas();
  if(pestaniaActiva) renderPlanillaActiva();
  else document.getElementById("contenidoPlanillaActiva").innerHTML="";
}
function renderTabsPlanillas() {
  const tabs=document.getElementById("tabsPlanillas"); if(!tabs) return;
  if(!pestaniasAbiertas.length){tabs.innerHTML="<span style='color:var(--gris);font-size:13px;'>Sin planillas abiertas</span>";return;}
  tabs.innerHTML=pestaniasAbiertas.map(p=>{
    const activa=p.id===pestaniaActiva;
    const pl=negocio.planillas.find(pl=>pl.id===p.id);
    const lbl=pl?(pl.nombre||pl.fecha):p.nombre;
    return `<div class="tab-planilla ${activa?'activa':''}" onclick="cambiarPestania('${p.id}')" title="${sanitizarTexto(lbl)}"><span class="tab-planilla-lbl">${sanitizarTexto(lbl)}</span><span class="cerrar-tab" onclick="cerrarPestania('${p.id}',event)">×</span></div>`;
  }).join("");
}
function cambiarPestania(id){ pestaniaActiva=id; renderTabsPlanillas(); renderPlanillaActiva(); }

function renderPlanillaActiva() {
  if(!pestaniaActiva){ document.getElementById("contenidoPlanillaActiva").innerHTML=""; return; }
  const pl=negocio.planillas.find(p=>p.id===pestaniaActiva); if(!pl) return;
  const nombresE=getSugerenciasEngrasadores();
  const optsE=`<option value="">— Ninguno —</option>`+nombresE.map(n=>`<option value="${n}">${n}</option>`).join("");
  const liqBadge=pl.liquidada?`<span class="badge-liquidada">LIQUIDADA</span>`:` <span class="badge-pendiente">⏳ Pendiente</span>`;
  const liqBlockMsg=pl.liquidada?`<div class="alerta alerta-verde" style="margin:10px 0;">Esta planilla ya fue liquidada. No se puede liquidar de nuevo.</div>`:"";
  const c=document.getElementById("contenidoPlanillaActiva");
  c.innerHTML=`
  <div class="seccion">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <input type="text" id="planNombre_${pl.id}" value="${pl.nombre||''}" placeholder="Nombre de la planilla"
        oninput="actualizarNombrePlanilla('${pl.id}',this.value)"
        style="max-width:300px;font-weight:700;font-size:15px;">
      ${liqBadge}
      <span style="display:flex;align-items:center;gap:6px;margin-left:auto;font-size:12px;color:var(--gris);">
        Fecha:
        <input type="date" id="planFecha_${pl.id}" value="${_fechaDDMMYYYYaISO(pl.fecha)}"
          onchange="actualizarFechaPlanilla('${pl.id}',this.value)"
          style="width:auto;padding:4px 8px;font-size:12px;margin:0;">
        — Mes: ${pl.mes}
      </span>
    </div>
    ${liqBlockMsg}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-bottom:10px;">
      <div><label>Engrasador 1:</label>
        <select id="planE1_${pl.id}" onchange="actualizarDatoPlanilla('${pl.id}','engrasador1',this.value);actualizarNombrePlanilla('${pl.id}',null)">${optsE}</select>
      </div>
      <div><label>Engrasador 2 (opcional):</label>
        <select id="planE2_${pl.id}" onchange="actualizarDatoPlanilla('${pl.id}','engrasador2',this.value);actualizarNombrePlanilla('${pl.id}',null)">${optsE}</select>
      </div>
      <div><label>Engrasador 3 (opcional):</label>
        <select id="planE3_${pl.id}" onchange="actualizarDatoPlanilla('${pl.id}','engrasador3',this.value);actualizarNombrePlanilla('${pl.id}',null)">${optsE}</select>
      </div>
      <div><label>Engrasador 4 (opcional):</label>
        <select id="planE4_${pl.id}" onchange="actualizarDatoPlanilla('${pl.id}','engrasador4',this.value);actualizarNombrePlanilla('${pl.id}',null)">${optsE}</select>
      </div>
    </div>
    <div style="margin-bottom:10px;">
      <label style="display:block;margin-bottom:6px;">Cárcamo(s) en uso:</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${[1,2,3,4].map(n=>`<label class="chip-carcamo ${(pl.carcamos||[]).includes(n)?'activo':''}">
          <input type="checkbox" ${(pl.carcamos||[]).includes(n)?'checked':''} onchange="this.parentElement.classList.toggle('activo',this.checked);toggleCarcamoPlanilla('${pl.id}',${n},this.checked)">
          Cárcamo ${n}
        </label>`).join("")}
      </div>
    </div>
    <div class="seccion-grasa-planilla">
      <div><label>🛢️ Grasa antes (g):</label><input type="text" inputmode="numeric" autocomplete="off" id="planGA_${pl.id}" value="${pl.grasaAntes?fmtMiles(pl.grasaAntes):''}" oninput="_formatearValorEnVivo(this);actualizarDatoPlanilla('${pl.id}','grasaAntes',Number(this.value.replace(/\\./g,''))||0)" placeholder="5.000"></div>
      <div><label>🛢️ Grasa que quedó (g):</label><input type="text" inputmode="numeric" autocomplete="off" id="planGQ_${pl.id}" value="${pl.grasaQuedo?fmtMiles(pl.grasaQuedo):''}" oninput="_formatearValorEnVivo(this);actualizarDatoPlanilla('${pl.id}','grasaQuedo',Number(this.value.replace(/\\./g,''))||0)" placeholder="2.000"></div>
      <div><label>Grasa gastada:</label><div id="planGG_${pl.id}" style="padding:9px 12px;background:#e8f1ff;color:#243044;border-radius:10px;font-weight:700;margin-top:4px;font-size:13px;">${((pl.grasaAntes||0)-(pl.grasaQuedo||0)).toLocaleString()} g</div></div>
    </div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <button class="btn-verde btn-sm" onclick="agregarFilaPlanilla('${pl.id}', document.getElementById('cantFila_${pl.id}').value)">＋ Fila</button>
      <input type="number" id="cantFila_${pl.id}" value="1" min="1" max="50" title="Cantidad de filas a agregar" style="width:56px;padding:8px 6px;margin:0;text-align:center;" onkeydown="if(event.key==='Enter'){event.preventDefault();agregarFilaPlanilla('${pl.id}', this.value);}">
      <span style="color:var(--gris);font-size:11px;">Enter = nueva fila · Tab = siguiente columna</span>
    </div>
    <div class="scroll-hint">↔️ Desliza la tabla hacia los lados para ver todas las columnas</div>
    <div class="planilla-wrap" id="wrapTabla_${pl.id}">
      <table class="tabla-excel planilla-full" id="tabla_${pl.id}">
        <thead><tr>
          <th style="width:26px;">#</th>
          <th class="col-placa">Placa</th>
          <th class="col-tipo">Tipo vehículo</th>
          <th class="col-desc">Descripción</th>
          <th class="col-engrase">Tipo <span class="info" data-tip="Mixto o Azul — define el % de liquidación">!</span></th>
          <th class="col-valor">Valor <span class="info" data-tip="Escribe 40 → $40.000 · 45 → $45.000">!</span></th>
          <th class="col-engrasador">Engrasador</th>
          <th class="col-obs">Observación</th>
          <th class="col-del"></th>
        </tr></thead>
        <tbody id="tbody_${pl.id}"></tbody>
      </table>
    </div>
    <div class="planilla-total-bar" id="totalBar_${pl.id}">
      <span>Total planilla:</span><span id="totalNum_${pl.id}">$0</span>
    </div>
    <div class="acciones-editor-planilla" style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
      <button class="btn-verde" onclick="guardarPlanilla('${pl.id}')">💾 Guardar</button>
      ${!pl.liquidada ? `<button onclick="liquidarDesdePlanilla('${pl.id}')">⚡ Liquidar</button>` : `<button class="btn-gris" disabled style="opacity:.5;cursor:not-allowed;">Ya liquidada</button>`}
      <button onclick="imprimirPlanilla('${pl.id}')">PDF</button>
      <button class="btn-rojo" onclick="eliminarPlanilla('${pl.id}')">🗑️ Eliminar</button>
    </div>
  </div>`;
  const se1=document.getElementById(`planE1_${pl.id}`), se2=document.getElementById(`planE2_${pl.id}`);
  const se3=document.getElementById(`planE3_${pl.id}`), se4=document.getElementById(`planE4_${pl.id}`);
  if(se1&&pl.engrasador1) se1.value=pl.engrasador1;
  if(se2&&pl.engrasador2) se2.value=pl.engrasador2;
  if(se3&&pl.engrasador3) se3.value=pl.engrasador3;
  if(se4&&pl.engrasador4) se4.value=pl.engrasador4;
  renderFilasPlanilla(pl.id);
}

function _fechaDDMMYYYYaISO(f){
  const m=String(f||"").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return "";
  return m[3]+"-"+m[2].padStart(2,"0")+"-"+m[1].padStart(2,"0");
}
function _fechaISOaDDMMYYYY(iso){
  const m=String(iso||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m) return "";
  return m[3]+"/"+m[2]+"/"+m[1];
}
function actualizarFechaPlanilla(id, isoValue){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  const nueva=_fechaISOaDDMMYYYY(isoValue);
  if(!nueva){ toast("Fecha inválida","error"); return; }
  pl.fecha=nueva;
  pl.mes=isoValue.slice(0,7); // yyyy-mm, mantiene el mes sincronizado con la nueva fecha
  actualizarNombrePlanilla(id, null); // el título ("... — fecha") se regenera con la fecha nueva
  guardar();
  mostrarListaPlanillas();
  renderPlanillaActiva();
  toast("Fecha de la planilla actualizada ✅","ok");
}
function actualizarNombrePlanilla(id, nuevo) {
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  if(nuevo!==null){ pl.nombre=nuevo; }
  else {
    const e1=pl.engrasador1||"", e2=pl.engrasador2||"", e3=pl.engrasador3||"", e4=pl.engrasador4||"";
    const partes=[e1,e2,e3,e4].filter(Boolean);
    pl.nombre=partes.length?partes.join(" & "):("Planilla "+pl.fecha);
    const inp=document.getElementById(`planNombre_${id}`); if(inp) inp.value=pl.nombre;
  }
  _programarAutoguardarPlanilla(id);
  const tab=pestaniasAbiertas.find(p=>p.id===id); if(tab) tab.nombre=pl.nombre;
  renderTabsPlanillas();
}
function toggleCarcamoPlanilla(id, num, checked){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  if(!pl.carcamos) pl.carcamos=[];
  if(checked){ if(!pl.carcamos.includes(num)) pl.carcamos.push(num); }
  else { pl.carcamos=pl.carcamos.filter(n=>n!==num); }
  pl.carcamos.sort((a,b)=>a-b);
  guardar();
  _programarAutoguardarPlanilla(id);
}
function actualizarDatoPlanilla(id, campo, valor) {
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  pl[campo]=valor;
  if(campo==="grasaAntes"||campo==="grasaQuedo"){
    const gg=(pl.grasaAntes||0)-(pl.grasaQuedo||0);
    const el=document.getElementById(`planGG_${id}`); if(el) el.innerText=gg.toLocaleString()+" g";
  }
  if(["engrasador1","engrasador2","engrasador3","engrasador4"].includes(campo)){
    _refrescarFilasEngrasador(id);
  }
  _programarAutoguardarPlanilla(id);
}
function _actualizarColorFila(id,i,tipo){
  const tr=document.getElementById(`fila_${id}_${i}`); if(!tr) return;
  tr.classList.toggle('fila-resaltada', tipo==='mixto'||tipo==='mixto_r');
}
function _opcionesEngrasadorFila(pl){
  // Titulares definidos arriba primero (son los que se liquidan), luego el resto de engrasadores registrados
  const titulares=[pl.engrasador1,pl.engrasador2,pl.engrasador3,pl.engrasador4].filter(n=>n&&n.trim());
  const todos=getSugerenciasEngrasadores()||[];
  const resto=todos.filter(n=>!titulares.includes(n));
  return [...titulares, ...resto];
}
function _refrescarFilasEngrasador(id){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  const nombresE=_opcionesEngrasadorFila(pl);
  const optsE=`<option value="">-</option>`+nombresE.map(n=>`<option value="${n}">${n}</option>`).join("");
  (pl.vehiculos||[]).forEach((v,i)=>{
    const sel=document.getElementById(`rowE_${id}_${i}`); if(!sel) return;
    const cur=sel.value;
    sel.innerHTML=optsE;
    // mantener selección si el engrasador sigue existiendo (aunque ya no sea titular)
    if(nombresE.includes(cur)) sel.value=cur;
    else { sel.value=""; v.engrasador=""; }
  });
}

// ══════════════════════════════════════════════════════════
//  CRÉDITOS POR EMPRESA (fila a fila) — Bricai, Volketsa, Robayo, y las que se agreguen
// ══════════════════════════════════════════════════════════
// Una fila de servicio es "de crédito" cuando su Observación coincide (sin
// importar mayúsculas) con el nombre de una empresa registrada en Créditos.
// No hay libro contable aparte: el crédito pendiente se calcula siempre en
// vivo a partir de las filas de las planillas, así que editar o borrar una
// fila actualiza o borra automáticamente su crédito.
function _empresaCreditoDeFila(v){
  const obs=String(v?.observaciones||"").trim().toLowerCase();
  if(!obs) return null;
  const empresas=negocio?.creditos?.empresas||[];
  return empresas.find(e=>e.toLowerCase()===obs)||null;
}
// Suma de los productos de la base de precios agregados a esta fila (cada uno
// queda como una etiqueta removible, independiente del texto libre y del valor
// manual — así se puede quitar uno sin afectar los demás).
function _totalAdicionalProductos(v){
  return (v.adicionalProductos||[]).reduce((s,pr)=>s+Number(pr.precio||0),0);
}
// Única fuente de verdad para el total de una fila de crédito: servicio + valor
// manual + productos agregados. TODO el resto del código (la caja "Total crédito",
// el listado de pendientes por empresa, el Excel y el cobro) pasa por aquí, para
// que no se vuelva a desincronizar como pasó antes.
function _totalCreditoFila(v){
  return Number(v.valor||0)+Number(v.adicionalValor||0)+_totalAdicionalProductos(v);
}
function _descripcionAdicionalCompleta(v){
  const items=v.adicionalProductos||[];
  const conteo={}; const orden=[];
  items.forEach(pr=>{
    if(!(pr.nombre in conteo)){ conteo[pr.nombre]=0; orden.push(pr.nombre); }
    conteo[pr.nombre]++;
  });
  const nombresProductos=orden.map(n=>conteo[n]>1?`(${conteo[n]}) ${n}`:n).join(", ");
  return [v.adicionalDesc,nombresProductos].filter(Boolean).join(", ");
}
function _renderTagsProductosCredito(id,i,v,disabled){
  const items=v.adicionalProductos||[];
  if(!items.length) return '';
  return `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">`+items.map(pr=>`<span style="display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid #f0d998;border-radius:999px;padding:4px 6px 4px 12px;font-size:12px;font-weight:700;color:#243044;">${sanitizarTexto(pr.nombre)} · $${fmtMiles(pr.precio)||'0'}${disabled?'':` <button onclick="_eliminarProductoDeCredito('${id}',${i},'${pr.id}')" title="Quitar" style="background:#fca5a5;color:#7f1d1d;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;font-weight:800;cursor:pointer;padding:0;line-height:1;margin:0;">✕</button>`}</span>`).join('')+`</div>`;
}
function _filaCreditoHTML(id,i,v,disabled){
  const emp=_empresaCreditoDeFila(v);
  const bloqueProductoBD=(negocio.productos||[]).length?`<div style="width:170px;">
          <label style="font-size:11px;color:var(--gris);display:block;margin-bottom:3px;">+ Producto guardado</label>
          <input type="text" id="adProd_${id}_${i}" list="dlProductos" placeholder="Nombre..." autocomplete="off" ${disabled}
            style="width:100%;"
            onkeydown="if(event.key==='Enter'){event.preventDefault();_agregarProductoACredito('${id}',${i});}"
            onchange="_agregarProductoACredito('${id}',${i})">
        </div>`:'';
  return `<tr id="filaCred_${id}_${i}" class="fila-credito">
    <td colspan="9">
      <div style="display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;padding:8px 4px;">
        <span id="filaCredBadge_${id}_${i}" style="font-weight:700;font-size:12px;color:#9a6b00;white-space:nowrap;padding-top:8px;">${emp?('💳 Crédito — '+cap(sanitizarTexto(emp))):''}</span>
        <div style="flex:1;min-width:220px;">
          <label style="font-size:11px;color:var(--gris);display:block;margin-bottom:3px;">Adicional (frenos, productos, etc. — se suma al crédito, no a la liquidación)</label>
          <textarea id="adDesc_${id}_${i}" ${disabled} rows="1" placeholder="Ej: 1 grasa de fibra, 1 tapón para candado"
            style="width:100%;resize:none;overflow:hidden;padding:8px 10px;font-size:13px;line-height:1.4;"
            oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px';actualizarFila('${id}',${i},'adicionalDesc',this.value)">${sanitizarTexto(v.adicionalDesc||'')}</textarea>
        </div>
        <div style="width:150px;">
          <label style="font-size:11px;color:var(--gris);display:block;margin-bottom:3px;">Valor adicional</label>
          <input type="text" inputmode="numeric" id="adVal_${id}_${i}" value="${v.adicionalValor>0?fmtMiles(v.adicionalValor):(v.adicionalValorRaw?fmtMiles(Number(String(v.adicionalValorRaw).replace(/\./g,'').replace(/,/g,''))):'')}" ${disabled} autocomplete="off"
            oninput="_formatearValorEnVivo(this);actualizarAdicionalValorFila('${id}',${i},this.value.replace(/\\./g,''))"
            onfocus="if(this.value)this.select()"
            onblur="(function(el){if(el.value){var s=el.value.replace(/\\./g,'').replace(/,/g,'');var n=Number(s);if(!isNaN(n)&&n>0){var v=n<1000?n*1000:n;el.value=fmtMiles(v);}}})(this)"
            placeholder="0" style="width:100%;">
        </div>
        <div style="width:150px;">
          <label style="font-size:11px;color:var(--gris);display:block;margin-bottom:3px;">Total crédito</label>
          <div id="credTotalFila_${id}_${i}" style="padding:8px 10px;background:#fff;color:#243044;border-radius:8px;font-weight:700;font-size:13px;border:1px solid #f0d998;">$${fmtMiles(_totalCreditoFila(v))||'0'}</div>
        </div>
        ${bloqueProductoBD}
        <div id="prodTags_${id}_${i}" style="width:100%;">${_renderTagsProductosCredito(id,i,v,disabled)}</div>
      </div>
    </td>
  </tr>`;
}
// Inserta/quita la fila de "adicional" sin re-renderizar toda la tabla (se llama
// cada vez que cambia el texto de Observaciones de una fila).
function _actualizarVisibilidadCreditoFila(id,i){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  const v=pl.vehiculos[i]; if(!v) return;
  const disabled=pl.liquidada?"disabled":"";
  const emp=_empresaCreditoDeFila(v);
  const filaPrincipal=document.getElementById(`fila_${id}_${i}`);
  const filaCred=document.getElementById(`filaCred_${id}_${i}`);
  if(emp&&!filaCred&&filaPrincipal){
    filaPrincipal.insertAdjacentHTML('afterend', _filaCreditoHTML(id,i,v,disabled));
  } else if(!emp&&filaCred){
    filaCred.remove();
  } else if(emp&&filaCred){
    const badge=document.getElementById(`filaCredBadge_${id}_${i}`);
    if(badge) badge.textContent='💳 Crédito — '+cap(sanitizarTexto(emp));
    _actualizarTotalCreditoFila(id,i);
  }
}
function _actualizarTotalCreditoFila(id,i){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl||!pl.vehiculos[i]) return;
  const el=document.getElementById(`credTotalFila_${id}_${i}`);
  if(el) el.textContent="$"+(fmtMiles(_totalCreditoFila(pl.vehiculos[i]))||'0');
}
// El valor adicional NUNCA entra a recalcularTotal()/pl.total: no afecta la
// liquidación de los engrasadores, solo se suma al crédito de la empresa.
function actualizarAdicionalValorFila(id,i,raw){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl||!pl.vehiculos[i]) return;
  const num=Number(raw); const valor=(!isNaN(num)&&num>0&&num<1000)?num*1000:num;
  pl.vehiculos[i].adicionalValorRaw=raw; pl.vehiculos[i].adicionalValor=isNaN(valor)?0:valor;
  _actualizarTotalCreditoFila(id,i);
  _programarAutoguardarPlanilla(id);
}
// Agrega un producto de la base de precios al "Valor adicional" de una fila de
// crédito, sin reemplazar lo que ya haya (manual o de otros productos) — se suma.
function _agregarProductoACredito(id,i){
  const inp=document.getElementById(`adProd_${id}_${i}`); if(!inp) return;
  const nombre=(inp.value||"").trim();
  if(!nombre) return;
  const prod=(negocio.productos||[]).find(p=>p.nombre.toLowerCase()===nombre.toLowerCase());
  if(!prod){ toast(`No se encontró "${sanitizarTexto(nombre)}" en la lista de precios`,"error"); return; }
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl||!pl.vehiculos[i]) return;
  const v=pl.vehiculos[i];
  if(!v.adicionalProductos) v.adicionalProductos=[];
  const precio=Number(prod.precioVenta||0);
  v.adicionalProductos.push({id:generarId(),nombre:prod.nombre,precio});
  inp.value="";
  const tagsCont=document.getElementById(`prodTags_${id}_${i}`);
  if(tagsCont) tagsCont.innerHTML=_renderTagsProductosCredito(id,i,v,pl.liquidada?"disabled":"");
  _actualizarTotalCreditoFila(id,i);
  guardar(); _programarAutoguardarPlanilla(id);
  toast(`${cap(sanitizarTexto(prod.nombre))} agregado ✅ ($${fmtMiles(precio)||'0'})`,"ok");
}
// Quita un producto agregado (su etiqueta) de una fila de crédito y ajusta el total.
function _eliminarProductoDeCredito(id,i,prodId){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl||!pl.vehiculos[i]) return;
  const v=pl.vehiculos[i];
  if(!v.adicionalProductos||!v.adicionalProductos.length) return;
  v.adicionalProductos=v.adicionalProductos.filter(pr=>pr.id!==prodId);
  const tagsCont=document.getElementById(`prodTags_${id}_${i}`);
  if(tagsCont) tagsCont.innerHTML=_renderTagsProductosCredito(id,i,v,pl.liquidada?"disabled":"");
  _actualizarTotalCreditoFila(id,i);
  guardar(); _programarAutoguardarPlanilla(id);
  toast("Producto quitado del crédito","ok");
}
function _poblarDatalistProductos(){
  const dl=document.getElementById("dlProductos"); if(!dl) return;
  dl.innerHTML=(negocio?.productos||[]).map(p=>`<option value="${cap(sanitizarTexto(p.nombre))}"></option>`).join("");
}

function renderFilasPlanilla(id) {
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  const tbody=document.getElementById(`tbody_${id}`); if(!tbody) return;
  // Todos los engrasadores registrados; los titulares del encabezado quedan de primeros
  const nombresE=_opcionesEngrasadorFila(pl);
  const optsE=`<option value="">-</option>`+nombresE.map(n=>`<option value="${n}">${n}</option>`).join("");
  const disabled=pl.liquidada?"disabled":""
  const claseFila=v=>(v.tipoEngrase==='mixto'||v.tipoEngrase==='mixto_r')?'fila-resaltada':'';
  tbody.innerHTML=(pl.vehiculos||[]).map((v,i)=>{
    const filaPrincipal=`<tr id="fila_${id}_${i}" class="${claseFila(v)}">
    <td class="num-fila">${i+1}</td>
    <td><input type="text" value="${formatPlaca(v.placa)}" ${disabled} autocomplete="off" oninput="const c=this.value.toUpperCase().replace(/[^A-Z0-9]/g,'');this.value=c.length>3?c.slice(0,3)+' '+c.slice(3):c;actualizarFila('${id}',${i},'placa',this.value)" id="pl_${id}_${i}" placeholder="ABC 123" style="width:100%;text-transform:uppercase;"></td>
    <td><input type="text" value="${capPrimera(v.tipoVehiculo||'')}" ${disabled} autocomplete="off" oninput="this.value=capPrimera(this.value);actualizarFila('${id}',${i},'tipoVehiculo',this.value)" id="tv_${id}_${i}" placeholder="Mula, Camión..." style="width:100%;"></td>
    <td><input type="text" value="${capPrimera(v.descripcion||'')}" ${disabled} autocomplete="off" oninput="this.value=capPrimera(this.value);actualizarFila('${id}',${i},'descripcion',this.value)" id="de_${id}_${i}" placeholder="General, Crucetas..." style="width:100%;"></td>
    <td><select ${disabled} onchange="actualizarFila('${id}',${i},'tipoEngrase',this.value);recalcularTotal('${id}');_actualizarColorFila('${id}',${i},this.value)">
      <option value="mixto" ${v.tipoEngrase==='mixto'?'selected':''}>Sintético</option>
      <option value="azul" ${(!v.tipoEngrase||v.tipoEngrase==='azul')?'selected':''}>Azul</option>
      <option value="mixto_r" ${v.tipoEngrase==='mixto_r'?'selected':''}>Mixto</option>
    </select></td>
    <td>
      <input type="text" inputmode="numeric" id="vl_${id}_${i}" value="${v.valor>0?fmtMiles(v.valor):(v.valorRaw?fmtMiles(Number(String(v.valorRaw).replace(/\./g,'').replace(/,/g,''))):''  )}" ${disabled} autocomplete="off"
        oninput="_formatearValorEnVivo(this);actualizarValorFila('${id}',${i},this.value.replace(/\\./g,''))"
        onfocus="if(this.value)this.select()"
        onblur="(function(el){if(el.value){var s=el.value.replace(/\\./g,'').replace(/,/g,'');var n=Number(s);if(!isNaN(n)&&n>0){var v=n<1000?n*1000:n;el.value=fmtMiles(v);}}})(this)"
        onkeydown="if(event.key==='Tab'){}"
        placeholder="" style="width:100%;">
    </td>
    <td><select id="rowE_${id}_${i}" ${disabled} onchange="actualizarFila('${id}',${i},'engrasador',this.value)">
      ${optsE.replace(`value="${v.engrasador}"`,`value="${v.engrasador}" selected`)}
    </select></td>
    <td><input type="text" value="${capPrimera(v.observaciones||'')}" ${disabled} autocomplete="off" oninput="this.value=capPrimera(this.value);actualizarFila('${id}',${i},'observaciones',this.value);_actualizarVisibilidadCreditoFila('${id}',${i})" id="ob_${id}_${i}" placeholder="Opcional" style="width:100%;"></td>
    <td class="col-del">${!pl.liquidada?`<button class="btn-rojo btn-icon" onclick="eliminarFilaPlanilla('${id}',${i})">✕</button>`:""}</td>
  </tr>`;
    const emp=_empresaCreditoDeFila(v);
    return filaPrincipal+(emp?_filaCreditoHTML(id,i,v,disabled):'');
  }).join("");

  // Forzar formato de miles SINCRONO (inmediato, antes de cualquier evento)
  (pl.vehiculos||[]).forEach((v,j)=>{
    const vEl=document.getElementById(`vl_${id}_${j}`);
    if(!vEl) return;
    const n=v.valor>0?v.valor:(v.valorRaw?Number(String(v.valorRaw).replace(/\./g,'').replace(/,/g,'')):0);
    if(n>0) vEl.value=fmtMiles(n<1000?n*1000:n);
  });
  // Autocomplete en 4 campos de texto (solo planillas activas)
  if (!pl.liquidada) {
    (pl.vehiculos||[]).forEach((v,i)=>{
      const plEl=document.getElementById(`pl_${id}_${i}`);
      const tvEl=document.getElementById(`tv_${id}_${i}`);
      const deEl=document.getElementById(`de_${id}_${i}`);
      const obEl=document.getElementById(`ob_${id}_${i}`);
      if(plEl) setupAC(plEl,[], val=>{ actualizarFila(id,i,'placa',val); agregarMemoria('placas',val); }, 'placas', 7);
      if(tvEl) setupAC(tvEl,[], val=>{ actualizarFila(id,i,'tipoVehiculo',val); agregarMemoria('tipos_vehiculo',val); }, 'tipos_vehiculo');
      if(deEl) setupAC(deEl,[], val=>{ actualizarFila(id,i,'descripcion',val); agregarMemoria('descripciones',val); }, 'descripciones');
      if(obEl) setupAC(obEl,["Efectivo","Transferencia",...(negocio.creditos?.empresas||[])], val=>{ actualizarFila(id,i,'observaciones',val); _actualizarVisibilidadCreditoFila(id,i); }, null);
      const vlEl=document.getElementById(`vl_${id}_${i}`);
      if(vlEl) setupAC(vlEl,[], val=>{ actualizarValorFila(id,i,val); }, 'precios');
    });
  }
  recalcularTotal(id);
  // Post-render: forzar formato de miles en todos los campos valor
  setTimeout(()=>{
    (pl.vehiculos||[]).forEach((_,j)=>{
      const el=document.getElementById(`vl_${id}_${j}`);
      if(el&&el.value){
        const s=el.value.replace(/\./g,'').replace(/,/g,'');
        const n=Number(s);
        if(!isNaN(n)&&n>0)el.value=fmtMiles(n<1000?n*1000:n);
      }
      const ta=document.getElementById(`adDesc_${id}_${j}`);
      if(ta){ ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px'; }
    });
  },0);
}

function actualizarFila(id,i,campo,valor){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl||!pl.vehiculos[i]) return;
  if(campo==="placa") valor=formatPlaca(valor);
  pl.vehiculos[i][campo]=valor;
  // memoria se guarda en blur (setupAC), no en cada tecla
  _programarAutoguardarPlanilla(id);
}
function actualizarValorFila(id,i,raw){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl||!pl.vehiculos[i]) return;
  const num=Number(raw); const valor=(!isNaN(num)&&num>0&&num<1000)?num*1000:num;
  pl.vehiculos[i].valorRaw=raw; pl.vehiculos[i].valor=valor; recalcularTotal(id);
  _actualizarTotalCreditoFila(id,i);
  if(raw&&raw.trim()&&valor>0) agregarMemoria("precios",fmtMiles(valor));
  _programarAutoguardarPlanilla(id);
}
function recalcularTotal(id){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  const total=(pl.vehiculos||[]).reduce((s,v)=>s+Number(v.valor||0),0);
  pl.total=total;
  const el=document.getElementById(`totalNum_${id}`); if(el) el.innerText="$"+total.toLocaleString();
}
function agregarFilaPlanilla(id, cantidad){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl||pl.liquidada) return;
  if(!pl.vehiculos) pl.vehiculos=[];
  let n=Math.floor(Number(cantidad));
  if(!Number.isFinite(n)||n<1) n=1;
  if(n>50) n=50; // límite razonable para evitar agregar cientos de filas por error
  const filaInicial=pl.vehiculos.length;
  for(let k=0;k<n;k++){
    pl.vehiculos.push({placa:"",tipoVehiculo:"",descripcion:"",tipoEngrase:"azul",valor:0,valorRaw:"",engrasador:"",observaciones:"",adicionalDesc:"",adicionalValor:0,adicionalValorRaw:"",adicionalProductos:[],creditoCobrado:false,creditoCobroId:null});
  }
  renderFilasPlanilla(id);
  setTimeout(()=>{
    const primeraNueva=document.getElementById(`fila_${id}_${filaInicial}`);
    const inp=primeraNueva?.querySelector("input");
    if(inp) inp.focus();
  },50);
}
function eliminarFilaPlanilla(id,i){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  const v=pl.vehiculos[i];
  const emp=v?_empresaCreditoDeFila(v):null;
  const totalCred=v?_totalCreditoFila(v):0;
  const borrar=()=>{ pl.vehiculos.splice(i,1); renderFilasPlanilla(id); _autoguardarPlanilla(id); };
  if(emp&&!v.creditoCobrado&&totalCred>0){
    confirmar("Eliminar servicio a crédito",`Este servicio está pendiente de cobro a ${cap(sanitizarTexto(emp))} por $${fmtMiles(totalCred)||'0'}. Si lo eliminas, también se quita de lo pendiente por cobrar. ¿Eliminar de todos modos?`,borrar);
  } else {
    confirmar("Eliminar fila","¿Eliminar esta fila de la planilla?",borrar);
  }
}
let _autosaveTimersPlanilla = {};
function _programarAutoguardarPlanilla(id){
  const pl=negocio.planillas.find(p=>p.id===id);
  if(!pl||pl.liquidada) return; // no autoguardar planillas ya liquidadas
  clearTimeout(_autosaveTimersPlanilla[id]);
  _autosaveTimersPlanilla[id]=setTimeout(()=>_autoguardarPlanilla(id), 1200);
}
async function _autoguardarPlanilla(id){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  recalcularTotal(id); guardar();
  const r=await guardarEvento({tipoRegistro:"planilla",planilla:pl},pl.total,0);
  if(!r||!r.ok) toast("⚠️ Sin conexión: los cambios de la planilla se guardaron solo en este dispositivo","aviso");
}
async function guardarPlanilla(id){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  recalcularTotal(id); guardar();
  renderTabsPlanillas(); mostrarListaPlanillas(); // Actualizar UI de inmediato
  const r=await guardarEvento({tipoRegistro:"planilla",planilla:pl},pl.total,0);
  toast(r.ok?"Planilla guardada ":"Guardada localmente (fallo nube)",r.ok?"ok":"aviso");
}
function eliminarPlanilla(id){
  const pl=negocio.planillas.find(p=>p.id===id);
  const pendienteCredito=pl?(pl.vehiculos||[]).filter(v=>{const e=_empresaCreditoDeFila(v);return e&&!v.creditoCobrado;}).reduce((s,v)=>s+_totalCreditoFila(v),0):0;
  const msgEliminar=pendienteCredito>0?`¿Eliminar esta planilla? Tiene $${fmtMiles(pendienteCredito)||'0'} en servicios a crédito pendientes de cobro que también se eliminarán.`:"¿Eliminar esta planilla?";
  confirmar("Eliminar planilla",msgEliminar,async()=>{
    negocio.planillas=(negocio.planillas||[]).filter(p=>p.id!==id);
    // Respaldo local: guardar IDs eliminados para que no reaparezcan aunque falle la nube
    if(!negocio.planillasEliminadas) negocio.planillasEliminadas=[];
    if(!negocio.planillasEliminadas.includes(id)) negocio.planillasEliminadas.push(id);
    cerrarPestania(id,null); guardar(); mostrarListaPlanillas(); toast("Planilla eliminada","ok");
    const r=await guardarEvento({tipoRegistro:"eliminarPlanilla",planillaId:id});
    if(!r||!r.ok) toast("⚠️ Sin conexión: eliminación guardada localmente, pero no en la nube.","error");
  });
}

// ══════════════════════════════════════════════════════════
//  CRÉDITOS — página (empresas, cobro y Excel para enviar)
// ══════════════════════════════════════════════════════════
let _empresaCreditoExpandida = null; // nombre de la empresa cuyo panel de pendientes está abierto
let _seleccionCredito = new Set();   // claves "planillaId|indice" marcadas para cobrar

function agregarEmpresaCredito(){
  const input=document.getElementById("nombreEmpresaCredito");
  const nombre=(input?.value||"").trim();
  if(!nombre){toast("Escribe el nombre de la empresa","error");return;}
  if(nombre.length>60){toast("El nombre es demasiado largo (máx 60 caracteres)","error");return;}
  if(!negocio.creditos) negocio.creditos={empresas:[],historial:[]};
  const nombreNorm=nombre.toLowerCase();
  if(negocio.creditos.empresas.some(e=>e.toLowerCase()===nombreNorm)){
    toast("Ya existe una empresa con ese nombre","error");return;
  }
  negocio.creditos.empresas.push(nombre);
  input.value="";
  guardar(); actualizarTodo();
  toast("Empresa agregada ✅ — ya aparece en Observaciones","ok");
  guardarEvento({tipoRegistro:"creditos",creditos:negocio.creditos});
}
function eliminarEmpresaCredito(idx){
  const emp=(negocio.creditos?.empresas||[])[idx]; if(emp==null) return;
  const pendientes=_serviciosPendientesCredito(emp);
  if(pendientes.length){
    toast(`No puedes eliminar ${cap(sanitizarTexto(emp))}: tiene ${pendientes.length} servicio(s) pendiente(s) de cobro`,"error");
    return;
  }
  confirmar("Eliminar empresa",`¿Eliminar a ${cap(sanitizarTexto(emp))} de las empresas de crédito? (No borra su historial de cobros ya hechos)`,()=>{
    negocio.creditos.empresas=negocio.creditos.empresas.filter((e,i)=>i!==idx);
    if(_empresaCreditoExpandida===emp) _empresaCreditoExpandida=null;
    guardar(); actualizarTodo();
    toast("Empresa eliminada","ok");
    guardarEvento({tipoRegistro:"creditos",creditos:negocio.creditos});
  });
}
function toggleEmpresaCredito(idx){
  const emp=(negocio.creditos?.empresas||[])[idx]; if(emp==null) return;
  _empresaCreditoExpandida=(_empresaCreditoExpandida===emp)?null:emp;
  _seleccionCredito=new Set();
  mostrarCreditos();
}
// Recorre TODAS las planillas (no solo las pestañas abiertas) buscando filas
// de esta empresa que aún no se hayan cobrado.
function _serviciosPendientesCredito(empresa){
  const items=[];
  (negocio.planillas||[]).forEach(pl=>{
    (pl.vehiculos||[]).forEach((v,i)=>{
      const emp=_empresaCreditoDeFila(v);
      if(emp&&emp.toLowerCase()===String(empresa).toLowerCase()&&!v.creditoCobrado){
        const total=_totalCreditoFila(v);
        if(total>0){
          items.push({
            clave:pl.id+"|"+i, planillaId:pl.id, indice:i,
            fecha:pl.fecha, placa:formatPlaca(v.placa)||"—",
            descripcion:[v.descripcion,_descripcionAdicionalCompleta(v)].filter(Boolean).join(", ")||"—",
            total
          });
        }
      }
    });
  });
  items.sort((a,b)=>_parseFechaPlanilla(a.fecha)-_parseFechaPlanilla(b.fecha)); // mas antiguo primero, mas reciente al final
  return items;
}
function toggleSeleccionCredito(clave, checked){
  if(checked) _seleccionCredito.add(clave); else _seleccionCredito.delete(clave);
  const el=document.getElementById("totalSeleccionCredito");
  if(el&&_empresaCreditoExpandida){
    const items=_serviciosPendientesCredito(_empresaCreditoExpandida);
    const total=items.filter(it=>_seleccionCredito.has(it.clave)).reduce((s,it)=>s+it.total,0);
    el.textContent="$"+(fmtMiles(total)||'0');
  }
}
function toggleSeleccionarTodosCredito(checked){
  if(!_empresaCreditoExpandida) return;
  const items=_serviciosPendientesCredito(_empresaCreditoExpandida);
  _seleccionCredito=new Set(checked?items.map(it=>it.clave):[]);
  mostrarCreditos();
}
// Paso 1: genera y descarga el Excel de los servicios seleccionados PARA COBRAR.
// No cambia nada del estado — los servicios siguen apareciendo como pendientes
// hasta que se confirme que la empresa efectivamente pagó (ver confirmarCobroCredito).
function generarExcelPendienteCredito(){
  const empresa=_empresaCreditoExpandida; if(!empresa) return;
  const items=_serviciosPendientesCredito(empresa).filter(it=>_seleccionCredito.has(it.clave));
  if(!items.length){toast("Selecciona al menos un servicio","error");return;}
  const total=items.reduce((s,it)=>s+it.total,0);
  const registro={
    empresa, fecha:new Date().toLocaleString(),
    servicios:items.map(({fecha,placa,descripcion,total})=>({fecha,placa,descripcion,total})),
    total
  };
  _descargarExcelCredito(registro);
  toast(`Excel generado — ${cap(sanitizarTexto(empresa))}: $${fmtMiles(total)||'0'}. Siguen pendientes hasta confirmar el pago.`,"ok");
}
// Paso 2: se usa DESPUÉS de que la empresa ya pagó. Recién ahí se marcan los
// servicios como cobrados, se archivan en el historial y salen de pendientes.
function confirmarCobroCredito(){
  const empresa=_empresaCreditoExpandida; if(!empresa) return;
  const items=_serviciosPendientesCredito(empresa).filter(it=>_seleccionCredito.has(it.clave));
  if(!items.length){toast("Selecciona al menos un servicio","error");return;}
  const total=items.reduce((s,it)=>s+it.total,0);
  confirmar("Confirmar cobro",`¿Confirmas que ${cap(sanitizarTexto(empresa))} ya pagó $${fmtMiles(total)||'0'}? Estos ${items.length} servicio(s) se archivarán como cobrados y dejarán de aparecer como pendientes.`,()=>{
    const idCobro=generarId();
    items.forEach(it=>{
      const pl=negocio.planillas.find(p=>p.id===it.planillaId);
      const v=pl?.vehiculos?.[it.indice]; if(!v) return;
      v.creditoCobrado=true; v.creditoCobroId=idCobro;
    });
    const registro={
      id:idCobro, empresa, fecha:new Date().toLocaleString(),
      servicios:items.map(({fecha,placa,descripcion,total})=>({fecha,placa,descripcion,total})),
      total, creadoPor:perfilActivo()
    };
    if(!negocio.creditos.historial) negocio.creditos.historial=[];
    negocio.creditos.historial.unshift(registro);
    _seleccionCredito=new Set();
    guardar(); actualizarTodo();
    toast(`Cobro confirmado: $${fmtMiles(total)||'0'} — ${cap(sanitizarTexto(empresa))}`,"ok");
    const planillasAfectadas=new Set(items.map(it=>it.planillaId));
    planillasAfectadas.forEach(pid=>{
      const pl=negocio.planillas.find(p=>p.id===pid);
      if(pl) guardarEvento({tipoRegistro:"planilla",planilla:pl},pl.total,0);
    });
    guardarEvento({tipoRegistro:"creditos",creditos:negocio.creditos});
  });
}
// ══════════════════════════════════════════════════════════
//  Generador de .xlsx real (OOXML) sin librerías externas.
//  Construye el ZIP a mano (método STORE, sin compresión) — mismo código
//  que se copia literal al navegador dentro de index.html.
// ══════════════════════════════════════════════════════════
const _crcTabla = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function _crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _crcTabla[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function _u16(n){ return [n & 0xFF, (n >>> 8) & 0xFF]; }
function _u32(n){ return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
function _concatBytes(arrs){
  let total = 0; arrs.forEach(a => total += a.length);
  const out = new Uint8Array(total); let o = 0;
  arrs.forEach(a => { out.set(a, o); o += a.length; });
  return out;
}
// files: [{name:'xl/workbook.xml', data:Uint8Array}]  -> Uint8Array del .zip completo (sin compresión)
function _crearZip(files){
  const enc = new TextEncoder();
  const dosTime = 0, dosDate = 0x0021; // fecha fija, no relevante para Excel
  const locales = [], centrales = [];
  let offset = 0;
  files.forEach(f => {
    const nombre = enc.encode(f.name);
    const datos = f.data;
    const crc = _crc32(datos), tam = datos.length;
    const cabeceraLocal = new Uint8Array([
      ..._u32(0x04034b50), ..._u16(20), ..._u16(0), ..._u16(0), ..._u16(dosTime), ..._u16(dosDate),
      ..._u32(crc), ..._u32(tam), ..._u32(tam), ..._u16(nombre.length), ..._u16(0)
    ]);
    locales.push(_concatBytes([cabeceraLocal, nombre, datos]));
    const cabeceraCentral = new Uint8Array([
      ..._u32(0x02014b50), ..._u16(20), ..._u16(20), ..._u16(0), ..._u16(0), ..._u16(dosTime), ..._u16(dosDate),
      ..._u32(crc), ..._u32(tam), ..._u32(tam), ..._u16(nombre.length), ..._u16(0), ..._u16(0),
      ..._u16(0), ..._u16(0), ..._u32(0), ..._u32(offset)
    ]);
    centrales.push(_concatBytes([cabeceraCentral, nombre]));
    offset += cabeceraLocal.length + nombre.length + datos.length;
  });
  const inicioCentral = offset;
  let tamCentral = 0; centrales.forEach(c => tamCentral += c.length);
  const eocd = new Uint8Array([
    ..._u32(0x06054b50), ..._u16(0), ..._u16(0), ..._u16(files.length), ..._u16(files.length),
    ..._u32(tamCentral), ..._u32(inicioCentral), ..._u16(0)
  ]);
  return _concatBytes([...locales, ...centrales, eocd]);
}
function _xmlEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function _utf8Bytes(s){ const enc=new TextEncoder(); return enc.encode(s); }

// ─── Construcción del libro de crédito ───────────────────────────────────
const FUENTES = [
  {sz:11,color:'FF1A1A1A'},                             // 0 normal
  {sz:20,bold:1,color:'FFFFFFFF'},                       // 1 título
  {sz:12,bold:1,color:'FFF3B62A'},                       // 2 subtítulo
  {sz:11,bold:1,color:'FF111827'},                       // 3 etiqueta/encabezado
  {sz:14,bold:1,color:'FF111827'},                       // 4 nombre empresa
  {sz:13,bold:1,color:'FFFFFFFF'},                       // 5 total
  {sz:9,italic:1,color:'FF808080'},                      // 6 nota
];
const RELLENOS = [
  {tipo:'none'},                                         // 0 (reservado)
  {tipo:'gray125'},                                      // 1 (reservado)
  {tipo:'solid',color:'FF111827'},                       // 2 oscuro
  {tipo:'solid',color:'FFF3B62A'},                       // 3 dorado
  {tipo:'solid',color:'FFEDEDED'},                       // 4 gris etiqueta
  {tipo:'solid',color:'FFF7F7F7'},                       // 5 cebra
];
const BORDES = [
  {},                                                     // 0 sin borde
  {todos:'FF444444'},                                    // 1 fino gris
];
const NUMFMT_MONEDA = 164;
const CELLXFS = [
  {f:0,r:0,b:0,align:'left',valign:'center'},                                   // 0 default
  {f:1,r:2,b:0,align:'left',valign:'center'},                                   // 1 título
  {f:2,r:2,b:0,align:'left',valign:'center'},                                   // 2 subtítulo
  {f:3,r:4,b:0,align:'left',valign:'center'},                                   // 3 etiqueta
  {f:0,r:0,b:0,align:'left',valign:'center'},                                   // 4 dato normal
  {f:4,r:0,b:0,align:'left',valign:'center'},                                   // 5 empresa (dato grande)
  {f:3,r:3,b:1,align:'center',valign:'center'},                                 // 6 encabezado tabla
  {f:0,r:0,b:1,align:'center',valign:'center'},                                 // 7 celda centrada
  {f:0,r:5,b:1,align:'center',valign:'center'},                                 // 8 celda centrada cebra
  {f:0,r:0,b:1,align:'left',valign:'center',wrap:1},                            // 9 celda izquierda (desc)
  {f:0,r:5,b:1,align:'left',valign:'center',wrap:1},                            // 10 celda izquierda cebra
  {f:0,r:0,b:1,align:'right',valign:'center',numFmt:NUMFMT_MONEDA},             // 11 total fila
  {f:0,r:5,b:1,align:'right',valign:'center',numFmt:NUMFMT_MONEDA},             // 12 total fila cebra
  {f:5,r:2,b:1,align:'right',valign:'center'},                                  // 13 etiqueta TOTAL
  {f:5,r:2,b:1,align:'right',valign:'center',numFmt:NUMFMT_MONEDA},             // 14 valor TOTAL
  {f:6,r:0,b:0,align:'left',valign:'center'},                                   // 15 nota pie
];
function _stylesXml(){
  const fontsXml = FUENTES.map(ft => `<font><sz val="${ft.sz}"/>${ft.bold?'<b/>':''}${ft.italic?'<i/>':''}<color rgb="${ft.color}"/><name val="Calibri"/></font>`).join('');
  const fillsXml = RELLENOS.map(fl => fl.tipo==='solid'
    ? `<fill><patternFill patternType="solid"><fgColor rgb="${fl.color}"/><bgColor indexed="64"/></patternFill></fill>`
    : `<fill><patternFill patternType="${fl.tipo}"/></fill>`).join('');
  const borderSide = c => c ? `<left style="thin"><color rgb="${c}"/></left><right style="thin"><color rgb="${c}"/></right><top style="thin"><color rgb="${c}"/></top><bottom style="thin"><color rgb="${c}"/></bottom>` : `<left/><right/><top/><bottom/>`;
  const bordersXml = BORDES.map(b => `<border>${borderSide(b.todos)}<diagonal/></border>`).join('');
  const cellXfsXml = CELLXFS.map(xf => {
    const numFmtId = xf.numFmt || 0;
    return `<xf numFmtId="${numFmtId}" fontId="${xf.f}" fillId="${xf.r}" borderId="${xf.b}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" ${numFmtId?'applyNumberFormat="1" ':''}applyAlignment="1"><alignment horizontal="${xf.align}" vertical="${xf.valign}" ${xf.wrap?'wrapText="1"':''}/></xf>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="${NUMFMT_MONEDA}" formatCode="&quot;$&quot;#,##0"/></numFmts>
<fonts count="${FUENTES.length}">${fontsXml}</fonts>
<fills count="${RELLENOS.length}">${fillsXml}</fills>
<borders count="${BORDES.length}">${bordersXml}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${CELLXFS.length}">${cellXfsXml}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}
function _celdaTxt(ref, s, texto){
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${_xmlEsc(texto)}</t></is></c>`;
}
function _celdaNum(ref, s, num){
  return `<c r="${ref}" s="${s}"><v>${Number(num)||0}</v></c>`;
}
function _hojaXml(empresa, servicios, total, fechaCobro){
  const filas = [];
  const merges = [];
  let r = 1;
  filas.push(`<row r="${r}" ht="34" customHeight="1">${_celdaTxt('A'+r,1,'EL DIAMANTE')}${['B','C','D'].map(c=>`<c r="${c}${r}" s="1"/>`).join('')}</row>`);
  merges.push(`A${r}:D${r}`); r++;
  filas.push(`<row r="${r}" ht="20" customHeight="1">${_celdaTxt('A'+r,2,'CUENTA DE COBRO — SERVICIOS A CRÉDITO')}${['B','C','D'].map(c=>`<c r="${c}${r}" s="2"/>`).join('')}</row>`);
  merges.push(`A${r}:D${r}`); r++;
  filas.push(`<row r="${r}" ht="8"></row>`); r++;
  const filaEtiqueta=(etq,val,estiloVal)=>{
    const rr=r;
    const l=`<row r="${rr}" ht="20" customHeight="1">${_celdaTxt('A'+rr,3,etq)}${_celdaTxt('B'+rr,estiloVal,val)}${['C','D'].map(c=>`<c r="${c}${rr}" s="${estiloVal}"/>`).join('')}</row>`;
    merges.push(`B${rr}:D${rr}`);
    r++;
    return l;
  };
  filas.push(filaEtiqueta('Cliente', empresa, 5));
  filas.push(filaEtiqueta('Fecha de cobro', fechaCobro, 4));
  filas.push(filaEtiqueta('N.º de servicios', String(servicios.length), 4));
  filas.push(`<row r="${r}" ht="8"></row>`); r++;
  const rEnc=r;
  filas.push(`<row r="${rEnc}" ht="22" customHeight="1">${_celdaTxt('A'+rEnc,6,'FECHA')}${_celdaTxt('B'+rEnc,6,'PLACA')}${_celdaTxt('C'+rEnc,6,'DESCRIPCIÓN')}${_celdaTxt('D'+rEnc,6,'TOTAL')}</row>`);
  r++;
  servicios.forEach((s,i)=>{
    const par=i%2===1;
    const sA=par?8:7, sC=par?10:9, sD=par?12:11;
    filas.push(`<row r="${r}">${_celdaTxt('A'+r,sA,s.fecha||'')}${_celdaTxt('B'+r,sA,s.placa||'')}${_celdaTxt('C'+r,sC,s.descripcion||'')}${_celdaNum('D'+r,sD,s.total||0)}</row>`);
    r++;
  });
  const rTot=r;
  filas.push(`<row r="${rTot}" ht="22" customHeight="1">${_celdaTxt('A'+rTot,13,'TOTAL A PAGAR')}${['B','C'].map(c=>`<c r="${c}${rTot}" s="13"/>`).join('')}${_celdaNum('D'+rTot,14,total)}</row>`);
  merges.push(`A${rTot}:C${rTot}`); r++;
  filas.push(`<row r="${r}">${_celdaTxt('A'+r,15,'Generado automáticamente por el sistema de EL DIAMANTE')}${['B','C','D'].map(c=>`<c r="${c}${r}" s="15"/>`).join('')}</row>`);
  merges.push(`A${r}:D${r}`); r++;
  const mergeXml = merges.length ? `<mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="12" customWidth="1"/><col min="3" max="3" width="40" customWidth="1"/><col min="4" max="4" width="14" customWidth="1"/></cols>
<sheetData>${filas.join('')}</sheetData>
${mergeXml}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}
function _sheetNameSeguro(empresa){
  return String(empresa||'Credito').replace(/[:\\\/\?\*\[\]]/g,' ').slice(0,31)||'Credito';
}
function _construirXlsxCredito(empresa, servicios, total, fechaCobro){
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  const relsRoot = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${_xmlEsc(_sheetNameSeguro(empresa))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const styles = _stylesXml();
  const sheet1 = _hojaXml(empresa, servicios, total, fechaCobro);
  const files = [
    {name:'[Content_Types].xml', data:_utf8Bytes(contentTypes)},
    {name:'_rels/.rels', data:_utf8Bytes(relsRoot)},
    {name:'xl/_rels/workbook.xml.rels', data:_utf8Bytes(workbookRels)},
    {name:'xl/workbook.xml', data:_utf8Bytes(workbook)},
    {name:'xl/styles.xml', data:_utf8Bytes(styles)},
    {name:'xl/worksheets/sheet1.xml', data:_utf8Bytes(sheet1)},
  ];
  return _crearZip(files);
}
function _descargarArchivoBinario(nombreArchivo, bytes, mime){
  const blob=new Blob([bytes],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=nombreArchivo;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function _descargarExcelCredito(registro){
  const bytes=_construirXlsxCredito(registro.empresa, registro.servicios, registro.total, registro.fecha);
  const nombreArchivo=`Credito_${String(registro.empresa).replace(/[^a-z0-9]+/gi,'_')}_${new Date().toISOString().slice(0,10)}.xlsx`;
  _descargarArchivoBinario(nombreArchivo, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
function redescargarExcelCredito(idCobro){
  const registro=(negocio.creditos?.historial||[]).find(r=>r.id===idCobro);
  if(!registro){toast("No se encontró ese cobro","error");return;}
  _descargarExcelCredito(registro);
}
function mostrarCreditos(){
  const cont=document.getElementById("listaEmpresasCredito"); if(!cont) return;
  if(!negocio.creditos) negocio.creditos={empresas:[],historial:[]};
  const empresas=negocio.creditos.empresas||[];
  if(!empresas.length){
    cont.innerHTML="<p style='color:var(--gris);'>No hay empresas de crédito registradas.</p>";
  } else {
    cont.innerHTML=empresas.map((emp,idx)=>{
      const pendientes=_serviciosPendientesCredito(emp);
      const totalPend=pendientes.reduce((s,it)=>s+it.total,0);
      const abierta=_empresaCreditoExpandida===emp;
      const filasTabla=pendientes.map(it=>`<tr>
        <td style="width:26px;padding:6px 8px;border-top:1px solid #eef1f5;"><input type="checkbox" ${_seleccionCredito.has(it.clave)?'checked':''} onchange="toggleSeleccionCredito('${it.clave}',this.checked)"></td>
        <td style="white-space:nowrap;padding:6px 16px 6px 8px;border-top:1px solid #eef1f5;">${sanitizarTexto(it.fecha)}</td>
        <td style="white-space:nowrap;padding:6px 16px;border-top:1px solid #eef1f5;">${sanitizarTexto(it.placa)}</td>
        <td style="padding:6px 8px;border-top:1px solid #eef1f5;">${sanitizarTexto(it.descripcion)}</td>
        <td style="text-align:right;white-space:nowrap;padding:6px 8px;border-top:1px solid #eef1f5;">$${fmtMiles(it.total)||'0'}</td>
      </tr>`).join("");
      const totalSeleccionado=pendientes.filter(it=>_seleccionCredito.has(it.clave)).reduce((s,it)=>s+it.total,0);
      const panel=abierta?`
        <div style="margin-top:10px;border-top:1px solid #e2e8f0;padding-top:10px;">
          ${pendientes.length?`
          <div style="overflow-x:auto;">
            <table style="width:100%;font-size:13px;border-collapse:separate;border-spacing:0;">
              <thead><tr>
                <th style="width:26px;padding:6px 8px;"><input type="checkbox" onchange="toggleSeleccionarTodosCredito(this.checked)" ${pendientes.every(it=>_seleccionCredito.has(it.clave))?'checked':''}></th>
                <th style="white-space:nowrap;text-align:left;padding:6px 16px 6px 8px;">Fecha</th><th style="white-space:nowrap;text-align:left;padding:6px 16px;">Placa</th><th style="padding:6px 8px;">Descripción</th><th style="white-space:nowrap;text-align:right;padding:6px 8px;">Total</th>
              </tr></thead>
              <tbody>${filasTabla}</tbody>
            </table>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;flex-wrap:wrap;gap:10px;">
            <span>Seleccionado: <strong id="totalSeleccionCredito">$${fmtMiles(totalSeleccionado)||'0'}</strong></span>
            <button class="btn-sm" onclick="generarExcelPendienteCredito()">📄 Generar Excel para cobrar</button>
            <button class="btn-verde btn-sm" onclick="confirmarCobroCredito()">✅ Confirmar cobro recibido</button>
          </div>`:`<p style="color:var(--gris);">Sin servicios pendientes.</p>`}
        </div>`:"";
      return `<div class="item" style="margin-bottom:10px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 style="margin:0;">${cap(sanitizarTexto(emp))}</h3>
            <p style="margin:2px 0 0;color:var(--gris);font-size:12px;">${pendientes.length} servicio(s) pendiente(s)</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <strong style="${totalPend>0?'color:var(--rojo);':''}">$${fmtMiles(totalPend)||'0'}</strong>
            <button class="btn-sm" onclick="toggleEmpresaCredito(${idx})">${abierta?'▲ Ocultar':'👁️ Ver pendientes'}</button>
            <button class="btn-rojo btn-sm" onclick="eliminarEmpresaCredito(${idx})">🗑️</button>
          </div>
        </div>
        ${panel}
      </div>`;
    }).join("");
  }

  const histCont=document.getElementById("listaHistorialCredito"); if(!histCont) return;
  const historial=negocio.creditos.historial||[];
  if(!historial.length){
    histCont.innerHTML="<p style='color:var(--gris);'>Sin cobros registrados todavía.</p>";
  } else {
    histCont.innerHTML=historial.map(r=>`<div class="item" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
      <div>
        <strong>${cap(sanitizarTexto(r.empresa))}</strong>
        <p style="margin:2px 0 0;color:var(--gris);font-size:12px;">${sanitizarTexto(r.fecha)} — ${r.servicios.length} servicio(s)${r.creadoPor?' — 👤 '+sanitizarTexto(r.creadoPor):''}</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <strong>$${fmtMiles(r.total)||'0'}</strong>
        <button class="btn-sm" onclick="redescargarExcelCredito('${r.id}')">📊 Excel</button>
      </div>
    </div>`).join("");
  }
}

// LISTA DE PLANILLAS GUARDADAS
let _filtroEngrasadorPlanilla = "";
function _liquidacionDePlanilla(id){
  const hist=negocio?.historial||[];
  for(let i=hist.length-1;i>=0;i--){ if(hist[i].planillaId===id) return hist[i]; }
  return null;
}
function _htmlDesgloseLiquidacion(liq){
  if(!liq) return "";
  const pagos=[[liq.trabajadorNombre1,liq.pagoTrabajador1],[liq.trabajadorNombre2,liq.pagoTrabajador2],[liq.trabajadorNombre3,liq.pagoTrabajador3],[liq.trabajadorNombre4,liq.pagoTrabajador4]]
    .filter(([n])=>n).map(([n,v])=>`${sanitizarTexto(n)}: $${fmtMiles(v)}`).join("<br>");
  return `Total: $${fmtMiles(liq.totalFinal)}<br>${pagos}`;
}
function _parseFechaPlanilla(f){
  if(!f) return 0;
  const m=String(f).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return 0;
  return Number(m[3])*10000+Number(m[2])*100+Number(m[1]);
}
function mostrarListaPlanillas(){
  const lista=document.getElementById("listaPlanillas"); if(!lista) return;
  // Las liquidadas ya no viven aquí — se van al Historial en cuanto se liquidan.
  const todasPlanillas=(negocio?.planillas||[]).filter(p=>!p.liquidada);

  // ── Construir opciones de filtro ──
  const todosEngrs=[...new Set(todasPlanillas.flatMap(p=>[p.engrasador1,p.engrasador2,p.engrasador3,p.engrasador4].filter(Boolean)))];
  const filDiv=document.getElementById("filtrosPlanillas");
  if(filDiv){
    filDiv.innerHTML=`
      <select id="selFiltroEngr" onchange="_filtroEngrasadorPlanilla=this.value;mostrarListaPlanillas()" style="width:auto;margin:0;padding:6px 10px;font-size:13px;">
        <option value="">👷 Todos</option>
        ${todosEngrs.map(e=>`<option value="${e}" ${_filtroEngrasadorPlanilla===e?'selected':''}>${cap(sanitizarTexto(e))}</option>`).join("")}
      </select>
    `;
  }

  // ── Aplicar filtros ──
  let planillas=todasPlanillas;
  if(_filtroEngrasadorPlanilla){
    planillas=planillas.filter(p=>[p.engrasador1,p.engrasador2,p.engrasador3,p.engrasador4].includes(_filtroEngrasadorPlanilla));
  }

  // Ordenar por fecha de la planilla (más reciente primero). Si dos tienen
  // la misma fecha, se respeta el orden de creación (sort estable + las
  // nuevas ya entran al inicio del arreglo con unshift en nuevaPlanilla()).
  planillas=planillas.slice().sort((a,b)=>_parseFechaPlanilla(b.fecha)-_parseFechaPlanilla(a.fecha));

  if(!planillas.length){lista.innerHTML="<p style='color:var(--gris);'>No hay planillas pendientes. Las liquidadas están en Historial.</p>";return;}
  lista.innerHTML=planillas.map(p=>{
    const total=(p.vehiculos||[]).reduce((s,v)=>s+Number(v.valor||0),0);
    const nVeh=(p.vehiculos||[]).length;
    const engrs=[p.engrasador1,p.engrasador2,p.engrasador3,p.engrasador4].filter(Boolean).join(" & ")||"Sin engrasadores";
    // Quita cualquier fecha vieja pegada al nombre (planillas creadas antes de este cambio)
    const nombreSinFecha=(p.nombre||p.fecha||"").replace(/\s*[—-]\s*\d{1,2}\/\d{1,2}\/\d{4}\s*$/,"");
    const nomSafe=sanitizarTexto(nombreSinFecha||p.fecha), fechaSafe=sanitizarTexto(p.fecha), engrsSafe=sanitizarTexto(engrs);
    return `<div class="planilla-card">
      <div class="planilla-card-header">
        <div>
          <div class="planilla-nombre">${nomSafe}</div>
          <div class="planilla-meta">
            <span>${engrsSafe}</span>
            <span>🚗 ${nVeh} servicio(s)</span>
            <span style="font-weight:700;color:var(--verde);">$${fmtMiles(total)}</span>
            ${p.creadoPor?`<span>👤 ${sanitizarTexto(p.creadoPor)}</span>`:''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;">
          <span class="planilla-fecha-grande">📅 ${fechaSafe}</span>
          <span class="badge-pendiente">⏳ Pendiente</span>
        </div>
      </div>
      <div class="planilla-acciones">
        <button class="btn-sm" onclick="abrirPestania('${p.id}')">✏️ Abrir</button>
        <button class="btn-verde btn-sm" onclick="liquidarDesdePlanilla('${p.id}')">⚡ Liquidar</button>
        <button class="btn-sm" onclick="imprimirPlanilla('${p.id}')">🖨️ PDF</button>
        <button class="btn-rojo btn-sm" onclick="eliminarPlanilla('${p.id}')">🗑️</button>
      </div>
    </div>`;
  }).join("");
}

function archivarLiquidadas(){
  const liquidadas=(negocio?.planillas||[]).filter(p=>p.liquidada);
  if(!liquidadas.length){toast("No hay planillas liquidadas para archivar","info");return;}
  const totalGen=liquidadas.reduce((s,pl)=>s+(pl.vehiculos||[]).reduce((ss,v)=>ss+Number(v.valor||0),0),0);
  const filas=liquidadas.map(pl=>{
    const veh=pl.vehiculos||[];
    const tot=veh.reduce((s,v)=>s+Number(v.valor||0),0);
    const engrs=[pl.engrasador1,pl.engrasador2,pl.engrasador3,pl.engrasador4].filter(Boolean).join(" & ")||"—";
    return `<tr><td>${pl.fecha}</td><td>${pl.nombre||pl.fecha}</td><td>${engrs}</td><td>${veh.length}</td><td>$${tot.toLocaleString()}</td></tr>`;
  }).join("");
  const ven=window.open("","_blank");
  ven.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Archivo liquidadas SYMES</title>
<style>
body{font-family:Arial,sans-serif;color:#243044;margin:20px;}
.hdr{background:linear-gradient(135deg,#1f3c88,#1f8a4c);color:#fff;padding:18px 22px;border-radius:12px;margin-bottom:18px;}
.hdr h1{margin:0 0 3px;font-size:24px;}.hdr p{margin:0;opacity:.88;font-size:13px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{background:#1f3c88;color:#fff;padding:8px;text-align:left;}
td{padding:7px 8px;border-bottom:1px solid #e2e8f0;}
tr:nth-child(even) td{background:#f8faff;}
.total{margin-top:16px;background:linear-gradient(135deg,#1f3c88,#1f8a4c);color:#fff;padding:12px 16px;border-radius:12px;font-weight:700;font-size:16px;display:flex;justify-content:space-between;}
.aviso{background:#fff7df;border:1.5px solid #f59e0b;border-radius:12px;padding:14px;margin:16px 0;color:#78350f;font-size:13px;}
.btn-arch{background:#1f3c88;color:#fff;border:none;padding:12px 24px;border-radius:12px;cursor:pointer;font-size:15px;font-weight:700;margin-right:10px;}
.btn-arch:hover{background:#162d6b;}
.cred{margin-top:28px;text-align:center;font-size:11px;color:#64748b;border-top:1px solid #dce3f0;padding-top:10px;}
@media print{.no-print{display:none;}}
</style></head><body>
<div class="hdr"><h1>SYMES</h1><p>Archivo de planillas liquidadas — ${negocio.nombreNegocio}</p></div>
<p><strong>Fecha:</strong> ${new Date().toLocaleString()} &nbsp; <strong>Planillas:</strong> ${liquidadas.length}</p>
<div class="aviso no-print">⚠️ Imprime o guarda este archivo antes de archivar. Una vez que hagas clic en <strong>"Archivar y eliminar"</strong>, estas planillas se borrarán de la app.</div>
<div class="no-print" style="margin-bottom:16px;">
  <button class="btn-arch" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
  <button class="btn-arch" style="background:#15803d;" onclick="if(window.opener&&!window.opener.closed){window.opener._confirmarArchivoLiquidadas();window.close();}else{alert('Cierra esta ventana y abre el archivo desde la app.');}">✅ Archivar y eliminar de la app</button>
</div>
<table><thead><tr><th>Fecha</th><th>Planilla</th><th>Engrasador(es)</th><th>Servicios</th><th>Total</th></tr></thead>
<tbody>${filas}</tbody></table>
<div class="total"><span>Total acumulado:</span><span>$${totalGen.toLocaleString()}</span></div>
<div class="cred">SYMES — Brandon Sebastian Arevalo Ojeda y Andrey Arévalo</div>
</body></html>`);
  ven.document.close();
}
function _confirmarArchivoLiquidadas(){
  const liquidadas=(negocio?.planillas||[]).filter(p=>p.liquidada);
  const ids=liquidadas.map(p=>p.id);
  negocio.planillas=(negocio.planillas||[]).filter(p=>!p.liquidada);
  if(!negocio.planillasEliminadas) negocio.planillasEliminadas=[];
  ids.forEach(id=>{if(!negocio.planillasEliminadas.includes(id))negocio.planillasEliminadas.push(id);});
  guardar(); mostrarListaPlanillas();
  toast("Planillas archivadas y eliminadas","ok");
  ids.forEach(id=>guardarEvento({tipoRegistro:"eliminarPlanilla",planillaId:id}));
}

// ══════════════════════════════════════════════════════════
//  LIQUIDAR DESDE PLANILLA (una sola)
// ══════════════════════════════════════════════════════════
function calcularResultadoPlanilla(pl) {
  const vehiculos=pl.vehiculos||[];
  const config=negocio.configuracion;
  const mixtos=vehiculos.filter(v=>!v.tipoEngrase||v.tipoEngrase==="mixto"||v.tipoEngrase==="mixto_r");
  const azules=vehiculos.filter(v=>v.tipoEngrase==="azul");
  const totalMixtosReb=mixtos.reduce((s,v)=>s+rebajarMixto(convertirValor(v.valorRaw!=null?v.valorRaw:v.valor)),0);
  const pctMixtos=totalMixtosReb*(Number(config.porcentajeMixtos)/100);
  const totalAzules=azules.reduce((s,v)=>s+convertirValor(v.valorRaw!=null?v.valorRaw:v.valor),0);
  const grasaGastada=(pl.grasaAntes||0)-(pl.grasaQuedo||0);
  const valorGrasa=(grasaGastada*Number(config.precioGrasa))/1000;
  const azulesMenos=totalAzules-valorGrasa;
  const pctAzules=azulesMenos*(Number(config.porcentajeAzules)/100);
  const totalFinal=pctMixtos+pctAzules;
  const e1=pl.engrasador1||"", e2=pl.engrasador2||"", e3=pl.engrasador3||"", e4=pl.engrasador4||"";
  const engrs=[e1,e2,e3,e4].filter(Boolean);
  const numT=engrs.length||1;
  const pagoPorT=totalFinal/numT;
  const mes=pl.mes||mesActual();
  const findIdx=n=>n?negocio.trabajadores.findIndex(t=>t.nombre.toLowerCase()===n.toLowerCase()):-1;
  const findNom=(n,idx)=>idx>=0?negocio.trabajadores[idx].nombre:(n||"Engrasador");
  const idx1=findIdx(e1), idx2=findIdx(e2), idx3=findIdx(e3), idx4=findIdx(e4);
  return {
    fecha:pl.fecha||new Date().toLocaleString(), mes, planillaId:pl.id,
    tipoTurno:String(numT),
    trabajadorIndex1:idx1, trabajadorNombre1:findNom(e1,idx1),
    trabajadorIndex2:e2?idx2:null, trabajadorNombre2:e2?findNom(e2,idx2):null,
    trabajadorIndex3:e3?idx3:null, trabajadorNombre3:e3?findNom(e3,idx3):null,
    trabajadorIndex4:e4?idx4:null, trabajadorNombre4:e4?findNom(e4,idx4):null,
    grasaAntes:pl.grasaAntes||0, grasaQuedo:pl.grasaQuedo||0,
    grasaGastada, valorGrasaGastada:valorGrasa,
    totalMixtosRebajados:totalMixtosReb, porcentajeMixtos:pctMixtos,
    totalAzules, azulesMenosGrasa:azulesMenos, porcentajeAzules:pctAzules,
    totalFinal, pagoTrabajador1:e1?pagoPorT:0, pagoTrabajador2:e2?pagoPorT:0,
    pagoTrabajador3:e3?pagoPorT:0, pagoTrabajador4:e4?pagoPorT:0,
    e1, e2, e3, e4, tieneE2:!!e2
  };
}

function liquidarDesdePlanilla(id) {
  const pl=negocio.planillas.find(p=>p.id===id);
  if(!pl){toast("Planilla no encontrada","error");return;}
  if(pl.liquidada){toast("Esta planilla ya fue liquidada","aviso");return;}
  const vehiculos=pl.vehiculos||[];
  if(!vehiculos.length){toast("La planilla está vacía","aviso");return;}
  const res=calcularResultadoPlanilla(pl);
  const textoPago=[[res.e1,res.pagoTrabajador1],[res.e2,res.pagoTrabajador2],[res.e3,res.pagoTrabajador3],[res.e4,res.pagoTrabajador4]].filter(([n])=>n).map(([n,p])=>`${n}: $${Number(p||0).toLocaleString()}`).join("<br>")||`${res.e1||"Engrasador"}: $${res.pagoTrabajador1.toLocaleString()}`;
  mostrarPagina("paginaLiquidacion");
  document.getElementById("resultado").innerHTML=`
    <div class="resultado">
      <h3>⚡ Liquidación — ${pl.nombre||pl.fecha}</h3>
      <p style="color:var(--gris);font-size:12px;">${vehiculos.length} servicio(s)</p><hr style="margin:8px 0;">
      <strong>🛢️ Grasa</strong><br>
      Antes: ${(pl.grasaAntes||0).toLocaleString()} g | Quedó: ${(pl.grasaQuedo||0).toLocaleString()} g | Gastada: ${res.grasaGastada.toLocaleString()} g → $${res.valorGrasaGastada.toLocaleString()}<hr style="margin:8px 0;">
      <strong>Sintéticos (${vehiculos.filter(v=>v.tipoEngrase==='mixto').length}) · Mixtos (${vehiculos.filter(v=>v.tipoEngrase==='mixto_r').length})</strong><br>
      Total rebajados: $${res.totalMixtosRebajados.toLocaleString()} — ${negocio.configuracion.porcentajeMixtos}% = $${res.porcentajeMixtos.toLocaleString()}<hr style="margin:8px 0;">
      <strong>Azules (${vehiculos.filter(v=>v.tipoEngrase==='azul').length})</strong><br>
      Total: $${res.totalAzules.toLocaleString()} — Menos grasa: $${res.azulesMenosGrasa.toLocaleString()} — ${negocio.configuracion.porcentajeAzules}% = $${res.porcentajeAzules.toLocaleString()}
      <div class="total-final">Total: $${res.totalFinal.toLocaleString()}<br>${textoPago}</div>
    </div>`;
  ultimoCalc=res;
  document.getElementById("btnGuardarLiq").classList.remove("oculto");
  // Al guardar, marcar como liquidada
  document.getElementById("btnGuardarLiq").onclick=()=>guardarLiquidacionYMarcarPlanilla(id);
}

async function guardarLiquidacionYMarcarPlanilla(planillaId) {
  if(!ultimoCalc){toast("Primero realiza una liquidación","error");return;}
  const btn=document.getElementById("btnGuardarLiq");
  if(btn && btn.disabled) return; // evita doble clic / doble envío (duplicaba liquidaciones)
  if(btn){ btn.disabled=true; btn.classList.add("oculto"); }
  const liq=Object.assign({},ultimoCalc);
  aplicarLiquidacion(liq,true);
  // Marcar planilla como liquidada
  const pl=negocio.planillas.find(p=>p.id===planillaId);
  if(pl){ pl.liquidada=true; await guardarEvento({tipoRegistro:"planilla",planilla:pl},pl.total,0); }
  guardar();
  if(btn){ btn.classList.add("oculto"); btn.disabled=false; btn.onclick=guardarLiquidacion; } // restaurar
  ultimoCalc=null; actualizarTodo(); mostrarListaPlanillas();
  const r=await guardarEvento({tipoRegistro:"liquidacion",calculo:liq},liq.totalFinal,(liq.pagoTrabajador1||0)+(liq.pagoTrabajador2||0)+(liq.pagoTrabajador3||0)+(liq.pagoTrabajador4||0));
  toast(r.ok?"Liquidación guardada — Planilla marcada":"Guardada localmente",r.ok?"ok":"aviso");
}

// ══ REVERTIR PLANILLA LIQUIDADA (requiere PIN) ═════════════════════════════
async function revertirPlanillaLiquidada(planillaId){
  const pl=(negocio.planillas||[]).find(p=>p.id===planillaId);
  if(!pl){toast("Planilla no encontrada","error");return;}
  if(!pl.liquidada){toast("Esta planilla no está liquidada","aviso");return;}
  const pinIngresado=prompt("Ingresa tu PIN para revertir esta liquidación:");
  if(pinIngresado===null) return; // canceló
  if(String(pinIngresado).trim()!==String(negocio.pin||"").trim()){
    toast("PIN incorrecto","error");
    return;
  }
  confirmar(
    "Revertir liquidación",
    "¿Volver esta planilla a Pendiente? Se descontará el pago ya aplicado a los engrasadores.",
    async ()=>{
      // Buscar la(s) liquidación(es) de historial asociadas a esta planilla
      const entradas=(negocio.historial||[]).filter(c=>c.planillaId===planillaId);
      for(const c of entradas){
        const descontar=(nom,val)=>{ const t=getTrabPorNombre(nom); if(t){if(!t.pagos)t.pagos={};if(!t.pagos[c.mes])t.pagos[c.mes]=0;t.pagos[c.mes]=Math.max(0,t.pagos[c.mes]-Number(val||0));} };
        descontar(c.trabajadorNombre1,c.pagoTrabajador1);
        if(c.trabajadorNombre2) descontar(c.trabajadorNombre2,c.pagoTrabajador2);
        if(c.trabajadorNombre3) descontar(c.trabajadorNombre3,c.pagoTrabajador3);
        if(c.trabajadorNombre4) descontar(c.trabajadorNombre4,c.pagoTrabajador4);
        await guardarEvento({tipoRegistro:"eliminarLiquidacion",planillaId:c.planillaId,fecha:c.fecha,mes:c.mes});
      }
      negocio.historial=(negocio.historial||[]).filter(c=>c.planillaId!==planillaId);
      pl.liquidada=false;
      guardar();
      await guardarEvento({tipoRegistro:"planilla",planilla:pl},pl.total,0);
      actualizarTodo();
      mostrarListaPlanillas();
      toast("Planilla revertida a Pendiente ✅","ok");
    }
  );
}

// ══════════════════════════════════════════════════════════
//  LIQUIDACIÓN QUINCENAL (TODAS A LA VEZ)
// ══════════════════════════════════════════════════════════
function liquidarQuincenal() {
  const pendientes=(negocio.planillas||[]).filter(p=>!p.liquidada&&(p.vehiculos||[]).length>0);
  if(!pendientes.length){toast("No hay planillas pendientes de liquidar","aviso");return;}
  resultadosQuincenales=pendientes.map(pl=>({planilla:pl, resultado:calcularResultadoPlanilla(pl)}));
  // Agrupar por engrasadores
  const resumenEngrasadores={};
  resultadosQuincenales.forEach(({resultado:r})=>{
    const sumar=(nom,val)=>{ if(!nom) return; if(!resumenEngrasadores[nom]) resumenEngrasadores[nom]=0; resumenEngrasadores[nom]+=val; };
    sumar(r.trabajadorNombre1, r.pagoTrabajador1);
    if(r.trabajadorNombre2) sumar(r.trabajadorNombre2, r.pagoTrabajador2);
    if(r.trabajadorNombre3) sumar(r.trabajadorNombre3, r.pagoTrabajador3);
    if(r.trabajadorNombre4) sumar(r.trabajadorNombre4, r.pagoTrabajador4);
  });
  const totalGen=Object.values(resumenEngrasadores).reduce((s,v)=>s+v,0);
  const filasPlanillas=resultadosQuincenales.map(({planilla:pl,resultado:r})=>`
    <div class="item" style="padding:10px 14px;">
      <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
        <strong>${pl.nombre||pl.fecha}</strong>
        <span style="font-weight:700;color:var(--verde);">$${r.totalFinal.toLocaleString()}</span>
      </div>
      <div style="font-size:12px;color:var(--gris);margin-top:3px;">
        ${[r.e1,r.e2,r.e3,r.e4].filter(Boolean).join(" & ")||"—"} · ${(pl.vehiculos||[]).length} servicios
      </div>
    </div>`).join("");
  const filasResumen=Object.entries(resumenEngrasadores).map(([nom,val])=>`
    <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #e2e8f0;">
      <span><strong>${cap(nom)}</strong></span>
      <span style="font-weight:700;color:var(--verde);">$${val.toLocaleString()}</span>
    </div>`).join("");
  document.getElementById("contenidoModalQuincenal").innerHTML=`
    <p style="color:var(--gris);font-size:13px;margin-bottom:10px;">${pendientes.length} planilla(s) pendientes — se liquidarán todas.</p>
    <h3 style="font-size:14px;margin-bottom:6px;">Planillas incluidas:</h3>
    ${filasPlanillas}
    <h3 style="font-size:14px;margin:12px 0 6px;">Resumen por engrasador:</h3>
    <div style="border:1px solid var(--borde);border-radius:12px;overflow:hidden;">
      ${filasResumen}
      <div style="display:flex;justify-content:space-between;padding:10px 12px;background:linear-gradient(135deg,var(--azul),var(--verde));color:#fff;font-weight:700;">
        <span>TOTAL QUINCENAL</span><span>$${totalGen.toLocaleString()}</span>
      </div>
    </div>`;
  document.getElementById("btnGuardarQuincenal").onclick=guardarLiquidacionQuincenal;
  document.getElementById("modalQuincenal").classList.add("abierto");
}

async function guardarLiquidacionQuincenal() {
  const btn=document.getElementById("btnGuardarQuincenal");
  if(btn && btn.disabled) return; // evita doble clic / doble envío (duplicaba TODAS las planillas de la quincena)
  if(!resultadosQuincenales.length) return;
  if(btn) btn.disabled=true;
  const pendientesAProcesar=resultadosQuincenales;
  resultadosQuincenales=[]; // limpiar de inmediato para que un segundo clic no reprocese lo mismo
  let guardadas=0;
  for(const {planilla:pl, resultado:r} of pendientesAProcesar) {
    if(pl.liquidada) continue; // ya se liquidó (protección extra)
    aplicarLiquidacion(r, true);
    pl.liquidada=true;
    await guardarEvento({tipoRegistro:"planilla",planilla:pl},pl.total,0);
    const rv=await guardarEvento({tipoRegistro:"liquidacion",calculo:r},r.totalFinal,(r.pagoTrabajador1||0)+(r.pagoTrabajador2||0)+(r.pagoTrabajador3||0)+(r.pagoTrabajador4||0));
    if(rv.ok) guardadas++;
  }
  guardar(); actualizarTodo(); mostrarListaPlanillas();
  cerrarModal("modalQuincenal");
  if(btn) btn.disabled=false;
  toast(`Liquidación quincenal guardada — ${guardadas} planilla(s) `,"ok");
}

// ══════════════════════════════════════════════════════════
//  IMPRIMIR PLANILLA
// ══════════════════════════════════════════════════════════
function imprimirPlanilla(id){
  const pl=negocio.planillas.find(p=>p.id===id); if(!pl) return;
  const vehiculos=pl.vehiculos||[];
  const total=vehiculos.reduce((s,v)=>s+Number(v.valor||0),0);
  const gG=(pl.grasaAntes||0)-(pl.grasaQuedo||0);
  const liq=pl.liquidada?_liquidacionDePlanilla(id):null;
  const pagosLiq=liq?[[liq.trabajadorNombre1,liq.pagoTrabajador1],[liq.trabajadorNombre2,liq.pagoTrabajador2],[liq.trabajadorNombre3,liq.pagoTrabajador3],[liq.trabajadorNombre4,liq.pagoTrabajador4]].filter(([n])=>n).map(([n,v])=>`<tr><td>${sanitizarTexto(n)}</td><td>$${fmtMiles(v)}</td></tr>`).join(""):"";
  const bloqueLiquidacion=liq?`
  <div class="grasa" style="margin-top:14px;">
    <strong>⚡ Liquidación</strong><br>
    Grasa gastada: ${(liq.grasaGastada||0).toLocaleString()} g → $${fmtMiles(liq.valorGrasaGastada)}<br>
    Sintéticos/Mixtos rebajados: $${fmtMiles(liq.totalMixtosRebajados)} — ${negocio.configuracion.porcentajeMixtos}% = $${fmtMiles(liq.porcentajeMixtos)}<br>
    Azules: $${fmtMiles(liq.totalAzules)} — Menos grasa: $${fmtMiles(liq.azulesMenosGrasa)} — ${negocio.configuracion.porcentajeAzules}% = $${fmtMiles(liq.porcentajeAzules)}
  </div>
  <table><thead><tr><th>Engrasador</th><th>Le corresponde</th></tr></thead><tbody>${pagosLiq}</tbody></table>
  <div class="total" style="margin-top:10px;"><span>Total liquidación:</span><span>$${fmtMiles(liq.totalFinal)}</span></div>`:"";
  const filas=vehiculos.map((v,i)=>`<tr><td>${i+1}</td><td>${formatPlaca(v.placa)}</td><td>${v.tipoVehiculo||""}</td><td>${v.descripcion||""}</td>
    <td><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${v.tipoEngrase==='azul'?'#cfe2ff':'#fff3cd'};color:${v.tipoEngrase==='azul'?'#0a3678':v.tipoEngrase==='mixto_r'?'#166b3b':'#856404'}">${labelEngrase(v.tipoEngrase||"azul")}</span></td>
    <td>$${Number(v.valor||0).toLocaleString()}</td><td>${v.engrasador||""}</td><td>${v.observaciones||""}</td></tr>`).join("");
  const ven=window.open("","_blank");
  ven.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Planilla SYMES</title>
  <style>body{font-family:Arial,sans-serif;color:#243044;margin:20px;}.hdr{background:linear-gradient(135deg,#1f3c88,#1f8a4c);color:#fff;padding:18px 22px;border-radius:12px;margin-bottom:18px;}.hdr h1{margin:0 0 3px;font-size:24px;}.hdr p{margin:0;opacity:.88;font-size:13px;}
  table{width:100%;border-collapse:collapse;font-size:13px;}th{background:#1f3c88;color:#fff;padding:8px;text-align:left;}td{padding:7px 8px;border-bottom:1px solid #e2e8f0;}tr:nth-child(even) td{background:#f8faff;}
  .grasa{background:#f0f6ff;border:1px solid rgba(31,60,136,.15);border-radius:10px;padding:12px;margin-bottom:14px;font-size:13px;}
  .total{margin-top:16px;background:linear-gradient(135deg,#1f3c88,#1f8a4c);color:#fff;padding:12px 16px;border-radius:12px;font-weight:700;font-size:16px;display:flex;justify-content:space-between;}
  .liq-badge{display:inline-block;padding:2px 9px;border-radius:12px;font-size:11px;font-weight:700;${pl.liquidada?'background:#dcfce7;color:#15803d;':'background:#fff3cd;color:#856404;'}}
  .firma{margin-top:50px;display:flex;justify-content:space-between;}.linea{border-top:1px solid #333;padding-top:7px;width:44%;text-align:center;font-size:12px;}
  .cred{margin-top:28px;text-align:center;font-size:11px;color:#64748b;border-top:1px solid #dce3f0;padding-top:10px;}@media print{button{display:none;}}
</style>
  </head><body>
  <div class="hdr"><h1>SYMES</h1><p>Planilla de servicios — ${negocio.nombreNegocio}</p></div>
  <p><strong>Planilla:</strong> ${pl.nombre||pl.fecha} <span class="liq-badge">${pl.liquidada?"LIQUIDADA":"⏳ Pendiente"}</span> &nbsp; <strong>Fecha:</strong> ${pl.fecha} &nbsp; <strong>Mes:</strong> ${pl.mes}</p>
  <p><strong>Engrasador(es):</strong> ${[pl.engrasador1,pl.engrasador2,pl.engrasador3,pl.engrasador4].filter(Boolean).join(" & ")||"—"}</p>
  <p><strong>Cárcamo(s):</strong> ${(pl.carcamos&&pl.carcamos.length)?pl.carcamos.slice().sort((a,b)=>a-b).map(n=>"Cárcamo "+n).join(" & "):"—"}</p>
  <div class="grasa">🛢️ <strong>Grasa antes:</strong> ${(pl.grasaAntes||0).toLocaleString()} g &nbsp;|&nbsp; <strong>Grasa quedó:</strong> ${(pl.grasaQuedo||0).toLocaleString()} g &nbsp;|&nbsp; <strong>Gastada:</strong> ${gG.toLocaleString()} g</div>
  <table><thead><tr><th>#</th><th>Placa</th><th>Tipo</th><th>Descripción</th><th>Engrase</th><th>Valor</th><th>Engrasador</th><th>Obs.</th></tr></thead><tbody>${filas}</tbody></table>
  <div class="total"><span>Total planilla:</span><span>$${total.toLocaleString()}</span></div>
  <div class="firma"><div class="linea">Firma encargado</div><div class="linea">Firma engrasador</div></div>
  <div class="cred">SYMES V4.0 — Brandon Sebastian Arevalo Ojeda y Andrey Arévalo</div>
  <script>window.onload=function(){window.print();}<\/script><\/body><\/html>`);
  ven.document.close();
}

// ══════════════════════════════════════════════════════════
//  LIQUIDACIÓN MANUAL
// ══════════════════════════════════════════════════════════
function convertirValor(v){ v=Number(v); if(isNaN(v)) return 0; return(v>0&&v<1000)?v*1000:v; }
function rebajarMixto(v){ const r=negocio?.configuracion?.reglasMixtos||[]; for(const rr of r){if(Number(rr.original)===Number(v))return Number(rr.rebajado);} return v; }
function mostrarTrabajadores(){
  const tipo=document.getElementById("tipoTurno").value;
  document.getElementById("zonaTrab1").classList.toggle("oculto",!tipo);
  document.getElementById("zonaTrab2").classList.toggle("oculto",Number(tipo)<2);
  document.getElementById("zonaTrab3").classList.toggle("oculto",Number(tipo)<3);
  document.getElementById("zonaTrab4").classList.toggle("oculto",Number(tipo)<4);
}
function agregarMixto(){ const v=convertirValor(document.getElementById("valMixto").value); if(v<=0){toast("Ingresa un valor válido","error");return;} mixtosAct.push({original:v,rebajado:rebajarMixto(v)}); document.getElementById("valMixto").value=""; document.getElementById("valMixto").focus(); mostrarListaMixtos(); }
function mostrarListaMixtos(){ const el=document.getElementById("listaMixtos"); if(!el) return; el.innerHTML=!mixtosAct.length?"<p style='color:var(--gris);'>Sin mixtos.</p>":mixtosAct.map((m,i)=>`<div class="item">Mixto: $${m.original.toLocaleString()} → $${m.rebajado.toLocaleString()} <button class="btn-rojo btn-sm" onclick="mixtosAct.splice(${i},1);mostrarListaMixtos()">✕</button></div>`).join(""); }
function agregarAzul(){ const v=convertirValor(document.getElementById("valAzul").value); if(v<=0){toast("Ingresa un valor válido","error");return;} azulesAct.push(v); document.getElementById("valAzul").value=""; document.getElementById("valAzul").focus(); mostrarListaAzules(); }
function mostrarListaAzules(){ const el=document.getElementById("listaAzules"); if(!el) return; el.innerHTML=!azulesAct.length?"<p style='color:var(--gris);'>Sin azules.</p>":azulesAct.map((a,i)=>`<div class="item">Azul: $${a.toLocaleString()} <button class="btn-rojo btn-sm" onclick="azulesAct.splice(${i},1);mostrarListaAzules()">✕</button></div>`).join(""); }
function calcular(){
  const mes=getMes(), tipo=document.getElementById("tipoTurno").value;
  const numT=Number(tipo)||1;
  const idx1=document.getElementById("selTrab1").value;
  const idx2=numT>=2?document.getElementById("selTrab2").value:"";
  const idx3=numT>=3?document.getElementById("selTrab3").value:"";
  const idx4=numT>=4?document.getElementById("selTrab4").value:"";
  const gA=Number(document.getElementById("grasaAntes").value), gQ=Number(document.getElementById("grasaQuedo").value);
  const config=negocio.configuracion;
  if(!tipo){toast("Selecciona el tipo de turno","error");return;}
  if(idx1===""){toast("Selecciona el trabajador 1","error");return;}
  if(numT>=2&&idx2===""){toast("Selecciona el trabajador 2","error");return;}
  if(numT>=3&&idx3===""){toast("Selecciona el trabajador 3","error");return;}
  if(numT>=4&&idx4===""){toast("Selecciona el trabajador 4","error");return;}
  const selArr=[idx1,numT>=2?idx2:null,numT>=3?idx3:null,numT>=4?idx4:null].filter(x=>x!==null);
  if(new Set(selArr).size<selArr.length){toast("No puedes seleccionar el mismo trabajador dos veces","error");return;}
  if(isNaN(gA)||isNaN(gQ)){toast("Ingresa los datos de grasa","error");return;}
  if(gA<0||gQ<0){toast("Los valores de grasa no pueden ser negativos","error");return;}
  if(gA>500000){toast("El valor de grasa antes parece muy alto, verifica","aviso");}
  if(gQ>gA){toast("La grasa que quedó no puede ser mayor","error");return;}
  const gG=gA-gQ, vG=(gG*Number(config.precioGrasa))/1000;
  const tM=mixtosAct.reduce((s,m)=>s+m.rebajado,0), pM=tM*(Number(config.porcentajeMixtos)/100);
  const tA=azulesAct.reduce((s,a)=>s+a,0), aM=tA-vG, pA=aM*(Number(config.porcentajeAzules)/100);
  const tF=pM+pA;
  const t1=negocio.trabajadores[idx1];
  const t2=numT>=2?negocio.trabajadores[idx2]:null;
  const t3=numT>=3?negocio.trabajadores[idx3]:null;
  const t4=numT>=4?negocio.trabajadores[idx4]:null;
  const pPorT=tF/numT;
  const p1=pPorT, p2=numT>=2?pPorT:0, p3=numT>=3?pPorT:0, p4=numT>=4?pPorT:0;
  const textP=[[t1,p1],[t2,p2],[t3,p3],[t4,p4]].filter(([t])=>t).map(([t,p])=>`${t.nombre}: $${p.toLocaleString()}`).join("<br>");
  document.getElementById("resultado").innerHTML=`<div class="resultado"><h3>Resultado</h3>
    <strong>🛢️ Grasa</strong><br>Antes: ${gA.toLocaleString()} g | Quedó: ${gQ.toLocaleString()} g | Gastada: ${gG.toLocaleString()} g<br>Valor grasa: $${vG.toLocaleString()}<hr style="margin:8px 0;">
    <strong>Mixtos</strong> — Rebajados: $${tM.toLocaleString()} — ${config.porcentajeMixtos}%: $${pM.toLocaleString()}<hr style="margin:8px 0;">
    <strong>Azules</strong> — Total: $${tA.toLocaleString()} — Menos grasa: $${aM.toLocaleString()} — ${config.porcentajeAzules}%: $${pA.toLocaleString()}
    <div class="total-final">Total: $${tF.toLocaleString()}<br>${textP}</div></div>`;
  ultimoCalc={fecha:new Date().toLocaleString(),mes,tipoTurno:tipo,
    trabajadorIndex1:Number(idx1),trabajadorNombre1:t1.nombre,
    trabajadorIndex2:numT>=2?Number(idx2):null,trabajadorNombre2:numT>=2?t2.nombre:null,
    trabajadorIndex3:numT>=3?Number(idx3):null,trabajadorNombre3:numT>=3?t3.nombre:null,
    trabajadorIndex4:numT>=4?Number(idx4):null,trabajadorNombre4:numT>=4?t4.nombre:null,
    grasaAntes:gA,grasaQuedo:gQ,grasaGastada:gG,valorGrasaGastada:vG,
    totalMixtosRebajados:tM,porcentajeMixtos:pM,totalAzules:tA,azulesMenosGrasa:aM,porcentajeAzules:pA,
    totalFinal:tF,pagoTrabajador1:p1,pagoTrabajador2:p2,pagoTrabajador3:p3,pagoTrabajador4:p4};
  document.getElementById("btnGuardarLiq").classList.remove("oculto");
  document.getElementById("btnGuardarLiq").onclick=guardarLiquidacion;
}
async function guardarLiquidacion(){
  if(!ultimoCalc){toast("Primero realiza una liquidación","error");return;}
  const liq=Object.assign({},ultimoCalc);
  aplicarLiquidacion(liq,true); guardar();
  document.getElementById("btnGuardarLiq").classList.add("oculto");
  ultimoCalc=null; actualizarTodo();
  const r=await guardarEvento({tipoRegistro:"liquidacion",calculo:liq},liq.totalFinal,(liq.pagoTrabajador1||0)+(liq.pagoTrabajador2||0));
  toast(r.ok?"Liquidación guardada ":"Guardada localmente",r.ok?"ok":"aviso");
}
function reiniciarCalculo(){
  ["tipoTurno","selTrab1","selTrab2","selTrab3","selTrab4","grasaAntes","grasaQuedo","valMixto","valAzul"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
  ["zonaTrab1","zonaTrab2","zonaTrab3","zonaTrab4"].forEach(id=>document.getElementById(id)?.classList.add("oculto"));
  mixtosAct=[]; azulesAct=[]; mostrarListaMixtos(); mostrarListaAzules();
  document.getElementById("resultado").innerHTML="";
  document.getElementById("btnGuardarLiq").classList.add("oculto");
  ultimoCalc=null;
}

// ══ ADELANTOS ══
// Arma la fecha del adelanto en el mismo formato "D/M/AAAA, HH:mm:ss" que ya
// usa toda la app (ver _getDia/_enQuincena/_parseFechaHoraAdelanto), pero con
// el DIA que el usuario eligio en el input de fecha en vez del dia de hoy —
// asi un adelanto real del 31/ago cargado el 1/sep cae en la quincena/mes
// correctos (agosto, 2a quincena) y no en los de la fecha de captura.
function _construirFechaAdelanto(fechaISO){
  const ahora=new Date();
  let y=ahora.getFullYear(), m=ahora.getMonth()+1, d=ahora.getDate();
  const mm=String(fechaISO||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(mm){ y=Number(mm[1]); m=Number(mm[2]); d=Number(mm[3]); }
  const hh=String(ahora.getHours()).padStart(2,"0"), mi=String(ahora.getMinutes()).padStart(2,"0"), ss=String(ahora.getSeconds()).padStart(2,"0");
  return `${d}/${m}/${y}, ${hh}:${mi}:${ss}`;
}
async function registrarAdelanto(){
  const sel=document.getElementById("selAdelanto").value;
  const valor=_leerNum("valAdelanto");
  const nota=document.getElementById("notaAdelanto").value.trim();
  const fechaISO=document.getElementById("fechaAdelanto")?.value||new Date().toLocaleDateString("en-CA");
  if(sel===""){toast("Selecciona un engrasador o perfil","error");return;}
  if(!valor||valor<=0){toast("Ingresa un valor válido mayor a cero","error");return;}
  if(valor>10000000){toast("El valor parece muy alto, verifica","error");return;}
  if(nota.length>200){toast("La nota es muy larga (máx 200 caracteres)","error");return;}
  // El mes del adelanto lo define su fecha real, no el mes que estés viendo en pantalla
  // (igual que las planillas: pl.mes sale de pl.fecha, no de donde estés parado).
  const mes=fechaISO.slice(0,7);
  const adelanto={valor,nota,fecha:_construirFechaAdelanto(fechaISO),ts:Date.now(),creadoPor:perfilActivo()};
  let r;
  if(String(sel).startsWith("p:")){
    // Adelanto a un perfil (secretaria) — nunca a Admin
    const nombrePerfil=sel.slice(2);
    if(nombrePerfil.toLowerCase()==="admin"){toast("No se pueden registrar adelantos al perfil Admin","error");return;}
    if(!negocio.adelantosPerfiles) negocio.adelantosPerfiles={};
    if(!negocio.adelantosPerfiles[nombrePerfil]) negocio.adelantosPerfiles[nombrePerfil]={};
    if(!negocio.adelantosPerfiles[nombrePerfil][mes]) negocio.adelantosPerfiles[nombrePerfil][mes]=[];
    negocio.adelantosPerfiles[nombrePerfil][mes].push(adelanto);
    guardar(); actualizarTodo();
    r=await guardarEvento({tipoRegistro:"adelantoPerfil",mes,perfilNombre:nombrePerfil,valor,nota,fecha:adelanto.fecha,ts:adelanto.ts,creadoPor:adelanto.creadoPor},valor,0);
  } else {
    const t=negocio.trabajadores[sel];
    if(!t){toast("Engrasador no encontrado","error");return;}
    if(!t.adelantos) t.adelantos={};
    if(!t.adelantos[mes]) t.adelantos[mes]=[];
    t.adelantos[mes].push(adelanto);
    guardar(); actualizarTodo();
    r=await guardarEvento({tipoRegistro:"adelanto",mes,trabajadorNombre:t.nombre,valor,nota,fecha:adelanto.fecha,ts:adelanto.ts,creadoPor:adelanto.creadoPor},valor,0);
  }
  agregarMemoria("notas_adelanto", nota);
  ["valAdelanto","notaAdelanto"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("selAdelanto").value="";
  const fechaEl=document.getElementById("fechaAdelanto"); if(fechaEl) fechaEl.value=new Date().toLocaleDateString("en-CA");
  toast(r.ok?"Adelanto registrado ":"Adelanto guardado localmente",r.ok?"ok":"aviso");
}
let _filtroEngrasadorAdelanto = "";
// Los adelantos viejos (sin ts) guardaron su fecha como "D/M/AAAA, HH:mm:ss" (toLocaleString
// por defecto), formato que Date.parse NO entiende (lo confunde con mes/día). Se parsea a mano.
function _parseFechaHoraAdelanto(f){
  if(!f) return 0;
  const m=String(f).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2}):(\d{2})/);
  if(!m) return 0;
  const [d,mo,y,h,mi,s]=m.slice(1).map(Number);
  return new Date(y,mo-1,d,h,mi,s).getTime();
}
function mostrarAdelantos(){
  const el=document.getElementById("listaAdelantos"); if(!el) return;
  const mes=getMes();

  // Filtro por engrasador / perfil
  const filDiv=document.getElementById("filtrosAdelantos");
  const perfilesSecretarias=(negocio.perfiles||[]).filter(p=>p.toLowerCase()!=="admin");
  if(filDiv){
    filDiv.innerHTML=`<select id="selFiltroEngrAdelanto" onchange="_filtroEngrasadorAdelanto=this.value;mostrarAdelantos()" style="width:auto;margin:0;padding:6px 10px;font-size:13px;">
      <option value="">👷 Todos</option>
      ${negocio.trabajadores.map(t=>`<option value="${t.nombre}" ${_filtroEngrasadorAdelanto===t.nombre?'selected':''}>${cap(sanitizarTexto(t.nombre))}</option>`).join("")}
      ${perfilesSecretarias.map(p=>`<option value="${p}" ${_filtroEngrasadorAdelanto===p?'selected':''}>${cap(sanitizarTexto(p))} (perfil)</option>`).join("")}
    </select>`;
  }

  // Recolectar adelantos del mes conservando su índice original (para poder eliminarlos)
  let items=[];
  negocio.trabajadores.forEach((t,i)=>{
    (t.adelantos?.[mes]||[]).forEach((a,j)=>{ items.push({tipo:"trabajador", iT:i, iA:j, nombre:t.nombre, adelanto:a}); });
  });
  Object.keys(negocio.adelantosPerfiles||{}).forEach(nombre=>{
    (negocio.adelantosPerfiles[nombre]?.[mes]||[]).forEach((a,j)=>{ items.push({tipo:"perfil", iA:j, nombre, adelanto:a}); });
  });

  if(_filtroEngrasadorAdelanto){
    items=items.filter(it=>it.nombre===_filtroEngrasadorAdelanto);
  }

  // Más recientes primero (usa el timestamp exacto si existe; si no, intenta parsear la fecha guardada)
  items.sort((a,b)=>{
    const ta=a.adelanto.ts||_parseFechaHoraAdelanto(a.adelanto.fecha)||0;
    const tb=b.adelanto.ts||_parseFechaHoraAdelanto(b.adelanto.fecha)||0;
    return tb-ta;
  });

  el.innerHTML="";
  if(!items.length){ el.innerHTML="<p style='color:var(--gris);'>Sin adelantos en este mes.</p>"; return; }

  // No se borran solos al pagar la quincena — solo se ocultan del listado activo
  // (colapsados en "ya liquidados") para poder revisarlos después si hace falta.
  const activos=items.filter(it=>!_adelantoLiquidado(it,mes));
  const liquidados=items.filter(it=>_adelantoLiquidado(it,mes));

  if(!activos.length){
    el.innerHTML="<p style='color:var(--gris);'>Sin adelantos pendientes en este mes.</p>";
  } else {
    activos.forEach(it=>el.appendChild(_nodoAdelanto(it,false)));
  }

  if(liquidados.length){
    const cont=document.createElement("div");
    const btnToggle=document.createElement("button");
    btnToggle.className="btn-sm"; btnToggle.style.margin="10px 0";
    const txtVer=`🗂️ Ver ${liquidados.length} adelanto(s) de quincena ya liquidada`;
    const txtOcultar="🗂️ Ocultar adelantos liquidados";
    btnToggle.textContent=txtVer;
    const zonaLiq=document.createElement("div"); zonaLiq.className="oculto";
    btnToggle.onclick=()=>{
      zonaLiq.classList.toggle("oculto");
      btnToggle.textContent=zonaLiq.classList.contains("oculto")?txtVer:txtOcultar;
    };
    liquidados.forEach(it=>zonaLiq.appendChild(_nodoAdelanto(it,true)));
    cont.appendChild(btnToggle); cont.appendChild(zonaLiq);
    el.appendChild(cont);
  }
}
function _quincenaDeFecha(fecha){
  return _getDia(fecha)>=16 ? 'q2' : 'q1';
}
function _adelantoLiquidado(it, mes){
  const q=_quincenaDeFecha(it.adelanto.fecha);
  if(it.tipo==="perfil") return _estaPagadoQuincenaPerfil(it.nombre, mes, q);
  const t=negocio.trabajadores[it.iT];
  return t ? _estaPagadoQuincena(t, mes, q) : false;
}
function _nodoAdelanto({tipo,iT,iA,nombre,adelanto:a}, liquidado){
  const div=document.createElement("div"); div.className="item";
  if(liquidado) div.style.opacity="0.7";
  const h3=document.createElement("h3"); h3.textContent=cap(nombre)+(liquidado?" ✅":"");
  const p1=document.createElement("p"); p1.innerHTML=`<strong>Valor:</strong> $${Number(a.valor).toLocaleString()}`;
  const p2=document.createElement("p"); p2.innerHTML="<strong>Nota:</strong> "+sanitizarTexto(a.nota||"Sin nota");
  const p3=document.createElement("p"); p3.innerHTML="<strong>Fecha:</strong> "+sanitizarTexto(a.fecha);
  const btn=document.createElement("button"); btn.className="btn-rojo btn-sm"; btn.textContent="Eliminar";
  btn.addEventListener("click",()=>tipo==="perfil"?eliminarAdelantoPerfil(nombre,iA):eliminarAdelanto(iT,iA));
  const nodos=[h3,p1,p2,p3];
  if(a.creadoPor){ const p4=document.createElement("p"); p4.innerHTML="<strong>Registrado por:</strong> "+sanitizarTexto(a.creadoPor); nodos.push(p4); }
  if(liquidado){ const p5=document.createElement("p"); p5.style.cssText="color:var(--gris);font-size:11px;"; p5.textContent="Quincena ya liquidada"; nodos.push(p5); }
  nodos.push(btn);
  div.append(...nodos);
  return div;
}
function eliminarAdelanto(iT,iA){
  confirmar("Eliminar adelanto","¿Seguro?",async()=>{
    const mes=getMes();
    const t=negocio.trabajadores[iT];
    const a=t?.adelantos?.[mes]?.[iA];
    if(!t||!a){toast("Adelanto no encontrado","error");return;}
    t.adelantos[mes].splice(iA,1);
    guardar(); actualizarTodo();
    const r=await guardarEvento({tipoRegistro:"eliminarAdelanto",trabajadorNombre:t.nombre,mes,ts:a.ts||null,valor:a.valor,nota:a.nota||"",fecha:a.fecha||""});
    toast(r.ok?"Adelanto eliminado":"Eliminado localmente (sin conexión)",r.ok?"ok":"aviso");
  });
}
function eliminarAdelantoPerfil(nombre,iA){
  confirmar("Eliminar adelanto","¿Seguro?",async()=>{
    const mes=getMes();
    const a=negocio.adelantosPerfiles?.[nombre]?.[mes]?.[iA];
    if(!a){toast("Adelanto no encontrado","error");return;}
    negocio.adelantosPerfiles[nombre][mes].splice(iA,1);
    guardar(); actualizarTodo();
    const r=await guardarEvento({tipoRegistro:"eliminarAdelantoPerfil",perfilNombre:nombre,mes,ts:a.ts||null,valor:a.valor,nota:a.nota||"",fecha:a.fecha||""});
    toast(r.ok?"Adelanto eliminado":"Eliminado localmente (sin conexión)",r.ok?"ok":"aviso");
  });
}

// ══ PAGOS ══ (fusionado con lo que era "Historial de pagos" — ver mostrarCierreMes)
function toggleSeguridadTrabajador(idx){
  const t=negocio.trabajadores[idx]; if(!t) return;
  t.sinSeguridad=!t.sinSeguridad;
  guardar(); mostrarCierreMes();
  toast(t.sinSeguridad?`Seguridad desactivada para ${cap(sanitizarTexto(t.nombre))}`:`Seguridad reactivada para ${cap(sanitizarTexto(t.nombre))}`,"ok");
  guardarEvento({tipoRegistro:"trabajadorFlags",nombre:t.nombre,sinSeguridad:t.sinSeguridad});
}

// ══ QUINCENA HELPERS ══
let _quinHistorial = 'q1';
let _quinCierre    = 'mes';
let _modoPeriodoHistorial = 'quincena'; // 'quincena' | 'semana'
let _semanaHistorial = 1;               // 1..5, bloques de 7 días del mes
let _filtroEngrasadorHistorial = '';
let _trabElimNube = new Set();   // nombres en D1 con evento eliminarTrabajador
let _planillaElimNube = new Set(); // ids en D1 con evento eliminarPlanilla

function setQuinHistorial(q, btn){
  _quinHistorial=q;
  document.querySelectorAll('#tabsQuinHistorial .periodo-tab').forEach(b=>b.classList.remove('activo'));
  if(btn) btn.classList.add('activo');
  mostrarHistorial();
}
function setModoPeriodoHistorial(modo){
  _modoPeriodoHistorial=modo;
  document.getElementById('btnModoQuincena')?.classList.toggle('activo', modo==='quincena');
  document.getElementById('btnModoSemana')?.classList.toggle('activo', modo==='semana');
  document.getElementById('tabsQuinHistorial')?.classList.toggle('oculto', modo!=='quincena');
  document.getElementById('tabsSemanaHistorial')?.classList.toggle('oculto', modo!=='semana');
  mostrarHistorial();
}
function setSemanaHistorial(sem, btn){
  _semanaHistorial=sem;
  document.querySelectorAll('#tabsSemanaHistorial .periodo-tab').forEach(b=>b.classList.remove('activo'));
  if(btn) btn.classList.add('activo');
  mostrarHistorial();
}
// Semana "de calendario simple": bloques fijos de 7 días dentro del mes (1-7, 8-14, 15-21, 22-28, 29-31).
function _enPeriodoHistorial(fecha){
  if(_modoPeriodoHistorial==='semana'){
    const dia=_getDia(fecha);
    if(!dia) return false;
    const sem=Math.min(5, Math.ceil(dia/7));
    return sem===_semanaHistorial;
  }
  return _enQuincena(fecha,_quinHistorial);
}
function setQuinCierre(q, btn){
  _quinCierre=q;
  document.querySelectorAll('#tabsQuinCierre .periodo-tab').forEach(b=>b.classList.remove('activo'));
  if(btn) btn.classList.add('activo');
  mostrarCierreMes();
}
function _getDia(fecha){
  if(!fecha) return 0;
  const m=fecha.match(/^(\d{1,2})[\/-]/);
  if(m) return parseInt(m[1]);
  const d=new Date(fecha); if(!isNaN(d)) return d.getDate();
  return 0;
}
function _enQuincena(fecha, q){
  if(q==='mes') return true;
  const dia=_getDia(fecha);
  if(q==='q1') return dia>=1&&dia<=15;
  if(q==='q2') return dia>=16;
  return true;
}
function calcularResumenQuincena(mes, q){
  if(q==='mes') return calcularResumenMes(mes);
  let tG=0,tA=0,tP=0;
  const trabajadores=negocio.trabajadores.map(t=>{
    const ganado=Math.round((negocio.historial||[])
      .filter(c=>c.mes===mes&&_enQuincena(c.fecha,q))
      .reduce((s,c)=>{
        [[c.trabajadorNombre1,c.pagoTrabajador1],[c.trabajadorNombre2,c.pagoTrabajador2],
         [c.trabajadorNombre3,c.pagoTrabajador3],[c.trabajadorNombre4,c.pagoTrabajador4]]
        .forEach(([n,p])=>{ if(n&&n.toLowerCase()===t.nombre.toLowerCase()) s+=Number(p||0); });
        return s;
      },0));
    const adelantos=Math.round((t.adelantos?.[mes]||[])
      .filter(a=>_enQuincena(a.fecha,q))
      .reduce((s,a)=>s+Number(a.valor||0),0));
    const segDesc=(t.sinSeguridad||ganado<=0)?0:Math.round(q==='q1'?Number(negocio.configuracion?.seguridadQ1||0):q==='q2'?Number(negocio.configuracion?.seguridadQ2||0):Number(negocio.configuracion?.seguridadQ1||0)+Number(negocio.configuracion?.seguridadQ2||0));
    const neto=Math.round(ganado-adelantos-segDesc);
    tG+=ganado;tA+=adelantos;tP+=neto;
    return{nombre:t.nombre,ganado,adelantos,seguridad:segDesc,totalPagar:neto};
  });
  return{trabajadores,totalGanado:Math.round(tG),totalAdelantos:Math.round(tA),totalPagar:Math.round(tP)};
}

// ══ CIERRE ══
// ══ PAGOS POR QUINCENA (trabajadores) ══
// pagosQuincena vive en cada trabajador: { [mes]: {q1:bool, q2:bool} }. No se
// borran ni se tocan historial/adelantos al pagar — solo se marca la bandera,
// asi el reporte (calcularResumenQuincena) sigue siendo la fuente de verdad
// de cuanto se gano, y esto solo dice si esa quincena ya se liquido en efectivo.
function _estaPagadoQuincena(t, mes, q){
  if(q==='mes') return _estaPagadoQuincena(t,mes,'q1') && _estaPagadoQuincena(t,mes,'q2');
  return !!(t.pagosQuincena?.[mes]?.[q]);
}
// == UNION DE QUINCENAS (seguridad supera lo ganado) ==
// Si en una quincena la Seguridad descontada es mayor que lo Ganado, "A pagar"
// queda negativo: no hay plata para descontarle ahi. En vez de forzar un pago
// negativo, esa quincena se marca 'unida' (en vez de true/false en pagosQuincena)
// y su Ganado+Adelantos+Seguridad se suman a la siguiente quincena, que es la
// que finalmente se paga. _arrastreEntrante() recorre hacia atras mientras
// encuentre quincenas 'unida' encadenadas, cubriendo tambien una union que
// cruza de la 2a quincena de un mes al 1 del mes siguiente.
function _esQuincenaUnida(t, mes, q){
  return t.pagosQuincena?.[mes]?.[q]==='unida';
}
function _quincenaAnterior(mes, q){
  if(q==='q2') return {mes,q:'q1'};
  const [y,m]=mes.split('-').map(Number);
  const mp=m===1?12:m-1, yp=m===1?y-1:y;
  return {mes:`${yp}-${String(mp).padStart(2,'0')}`, q:'q2'};
}
function _quincenaSiguiente(mes, q){
  if(q==='q1') return {mes,q:'q2'};
  const [y,m]=mes.split('-').map(Number);
  const ms=m===12?1:m+1, ys=m===12?y+1:y;
  return {mes:`${ys}-${String(ms).padStart(2,'0')}`, q:'q1'};
}
function _arrastreEntrante(t, mes, q){
  let acum={ganado:0,adelantos:0,seguridad:0};
  let cur={mes,q};
  for(let i=0;i<24;i++){
    const prev=_quincenaAnterior(cur.mes,cur.q);
    if(!_esQuincenaUnida(t,prev.mes,prev.q)) break;
    const base=calcularResumenQuincena(prev.mes,prev.q).trabajadores.find(x=>x.nombre===t.nombre)||{ganado:0,adelantos:0,seguridad:0};
    acum.ganado+=base.ganado; acum.adelantos+=base.adelantos; acum.seguridad+=base.seguridad;
    cur=prev;
  }
  return acum;
}
// calcularResumenQuincena no cobra Seguridad propia si Ganado<=0 en ese periodo
// (para no cobrarle a quien no trabajo nada esa quincena). Pero si esta quincena
// YA recibio un arrastre de la anterior (el trabajador sigue activo, solo que
// sus planillas de este periodo aun no se han registrado), esa Seguridad propia
// se sigue debiendo igual: no puede desaparecer solo porque todavia no hay
// planillas cargadas. _seguridadPropiaEfectiva fuerza el monto configurado en
// ese caso puntual, sin tocar el calculo general para el resto de casos.
function _seguridadPropiaEfectiva(t, mes, q, seguridadCalculada, tieneArrastre){
  if(t.sinSeguridad) return 0;
  if(!tieneArrastre) return seguridadCalculada;
  const config=Math.round(q==='q1'?Number(negocio.configuracion?.seguridadQ1||0):Number(negocio.configuracion?.seguridadQ2||0));
  return Math.max(seguridadCalculada, config);
}
function _montoPendienteTrabajador(t, mes, q, resumenQ1, resumenQ2){
  const fila=(qq)=> (qq==='q1'?resumenQ1:resumenQ2).trabajadores.find(x=>x.nombre===t.nombre) || {totalPagar:0,ganado:0,adelantos:0,seguridad:0};
  if(q==='mes'){
    let total=0;
    if(!_estaPagadoQuincena(t,mes,'q1')) total+=fila('q1').totalPagar;
    if(!_estaPagadoQuincena(t,mes,'q2')) total+=fila('q2').totalPagar;
    return Math.round(total);
  }
  if(_estaPagadoQuincena(t,mes,q)) return 0;
  const arr=_arrastreEntrante(t,mes,q);
  const tieneArrastre=!!(arr.ganado||arr.adelantos||arr.seguridad);
  const base=fila(q);
  const segPropia=_seguridadPropiaEfectiva(t,mes,q,base.seguridad||0,tieneArrastre);
  const totalPropio=(base.ganado||0)-(base.adelantos||0)-segPropia;
  return Math.round(totalPropio + arr.ganado - arr.adelantos - arr.seguridad);
}
async function pagarQuincenaTrabajador(idx, q){
  const t=negocio.trabajadores[idx]; if(!t) return;
  const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido();
  const qs = q==='mes' ? ['q1','q2'] : [q];
  const nom=cap(sanitizarTexto(t.nombre));
  confirmar("Pagar a "+nom, q==='mes'?"¿Marcar el mes completo como pagado?":`¿Marcar la ${q==='q1'?'1ª':'2ª'} quincena como pagada?`, async()=>{
    if(!t.pagosQuincena) t.pagosQuincena={};
    if(!t.pagosQuincena[mes]) t.pagosQuincena[mes]={};
    for(const qq of qs){
      t.pagosQuincena[mes][qq]=true;
      await guardarEvento({tipoRegistro:"pagoQuincenaTrabajador",nombre:t.nombre,mes,q:qq,pagado:true},1,0);
    }
    guardar(); actualizarTodo();
    toast("Pago registrado para "+nom,"ok");
  });
}
async function revertirPagoQuincenaTrabajador(idx, q){
  const t=negocio.trabajadores[idx]; if(!t) return;
  const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido();
  const qs = q==='mes' ? ['q1','q2'] : [q];
  confirmar("Revertir pago","¿Volver a marcar como pendiente?",async()=>{
    if(!t.pagosQuincena) t.pagosQuincena={};
    if(!t.pagosQuincena[mes]) t.pagosQuincena[mes]={};
    for(const qq of qs){
      t.pagosQuincena[mes][qq]=false;
      await guardarEvento({tipoRegistro:"pagoQuincenaTrabajador",nombre:t.nombre,mes,q:qq,pagado:false},1,0);
    }
    guardar(); actualizarTodo();
    toast("Pago revertido","ok");
  });
}
async function pasarQuincenaTrabajador(idx, mes, q){
  const t=negocio.trabajadores[idx]; if(!t) return;
  if(q==='mes') return;
  const nom=cap(sanitizarTexto(t.nombre));
  confirmar("Pasar a la siguiente quincena",
    `Se pasarán el Ganado, los Adelantos y la Seguridad de esta quincena de ${nom} a la siguiente. Esta quincena queda resuelta y no se paga por separado.`,
    async()=>{
      if(!t.pagosQuincena) t.pagosQuincena={};
      if(!t.pagosQuincena[mes]) t.pagosQuincena[mes]={};
      t.pagosQuincena[mes][q]='unida';
      guardar(); actualizarTodo();
      const r=await guardarEvento({tipoRegistro:"pagoQuincenaTrabajador",nombre:t.nombre,mes,q,pagado:'unida'},1,0);
      toast(r.ok?`Quincena de ${nom} pasada a la siguiente`:"Guardada localmente",r.ok?"ok":"aviso");
    });
}

// ══ PAGOS POR QUINCENA (perfiles / secretarias, no Admin) ══
// negocio.pagosPerfiles: { [nombrePerfil]: { [mes]: { q1:{valor,pagado}, q2:{valor,pagado} } } }
// El valor se escribe a mano (las secretarias no tienen "ganado" por planillas);
// se le restan sus adelantos de esa quincena (negocio.adelantosPerfiles) para el neto.
function _adelantosPerfilQuincena(nombre, mes, q){
  const lista=(negocio.adelantosPerfiles?.[nombre]?.[mes])||[];
  const filtrada = q==='mes' ? lista : lista.filter(a=>_enQuincena(a.fecha,q));
  return Math.round(filtrada.reduce((s,a)=>s+Number(a.valor||0),0));
}
function _valorQuincenaPerfil(nombre, mes, q){
  if(q==='mes') return _valorQuincenaPerfil(nombre,mes,'q1') + _valorQuincenaPerfil(nombre,mes,'q2');
  return Math.round(Number(negocio.pagosPerfiles?.[nombre]?.[mes]?.[q]?.valor||0));
}
function _estaPagadoQuincenaPerfil(nombre, mes, q){
  if(q==='mes') return _estaPagadoQuincenaPerfil(nombre,mes,'q1') && _estaPagadoQuincenaPerfil(nombre,mes,'q2');
  return !!(negocio.pagosPerfiles?.[nombre]?.[mes]?.[q]?.pagado);
}
function _montoPendientePerfil(nombre, mes, q){
  const neto=(qq)=>Math.max(0,_valorQuincenaPerfil(nombre,mes,qq)-_adelantosPerfilQuincena(nombre,mes,qq));
  if(q==='mes'){
    let total=0;
    if(!_estaPagadoQuincenaPerfil(nombre,mes,'q1')) total+=neto('q1');
    if(!_estaPagadoQuincenaPerfil(nombre,mes,'q2')) total+=neto('q2');
    return Math.round(total);
  }
  return _estaPagadoQuincenaPerfil(nombre,mes,q) ? 0 : Math.round(neto(q));
}
async function actualizarValorQuincenaPerfil(nombre, q, valorStr){
  if(q!=='q1' && q!=='q2') return; // solo se edita por quincena especifica
  const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido();
  const valor=Math.max(0, Number(String(valorStr).replace(/[^\d]/g,""))||0);
  if(!negocio.pagosPerfiles) negocio.pagosPerfiles={};
  if(!negocio.pagosPerfiles[nombre]) negocio.pagosPerfiles[nombre]={};
  if(!negocio.pagosPerfiles[nombre][mes]) negocio.pagosPerfiles[nombre][mes]={};
  if(!negocio.pagosPerfiles[nombre][mes][q]) negocio.pagosPerfiles[nombre][mes][q]={valor:0,pagado:false};
  negocio.pagosPerfiles[nombre][mes][q].valor=valor;
  guardar();
  await guardarEvento({tipoRegistro:"valorQuincenaPerfil",perfilNombre:nombre,mes,q,valor},valor,0);
  mostrarCierreMes();
}
async function pagarQuincenaPerfil(nombre, q){
  const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido();
  const qs = q==='mes' ? ['q1','q2'] : [q];
  confirmar("Pagar a "+cap(sanitizarTexto(nombre)), q==='mes'?"¿Marcar el mes completo como pagado?":`¿Marcar la ${q==='q1'?'1ª':'2ª'} quincena como pagada?`, async()=>{
    if(!negocio.pagosPerfiles) negocio.pagosPerfiles={};
    if(!negocio.pagosPerfiles[nombre]) negocio.pagosPerfiles[nombre]={};
    if(!negocio.pagosPerfiles[nombre][mes]) negocio.pagosPerfiles[nombre][mes]={};
    for(const qq of qs){
      if(!negocio.pagosPerfiles[nombre][mes][qq]) negocio.pagosPerfiles[nombre][mes][qq]={valor:0,pagado:false};
      negocio.pagosPerfiles[nombre][mes][qq].pagado=true;
      await guardarEvento({tipoRegistro:"pagoQuincenaPerfil",perfilNombre:nombre,mes,q:qq,pagado:true},1,0);
    }
    guardar(); actualizarTodo();
    toast("Pago registrado","ok");
  });
}
async function revertirPagoQuincenaPerfil(nombre, q){
  const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido();
  const qs = q==='mes' ? ['q1','q2'] : [q];
  confirmar("Revertir pago","¿Volver a marcar como pendiente?",async()=>{
    if(!negocio.pagosPerfiles) negocio.pagosPerfiles={};
    if(!negocio.pagosPerfiles[nombre]) negocio.pagosPerfiles[nombre]={};
    if(!negocio.pagosPerfiles[nombre][mes]) negocio.pagosPerfiles[nombre][mes]={};
    for(const qq of qs){
      if(!negocio.pagosPerfiles[nombre][mes][qq]) negocio.pagosPerfiles[nombre][mes][qq]={valor:0,pagado:false};
      negocio.pagosPerfiles[nombre][mes][qq].pagado=false;
      await guardarEvento({tipoRegistro:"pagoQuincenaPerfil",perfilNombre:nombre,mes,q:qq,pagado:false},1,0);
    }
    guardar(); actualizarTodo();
    toast("Pago revertido","ok");
  });
}

function getEstadoCierre(mes){ return negocio.cierresMes?.[mes]||"Pendiente"; }
function calcularResumenMes(mes){
  let tG=0,tA=0,tP=0;
  const trabajadores=negocio.trabajadores.map(t=>{
    // Usar historial (igual que quincenas) para no verse afectado por reset de pagos
    const ganado=Math.round((negocio.historial||[])
      .filter(c=>c.mes===mes)
      .reduce((s,c)=>{
        [[c.trabajadorNombre1,c.pagoTrabajador1],[c.trabajadorNombre2,c.pagoTrabajador2],
         [c.trabajadorNombre3,c.pagoTrabajador3],[c.trabajadorNombre4,c.pagoTrabajador4]]
        .forEach(([n,p])=>{ if(n&&n.toLowerCase()===t.nombre.toLowerCase()) s+=Number(p||0); });
        return s;
      },0));
    const adelantos=Math.round((t.adelantos?.[mes]||[]).reduce((s,a)=>s+Number(a.valor||0),0));
    const segDesc=(t.sinSeguridad||ganado<=0)?0:Math.round(Number(negocio.configuracion?.seguridadQ1||0)+Number(negocio.configuracion?.seguridadQ2||0));
    const neto=Math.round(ganado-adelantos-segDesc);
    tG+=ganado;tA+=adelantos;tP+=neto;
    return{nombre:t.nombre,ganado,adelantos,seguridad:segDesc,totalPagar:neto};
  });
  return{trabajadores,totalGanado:Math.round(tG),totalAdelantos:Math.round(tA),totalPagar:Math.round(tP)};
}
function mostrarCierreMes(){
  const el=document.getElementById("resumenCierre"); if(!el) return;
  sincronizarMeses();
  const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido();
  const q=_quinCierre;
  const resumenVista=calcularResumenQuincena(mes,q); // Ganado/Adelantos/Seguridad informativos, en el periodo elegido
  const resumenQ1=q==='mes'?calcularResumenQuincena(mes,'q1'):(q==='q1'?resumenVista:calcularResumenQuincena(mes,'q1'));
  const resumenQ2=q==='mes'?calcularResumenQuincena(mes,'q2'):(q==='q2'?resumenVista:calcularResumenQuincena(mes,'q2'));

  if(!negocio.trabajadores.length && !(negocio.perfiles||[]).some(p=>p.toLowerCase()!=="admin")){
    el.innerHTML="<p style='color:var(--gris);'>Sin engrasadores ni perfiles registrados.</p>";
    return;
  }

  const cardsTrabajadores = negocio.trabajadores.map((t,idx)=>{
    const fila=resumenVista.trabajadores.find(x=>x.nombre===t.nombre)||{ganado:0,adelantos:0,seguridad:0};
    const unida = q!=='mes' && _esQuincenaUnida(t,mes,q);
    const arrastre = q!=='mes' ? _arrastreEntrante(t,mes,q) : {ganado:0,adelantos:0,seguridad:0};
    const tieneArrastre = !!(arrastre.ganado||arrastre.adelantos||arrastre.seguridad);
    const ganadoMostrado = fila.ganado + arrastre.ganado;
    const adelantosMostrado = fila.adelantos + arrastre.adelantos;
    const seguridadPropiaEfectiva = q!=='mes' ? _seguridadPropiaEfectiva(t,mes,q,fila.seguridad,tieneArrastre) : fila.seguridad;
    const seguridadMostrada = seguridadPropiaEfectiva + arrastre.seguridad;
    const pendiente=_montoPendienteTrabajador(t,mes,q,resumenQ1,resumenQ2);
    const pagadoReal = !unida && pendiente<=0 && _estaPagadoQuincena(t,mes,q);
    const nomCierre = cap(sanitizarTexto(t.nombre));
    const ini = nomCierre.charAt(0).toUpperCase();
    const exentoSeguridad=!!t.sinSeguridad;
    return `<div class="cierre-card">
      <div class="cierre-card-header">
        <div class="cierre-card-avatar">${ini}</div>
        <div class="cierre-card-nombre">${nomCierre}</div>
        ${unida?'<span class="cierre-estado-badge" style="margin-left:auto;padding:4px 12px;font-size:12px;background:#eef1ff;color:var(--azul);">➡️ Unida a la siguiente</span>':(pagadoReal?'<span class="cierre-estado-badge pagado" style="margin-left:auto;padding:4px 12px;font-size:12px;">✅ Pagado</span>':'')}
      </div>
      <div class="cierre-card-stats">
        <div class="cierre-stat"><span>Ganado</span><strong>$${ganadoMostrado.toLocaleString()}</strong></div>
        <div class="cierre-stat"><span>Adelantos</span><strong>$${adelantosMostrado.toLocaleString()}</strong></div>
        <div class="cierre-stat">
          <span>Seguridad</span>
          <strong style="${seguridadMostrada>0?'color:var(--rojo)':''}">${seguridadMostrada>0?'-$'+seguridadMostrada.toLocaleString():'$0'}</strong>
          <button class="btn-sm ${exentoSeguridad?'btn-verde':'btn-rojo'}" style="margin-top:4px;padding:3px 8px;font-size:10px;white-space:nowrap;" onclick="toggleSeguridadTrabajador(${idx})" title="${exentoSeguridad?'Reactivar el cobro de seguridad a este engrasador':'Omitir el cobro de seguridad a este engrasador'}">${exentoSeguridad?'🔓 Sin cobro':'🔒 Cobrando'}</button>
        </div>
        <div class="cierre-stat neto" style="grid-column:3;text-align:right;"><span>A pagar</span><strong style="font-size:17px;">$${pendiente.toLocaleString()}</strong></div>
      </div>
      ${tieneArrastre&&!unida?`<p style="color:var(--gris);font-size:11px;margin:6px 0 0;">Incluye quincena anterior no cobrada (unida a esta).</p>`:''}
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        ${unida
          ?`<button class="btn-gris btn-sm" onclick="revertirPagoQuincenaTrabajador(${idx},'${q}')">↩️ Deshacer unión</button>`
          :pagadoReal
            ?`<button class="btn-gris btn-sm" onclick="revertirPagoQuincenaTrabajador(${idx},'${q}')">↩️ Revertir</button>`
            :(pendiente<0&&q!=='mes'
              ?`<button class="btn-amarillo btn-sm" onclick="pasarQuincenaTrabajador(${idx},'${mes}','${q}')">➡️ Pasar a la siguiente quincena</button>`
              :`<button class="btn-verde btn-sm" onclick="pagarQuincenaTrabajador(${idx},'${q}')">💸 Pagar</button>`)}
      </div>
    </div>`;
  }).join("");

  const perfilesSecretarias=(negocio.perfiles||[]).filter(p=>p.toLowerCase()!=="admin");
  const cardsPerfiles = perfilesSecretarias.map(nombre=>{
    const pendiente=_montoPendientePerfil(nombre,mes,q);
    const pagado=pendiente<=0 && _estaPagadoQuincenaPerfil(nombre,mes,q);
    const adelantos=_adelantosPerfilQuincena(nombre,mes,q);
    const valor=_valorQuincenaPerfil(nombre,mes,q);
    const nomCierre = cap(sanitizarTexto(nombre));
    const ini = nomCierre.charAt(0).toUpperCase();
    const editable = (q==='q1'||q==='q2') && !pagado;
    const nombreSafe = sanitizarTexto(nombre);
    return `<div class="cierre-card">
      <div class="cierre-card-header">
        <div class="cierre-card-avatar">${ini}</div>
        <div class="cierre-card-nombre">${nomCierre} <span style="font-size:11px;color:var(--gris);font-weight:400;">(perfil)</span></div>
        ${pagado?'<span class="cierre-estado-badge pagado" style="margin-left:auto;padding:4px 12px;font-size:12px;">✅ Pagado</span>':''}
      </div>
      <div class="cierre-card-stats">
        <div class="cierre-stat">
          <span>Valor quincena</span>
          ${editable
            ?`<input type="text" inputmode="numeric" value="${valor||''}" placeholder="0" style="width:100%;padding:6px 8px;font-weight:700;" onchange="actualizarValorQuincenaPerfil('${nombreSafe}','${q}',this.value)">`
            :`<strong>$${valor.toLocaleString()}</strong>`}
        </div>
        <div class="cierre-stat"><span>Adelantos</span><strong>$${adelantos.toLocaleString()}</strong></div>
        <div class="cierre-stat neto" style="grid-column:3;text-align:right;"><span>A pagar</span><strong style="font-size:17px;">$${pendiente.toLocaleString()}</strong></div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
        ${pagado
          ?`<button class="btn-gris btn-sm" onclick="revertirPagoQuincenaPerfil('${nombreSafe}','${q}')">↩️ Revertir</button>`
          :`<button class="btn-verde btn-sm" onclick="pagarQuincenaPerfil('${nombreSafe}','${q}')">💸 Pagar</button>`}
      </div>
    </div>`;
  }).join("");

  const totalPendiente =
    negocio.trabajadores.reduce((s,t)=>s+_montoPendienteTrabajador(t,mes,q,resumenQ1,resumenQ2),0) +
    perfilesSecretarias.reduce((s,nombre)=>s+_montoPendientePerfil(nombre,mes,q),0);

  el.innerHTML = cardsTrabajadores + cardsPerfiles +
    `<div class="cierre-total-bar"><span>Total pendiente</span><strong>$${totalPendiente.toLocaleString()}</strong></div>`;
}
async function marcarMesPagado(){ const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido(); if(!negocio.cierresMes)negocio.cierresMes={}; negocio.cierresMes[mes]="Pagado"; guardar(); actualizarTodo(); await guardarEvento({tipoRegistro:"cierreMes",mes,estado:"Pagado",fecha:new Date().toLocaleString()},1,0); toast("Mes marcado como pagado ","ok"); }
async function marcarMesPendiente(){ const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido(); if(!negocio.cierresMes)negocio.cierresMes={}; negocio.cierresMes[mes]="Pendiente"; guardar(); actualizarTodo(); await guardarEvento({tipoRegistro:"cierreMes",mes,estado:"Pendiente",fecha:new Date().toLocaleString()},1,0); toast("Mes marcado como pendiente","info"); }
function _rangoQuincena(mes, q){
  const [y,m]=mes.split('-');
  const hoy=new Date();
  const esMesAct=(hoy.getFullYear()===parseInt(y)&&(hoy.getMonth()+1)===parseInt(m));
  const dHoy=hoy.getDate();
  const mm=m.padStart(2,'0');
  const fmt=d=>`${String(d).padStart(2,'0')}/${mm}/${y}`;
  if(q==='q1'){
    const fin=esMesAct?Math.min(15,dHoy):15;
    return `${fmt(1)} al ${fmt(fin)}`;
  } else if(q==='q2'){
    const fin=esMesAct?dHoy:new Date(parseInt(y),parseInt(m),0).getDate();
    return `${fmt(16)} al ${fmt(fin)}`;
  }
  return `Mes completo`;
}
function imprimirResumen(){
  const mes=document.getElementById("mesCierre")?.value||mesPagoSugerido();
  const q=_quinCierre;
  const estado=getEstadoCierre(mes);
  const resumen=calcularResumenQuincena(mes,q);
  const quincenaNom=q==='q1'?'1ª Quincena':q==='q2'?'2ª Quincena':'Mes completo';
  const rango=_rangoQuincena(mes,q);
  const ven=window.open("","_blank");
  ven.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Resumen ${mes} — ${quincenaNom}</title><style>body{font-family:Arial,sans-serif;color:#243044;margin:20px;}.hdr{background:linear-gradient(135deg,#1f3c88,#1f8a4c);color:#fff;padding:18px 22px;border-radius:12px;margin-bottom:18px;}.hdr h1{margin:0 0 3px;font-size:24px;}table{width:100%;border-collapse:collapse;}th{background:#1f3c88;color:#fff;padding:8px 10px;text-align:left;}th:not(:first-child){text-align:right;}td{padding:7px 10px;border-bottom:1px solid #e2e8f0;text-align:left;}td:not(:first-child){text-align:right;}.total{background:linear-gradient(135deg,#1f3c88,#1f8a4c);color:#fff;padding:12px;border-radius:10px;margin-top:14px;}.firma{margin-top:50px;display:flex;justify-content:space-between;}.linea{border-top:1px solid #333;padding-top:7px;width:44%;text-align:center;font-size:12px;}.cred{margin-top:28px;text-align:center;font-size:11px;color:#64748b;border-top:1px solid #dce3f0;padding-top:10px;}@media print{button{display:none;}}
</style></head><body>
  <div class="hdr"><h1>SYMES</h1><p>${quincenaNom} — ${negocio.nombreNegocio}</p></div>
  <p><strong>Período:</strong> ${rango} &nbsp; <strong>Estado:</strong> ${estado} &nbsp; <strong>Impresión:</strong> ${new Date().toLocaleString()}</p>
  <table><thead><tr><th>Engrasador</th><th>Ganado</th><th>Adelantos</th><th>Seguridad</th><th>A pagar</th></tr></thead>
  <tbody>${resumen.trabajadores.map(t=>`<tr><td>${t.nombre}</td><td>$${t.ganado.toLocaleString()}</td><td>$${t.adelantos.toLocaleString()}</td><td style="color:#c0392b">${(t.seguridad||0)>0?'-$'+(t.seguridad||0).toLocaleString():'$0'}</td><td>$${t.totalPagar.toLocaleString()}</td></tr>`).join("")}</tbody></table>
  <div class="total">Total ganado: $${resumen.totalGanado.toLocaleString()} | Adelantos: $${resumen.totalAdelantos.toLocaleString()} | Seguridad: -$${resumen.trabajadores.reduce((s,t)=>s+(t.seguridad||0),0).toLocaleString()} | <strong>A pagar: $${resumen.totalPagar.toLocaleString()}</strong></div>
  <div class="firma"><div class="linea">Firma encargado</div><div class="linea">Firma engrasador / recibido</div></div>
  <div class="cred">SYMES V4.0 — Brandon Sebastian Arevalo Ojeda y Andrey Arévalo</div>
  <script>window.onload=function(){window.print();}<\/script><\/body><\/html>`);
  ven.document.close();
}

// ══ HISTORIAL ══
function _htmlResultadoLiquidacion(c, pl){
  const veh = pl?.vehiculos||null;
  const nSint = veh ? veh.filter(v=>v.tipoEngrase==='mixto').length : null;
  const nMixR = veh ? veh.filter(v=>v.tipoEngrase==='mixto_r').length : null;
  const nAzul = veh ? veh.filter(v=>v.tipoEngrase==='azul').length : null;
  return `<div style="background:#f7f9fc;border-radius:8px;padding:10px 12px;margin-top:8px;font-size:13px;">
    <strong>🛢️ Grasa</strong><br>Antes: ${Number(c.grasaAntes||0).toLocaleString()} g | Quedó: ${Number(c.grasaQuedo||0).toLocaleString()} g | Gastada: ${Number(c.grasaGastada||0).toLocaleString()} g → $${Number(c.valorGrasaGastada||0).toLocaleString()}<hr style="margin:6px 0;">
    <strong>Sintéticos${nSint!==null?' ('+nSint+')':''} · Mixtos${nMixR!==null?' ('+nMixR+')':''}</strong><br>Rebajados: $${Number(c.totalMixtosRebajados||0).toLocaleString()} → $${Number(c.porcentajeMixtos||0).toLocaleString()}<hr style="margin:6px 0;">
    <strong>Azules${nAzul!==null?' ('+nAzul+')':''}</strong><br>Total: $${Number(c.totalAzules||0).toLocaleString()} — Menos grasa: $${Number(c.azulesMenosGrasa||0).toLocaleString()} → $${Number(c.porcentajeAzules||0).toLocaleString()}<hr style="margin:6px 0;">
    <strong>Total: $${Number(c.totalFinal||0).toLocaleString()}</strong>
  </div>`;
}
function mostrarHistorial(){
  const el=document.getElementById("historialContenido"); if(!el) return;
  sincronizarMeses();
  const mes=document.getElementById("mesHistorial")?.value||mesPagoSugerido();

  // ── Filtro por engrasador ──
  const selE=document.getElementById("selFiltroEngrHistorial");
  if(selE){
    const nombres=(negocio.trabajadores||[]).map(t=>t.nombre);
    selE.innerHTML=`<option value="">👷 Todos</option>`+nombres.map(n=>`<option value="${sanitizarTexto(n)}" ${_filtroEngrasadorHistorial===n?'selected':''}>${cap(sanitizarTexto(n))}</option>`).join("");
  }

  // ── Botón de limpieza: visible si hay planillas liquidadas guardadas en algún lado ──
  const btnLimp=document.getElementById("btnLimpiarLiquidadas");
  if(btnLimp) btnLimp.style.display=(negocio.planillas||[]).some(p=>p.liquidada)?"inline-block":"none";

  el.innerHTML=""; let count=0;
  const entradasHist=[];
  (negocio.historial||[]).forEach((c,i)=>{
    if(c.mes!==mes) return;
    if(!_enPeriodoHistorial(c.fecha)) return;
    const nombresLiq=[c.trabajadorNombre1,c.trabajadorNombre2,c.trabajadorNombre3,c.trabajadorNombre4].filter(Boolean);
    if(_filtroEngrasadorHistorial && !nombresLiq.includes(_filtroEngrasadorHistorial)) return;
    const pl=c.planillaId?(negocio.planillas||[]).find(p=>p.id===c.planillaId):null;
    entradasHist.push({c,i,pl});
  });
  // Ordenar por fecha de la planilla (más reciente primero), igual que en Planillas.
  // Si no hay planilla asociada, se usa la fecha de liquidación como respaldo.
  entradasHist.sort((x,y)=>_parseFechaPlanilla(y.pl?.fecha||y.c.fecha)-_parseFechaPlanilla(x.pl?.fecha||x.c.fecha));
  entradasHist.forEach(({c,i,pl})=>{
    count++;
    const pagos=[[c.trabajadorNombre1,c.pagoTrabajador1],[c.trabajadorNombre2,c.pagoTrabajador2],[c.trabajadorNombre3,c.pagoTrabajador3],[c.trabajadorNombre4,c.pagoTrabajador4]].filter(([n])=>n).map(([n,p])=>`${cap(sanitizarTexto(n))}: $${fmtMiles(Number(p||0))}`).join("<br>");
    const bp=c.planillaId?`<span style="background:#e8f1ff;padding:2px 8px;border-radius:12px;font-size:11px;color:var(--azul);font-weight:700;">Desde planilla</span>`:"";
    const accionesPlanilla=pl?`
      <button class="btn-sm" onclick="_verPlanillaDesdeHistorial('${pl.id}')">👁️ Ver detalle</button>
      <button class="btn-sm" onclick="imprimirPlanilla('${pl.id}')">🖨️ PDF</button>
      ${pl.liquidada?`<button class="btn-amarillo btn-sm" onclick="revertirPlanillaLiquidada('${pl.id}')">↩️ Revertir</button>`:''}
    `:'';
    const idResLiq=`liqRes_${i}`;
    el.innerHTML+=`<div class="item"><h3>Liquidación ${bp}</h3><p><strong>Fecha:</strong> ${sanitizarTexto(pl?.fecha||c.fecha||"")}</p><p><strong>Total:</strong> $${fmtMiles(Number(c.totalFinal||0))}</p><p><strong>Pagos:</strong><br>${pagos}</p><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;"><button class="btn-sm" onclick="document.getElementById('${idResLiq}').classList.toggle('oculto')">📊 Resultado</button>${accionesPlanilla}<button class="btn-rojo btn-sm" onclick="eliminarLiquidacion(${i})">Eliminar</button></div><div id="${idResLiq}" class="oculto">${_htmlResultadoLiquidacion(c,pl)}</div></div>`;
  });
  if(!count) el.innerHTML="<p style='color:var(--gris);'>Sin liquidaciones en este período.</p>";
}
function _verPlanillaDesdeHistorial(id){
  const pl=(negocio.planillas||[]).find(p=>p.id===id);
  if(!pl){toast("Esta planilla ya no está disponible (fue archivada)","aviso");return;}
  mostrarPagina("paginaPlanillas");
  abrirPestania(id);
}
function eliminarLiquidacion(i){
  confirmar("Eliminar liquidación","¿Seguro? Se descontará el pago.",async()=>{
    const c=negocio.historial[i]; if(!c) return;
    const mes=c.mes;
    const descontar=(nom,idx,val)=>{ const t=getTrabPorNombre(nom)||(idx!==null&&negocio.trabajadores[idx]); if(t){if(!t.pagos)t.pagos={};if(!t.pagos[mes])t.pagos[mes]=0;t.pagos[mes]=Math.max(0,t.pagos[mes]-val);} };
    descontar(c.trabajadorNombre1,c.trabajadorIndex1,c.pagoTrabajador1);
    if(c.trabajadorNombre2) descontar(c.trabajadorNombre2,c.trabajadorIndex2,c.pagoTrabajador2);
    if(c.trabajadorNombre3) descontar(c.trabajadorNombre3,c.trabajadorIndex3,c.pagoTrabajador3);
    if(c.trabajadorNombre4) descontar(c.trabajadorNombre4,c.trabajadorIndex4,c.pagoTrabajador4);
    negocio.historial.splice(i,1); guardar(); actualizarTodo(); toast("Liquidación eliminada","ok");
    await guardarEvento({tipoRegistro:"eliminarLiquidacion",planillaId:c.planillaId,fecha:c.fecha,mes:c.mes});
  });
}
async function borrarHistorialMes(){
  confirmar("Borrar historial","¿Borrar todo el historial de este mes?",async()=>{
    const mes=document.getElementById("mesHistorial")?.value||mesPagoSugerido();
    negocio.historial=(negocio.historial||[]).filter(c=>c.mes!==mes); guardar(); actualizarTodo();
    await guardarEvento({tipoRegistro:"borrarHistorialMes",mes,fecha:new Date().toLocaleString()},1,0);
    toast("Historial borrado","ok");
  });
}

// ══ CONFIGURACIÓN ══
function cargarConfigEnPantalla(){
  const c=negocio?.configuracion; if(!c) return;
  const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v; };
  const setMiles=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v?fmtMiles(v):''; };
  setMiles("cfgPrecioGrasa",c.precioGrasa); set("cfgPctMixtos",c.porcentajeMixtos); set("cfgPctAzules",c.porcentajeAzules);
  setMiles("cfgSegQ1",c.seguridadQ1||0); setMiles("cfgSegQ2",c.seguridadQ2||0);

  mostrarReglas();
}
async function guardarConfig(){
  const get=id=>_leerNum(id);
  const getPct=id=>{ const el=document.getElementById(id); return el?Number(el.value||0):0; };
  const precioGrasa=get("cfgPrecioGrasa");
  const pctMixtos=getPct("cfgPctMixtos");
  const pctAzules=getPct("cfgPctAzules");
  if(precioGrasa<=0||precioGrasa>100000){toast("Precio de grasa inválido (debe ser positivo y menor a 100.000)","error");return;}
  if(pctMixtos<0||pctMixtos>100){toast("Porcentaje mixtos inválido (0-100)","error");return;}
  if(pctAzules<0||pctAzules>100){toast("Porcentaje azules inválido (0-100)","error");return;}
  negocio.configuracion.precioGrasa=precioGrasa;
  negocio.configuracion.porcentajeMixtos=pctMixtos;
  negocio.configuracion.porcentajeAzules=pctAzules;
  negocio.configuracion.seguridadQ1=Math.max(0,get("cfgSegQ1"));
  negocio.configuracion.seguridadQ2=Math.max(0,get("cfgSegQ2"));
  guardar();
  const r=await guardarEvento({tipoRegistro:"configuracion",configuracion:negocio.configuracion,fecha:new Date().toLocaleString()},1,0);
  toast(r.ok?"Configuración guardada ✅":"Guardada localmente",r.ok?"ok":"aviso");
}
function agregarRegla(){
  const orig=convertirValor(_leerNum("reglaOrig"));
  const reb=convertirValor(_leerNum("reglaReb"));
  if(orig<=0||reb<=0){toast("Ingresa valores válidos mayores a cero","error");return;}
  if(reb>orig){toast("El valor rebajado no puede ser mayor al original","error");return;}
  if(negocio.configuracion.reglasMixtos.some(r=>Number(r.original)===orig)){toast("Ya existe una regla para ese valor","aviso");return;}
  negocio.configuracion.reglasMixtos.push({original:orig,rebajado:reb});
  document.getElementById("reglaOrig").value="";
  document.getElementById("reglaReb").value="";
  guardar(); mostrarReglas(); toast("Regla agregada","ok");
}
function mostrarReglas(){ const el=document.getElementById("listaReglas"); if(!el) return; const r=negocio?.configuracion?.reglasMixtos||[]; el.innerHTML=!r.length?"<p style='color:var(--gris);'>Sin reglas.</p>":r.map((rr,i)=>`<div class="item" style="display:flex;justify-content:space-between;align-items:center;"><span>$${Number(rr.original).toLocaleString()} → $${Number(rr.rebajado).toLocaleString()}</span><button class="btn-rojo btn-sm" onclick="eliminarRegla(${i})">Eliminar</button></div>`).join(""); }
function eliminarRegla(i){ confirmar("Eliminar regla","¿Eliminar esta regla?",async()=>{ negocio.configuracion.reglasMixtos.splice(i,1); guardar(); mostrarReglas(); const r=await guardarEvento({tipoRegistro:"configuracion",configuracion:negocio.configuracion,fecha:new Date().toLocaleString()},1,0); toast(r.ok?"Regla eliminada":"Eliminada localmente (sin conexión)",r.ok?"ok":"aviso"); }); }

// ══ PLANES ══
function mostrarSolicitudPago(){ document.getElementById("panelSolicitudPago").classList.toggle("oculto"); }
function copiarNequi(){ navigator.clipboard?.writeText("3227167031").then(()=>toast("Número copiado ","ok")).catch(()=>toast("322-716-7031","info",5000)); }
function actualizarEstadoPlanes(){
  const el=document.getElementById("estadoPlanGratuito"); if(!el) return;
  const usado=periodoGratisUsado();
  el.innerHTML=usado?`<div class="alerta">El período de prueba ya fue usado en este dispositivo.</div>`:`<div class="alerta alerta-verde">Período de prueba gratuito disponible.</div>`;
}

// ══ SOLICITUD DE PAGO (SISTEMA ADMIN) ══
async function enviarSolicitudPago(){
  const nombre=document.getElementById("solNombre").value.trim();
  const comprobante=document.getElementById("solComprobante").value.trim();
  const metodo=document.getElementById("solMetodo").value;
  if(!nombre){ toast("Escribe tu nombre o correo","error"); return; }
  const solicitud={
    tipo:"solicitud_pago", nombre, comprobante, metodo,
    negocioId:negocio?.id, negocioNombre:negocio?.nombreNegocio,
    fecha:new Date().toLocaleString(), estado:"pendiente",
    deviceKey:getDeviceKey()
  };
  const el=document.getElementById("estadoSolicitud");
  el.innerHTML=`<div class="alerta">⏳ Enviando solicitud...</div>`;
  const r=await guardarEvento({tipoRegistro:"solicitud_pago",...solicitud},19900,0);
  if(r.ok){
    el.innerHTML=`<div class="alerta alerta-verde">Solicitud enviada correctamente. El administrador la revisará pronto.<br><strong>Estado: PENDIENTE</strong><br>Cuando sea aprobada, tu plan PRO se activará.</div>`;
    document.getElementById("solNombre").value=""; document.getElementById("solComprobante").value="";
    toast("Solicitud enviada ","ok");
  } else {
    el.innerHTML=`<div class="alerta alerta-rojo">No se pudo enviar. Contacta al administrador por WhatsApp al 322-716-7031.</div>`;
  }
}

// ══ SUPERADMIN — GESTIÓN DE USUARIOS ══
async function cargarSolicitudesAdmin() {
  if (!negocio?.esAdmin) { toast("Acceso denegado","error"); return; }
  const el = document.getElementById("listaSolicitudesAdmin");
  if (!el) return;
  el.innerHTML = "<p style='color:var(--gris);'>Cargando usuarios...</p>";
  try {
    const res = await fetch(`${API_URL}/solicitudes?_=${Date.now()}`);
    const lista = await res.json();
    // Actualizar stats
    const statT = document.getElementById("statTotal");
    const statA = document.getElementById("statActivos");
    const esInactivo = s => s && (s.activo===0 || s.activo===false || s.activo==="0");
    if (statT) statT.textContent = lista.length || 0;
    if (statA) statA.textContent = lista.filter(s=>!esInactivo(s)).length || 0;
    if (!lista.length) { el.innerHTML = "<p style='color:var(--gris);'>No hay usuarios registrados.</p>"; return; }
    el.innerHTML = lista.slice().reverse().map((s,i) => {
      const esAdminUser = (s.negocio||"").toLowerCase() === ADMIN_NAME;
      const inactivo = esInactivo(s);
      return `<div class="user-card">
        <div class="user-info">
          <div class="user-name">🏪 ${sanitizarTexto(s.negocio||"—")}</div>
          <div class="user-detail">
            ${s.propietario ? `👤 ${cap(sanitizarTexto(s.propietario))}` : ""}
            ${s.telefono && s.telefono!=="No registrado" ? ` · 📞 ${sanitizarTexto(s.telefono)}` : ""}
            ${s.fecha ? ` · 🗓️ ${sanitizarTexto(s.fecha)}` : ""}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${esAdminUser
            ? `<span class="badge-admin-user">👑 Superadmin</span>`
            : `${inactivo?`<span class="badge-inactivo">⛔ Desactivado</span>`:`<span class="badge-activo">✓ Activo</span>`}
               <button class="btn-outline btn-sm" data-uid="${String(s.id||"")}" data-neg="${sanitizarTexto(s.negocio||"")}" data-act="${inactivo?"1":"0"}" onclick="adminToggleEstado(this.dataset.uid,this.dataset.neg,this.dataset.act==='1')">${inactivo?"▶️ Activar":"⏸️ Desactivar"}</button>
               <button class="btn-amarillo btn-sm" onclick="adminResetearPassword('${sanitizarTexto(s.negocio||"")}')">🔑 Resetear</button>
               <button class="btn-rojo btn-sm" data-uid="${String(s.id||"")}" data-neg="${sanitizarTexto(s.negocio||"")}" onclick="adminEliminarUsuario(this.dataset.uid,this.dataset.neg)">🗑️</button>`
          }
        </div>
      </div>`;
    }).join("");
  } catch(err) {
    console.error(err);
    el.innerHTML = `<div class='alerta alerta-rojo'>Error cargando usuarios. Verifica la conexión.</div>`;
  }
}

async function adminAgregarUsuario() {
  const negocioNom = document.getElementById("adminAddNegocio").value.trim();
  const correo     = document.getElementById("adminAddCorreo").value.trim();
  const msgEl      = document.getElementById("adminAddMsg");
  if (!negocioNom || !correo) { toast("Completa nombre del negocio y correo","error"); return; }
  msgEl.innerHTML = "<div class='alerta'>⏳ Creando usuario...</div>";
  // 1. Registrar en el sistema
  const r = await nubePost("register", { negocio: negocioNom, usuario: correo, password: "123456" });
  if (!r.ok) {
    msgEl.innerHTML = `<div class='alerta alerta-rojo'>${sanitizarTexto(r.data?.error || "No se pudo crear el usuario")}</div>`;
    return;
  }
  // 2. Registrar en solicitudes para que aparezca en la lista
  await fetch(`${API_URL}/solicitudes`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ negocio: negocioNom, propietario: correo, telefono: "Admin creado" })
  });
  msgEl.innerHTML = `<div class='alerta alerta-verde'>✅ Usuario <strong>${sanitizarTexto(negocioNom)}</strong> creado. Contraseña inicial: <strong>123456</strong></div>`;
  document.getElementById("adminAddNegocio").value = "";
  document.getElementById("adminAddCorreo").value  = "";
  toast("Usuario creado exitosamente","ok");
  setTimeout(cargarSolicitudesAdmin, 800);
}

async function adminResetearPassword(negocioNom) {
  confirmar("Resetear contraseña",
    `¿Resetear la contraseña de "${negocioNom}" a 123456?`,
    async () => {
      const r = await nubePost("admin/reset-password", {
        admin_usuario: cuentaAct,
        negocio: negocioNom,
        nueva_password: "123456"
      });
      if (r.ok) {
        toast(`Contraseña de ${negocioNom} reseteada a 123456`,"ok");
      } else {
        // Endpoint aún no existe en el Worker — mostrar instrucción manual
        toast("Agrega el endpoint /admin/reset-password al Worker de Cloudflare","aviso",5000);
        console.warn("Necesario en Worker: POST /admin/reset-password → {negocio, nueva_password}");
      }
    }
  );
}



// ══ PWA ══
let evtInstall=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();evtInstall=e;document.getElementById("btnInstalar")?.classList.remove("oculto");});
document.getElementById("btnInstalar")?.addEventListener("click",async()=>{
  if(evtInstall){evtInstall.prompt();await evtInstall.userChoice;evtInstall=null;document.getElementById("btnInstalar")?.classList.add("oculto");}
  else document.getElementById("instrIOS")?.classList.toggle("oculto");
});

// ══ ARRANQUE ══
// Sube a D1 cualquier eliminación que solo quedó en localStorage (sin conexión previa)
async function _sincronizarEliminaciones(){
  const localT=(negocio.trabajadoresEliminados||[]);
  for(const nombre of localT){
    if(!_trabElimNube.has(nombre.toLowerCase())){
      await guardarEvento({tipoRegistro:"eliminarTrabajador",nombre});
    }
  }
  const localP=(negocio.planillasEliminadas||[]);
  for(const id of localP){
    if(!_planillaElimNube.has(id)){
      await guardarEvento({tipoRegistro:"eliminarPlanilla",planillaId:id});
    }
  }
}
async function iniciarSesionGuardada(){
  try{ await cargarTrabajadores(); await cargarLiquidaciones(); await _sincronizarEventosPendientes(); await _sincronizarEliminaciones(); } catch(e){ console.error("Error sync:",e); }
  entrarSistema();
}
if(cuentaAct&&negocio){ iniciarSesionGuardada(); }
else {
  // Siempre mostrar login al iniciar (con o sin sesión recordada)
  mostrarLogin();
}


// NUEVA VALIDACION TRIAL
function verificarAccesoCuenta(negocio){
  if(!negocio) return false;

  const tienePro = negocio.plan === 'pro' || negocio.proActivo === true;

  if(tienePro) return true;

  const fechaRegistro = new Date(negocio.fechaRegistro || Date.now());
  const hoy = new Date();

  const dias = Math.floor((hoy - fechaRegistro)/(1000*60*60*24));

  if(dias <= 30){
    return true;
  }

  mostrarModalProObligatorio();
  return false;
}


function actualizarEstadoCuenta(){
  try{
    const el = document.getElementById('estadoCuentaTexto');
    if(!el) return;
    // Leer del estado actual en memoria (no del key legacy 'negocioActivo')
    const neg = (cuentaAct && cuentas) ? cuentas[cuentaAct] : null;
    if(!neg){ el.innerHTML = ''; return; }
    const pro = neg.plan === 'pro' || neg.proActivo === true ||
                neg.plan === 'pro_trial';
    if(pro){
      el.innerHTML = '<span class="plan-activo">PRO ACTIVADO</span>';
    }else{
      el.innerHTML = '<span class="plan-inactivo">PERÍODO GRATUITO</span>';
    }
  }catch(e){}
}

setTimeout(actualizarEstadoCuenta,1000);


// RESPALDO SOLICITUDES PRO
async function enviarSolicitudPro(datos){
  try{
    const solicitudes = JSON.parse(localStorage.getItem('solicitudesPro') || '[]');

    datos.fecha = new Date().toISOString();
    datos.estado = 'pendiente';

    solicitudes.unshift(datos);

    localStorage.setItem('solicitudesPro', JSON.stringify(solicitudes));

    console.log('Solicitud guardada localmente');

    if(typeof API_URL !== 'undefined'){
      try{
        await fetch(API_URL + '/solicitudes', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(datos)
        });
        console.log('Solicitud enviada nube');
      }catch(err){
        console.log('Cloudflare no respondió, queda respaldo local');
      }
    }

    return true;

  }catch(e){
    console.log(e);
    return false;
  }
}


function registrarLiquidacionEngrasador(nombre, valor){
  try{
    const liquidaciones = JSON.parse(localStorage.getItem('liquidacionesEngrasadores') || '[]');

    liquidaciones.push({
      nombre,
      valor,
      fecha:new Date().toISOString()
    });

    localStorage.setItem('liquidacionesEngrasadores', JSON.stringify(liquidaciones));

  }catch(e){
    console.log(e);
  }
}
  function abrirTerminos() {
  document.querySelectorAll(".pagina").forEach(p => p.classList.add("oculto"));
  document.getElementById("paginaTerminos").classList.remove("oculto");
}

// ══════════════════════════════════════════════════════════
//  RESET CONTRASEÑA DESDE LOGIN
// ══════════════════════════════════════════════════════════
function mostrarResetLogin() {
  const panel = document.getElementById("panelResetLogin");
  if (panel) {
    panel.classList.toggle("oculto");
    const nomLogin = document.getElementById("loginNombre")?.value;
    const inp = document.getElementById("resetLoginNombre");
    if (inp && nomLogin) inp.value = nomLogin;
  }
}
async function solicitarResetLogin() {
  const nom = document.getElementById("resetLoginNombre")?.value.trim();
  const msgEl = document.getElementById("resetLoginMsg");
  if (!nom) { toast("Escribe el nombre exacto de tu negocio","error"); return; }
  msgEl.innerHTML = "<div class='alerta'>⏳ Enviando solicitud...</div>";
  const r = await nubePost("admin/reset-password", {
    negocio: nom,
    nueva_password: "123456",
    solicitante: "usuario"
  });
  if (r.ok) {
    msgEl.innerHTML = `<div class='alerta alerta-verde'>✅ Solicitud enviada. El administrador reseteará tu contraseña a <strong>123456</strong>. Intenta ingresar en unos minutos.</div>`;
    toast("Solicitud de reset enviada","ok");
  } else {
    msgEl.innerHTML = `<div class='alerta alerta-rojo'>No se pudo procesar. Contacta al admin por WhatsApp: <strong>322-716-7031</strong></div>`;
  }
}

// CAMBIAR PASSWORD PROPIO
async function cambiarPasswordPropio() {
  const pwActual = document.getElementById("pwActual")?.value.trim();
  const pwNueva  = document.getElementById("pwNueva")?.value.trim();
  const pwConf   = document.getElementById("pwConfirmar")?.value.trim();
  const msgEl    = document.getElementById("msgCambiarPw");
  if (!pwActual||!pwNueva||!pwConf) { toast("Completa todos los campos","error"); return; }
  if (pwNueva.length < 6) { toast("Minimo 6 caracteres","error"); return; }
  if (pwNueva !== pwConf) { toast("Las contrasenas no coinciden","error"); return; }
  if (msgEl) msgEl.innerHTML = "<div class='alerta'>Cambiando...</div>";
  const r = await nubePost("change-password", {
    negocio: negocio.nombreNegocio,
    password_actual: pwActual,
    nueva_password: pwNueva
  });
  if (r.ok) {
    if (msgEl) msgEl.innerHTML = "<div class='alerta alerta-verde'>Contrasena cambiada.</div>";
    toast("Contrasena actualizada","ok");
    ["pwActual","pwNueva","pwConfirmar"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
  } else {
    const err = r.data?.error || "Error al cambiar";
    if (msgEl) msgEl.innerHTML = "<div class='alerta alerta-rojo'>" + err + "</div>";
    toast(err,"error");
  }
}




// ══ ADMIN: ELIMINAR USUARIO ═══════════════════════════════════════════════
async function adminEliminarUsuario(id, negocioNom){
  if(!negocio?.esAdmin){ toast("Acceso denegado","error"); return; }
  confirmar(
    "Eliminar cuenta",
    `¿Eliminar permanentemente la cuenta "${negocioNom}"? Esta acción no se puede deshacer.`,
    async ()=>{
      toast("Eliminando cuenta...","info");
      try{
        // Payload con id numérico correcto + negocio name
        const payload={
          admin_usuario: cuentaAct,
          target_negocio: negocioNom
        };
        if(id) payload.target_id = id;
        const res=await fetch(`${API_URL}/admin/delete-account`,{
          method:'DELETE',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });
        const data=await res.json().catch(()=>({}));
        if(res.ok){
          toast(`Cuenta "${negocioNom}" eliminada ✅`,"ok");
          setTimeout(cargarSolicitudesAdmin,600);
        } else {
          toast(data.error||"No se pudo eliminar","error");
          console.error("adminEliminarUsuario error:",data);
        }
      }catch(e){
        toast("Error de conexión al eliminar","error");
        console.error(e);
      }
    }
  );
}

// ══ ADMIN: ACTIVAR / DESACTIVAR USUARIO (sin borrar datos) ═════════════════
async function adminToggleEstado(id, negocioNom, activar){
  if(!negocio?.esAdmin){ toast("Acceso denegado","error"); return; }
  confirmar(
    activar ? "Activar cuenta" : "Desactivar cuenta",
    activar
      ? `¿Reactivar la cuenta "${negocioNom}"? Podrá iniciar sesión de nuevo.`
      : `¿Desactivar la cuenta "${negocioNom}"? No podrá iniciar sesión hasta que la reactives. Sus datos NO se eliminan.`,
    async ()=>{
      toast(activar?"Activando cuenta...":"Desactivando cuenta...","info");
      try{
        const payload={
          admin_usuario: cuentaAct,
          target_negocio: negocioNom,
          activo: activar?1:0
        };
        if(id) payload.target_id = id;
        const res=await fetch(`${API_URL}/admin/toggle-account`,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify(payload)
        });
        const data=await res.json().catch(()=>({}));
        if(res.ok){
          toast(`Cuenta "${negocioNom}" ${activar?"activada ✅":"desactivada ⛔"}`,"ok");
          setTimeout(cargarSolicitudesAdmin,500);
        } else {
          toast(data.error||`No se pudo ${activar?"activar":"desactivar"} la cuenta`,"error");
          console.error("adminToggleEstado error:",data);
        }
      }catch(e){
        toast("Error de conexión","error");
        console.error(e);
      }
    }
  );
}

// ══ NOTIFICACIONES PWA ════════════════════════════════════════════════════
async function iniciarNotificaciones(){
  if(!negocio||!('Notification' in window)) return;
  if(Notification.permission==='default'){
    const p=await Notification.requestPermission();
    if(p==='granted') verificarNotificaciones();
  } else if(Notification.permission==='granted'){
    verificarNotificaciones();
  }
}

function verificarNotificaciones(){
  if(!negocio||Notification.permission!=='granted') return;
  const iconoApp='favicon.png.png';

  // 1. Planillas sin liquidar > 24h
  const ahora=Date.now();
  const pendientes=(negocio.planillas||[]).filter(pl=>{
    if(pl.liquidada) return false;
    try{
      // fecha guardada como "2026-06-23" o timestamp
      const t=new Date(pl.fecha).getTime();
      return !isNaN(t)&&(ahora-t)>86400000;
    }catch(_){return false;}
  });
  if(pendientes.length>0){
    new Notification('⏳ SYMES — Planillas pendientes',{
      body:`Tienes ${pendientes.length} planilla(s) sin liquidar de más de 24 horas.`,
      icon:iconoApp, tag:'symes-planillas-pendientes'
    });
  }

  // 2. Último día del mes sin cierre
  const hoy=new Date(), manana=new Date(hoy);
  manana.setDate(hoy.getDate()+1);
  if(hoy.getMonth()!==manana.getMonth()){
    const mk=mesActual();
    if(negocio.cierresMes?.[mk]!=='Pagado'){
      setTimeout(()=>{
        new Notification('📅 SYMES — Cierre de mes',{
          body:`Hoy es el último día del mes. Recuerda hacer el cierre de ${mk}.`,
          icon:iconoApp, tag:'symes-cierre-mes'
        });
      },1500);
    }
  }
}

// ══ ESTADÍSTICAS ══════════════════════════════════════════════════════════
// ══ SERVICE WORKER (PWA offline) ══════════════════════
if ('serviceWorker' in navigator) {
  // Desregistrar cualquier SW viejo que cache versiones antiguas
  navigator.serviceWorker.getRegistrations().then(regs=>{
    regs.forEach(r=>{ console.log('[SW] Eliminando SW viejo:', r.scope); r.unregister(); });
  });
  // Limpiar cachés viejos
  if(window.caches){ caches.keys().then(keys=>keys.forEach(k=>caches.delete(k))); }
}
if (false && 'serviceWorker' in navigator) {  // PWA desactivado temporalmente
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('SYMES-FINAL/service-worker.js')
      .then(function(reg) { console.log('[SW] Registrado:', reg.scope); })
      .catch(function(err) { console.warn('[SW] Error al registrar:', err); });
  });
}

// ── Cerrar menú al hacer clic afuera ──
document.addEventListener("click", function(e) {
  const cm = document.getElementById("contenidoMenu");
  const trig = document.getElementById("sidebarTrigger");
  if (cm && cm.classList.contains("sidebar-abierto") && !cm.contains(e.target) && (!trig || !trig.contains(e.target))) {
    cm.classList.remove("sidebar-abierto");
  }
}, true);

// ── Hover sidebar izquierdo ──
let _sidebarTimer = null;
function _abrirSidebar(){ clearTimeout(_sidebarTimer); const cm=document.getElementById("contenidoMenu"); if(cm) cm.classList.add("sidebar-abierto"); }
function _cerrarSidebarDelay(){ _sidebarTimer=setTimeout(()=>{ const cm=document.getElementById("contenidoMenu"); if(cm) cm.classList.remove("sidebar-abierto"); },220); }
(function(){
  const trig=document.getElementById("sidebarTrigger");
  const cm=document.getElementById("contenidoMenu");
  if(trig){ trig.addEventListener("mouseenter",_abrirSidebar); trig.addEventListener("mouseleave",_cerrarSidebarDelay); }
  if(cm){ cm.addEventListener("mouseenter",_abrirSidebar); cm.addEventListener("mouseleave",_cerrarSidebarDelay); }
})();

// ── Teclado en modal de confirmación ──
document.addEventListener("keydown", function(e) {
  const modal = document.getElementById("modalConfirm");
  if (!modal || !modal.classList.contains("abierto")) return;
  const btns = Array.from(modal.querySelectorAll(".modal-acciones button"));
  if (!btns.length) return;
  const idx = btns.indexOf(document.activeElement);
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    e.preventDefault();
    btns[(idx + 1) % btns.length].focus();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    e.preventDefault();
    btns[((idx - 1) + btns.length) % btns.length].focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    cerrarModal("modalConfirm");
  }
  // Enter funciona nativamente sobre el botón enfocado
});

