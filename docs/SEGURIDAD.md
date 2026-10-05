# Seguridad y límites de esta primera versión

La seguridad forma parte del código y de la configuración de despliegue. Esta base no equivale a una auditoría externa ni a una certificación; requiere revisión y pruebas de integración antes de cargar datos personales o financieros reales.

## Controles implementados

- Hash de contraseñas Argon2id mediante biblioteca mantenida; no se almacenan contraseñas legibles.
- Tokens de sesión aleatorios de 256 bits; en la base solo queda su hash. Cookies HttpOnly, SameSite=Lax y Secure con prefijo `__Host-` en producción.
- Caducidad de sesión a los 30 minutos sin actividad y límite absoluto de ocho horas. Sesiones comprobadas en la base en cada petición protegida; usuario desactivado pierde acceso.
- Login con respuesta genérica, hash de trabajo para usuarios inexistentes, límites persistentes por cuenta/colegio y tope global. Complementar con límites por IP en el proxy/WAF para evitar que una fuente bloquee el acceso de otras personas.
- Origen exacto según `APP_URL`, token CSRF por sesión para operaciones autenticadas y límites de tamaño incluso con cuerpos enviados por fragmentos.
- Permisos en servidor: cobranza registra familias, estudiantes, cargos, pagos e importaciones; seguimiento registra llamadas y promesas; dirección consulta. Los tres pueden consultar y exportar información de su colegio.
- `school_id` obtenido de la sesión, nunca confiado al cliente; consultas parametrizadas y claves foráneas compuestas. Pruebas que intentan usar identificadores de otro colegio.
- PostgreSQL: RLS habilitado para impedir exposición casual mediante Supabase REST y permisos retirados de `anon`/`authenticated`. La conexión privada del backend usa un propietario de tablas dedicado, que puede omitir RLS; el aislamiento entre colegios en esa conexión lo aplica y prueba el backend. No presentar esto como RLS multitenant por usuario. Una evolución a roles no propietarios requiere políticas transaccionales por colegio antes de cambiar la conexión.
- Importes en centavos enteros; pago y saldo se actualizan en una transacción con bloqueo de cuenta. Referencias e identificadores de solicitud únicos, sobrepagos rechazados. Pagos e historial sin endpoints de eliminación.
- Promesas limitadas a una abierta por cuenta. Abonos anteriores al compromiso no cuentan para cumplirlo. Los posteriores sí; no se atribuye al seguimiento una causalidad financiera que no pueda demostrarse.
- Registro de auditoría por usuario/colegio. Las operaciones de cartera escriben el evento dentro de su transacción. No es un log inmutable frente al administrador de base de datos; para ese requisito hace falta una copia externa de auditoría.
- CSP con nonce por respuesta para scripts, bloqueo de iframes, no-sniff, no-referrer y no-store para páginas privadas. Los estilos inline necesarios para la interfaz siguen permitidos.
- Importación XLSX: máximo 2 MB, límite de 8 MB de contenido realmente descomprimido y 1,000 entradas ZIP, 500 filas, plantilla estricta, fórmulas/enlaces rechazados. No se guarda el archivo original en carpeta pública. Revisión antes del guardado y transacción completa. Configurar además el límite de carga del proxy.
- Exportación CSV neutraliza celdas que puedan interpretarse como fórmulas. XLSX escribe valores como texto/número, no fórmulas suministradas por el usuario.
- WhatsApp y email desactivados inicialmente. Consentimiento separado, revisado antes de enviar. Cola persistente con clave única. Resultados ambiguos no se reintentan automáticamente. Bloqueo de cuenta durante la decisión/envío evita que un pago concurrente confirmado antes del envío quede ignorado.
- Secretos únicamente en servidor. Verificación TLS de base de datos, correo y WhatsApp. No se guardan tokens ni respuestas de proveedores en mensajes de error al usuario.

## Datos y operación

Los contactos, nombres, notas y datos de cartera se guardan en la base privada. No se implementó cifrado de campos a nivel de aplicación en esta versión. Exige cifrado de disco/volúmenes y copias en tu proveedor; mantén accesos mínimos y una política de retención. Evita guardar números de tarjeta, documentos de identidad o información médica en notas. La aplicación no necesita esos datos.

No se almacenan datos de estudiantes en cachés de navegador offline. La versión móvil es una web responsive; no incluye aún service worker/PWA offline ni app nativa.

## Pendiente antes de ampliar el SaaS

1. MFA de usuarios, cambio/recuperación de contraseña con flujo seguro y administración de usuarios en interfaz. Esta base permite alta, restablecimiento y desactivación por consola administrativa.
2. Ensayo real de PostgreSQL y de los proveedores; revisar bloqueos, latencia, backups y recuperación tras reinicio.
3. Reversos contables auditados para pagos erróneos. No editar ni borrar pagos directamente en producción. Hasta implementar el flujo, usar la demo/staging para validar captura y exigir revisión previa de cada pago.
4. Definir por escrito la política de mora. Actualmente el recargo se especifica al crear/importar la cuenta; no se inventan porcentajes, capitalización ni reglas contractuales automáticas.
5. Webhooks firmados de WhatsApp y manejo de rebotes de correo para confirmar entrega. Panel de revisión de envíos ambiguos con conciliación con el proveedor.
6. Monitoreo de errores, alertas del cron, límites por IP, auditoría externa y pruebas de carga con la cartera real de 500 estudiantes. El dashboard carga la cartera completa del colegio; añadir paginación y agregaciones en base antes de crecer mucho más.
7. Editor de mapeo de columnas de Excel, agrupación verificada de hermanos y migraciones de esquema versionadas. El MVP usa una plantilla fija; no fusiona personas solo porque sus nombres coincidan.
8. Suscripciones, facturación del SaaS, autoservicio de colegios y políticas de retención. La estructura admite varios colegios, pero todavía no es una plataforma comercial de autoservicio.

## Verificación realizada

Ver `tests/security.test.ts` y `VERIFICACION.md` para los resultados de esta entrega. Las pruebas locales comprueban comportamiento; no prueban por sí solas seguridad del hosting, cumplimiento normativo ni entrega de mensajes reales.
