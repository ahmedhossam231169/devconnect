import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Profile, Post } from "../lib/types";
import { Navbar } from "../components/Navbar";
import { PostCard } from "../components/PostCard";
import { Zap, MapPin, Briefcase, Clock, MessageCircle, Code2, Link2 } from "lucide-react";
import { RelationActions } from "../components/RelationActions";
import { GitHubProjects } from "../components/GitHubProjects";

interface PublicUser {
  username: string;
  role: string;
  createdAt: string;
}

export default function UserProfile() {
  const { username } = useParams<{ username: string }>();
  const { user: me } = useAuth();
  const navigate = useNavigate();

  const [user, setUser] = useState<PublicUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [reputation, setReputation] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);

  const isMe = me?.username === username;

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api<{ ok: true; user: PublicUser; profile: Profile; reputation: number }>(`/api/profiles/${username}`),
      api<{ ok: true; posts: Post[] }>(`/api/posts/user/${username}`),
    ])
      .then(([p, ps]) => {
        setUser(p.user);
        setProfile(p.profile);
        setReputation(p.reputation);
        setPosts(ps.posts);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this profile"))
      .finally(() => setLoading(false));
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

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-6">
        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading profile...</p>}

        {error && (
          <div className="card !p-8 text-center">
            <p className="font-semibold text-red-400">{error}</p>
          </div>
        )}

        {!loading && profile && user && (
          <>
            {/* Profile header */}
            <div className="card mb-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="flex items-start gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-ink-700 text-2xl font-bold">
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      profile.displayName?.[0]?.toUpperCase() ?? "?"
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-xl font-bold sm:text-2xl">{profile.displayName}</h1>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-mist-600">@{user.username}</p>
                      {reputation > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400" title="Reputation from likes, comments, posts & friends">
                          <Zap size={12} /> {reputation.toLocaleString()}
                        </span>
                      )}
                    </div>
                    {profile.headline && <p className="mt-1 text-sm text-mist-400">{profile.headline}</p>}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mist-400">
                      {profile.location && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {profile.location}</span>}
                      {profile.specialty && <span className="inline-flex items-center gap-1"><Briefcase size={12} /> {profile.specialty}</span>}
                      {profile.yearsExperience !== null && <span className="inline-flex items-center gap-1"><Clock size={12} /> {profile.yearsExperience}y exp</span>}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 sm:ml-auto">
                  {isMe ? (
                    <Link to="/profile/edit" className="btn-ghost !py-2 text-sm">Edit profile</Link>
                  ) : (
                    <div className="flex flex-col gap-2 sm:items-end">
                      <RelationActions username={username!} />
                      <button onClick={messageUser} disabled={startingChat} className="inline-flex items-center justify-center gap-1.5 text-sm text-brand-400 hover:underline disabled:opacity-60">
                        <MessageCircle size={15} /> {startingChat ? "Opening..." : "Message"}
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {profile.bio && <p className="mt-4 whitespace-pre-wrap text-sm text-mist-100">{profile.bio}</p>}

              {profile.skills.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {profile.skills.map((s) => (
                    <span key={s.name} className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-semibold text-brand-400">
                      {s.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-4 flex gap-4 border-t border-ink-700 pt-3 text-sm">
                {profile.githubUrl && (
                  <a href={profile.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-mist-400 hover:text-brand-400"><Code2 size={15} /> GitHub</a>
                )}
                {profile.websiteUrl && (
                  <a href={profile.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-mist-400 hover:text-brand-400"><Link2 size={15} /> Portfolio</a>
                )}
              </div>
            </div>

            {/* GitHub Projects — live from GitHub API */}
            <GitHubProjects username={username!} />

            {/* Posts */}
            <h2 className="mb-3 mt-4 px-1 font-semibold">
              Posts {posts.length > 0 && <span className="text-mist-600">({posts.length})</span>}
            </h2>

            {posts.length === 0 ? (
              <div className="card !p-8 text-center">
                <p className="text-sm text-mist-400">
                  {isMe ? "You haven't posted anything yet." : `${profile.displayName} hasn't posted yet.`}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {posts.map((p) => (
                  <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
