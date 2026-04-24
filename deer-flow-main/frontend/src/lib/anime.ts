"use client";

import { animate, stagger, createTimeline } from "animejs";
import { useEffect, useRef } from "react";

export function useAnimeEntrance(selector: string, options?: {
  delay?: number;
  translateY?: number;
  duration?: number;
  easing?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          observer.disconnect();

          const targets = ref.current!.querySelectorAll(selector);
          if (targets.length === 0) return;

          animate(targets, {
            opacity: [0, 1],
            translateY: [options?.translateY ?? 30, 0],
            duration: options?.duration ?? 1000,
            delay: stagger(options?.delay ?? 80, { start: 100 }),
            ease: options?.easing ?? "outQuart",
          });
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [selector, options?.delay, options?.translateY, options?.duration, options?.easing]);

  return ref;
}

export function useAnimeScale(selector: string, options?: {
  delay?: number;
  duration?: number;
  easing?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          observer.disconnect();

          const targets = ref.current!.querySelectorAll(selector);
          if (targets.length === 0) return;

          animate(targets, {
            opacity: [0, 1],
            scale: [0.5, 1],
            duration: options?.duration ?? 1000,
            delay: stagger(options?.delay ?? 60, { start: 150 }),
            ease: options?.easing ?? "outQuart",
          });
        }
      },
      { threshold: 0.15 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [selector, options?.delay, options?.duration, options?.easing]);

  return ref;
}

export function useHeroAnimation() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const badge = ref.current.querySelector("[data-hero-badge]");
    const title = ref.current.querySelector("[data-hero-title]");
    const desc = ref.current.querySelector("[data-hero-desc]");
    const buttons = ref.current.querySelectorAll("[data-hero-btn]");

    const tl = createTimeline({
      defaults: { ease: "outQuart" },
    });

    if (badge) {
      tl.add(badge, {
        opacity: [0, 1],
        translateY: [20, 0],
        scale: [0.9, 1],
        duration: 800,
      });
    }

    if (title) {
      tl.add(title, {
        opacity: [0, 1],
        translateY: [30, 0],
        duration: 1000,
      }, badge ? "-=400" : 0);
    }

    if (desc) {
      tl.add(desc, {
        opacity: [0, 1],
        translateY: [25, 0],
        duration: 900,
      }, (badge || title) ? "-=500" : 0);
    }

    if (buttons.length > 0) {
      tl.add(buttons, {
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 800,
        delay: stagger(100),
      }, "-=400");
    }
  }, []);

  return ref;
}

export function useFloatAnimation(selector: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const targets = ref.current.querySelectorAll(selector);
    if (targets.length === 0) return;

    animate(targets, {
      translateY: [-4, 4],
      duration: 3000,
      delay: stagger(200),
      loop: true,
      alternate: true,
      ease: "inOutSine",
    });
  }, [selector]);

  return ref;
}

export function useGlowPulse(selector: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const targets = ref.current.querySelectorAll(selector);
    if (targets.length === 0) return;

    animate(targets, {
      boxShadow: [
        "0 0 0px rgba(245,158,11,0)",
        "0 0 20px rgba(245,158,11,0.15)",
        "0 0 0px rgba(245,158,11,0)",
      ],
      duration: 4000,
      delay: stagger(500),
      loop: true,
      ease: "inOutSine",
    });
  }, [selector]);

  return ref;
}

export function useSpringEntrance(selector: string, options?: {
  delay?: number;
  bounce?: number;
  duration?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          observer.disconnect();

          const targets = ref.current!.querySelectorAll(selector);
          if (targets.length === 0) return;

          animate(targets, {
            opacity: [0, 1],
            translateY: [40, 0],
            scale: [0.8, 1],
            duration: options?.duration ?? 1200,
            delay: stagger(options?.delay ?? 80, { start: 100 }),
            ease: `spring(1, ${options?.bounce ?? 0.3}, 10, 0)`,
          });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [selector, options?.delay, options?.bounce, options?.duration]);

  return ref;
}

export function useMagneticHover(selector: string, strength = 0.3) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    const targets = container.querySelectorAll(selector);
    if (targets.length === 0) return;

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = (e.clientX - centerX) * strength;
      const deltaY = (e.clientY - centerY) * strength;

      animate(target, {
        translateX: deltaX,
        translateY: deltaY,
        duration: 400,
        ease: "outQuart",
      });
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const target = e.currentTarget as HTMLElement;
      animate(target, {
        translateX: 0,
        translateY: 0,
        duration: 600,
        ease: "spring(1, 0.4, 12, 0)",
      });
    };

    const htmlTargets = Array.from(targets) as HTMLElement[];

    htmlTargets.forEach((target) => {
      target.addEventListener("mousemove", handleMouseMove);
      target.addEventListener("mouseleave", handleMouseLeave);
    });

    return () => {
      htmlTargets.forEach((target) => {
        target.removeEventListener("mousemove", handleMouseMove);
        target.removeEventListener("mouseleave", handleMouseLeave);
      });
    };
  }, [selector, strength]);

  return ref;
}

export function useTextReveal(selector: string, options?: {
  delay?: number;
  duration?: number;
  splitBy?: "char" | "word";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          observer.disconnect();

          const targets = ref.current!.querySelectorAll(selector);
          if (targets.length === 0) return;

          targets.forEach((target) => {
            const text = target.textContent ?? "";
            target.textContent = "";

            const splitBy = options?.splitBy ?? "char";
            const units = splitBy === "char" ? text.split("") : text.split(" ");

            units.forEach((unit, i) => {
              const span = document.createElement("span");
              span.textContent = splitBy === "word" && i < units.length - 1 ? unit + " " : unit;
              span.style.display = "inline-block";
              span.style.opacity = "0";
              span.style.transform = "translateY(10px)";
              target.appendChild(span);
            });

            const spans = target.querySelectorAll("span");
            animate(spans, {
              opacity: [0, 1],
              translateY: [10, 0],
              duration: options?.duration ?? 600,
              delay: stagger(options?.delay ?? 30),
              ease: "outQuart",
            });
          });
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [selector, options?.delay, options?.duration, options?.splitBy]);

  return ref;
}

export function useParallaxScroll(selector: string, speed = 0.1) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    const targets = container.querySelectorAll(selector);
    if (targets.length === 0) return;

    let rafId: number;
    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      rafId = requestAnimationFrame(() => {
        const rect = container.getBoundingClientRect();
        const scrollProgress = -rect.top * speed;

        targets.forEach((target) => {
          animate(target, {
            translateY: scrollProgress,
            duration: 300,
            ease: "outQuad",
          });
        });
        ticking = false;
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [selector, speed]);

  return ref;
}

export function useRippleHover(selector: string) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const container = ref.current;
    const targets = container.querySelectorAll(selector);
    if (targets.length === 0) return;

    const handleEnter = (e: MouseEvent) => {
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      target.style.setProperty("--ripple-x", `${x}px`);
      target.style.setProperty("--ripple-y", `${y}px`);

      animate(target, {
        scale: [1, 1.03],
        duration: 400,
        ease: "outQuart",
      });
    };

    const handleLeave = (e: MouseEvent) => {
      const target = e.currentTarget as HTMLElement;
      animate(target, {
        scale: [1.03, 1],
        duration: 500,
        ease: "spring(1, 0.4, 12, 0)",
      });
    };

    const htmlTargets = Array.from(targets) as HTMLElement[];

    htmlTargets.forEach((target) => {
      target.addEventListener("mouseenter", handleEnter);
      target.addEventListener("mouseleave", handleLeave);
    });

    return () => {
      htmlTargets.forEach((target) => {
        target.removeEventListener("mouseenter", handleEnter);
        target.removeEventListener("mouseleave", handleLeave);
      });
    };
  }, [selector]);

  return ref;
}

export function useSvgLineDraw(selector: string, options?: {
  duration?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          observer.disconnect();

          const paths = ref.current!.querySelectorAll(selector);
          if (paths.length === 0) return;

          paths.forEach((path) => {
            const el = path as SVGPathElement;
            const length = el.getTotalLength?.() ?? 0;
            el.style.strokeDasharray = `${length}`;
            el.style.strokeDashoffset = `${length}`;
          });

          animate(paths, {
            strokeDashoffset: [0, 0],
            duration: options?.duration ?? 2000,
            delay: stagger(options?.delay ?? 200),
            ease: "outQuart",
          });
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [selector, options?.duration, options?.delay]);

  return ref;
}

export function useCountUp(selector: string, options?: {
  duration?: number;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!ref.current || hasAnimated.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          observer.disconnect();

          const targets = ref.current!.querySelectorAll(selector);
          if (targets.length === 0) return;

          targets.forEach((target) => {
            const el = target as HTMLElement;
            const endValue = parseInt(el.dataset.count ?? "0", 10);
            if (endValue === 0) return;

            const obj = { value: 0 };
            animate(obj, {
              value: endValue,
              duration: options?.duration ?? 2000,
              delay: stagger(options?.delay ?? 100),
              ease: "outQuart",
              onUpdate: () => {
                el.textContent = Math.round(obj.value).toString();
              },
            });
          });
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [selector, options?.duration, options?.delay]);

  return ref;
}

export { animate, stagger, createTimeline };
