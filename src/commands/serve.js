'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const { Command } = require('commander');
const log         = require('../utils/logger');
const api         = require('../server/api');

const PORT    = 7429;
const PUBLIC  = path.join(__dirname, '..', 'server', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

const cmd = new Command('serve');

cmd
  .description('Inicia o servidor web interativo em http://localhost:' + PORT)
  .option('-p, --port <n>', 'porta do servidor', String(PORT))
  .option('--no-open', 'nao abrir o navegador automaticamente')
  .action((opts) => {
    log.title('UAI Serve');

    const port = parseInt(opts.port) || PORT;

    const server = http.createServer((req, res) => {
      // API routes
      if (req.url.startsWith('/api/')) {
        api.handle(req, res);
        return;
      }

      // Static files
      let filePath = req.url === '/' ? '/index.html' : req.url;
      // Strip query string
      filePath = filePath.split('?')[0];

      const fullPath = path.join(PUBLIC, filePath);

      // Security: prevent path traversal
      if (!fullPath.startsWith(PUBLIC)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
      }

      fs.readFile(fullPath, (err, data) => {
        if (err) {
          res.statusCode = 404;
          res.end('Not Found');
          return;
        }
        const ext  = path.extname(fullPath);
        const mime = MIME[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', mime);
        res.statusCode = 200;
        res.end(data);
      });
    });

    server.listen(port, '127.0.0.1', () => {
      const url = `http://localhost:${port}`;

      log.success(`Servidor iniciado: ${url}`);
      log.info('');
      log.step('Endpoints disponíveis:');
      log.info(`  ${url}/api/graph        → grafo completo`);
      log.info(`  ${url}/api/stats        → resumo do modelo`);
      log.info(`  ${url}/api/search?q=X   → busca`);
      log.info(`  ${url}/api/program/X    → detalhes do programa`);
      log.info(`  ${url}/api/flow/X       → fluxo interno`);
      log.info(`  ${url}/api/jobs         → lista de jobs`);
      log.info('');
      log.info('Pressione Ctrl+C para encerrar.');
      log.info('');

      // Try to open browser (best-effort)
      if (opts.open !== false) {
        const { exec } = require('child_process');
        const openCmd  = process.platform === 'win32'  ? `start ${url}`
                       : process.platform === 'darwin' ? `open ${url}`
                       : `xdg-open ${url}`;
        exec(openCmd, () => {});
      }
    });

    server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        log.error(`Porta ${port} já está em uso. Use: uai-cc serve --port <outra-porta>`);
      } else {
        log.error('Erro no servidor: ' + err.message);
      }
      process.exit(1);
    });

    // Keep alive
    process.on('SIGINT', () => {
      log.info('');
      log.info('Servidor encerrado.');
      process.exit(0);
    });
  });

module.exports = cmd;
