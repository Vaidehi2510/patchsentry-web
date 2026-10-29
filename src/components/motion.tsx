"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Pause, Play } from "lucide-react";

const MotionContext = createContext({ enabled: false, reduced: true, toggle: () => {} });
export const useMotion = () => useContext(MotionContext);

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState(true);
  const [reduced, setReduced] = useState(true);
  const pathname = usePathname();
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    try { setPreference(localStorage.getItem("patchsentry-motion") !== "off"); } catch {}
    return () => media.removeEventListener("change", update);
  }, []);
  const enabled = preference && !reduced;
  useEffect(() => {
    document.documentElement.dataset.motion = enabled ? "on" : "off";
    if (!enabled || !("IntersectionObserver" in window)) return;
    const targets = document.querySelectorAll<HTMLElement>(".marketing-page .section-heading, .marketing-page .feature-card, .marketing-page .team-role, .marketing-page .workflow-step, .marketing-page .security-card, .marketing-page .use-case-card, .marketing-page .detail-step-body");
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) if (entry.isIntersecting) {
        (entry.target as HTMLElement).dataset.reveal = "visible";
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.08, rootMargin: "0px 0px -20px 0px" });
    targets.forEach((target, index) => {
      if (target.getBoundingClientRect().top < innerHeight) return;
      target.dataset.reveal = "pending";
      target.style.setProperty("--reveal-delay", `${index % 3 * 65}ms`);
      observer.observe(target);
    });
    const revealFocused = (e: FocusEvent) => {
      const target = (e.target as Element)?.closest<HTMLElement>("[data-reveal]");
      if (target) { target.dataset.reveal = "visible"; observer.unobserve(target); }
    };
    document.addEventListener("focusin", revealFocused);
    return () => { observer.disconnect(); targets.forEach(t => { delete t.dataset.reveal; }); document.removeEventListener("focusin", revealFocused); };
  }, [enabled, pathname]);
  return <MotionContext.Provider value={{ enabled, reduced, toggle: () => {
    const next = !preference;
    setPreference(next);
    try { localStorage.setItem("patchsentry-motion", next ? "on" : "off"); } catch {}
  } }}>{children}</MotionContext.Provider>;
}
export function MotionToggle() {
  const { enabled, reduced, toggle } = useMotion();
  const label = reduced ? "Animations reduced by your device preference" : enabled ? "Pause animations" : "Enable animations";
  return <button type="button" className="motion-toggle" onClick={toggle} disabled={reduced} aria-pressed={!enabled} aria-label={label} title={label}>
    {enabled ? <Pause size={16} /> : <Play size={16} />}<span>{reduced ? "Reduced motion" : enabled ? "Motion on" : "Motion off"}</span>
  </button>;
}
