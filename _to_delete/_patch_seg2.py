import sys
path = "index.html"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''function calcularResumenQuincena(mes, q){
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
}'''

new = '''// Ganado del trabajador en TODO el mes (las dos quincenas), no solo la que se
// esta consultando. Se usa como criterio de "estuvo activo este mes" para
// decidir si se le cobra Seguridad esa quincena — un trabajador que SI trabajo
// en el mes (aunque sea solo en la 1a quincena) sigue debiendo la Seguridad de
// la 2a aunque esa quincena puntual todavia no tenga planillas cargadas; uno
// que no trabajo nada en todo el mes (no existia, estaba de baja, etc.) no.
function _ganadoMesTrabajador(t, mes){
  return Math.round((negocio.historial||[])
    .filter(c=>c.mes===mes)
    .reduce((s,c)=>{
      [[c.trabajadorNombre1,c.pagoTrabajador1],[c.trabajadorNombre2,c.pagoTrabajador2],
       [c.trabajadorNombre3,c.pagoTrabajador3],[c.trabajadorNombre4,c.pagoTrabajador4]]
      .forEach(([n,p])=>{ if(n&&n.toLowerCase()===t.nombre.toLowerCase()) s+=Number(p||0); });
      return s;
    },0));
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
    const segDesc=(t.sinSeguridad||_ganadoMesTrabajador(t,mes)<=0)?0:Math.round(q==='q1'?Number(negocio.configuracion?.seguridadQ1||0):q==='q2'?Number(negocio.configuracion?.seguridadQ2||0):Number(negocio.configuracion?.seguridadQ1||0)+Number(negocio.configuracion?.seguridadQ2||0));
    const neto=Math.round(ganado-adelantos-segDesc);
    tG+=ganado;tA+=adelantos;tP+=neto;
    return{nombre:t.nombre,ganado,adelantos,seguridad:segDesc,totalPagar:neto};
  });
  return{trabajadores,totalGanado:Math.round(tG),totalAdelantos:Math.round(tA),totalPagar:Math.round(tP)};
}'''

n = src.count(old)
if n != 1:
    print(f"ERROR: encontrado {n} veces (esperado 1)")
    sys.exit(1)

src = src.replace(old, new)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: 1 edicion aplicada")
