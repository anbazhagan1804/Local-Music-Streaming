import bcrypt from "bcryptjs";
import { config } from "../config";

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, config.BCRYPT_ROUNDS);
}

export async function verifyPassword(plainPassword: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, passwordHash);
}
