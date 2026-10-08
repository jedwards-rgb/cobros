# Edición de familias — Etapa 2

## Alcance

Una sola aplicación para todos los colegios. Las fichas, contactos, estudiantes e historiales pertenecen a su colegio. Cobranza y seguimiento pueden registrar, editar, eliminar fichas sin movimientos y archivar/reactivar fichas con movimientos. Dirección mantiene consulta. Los permisos de pagos, promesas e importación no cambian.

- Una ficha de acudiente puede tener varios estudiantes y hasta diez contactos, con nombre y relación (madre, padre u otro).
- Cada contacto admite un correo y un teléfono. Se puede registrar otro contacto de la misma persona para otro número o correo.
- Exactamente un contacto principal para recordatorios. No se envía a los adicionales como alternativa cuando el principal no autoriza un canal.
- Autorización de correo y WhatsApp por contacto; se exige evidencia cuando se autoriza. Si cambia la persona o destino, debe registrarse nueva evidencia antes de conservar la autorización.
- El editor muestra Editar, Guardar cambios y Cancelar. Cada cambio registra usuario, fecha, motivo y versiones anterior/posterior.
- Las fichas existentes se migran sin duplicar familias. La relación antigua se marca como «otro», porque no puede inferirse quién es madre o padre.
- Los contactos importados no obtienen autorizaciones nuevas. El importador conserva la unión de hermanos y admite coincidencias exactas con contactos adicionales.

## Borrado y archivo

Se borran únicamente fichas sin facturas ni gestiones relacionadas. Cualquier factura, incluso pagada, obliga a archivar; sus pagos y promesas conservan las referencias. Una llamada también impide borrar la ficha del acudiente. La confirmación indica cuántos estudiantes se incluyen al quitar una familia.

Archivar un acudiente archiva a sus estudiantes activos. Archivar un estudiante afecta solo a ese estudiante. No se borran deudas ni se alteran saldos; sigue siendo posible registrar un pago sobre una deuda anterior. No se permiten nuevas deudas, estudiantes, llamadas o promesas sobre fichas archivadas. Los recordatorios se vuelven a validar al despacharlos, incluyendo mensajes que estaban pendientes antes del archivo.

Reactivar un acudiente no reactiva automáticamente a sus hijos: se reactiva cada estudiante expresamente. Los permisos de contacto conservados vuelven a ser aplicables al reactivar; antes debe revisarse que sigan vigentes. La reasociación de un estudiante con movimientos a otra familia se rechaza, para evitar transferir deuda mediante una simple edición. Los estudiantes sin movimientos sí se pueden reasociar, con historial en ambas familias.

## Implementación y límites

- Migración aditiva: version y archived_at en ce_guardians/ce_students; ce_guardian_contacts y ce_profile_history nuevas, con índices por colegio y relaciones compuestas que rechazan vínculos entre colegios.
- El colegio y el actor proceden exclusivamente de la sesión. La API mantiene CSRF, comprobación de origen, límite de cuerpo y límite de operaciones. Los nuevos payloads son estrictos y no aceptan school_id ni actor_id enviados por el cliente.
- Las ediciones usan una versión y rechazan formularios obsoletos con 409; se conserva el texto para que el usuario decida cuándo recargar. El borrado se vuelve a evaluar dentro de la transacción.
- Escrituras de perfiles, importaciones y movimientos se serializan mediante la fila del colegio en PostgreSQL. Esto evita carreras entre borrado, nuevos hijos y nuevas deudas, sin bloquear otros colegios. El despacho usa el mismo orden antes de validar y enviar. Un proveedor lento puede demorar escrituras de ese colegio durante su timeout; para volúmenes altos conviene una cola de entrega con su propio protocolo de reclamación y cancelación.
- Como antes, la aplicación se conecta con un rol propietario. RLS y revocaciones bloquean roles REST anon/authenticated; no sustituyen el filtrado por colegio en las consultas de la aplicación. Se preserva ese modelo y se prueban intentos entre colegios.
- Se conservan las columnas antiguas email/phone/consent como proyección del principal para compatibilidad. Los recordatorios consultan directamente el contacto principal. No se deben modificar datos con SQL después de migrar sin mantener esta proyección.
- Listas nuevas de 50 filas, búsqueda de acudientes de hasta 25 coincidencias, historial por páginas de 20. Las fichas consultan solo su familia: saldo completo, hasta 50 cuentas y 25 pagos/promesas/llamadas recientes. Los módulos financieros previos conservan sus listados y exportaciones.
- Los cambios históricos anteriores a esta actualización no pueden reconstruirse. El historial nuevo empieza al registrar o modificar fichas con esta versión; la primera edición conserva también el estado anterior.
- La plantilla de Excel mantiene sus once columnas. Los contactos adicionales se gestionan desde las fichas; no se añadieron nuevas columnas a la plantilla en esta etapa.
- No incluye todavía superadministración, suscripciones ni credenciales WhatsApp por colegio: son etapas distintas. La configuración de proveedores existente continúa igual.

## Validación reproducible local

1. `npm test`: pruebas funcionales y de seguridad con SQLite en memoria.
2. `npm run build`: compilación de producción y TypeScript.
3. `npx tsx tests/profiles-fixture.ts`: base ficticia aislada data/profiles-qa.sqlite, nunca Neon.
4. Servir localmente con DATABASE_URL vacío, SQLITE_PATH=data/profiles-qa.sqlite, SEND_ENABLED=false, ALLOW_LOCAL_PREVIEW=true y APP_URL=http://localhost:3106.
5. `node tests/profiles-http.mjs`: verifica sesión, permisos, fichas renderizadas, CSRF, origen y versiones por HTTP.

La migración de PostgreSQL se genera con `npx tsx scripts/profile-sql.ts ruta-de-salida.sql`. Solo genera un archivo. No ejecuta SQL ni obtiene credenciales. El mismo módulo define las tablas de la migración usada por las pruebas. Las pruebas locales no reemplazan comprobar la migración en una rama de Neon antes de aplicarla a producción.
