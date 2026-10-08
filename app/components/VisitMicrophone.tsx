'use client'
import type {Ref} from 'react'
export default function VisitMicrophone({isRecording,processingBusy=false,disabled=false,onClick,buttonRef}:{isRecording:boolean;processingBusy?:boolean;disabled?:boolean;onClick:()=>void;buttonRef?:Ref<HTMLButtonElement>}) {
  return (              <button
                ref={buttonRef}
                onClick={onClick}
                aria-label={isRecording ? 'Stop recording' : 'Record visit'}
                disabled={disabled}
                className="relative z-[1] mb-2 flex h-36 w-36 shrink-0 items-center justify-center rounded-full transition-[transform,box-shadow] duration-200 ease-out active:scale-[0.94] disabled:pointer-events-none disabled:active:scale-100"
                style={{
                  backgroundColor: isRecording ? '#dc2626' : '#4F46E5',
                  boxShadow: isRecording
                    ? '0 8px 32px rgba(220,38,38,0.22), 0 2px 10px rgba(220,38,38,0.11), 0 0 0 1px rgba(220,38,38,0.08)'
                    : '0 12px 40px rgba(79,70,229,0.2), 0 4px 14px rgba(79,70,229,0.11), 0 0 0 1px rgba(79,70,229,0.08)',
                  transform: isRecording ? 'scale(1.01)' : 'scale(1)',
                }}
              >
                {!isRecording && !processingBusy && (
                  <span
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{ animation: 'mic-idle-glow 3s ease-in-out infinite' }}
                    aria-hidden
                  />
                )}
                {isRecording && (
                  <span
                    className="pointer-events-none absolute rounded-full"
                    style={{
                      inset: '-4px',
                      animation: 'mic-ring-pulse 2.5s ease-in-out infinite',
                      border: '1px solid rgba(248,113,113,0.32)',
                      boxShadow: '0 0 16px 0 rgba(220,38,38,0.07)',
                    }}
                    aria-hidden
                  />
                )}
                <svg width="46" height="46" viewBox="0 0 24 24" fill="white">
                  <path d="M12 1a4 4 0 0 1 4 4v6a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4z"/>
                  <path d="M19 10a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V19H9a1 1 0 0 0 0 2h6a1 1 0 0 0 0-2h-2v-2.08A7 7 0 0 0 19 10z"/>
                </svg>
              </button>
  )
}
