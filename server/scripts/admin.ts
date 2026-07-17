// ---------------------------------------------------------------
// إدارة صلاحية الإشراف من الترمينال
//
//   npm run admin:list
//   npm run admin:grant  -- <username>
//   npm run admin:revoke -- <username>
//
// ليه سكربت مش endpoint؟ عشان أول أدمن. مافيش endpoint يقدر يعيّن أدمن
// من غير ما يكون متحمي بصلاحية أدمن — وده لازم يبتدي من مكان ما. الطريقة
// الوحيدة الآمنة إن التعيين الأول يتم من على السيرفر نفسه بوصول للداتابيز،
// مش من على الشبكة. أي endpoint "عيّن أول أدمن" بيبقى باب خلفي مفتوح لأول
// واحد يلاقيه.
// ---------------------------------------------------------------
import { prisma } from "../src/lib/prisma.js";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const [action, username] = argv.filter((a) => a !== "--force");

function usage(msg?: string): never {
  if (msg) console.error(`\n✗ ${msg}`);
  console.error(`
Usage:
  npm run admin:list
  npm run admin:grant  -- <username>
  npm run admin:revoke -- <username>
`);
  process.exit(1);
}

async function main() {
  if (action === "list") {
    const admins = await prisma.user.findMany({
      where: { isAdmin: true },
      select: { username: true, email: true, createdAt: true },
      orderBy: { username: "asc" },
    });
    if (!admins.length) {
      console.log("\nمافيش أي أدمن دلوقتي. عيّن واحد بـ: npm run admin:grant -- <username>\n");
      return;
    }
    console.log(`\n${admins.length} admin(s):\n`);
    for (const a of admins) console.log(`  • ${a.username}  <${a.email}>`);
    console.log("");
    return;
  }

  if (action !== "grant" && action !== "revoke") usage("Unknown action");
  if (!username) usage("Missing <username>");

  const user = await prisma.user.findUnique({
    where: { username },
    select: { id: true, username: true, email: true, isAdmin: true },
  });
  if (!user) usage(`No user with username "${username}"`);

  const isAdmin = action === "grant";
  if (user.isAdmin === isAdmin) {
    console.log(`\n• ${user.username} is already ${isAdmin ? "an admin" : "not an admin"}. Nothing to do.\n`);
    return;
  }

  // آخر أدمن مايتشالش من غير قصد — غير كده تتقفل بره سطح المراجعة. بس ده
  // حاجز أمان مش قفل: --force بتعدّيه، عشان حالة زي إن حساب اختباري اتساب
  // بصلاحية أدمن بالغلط ولازم يتشال حتى لو هو الوحيد.
  if (!isAdmin) {
    const adminCount = await prisma.user.count({ where: { isAdmin: true } });
    if (adminCount <= 1 && !force) {
      usage(
        `${user.username} is the only admin — grant another one first, or pass --force if you really mean to leave zero admins`
      );
    }
  }

  await prisma.user.update({ where: { id: user.id }, data: { isAdmin } });
  console.log(`\n✓ ${user.username} <${user.email}> is ${isAdmin ? "now an admin" : "no longer an admin"}.\n`);
}

main()
  .catch((err) => {
    console.error("\n✗ Failed:", err instanceof Error ? err.message : err, "\n");
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
