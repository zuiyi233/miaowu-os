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
uniform vec2 uFocal;
uniform vec2 uRotation;
uniform float uStarSpeed;
uniform float uDensity;
uniform float uHueShift;
uniform float uSpeed;
uniform vec2 uMouse;
uniform float uGlowIntensity;
uniform float uSaturation;
uniform bool uMouseRepulsion;
uniform float uTwinkleIntensity;
uniform float uRotationSpeed;
uniform float uRepulsionStrength;
uniform float uMouseActiveFactor;
uniform float uAutoCenterRepulsion;
uniform bool uTransparent;
uniform float uWaveIntensity;
uniform float uWaveSpeed;
uniform float uWaveFrequency;
uniform float uParticleCount;
uniform float uNebulaIntensity;

varying vec2 vUv;

#define NUM_LAYER 6.0
#define STAR_COLOR_CUTOFF 0.2
#define MAT45 mat2(0.7071, -0.7071, 0.7071, 0.7071)
#define PERIOD 3.0
#define PI 3.14159265359

float Hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float Hash11(float p) {
  return fract(sin(p * 127.1) * 43758.5453);
}

float tri(float x) {
  return abs(fract(x) * 2.0 - 1.0);
}

float tris(float x) {
  float t = fract(x);
  return 1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0));
}

float trisn(float x) {
  float t = fract(x);
  return 2.0 * (1.0 - smoothstep(0.0, 1.0, abs(2.0 * t - 1.0))) - 1.0;
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Simplex noise functions for wave effects
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                     -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v -   i + dot(i, C.xx);
  vec2 i1;
  i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
    dot(x12.zw,x12.zw)), 0.0);
  m = m*m;
  m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 1.0;
  for (int i = 0; i < 5; i++) {
    value += amplitude * snoise(p * frequency);
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value;
}

float Star(vec2 uv, float flare) {
  float d = length(uv);
  float m = (0.05 * uGlowIntensity) / d;
  float rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * flare * uGlowIntensity;
  uv *= MAT45;
  rays = smoothstep(0.0, 1.0, 1.0 - abs(uv.x * uv.y * 1000.0));
  m += rays * 0.3 * flare * uGlowIntensity;
  m *= smoothstep(1.0, 0.2, d);
  return m;
}

// Nebula cloud effect
float Nebula(vec2 uv, float time) {
  float n1 = fbm(uv * 2.0 + time * 0.1);
  float n2 = fbm(uv * 3.0 - time * 0.15 + vec2(5.2, 1.3));
  float n3 = fbm(uv * 1.5 + time * 0.08 + vec2(1.7, 9.2));
  float nebula = n1 * 0.5 + n2 * 0.3 + n3 * 0.2;
  nebula = smoothstep(-0.2, 0.6, nebula);
  return nebula;
}

vec3 StarLayer(vec2 uv, float layerDepth) {
  vec3 col = vec3(0.0);

  vec2 gv = fract(uv) - 0.5;
  vec2 id = floor(uv);

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y));
      vec2 si = id + vec2(float(x), float(y));
      float seed = Hash21(si);
      float size = fract(seed * 345.32);
      float glossLocal = tri(uStarSpeed / (PERIOD * seed + 1.0));
      float flareSize = smoothstep(0.9, 1.0, size) * glossLocal;

      float red = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 1.0)) + STAR_COLOR_CUTOFF;
      float blu = smoothstep(STAR_COLOR_CUTOFF, 1.0, Hash21(si + 3.0)) + STAR_COLOR_CUTOFF;
      float grn = min(red, blu) * seed;
      vec3 base = vec3(red, grn, blu);

      float hue = atan(base.g - base.r, base.b - base.r) / (2.0 * PI) + 0.5;
      hue = fract(hue + uHueShift / 360.0);
      float sat = length(base - vec3(dot(base, vec3(0.299, 0.587, 0.114)))) * uSaturation;
      float val = max(max(base.r, base.g), base.b);
      base = hsv2rgb(vec3(hue, sat, val));

      // Wave motion for particles - flowing like ocean
      float waveTime = uTime * uWaveSpeed;
      float waveX = sin(waveTime + seed * 6.2831 + si.x * 0.1) * uWaveIntensity * 0.3;
      float waveY = cos(waveTime * 0.7 + seed * 4.2831 + si.y * 0.1) * uWaveIntensity * 0.3;
      float waveZ = sin(waveTime * 1.3 + seed * 8.2831 + (si.x + si.y) * 0.05) * uWaveIntensity * 0.2;

      vec2 pad = vec2(
        tris(seed * 34.0 + uTime * uSpeed / 10.0) - 0.5 + waveX,
        tris(seed * 38.0 + uTime * uSpeed / 30.0) - 0.5 + waveY
      );

      float star = Star(gv - offset - pad, flareSize);
      vec3 color = base;

      // Enhanced twinkle with wave modulation
      float twinkle = trisn(uTime * uSpeed + seed * 6.2831 + waveZ * 2.0) * 0.5 + 1.0;
      twinkle = mix(1.0, twinkle, uTwinkleIntensity);
      star *= twinkle;

      // Layer-based color temperature shift
      float tempShift = layerDepth * 0.1;
      color.r += tempShift * 0.2;
      color.b -= tempShift * 0.1;

      col += star * size * color;
    }
  }

  return col;
}

void main() {
  vec2 focalPx = uFocal * uResolution.xy;
  vec2 uv = (vUv * uResolution.xy - focalPx) / uResolution.y;

  vec2 mouseNorm = uMouse - vec2(0.5);

  if (uAutoCenterRepulsion > 0.0) {
    vec2 centerUV = vec2(0.0, 0.0);
    float centerDist = length(uv - centerUV);
    vec2 repulsion = normalize(uv - centerUV) * (uAutoCenterRepulsion / (centerDist + 0.1));
    uv += repulsion * 0.05;
  } else if (uMouseRepulsion) {
    vec2 mousePosUV = (uMouse * uResolution.xy - focalPx) / uResolution.y;
    float mouseDist = length(uv - mousePosUV);
    vec2 repulsion = normalize(uv - mousePosUV) * (uRepulsionStrength / (mouseDist + 0.1));
    uv += repulsion * 0.05 * uMouseActiveFactor;
  } else {
    vec2 mouseOffset = mouseNorm * 0.1 * uMouseActiveFactor;
    uv += mouseOffset;
  }

  float autoRotAngle = uTime * uRotationSpeed;
  mat2 autoRot = mat2(cos(autoRotAngle), -sin(autoRotAngle), sin(autoRotAngle), cos(autoRotAngle));
  uv = autoRot * uv;

  vec3 col = vec3(0.0);

  // Nebula background clouds
  float nebula = Nebula(uv * 0.5 + uTime * 0.02, uTime);
  vec3 nebulaColor = hsv2rgb(vec3(
    fract(0.08 + uHueShift / 360.0 + nebula * 0.1),
    0.4 * uSaturation,
    nebula * 0.15 * uNebulaIntensity
  ));
  col += nebulaColor;

  // Star layers with wave motion
  for (float i = 0.0; i < 1.0; i += 1.0 / NUM_LAYER) {
    float depth = fract(i + uStarSpeed * uSpeed);
    float scale = mix(25.0 * uDensity, 0.8 * uDensity, depth);
    float fade = depth * smoothstep(1.0, 0.9, depth);

    // Wave displacement per layer
    float layerWave = sin(uTime * uWaveSpeed * 0.5 + i * PI * 2.0) * uWaveIntensity * 0.1;
    vec2 waveOffset = vec2(
      sin(uTime * uWaveSpeed * 0.3 + i * 2.0) * uWaveIntensity * 0.15,
      cos(uTime * uWaveSpeed * 0.4 + i * 1.5) * uWaveIntensity * 0.15
    );

    vec2 layerUV = uv * scale + i * 453.32 + waveOffset;
    col += StarLayer(layerUV, depth) * fade * (1.0 + layerWave);
  }

  // Shooting stars
  float shootingStar = 0.0;
  for (float i = 0.0; i < 3.0; i++) {
    float ssSeed = i * 7.37;
    float ssTime = fract(uTime * 0.05 * uSpeed + Hash11(ssSeed));
    float ssX = Hash11(ssSeed + 1.0) * 4.0 - 2.0;
    float ssY = Hash11(ssSeed + 2.0) * 2.0 - 1.0;
    float ssAngle = Hash11(ssSeed + 3.0) * PI * 0.5 + PI * 0.25;
    float ssSpeed = 2.0 + Hash11(ssSeed + 4.0) * 2.0;

    vec2 ssPos = vec2(
      ssX + cos(ssAngle) * ssTime * ssSpeed,
      ssY + sin(ssAngle) * ssTime * ssSpeed
    );
    vec2 ssUV = uv - ssPos;
    float ssDist = length(ssUV);
    float ssTrail = smoothstep(0.0, 0.02, ssDist) * smoothstep(0.15, 0.0, ssDist);
    ssTrail *= smoothstep(0.0, 0.1, ssTime) * smoothstep(1.0, 0.8, ssTime);
    shootingStar += ssTrail * uGlowIntensity * 2.0;
  }
  col += vec3(1.0, 0.95, 0.8) * shootingStar;

  if (uTransparent) {
    float alpha = length(col);
    alpha = smoothstep(0.0, 0.3, alpha);
    alpha = min(alpha, 1.0);
    gl_FragColor = vec4(col, alpha);
  } else {
    gl_FragColor = vec4(col, 1.0);
  }
}
`;

export default function GalaxyEnhanced({
  focal = [0.5, 0.5],
  rotation = [1.0, 0.0],
  starSpeed = 0.5,
  density = 1,
  hueShift = 140,
  disableAnimation = false,
  speed = 1.0,
  mouseInteraction = true,
  glowIntensity = 0.3,
  saturation = 0.0,
  mouseRepulsion = true,
  repulsionStrength = 2,
  twinkleIntensity = 0.3,
  rotationSpeed = 0.1,
  autoCenterRepulsion = 0,
  transparent = true,
  waveIntensity = 0.5,
  waveSpeed = 0.3,
  waveFrequency = 2.0,
  nebulaIntensity = 0.6,
  ...rest
}) {
  const ctnDom = useRef(null);
  const targetMousePos = useRef({ x: 0.5, y: 0.5 });
  const smoothMousePos = useRef({ x: 0.5, y: 0.5 });
  const targetMouseActive = useRef(0.0);
  const smoothMouseActive = useRef(0.0);

  useEffect(() => {
    if (!ctnDom.current) return;
    const ctn = ctnDom.current;

    let renderer;
    try {
      renderer = new Renderer({
        alpha: transparent,
        premultipliedAlpha: false,
      });
    } catch (error) {
      console.warn(
        "GalaxyEnhanced: WebGL is not available. The galaxy background will not be rendered.",
        error,
      );
      return;
    }

    const gl = renderer.gl;
    if (!gl) {
      console.warn(
        "GalaxyEnhanced: WebGL context is null. The galaxy background will not be rendered.",
      );
      return;
    }

    if (transparent) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
    } else {
      gl.clearColor(0, 0, 0, 1);
    }

    /** @type {Program | undefined} */
    let program;

    function resize() {
      const scale = Math.min(window.devicePixelRatio, 1.5);
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
        uFocal: { value: new Float32Array(focal) },
        uRotation: { value: new Float32Array(rotation) },
        uStarSpeed: { value: starSpeed },
        uDensity: { value: density },
        uHueShift: { value: hueShift },
        uSpeed: { value: speed },
        uMouse: {
          value: new Float32Array([
            smoothMousePos.current.x,
            smoothMousePos.current.y,
          ]),
        },
        uGlowIntensity: { value: glowIntensity },
        uSaturation: { value: saturation },
        uMouseRepulsion: { value: mouseRepulsion },
        uTwinkleIntensity: { value: twinkleIntensity },
        uRotationSpeed: { value: rotationSpeed },
        uRepulsionStrength: { value: repulsionStrength },
        uMouseActiveFactor: { value: 0.0 },
        uAutoCenterRepulsion: { value: autoCenterRepulsion },
        uTransparent: { value: transparent },
        uWaveIntensity: { value: waveIntensity },
        uWaveSpeed: { value: waveSpeed },
        uWaveFrequency: { value: waveFrequency },
        uNebulaIntensity: { value: nebulaIntensity },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    let animateId;

    function update(t) {
      animateId = requestAnimationFrame(update);
      if (!disableAnimation) {
        program.uniforms.uTime.value = t * 0.001;
        program.uniforms.uStarSpeed.value = (t * 0.001 * starSpeed) / 10.0;
      }

      const lerpFactor = 0.05;
      smoothMousePos.current.x +=
        (targetMousePos.current.x - smoothMousePos.current.x) * lerpFactor;
      smoothMousePos.current.y +=
        (targetMousePos.current.y - smoothMousePos.current.y) * lerpFactor;

      smoothMouseActive.current +=
        (targetMouseActive.current - smoothMouseActive.current) * lerpFactor;

      program.uniforms.uMouse.value[0] = smoothMousePos.current.x;
      program.uniforms.uMouse.value[1] = smoothMousePos.current.y;
      program.uniforms.uMouseActiveFactor.value = smoothMouseActive.current;

      renderer.render({ scene: mesh });
    }
    animateId = requestAnimationFrame(update);
    ctn.appendChild(gl.canvas);

    function handleMouseMove(e) {
      const rect = ctn.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      targetMousePos.current = { x, y };
      targetMouseActive.current = 1.0;
    }

    function handleMouseLeave() {
      targetMouseActive.current = 0.0;
    }

    if (mouseInteraction) {
      ctn.addEventListener("mousemove", handleMouseMove);
      ctn.addEventListener("mouseleave", handleMouseLeave);
    }

    return () => {
      cancelAnimationFrame(animateId);
      window.removeEventListener("resize", resize);
      if (mouseInteraction) {
        ctn.removeEventListener("mousemove", handleMouseMove);
        ctn.removeEventListener("mouseleave", handleMouseLeave);
      }
      ctn.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [
    focal,
    rotation,
    starSpeed,
    density,
    hueShift,
    disableAnimation,
    speed,
    mouseInteraction,
    glowIntensity,
    saturation,
    mouseRepulsion,
    twinkleIntensity,
    rotationSpeed,
    repulsionStrength,
    autoCenterRepulsion,
    transparent,
    waveIntensity,
    waveSpeed,
    waveFrequency,
    nebulaIntensity,
  ]);

  return <div ref={ctnDom} className="galaxy-container" {...rest} />;
}
