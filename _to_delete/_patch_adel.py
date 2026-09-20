import sys
path = "index.html"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''  el.innerHTML="";
  if(!items.length){ el.innerHTML="<p style='color:var(--gris);'>Sin adelantos en este mes.</p>"; return; }
  items.forEach(({tipo,iT,iA,nombre,adelanto:a})=>{
    const div=document.createElement("div"); div.className="item";
    const h3=document.createElement("h3"); h3.textContent=cap(nombre);
    const p1=document.createElement("p"); p1.innerHTML=`<strong>Valor:</strong> $${Number(a.valor).toLocaleString()}`;
    const p2=document.createElement("p"); p2.innerHTML="<strong>Nota:</strong> "+sanitizarTexto(a.nota||"Sin nota");
    const p3=document.createElement("p"); p3.innerHTML="<strong>Fecha:</strong> "+sanitizarTexto(a.fecha);
    const btn=document.createElement("button"); btn.className="btn-rojo btn-sm"; btn.textContent="Eliminar";
    btn.addEventListener("click",()=>tipo==="perfil"?eliminarAdelantoPerfil(nombre,iA):eliminarAdelanto(iT,iA));
    const nodos=[h3,p1,p2,p3];
    if(a.creadoPor){ const p4=document.createElement("p"); p4.innerHTML="<strong>Registrado por:</strong> "+sanitizarTexto(a.creadoPor); nodos.push(p4); }
    nodos.push(btn);
    div.append(...nodos); el.appendChild(div);
  });
}
function eliminarAdelanto(iT,iA){'''

new = '''  el.innerHTML="";
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
function eliminarAdelanto(iT,iA){'''

n = src.count(old)
if n != 1:
    print(f"ERROR: encontrado {n} veces (esperado 1)")
    sys.exit(1)

src = src.replace(old, new)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: 1 edicion aplicada")
