"use client";

import { useEffect, useRef } from "react";

interface AuroraBackgroundProps {
  className?: string;
  children?: React.ReactNode;
}

export function AuroraBackground({ className, children }: AuroraBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas!.width = window.innerWidth * dpr;
      canvas!.height = window.innerHeight * dpr;
      ctx!.scale(dpr, dpr);
    }

    function noise(x: number, y: number, t: number) {
      return Math.sin(x * 0.01 + t) * Math.cos(y * 0.01 + t * 0.5) * 0.5 + 0.5;
    }

    function draw() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      time += 0.003;

      // Clear with very dark base
      ctx!.fillStyle = "#050508";
      ctx!.fillRect(0, 0, width, height);

      // Create aurora bands
      const bands = [
        { color: "rgba(180, 120, 40, 0.15)", yOffset: 0.3, speed: 0.5, amplitude: 80 },
        { color: "rgba(200, 140, 60, 0.12)", yOffset: 0.4, speed: 0.7, amplitude: 100 },
        { color: "rgba(160, 100, 30, 0.1)", yOffset: 0.35, speed: 0.3, amplitude: 60 },
        { color: "rgba(140, 80, 20, 0.08)", yOffset: 0.5, speed: 0.6, amplitude: 90 },
      ];

      for (const band of bands) {
        ctx!.beginPath();
        ctx!.moveTo(0, height * band.yOffset);

        for (let x = 0; x <= width; x += 5) {
          const y =
            height * band.yOffset +
            Math.sin(x * 0.003 + time * band.speed) * band.amplitude +
            Math.sin(x * 0.007 + time * band.speed * 1.3) * (band.amplitude * 0.5) +
            Math.sin(x * 0.001 + time * band.speed * 0.7) * (band.amplitude * 0.3);
          ctx!.lineTo(x, y);
        }

        ctx!.lineTo(width, height);
        ctx!.lineTo(0, height);
        ctx!.closePath();

        // Create gradient for this band
        const gradient = ctx!.createLinearGradient(0, height * band.yOffset - 100, 0, height);
        gradient.addColorStop(0, band.color);
        gradient.addColorStop(0.5, band.color.replace(/[\d.]+\)$/, "0.05)"));
        gradient.addColorStop(1, "transparent");
        ctx!.fillStyle = gradient;
        ctx!.fill();
      }

      // Add subtle stars
      const numStars = 150;
      for (let i = 0; i < numStars; i++) {
        const x = ((i * 137.5) % width);
        const y = ((i * 293.1) % height);
        const twinkle = Math.sin(time * 2 + i) * 0.5 + 0.5;
        const size = (i % 3) * 0.5 + 0.5;
        const alpha = twinkle * 0.6 + 0.2;

        ctx!.beginPath();
        ctx!.arc(x, y, size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(255, 240, 200, ${alpha})`;
        ctx!.fill();
      }

      // Add subtle nebula clouds
      for (let i = 0; i < 3; i++) {
        const nx = width * (0.2 + i * 0.3) + Math.sin(time * 0.2 + i * 2) * 100;
        const ny = height * (0.3 + i * 0.2) + Math.cos(time * 0.15 + i) * 80;
        const radius = 200 + i * 50;

        const gradient = ctx!.createRadialGradient(nx, ny, 0, nx, ny, radius);
        gradient.addColorStop(0, `rgba(180, 120, 40, ${0.03 - i * 0.005})`);
        gradient.addColorStop(0.5, `rgba(160, 100, 30, ${0.02 - i * 0.003})`);
        gradient.addColorStop(1, "transparent");

        ctx!.beginPath();
        ctx!.arc(nx, ny, radius, 0, Math.PI * 2);
        ctx!.fillStyle = gradient;
        ctx!.fill();
      }

      animationId = requestAnimationFrame(draw);
    }

    resize();
    draw();
    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className={`relative ${className || ""}`}>
      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed inset-0 z-0"
        style={{ width: "100%", height: "100%" }}
      />
      {children}
    </div>
  );
}
