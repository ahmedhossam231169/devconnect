import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { SPECIALTIES, type Profile, type Skill, type Specialty, type Availability } from "../lib/types";
import { Navbar } from "../components/Navbar";
import { useAuth } from "../lib/auth";
import { ImageUpload } from "../components/ImageUpload";

const AVAILABILITY_LABELS: Record<Availability, string> = {
  OPEN_TO_WORK: "Open to work",
  FREELANCE_ONLY: "Freelance only",
  NOT_LOOKING: "Not looking",
};

export default function EditProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // مسودة الـ skill الجديدة
  const [skillName, setSkillName] = useState("");
  const [skillYears, setSkillYears] = useState(1);

  useEffect(() => {
    api<{ ok: true; profile: Profile }>("/api/profiles/me")
      .then((res) => setProfile(res.profile))
      .catch(() => setError("Couldn't load your profile"))
      .finally(() => setLoading(false));
  }, []);

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setProfile((p) => (p ? { ...p, [key]: value } : p));
    setSaved(false);
  }

  function addSkill() {
    if (!skillName.trim() || !profile) return;
    if (profile.skills.some((s) => s.name.toLowerCase() === skillName.trim().toLowerCase())) return;
    update("skills", [...profile.skills, { name: skillName.trim(), years: skillYears }]);
    setSkillName("");
    setSkillYears(1);
  }

  function removeSkill(name: string) {
    if (!profile) return;
    update("skills", profile.skills.filter((s) => s.name !== name));
  }

  async function save() {
    if (!profile) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api<{ ok: true; profile: Profile }>("/api/profiles/me", {
        method: "PUT",
        body: JSON.stringify({
          displayName: profile.displayName ?? undefined,
          headline: profile.headline ?? undefined,
          bio: profile.bio ?? undefined,
          location: profile.location ?? undefined,
          yearsExperience: profile.yearsExperience ?? undefined,
          specialty: profile.specialty ?? undefined,
          availability: profile.availability,
          websiteUrl: profile.websiteUrl ?? "",
          githubUrl: profile.githubUrl ?? "",
          avatarUrl: profile.avatarUrl ?? "",
          skills: profile.skills,
        }),
      });
      setProfile(res.profile);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save changes");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <BackToProfile />
        <h1 className="mb-1 text-2xl font-bold">Edit Profile</h1>
        <p className="mb-6 text-sm text-mist-400">
          This is what recruiters see when they search the talent pool — keep it sharp.
        </p>

        {loading && <p className="text-sm text-mist-400">Loading...</p>}

        {!loading && profile && (
          <div className="space-y-6">
            <div className="card space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Profile photo</label>
                <ImageUpload
                  currentUrl={profile.avatarUrl}
                  onUploaded={(url) => update("avatarUrl", url)}
                  label="Upload photo"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Display name</label>
                <input
                  className="input-field"
                  value={profile.displayName ?? ""}
                  onChange={(e) => update("displayName", e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Headline</label>
                <input
                  className="input-field"
                  placeholder="Full Stack Architect & UI/UX Specialist"
                  value={profile.headline ?? ""}
                  onChange={(e) => update("headline", e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Bio</label>
                <textarea
                  className="input-field min-h-24 resize-y"
                  value={profile.bio ?? ""}
                  onChange={(e) => update("bio", e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Location</label>
                  <input
                    className="input-field"
                    placeholder="San Francisco, CA"
                    value={profile.location ?? ""}
                    onChange={(e) => update("location", e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Years of experience</label>
                  <input
                    type="number"
                    min={0}
                    max={60}
                    className="input-field"
                    value={profile.yearsExperience ?? 0}
                    onChange={(e) => update("yearsExperience", Number(e.target.value))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Specialty</label>
                  <select
                    className="input-field"
                    value={profile.specialty ?? ""}
                    onChange={(e) => update("specialty", e.target.value as Specialty)}
                  >
                    <option value="" disabled>Select...</option>
                    {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Availability</label>
                  <select
                    className="input-field"
                    value={profile.availability}
                    onChange={(e) => update("availability", e.target.value as Availability)}
                  >
                    {(Object.keys(AVAILABILITY_LABELS) as Availability[]).map((a) => (
                      <option key={a} value={a}>{AVAILABILITY_LABELS[a]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium">GitHub URL</label>
                  <input
                    className="input-field"
                    placeholder="https://github.com/you"
                    value={profile.githubUrl ?? ""}
                    onChange={(e) => update("githubUrl", e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Website / Portfolio</label>
                  <input
                    className="input-field"
                    placeholder="https://you.dev"
                    value={profile.websiteUrl ?? ""}
                    onChange={(e) => update("websiteUrl", e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Skills manager — ده اللي فلتر الـ HR بيشتغل عليه */}
            <div className="card">
              <h2 className="mb-3 font-semibold">Skills & Stack</h2>
              <div className="mb-3 flex flex-wrap gap-2">
                {profile.skills.length === 0 && (
                  <p className="text-sm text-mist-400">No skills added yet — recruiters filter by these.</p>
                )}
                {profile.skills.map((s) => (
                  <span
                    key={s.name}
                    className="flex items-center gap-1.5 rounded-full border border-ink-700 bg-ink-900 px-3 py-1 text-sm"
                  >
                    {s.name} <span className="text-mist-600">· {s.years}y</span>
                    <button
                      onClick={() => removeSkill(s.name)}
                      className="ml-1 text-mist-600 hover:text-red-400"
                      aria-label={`Remove ${s.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className="input-field !py-2 text-sm"
                  placeholder="Skill name (e.g. React)"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSkill()}
                />
                <input
                  type="number"
                  min={0}
                  max={40}
                  className="input-field !w-24 !py-2 text-sm"
                  value={skillYears}
                  onChange={(e) => setSkillYears(Number(e.target.value))}
                  aria-label="Years with this skill"
                />
                <button onClick={addSkill} className="btn-ghost !py-2 text-sm">
                  Add
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving} className="btn-primary disabled:opacity-60">
                {saving ? "Saving..." : "Save changes"}
              </button>
              {saved && <span className="text-sm text-emerald-400">✓ Saved</span>}
            </div>
          </div>
        )}
      </main>
    </>
  );
}


// زرار الرجوع لبروفايلي
function BackToProfile() {
  const { user } = useAuth();
  return (
    <Link
      to={`/u/${user?.username}`}
      className="mb-4 inline-flex items-center gap-1.5 text-sm text-mist-400 hover:text-mist-100"
    >
      <ArrowLeft size={15} /> Back to my profile
    </Link>
  );
}
