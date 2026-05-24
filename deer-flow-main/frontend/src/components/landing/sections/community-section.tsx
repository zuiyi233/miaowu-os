"use client";

import { GitHubLogoIcon } from "@radix-ui/react-icons";
import Link from "next/link";

import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";

import { Section } from "../section";

export function CommunitySection() {
  return (
    <Section
      title={
        <AuroraText colors={["#60A5FA", "#A5FA60", "#A560FA"]}>
          Join the Community
        </AuroraText>
      }
      subtitle="Shape the future of Miaowu OS with practical author workflows, integrations, and local-first deployment."
    >
      <div className="flex justify-center">
        <Button className="text-xl" size="lg" asChild>
          <Link
            href="/workspace/novel"
            target="_blank"
            rel="noopener noreferrer"
          >
            <GitHubLogoIcon />
            Open Workspace
          </Link>
        </Button>
      </div>
    </Section>
  );
}
