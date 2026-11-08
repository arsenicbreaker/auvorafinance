"use client";

import Link from "next/link";
import {
  DashboardIcon,
  type DashboardIconName,
} from "../features/dashboard/dashboard-icon";
import TextRotate from "../components/fancy/text/text-rotate";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import "./payment-story.css";

type Capability = {
  number: string;
  title: string;
  text: string;
  href: string;
  label: string;
};

const steps = ["Payments", "Schedules", "Sponsored"];
const previewTitles = ["Payments", "Schedules", "Sponsored controls"];
const previewDescriptions = [
  "Give your next payment a schedule. Review it before you sign.",
  "Keep track of your schedules and manage each workflow.",
  "Manage existing workflows with sponsored gas.",
];
const mobileNavigation: DashboardIconName[] = [
  "home",
  "payment",
  "calendar",
  "people",
  "chart",
  "balance",
  "sponsor",
];
const selectedNavigation = [1, 2, 6];

export function PaymentStory({ items }: { items: Capability[] }) {
  const section = useRef<HTMLElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const prefersReducedMotion = useReducedMotion();

  function selectStep(index: number) {
    setActive(index);
    const container = stage.current;
    const phone = container?.children[index] as HTMLElement | undefined;
    if (
      container &&
      phone &&
      window.matchMedia("(max-width: 1000px)").matches
    ) {
      container.scrollTo({
        left:
          phone.offsetLeft - (container.clientWidth - phone.offsetWidth) / 2,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    }
  }

  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let displayedProgress: number | undefined;
    let previousTime = 0;
    function update(time: number) {
      frame = 0;
      if (!element) return;
      const top = element.getBoundingClientRect().top;
      const progress = reducedMotion.matches
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (window.innerHeight * 0.8 - top) / (window.innerHeight * 0.75),
            ),
          );
      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      displayedProgress =
        displayedProgress === undefined || reducedMotion.matches
          ? progress
          : displayedProgress +
            (progress - displayedProgress) * (1 - Math.exp(-elapsed / 180));
      if (Math.abs(progress - displayedProgress) < 0.0005)
        displayedProgress = progress;
      element.style.setProperty("--story-progress", String(displayedProgress));
      if (displayedProgress !== progress) frame = requestAnimationFrame(update);
      else previousTime = 0;
    }
    function scheduleUpdate() {
      if (!frame) frame = requestAnimationFrame(update);
    }
    update(performance.now());
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    reducedMotion.addEventListener("change", scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      reducedMotion.removeEventListener("change", scheduleUpdate);
    };
  }, []);

  useEffect(() => {
    const element = section.current;
    if (!element) return;
    const desktop = window.matchMedia(
      "(min-width: 1001px) and (pointer: fine)",
    );
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let target = window.scrollY;
    let previousTime = 0;

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      target = window.scrollY;
    }

    function animate(time: number) {
      const elapsed = previousTime ? Math.min(time - previousTime, 64) : 16;
      previousTime = time;
      const remaining = target - window.scrollY;
      const next =
        Math.abs(remaining) < 1
          ? target
          : window.scrollY +
            Math.sign(remaining) *
              Math.max(1, Math.abs(remaining) * (1 - Math.exp(-elapsed / 120)));
      window.scrollTo({ top: next, behavior: "instant" });
      if (Math.abs(target - window.scrollY) < 1) stop();
      else frame = requestAnimationFrame(animate);
    }

    function onWheel(event: WheelEvent) {
      if (
        !desktop.matches ||
        reducedMotion.matches ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !event.cancelable ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        !(event.target instanceof Node) ||
        !element?.contains(event.target)
      ) {
        stop();
        return;
      }
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? window.innerHeight
            : 1;
      const delta = event.deltaY * unit;
      if (!frame || Math.sign(delta) !== Math.sign(target - window.scrollY))
        target = window.scrollY;
      const maximum = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      target = Math.max(0, Math.min(maximum, target + delta * 0.6));
      event.preventDefault();
      if (!frame) frame = requestAnimationFrame(animate);
    }

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointerdown", stop, { passive: true });
    window.addEventListener("keydown", stop);
    window.addEventListener("resize", stop);
    desktop.addEventListener("change", stop);
    reducedMotion.addEventListener("change", stop);
    return () => {
      stop();
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerdown", stop);
      window.removeEventListener("keydown", stop);
      window.removeEventListener("resize", stop);
      desktop.removeEventListener("change", stop);
      reducedMotion.removeEventListener("change", stop);
    };
  }, []);

  return (
    <section
      ref={section}
      className="landing-story payment-story"
      id="how-it-works"
      aria-labelledby="story-title"
    >
      <p className="section-caption">From intention to execution</p>
      <h2 id="story-title">
        Your payments have a rhythm.
        <br />
        <TextRotate
          as="span"
          texts={[
            "Now your workspace does, too.",
            "Now your payments flow, too.",
            "Now your routines do, too.",
          ]}
          splitBy="words"
          rotationInterval={4200}
          staggerDuration={0.035}
          transition={{ type: "spring", damping: 24, stiffness: 280 }}
          mainClassName="story-title-rotate"
          auto={!prefersReducedMotion}
        />
      </h2>
      <div
        ref={stage}
        className="story-stage"
        aria-label="Illustrative workspace previews"
        onScroll={(event) => {
          if (!window.matchMedia("(max-width: 1000px)").matches) return;
          const container = event.currentTarget;
          const center = container.scrollLeft + container.clientWidth / 2;
          let nearest = 0;
          let distance = Infinity;
          Array.from(container.children).forEach((child, index) => {
            const phone = child as HTMLElement;
            const delta = Math.abs(
              phone.offsetLeft + phone.offsetWidth / 2 - center,
            );
            if (delta < distance) {
              nearest = index;
              distance = delta;
            }
          });
          setActive(nearest);
        }}
      >
        {items.map((item, index) => (
          <div
            key={item.number}
            className={`story-step story-step-${index}${active === index ? " is-active" : ""}`}
          >
            <button
              type="button"
              className={`story-phone story-phone-${index}${active === index ? " is-active" : ""}`}
              aria-label={`Preview: ${steps[index]}`}
              aria-pressed={active === index}
              onClick={() => selectStep(index)}
            >
              <span className="story-phone-camera" />
              <span className="story-dashboard-screen">
                <span className="story-mobile-header">
                  <b>auvora</b>
                  <span className="story-mobile-network">
                    <i /> NEAR testnet
                  </span>
                  <span className="story-mobile-avatar">OC</span>
                </span>
                <span className="story-mobile-heading">
                  <strong>{previewTitles[index]}</strong>
                  <small>{previewDescriptions[index]}</small>
                </span>

                {index === 0 ? (
                  <>
                    <span className="story-payment-steps">
                      <span>
                        <i><DashboardIcon name="check" /></i>
                        <small>Connect wallet</small>
                      </span>
                      <span className="is-current">
                        <i>2</i>
                        <small>Set payment</small>
                      </span>
                      <span>
                        <i>3</i>
                        <small>Track schedules</small>
                      </span>
                    </span>
                    <span className="story-mobile-card story-payment-card">
                      <small>Step 2 of 3</small>
                      <b>Set up a recurring payment</b>
                      <span>
                        Choose who gets paid, how much they receive, and when
                        the schedule stops.
                      </span>
                      <span className="story-card-preview">
                        <strong>Describe the payment</strong>
                        <i />
                        <i />
                      </span>
                    </span>
                  </>
                ) : index === 1 ? (
                  <span className="story-mobile-card story-schedule-card">
                    <small>Step 3 of 3</small>
                    <b>Track your payment schedules</b>
                    <span className="story-refresh">Refresh</span>
                    <span>
                      See what runs next, manage active schedules, and withdraw
                      funds that are no longer reserved.
                    </span>
                    <span className="story-fee-note">
                      Management actions currently charge testnet gas to your
                      wallet.
                    </span>
                    <span className="story-owner-preview">
                      <small>OWNER</small>
                      <strong>oceane...testnet</strong>
                    </span>
                  </span>
                ) : (
                  <span className="story-mobile-card story-sponsored-card">
                    <small>Gas sponsorship</small>
                    <b>Manage a workflow. We cover the gas.</b>
                    <span>
                      Pause, resume, cancel, or withdraw from an existing
                      workflow. The relayer pays the transaction gas.
                    </span>
                    <span className="story-network-badge">NEAR testnet</span>
                    <span className="story-owner-preview">
                      <small>OWNER ACCOUNT</small>
                      <strong>oceane...testnet</strong>
                    </span>
                  </span>
                )}

                <span className="story-mobile-nav" aria-hidden="true">
                  {mobileNavigation.map((icon, navIndex) => (
                    <span
                      key={icon}
                      className={
                        selectedNavigation[index] === navIndex
                          ? "is-selected"
                          : undefined
                      }
                    >
                      <DashboardIcon name={icon} />
                    </span>
                  ))}
                </span>
              </span>
            </button>
            <div className="capability-list">
              <article
                key={item.number}
                className={active === index ? "is-active" : ""}
              >
                <button
                  className="story-step-select"
                  type="button"
                  onClick={() => selectStep(index)}
                  aria-pressed={active === index}
                >
                  <span className="capability-number">{item.number}</span>
                  <span>{steps[index]}</span>
                </button>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <Link href={item.href}>{item.label}</Link>
              </article>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
