path = "index.html"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

edits = []

# 1 - agrega helper _seguridadPropiaEfectiva y usa segPropia efectiva en _montoPendienteTrabajador
edits.append((
'''function _arrastreEntrante(t, mes, q){
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
function _montoPendienteTrabajador(t, mes, q, resumenQ1, resumenQ2){
  const fila=(qq)=> (qq==='q1'?resumenQ1:resumenQ2).trabajadores.find(x=>x.nombre===t.nombre) || {totalPagar:0};
  if(q==='mes'){
    let total=0;
    if(!_estaPagadoQuincena(t,mes,'q1')) total+=fila('q1').totalPagar;
    if(!_estaPagadoQuincena(t,mes,'q2')) total+=fila('q2').totalPagar;
    return Math.round(total);
  }
  if(_estaPagadoQuincena(t,mes,q)) return 0;
  const arr=_arrastreEntrante(t,mes,q);
  return Math.round(fila(q).totalPagar + arr.ganado - arr.adelantos - arr.seguridad);
}''',
'''function _arrastreEntrante(t, mes, q){
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
}'''
))

# 2 - card de Pagos: usar seguridad propia efectiva en el desglose mostrado
edits.append((
'''  const cardsTrabajadores = negocio.trabajadores.map((t,idx)=>{
    const fila=resumenVista.trabajadores.find(x=>x.nombre===t.nombre)||{ganado:0,adelantos:0,seguridad:0};
    const unida = q!=='mes' && _esQuincenaUnida(t,mes,q);
    const arrastre = q!=='mes' ? _arrastreEntrante(t,mes,q) : {ganado:0,adelantos:0,seguridad:0};
    const tieneArrastre = !!(arrastre.ganado||arrastre.adelantos||arrastre.seguridad);
    const ganadoMostrado = fila.ganado + arrastre.ganado;
    const adelantosMostrado = fila.adelantos + arrastre.adelantos;
    const seguridadMostrada = fila.seguridad + arrastre.seguridad;
    const pendiente=_montoPendienteTrabajador(t,mes,q,resumenQ1,resumenQ2);
    const pagadoReal = !unida && pendiente<=0 && _estaPagadoQuincena(t,mes,q);
    const nomCierre = cap(sanitizarTexto(t.nombre));
    const ini = nomCierre.charAt(0).toUpperCase();
    const exentoSeguridad=!!t.sinSeguridad;''',
'''  const cardsTrabajadores = negocio.trabajadores.map((t,idx)=>{
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
    const exentoSeguridad=!!t.sinSeguridad;'''
))

errors = []
for i, (old, new) in enumerate(edits):
    n = src.count(old)
    if n != 1:
        errors.append(f"Edit {i+1}: encontrado {n} veces (esperado 1)")
    else:
        src = src.replace(old, new)

import sys
if errors:
    print("ERRORES:")
    for e in errors: print(" -", e)
    sys.exit(1)

with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: 2 ediciones aplicadas")
