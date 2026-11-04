import { buildApp } from './app';

const built = await buildApp();
await built.core.start();
await built.app.listen({ port: built.env.PORT, host: built.env.HOST });
built.app.log.info(
  `Realm Raiders server on :${built.env.PORT} — chain ${built.core.ctx.chain.mode}, agents ${built.env.AGENTS_MODE}, demo auth ${built.env.ALLOW_DEMO_AUTH ? 'on' : 'off'}`,
);

const shutdown = async () => {
  await built.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
