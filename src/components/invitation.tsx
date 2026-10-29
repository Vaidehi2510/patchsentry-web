"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthFrame, authPost } from "./auth-form";
export function Invitation() {
  const [token, setToken] = useState(""),
    [invitation, setInvitation] = useState<{
      name: string;
      role: string;
      email: string;
    } | null>(null),
    [guest, setGuest] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const value =
      new URLSearchParams(location.hash.slice(1)).get("token") ||
      sessionStorage.getItem("patchsentry-invitation") ||
      "";
    if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
      setError(
        "Open the complete invitation link, or ask your admin for a new invitation.",
      );
      return;
    }
    setToken(value);
    sessionStorage.setItem("patchsentry-invitation", value);
    history.replaceState(null, "", "/invite");
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then(async (d) => {
        if (!d.user) {
          setGuest(true);
          return;
        }
        const result = await authPost("/api/invitations/preview", {
          token: value,
        });
        setInvitation(result.invitation);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <AuthFrame>
      <span className="eyebrow">YOUR TEAM INVITATION</span>
      <h1>{invitation ? `Join ${invitation.name}.` : "You’re invited."}</h1>
      {guest ? (
        <>
          <p>
            Sign in or create an account with the exact email address that
            received this invitation. Verify your email, password and second
            factor if this is your first visit. Your invitation will be waiting
            after sign-in.
          </p>
          <Link className="button button-primary auth-submit" href="/login">
            Sign in to review invitation
          </Link>
          <Link className="button button-secondary auth-submit" href="/signup">
            Create an account
          </Link>
        </>
      ) : invitation ? (
        <>
          <p>
            Invited address: <strong>{invitation.email}</strong>
            <br />
            Patchsentry role:{" "}
            <strong>
              {invitation.role === "qa" ? "QA engineer" : invitation.role}
            </strong>
            . This grants project access in Patchsentry. It does not change
            GitHub permissions.
          </p>
          <button
            className="button button-primary auth-submit"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await authPost("/api/invitations/accept", { token });
                sessionStorage.removeItem("patchsentry-invitation");
                const status = await (
                  await fetch("/api/session", { cache: "no-store" })
                ).json();
                location.assign(
                  status.user
                    ? `/app?project=${r.projectId}&tab=overview`
                    : status.next || "/auth/setup",
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Accept invitation
          </button>
        </>
      ) : (
        !error && <p>Checking your invitation…</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="text-button auth-help"
        onClick={() => {
          sessionStorage.removeItem("patchsentry-invitation");
          location.assign("/app");
        }}
      >
        Skip invitation and open my workspace
      </button>
    </AuthFrame>
  );
}
