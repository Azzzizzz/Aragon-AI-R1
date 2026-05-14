import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronUp,
  CircleCheck,
  ShieldX,
  Sun,
  UserRound,
  ScanFace,
  Maximize2,
  FileImage,
  EyeOff,
  Users,
  Fingerprint,
  Minimize2,
} from 'lucide-react'
import { api } from '../lib/api'
import { UploadDropzone } from '../components/UploadDropzone'
import { AcceptedGrid } from '../components/AcceptedGrid'
import { RejectedGrid } from '../components/RejectedGrid'
import type { ImagesResponse } from '../types'

function Collapsible({
  title,
  icon,
  children,
  defaultOpen = false,
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-surface transition-colors"
      >
        {icon}
        <span className="flex-1 text-sm font-medium text-text">{title}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-text-dim" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-dim" />
        )}
      </button>
      {open && <div className="px-5 pb-5 space-y-3">{children}</div>}
    </div>
  )
}

function Requirement({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-text-dim">
      <span className="text-green-500 mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

function Restriction({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2.5 text-sm text-text-dim">
      <span className="text-red-400 mt-0.5 shrink-0">{icon}</span>
      <span>{text}</span>
    </div>
  )
}

export function UploadPage() {
  const { data: acceptedData, isLoading: acceptedLoading } = useQuery({
    queryKey: ['images', 'ACCEPTED'],
    queryFn: () => api.get<ImagesResponse>('/api/images?status=ACCEPTED&limit=50'),
  })
  const { data: rejectedData, isLoading: rejectedLoading } = useQuery({
    queryKey: ['images', 'REJECTED'],
    queryFn: () => api.get<ImagesResponse>('/api/images?status=REJECTED&limit=50'),
  })

  const accepted = acceptedData?.items ?? []
  const rejected = rejectedData?.items ?? []
  const total = accepted.length + rejected.length
  const target = Math.max(total, 10)
  const progressPct = target === 0 ? 0 : Math.round((accepted.length / target) * 100)
  const isGreen = progressPct >= 80

  return (
    <div className="flex flex-col md:flex-row md:h-screen">
      {/* ── Left panel ── */}
      <aside className="w-full md:w-80 md:shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-border md:overflow-y-auto p-6 gap-6">
        <div>
          <div className="badge-atlas w-fit mb-4 py-1">
            <div className="w-1 h-1 rounded-full bg-accent" />
            Aragon AI
          </div>
          <h1 className="text-xl font-semibold text-text leading-tight">Upload photos</h1>
          <p className="mt-2 text-sm text-text-dim leading-relaxed">
            Now the fun begins! Select at least{' '}
            <strong className="text-text font-semibold">6 of your best photos.</strong>{' '}
            Uploading a mix of close-ups, selfies and mid-range shots can help the AI better
            capture your face and body type.
          </p>
        </div>

        <UploadDropzone />
      </aside>

      {/* ── Right panel ── */}
      <main className="flex-1 md:overflow-y-auto">
        {/* Progress bar — sticky on desktop */}
        <div className="md:sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border px-4 sm:px-6 md:px-8 py-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <span className="text-sm font-medium text-text shrink-0">Uploaded Images</span>
            <div className="flex-1 h-2 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${progressPct}%`,
                  background: isGreen
                    ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                    : 'linear-gradient(90deg, #ef4444, #f97316, #eab308)',
                }}
              />
            </div>
            <span className="text-sm text-text-dim shrink-0 tabular-nums">
              {accepted.length}{' '}
              <span className="text-text-mute">of {target}</span>
            </span>
          </div>
        </div>

        <div className="px-4 sm:px-6 md:px-8 py-6 space-y-8">
          {/* Accepted grid */}
          <AcceptedGrid images={accepted} isLoading={acceptedLoading} />

          {/* Rejected section */}
          <RejectedGrid
            images={rejected}
            isLoading={rejectedLoading}
            acceptedCount={accepted.length}
          />

          {/* Empty state */}
          {!acceptedLoading && !rejectedLoading && total === 0 && (
            <div className="flex flex-col items-center justify-center py-16 sm:py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-surface flex items-center justify-center mb-4">
                <FileImage className="w-7 h-7 text-text-dim" />
              </div>
              <p className="text-sm font-medium text-text-dim">No images yet</p>
              <p className="text-xs text-text-mute mt-1 max-w-xs">
                Upload your best portrait photos from the panel on the left
              </p>
            </div>
          )}

          {/* Requirements + restrictions */}
          <div className="space-y-3 pt-4 border-t border-border">
            <Collapsible
              title="Photo Requirements"
              icon={<CircleCheck className="w-5 h-5 text-green-500 shrink-0" />}
              defaultOpen
            >
              <Requirement icon={<Sun className="w-4 h-4" />} text="Clear, well-lit with face visible" />
              <Requirement icon={<UserRound className="w-4 h-4" />} text="Single person per photo" />
              <Requirement icon={<ScanFace className="w-4 h-4" />} text="Face clearly occupies the frame" />
              <Requirement icon={<Maximize2 className="w-4 h-4" />} text="At least 800×800px and 50KB" />
              <Requirement icon={<FileImage className="w-4 h-4" />} text="JPEG, PNG, or HEIC format" />
            </Collapsible>

            <Collapsible
              title="Photo Restrictions"
              icon={<ShieldX className="w-5 h-5 text-red-400 shrink-0" />}
            >
              <Restriction icon={<EyeOff className="w-4 h-4" />} text="No blurry or out-of-focus photos" />
              <Restriction icon={<Users className="w-4 h-4" />} text="No photos with multiple people" />
              <Restriction icon={<Fingerprint className="w-4 h-4" />} text="No duplicate or very similar photos" />
              <Restriction icon={<Minimize2 className="w-4 h-4" />} text="No images smaller than 800×800px" />
            </Collapsible>
          </div>
        </div>
      </main>
    </div>
  )
}
