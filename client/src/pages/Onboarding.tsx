import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { SPECIALTIES, type Specialty, type Availability } from "../lib/types";
import { useAuth } from "../lib/auth";

const AVAILABILITY_OPTIONS: { value: Availability; label: string }[] = [
  { value: "OPEN_TO_WORK", label: "🟢 Open to work" },
  { value: "FREELANCE_ONLY", label: "🔵 Freelance only" },
  { value: "NOT_LOOKING", label: "⚪ Not looking" },
];

// خطوات الترحيب — نجمع الأساسيات اللي فلتر الـ HR بيعتمد عليها
export default function Onboarding() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState(1);

  const [specialty, setSpecialty] = useState<Specialty | "">("");
  const [yearsExperience, setYearsExperience] = useState(0);
  const [availability, setAvailability] = useState<Availability>("OPEN_TO_WORK");
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [headline, setHeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addSkill() {
    const s = skillInput.trim();
    if (s && !skills.includes(s) && skills.length < 15) {
      setSkills((prev) => [...prev, s]);
      setSkillInput("");
    }
  }

  async function finish() {
    setError(null);
    setSaving(true);
    try {
      await api("/api/profiles/me", {
        method: "PUT",
        body: JSON.stringify({
          specialty: specialty || undefined,
          yearsExperience,
          availability,
          headline: headline || undefined,
          skills: skills.map((name) => ({ name, years: 1 })),
        }),
      });
      await api("/api/profiles/me/complete-onboarding", { method: "POST" });
      await refresh(); // نحدّث بيانات المستخدم عشان onboarded يبقى true
      navigate("/feed");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function skip() {
    await api("/api/profiles/me/complete-onboarding", { method: "POST" }).catch(() => {});
    await refresh();
    navigate("/feed");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div className="mb-2 text-2xl font-extrabold text-brand-400">⌁ DevConnect</div>

      <div className="card w-full max-w-lg">
        {/* شريط التقدم */}
        <div className="mb-6 flex gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className={"h-1.5 flex-1 rounded-full " + (n <= step ? "bg-brand-500" : "bg-ink-700")} />
          ))}
        </div>

        {step === 1 && (
          <>
            <h1 className="text-2xl font-bold">Welcome! What's your focus?</h1>
            <p className="mb-6 mt-1 text-sm text-mist-400">
              This helps recruiters find you for the right roles.
            </p>
            <label className="mb-1.5 block text-sm font-medium">Specialty</label>
            <select className="input-field mb-4" value={specialty} onChange={(e) => setSpecialty(e.target.value as Specialty)}>
              <option value="">Select your specialty...</option>
              {SPECIALTIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <label className="mb-1.5 block text-sm font-medium">Years of experience: {yearsExperience}</label>
            <input type="range" min={0} max={20} value={yearsExperience} onChange={(e) => setYearsExperience(Number(e.target.value))} className="mb-6 w-full accent-brand-500" />

            <button onClick={() => setStep(2)} disabled={!specialty} className="btn-primary w-full justify-center disabled:opacity-50">
              Continue
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 className="text-2xl font-bold">Your top skills</h1>
            <p className="mb-6 mt-1 text-sm text-mist-400">Add the technologies you know best.</p>

            <div className="mb-3 flex gap-2">
              <input
                className="input-field"
                placeholder="e.g. React, Node.js, Python..."
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
              />
              <button onClick={addSkill} className="btn-ghost !py-2 text-sm">Add</button>
            </div>

            <div className="mb-6 flex min-h-16 flex-wrap gap-2">
              {skills.map((s) => (
                <span key={s} className="flex items-center gap-1 rounded-full bg-brand-500/15 px-3 py-1 text-sm text-brand-400">
                  {s}
                  <button onClick={() => setSkills((prev) => prev.filter((x) => x !== s))} className="text-brand-400/60 hover:text-brand-400">×</button>
                </span>
              ))}
              {skills.length === 0 && <p className="text-sm text-mist-600">No skills added yet.</p>}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setStep(1)} className="btn-ghost !py-2.5">Back</button>
              <button onClick={() => setStep(3)} disabled={skills.length === 0} className="btn-primary flex-1 justify-center disabled:opacity-50">
                Continue
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 className="text-2xl font-bold">Almost done!</h1>
            <p className="mb-6 mt-1 text-sm text-mist-400">A short headline and your job status.</p>

            <label className="mb-1.5 block text-sm font-medium">Headline</label>
            <input
              className="input-field mb-4"
              placeholder="e.g. Full-Stack Engineer building fintech tools"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />

            <label className="mb-1.5 block text-sm font-medium">Job status</label>
            <div className="mb-6 space-y-2">
              {AVAILABILITY_OPTIONS.map((o) => (
                <label key={o.value} className="flex cursor-pointer items-center gap-3 rounded-lg border border-ink-700 px-3 py-2 hover:bg-ink-900">
                  <input type="radio" checked={availability === o.value} onChange={() => setAvailability(o.value)} className="accent-brand-500" />
                  {o.label}
                </label>
              ))}
            </div>

            {error && <p className="mb-3 text-sm text-red-400">{error}</p>}

            <div className="flex gap-2">
              <button onClick={() => setStep(2)} className="btn-ghost !py-2.5">Back</button>
              <button onClick={finish} disabled={saving} className="btn-primary flex-1 justify-center disabled:opacity-60">
                {saving ? "Saving..." : "Finish setup 🎉"}
              </button>
            </div>
          </>
        )}

        <button onClick={skip} className="mt-4 w-full text-center text-xs text-mist-600 hover:text-mist-400">
          Skip for now
        </button>
      </div>
    </main>
  );
}
