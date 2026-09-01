import Link from "next/link";

/**
 * Horizon's split sign-in: the form on the left, a brand panel on the right
 * carrying a single oversized corner radius.
 *
 * The panel is decoration and disappears below `lg` rather than stacking —
 * on a phone it would push the form, which is the only thing anyone came
 * here for, below the fold.
 */
export function AuthLayout({
  heading,
  lede,
  children,
  footer,
}: {
  heading: string;
  lede: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh">
      <main className="flex w-full flex-col justify-center px-6 py-12 sm:px-10 lg:w-[52%] lg:px-16 xl:px-24">
        <div className="mx-auto w-full max-w-[420px]">
          <Link href="/login" className="mb-10 block text-2xl font-bold tracking-tight">
            Evo<span className="text-primary">Tasks</span>
          </Link>

          <h1 className="mb-2 text-3xl font-bold tracking-tight sm:text-4xl">{heading}</h1>
          <p className="mb-8 text-base text-muted-foreground">{lede}</p>

          {children}

          {footer ? <div className="mt-6 text-sm text-muted-foreground">{footer}</div> : null}
        </div>
      </main>

      <aside
        aria-hidden
        className="relative hidden w-[48%] overflow-hidden lg:block lg:rounded-bl-[120px] xl:rounded-bl-[200px]"
        style={{
          backgroundImage: "linear-gradient(135deg, var(--brand-from), var(--brand-to))",
        }}
      >
        {/* Two soft blooms, so the panel is not a flat rectangle of violet. */}
        <div className="absolute -left-24 top-[-10%] h-[420px] w-[420px] rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 right-[-10%] h-[460px] w-[460px] rounded-full bg-white/10 blur-3xl" />

        <div className="relative flex h-full flex-col justify-end p-14 xl:p-20">
          <p className="max-w-sm text-3xl font-bold leading-tight tracking-tight text-white xl:text-4xl">
            The jobs that repeat, and whether they actually got done.
          </p>
          <p className="mt-4 max-w-sm text-base text-white/70">
            Evolution Golf
          </p>
        </div>
      </aside>
    </div>
  );
}
