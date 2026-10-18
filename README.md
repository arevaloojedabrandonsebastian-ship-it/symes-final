# SYMES — Sistema de Engrasaderos

Sistema web para la gestión diaria y la liquidación de pagos de engrasaderos (talleres de engrase/lubricación de vehículos). Reemplaza las planillas en papel y los cálculos a mano de lo que le corresponde a cada engrasador por quincena.

**En producción desde julio de 2026**, usado a diario por un negocio real en Colombia.

🔗 **Demo:** [symes-final.pages.dev](https://symes-final.pages.dev)

---

## El problema

En un engrasadero cada servicio se anota en una planilla: placa, tipo de vehículo, tipo de engrase, valor y engrasador. Al final de la quincena hay que calcular cuánto le corresponde a cada engrasador según porcentajes, grasa gastada, rebajas en servicios mixtos/sintéticos, adelantos y descuentos. Hacerlo a mano era lento y daba errores, y los créditos a empresas (servicios fiados) se perdían entre hojas.

## Funcionalidades

- **Planillas de servicios** — registro por turno con autocompletado inteligente (placas, tipos de vehículo, descripciones y precios frecuentes) y formato de miles en vivo.
- **Liquidación automática** — cálculo por planilla o liquidación quincenal en bloque con selección de planillas por quincena, porcentajes configurables por tipo de engrase, descuento de grasa gastada y reglas de rebaja para servicios mixtos.
- **Engrasadores y pagos** — pagos por quincena, adelantos y descuentos, arrastre de saldos entre quincenas y cierre de mes.
- **Créditos por empresa** — servicios fiados con valores adicionales (productos, repuestos), catálogo de productos con precios y registro de cobros.
- **Perfiles y turnos** — varios usuarios (administrador, secretarias) por negocio, con perfil activo por dispositivo.
- **Sincronización entre dispositivos** — los cambios se envían como eventos a un backend serverless y se reproducen en cada cliente.
- **Impresión y reportes** — planillas, liquidaciones y resúmenes quincenales listos para imprimir o guardar en PDF.
- **Modelo SaaS** — plan gratuito y plan PRO con 30 días de prueba, panel de superadministrador para gestionar negocios.
- **PWA y modo oscuro** — instalable en el celular y usable en tablets del taller.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | HTML, CSS y JavaScript vanilla (SPA) |
| Backend | Cloudflare Workers (API serverless) |
| Base de datos | Cloudflare D1 (SQLite) |
| Hosting | Cloudflare Pages |
| Persistencia local | `localStorage` (caché offline y preferencias por dispositivo) |
| Deploy | Script de Windows con Wrangler CLI (commit → push → deploy → producción) |

## Arquitectura

```
 Navegador (SPA)                    Cloudflare
┌──────────────────┐   evento    ┌──────────────┐     ┌──────────┐
│ UI + lógica de   │ ──────────▶ │   Worker     │ ──▶ │    D1    │
│ negocio          │             │  (API REST)  │     │ (SQLite) │
│ localStorage     │ ◀────────── │              │ ◀── │          │
└──────────────────┘  sincroniza └──────────────┘     └──────────┘
```

- La lógica de negocio (cálculo de liquidaciones, quincenas, créditos) corre en el cliente, lo que hace la app rápida incluso con mala conexión en el taller.
- Cada acción relevante (planilla, liquidación, pago, configuración) se guarda como **evento** en el Worker; los demás dispositivos del negocio lo reciben y lo aplican, de modo que todos ven el mismo estado.
- Se eligió una SPA de un solo archivo sin build para poder desplegar y corregir rápido en producción. La separación en módulos (`/js`, `/css`) es el siguiente paso de mantenimiento.

## Retos resueltos en producción

Tener usuarios reales trajo bugs que no aparecían en desarrollo. Algunos:

- **Liquidaciones duplicadas por doble clic** — un doble envío duplicaba todas las planillas de la quincena. Se bloqueó el botón durante el guardado y se limpia el estado antes de procesar.
- **Separador de miles vs. decimales** — `fmtMiles` trataba el punto decimal como separador de miles y convertía `1234.56` en cifras gigantes. Se separó el manejo de números ya calculados del de texto escrito por el usuario.
- **Atajo de valores (28 → 28.000)** — útil para cargar servicios rápido, pero rompía montos pequeños en créditos (un adicional de $800 quedaba en $800.000). Se restringió el atajo al campo donde aplica.
- **Cálculo de quincenas y arrastre de saldos** — correcciones en pagos que cruzan de mes, quincenas unidas y adelantos que deben descontarse en la quincena correcta.
- **Liquidación quincenal selectiva** — el negocio necesitaba liquidar solo hasta la quincena cerrada, no todo lo pendiente; se agregó selección por planilla y por quincena con resumen en vivo.

## Roadmap

- [ ] Facturación electrónica DIAN vía API de Siigo (diseño en [`SIIGO_FACTURACION_ELECTRONICA.md`](SIIGO_FACTURACION_ELECTRONICA.md))
- [ ] Separar `index.html` en módulos JS/CSS
- [ ] Hash de contraseñas en el backend
- [ ] Pruebas automatizadas para los cálculos de liquidación

## Ejecutar localmente

No requiere instalación ni build:

```bash
git clone https://github.com/arevaloojedabrandonsebastian-ship-it/symes-final.git
cd symes-final
# abrir index.html en el navegador, o servirlo:
npx serve .
```

La sincronización necesita el Worker de Cloudflare desplegado; sin él, la app funciona en modo local.

## Autores

- **Andrey Arévalo** — desarrollo full stack · [@AndreyArevalo](https://github.com/AndreyArevalo)
- **Brandon Sebastián Arévalo Ojeda** · [@arevaloojedabrandonsebastian-ship-it](https://github.com/arevaloojedabrandonsebastian-ship-it)

---

*Proyecto privado en uso comercial. El código se publica con fines de portafolio.*
