import { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime())
    };
  });
}
