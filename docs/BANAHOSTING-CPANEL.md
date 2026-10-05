# Instalación con el selector Node.js de BanaHosting

La captura de la cuenta muestra Node.js 24.21.0. Esto confirma la versión disponible; todavía hay que verificar compilación, Passenger y conexión a PostgreSQL en el servidor. El paquete incluye `app.cjs`, una entrada CommonJS para Passenger basada en el servidor personalizado de Next.js. No cambia el arranque habitual `pnpm start`.

## 1. Crear el subdominio

En cPanel → Dominios, crea un subdominio exclusivo, por ejemplo `cobros.diagrama-estudio.com`. No compartas su raíz pública con la página principal. Activa y verifica su certificado HTTPS. No uses `/cobros` como subcarpeta del dominio principal: la aplicación está preparada para la raíz de un subdominio.

## 2. Subir el paquete y registrar la aplicación

En el administrador de archivos crea `cobroedu` dentro de tu carpeta de usuario, fuera de `public_html`. Extrae el ZIP allí. `package.json` y `app.cjs` deben quedar directamente dentro de esa carpeta, sin una carpeta adicional intermedia. El paquete no contiene dependencias, compilación ni datos de demostración.

En Setup Node.js App → Create Application:

| Campo | Valor |
|---|---|
| Node.js version | 24.21.0 |
| Application mode | Production |
| Application root | cobroedu |
| Application URL | El subdominio creado; campo de ruta vacío |
| Application startup file | app.cjs |

La raíz pública del subdominio y la carpeta privada del código deben ser diferentes. No expongas la carpeta del proyecto como archivos estáticos. El panel configura la asociación con Passenger.

## 3. Configurar variables privadas

Añade en Environment variables:

```dotenv
APP_URL=https://cobros.diagrama-estudio.com
DATABASE_URL=postgresql://USUARIO:CLAVE@HOST:5432/BASE
DATABASE_SSL=true
SEND_ENABLED=false
```

Sustituye dominio y conexión por los valores reales. Usa una base PostgreSQL vacía y un usuario dedicado; las bases MySQL no son compatibles con esta versión. Si la clave contiene caracteres especiales, usa la cadena de conexión codificada que entregue el proveedor. Las conexiones externas a PostgreSQL deben estar permitidas por BanaHosting. No pegues claves en chats o capturas. No configures `ALLOW_LOCAL_PREVIEW` en el hosting.

Puedes registrar la aplicación antes de tener PostgreSQL, pero no estará operativa hasta completar configuración, tablas y compilación. No cargues datos reales durante esa etapa.

## 4. Instalar y compilar en la terminal

Después de crear la aplicación, el panel muestra un comando para activar su entorno Node.js. Cópialo exactamente a Terminal/SSH. No inventes la ruta `nodevenv`: depende del usuario y del panel. Comprueba `node --version`: debe devolver v24.x.

Usa pnpm 11.19.0, la versión fijada en `package.json`. Si no está disponible o solo aparece el botón Run NPM Install, solicita a soporte acceso a pnpm/Terminal antes de cambiar de gestor. CloudLinux administra su propia carpeta `node_modules`; no copies la de Windows ni sustituyas sus enlaces sin verificarlo con soporte.

Desde la carpeta del proyecto ejecuta:

```sh
pnpm install --frozen-lockfile --prod=false
pnpm db:migrate
pnpm exec tsx scripts/schools.ts jover "Jover Academy"
pnpm user:create create jover cobranza@TU-DOMINIO cobranza "Secretaria de cobranza"
pnpm user:create create jover seguimiento@TU-DOMINIO seguimiento "Secretaria de seguimiento"
pnpm user:create create jover direccion@TU-DOMINIO directora "Directora"
pnpm build
```

Las variables del panel deben estar disponibles también en esa terminal. Si no lo están, crea un `.env.local` privado dentro de la carpeta del proyecto, con las mismas variables y `NODE_ENV=production`, y permisos solo para el usuario del servidor (`chmod 600 .env.local`). No uses credenciales dentro de comandos que queden en el historial. Los scripts leen ese archivo; Next.js también. Mantén sincronizada la configuración si usas panel y archivo.

Cada creación de usuario imprime una contraseña aleatoria: guárdala en un gestor privado. No ejecutes `db:demo` en producción. Se necesitan dependencias de desarrollo para compilar y ejecutar los scripts administrativos. Si falta memoria durante la compilación, solicita el límite de recursos a soporte; no reemplaces el arranque por un servidor de desarrollo.

## 5. Reiniciar y comprobar

Usa Restart en el panel; Passenger mantiene el proceso. No ejecutes `pnpm start` ni PM2 en paralelo en esa misma aplicación. No abras el puerto 3000 públicamente ni añadas PORT sin que el proveedor lo solicite: Passenger administra el socket.

Comprueba login, estilos, permisos de los tres roles, exportación/importación de prueba, pagos simultáneos y saldos en PostgreSQL. Verifica que las peticiones HTTPS y el origen configurado coinciden detrás del proxy. Si aparece un 503, revisa el log privado de Passenger: dependencias, compilación, memoria y acceso a PostgreSQL. No publiques páginas de error detalladas.

Antes de usar datos reales configura copias cifradas y prueba restauración. Programa recordatorios cada cinco minutos siguiendo DESPLIEGUE.md, con las mismas variables y entorno Node.js. Mantén SEND_ENABLED=false hasta probar SMTP y Meta con destinatarios autorizados.

## Referencias

- [CloudLinux: entrada CommonJS para Passenger](https://cloudlinux.zendesk.com/hc/en-us/articles/6719280681884--ERR-REQUIRE-ESM-Must-use-import-to-load-ES-Module)
- [Next.js: servidor personalizado](https://nextjs.org/docs/app/guides/custom-server)
- [Passenger: administración del puerto](https://www.phusionpassenger.com/library/indepth/nodejs/reverse_port_binding.html)

Este adaptador se comprueba localmente. La compatibilidad final con la instalación de Passenger de BanaHosting requiere una prueba en esa cuenta.
