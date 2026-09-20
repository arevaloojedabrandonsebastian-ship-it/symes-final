import sys
path = "index.html"
with open(path, "r", encoding="utf-8") as f:
    src = f.read()

old = '''    let total=0;
    if(!_estaPagadoQuincena(t,mes,'q1')) total+=fila('q1').totalPagar;
    if(!_estaPagadoQuincena(t,mes,'q2')) total+=fila('q2').totalPagar;
    return Math.round(total);
  }'''

new = '''    // OJO: no sumar fila('q1').totalPagar/fila('q2').totalPagar directo aca.
    // fila() sale de calcularResumenQuincena, que NO sabe de quincenas 'unida'
    // (arrastradas a la siguiente) — sumaba las dos quincenas "propias" pero
    // si una estaba 'unida' quedaba excluida por _estaPagadoQuincena sin que
    // su Ganado/Adelantos/Seguridad se trasladaran a la otra, y esa plata
    // (y su Seguridad) desaparecia del total del mes. Reutilizando la rama
    // q1/q2 (que si arma el arrastre via _arrastreEntrante) para cada una y
    // sumando el resultado, la unida aporta $0 (ya esta resuelta en la otra)
    // y la que la recibio ya trae sumado su propio Ganado/Adelantos/Seguridad
    // MAS el de la unida.
    return Math.round(
      _montoPendienteTrabajador(t,mes,'q1',resumenQ1,resumenQ2) +
      _montoPendienteTrabajador(t,mes,'q2',resumenQ1,resumenQ2)
    );
  }'''

n = src.count(old)
if n != 1:
    print(f"ERROR: encontrado {n} veces (esperado 1)")
    sys.exit(1)

src = src.replace(old, new)
with open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("OK: 1 edicion aplicada")
