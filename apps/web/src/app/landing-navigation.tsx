"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export function LandingNavigation() {
  const [open, setOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function dismiss(event: PointerEvent) {
      if (!groupRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <header className="landing-nav">
      <div
        className="landing-menu-group"
        ref={groupRef}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setOpen(false);
        }}
      >
        <Link href="/" className="wordmark" aria-label="Auvora home">
          auvora<span>.</span>
        </Link>
        <button
          ref={toggleRef}
          className="landing-menu-toggle"
          type="button"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="landing-menu"
          onClick={() => setOpen(!open)}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d={open ? "M5 5l10 10M5 15L15 5" : "M4 7h12M4 13h12"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <nav id="landing-menu" aria-label="Main navigation" hidden={!open}>
          <a href="#how-it-works" onClick={() => setOpen(false)}>
            How it works
          </a>
          <a href="#workspace" onClick={() => setOpen(false)}>
            The workspace
          </a>
        </nav>
      </div>
      <Link className="ui-button ui-button-dark" href="/dashboard">
        Open dashboard
      </Link>
    </header>
  );
}
