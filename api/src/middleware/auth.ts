import { FastifyReply, FastifyRequest } from "fastify";

export async function authRequired(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
  }
}

export async function adminRequired(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
    if (request.user.role !== "admin") {
      reply.code(403).send({ error: "Forbidden" });
    }
  } catch {
    reply.code(401).send({ error: "Unauthorized" });
  }
}
