/** Wordmark switches automatically with system light/dark preference. */
export function FolupWordmark({
  className,
  imgClassName,
}: {
  className?: string
  imgClassName?: string
}) {
  return (
    <picture className={className}>
      <source srcSet="/logo-dark.png" media="(prefers-color-scheme: dark)" />
      <img src="/logo.png" alt="Folup" className={imgClassName} />
    </picture>
  )
}

/** Square app icon for chrome bars, nav affordances. */
export function FolupAppIcon({ className }: { className?: string }) {
  return (
    <img
      src="/icon.png"
      alt=""
      width={28}
      height={28}
      decoding="async"
      className={className ?? 'h-7 w-7 shrink-0 object-contain'}
      aria-hidden
    />
  )
}
