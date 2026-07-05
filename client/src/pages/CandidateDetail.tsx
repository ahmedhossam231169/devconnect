import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { Profile } from "../lib/types";
import { Navbar } from "../components/Navbar";
import { ShortlistButton } from "../components/ShortlistButton";
import { GitHubProjects } from "../components/GitHubProjects";

interface CandidateUser {
  username: string;
  role: string;
  createdAt: string;
}

const AVAILABILITY_BADGE: Record<string, { label: string; dot: string }> = {
  OPEN_TO_WORK: { label: "Open to Work", dot: "bg-green-500" },
  FREELANCE_ONLY: { label: "Freelance Only", dot: "bg-blue-500" },
  NOT_LOOKING: { label: "Not Looking", dot: "bg-mist-600" },
};

export default function CandidateDetail() {
  const { username } = useParams<{ username: string }>();
  const navigate = useNavigate();

  const [user, setUser] = useState<CandidateUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);

  useEffect(() => {
    if (!username) return;
    setLoading(true);
    api<{ ok: true; user: CandidateUser; profile: Profile }>(`/api/profiles/${username}`)
      .then((res) => {
        setUser(res.user);
        setProfile(res.profile);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this profile"))
      .finally(() => setLoading(false));
  }, [username]);

  async function messageCandidate() {
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
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link to="/talent" className="mb-4 inline-block text-sm text-mist-400 hover:text-mist-100">
          Back to Talent Search
        </Link>

        {loading && <p className="py-8 text-center text-sm text-mist-400">Loading profile...</p>}

        {error && (
          <div className="card !p-8 text-center">
            <p className="font-semibold text-red-400">{error}</p>
          </div>
        )}

        {!loading && profile && user && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <div className="space-y-6">
              {/* Header */}
              <div className="card">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-ink-700 text-2xl font-bold">
                      {profile.displayName?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold">{profile.displayName}</h1>
                      <p className="text-mist-400">{profile.headline}</p>
                      <p className="mt-1 text-sm text-mist-600">
                        @{user.username} · {profile.location ?? "Location not set"}
                      </p>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900 px-3 py-1.5 text-sm font-semibold">
                    <span className={"h-2 w-2 rounded-full " + (AVAILABILITY_BADGE[profile.availability]?.dot ?? "bg-mist-600")} />
                    {AVAILABILITY_BADGE[profile.availability]?.label ?? profile.availability}
                  </span>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3 border-t border-ink-700 pt-5 text-center">
                  <div>
                    <p className="text-xl font-bold">{profile.yearsExperience ?? "—"}</p>
                    <p className="text-xs text-mist-400">Years Exp.</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold">{profile.specialty ?? "—"}</p>
                    <p className="text-xs text-mist-400">Specialty</p>
                  </div>
                  <div>
                    <p className="text-xl font-bold">{profile.skills.length}</p>
                    <p className="text-xs text-mist-400">Skills Listed</p>
                  </div>
                </div>
              </div>

              {/* Bio */}
              {profile.bio && (
                <div className="card">
                  <h2 className="mb-2 font-semibold">About</h2>
                  <p className="whitespace-pre-wrap text-mist-100">{profile.bio}</p>
                </div>
              )}

              {/* Skills — نفس شكل الـ bars في تصميمك */}
              <div className="card">
                <h2 className="mb-4 font-semibold">Professional Skills</h2>
                {profile.skills.length === 0 && (
                  <p className="text-sm text-mist-400">No skills listed yet.</p>
                )}
                <div className="space-y-3">
                  {profile.skills.map((s) => {
                    const pct = Math.min(100, (s.years / 10) * 100);
                    return (
                      <div key={s.name}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-medium">{s.name}</span>
                          <span className="text-mist-400">{s.years}y</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-ink-900">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* GitHub Projects — الشغل الحقيقي للمرشح */}
              <GitHubProjects username={username!} />
            </div>
            <div className="space-y-4">
              <div className="card">
                <div className="mb-2">
                  <ShortlistButton username={username!} />
                </div>
                <button
                  onClick={messageCandidate}
                  disabled={startingChat}
                  className="btn-primary w-full justify-center disabled:opacity-60"
                >
                  {startingChat ? "Opening..." : "Message"}
                </button>
                {profile.githubUrl && (
                  <a href={profile.githubUrl} target="_blank" rel="noreferrer" className="btn-ghost mt-2 w-full justify-center text-sm">
                    View GitHub Profile
                  </a>
                )}
                {profile.websiteUrl && (
                  <a href={profile.websiteUrl} target="_blank" rel="noreferrer" className="btn-ghost mt-2 w-full justify-center text-sm">
                    View Portfolio
                  </a>
                )}
              </div>

              <div className="card">
                <h2 className="mb-3 font-semibold">Quick Facts</h2>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-mist-400">Member since</dt>
                    <dd>{new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short" })}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mist-400">Specialty</dt>
                    <dd>{profile.specialty ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-mist-400">Location</dt>
                    <dd>{profile.location ?? "—"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
