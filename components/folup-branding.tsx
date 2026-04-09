/** Full Folup lockup (`/logo.png`) — navbar and login only; `object-contain`, no dark swap (wordmark must stay visible on white). */
export function FolupLogo({
  className,
  imgClassName,
}: {
  className?: string
  imgClassName?: string
}) {
  return (
    <span className={className}>
      <img
        src="/logo.png"
        alt="Folup"
        width={278}
        height={108}
        decoding="async"
        className={imgClassName}
      />
    </span>
  )
}

/** Small square UI icon (`/icon_32.png`). */
export function FolupAppIcon({ className }: { className?: string }) {
  return (
    <img
      src="/icon_32.png"
      alt=""
      width={32}
      height={32}
      decoding="async"
      className={className ?? 'h-7 w-7 shrink-0 object-contain'}
      aria-hidden
    />
  )
}
