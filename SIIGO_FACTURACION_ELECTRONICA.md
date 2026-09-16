# Facturación Electrónica en SYMES vía Siigo API

Documento de trabajo para implementar facturación electrónica (DIAN) en SYMES usando la API de Siigo. No implica cambios en el `index.html` en producción — este documento es la guía para desarrollarlo en un clon/rama aparte.

Fecha: 2026-09-16
Repo: `symes-final` (Cloudflare Pages) + Worker/D1 para sincronización de eventos.

---

## 0. Contexto de partida

- SYMES hoy es una SPA de un solo archivo (`index.html`, ~5200 líneas, todo el JS inline).
- No tiene backend propio de negocio: usa un Worker de Cloudflare + D1 solo para sincronizar eventos entre dispositivos (`guardarEvento` → POST al Worker → `procesarEvento` en cada cliente).
- Deploy: `push-symes.bat` hace `git commit` + `git push` + `wrangler pages deploy` + promoción a producción. Se corre manualmente en Windows, no desde este entorno.
- No existe ningún código de facturación hoy (`factura`/`siigo`/`dian` no aparecen en el proyecto salvo el texto del plan PRO).
- Siigo API es la vía oficial: expone `/invoices` (facturación electrónica), `/customers`, `/products`, `/purchases`, `/credit-notes`, `/vouchers`, `/payment-receipts`, `/journals`, autenticación OAuth con Username + Access Key.

---

## 1. Prerrequisitos en la cuenta Siigo (hacer antes de escribir código)

1. **Confirmar que el plan de Siigo incluye API.** No todos los planes la traen habilitada. Verificar en Siigo Nube → *Alianzas* → si aparece el botón "Mi Credencial API". Si no aparece, escribir a `soporteapi@siigo.com` con el NIT de la cuenta y preguntar si el plan actual la incluye o si hay que subir de plan.
2. **Resolución de facturación electrónica vigente ante la DIAN** cargada en Siigo (numeración autorizada, rango de folios). Sin esto la API rechaza el timbrado. Se configura en Siigo Nube, no vía API.
3. **Catálogo contable mínimo en Siigo**: al menos un centro de costos/cuenta por defecto, impuestos configurados (IVA, INC si aplica), y al menos un vendedor (`seller`) activo.
4. **Generar credenciales API**: Siigo Nube → *Alianzas* → "Mi Credencial API" → genera Username + Access Key. Guardarlas fuera del repo (ver sección 8, Seguridad).
5. **Decidir si se prueba en la cuenta real o si Siigo ofrece ambiente de pruebas.** Siigo API no documenta públicamente un sandbox separado; hay que confirmarlo con soporte. Si no hay sandbox, las pruebas se hacen contra la cuenta real y luego se **anulan** las facturas de prueba (una factura electrónica ya timbrada ante la DIAN no se puede "borrar", solo anular con nota crédito o anulación formal) — por eso todo el desarrollo y pruebas van en el clon, nunca contra el flujo real de cobro de SYMES hasta el día del corte.

---

## 2. Arquitectura: por qué no se llama a Siigo directo desde el navegador

La Access Key de Siigo es una credencial de altísimo privilegio (crea/edita facturas, terceros, contabilidad). Si `index.html` la llamara directo desde el navegador:

- quedaría visible en el código fuente del cliente (F12 → cualquiera la copia);
- Siigo probablemente bloquea CORS para llamadas browser-to-API de todas formas.

**Por eso la integración necesita un backend intermedio**, y SYMES ya tiene uno: el Worker de Cloudflare que hoy maneja `reset-password` y la sincronización de eventos. La solución es agregarle rutas nuevas a ese mismo Worker, siguiendo el patrón que ya usa (`if (path === "/algo" && method === "POST") { return handleAlgo(request, env); }`, respuesta JSON con CORS abierto).

```
[Navegador: index.html]  →  [Worker Cloudflare]  →  [API Siigo]
                              guarda Access Key
                              como secret, maneja
                              el token OAuth
```

El Worker es el único que conoce la Access Key. El frontend solo llama rutas propias como `/siigo/crear-factura`.

---

## 3. Qué necesita existir en Siigo antes de poder facturar (catálogos)

Siigo no deja mandar "cliente: Juan Pérez, producto: Corte de cabello" en texto libre dentro de la factura — todo son referencias a entidades que deben existir primero en Siigo:

| Entidad Siigo | Endpoint | Cuándo se crea |
|---|---|---|
| Tercero (cliente) | `GET/POST /v1/customers` | Antes de cada factura: buscar por identificación (NIT/CC), si no existe, crearlo |
| Producto/servicio | `GET/POST /v1/products` | Una vez por servicio que ofrezca el negocio (ej. "Corte de cabello", "Tinte") — no por cada factura |
| Tipo de documento | `GET /v1/document-types?type=FV` | Consulta única, se guarda el ID (factura de venta electrónica) |
| Vendedor | `GET /v1/users` | Consulta única, el usuario Siigo que queda como vendedor |
| Forma de pago | `GET /v1/payment-types?document_type=FV` | Consulta única (efectivo, transferencia, etc.) |
| Impuestos | `GET /v1/taxes` | Se referencian dentro de cada producto |

Recomendación práctica: hacer un **script de "seed" una sola vez** (fuera de symes, un script Node suelto) que consulte estos catálogos y deje anotados los IDs fijos (tipo de documento, vendedor, forma de pago) como constantes en el Worker. Terceros y a veces productos sí se crean dinámicamente en cada operación.

---

## 4. Diseño del proxy en el Worker

### 4.1 Secrets (nunca en el código)

```bash
npx wrangler secret put SIIGO_USERNAME
npx wrangler secret put SIIGO_ACCESS_KEY
```

Quedan disponibles en el Worker como `env.SIIGO_USERNAME` / `env.SIIGO_ACCESS_KEY`.

### 4.2 Manejo del token

El token de Siigo dura 24h. No pedirlo en cada request:

```js
async function getSiigoToken(env) {
  const cached = await env.SYMES_KV.get("siigo_token_cache", "json"); // o D1
  if (cached && cached.expira > Date.now()) return cached.token;

  const resp = await fetch("https://api.siigo.com/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: env.SIIGO_USERNAME,
      access_key: env.SIIGO_ACCESS_KEY
    })
  });
  const data = await resp.json();
  await env.SYMES_KV.put("siigo_token_cache", JSON.stringify({
    token: data.access_token,
    expira: Date.now() + 23 * 60 * 60 * 1000 // margen de 1h
  }));
  return data.access_token;
}
```

(Si SYMES no tiene KV habilitado todavía, se puede guardar el token en una tabla D1 de una fila, igual de válido.)

### 4.3 Rutas nuevas a agregar al Worker (mismo patrón que `reset-password`)

- `POST /siigo/buscar-o-crear-cliente` — recibe datos del cliente desde symes, busca en Siigo por identificación, crea si no existe, devuelve el `customer_id` de Siigo.
- `POST /siigo/crear-factura` — recibe `{cliente_id_siigo, items:[{producto_id_siigo, cantidad, precio}], forma_pago}`, arma el payload completo (tipo de documento, vendedor, fecha) y hace `POST /v1/invoices` con `stamp: true` para timbrar ante la DIAN.
- `GET /siigo/factura/:id` — consulta estado de una factura (por si el timbrado queda "Pending" y hay que reconsultar).
- (opcional) `POST /siigo/anular-factura` — para las pruebas y para casos reales de anulación.

Todas siguen el mismo formato de respuesta que ya usa el Worker (`{ok:true/false, ...}`, `Access-Control-Allow-Origin: "*"`).

---

## 5. Flujo funcional paso a paso (una factura real)

1. Usuario en SYMES completa un cobro/servicio y pulsa "Facturar" (o se factura automáticamente al marcar un pago — decisión de producto, ver sección 6).
2. Frontend junta los datos: identificación y datos fiscales del cliente (tipo de identificación, número, nombre, email — Siigo los necesita para timbrar), y el ítem/servicio con su valor.
3. Frontend llama `POST /siigo/buscar-o-crear-cliente` al Worker.
4. Worker obtiene token Siigo (cacheado), busca el tercero por identificación (`GET /v1/customers?identification=...`). Si no existe, lo crea (`POST /v1/customers`).
5. Frontend llama `POST /siigo/crear-factura` con el `customer_id` devuelto y el detalle del servicio.
6. Worker arma el payload de factura y hace `POST /v1/invoices` con `stamp:true`.
7. Siigo responde con el número de factura, CUFE (código único de la DIAN), estado (`Accepted`/`Pending`/`Rejected`) y el link al PDF.
8. Worker devuelve eso al frontend. SYMES guarda en el registro del pago: número de factura Siigo, CUFE, y el link al PDF (o el PDF en base64 si se quiere guardar localmente).
9. Si el estado vuelve `Pending`, SYMES debe reintentar la consulta (`GET /siigo/factura/:id`) unos segundos después — la DIAN a veces tarda en validar.
10. Si vuelve `Rejected`, mostrar el motivo (Siigo lo devuelve en la respuesta) — normalmente es un dato del cliente mal formado (NIT, dígito de verificación, régimen tributario).

---

## 6. Cambios necesarios en `index.html`

Siguiendo el patrón ya usado en SYMES (todo en el único `<script>`, eventos vía `guardarEvento`/`procesarEvento`):

1. **Captura de datos fiscales del cliente.** Probablemente no existen hoy en el modelo de datos de SYMES (los "trabajadores"/"perfiles" que hay son de nómina, no de facturación a clientes finales). Hay que decidir: ¿SYMES factura a los clientes del negocio (ej. los clientes de la peluquería) o el sistema de facturación es para otra cosa? Esto define si hay que agregar una entidad nueva "Clientes" con NIT/CC, nombre, email — **confirmar esto con el negocio antes de programar**, porque cambia el alcance.
2. **Nuevo tipo de evento**: algo como `facturaCreada` (igual que `pagoQuincenaTrabajador` o `valorQuincenaPerfil` en el módulo de Pagos), con su `tipoRegistro` correspondiente en el Worker/D1 para que sincronice entre dispositivos.
3. **UI**: botón "Facturar" donde corresponda (ej. junto al flujo de Pagos/Cierre que ya existe), con loading state mientras el Worker responde (el timbrado con la DIAN no es instantáneo).
4. **Permisos**: si facturar debe estar restringido a Admin (como ya pasa con Pagos/Créditos/Precios vía `_puedeVerPaginasRestringidas()`), agregarlo al mismo guard en los 3 sitios que ya usa ese patrón: `_renderMenuInicio()`, `mostrarPagina()`, `_elegirPerfil()`.
5. **Historial de facturas**: una vista simple que liste facturas emitidas con su estado y link al PDF, reutilizando el estilo de `Historial de pagos` que ya existe.
6. **No tocar** `calcularResultadoPlanilla`, `paginaCierreMes` ni el resto del módulo de Pagos salvo para colgar el botón de facturar — son módulos ya estabilizados (ver bugs corregidos recientemente en quincenas/adelantos).

---

## 7. Errores comunes a manejar

- **NIT/CC inválido o dígito de verificación mal calculado** → Siigo rechaza la creación del tercero. Validar formato antes de enviar.
- **Cliente sin email** → algunos flujos de Siigo requieren email para el envío automático del PDF; si SYMES no lo captura, hay que decidir si se hace obligatorio o se omite el envío automático.
- **Producto sin impuesto asociado** → Siigo rechaza la factura. Verificar que los productos creados en el catálogo tengan impuesto (aunque sea 0% si aplica).
- **Token expirado a mitad de una ráfaga de facturas** → el `getSiigoToken` con caché y margen de 1h cubre esto, pero agregar reintento automático si Siigo responde 401.
- **Timeout de Cloudflare Worker** (CPU time limits) si Siigo tarda mucho en responder → usar `waitUntil` o, si hace falta, mover a un flujo asíncrono con reconsulta desde el frontend en vez de bloquear la request original.

---

## 8. Seguridad

- Access Key y Username **solo como `wrangler secret`**, nunca en `index.html`, nunca en el repo, nunca en `push-log.txt`.
- El Worker debe validar que quien llama `/siigo/crear-factura` esté autenticado como un usuario válido de SYMES (mismo mecanismo que ya protege otras rutas admin, ver `handleAdminDeleteAccount` que verifica `admin_usuario`) — si no, cualquiera con la URL del Worker podría generar facturas reales a nombre del negocio.
- Loggear cada factura creada (quién, cuándo, monto) para auditoría — ya existe la costumbre en SYMES de trazar `creadoPor` en otros eventos (adelantos), seguir el mismo patrón.

---

## 9. Plan de trabajo por fases (sin arriesgar producción)

**Fase 0 — Aislamiento** (ya decidido por ti): clonar `symes-final` a una carpeta/rama aparte. El original sigue desplegándose con `push-symes.bat` tal cual, sin tocar.

**Fase 1 — Habilitación en Siigo**: confirmar plan API, generar credenciales, configurar resolución DIAN y catálogo mínimo (sección 1). No requiere código.

**Fase 2 — Script de seed**: script Node suelto (fuera de symes) que autentica contra Siigo y lista `document-types`, `users`, `payment-types`, `taxes` — para anotar los IDs fijos que se van a usar.

**Fase 3 — Worker**: agregar los secrets y las rutas nuevas (`/siigo/*`) al Worker, probadas con `curl`/Postman antes de tocar el frontend.

**Fase 4 — Frontend en el clon**: agregar el modelo de datos de cliente/factura, el botón, el evento, el historial — todo en el `index.html` del clon.

**Fase 5 — Pruebas end-to-end**: generar 2-3 facturas de prueba reales (no hay sandbox confirmado), verificar que lleguen a la DIAN, anularlas si Siigo lo permite o dejarlas documentadas como pruebas.

**Fase 6 — Corte a producción**: cuando esté validado, fusionar los cambios del clon al repo real, correr `push-symes.bat` una sola vez con todo junto, y confirmar que el deploy y el Worker en producción tengan los secrets de Siigo configurados (los secrets de un Worker no se copian solos entre entornos).

---

## 10. Checklist rápido

- [ ] Confirmar plan Siigo incluye API
- [ ] Resolución DIAN vigente cargada en Siigo
- [ ] Credenciales API generadas (Username + Access Key)
- [ ] Definir alcance: ¿a quién se le factura? (cliente final del negocio, no trabajador)
- [ ] Script de seed corrido, IDs de catálogo anotados
- [ ] Secrets configurados en el Worker (`wrangler secret put`)
- [ ] Rutas `/siigo/*` agregadas y probadas con curl/Postman
- [ ] Modelo de datos de cliente/factura agregado en el clon de `index.html`
- [ ] Botón + evento + historial en UI
- [ ] Permisos (quién puede facturar) enganchados a `_puedeVerPaginasRestringidas()` o similar
- [ ] Pruebas end-to-end con facturas reales
- [ ] Secrets también configurados en el Worker de producción antes del corte
- [ ] Merge al repo real y deploy único con `push-symes.bat`

---

## 11. Referencias

- Documentación oficial: https://developers.siigo.com/docs/siigoapi
- Autenticación: https://developers.siigo.com/docs/siigoapi/autenticacion/autenticacion
- SDK oficial JavaScript: https://github.com/SiigoSAS/siigo_sdk_javascript
- Soporte API Siigo: soporteapi@siigo.com
