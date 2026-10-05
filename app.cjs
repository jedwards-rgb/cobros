// Entrada CommonJS para el selector Node.js de CloudLinux/Passenger.
// Requiere ejecutar pnpm build antes del primer arranque.
const { createServer } = require('node:http');
const next = require('next');

process.chdir(__dirname);
process.env.NODE_ENV = 'production';

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT debe ser un puerto válido.');
}
const app = next({ dev: false, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    Promise.resolve(handle(req, res)).catch(() => {
      console.error('CobroEdu: error al procesar una solicitud.');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      }
      res.end('No se pudo procesar la solicitud.');
    });
  });
  server.on('error', () => {
    console.error('CobroEdu: no se pudo iniciar el servidor HTTP.');
    process.exit(1);
  });
  // Passenger intercepta listen() y administra el socket público.
  // Fuera de Passenger, solo escucha en la interfaz local.
  server.listen(port, '127.0.0.1', () => console.log('CobroEdu: servidor iniciado.'));
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    server.close(() => {
      app.close().then(() => process.exit(0), () => process.exit(1));
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch(() => {
  console.error('CobroEdu: no se pudo preparar Next.js. Verifica dependencias, compilación y configuración privada.');
  process.exit(1);
});
