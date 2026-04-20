import { cn } from "@/lib/utils";

export function Section({
  title,
  subtitle,
  children,
  className,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "relative w-full py-20",
        className,
      )}
    >
      {/* Section separator - subtle glow line */}
      <div className="pointer-events-none absolute top-0 left-1/2 h-px w-1/2 -translate-x-1/2 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="container-md relative mx-auto px-4 md:px-20">
        {title && (
          <h2 className="text-center text-3xl font-bold text-white/90">
            {title}
          </h2>
        )}
        {subtitle && (
          <p className="text-muted-foreground mt-2 text-center text-lg">
            {subtitle}
          </p>
        )}
        {children}
      </div>
    </section>
  );
}
