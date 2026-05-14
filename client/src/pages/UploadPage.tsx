import { useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { UploadItem } from '../components/FileListItem'
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
import { SessionGrid } from '../components/SessionGrid'
import { ThemeToggle } from '../components/ThemeToggle'
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
    <div className="border border-border rounded-xl overflow-hidden h-full flex flex-col bg-surface">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-surface-muted transition-colors"
      >
        {icon}
        <span className="flex-1 text-sm font-medium text-text">{title}</span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-text-dim" />
        ) : (
          <ChevronDown className="w-4 h-4 text-text-dim" />
        )}
      </button>
      {open && <div className="px-5 pb-5 space-y-3 flex-1">{children}</div>}
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
  const [items, setItems] = useState<UploadItem[]>([])

  const removeItem = useCallback((clientId: string) => {
    setItems((prev) => prev.filter((i) => i.clientId !== clientId))
  }, [])

  const { data: acceptedData, isLoading: acceptedLoading } = useQuery({
    queryKey: ['images', 'ACCEPTED'],
    queryFn: () => api.get<ImagesResponse>('/api/images?status=ACCEPTED&limit=50'),
  })
  const { data: rejectedData, isLoading: rejectedLoading } = useQuery({
    queryKey: ['images', 'REJECTED'],
    queryFn: () => api.get<ImagesResponse>('/api/images?status=REJECTED&limit=50'),
  })

  // IDs that are already rendered in the SessionGrid — exclude from historical lists
  const sessionImageIds = useMemo(
    () => new Set(items.flatMap((i) => [i.pendingId, i.result?.id]).filter(Boolean) as string[]),
    [items]
  )

  const accepted = (acceptedData?.items ?? []).filter((img) => !sessionImageIds.has(img.id))
  const rejected = (rejectedData?.items ?? []).filter((img) => !sessionImageIds.has(img.id))

  const sessionCount = items.filter((i) => i.status !== 'error').length
  const total = accepted.length + rejected.length + sessionCount
  const target = Math.max(total, 10)
  const progressPct = target === 0 ? 0 : Math.round(
    (accepted.length + items.filter((i) => i.result?.status === 'ACCEPTED').length) / target * 100
  )
  const isGreen = progressPct >= 80

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-background transition-colors duration-300">
      {/* ── Left panel ── */}
      <aside className="w-full md:w-80 h-full md:shrink-0 flex flex-col border-b md:border-b-0 md:border-r border-border bg-surface-muted/50 overflow-hidden">
        <div className="p-6 pb-0 flex flex-col gap-6">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="badge-atlas py-1">
                <div className="w-1 h-1 rounded-full bg-accent" />
                Aragon AI
              </div>
              <ThemeToggle />
            </div>
            <h1 className="text-xl font-semibold text-text leading-tight">Upload photos</h1>
            <p className="mt-2 text-sm text-text-dim leading-relaxed">
              Now the fun begins! Select at least{' '}
              <strong className="text-text font-semibold">6 of your best photos.</strong>{' '}
              Uploading a mix of close-ups, selfies and mid-range shots can help the AI better
              capture your face and body type.
            </p>
          </div>
        </div>

        <div className="flex-1 min-h-0">
          <UploadDropzone items={items} setItems={setItems} />
        </div>
      </aside>

      {/* ── Right panel ── */}
      <main className="flex-1 h-full md:overflow-y-auto">
        {/* Progress bar — sticky on desktop */}
        <div className="md:sticky top-0 z-10 bg-background/90 backdrop-blur-sm border-b border-border py-4">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 flex items-center gap-3 sm:gap-4">
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

        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-6 space-y-10">
          {/* Unified Guidelines — Top Position for Layout Stability */}
          <Collapsible
            title="Photo Guidelines"
            icon={<ShieldX className="w-5 h-5 text-accent shrink-0" />}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-2">
              <div className="space-y-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 flex items-center gap-2">
                  <CircleCheck className="w-3 h-3" /> Requirements
                </p>
                <div className="space-y-3">
                  <Requirement icon={<Sun className="w-4 h-4" />} text="Clear, well-lit with face visible" />
                  <Requirement icon={<UserRound className="w-4 h-4" />} text="Single person per photo" />
                  <Requirement icon={<ScanFace className="w-4 h-4" />} text="Face clearly occupies the frame" />
                  <Requirement icon={<Maximize2 className="w-4 h-4" />} text="At least 800×800px and 50KB" />
                  <Requirement icon={<FileImage className="w-4 h-4" />} text="JPEG, PNG, or HEIC format" />
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 flex items-center gap-2">
                  <ShieldX className="w-3 h-3" /> Restrictions
                </p>
                <div className="space-y-3">
                  <Restriction icon={<EyeOff className="w-4 h-4" />} text="No blurry or out-of-focus photos" />
                  <Restriction icon={<Users className="w-4 h-4" />} text="No photos with multiple people" />
                  <Restriction icon={<Fingerprint className="w-4 h-4" />} text="No duplicate or very similar photos" />
                  <Restriction icon={<Minimize2 className="w-4 h-4" />} text="No images smaller than 800×800px" />
                </div>
              </div>
            </div>
          </Collapsible>

          <div className="space-y-8 min-h-[400px]">
            {/* Session uploads — all slots fixed in upload order, appearance changes in-place */}
            <SessionGrid items={items} onItemDeleted={removeItem} />

            {/* Historical accepted — images from before this session */}
            <AcceptedGrid images={accepted} isLoading={acceptedLoading} />

            {/* Historical rejected */}
            <RejectedGrid
              images={rejected}
              isLoading={rejectedLoading}
              acceptedCount={accepted.length + items.filter((i) => i.result?.status === 'ACCEPTED').length}
            />

            {/* Empty state */}
            {!acceptedLoading && !rejectedLoading && total === 0 && items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-surface-muted flex items-center justify-center mb-4 border border-border">
                  <FileImage className="w-7 h-7 text-text-dim" />
                </div>
                <p className="text-sm font-medium text-text">No images yet</p>
                <p className="text-xs text-text-mute mt-1 max-w-xs mx-auto">
                  Upload your best portrait photos from the panel on the left to get started
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
