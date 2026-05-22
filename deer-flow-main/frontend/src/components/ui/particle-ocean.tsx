"use client";

import { Renderer, Program, Mesh, Color, Triangle } from "ogl";
import { useEffect, useRef } from "react";
import "./galaxy.css";

const vertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;

varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

vec3 starLayer(vec2 uv, float depth, float time) {
  vec3 col = vec3(0.0);

  // 20% more particles: scale from 72→12 (was 60→10)
  float scale = mix(72.0, 12.0, depth);
  float fade = depth * smoothstep(1.0, 0.65, depth);

  vec2 gridId = floor(uv * scale);
  vec2 gridFrac = fract(uv * scale) - 0.5;

  // Depth-dependent drift: far stars barely move, near stars drift gently
  float driftSpeed = 0.04 + depth * 0.03;
  float driftX = sin(time * driftSpeed + depth * 6.283) * 0.06;
  float driftY = cos(time * driftSpeed * 0.7 + depth * 3.14) * 0.04;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 cellId = gridId + neighbor;

      float s1 = hash(cellId);
      float s2 = hash(cellId + 100.0);
      float s3 = hash(cellId + 200.0);
      float s4 = hash(cellId + 300.0);

      // Size varies with depth: far=small, near=large
      float size = mix(0.2, 0.9, depth) * (0.5 + s1 * 0.5);

      // Brightness varies with depth: far=dim, near=bright
      float baseBright = mix(0.15, 0.7, depth) * (0.4 + s2 * 0.6);

      // Natural twinkling: multi-frequency oscillation for realistic star flicker
      // Some stars twinkle fast, some slow, some barely at all
      float twinkleRate = (0.5 + s3 * 3.0) * 0.667;
      float twinkleDepth = s4 * 0.7;
      float twinkle = 1.0
        + sin(time * twinkleRate + s1 * 6.283) * twinkleDepth * 0.5
        + sin(time * twinkleRate * 1.7 + s2 * 6.283) * twinkleDepth * 0.25
        + sin(time * twinkleRate * 0.3 + s3 * 6.283) * twinkleDepth * 0.15;
      twinkle = max(twinkle, 0.1);

      // Occasional bright flash (rare, like real star scintillation)
      float flash = pow(max(0.0, sin(time * twinkleRate * 1.8 + s4 * 6.283)), 14.0) * 0.4;

      float brightness = baseBright * twinkle + flash;

      // Gentle offset per particle + depth drift
      vec2 offset = vec2(
        sin(time * 0.1 + s1 * 6.283) * 0.04 + driftX,
        cos(time * 0.08 + s2 * 6.283) * 0.03 + driftY
      );

      vec2 p = gridFrac - neighbor - offset;

      float d = length(p);
      float core = smoothstep(size * 0.1, size * 0.015, d);
      float glow = 0.035 * brightness;
      float halo = glow / (d * d + 0.003);
      float pt = core + halo * 0.06;

      // Starry sky color palette: cool whites, blue-whites, rare warm stars
      // Most stars: white to blue-white
      vec3 coolWhite = vec3(0.85, 0.88, 1.0);
      vec3 blueWhite = vec3(0.7, 0.8, 1.0);
      vec3 warmWhite = vec3(1.0, 0.92, 0.8);
      vec3 deepBlue = vec3(0.4, 0.5, 0.8);
      vec3 paleAmber = vec3(1.0, 0.85, 0.6);

      vec3 baseColor = mix(coolWhite, blueWhite, s1 * 0.6);

      // ~15% warm-tinted stars (like real K/M-type stars)
      float warmMask = smoothstep(0.7, 0.8, s1);
      baseColor = mix(baseColor, warmWhite, warmMask * 0.5);

      // ~5% deep blue stars (hot O/B-type)
      float blueMask = smoothstep(0.85, 0.92, s1);
      baseColor = mix(baseColor, deepBlue, blueMask * 0.4);

      // ~3% pale amber stars (red giants)
      float amberMask = smoothstep(0.95, 1.0, s1);
      baseColor = mix(baseColor, paleAmber, amberMask);

      col += pt * baseColor * brightness * fade;
    }
  }

  return col;
}

void main() {
  vec2 uv = (vUv * uResolution.xy - uResolution.xy * 0.5) / uResolution.y;
  float time = uTime;

  vec3 col = vec3(0.0);

  // Deep space background gradient
  float gy = vUv.y;
  col += vec3(0.006, 0.008, 0.02) * (1.0 - gy);
  col += vec3(0.003, 0.005, 0.015) * gy;

  // Subtle nebula clouds
  float n1 = noise(uv * 1.5 + time * 0.02);
  float n2 = noise(uv * 2.5 - time * 0.015 + vec2(50.0));
  float nebula = smoothstep(0.35, 0.75, n1 * 0.6 + n2 * 0.4);
  col += vec3(0.015, 0.02, 0.04) * nebula * 0.3;

  // 5 star layers with depth progression
  for (float i = 0.0; i < 1.0; i += 0.2) {
    float depth = fract(i + time * 0.008);
    vec2 layerUV = uv + vec2(
      sin(time * 0.03 + i * 4.0) * 0.02,
      cos(time * 0.025 + i * 3.0) * 0.015
    );
    col += starLayer(layerUV, depth, time);
  }

  // Shooting stars
  for (float i = 0.0; i < 2.0; i++) {
    float ssSeed = i * 17.37 + 0.5;
    float ssTime = fract(time * 0.012 + hash(vec2(ssSeed, 0.0)));
    float ssX = hash(vec2(ssSeed, 1.0)) * 3.0 - 1.5;
    float ssY = hash(vec2(ssSeed, 2.0)) * 0.5 + 0.1;
    float ssAngle = -0.35 + hash(vec2(ssSeed, 3.0)) * 0.2;
    float ssLen = 0.12 + hash(vec2(ssSeed, 4.0)) * 0.1;

    vec2 ssDir = vec2(cos(ssAngle), sin(ssAngle));
    vec2 ssPos = vec2(ssX, ssY) + ssDir * ssTime * 2.0;
    vec2 ssUV = uv - ssPos;

    float proj = dot(ssUV, ssDir);
    float perp = length(ssUV - ssDir * proj);

    float trail = smoothstep(ssLen, 0.0, -proj) * smoothstep(0.0, ssLen * 0.5, proj);
    trail *= smoothstep(0.003, 0.0, perp);
    trail *= smoothstep(0.0, 0.1, ssTime) * smoothstep(1.0, 0.7, ssTime);

    col += vec3(0.9, 0.92, 1.0) * trail * 0.6;
  }

  // Vignette
  float vignette = 1.0 - length(vUv - 0.5) * 0.55;
  vignette = smoothstep(0.3, 1.0, vignette);
  col *= vignette;

  col *= 1.06;

  float alpha = length(col);
  alpha = smoothstep(0.0, 0.08, alpha);
  alpha = min(alpha, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

export default function ParticleOcean({
  transparent = true,
  ...rest
}: {
  transparent?: boolean;
  [key: string]: unknown;
}) {
  const ctnDom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ctnDom.current) return;
    const ctn = ctnDom.current;

    let renderer;
    try {
      renderer = new Renderer({ alpha: transparent, premultipliedAlpha: false, antialias: false });
    } catch {
      return;
    }

    const gl = renderer.gl;
    if (!gl) return;

    if (transparent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } else {
      gl.clearColor(0, 0, 0, 1);
    }

    let program: Program;

    function resize() {
      const scale = Math.min(window.devicePixelRatio, 1.25);
      renderer.setSize(ctn.offsetWidth * scale, ctn.offsetHeight * scale);
      if (program) {
        program.uniforms.uResolution.value = new Color(
          gl.canvas.width,
          gl.canvas.height,
          gl.canvas.width / gl.canvas.height,
        );
      }
    }
    window.addEventListener("resize", resize, false);
    resize();

    const geometry = new Triangle(gl);
    program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: {
          value: new Color(
            gl.canvas.width,
            gl.canvas.height,
            gl.canvas.width / gl.canvas.height,
          ),
        },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    let animateId: number;
    let lastFrame = 0;
    let frameCount = 0;
    let fpsAccum = 0;
    const targetFps = 60;
    const targetInterval = 1000 / targetFps;
    let adaptiveInterval = targetInterval;

    function update(t: number) {
      animateId = requestAnimationFrame(update);
      const delta = t - lastFrame;
      if (delta < adaptiveInterval) return;

      // Adaptive frame rate: measure actual FPS and adjust
      frameCount++;
      fpsAccum += delta;
      if (fpsAccum >= 1000) {
        const actualFps = frameCount;
        if (actualFps < targetFps - 5) {
          adaptiveInterval = Math.min(adaptiveInterval + 1, 1000 / 30);
        } else if (actualFps > targetFps && adaptiveInterval > targetInterval) {
          adaptiveInterval = Math.max(adaptiveInterval - 0.5, targetInterval);
        }
        frameCount = 0;
        fpsAccum = 0;
      }

      lastFrame = t - (delta % adaptiveInterval);
      program.uniforms.uTime.value = t * 0.001;
      renderer.render({ scene: mesh });
    }
    animateId = requestAnimationFrame(update);
    ctn.appendChild(gl.canvas);

    return () => {
      cancelAnimationFrame(animateId);
      window.removeEventListener("resize", resize);
      if (ctn.contains(gl.canvas)) {
        ctn.removeChild(gl.canvas);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [transparent]);

  return <div ref={ctnDom} className="galaxy-container" {...rest} />;
}
