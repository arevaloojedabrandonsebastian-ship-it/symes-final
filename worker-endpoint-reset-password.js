// ══════════════════════════════════════════════════════════
//  ENDPOINT: POST /admin/reset-password
//  Agregar este bloque al router del Worker de Cloudflare
//  (dentro del if/else chain que maneja las rutas)
// ══════════════════════════════════════════════════════════

// Ejemplo de cómo debe quedar en tu Worker:
//
//   if (path === "/admin/reset-password" && method === "POST") {
//     return handleAdminResetPassword(request, env);
//   }

async function handleAdminResetPassword(request, env) {
  try {
    const body = await request.json();
    const { negocio, nueva_password } = body;

    if (!negocio || !nueva_password) {
      return new Response(JSON.stringify({ error: "Faltan parámetros: negocio, nueva_password" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    // Buscar el usuario en la base de datos (D1 o KV según tu Worker)
    // ── Si usas D1: ──────────────────────────────────────────────────
    const stmt = env.DB.prepare(
      "UPDATE usuarios SET password = ?1 WHERE usuario = ?2 OR negocio = ?2"
    );
    const result = await stmt.bind(nueva_password, negocio).run();

    if (result.meta.changes === 0) {
      return new Response(JSON.stringify({ ok: false, error: "Usuario no encontrado" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
      });
    }

    return new Response(JSON.stringify({ ok: true, mensaje: "Contraseña reseteada a " + nueva_password }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}

// ── Si tu Worker usa KV en lugar de D1, reemplaza el bloque D1 por: ──
//
//   const key = `usuario:${negocio}`;
//   const existing = await env.SYMES_KV.get(key, "json");
//   if (!existing) return respuesta 404;
//   existing.password = nueva_password;
//   await env.SYMES_KV.put(key, JSON.stringify(existing));
//   return respuesta 200 ok;
// ──────────────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════
//  ENDPOINT: DELETE /admin/delete-account
//  Agregar este bloque al router del Worker de Cloudflare
// ══════════════════════════════════════════════════════════

//   if (path === "/admin/delete-account" && method === "DELETE") {
//     return handleAdminDeleteAccount(request, env);
//   }

const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

async function handleAdminDeleteAccount(request, env) {
  try {
    const body = await request.json();
    const { admin_usuario, target_id, target_negocio } = body;

    // Verificar que quien pide es el superadmin
    if (!admin_usuario || admin_usuario.toLowerCase() !== "brandon") {
      return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: CORS });
    }

    // No se puede eliminar al superadmin
    if ((target_negocio || "").toLowerCase() === "brandon") {
      return new Response(JSON.stringify({ error: "No se puede eliminar al superadmin" }), { status: 400, headers: CORS });
    }

    if (!target_id && !target_negocio) {
      return new Response(JSON.stringify({ error: "Falta target_id o target_negocio" }), { status: 400, headers: CORS });
    }

    // ── D1: eliminar todas las tablas relacionadas ────────────────────
    const whereId    = target_id    ? "id = ?1"      : "1=0";
    const whereNeg   = target_negocio ? "negocio = ?1" : "1=0";
    const whereUsuId = target_id    ? "usuario_id = ?1" : "1=0";

    if (target_id) {
      await env.DB.prepare(`DELETE FROM usuarios      WHERE ${whereId}`).bind(target_id).run();
      await env.DB.prepare(`DELETE FROM liquidaciones WHERE ${whereUsuId}`).bind(target_id).run();
      await env.DB.prepare(`DELETE FROM trabajadores  WHERE ${whereUsuId}`).bind(target_id).run();
    }
    if (target_negocio) {
      await env.DB.prepare(`DELETE FROM solicitudes WHERE ${whereNeg}`).bind(target_negocio).run();
    }

    return new Response(JSON.stringify({ ok: true, mensaje: `Cuenta "${target_negocio}" eliminada` }), {
      status: 200, headers: CORS
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: CORS });
  }
}

// ── Si usas KV, reemplaza el bloque D1 por: ──────────────────────────
//
//   // Eliminar usuario
//   await env.SYMES_KV.delete(`usuario:${target_negocio}`);
//   // Eliminar liquidaciones (si tienes índice por usuario)
//   await env.SYMES_KV.delete(`liquidaciones:${target_id}`);
//   return respuesta 200 ok;
// ─────────────────────────────────────────────────────────────────────


// ══════════════════════════════════════════════════════════
//  ACTIVAR / DESACTIVAR CUENTAS (sin borrar nada)
//  Instrucciones paso a paso — 3 cambios en el Worker + 1 SQL
// ══════════════════════════════════════════════════════════

// ── PASO 1: Migración SQL (una sola vez, NO destructiva) ─────────────
//   Ejecutar en la consola D1 de Cloudflare (Workers & Pages > D1 > tu base > Console):
//
//     ALTER TABLE usuarios ADD COLUMN activo INTEGER DEFAULT 1;
//
//   Esto agrega la columna con valor 1 (activo) a TODOS los usuarios existentes.
//   No borra ni modifica ningún dato existente.


// ── PASO 2: Nuevo endpoint POST /admin/toggle-account ────────────────
//   Agregar al router:
//
//   if (path === "/admin/toggle-account" && method === "POST") {
//     return handleAdminToggleAccount(request, env);
//   }

async function handleAdminToggleAccount(request, env) {
  try {
    const body = await request.json();
    const { admin_usuario, target_id, target_negocio, activo } = body;

    if (!admin_usuario || admin_usuario.toLowerCase() !== "brandon") {
      return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: CORS });
    }
    if ((target_negocio || "").toLowerCase() === "brandon") {
      return new Response(JSON.stringify({ error: "No se puede desactivar al superadmin" }), { status: 400, headers: CORS });
    }
    if (!target_id && !target_negocio) {
      return new Response(JSON.stringify({ error: "Falta target_id o target_negocio" }), { status: 400, headers: CORS });
    }

    const activoVal = activo ? 1 : 0;

    if (target_id) {
      await env.DB.prepare(`UPDATE usuarios SET activo = ?1 WHERE id = ?2`).bind(activoVal, target_id).run();
    } else {
      await env.DB.prepare(`UPDATE usuarios SET activo = ?1 WHERE negocio = ?2`).bind(activoVal, target_negocio).run();
    }

    return new Response(JSON.stringify({ ok: true, mensaje: `Cuenta "${target_negocio}" ${activoVal ? "activada" : "desactivada"}` }), {
      status: 200, headers: CORS
    });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500, headers: CORS });
  }
}


// ── PASO 3: Bloquear login de cuentas desactivadas ────────────────────
//   Dentro de tu handler existente de POST /login, justo DESPUÉS de
//   verificar que el usuario y password son correctos (y ANTES de
//   devolver la respuesta 200 con los datos del usuario), agregar:
//
//   if (usuarioEncontrado.activo === 0) {
//     return new Response(JSON.stringify({ error: "Cuenta desactivada. Contacta al administrador." }), {
//       status: 403, headers: CORS
//     });
//   }
//
//   (Ajusta el nombre de la variable "usuarioEncontrado" al que uses
//   realmente en tu handler de login — es la fila que trae SELECT * FROM usuarios WHERE ...)


// ── PASO 4: Mostrar el estado correcto en el panel Superadmin ─────────
//   El handler de GET /solicitudes debe incluir el campo "activo" en
//   cada objeto que devuelve. Si /solicitudes hace un SELECT directo
//   de la tabla "usuarios" (o un JOIN con ella), basta con que el
//   SELECT incluya la columna activo, por ejemplo:
//
//     SELECT id, negocio, propietario, telefono, fecha, activo FROM usuarios ...
//
//   Si "solicitudes" es una tabla aparte sin relación directa a
//   "usuarios", habría que hacer JOIN por negocio, ej.:
//
//     SELECT s.*, u.activo FROM solicitudes s
//     LEFT JOIN usuarios u ON u.negocio = s.negocio
//
//   Sin este paso, el panel Superadmin mostrará "Activo" para todos
//   aunque estén desactivados en la base de datos (el botón seguirá
//   funcionando para bloquear el login, solo el badge visual no se
//   actualizará hasta hacer este cambio).
// ─────────────────────────────────────────────────────────────────────
