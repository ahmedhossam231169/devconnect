import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Profile, FeedItem, GitHubProject } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { PostCard } from "../components/PostCard";
import {
  Award, MapPin, Link2, Calendar, MessageCircle, Share2, Pencil,
  FileText, ExternalLink, Star, GitFork, Repeat2, Users, Layers,
  GitCommitHorizontal, Clock, Eye,
} from "lucide-react";
import { RelationActions } from "../components/RelationActions";
import { ResumeQuickView } from "../components/ResumeQuickView";

// [SECURITY] نتأكد إن الرابط http(s) قبل ما نحطه في href
function isSafeHttpUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url);
}

interface PublicUser {
  username: string;
  role: string;
  createdAt: string;
}

type ActivityItem =
  | { kind: "post"; at: string; postId: string; postType: string; title: string | null }
  | { kind: "community"; at: string; name: string; slug: string };

type Tab = "projects" | "stats" | "experience" | "posts";

const LANG_COLOR: Record<string, string> = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5", Rust: "#dea584",
  Go: "#00ADD8", Java: "#b07219", "C++": "#f34b7d", "C#": "#178600", PHP: "#4F5D95",
  Ruby: "#701516", Swift: "#F05138", Kotlin: "#A97BFF", HTML: "#e34c26", CSS: "#563d7c",
};

const fmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n);

export default function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const { user: me } = useAuth();
  const navigate = useNavigate();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [items, setItems] = useState<FeedItem[]>([]);
  const [reputation, setReputation] = useState(0);
  const [followers, setFollowers] = useState(0);
  const [projects, setProjects] = useState<GitHubProject[]>([]);
  // GitHub رفض الطلب (rate limit مثلًا) — عشان نفرّق عن "مفيش مشاريع أصلًا"
  const [ghError, setGhError] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [tab, setTab] = useState<Tab>("projects");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resumePreview, setResumePreview] = useState(false); // Quick View للـ CV

  const isMe = me?.username === username;

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError(null);
    setTab("projects");
    Promise.all([
      api<{ ok: true; user: PublicUser; profile: Profile; reputation: number; followers: number }>(`/api/profiles/${username}`),
      api<{ ok: true; items: FeedItem[] }>(`/api/posts/user/${username}`),
    ])
      .then(([p, ps]) => {
        setUser(p.user);
        setProfile(p.profile);
        setReputation(p.reputation);
        setFollowers(p.followers ?? 0);
        setItems(ps.items);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this profile"))
      .finally(() => setLoading(false));

    // مشاريع GitHub + الـ activity — مش حرجين، بيتحملوا في الخلفية
    api<{ ok: true; projects: GitHubProject[]; githubConnected: boolean; error?: string }>(`/api/profiles/${username}/github-projects`)
      .then((r) => {
        setProjects(r.projects);
        setGhError(r.error ?? null);
      })
      .catch(() => {});
    api<{ ok: true; items: ActivityItem[] }>(`/api/profiles/${username}/activity`)
      .then((r) => setActivity(r.items))
      .catch(() => {});
  }, [username]);

  async function messageUser() {
    if (!username) return;
    setStartingChat(true);
    try {
      await api("/api/conversations", { method: "POST", body: JSON.stringify({ username }) });
      navigate("/messages");
    } finally {
      setStartingChat(false);
    }
  }

  function share() {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const totalStars = projects.reduce((s, p) => s + p.stars, 0);
  const totalForks = projects.reduce((s, p) => s + p.forks, 0);
  const languages = [...projects.reduce((m, p) => {
    if (p.language) m.set(p.language, (m.get(p.language) ?? 0) + 1);
    return m;
  }, new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className={
        "rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors " +
        (tab === t ? "bg-ink-800 text-mist-100 shadow" : "text-mist-400 hover:text-mist-100")
      }
    >
      {label}
    </button>
  );

  return (
    <AppShell width="wide">
      {loading && (
        <div className="space-y-4">
          <div className="h-40 animate-pulse rounded-2xl bg-ink-700/40" />
          <div className="h-24 animate-pulse rounded-2xl bg-ink-700/40" />
        </div>
      )}

      {error && (
        <div className="card !p-8 text-center">
          <p className="font-semibold text-red-400">{error}</p>
        </div>
      )}

      {!loading && profile && user && (
        <>
          {/* ===== البانر + الهيدر ===== */}
          <div className="overflow-hidden rounded-2xl border border-ink-700/60 bg-ink-800">
            <div
              className="h-36 w-full sm:h-44"
              style={
                profile.bannerUrl
                  ? { backgroundImage: `url(${profile.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : { background: "linear-gradient(105deg, #312e81 0%, #4338ca 35%, #6d28d9 65%, #1e1b4b 100%)" }
              }
            />
            <div className="px-5 pb-5 sm:px-7">
              <div className="flex flex-wrap items-end justify-between gap-4">
                {/* الأفاتار متداخل مع البانر */}
                <div className="-mt-12 sm:-mt-14">
                  <div className="relative inline-block">
                    <div
                      className={
                        "flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-4 border-ink-800 bg-ink-700 text-3xl font-bold sm:h-28 sm:w-28 " +
                        (profile.availability === "OPEN_TO_WORK" ? "ring-2 ring-emerald-400" : "")
                      }
                    >
                      {profile.avatarUrl ? (
                        <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        profile.displayName?.[0]?.toUpperCase() ?? "?"
                      )}
                    </div>
                    {profile.availability === "OPEN_TO_WORK" && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-500 px-2 py-0.5 text-[9px] font-bold tracking-wide text-white">
                        OPEN TO WORK
                      </span>
                    )}
                    {profile.availability === "FREELANCE_ONLY" && (
                      <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-sky-500 px-2 py-0.5 text-[9px] font-bold tracking-wide text-white">
                        FREELANCE
                      </span>
                    )}
                  </div>
                </div>

                {/* أزرار يمين */}
                <div className="flex items-center gap-2">
                  {isMe ? (
                    <Link to="/profile/edit" className="btn-primary !py-2 text-sm">
                      <Pencil size={15} /> Edit Profile
                    </Link>
                  ) : (
                    <>
                      <RelationActions username={username!} />
                      <button onClick={messageUser} disabled={startingChat} className="btn-primary !py-2 text-sm disabled:opacity-60">
                        <MessageCircle size={15} /> {startingChat ? "Opening..." : "Message"}
                      </button>
                    </>
                  )}
                  <button onClick={share} className="btn-ghost !px-3 !py-2 text-sm" title="Copy profile link">
                    <Share2 size={15} /> {copied ? "Copied!" : "Share"}
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-2xl font-extrabold sm:text-3xl">{profile.displayName}</h1>
                  {profile.headline && <p className="mt-1 font-medium text-mist-400">{profile.headline}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-mist-600">
                    <span className="text-mist-400">@{user.username}</span>
                    {profile.location && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {profile.location}</span>}
                    {isSafeHttpUrl(profile.websiteUrl) && (
                      <a href={profile.websiteUrl!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-400 hover:underline">
                        <Link2 size={13} /> {profile.websiteUrl!.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                      </a>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <Calendar size={13} /> Joined {new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                    </span>
                  </div>
                </div>

                {/* شريط الإحصائيات — زي الديزاين */}
                <div className="flex divide-x divide-ink-700/60 rounded-xl border border-ink-700/60 bg-ink-900/60">
                  <div className="px-5 py-3 text-center">
                    <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist-600"><Award size={11} /> Reputation</p>
                    <p className="mt-0.5 text-xl font-extrabold">{fmt(reputation)}</p>
                  </div>
                  <div className="px-5 py-3 text-center">
                    <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist-600"><Layers size={11} /> Projects</p>
                    <p className="mt-0.5 text-xl font-extrabold">{projects.length}</p>
                  </div>
                  <div className="px-5 py-3 text-center">
                    <p className="flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-mist-600"><Users size={11} /> Followers</p>
                    <p className="mt-0.5 text-xl font-extrabold">{fmt(followers)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===== المحتوى: عمودين ===== */}
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0 space-y-6">
              {/* About Me */}
              {profile.bio && (
                <section className="card">
                  <h2 className="text-lg font-bold">About Me</h2>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-mist-400">{profile.bio}</p>
                </section>
              )}

              {/* التابات */}
              <div className="inline-flex gap-1 rounded-xl border border-ink-700/60 bg-ink-900/60 p-1">
                {tabBtn("projects", "Projects")}
                {tabBtn("stats", "GitHub Stats")}
                {tabBtn("experience", "Experience")}
                {tabBtn("posts", "Posts")}
              </div>

              {/* --- Projects --- */}
              {tab === "projects" && (
                projects.length === 0 ? (
                  <div className="card !p-8 text-center text-sm text-mist-400">
                    {ghError
                      ? "GitHub is busy right now — projects will be back shortly."
                      : isMe
                        ? "No GitHub projects yet — connect your GitHub account from the Projects page."
                        : "No public GitHub projects to show."}
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {projects.map((p) => (
                      <a key={p.name} href={p.url} target="_blank" rel="noreferrer" className="card group overflow-hidden !p-0 transition-colors hover:border-brand-500/50">
                        <div
                          className="flex h-24 items-end justify-between p-4"
                          style={{
                            background: `linear-gradient(120deg, ${LANG_COLOR[p.language ?? ""] ?? "#6366F1"}26, rgb(var(--ink-900)))`,
                          }}
                        >
                          <span className="inline-flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5 text-xs font-bold text-amber-300">
                            <Star size={11} /> {fmt(p.stars)}
                          </span>
                        </div>
                        <div className="p-4">
                          <h3 className="font-bold group-hover:text-brand-400">{p.name}</h3>
                          {p.description && <p className="mt-1 line-clamp-2 text-sm text-mist-400">{p.description}</p>}
                          <div className="mt-3 flex items-center gap-3 text-xs text-mist-600">
                            {p.forks > 0 && <span className="inline-flex items-center gap-1"><GitFork size={12} /> {p.forks}</span>}
                            {p.language && (
                              <span className="inline-flex items-center gap-1.5">
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: LANG_COLOR[p.language] ?? "#888" }} />
                                {p.language}
                              </span>
                            )}
                            <span className="ml-auto inline-flex items-center gap-1">
                              <Clock size={11} /> {new Date(p.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                            </span>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                )
              )}

              {/* --- GitHub Stats --- */}
              {tab === "stats" && (
                projects.length === 0 ? (
                  <div className="card !p-8 text-center text-sm text-mist-400">
                    {ghError
                      ? "GitHub is busy right now — stats will be back shortly."
                      : "No GitHub data to summarize."}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-3 gap-4">
                      <div className="card !p-5 text-center">
                        <p className="text-2xl font-extrabold">{projects.length}</p>
                        <p className="mt-1 text-xs text-mist-600">Public Repos</p>
                      </div>
                      <div className="card !p-5 text-center">
                        <p className="text-2xl font-extrabold">{fmt(totalStars)}</p>
                        <p className="mt-1 text-xs text-mist-600">Total Stars</p>
                      </div>
                      <div className="card !p-5 text-center">
                        <p className="text-2xl font-extrabold">{fmt(totalForks)}</p>
                        <p className="mt-1 text-xs text-mist-600">Total Forks</p>
                      </div>
                    </div>
                    {languages.length > 0 && (
                      <div className="card">
                        <h3 className="text-sm font-bold">Top Languages</h3>
                        <div className="mt-3 space-y-2.5">
                          {languages.slice(0, 6).map(([lang, count]) => (
                            <div key={lang} className="flex items-center gap-3">
                              <span className="w-24 shrink-0 text-sm text-mist-400">{lang}</span>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-900">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${(count / projects.length) * 100}%`,
                                    backgroundColor: LANG_COLOR[lang] ?? "#6366F1",
                                  }}
                                />
                              </div>
                              <span className="w-8 shrink-0 text-right text-xs text-mist-600">{count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}

              {/* --- Experience --- */}
              {tab === "experience" && (
                profile.experiences.length === 0 ? (
                  <div className="card !p-8 text-center text-sm text-mist-400">
                    {isMe ? (
                      <>No experience added yet — <Link to="/profile/edit" className="font-semibold text-brand-400 hover:underline">add your career history</Link>.</>
                    ) : (
                      "No experience listed."
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {profile.experiences.map((e) => (
                      <div key={e.id} className="card relative !p-5 pl-6">
                        <span className={"absolute left-0 top-5 h-[calc(100%-2.5rem)] w-1 rounded-full " + (e.endYear === null ? "bg-brand-500" : "bg-ink-700")} />
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="font-bold">{e.title}</h3>
                          <span className="text-sm text-mist-600">
                            {e.startYear} – {e.endYear ?? "Present"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-sm font-semibold text-brand-400">{e.company}</p>
                        {e.description && <p className="mt-2 text-sm leading-relaxed text-mist-400">{e.description}</p>}
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* --- Posts --- */}
              {tab === "posts" && (
                items.length === 0 ? (
                  <div className="card !p-8 text-center">
                    <p className="text-sm text-mist-400">
                      {isMe ? "You haven't posted anything yet." : `${profile.displayName} hasn't posted yet.`}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {items.map((item) => {
                      const onDeleted = (id: string) =>
                        setItems((prev) => prev.filter((x) => x.post.id !== id));
                      if (item.kind === "post") {
                        return <PostCard key={`post-${item.post.id}`} post={item.post} onDeleted={onDeleted} />;
                      }
                      return (
                        <div key={`repost-${item.id}`}>
                          <p className="mb-1.5 flex items-center gap-2 px-1 text-sm text-mist-400">
                            <Repeat2 size={14} className="text-emerald-400" />
                            <span className="font-semibold">{profile.displayName}</span> reposted
                          </p>
                          {item.comment && <p className="mb-2 px-1 text-sm text-mist-100">{item.comment}</p>}
                          <PostCard post={item.post} onDeleted={onDeleted} />
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>

            {/* ===== العمود اليمين ===== */}
            <div className="space-y-6">
              {/* Portfolio Assets */}
              {(profile.resumeUrl || isSafeHttpUrl(profile.websiteUrl) || isMe) && (
                <section className="card">
                  <h2 className="text-lg font-bold">Portfolio Assets</h2>
                  <div className="mt-4 space-y-2.5">
                    {isSafeHttpUrl(profile.resumeUrl) ? (
                      <>
                        <button onClick={() => setResumePreview(true)} className="btn-primary w-full justify-center text-sm">
                          <Eye size={15} /> Quick View Resume
                        </button>
                        <a href={profile.resumeUrl!} target="_blank" rel="noreferrer" className="btn-ghost w-full justify-center text-sm">
                          <FileText size={15} /> Download Resume
                        </a>
                      </>
                    ) : (
                      isMe && (
                        <Link to="/profile/edit" className="btn-ghost w-full justify-center text-sm">
                          <FileText size={15} /> Upload Resume
                        </Link>
                      )
                    )}
                    {isSafeHttpUrl(profile.websiteUrl) && (
                      <a href={profile.websiteUrl!} target="_blank" rel="noreferrer" className="btn-ghost w-full justify-center text-sm">
                        <ExternalLink size={15} /> View Portfolio
                      </a>
                    )}
                  </div>
                  {!isMe && profile.resumeUrl && (
                    <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-wider text-mist-600">
                      Verified Recruiter Access Only
                    </p>
                  )}
                </section>
              )}

              {/* Skills & Stack */}
              {profile.skills.length > 0 && (
                <section className="card">
                  <h2 className="text-lg font-bold">Skills & Stack</h2>
                  <p className="mt-3 text-[10px] font-bold uppercase tracking-wider text-mist-600">Expertise</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {profile.skills.map((s) => (
                      <span key={s.name} className="rounded-lg border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-xs font-semibold text-brand-400">
                        {s.name}
                      </span>
                    ))}
                  </div>
                </section>
              )}

              {/* Activity Feed */}
              {activity.length > 0 && (
                <section className="card">
                  <h2 className="text-lg font-bold">Activity Feed</h2>
                  <div className="mt-4 space-y-4">
                    {activity.map((a, i) => (
                      <div key={i} className="relative flex gap-3">
                        <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-brand-400">
                          {a.kind === "post" ? <GitCommitHorizontal size={13} /> : <Users size={13} />}
                        </span>
                        <div className="min-w-0 text-sm">
                          {a.kind === "post" ? (
                            <Link to={`/post/${a.postId}`} className="font-semibold hover:text-brand-400">
                              {a.postType === "SNIPPET" ? "Shared a snippet" : a.postType === "QUESTION" ? "Asked a question" : a.postType === "PROJECT" ? "Published a project" : "Wrote a post"}
                              {a.title ? `: ${a.title}` : ""}
                            </Link>
                          ) : (
                            <Link to={`/communities/${a.slug}`} className="font-semibold hover:text-brand-400">
                              Joined {a.name} community
                            </Link>
                          )}
                          <p className="mt-0.5 text-xs text-mist-600">
                            {new Date(a.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </>
      )}

      {/* Quick View للـ CV — overlay بيعرض الـ PDF من غير تحميل */}
      {resumePreview && isSafeHttpUrl(profile?.resumeUrl) && (
        <ResumeQuickView
          url={profile!.resumeUrl!}
          filename={`resume_${username}.pdf`}
          onClose={() => setResumePreview(false)}
        />
      )}
    </AppShell>
  );
}
