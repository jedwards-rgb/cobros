# CobroEdu · piloto de Jover Academy

MVP de cobranza escolar con **frontend y backend principal en Next.js + TypeScript**. Interfaz en español, adaptable a computadora y celular. No utiliza PHP ni un backend separado en Laravel.

## Arquitectura elegida

```text
Navegador: React / Next.js
          │ HTTPS, cookie privada, protección CSRF
          ▼
Next.js (Node.js 24): pantallas + endpoints + permisos + cálculos
          ├── PostgreSQL: colegios, usuarios, cartera, historial y sesiones
          ├── SMTP con TLS: email
          └── WhatsApp Business Cloud API: plantillas aprobadas

Cron cada 5 minutos → preparar avisos → revisar saldo/consentimiento → enviar
                         └── reporte diario desde las 17:00 de Panamá
```

El frontend y el backend se despliegan **juntos**. La base de producción puede estar en un servicio PostgreSQL administrado, incluido Supabase. Aquí Supabase sirve como base de datos privada; la autenticación y lógica de negocio están en Next.js. No se publican claves de base de datos en el navegador.

La demo usa SQLite local para empezar sin cuentas externas. **SQLite no es la configuración de producción ni funciona como almacenamiento duradero en un alojamiento serverless.** Producción exige PostgreSQL. Cada registro tiene `school_id`, las consultas se limitan al colegio de la sesión y las claves foráneas compuestas impiden mezclar relaciones entre colegios.

## 1. Requisitos

- Node.js **24 o posterior compatible**, pnpm 11.19.0.
- PostgreSQL en producción. Para ensayar localmente no hace falta instalarlo.
- Dominio/subdominio con HTTPS para producción.

## 2. Ejecutar la demo

Desde esta carpeta:

```sh
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

Si tu distribución de Node no incluye Corepack, instala pnpm siguiendo su documentación oficial. Copia `.env.example` a `.env.local` y mantén `SEND_ENABLED=false`.

```sh
pnpm db:migrate
pnpm db:demo
pnpm dev
```

Abre `http://localhost:3000`. Si cambias puerto o dominio, actualiza `APP_URL` exactamente y reinicia la aplicación; la protección de origen rechazará otra dirección.

El script de demo crea diez estudiantes ficticios, sus cuentas, llamadas, promesas y algunos abonos. **No representa la cartera real de los 500 estudiantes.** Muestra una contraseña aleatoria en la terminal para estos usuarios:

| Colegio | Usuario | Perfil |
|---|---|---|
| jover | cobranza@jover.example | Cobranza |
| jover | seguimiento@jover.example | Seguimiento |
| jover | directora@jover.example | Dirección |

La contraseña compartida existe solo para facilitar la demo local. En producción cada usuario recibe una contraseña aleatoria distinta. El script no sobrescribe la demo existente y se niega a ejecutarse contra PostgreSQL o en producción.

## 3. Recorrido de prueba

1. Entra como **cobranza**. Registra un acudiente, un estudiante y una cuenta de B/.400 con mora expresamente aprobada de B/.20.
2. Entra como **seguimiento**. Registra la llamada y una promesa de B/.200 para dentro de tres días.
3. Ejecuta `pnpm reminders`: aparecerán los avisos pendientes, sin enviarse porque `SEND_ENABLED=false`.
4. Como cobranza, registra un abono de B/.100 con referencia única: el saldo debe quedar en B/.320 y la promesa sigue abierta con B/.100 por cumplir.
5. Registra otro abono de B/.100: saldo B/.220 y promesa cumplida. El cron descartará los recordatorios de esa promesa.
6. Como directora, consulta dashboard, historial y reportes. Su perfil no puede registrar ni modificar pagos.
7. Desde **Importar cartera**, descarga la plantilla XLSX, completa los datos y revisa la vista previa. Una referencia repetida o una discrepancia de estudiante cancela toda la importación.

## Funciones implementadas

| Área | Alcance de esta base |
|---|---|
| Acceso | Login, logout, roles en servidor, sesiones revocables, caducidad por inactividad y límite absoluto |
| SaaS | Colegios y usuarios por consola administrativa; datos limitados al colegio de la sesión |
| Cartera | Acudientes, estudiantes, cargos, mora manual, búsqueda y filtros por antigüedad |
| Pagos | Abonos por cuenta, centavos enteros, comprobación de saldo, referencias únicas, idempotencia y transacciones |
| Seguimiento | Llamadas, responsable, notas, próxima fecha, promesas y cancelación justificada |
| Promesas | Una abierta por cuenta, cumplimiento con suma de abonos posteriores, vencidas visibles como incumplidas |
| Avisos | Cola persistente, tres días antes de la promesa, email y WhatsApp; se revalidan saldo, promesa y autorización |
| Reportes | Saldos, antigüedad, pagos, gestiones por secretaria, auditoría, Excel/CSV y resumen diario para dirección |
| Excel | Plantilla fija, validación, revisión previa, importación atómica de hasta 500 filas |

Los pagos son registros de dinero **ya recibido**. No se procesan tarjetas ni se cobran cuentas bancarias. Un abono corresponde a una cuenta; para distribuir un depósito entre varias, usa referencias de recibo distintas y conserva la referencia bancaria en la descripción operativa externa.

## Estructura

```text
src/app/                  Pantallas y endpoints Next.js
src/app/api/              Acceso, operaciones, Excel, exportación y cron
src/components/           Formularios, dashboard, navegación e importación
src/lib/db.ts             PostgreSQL / SQLite local y transacciones
src/lib/schema.ts         Esquema inicial y restricciones
src/lib/security.ts       Contraseñas, sesiones, origen y límites
src/lib/collections.ts    Reglas de cobranza y consultas por colegio
src/lib/reminders.ts      Avisos y reporte diario
src/lib/imports.ts        Lectura segura y validación de Excel
src/proxy.ts              Política de contenido con nonce por respuesta
scripts/                  Instalación, usuarios, demo y recordatorios
tests/                    Pruebas de negocio y seguridad
docs/                     Despliegue y controles de seguridad
```

## Pruebas

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm audit --prod
```

Las pruebas automatizadas usan SQLite aislado en memoria. Incluyen aislamiento entre colegios, restricciones por rol, centavos, referencias repetidas, idempotencia, sobrepagos, concurrencia local, cumplimiento de promesas, sesión expirada, revocación, origen externo, límite de intentos, importación atómica y envío condicionado. Las integraciones reales con PostgreSQL, SMTP y Meta deben verificarse en staging antes de cargar datos del colegio.

## Siguiente paso

Consulta [despliegue en BanaHosting](docs/DESPLIEGUE.md) y [seguridad y límites](docs/SEGURIDAD.md). El dato pendiente es si tu plan ofrece **Node.js 24 con procesos persistentes**. No basta con que tenga cPanel, PHP o acceso SSH.
