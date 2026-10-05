# Validación del MVP · 4 de octubre de 2026

## Entorno

- Next.js 16.3.8, React 19.3.0, TypeScript 7.0.2 y Node.js 24.19.0.
- Base de demostración SQLite local; pruebas de negocio en SQLite separado, en memoria.
- Diez estudiantes ficticios en la demo; otra prueba aislada importa 500 cuentas.
- Credenciales y datos de producción no utilizados. Ningún email ni WhatsApp real enviado.

## Pruebas automatizadas: 19 aprobadas

1. Conversión exacta de montos a centavos y rechazo de formatos ambiguos.
2. Bloqueo de pagos para seguimiento y dirección.
3. Aislamiento de consultas y operaciones entre colegios.
4. Idempotencia, referencias únicas y rechazo de sobrepagos.
5. Dos pagos concurrentes no producen saldo negativo en el entorno local.
6. Promesas cumplidas por suma de abonos posteriores, sin contar los anteriores.
7. Revocación al desactivar un usuario y respuesta de login genérica.
8. Expiración de sesiones y rechazo de origen externo.
9. Persistencia del límite de intentos de acceso.
10. Reversión completa de importación si una fila falla.
11. Recordatorios tres días antes, deduplicación, consentimiento, pago y manejo de timeout.
12. Cancelación conserva notas, no admite acceso de otro colegio y permite una nueva promesa.
13. Dos ejecuciones simultáneas del cron no duplican envíos y usan el monto aún pendiente del compromiso.
14. Promesa cancelada antes del envío descarta ambos canales.
15. Reporte diario desde las 17:00 de Panamá, sin duplicados.
16. Importación de 500 cuentas con totales exactos; rechazo de 501 sin guardar.
17. Lectura de Excel válido y rechazo de fórmulas, ZIP inválido, archivo excedido y metadatos de tamaño falseados.
18. Límite de tamaño de solicitudes incluso sin encabezado Content-Length.
19. Reportes distinguen usuarios con igual nombre y respetan los límites del día en Panamá.

Ejecutar `pnpm test` desde la carpeta del proyecto. TypeScript también fue comprobado con `pnpm typecheck`.

## Pruebas HTTP sobre la aplicación compilada

El script `tests/http-smoke.mjs` verifica:

- Exportación y cron denegados sin autenticación apropiada.
- Login de los tres perfiles y cookie HttpOnly.
- Nueve páginas por perfil: **27 comprobaciones de páginas** con respuesta correcta, CSP con nonce y caché privada desactivada.
- Operaciones sin CSRF o desde origen externo bloqueadas.
- Endpoint de pagos bloqueado para dirección y seguimiento, aunque se llame directamente.
- Exportación de plantilla XLSX y validación por el endpoint de importación, sin confirmar una carga.
- Exportación CSV para los tres perfiles.
- Logout y rechazo de reutilización de la sesión cerrada.

Para repetirlas con la demo local abierta, define `DEMO_PASSWORD` en la sesión de tu terminal con la clave aleatoria que imprimió `pnpm db:demo`. Opcionalmente define `TEST_APP_URL`; solo se admiten localhost o 127.0.0.1. Ejecuta `pnpm test:http`. El script no incluye contraseñas y no modifica la cartera; registra las descargas en auditoría y crea/cierra sus propias sesiones de prueba.

## Verificación en navegador

- Inicio y cierre de sesión con cobranza y dirección.
- Abono ficticio de B/.900 sobre saldo de B/.825 rechazado.
- Abono ficticio de B/.25 aceptado; saldo actualizado a B/.800 y registro visible.
- Dirección consulta pagos sin formulario para registrarlos.
- Dashboard revisado en escritorio y ancho móvil de 390 píxeles.
- No se observaron errores de consola en el recorrido comprobado.

## Hallazgos corregidos

- Se actualizó una dependencia transitiva de Excel afectada por un aviso de seguridad; la auditoría posterior no reportó vulnerabilidades conocidas en dependencias de producción.
- La cancelación de promesas conserva sus notas originales y bloquea la misma cuenta que pagos/envíos, para mantener orden consistente de operaciones.
- La comprobación XLSX verifica la descompresión real con límite de 8 MB, sin confiar únicamente en tamaños declarados dentro del ZIP.
- El restablecimiento administrativo de contraseña y la revocación de sesiones se ejecutan en una transacción.
- El reporte por secretaria agrupa por identificador de usuario y no solo por nombre.

## Lo que estas pruebas no demuestran

Comprobación adicional del adaptador `app.cjs`: arrancó sobre la compilación de producción local y pasó `tests/http-smoke.mjs` (27 páginas entre los tres perfiles, CSP, CSRF, origen, exportación/importación de plantilla y cierre de sesión). Esta prueba usa datos ficticios locales y no ejecuta Passenger; la integración con Passenger de BanaHosting sigue pendiente.

Todavía no se ha validado PostgreSQL real ni su comportamiento de bloqueos bajo concurrencia en el alojamiento elegido. La prueba concurrente local usa transacciones serializadas de SQLite. Tampoco se han probado SMTP real, aceptación/entrega real de Meta, HTTPS/certificados del hosting, copias/restauración o límites del plan BanaHosting.

Estas verificaciones dejan una base comprobada para demo y desarrollo. La salida con datos reales requiere las pruebas de staging y los controles pendientes indicados en `SEGURIDAD.md` y `DESPLIEGUE.md`.
