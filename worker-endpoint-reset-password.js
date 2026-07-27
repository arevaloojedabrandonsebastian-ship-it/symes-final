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
