import { prisma } from "./prisma.js";
import { Errors } from "./errors.js";

// helper مشترك: يجيب مستخدم بالـ username أو يرمي 404
export async function findUserByUsername(username: string) {
  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true },
  });
  if (!user) throw Errors.notFound("User");
  return user;
}
