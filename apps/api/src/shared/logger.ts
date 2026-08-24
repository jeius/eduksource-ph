export const logger = {
  info: (msg: string, ctx?: unknown) => console.log(JSON.stringify({ level: 'info', msg, ctx })),
  error: (msg: string, ctx?: unknown) =>
    console.error(JSON.stringify({ level: 'error', msg, ctx })),
};
