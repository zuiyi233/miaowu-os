"use client";

import { useRef, useEffect, useState } from "react";
import { Globe } from "lucide-react";
import {
  useAnimeEntrance,
  useSpringEntrance,
  animate,
} from "@/lib/anime";

function ParticleGlobe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 800 });

  useEffect(() => {
    const updateDimensions = () => {
      const container = canvasRef.current?.parentElement;
      if (container) {
        const size = Math.min(container.clientWidth, 800);
        setDimensions({ width: size, height: size });
      }
    };
    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = dimensions;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width * 0.35;

    const points: { x: number; y: number; z: number }[] = [];
    const numPoints = 500;
    const goldenRatio = (1 + Math.sqrt(5)) / 2;

    for (let i = 0; i < numPoints; i++) {
      const theta = (2 * Math.PI * i) / goldenRatio;
      const phi = Math.acos(1 - (2 * (i + 0.5)) / numPoints);
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      points.push({ x, y, z });
    }

    let rotation = 0;
    let animationId: number;

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      rotation += 0.003;

      const rotatedPoints = points.map((p) => {
        const cosR = Math.cos(rotation);
        const sinR = Math.sin(rotation);
        const rx = p.x * cosR - p.z * sinR;
        const rz = p.x * sinR + p.z * cosR;
        return { ...p, rx, rz };
      });

      rotatedPoints.sort((a, b) => a.rz - b.rz);

      const connectionDistance = radius * 0.16;
      for (let i = 0; i < rotatedPoints.length; i++) {
        const p1 = rotatedPoints[i]!;
        if (p1.rz < -radius * 0.3) continue;
        for (let j = i + 1; j < rotatedPoints.length; j++) {
          const p2 = rotatedPoints[j]!;
          if (p2.rz < -radius * 0.3) continue;
          const dx = p1.rx - p2.rx;
          const dy = p1.y - p2.y;
          const dz = p1.rz - p2.rz;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < connectionDistance) {
            const alpha = (1 - dist / connectionDistance) * 0.12 * (p1.rz + radius) / (2 * radius);
            ctx!.beginPath();
            ctx!.moveTo(centerX + p1.rx, centerY + p1.y);
            ctx!.lineTo(centerX + p2.rx, centerY + p2.y);
            ctx!.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }

      for (const p of rotatedPoints) {
        const screenX = centerX + p.rx;
        const screenY = centerY + p.y;
        const depth = (p.rz + radius) / (2 * radius);
        if (depth < 0.1) continue;
        const size = 1 + depth * 1.2;
        const alpha = 0.2 + depth * 0.5;
        ctx!.beginPath();
        ctx!.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(245, 158, 11, ${alpha})`;
        ctx!.fill();
      }

      ctx!.beginPath();
      ctx!.ellipse(centerX, centerY, radius * 1.3, radius * 0.4, rotation * 0.5, 0, Math.PI * 2);
      ctx!.strokeStyle = "rgba(245, 158, 11, 0.06)";
      ctx!.lineWidth = 1;
      ctx!.stroke();

      animationId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [dimensions]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: dimensions.width, height: dimensions.height }}
      className="mx-auto"
    />
  );
}

export function GlobeSection() {
  const sectionRef = useAnimeEntrance("[data-animate]");
  const globeRef = useSpringEntrance("[data-globe]", { delay: 100, bounce: 0.15, duration: 1500 });

  return (
    <section ref={sectionRef} className="relative w-full py-24">
      <SectionDivider />

      <div className="container-md relative mx-auto max-w-[1200px] px-4 md:px-8">
        <div className="mb-4 text-center" data-animate style={{ opacity: 0 }}>
          <span className="text-sm font-medium uppercase tracking-wider text-white/40">
            全球生态
          </span>
        </div>
        <h2
          className="mb-4 text-center text-3xl font-bold text-white/90 md:text-4xl"
          data-animate style={{ opacity: 0 }}
        >
          Empowering the Future of Global Ecosystems
        </h2>
        <p
          className="mx-auto mb-8 max-w-[455px] text-center text-lg text-white/50"
          data-animate style={{ opacity: 0 }}
        >
          连接全球创作者与读者，构建 AI 驱动的故事生态系统。在这里，每个故事都有无限可能。
        </p>
        <div
          className="mb-12 flex justify-center"
          data-animate style={{ opacity: 0 }}
        >
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-black px-6 py-3 text-sm text-white transition-colors duration-300 hover:border-amber-500/40 hover:text-amber-300"
            onMouseEnter={(e) => {
              animate(e.currentTarget, {
                scale: [1, 1.05],
                boxShadow: ["0 0 0px rgba(245,158,11,0)", "0 0 20px rgba(245,158,11,0.15)"],
                duration: 400,
                ease: "spring(1, 0.5, 10, 0)",
              });
            }}
            onMouseLeave={(e) => {
              animate(e.currentTarget, {
                scale: [1.05, 1],
                boxShadow: ["0 0 20px rgba(245,158,11,0.15)", "0 0 0px rgba(245,158,11,0)"],
                duration: 500,
                ease: "spring(1, 0.4, 12, 0)",
              });
            }}
          >
            Get started
            <Globe className="size-4" />
          </button>
        </div>

        <div
          ref={globeRef}
          data-globe
          className="relative"
          style={{ opacity: 0 }}
        >
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-1/3 bg-gradient-to-t from-[#050508] to-transparent" />
          <ParticleGlobe />
        </div>
      </div>
    </section>
  );
}

function SectionDivider() {
  return (
    <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-1/2">
      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div
        className="mx-auto mt-[-1px] h-1 w-16 rounded-full"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.3), transparent)",
        }}
      />
    </div>
  );
}
