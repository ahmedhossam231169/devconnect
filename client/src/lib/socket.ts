// ---------------------------------------------------------------
// اتصال Socket.io واحد للتطبيق كله (singleton)
// بيتعمل أول ما حد يطلبه، وبيتقفل عند الـ logout
// ---------------------------------------------------------------
import { io, type Socket } from "socket.io-client";
import { getAccessToken, refreshAccessToken } from "./token";

// في التطوير: فاضي، فـ socket.io بيتصل بنفس الـ origin والـ Vite proxy بيوصله للسيرفر المحلي
// في الإنتاج: بنحط رابط الـ backend الحقيقي (نفس VITE_API_URL بتاع lib/api.ts)
const API_BASE_URL = import.meta.env.VITE_API_URL ?? "";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(API_BASE_URL, {
      // دالة مش قيمة ثابتة: socket.io بينادي دي مع كل محاولة اتصال، فالتوكن
      // بيتقرا وقت الاتصال. لو كانت قيمة ثابتة كانت هتتجمّد على توكن أول
      // اتصال — وعمره 15 دقيقة، يعني أي إعادة اتصال بعد كده كانت هتترفض.
      auth: (cb: (data: object) => void) => {
        const token = getAccessToken();
        if (token) return cb({ token });
        // مفيش توكن في الذاكرة (reload مثلاً) → نطلع واحد من الكوكي الأول
        refreshAccessToken().then((fresh) => cb({ token: fresh ?? "" }));
      },
      transports: ["websocket"],
    });

    // التوكن خلص والسيرفر رفض الـ handshake → نجدّد ونحاول تاني.
    // من غير ده، تاب مفتوح من غير نشاط بيفضل من غير real-time بعد 15 دقيقة.
    socket.on("connect_error", async () => {
      const fresh = await refreshAccessToken();
      if (fresh) socket?.connect();
    });
  }
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
