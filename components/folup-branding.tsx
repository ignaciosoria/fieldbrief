/** Folup lockup; default `/logo.png`. Use `src` for login asset `/folup_logo.png`. */
export function FolupLogo({
  src = '/logo.png',
  width = 278,
  height = 108,
  className,
  imgClassName,
}: {
  src?: string
  width?: number
  height?: number
  className?: string
  imgClassName?: string
}) {
  const imgClasses = ['bg-transparent object-contain', imgClassName].filter(Boolean).join(' ')
  return (
    <span className={['bg-transparent', className].filter(Boolean).join(' ')}>
      <img
        src={src}
        alt="Folup"
        width={width}
        height={height}
        decoding="async"
        className={imgClasses}
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
      className={className ?? 'h-7 w-7 shrink-0 bg-transparent object-contain'}
      aria-hidden
    />
  )
}
