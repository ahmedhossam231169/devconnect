import { useEffect, useState } from "react";
import { api } from "./api";
import { getSocket } from "./socket";
import type { FriendState, RelationStatus } from "./types";

// كاش مشترك لحالة الصداقة/المتابعة لكل username — بيتشارك بين كل الأماكن
// اللي بتعرض زرار "Add friend" (فيد فيه أكتر من بوست لنفس الشخص، بروفايل، إلخ)
// عشان التحديث في مكان واحد يظهر فورًا في كل الأماكن التانية بدل ما كل كومبوننت
// يفضل ماسك نسخته القديمة لحد ما يتعمل له refetch/remount
type Status = { friendState: FriendState; following: boolean };

const cache = new Map<string, Status>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();

function notify(username: string) {
  listeners.get(username)?.forEach((fn) => fn());
}

function setStatus(username: string, status: Status) {
  cache.set(username, status);
  notify(username);
}

function fetchStatus(username: string) {
  if (inflight.has(username)) return inflight.get(username)!;
  const p = api<{ ok: true } & RelationStatus>(`/api/friends/status/${username}`)
    .then((r) => setStatus(username, { friendState: r.friendState, following: r.following }))
    .catch(() => {})
    .finally(() => inflight.delete(username));
  inflight.set(username, p);
  return p;
}

// لما حد يبعتلي طلب صداقة أو يقبل طلبي أو يتابعني، السيرفر بيبعت "notification:new"
// عن طريق الـ socket — بنستخدمها نحدّث الكاش لحظيًا من غير ما المستخدم يعمل reload
let socketBound = false;
function ensureSocketSync() {
  if (socketBound) return;
  socketBound = true;
  getSocket().on("notification:new", (n: { type: string; link?: string | null }) => {
    if (n.type !== "FRIEND_REQUEST" && n.type !== "FRIEND_ACCEPT" && n.type !== "NEW_FOLLOWER") return;
    const username = n.link?.startsWith("/u/") ? n.link.slice(3) : null;
    if (!username) return;
    cache.delete(username);
    fetchStatus(username);
  });
}

export function useFriendStatus(username: string) {
  const [, bump] = useState(0);

  useEffect(() => {
    ensureSocketSync();
    const set = listeners.get(username) ?? new Set<() => void>();
    const listener = () => bump((n) => n + 1);
    set.add(listener);
    listeners.set(username, set);
    fetchStatus(username); // بيرجع من الكاش تلقائيًا لو حد تاني جابها قبل كده (inflight/cache)
    return () => {
      set.delete(listener);
    };
  }, [username]);

  const status = cache.get(username);
  return {
    friendState: status?.friendState ?? "none",
    following: status?.following ?? false,
    loaded: !!status,
    setFriendState: (friendState: FriendState) =>
      setStatus(username, { friendState, following: cache.get(username)?.following ?? false }),
    setFollowing: (following: boolean) =>
      setStatus(username, { friendState: cache.get(username)?.friendState ?? "none", following }),
  };
}
