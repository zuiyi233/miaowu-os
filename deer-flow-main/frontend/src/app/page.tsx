import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { Hero } from "@/components/landing/hero";
import { CoreFeaturesSection } from "@/components/landing/sections/core-features-section";
import { NovelShowcaseSection } from "@/components/landing/sections/novel-showcase-section";
import { TechStackSection } from "@/components/landing/sections/tech-stack-section";
import { GlobeSection } from "@/components/landing/sections/globe-section";
import ParticleOcean from "@/components/ui/particle-ocean";
import { OceanFlow } from "@/components/ui/ocean-flow";

export default function LandingPage() {
  return (
    <div className="relative min-h-screen w-full bg-[#050508]">
      {/* GPU-accelerated particle ocean background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <ParticleOcean transparent={true} />
      </div>

      {/* CSS color flow background - ocean blues diagonal flow */}
      <div className="pointer-events-none fixed inset-0 z-[1]">
        <OceanFlow />
      </div>

      {/* Gradient overlay for text readability */}
      <div className="pointer-events-none fixed inset-0 z-[2] bg-gradient-to-b from-black/50 via-transparent to-black/70" />

      <Header />
      <main className="relative z-10 flex w-full flex-col">
        <Hero />
        <CoreFeaturesSection />
        <NovelShowcaseSection />
        <GlobeSection />
        <TechStackSection />
      </main>
      <Footer />
    </div>
  );
}
