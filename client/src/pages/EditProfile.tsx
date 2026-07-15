import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { SPECIALTIES, type Profile, type Specialty, type Availability, type Experience } from "../lib/types";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../lib/auth";
import { ImageUpload } from "../components/ImageUpload";
import { FileUpload } from "../components/FileUpload";

const AVAILABILITY_LABELS: Record<Availability, string> = {
  OPEN_TO_WORK: "Open to work",
  FREELANCE_ONLY: "Freelance only",
  NOT_LOOKING: "Not looking",
};

export default function EditProfile() {
  const { user } = useAuth();
  const isRecruiter = user?.role === "RECRUITER";
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // مسودة الـ skill الجديدة
  const [skillName, setSkillName] = useState("");
  const [skillYears, setSkillYears] = useState(1);

  // مسودة الخبرة الجديدة (Career Roadmap)
  const emptyExp = { title: "", company: "", startYear: new Date().getFullYear(), endYear: "" as number | "", description: "" };
  const [expDraft, setExpDraft] = useState(emptyExp);

  function addExperience() {
    if (!profile || !expDraft.title.trim() || !expDraft.company.trim()) return;
    const exp: Experience = {
      id: `tmp-${Date.now()}`, // بيتستبدل بـ id حقيقي بعد الحفظ
      title: expDraft.title.trim(),
      company: expDraft.company.trim(),
      startYear: expDraft.startYear,
      endYear: expDraft.endYear === "" ? null : expDraft.endYear,
      description: expDraft.description.trim() || null,
    };
    update("experiences", [...profile.experiences, exp]);
    setExpDraft(emptyExp);
  }

  function removeExperience(id: string) {
    if (!profile) return;
    update("experiences", profile.experiences.filter((e) => e.id !== id));
  }

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
          companyName: profile.companyName ?? undefined,
          availability: profile.availability,
          websiteUrl: profile.websiteUrl ?? "",
          githubUrl: profile.githubUrl ?? "",
          avatarUrl: profile.avatarUrl ?? "",
          bannerUrl: profile.bannerUrl ?? "",
          resumeUrl: profile.resumeUrl ?? "",
          discoverable: profile.discoverable,
          skills: profile.skills,
          experiences: profile.experiences.map(({ id, description, endYear, ...e }) => ({
            ...e,
            endYear: endYear ?? null,
            description: description ?? undefined,
          })),
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
      <AppShell width="narrow">
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
                <label className="mb-2 block text-sm font-medium">Banner image</label>
                <ImageUpload
                  currentUrl={profile.bannerUrl}
                  onUploaded={(url) => update("bannerUrl", url)}
                  label="Upload banner"
                  rounded={false}
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

              {isRecruiter && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium">Company name</label>
                  <input
                    className="input-field"
                    placeholder="e.g. Acme Inc."
                    value={profile.companyName ?? ""}
                    onChange={(e) => update("companyName", e.target.value)}
                  />
                </div>
              )}

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

            {/* الخبرات الوظيفية — الـ Career Roadmap في البروفايل وصفحة المرشح */}
            <div className="card">
              <h2 className="mb-1 font-semibold">Experience</h2>
              <p className="mb-4 text-sm text-mist-400">Your career history — shown on your profile and to recruiters.</p>

              <div className="space-y-3">
                {profile.experiences.map((e) => (
                  <div key={e.id} className="flex items-start justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{e.title}</p>
                      <p className="text-sm text-mist-400">
                        {e.company} · {e.startYear} – {e.endYear ?? "Present"}
                      </p>
                      {e.description && <p className="mt-1 text-sm text-mist-600">{e.description}</p>}
                    </div>
                    <button
                      onClick={() => removeExperience(e.id)}
                      className="shrink-0 text-mist-600 hover:text-red-400"
                      aria-label={`Remove ${e.title}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-4 space-y-2 rounded-lg border border-dashed border-ink-700 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input-field !py-2 text-sm"
                    placeholder="Job title (e.g. Senior Frontend Engineer)"
                    value={expDraft.title}
                    onChange={(e) => setExpDraft((d) => ({ ...d, title: e.target.value }))}
                  />
                  <input
                    className="input-field !py-2 text-sm"
                    placeholder="Company"
                    value={expDraft.company}
                    onChange={(e) => setExpDraft((d) => ({ ...d, company: e.target.value }))}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    className="input-field !py-2 text-sm"
                    placeholder="Start year"
                    min={1970}
                    max={2100}
                    value={expDraft.startYear}
                    onChange={(e) => setExpDraft((d) => ({ ...d, startYear: Number(e.target.value) }))}
                    aria-label="Start year"
                  />
                  <input
                    type="number"
                    className="input-field !py-2 text-sm"
                    placeholder="End year (empty = Present)"
                    min={1970}
                    max={2100}
                    value={expDraft.endYear}
                    onChange={(e) => setExpDraft((d) => ({ ...d, endYear: e.target.value === "" ? "" : Number(e.target.value) }))}
                    aria-label="End year (leave empty if current)"
                  />
                </div>
                <textarea
                  className="input-field min-h-16 resize-y text-sm"
                  placeholder="What did you build or lead there? (optional)"
                  value={expDraft.description}
                  onChange={(e) => setExpDraft((d) => ({ ...d, description: e.target.value }))}
                />
                <button
                  onClick={addExperience}
                  disabled={!expDraft.title.trim() || !expDraft.company.trim()}
                  className="btn-ghost !py-2 text-sm disabled:opacity-50"
                >
                  Add experience
                </button>
              </div>
            </div>

            {/* الـ Resume — بيظهر للـ recruiters بس في البروفايل العام */}
            <div className="card">
              <h2 className="mb-1 font-semibold">Resume</h2>
              <p className="mb-3 text-sm text-mist-400">
                A PDF resume recruiters can download from your profile. Only visible to
                verified recruiters (and you).
              </p>
              <FileUpload
                currentUrl={profile.resumeUrl}
                onUploaded={(url) => update("resumeUrl", url)}
                onCleared={() => update("resumeUrl", null)}
                label="Upload resume (PDF)"
              />
            </div>

            {/* [SECURITY BUG-01] موافقة الظهور للـ recruiters — الافتراضي مخفي */}
            <div className="card">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-brand-500"
                  checked={profile.discoverable}
                  onChange={(e) => update("discoverable", e.target.checked)}
                />
                <span>
                  <span className="block text-sm font-medium">Discoverable by recruiters</span>
                  <span className="mt-0.5 block text-sm text-mist-400">
                    When on, recruiters can find you in talent search by specialty, skills, and experience.
                    When off, your profile stays out of recruiter search results. You can still be viewed
                    directly by anyone with your profile link.
                  </span>
                </span>
              </label>
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={save}
                disabled={saving || (isRecruiter && !profile.companyName?.trim())}
                className="btn-primary disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save changes"}
              </button>
              {saved && <span className="text-sm text-emerald-400">✓ Saved</span>}
            </div>
          </div>
        )}
      </AppShell>
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
