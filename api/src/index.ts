import Fastify, { FastifyReply, FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config";
import { db } from "./db";
import { authRoutes } from "./routes/auth";
import { favoriteRoutes } from "./routes/favorites";
import { healthRoutes } from "./routes/health";
import { libraryRoutes } from "./routes/library";
import { playlistRoutes } from "./routes/playlists";
import { trackRoutes } from "./routes/tracks";
import { ensureAdminUser } from "./services/bootstrapAdmin";

async function buildServer() {
  const app = Fastify({ logger: true, trustProxy: true });

  await app.register(helmet, {
    crossOriginResourcePolicy: false
  });

  await app.register(cors, {
    origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN,
    methods: ["GET", "POST", "DELETE", "PATCH", "PUT", "OPTIONS"],
    credentials: true
  });

  await app.register(rateLimit, {
    max: 200,
    timeWindow: "1 minute"
  });

  await app.register(multipart, {
    limits: {
      files: 50,
      fileSize: 1024 * 1024 * 500
    }
  });

  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: {
      expiresIn: "12h"
    },
    verify: {
      extractToken: (request) => {
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          return authHeader.slice(7);
        }

        const query = request.query as { token?: string } | undefined;
        if (query?.token && typeof query.token === "string") {
          return query.token;
        }

        return undefined;
      }
    }
  });

  app.decorate("authenticate", async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  await app.register(
    async (api) => {
      await healthRoutes(api);
      await authRoutes(api);
      await trackRoutes(api);
      await favoriteRoutes(api);
      await playlistRoutes(api);
      await libraryRoutes(api);
    },
    { prefix: "/api" }
  );

  app.addHook("onClose", async () => {
    db.close();
  });

  return app;
}

async function start() {
  const app = await buildServer();
  await ensureAdminUser(db);

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    app.log.info(`API started on ${config.HOST}:${config.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
