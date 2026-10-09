import express from 'express';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import type { Database } from './db/index.js';
import { apiRouter } from './routes/index.js';
import { HttpError } from './lib/errors.js';
import { config } from './config.js';
import { notFound } from './lib/errors.js';

export function createApp(db: Database): express.Express {
  const app = express();

  app.disable('x-powered-by');

  // Small, dependency-free hardening. Deliberately no X-Frame-Options or CSP:
  // the app is embedded in a framed preview and has no inline script, and a
  // half-tuned CSP breaks more than it protects.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  // API responses are per-user; make sure neither the browser nor the Vercel
  // proxy in front of the API ever caches one.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Liveness check for the host (Render pings this). Touches the database so a
  // broken connection string shows up as unhealthy rather than as login errors.
  app.get('/api/health', async (_req, res) => {
    try {
      await db.get('SELECT 1 AS ok');
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is not reachable.' } });
    }
  });

  app.use('/api', apiRouter(db));

  // Anything else under /api is a real 404 in JSON, not the SPA's HTML.
  app.use('/api', (req, _res, next) => {
    next(notFound(`There is no API endpoint for ${req.method} ${req.originalUrl}.`));
  });

  // In single-process mode the API also serves the built frontend, so the front
  // desk only has to start one thing.
  if (fs.existsSync(config.clientDistPath)) {
    app.use(express.static(config.clientDistPath, { index: 'index.html' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next();
        return;
      }
      res.sendFile(path.join(config.clientDistPath, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}

function errorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }

  if (isBodyParseError(error)) {
    res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'That request could not be read as JSON.' },
    });
    return;
  }

  // Unexpected: log the detail for us, show the user something safe.
  console.error('Unexpected error:', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Something went wrong on our side. Please try again.',
    },
  });
}

function isBodyParseError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: string }).type === 'entity.parse.failed'
  );
}
