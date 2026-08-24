import { createApiApp } from './app.js';

export default {
  fetch: (req: Request, env: Record<string, unknown>, ctx: ExecutionContext) =>
    createApiApp(env).fetch(req, env, ctx),
};
