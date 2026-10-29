"use client";
import Link from "next/link";
import { BrandMark } from "./marketing/site-shell";
import { MotionToggle } from "./motion";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, ArrowLeft, ShieldCheck, Check, Mail, Inbox, LoaderCircle } from "lucide-react";
import "./workspace.css";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (new URLSearchParams(location.search).get("error")) setError("That link has expired or has already been used. Request a fresh link below.");
    let alive = true;
    fetch("/api/session", { cache: "no-store" }).then(r => r.json()).then(d => {
      if (!alive) return;
      setConfigured(d.configured && d.emailSignInReady);
      if (d.user) location.replace("/app");
    }).catch(() => { if (alive) setConfigured(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || seconds > 0) return;
    setPending(true); setError("");
    const data = new FormData(e.currentTarget);
    const email = String(data.get("email") || "").trim();
    try {
      const response = await fetch("/api/auth/sign-in/magic-link", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(mode === "signup" ? { name: data.get("name") } : {}) }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || body.error || "We couldn't send your link. Please try again.");
      setSentTo(email); setRetryAt(Date.now() + 60000);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not reach the server."); }
    finally { setPending(false); }
  }
  return <main className="auth-page">
    <aside className="auth-story">
      <Link className="wordmark" href="/"><BrandMark />patchsentry<span className="beta-tag">BETA</span></Link>
      <div><span className="eyebrow">FOR YOUR NEXT BIG THING</span><h2>A little less<br />“hope it works.”<br /><em>A lot more proof.</em></h2>
        <p>From your weekend project to your team’s next release. Your code, your models, your decision.</p>
        <ul className="auth-points"><li><Check size={19} /> Personal and team projects welcome</li><li><Check size={19} /> Tests and release evidence you can inspect</li><li><Check size={19} /> Your product code stays untouched</li></ul>
      </div><small><ShieldCheck size={18} /> One secure link. Your own QA workspace.</small>
    </aside>
    <section className="auth-panel">
      <div className="auth-topline"><Link href="/" className="back-link"><ArrowLeft size={18} /> Back to home</Link><MotionToggle /></div>
      <div className="auth-card">
        <span className="auth-mail-icon">{sentTo ? <Inbox size={29} /> : <Mail size={29} />}</span>
        <span className="eyebrow">{sentTo ? "ONE LAST STEP" : mode === "signup" ? "YOUR IDEAS DESERVE GOOD QA" : "WELCOME BACK"}</span>
        <h1>{sentTo ? "Check your inbox." : mode === "signup" ? "Start with your email." : "A link. And you’re in."}</h1>
        <p>{sentTo ? <>We sent a secure sign-in link to <strong>{sentTo}</strong>. Open it to verify your email and continue.</> : <>Use your personal, school, or work email. We’ll send a secure link—no password to remember.</>}</p>
        {sentTo && <div className="email-next-steps" role="status"><span><Check size={18} /> Link sent to your inbox</span><span><Mail size={18} /> Open it within 10 minutes</span><span><ShieldCheck size={18} /> Your account is created only after verification</span></div>}
        {configured === false && <div role="status" className="notice warning"><p>Email sign-in is being connected. <Link href="/demo">Explore the demo</Link> while the sender setup is completed.</p></div>}
        <form onSubmit={submit} hidden={Boolean(sentTo)}>
          {mode === "signup" && <label>Your name<input name="name" autoComplete="name" required maxLength={100} placeholder="Alex Morgan" /></label>}
          <label>Email address<input type="email" name="email" autoComplete="email" required maxLength={254} placeholder="you@example.com" autoCapitalize="none" spellCheck={false} /></label>
          {error && !sentTo && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary auth-submit" disabled={pending || configured !== true}>
            {pending ? <><LoaderCircle size={19} className="loading-spin" /> Sending your link…</> : <>Send me a secure link <ArrowRight size={19} /></>}
          </button>
        </form>
        {sentTo && <><p className="fineprint">Can’t find it? Check Spam and Promotions. The link is single-use and works on the device where you open it.</p><button className="button button-secondary auth-submit" disabled={seconds > 0} onClick={() => { setSentTo(""); setError(""); }}>{seconds > 0 ? `Request another link in ${seconds}s` : "Use another email or request a new link"}</button></>}
        {!sentTo && <p className="auth-switch">{mode === "signup" ? "Already have an account?" : "First time here?"} <Link href={mode === "signup" ? "/login" : "/signup"}>{mode === "signup" ? "Sign in" : "Create an account"}</Link></p>}
        <div className="auth-divider"><span>EXPLORE BEFORE YOU CONNECT</span></div>
        <Link href="/demo" className="button button-secondary auth-submit">Try the interactive demo <ArrowRight size={19} /></Link>
        <p className="fineprint">No credit card. No company email required. Creating an account grants no access to your repositories.</p>
      </div>
      <footer><Link href="/security">Security & privacy</Link><span>Made for independent minds and teams.</span></footer>
    </section>
  </main>;
}
