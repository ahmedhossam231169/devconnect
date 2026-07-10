import { prisma } from "./prisma.js";

// "React Masters" → "react-masters"
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// بيضيف رقم لو الـ slug متكرر — بيشتغل مع أي موديل فيه حقل slug (Community, Page)
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>
): Promise<string> {
  let slug = base || "item";
  let i = 1;
  while (await exists(slug)) {
    slug = `${base}-${++i}`;
  }
  return slug;
}

export const communitySlugExists = (slug: string) =>
  prisma.community.findFirst({ where: { slug }, select: { id: true } }).then(Boolean);

export const pageSlugExists = (slug: string) =>
  prisma.page.findUnique({ where: { slug }, select: { id: true } }).then(Boolean);
