# ---------------------------------------------------------------
# صورة إنتاج للـ API — متعددة المراحل.
#
# node:22-slim (Debian) مش Alpine عن قصد: محرك Prisma بيتبني لـ target
# محدد. على Alpine (musl) لازم binaryTargets خاصة وكتير بيفشل بصمت وقت
# التشغيل بـ "engine not found". Debian-slim بيشتغل بالإعداد الافتراضي.
#
# الإصدار 22 يطابق engines والـ CI والهدف النهائي — مش 26 بتاع التطوير.
# ---------------------------------------------------------------

# ---- مرحلة البناء: فيها كل الأدوات (dev deps + prisma + tsc) ----
FROM node:22-slim AS builder

# Prisma محتاج openssl وقت توليد/تشغيل المحرك
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# طبقة الاعتماديات لوحدها: طول ما package*.json ماتغيّرش، Docker بيعيد
# استخدام الـ cache وما بيعيدش التثبيت — بيوفّر دقايق في كل build
COPY package.json package-lock.json ./
COPY prisma ./prisma
# npm ci = تثبيت من الـ lockfile بالظبط. postinstall بيعمل prisma generate،
# ومحتاج prisma CLI (اللي بقى dependency) + مجلد prisma اللي نسخناه فوق
RUN npm ci

# باقي الكود والبناء
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ---- مرحلة التشغيل: أنحف صورة، من غير أدوات بناء ----
FROM node:22-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

# ⚠️ مش بنشتغل root: لو اتخرق التطبيق، مساحة الضرر بتبقى مستخدم بلا صلاحيات
# بدل root داخل الكونتينر. node:* فيه مستخدم 'node' جاهز.
# مجلد الـ npm cache لازم يكون ملكه عشان أي npm/npx يشتغل من غير صلاحيات root
RUN mkdir -p /home/node/.npm && chown -R node:node /home/node

# اعتماديات الإنتاج بس. prisma بقى ضمنها، فـ postinstall (generate) بيشتغل
# صح، والصورة بتقدر تشغّل migrate deploy بنفسها.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force

# ناتج البناء بس — مفيش src ولا اختبارات في صورة الإنتاج
COPY --from=builder /app/dist ./dist

USER node

# نفس البورت اللي config بيسمع عليه افتراضيًا (بيتغيّر بـ PORT في البيئة)
EXPOSE 4000

# migrate deploy مش هنا: بيتعمل كخطوة منفصلة في docker-compose قبل ما
# التطبيق يقوم (service اسمه migrate). كده الصورة تفضل عامة — Render مثلاً
# بيشغّل نفس الـ CMD ده وبيعمل الميجريشن في الـ buildCommand بتاعه.
CMD ["node", "dist/index.js"]
