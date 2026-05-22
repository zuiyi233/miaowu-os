import { cn } from "@/lib/utils";

export function SettingsSection({
  className,
  title,
  description,
  children,
}: {
  className?: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <header>
        <div className="text-base font-semibold">{title}</div>
        {description && (
          <div className="text-muted-foreground text-sm mt-1">{description}</div>
        )}
      </header>
      <main>{children}</main>
    </section>
  );
}
