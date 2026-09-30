"use client";
import Link from "next/link";
import { BrandMark } from "./marketing/site-shell";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowLeft,
  ShieldCheck,
  Eye,
  EyeOff,
  Check,
} from "lucide-react";
import "./workspace.css";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [visible, setVisible] = useState(false),
    [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/session")
      .then((r) => r.json())
      .then((d) => {
        setConfigured(d.configured);
        if (d.user) location.replace("/app");
      })
      .catch(() => setConfigured(false));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const r = await fetch(
        `/api/auth/${mode === "signup" ? "sign-up" : "sign-in"}/email`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: data.get("email"),
            password: data.get("password"),
            ...(mode === "signup"
              ? { name: data.get("name") }
              : { rememberMe: true }),
          }),
        },
      );
      const body = await r.json();
      if (!r.ok)
        throw new Error(
          body.message || body.error || "Unable to sign in. Please try again.",
        );
      location.assign("/app");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server.");
      setPending(false);
    }
  }
  return (
    <main className="auth-page">
      <aside className="auth-story">
        <Link className="wordmark" href="/">
          <BrandMark />
          patchsentry<span className="beta-tag">BETA</span>
        </Link>
        <div>
          <span className="eyebrow">YOUR NEXT RELEASE, WITH EVIDENCE</span>
          <h2>
            A little less
            <br />
            “hope it works.”
            <br />
            <em>A lot more proof.</em>
          </h2>
          <p>
            Your code, your models, your release decision.
            <br />
            Your QA team is already on it.
          </p>
          <ul className="auth-points">
            <li>
              <Check size={17} /> Five specialist AI review roles
            </li>
            <li>
              <Check size={17} /> Automated browser and regression checks
            </li>
            <li>
              <Check size={17} /> Source code stays under your control
            </li>
          </ul>
        </div>
        <small>
          <ShieldCheck size={16} /> Read code. Run checks. Report findings.
        </small>
      </aside>
      <section className="auth-panel">
        <Link href="/" className="back-link">
          <ArrowLeft size={16} /> Back to home
        </Link>
        <div className="auth-card">
          <span className="eyebrow">
            {mode === "signup" ? "LET’S GET YOU SET UP" : "WELCOME BACK"}
          </span>
          <h1>
            {mode === "signup"
              ? "Make room for better QA."
              : "Your workspace awaits."}
          </h1>
          <p>
            {mode === "signup"
              ? "Create your account, then connect your first product."
              : "Sign in to your projects, reports, and model settings."}
          </p>
          {configured === false && (
            <div role="alert" className="notice warning">
              Account storage is not connected on this deployment yet.{" "}
              <Link href="/demo">Explore the demo</Link> while setup is
              completed.
            </div>
          )}
          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Your name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={100}
                  placeholder="Alex Morgan"
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
                placeholder="you@company.com"
              />
            </label>
            <label>
              Password
              <span className="password-input">
                <input
                  type={visible ? "text" : "password"}
                  name="password"
                  autoComplete={
                    mode === "signup" ? "new-password" : "current-password"
                  }
                  required
                  minLength={mode === "signup" ? 12 : 1}
                  maxLength={128}
                  placeholder={
                    mode === "signup"
                      ? "At least 12 characters"
                      : "Enter your password"
                  }
                />
                <button
                  type="button"
                  aria-label={visible ? "Hide password" : "Show password"}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary auth-submit"
              disabled={pending || configured !== true}
            >
              {pending
                ? "One moment…"
                : mode === "signup"
                  ? "Create workspace"
                  : "Sign in"}
              <ArrowRight size={17} />
            </button>
          </form>
          {mode === "signup" && (
            <p className="fineprint">
              This early release uses email and password sign-in. Email
              verification and password recovery emails are not enabled yet. Use
              a password manager to save your login.
            </p>
          )}
          <p className="auth-switch">
            {mode === "signup"
              ? "Already have an account?"
              : "New to Patchsentry?"}{" "}
            <Link href={mode === "signup" ? "/login" : "/signup"}>
              {mode === "signup" ? "Sign in" : "Create an account"}
            </Link>
          </p>
          <div className="auth-divider">
            <span>OR TAKE A LOOK FIRST</span>
          </div>
          <Link href="/demo" className="button button-secondary auth-submit">
            Explore the demo <ArrowRight size={17} />
          </Link>
          <p className="fineprint">
            No product access is granted by creating an account. You choose what
            to connect.
          </p>
        </div>
        <footer>
          <Link href="/security">Security & privacy</Link>
          <span>Built around your workflow.</span>
        </footer>
      </section>
    </main>
  );
}
