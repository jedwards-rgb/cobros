# Instalación y despliegue paso a paso

Para el panel mostrado por el usuario (selector Node.js con versión 24.21.0 y archivo de inicio), sigue [BanaHosting con cPanel/Passenger](BANAHOSTING-CPANEL.md). Se incluye `app.cjs`; su integración debe comprobarse en el servidor.

## Decisión sobre BanaHosting

La oferta pública de BanaHosting documenta Node.js y libertad de instalar software en sus VPS. La existencia de cPanel en un plan compartido no confirma que su cuenta permita Node.js: cPanel indica que esa función depende del proveedor.

1. Entra a cPanel y busca **Setup Node.js App**, **Application Manager** o la sección Node.js de Websites.
2. Confirma con soporte que admite Node.js 24, una aplicación Next.js persistente, variables privadas, reinicio del proceso, HTTPS, tareas cron y conexiones salientes TLS a PostgreSQL, SMTP y Meta.
3. Confirma también recursos de compilación y el comando de inicio permitido. El soporte concreto de Passenger debe validarse con BanaHosting; este proyecto ofrece `next start` y la entrada `app.cjs` para ese panel.

| Tu cuenta | Ruta recomendada |
|---|---|
| Node.js 24 persistente disponible y compatible con `next start` | Next.js completo en BanaHosting; PostgreSQL administrado por conexión TLS |
| Hosting compartido sin Node.js compatible | Next.js completo en un alojamiento Node/serverless compatible; PostgreSQL administrado; conservar dominio y correo en BanaHosting |
| VPS de BanaHosting | Next.js completo detrás de Nginx y gestor de procesos; PostgreSQL privado local o administrado |

**No exportar a HTML estático**: se perderían login, permisos, endpoints y datos dinámicos. No hace falta separar React de un backend en otro lenguaje. En la alternativa externa, frontend y backend principal siguen juntos en Next.js.

No cambies DNS hasta tener un despliegue de prueba funcionando. Las opciones de alojamiento y límites/costos deben comprobarse en el plan contratado.

## Preparar producción

1. Crea una base PostgreSQL vacía para la aplicación. Usa un usuario dedicado y acceso de red restringido si el proveedor lo permite. Configura TLS con certificados válidos. No uses `rejectUnauthorized:false`.
2. Crea el subdominio elegido, por ejemplo `cobros.tudominio.com`, con HTTPS.
3. Sube el código fuente y el archivo `pnpm-lock.yaml`. Excluye `.env.local`, `data/`, `node_modules/`, `.next/` y los accesos de demostración.
4. Instala las dependencias en Linux/servidor; no copies los módulos nativos de Windows.
5. Define secretos en el panel de alojamiento o archivo privado del servidor. Nunca en variables `NEXT_PUBLIC_`.

```dotenv
NODE_ENV=production
APP_URL=https://cobros.tudominio.com
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/BASE
DATABASE_SSL=true
SEND_ENABLED=false
```

No configurar `ALLOW_LOCAL_PREVIEW` en un servidor público. Es una excepción reservada a pruebas locales compiladas. Por defecto, producción exige PostgreSQL y el login exige URL HTTPS y cookie Secure.

6. Instala, crea el esquema y compila:

```sh
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm exec tsx scripts/schools.ts jover "Jover Academy"
pnpm user:create create jover correo-cobranza@tudominio.com cobranza "Secretaria de cobranza"
pnpm user:create create jover correo-seguimiento@tudominio.com seguimiento "Secretaria de seguimiento"
pnpm user:create create jover correo-direccion@tudominio.com directora "Directora"
pnpm build
pnpm start --port 3000
```

Sustituye los correos por cuentas reales. Cada comando imprime una contraseña aleatoria. Entrégala por un canal privado y almacénala en un gestor de contraseñas. La consola administrativa solo debe ser accesible al administrador del servidor.

Para revocar o restablecer acceso:

```sh
pnpm user:create disable jover persona@tudominio.com
pnpm user:create reset jover persona@tudominio.com
```

Desactivar el usuario invalida su acceso en la siguiente petición; restablecer la contraseña elimina sus sesiones. No hay autorregistro público, cambios de rol desde formularios ni cuentas predeterminadas en producción.

El esquema inicial es idempotente (`CREATE TABLE IF NOT EXISTS`), adecuado para esta primera versión. A partir del primer despliegue, cualquier modificación del esquema debe convertirse en una migración versionada con respaldo y ensayo de restauración. No ejecutar alteraciones manuales sin registro.

## Tareas programadas

En un servidor persistente, programa cada cinco minutos en cPanel la ejecución desde la carpeta del proyecto:

```cron
*/5 * * * * cd /RUTA/PRIVADA/cobroedu && /RUTA/PNPM/pnpm reminders >> /RUTA/PRIVADA/cron-cobroedu.log 2>&1
```

Las rutas de Node y pnpm dependen de tu cuenta. Confírmalas con soporte. El log debe quedar fuera de la carpeta pública y tener rotación. Las fechas de negocio se calculan explícitamente en **America/Panama**, independientemente de la zona horaria del servidor.

En un proveedor serverless, usa su programador con un **POST** a `/api/cron`, encabezado `Authorization: Bearer CRON_SECRET`. Crea un secreto aleatorio de al menos 32 caracteres y guárdalo en el gestor de secretos. No lo incluyas en una URL. El endpoint está preparado para un máximo de cinco mensajes por ejecución y 60 segundos. La frecuencia y duración deben estar permitidas por tu plan; un servicio que únicamente hace cron GET requiere adaptar su integración de manera explícita.

El envío diario de dirección se prepara desde las 17:00. Su clave única impide generar el mismo reporte dos veces para la misma directora y fecha. El reporte refleja el corte de su primera preparación después de esa hora, e incluye enlace a los detalles protegidos.

## Configurar email

1. Usa SMTP con TLS, una cuenta dedicada y remitente verificado.
2. Define `SMTP_HOST`, `SMTP_PORT` (465 TLS o 587 STARTTLS), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`.
3. Configura SPF, DKIM y DMARC del dominio con tu proveedor.
4. Prueba en staging con destinatarios internos autorizados.
5. Activa `SEND_ENABLED=true` solo cuando las dos integraciones y consentimientos estén preparados. El interruptor controla tanto email como WhatsApp.

## Configurar WhatsApp

Requiere WhatsApp Business Platform/Cloud API, número habilitado, token privado y una plantilla aprobada. La configuración no utiliza WhatsApp Web ni sesiones de teléfonos personales.

Variables: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_API_VERSION`, `WHATSAPP_TEMPLATE`, `WHATSAPP_LANGUAGE`.

Configura la versión vigente y compatible de Graph API en Meta; no se incluye una versión arbitraria. La plantilla debe tener exactamente tres parámetros de cuerpo, en este orden:

1. Nombre del acudiente.
2. Fecha de la promesa en formato AAAA-MM-DD.
3. Saldo del compromiso formateado en B/.

Texto sugerido para solicitar aprobación: «Estimado/a {{1}}: le recordamos su promesa de pago para el {{2}} por {{3}}. Si ya realizó el pago, comuníquese con el departamento de cobros para verificarlo. Jover Academy».

Registra autorización del acudiente para cada canal y la evidencia. Si la retira, usa su ficha para desmarcarlo. No se heredan consentimientos al importar Excel.

Los estados `aceptado_proveedor` reflejan aceptación del API/SMTP, **no entrega ni lectura**. Los webhooks de entrega y rebote quedan para una siguiente iteración. Si ocurre un timeout, se usa `requiere_revision`: verificar con el proveedor antes de cualquier reenvío. Los registros que queden en `procesando` tras un reinicio requieren la misma revisión. No hay botón de reintento indiscriminado.

## Antes de habilitar datos reales

- Probar cada perfil y dos colegios distintos en PostgreSQL.
- Probar pagos simultáneos sobre la misma cuenta y conciliación de saldos.
- Verificar que HTTPS, cabeceras, cookies y origen funcionan detrás del proxy del hosting.
- Verificar acceso denegado a datos sin sesión; ninguna carpeta privada debe exponerse como estática.
- Configurar copia cifrada diaria, retención, copia fuera del servidor y restauración comprobada.
- Activar 2FA del panel de alojamiento y base de datos; planificar MFA de usuarios dentro de la app antes de una salida amplia.
- Ensayar recordatorios y reporte diario con números/correos internos autorizados.
- Importar una muestra del Excel real, reconciliar totales con cobranza y después importar el resto.

## Fuentes técnicas consultadas

- [BanaHosting: VPS y ejecución de Node.js](https://www.banahosting.com/vps-servers/)
- [BanaHosting: características de hosting compartido](https://www.banahosting.com/web-hosting/)
- [cPanel: Node.js depende de habilitación del proveedor](https://docs.cpanel.net/cpanel/meridian/websites/deploy-a-website-with-nodejs/)
- [Next.js: opciones oficiales de despliegue](https://nextjs.org/docs/app/getting-started/deploying)
- [Meta: plantillas de WhatsApp](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-message-templates/)
