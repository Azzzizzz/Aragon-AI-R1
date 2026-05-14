import { useMemo, useEffect } from 'react'
import { XCircle } from 'lucide-react'
import { ImageCard } from './ImageCard'
import type { UploadItem } from './FileListItem'

const STAGE_PCT: Record<string, number> = {
  requesting: 20,
  uploading: 55,
  validating: 85,
}

function CircularProgress({ pct }: { pct: number }) {
  const r = 22
  const circ = 2 * Math.PI * r
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" className="drop-shadow-sm">
      {/* track */}
      <circle cx="28" cy="28" r={r} fill="none" stroke="white" strokeOpacity={0.2} strokeWidth="3.5" />
      {/* fill */}
      <circle
        cx="28" cy="28" r={r}
        fill="none"
        stroke="white"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct / 100)}
        transform="rotate(-90 28 28)"
        style={{ transition: 'stroke-dashoffset 0.7s ease' }}
      />
    </svg>
  )
}

// Local preview + circular progress — shown while upload/validation is in progress
function ProcessingCard({ item }: { item: UploadItem }) {
  const previewUrl = useMemo(() => URL.createObjectURL(item.file), [item.file])
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])

  const pct = STAGE_PCT[item.status] ?? 20
  const label =
    item.status === 'validating' ? 'Validating…'
    : item.status === 'uploading' ? 'Uploading…'
    : 'Preparing…'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative rounded-xl overflow-hidden aspect-square bg-surface border border-border">
        <img src={previewUrl} alt={item.file.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
          <CircularProgress pct={pct} />
          <span className="text-[11px] font-medium text-white tracking-wide">{label}</span>
        </div>
      </div>
      <p className="text-xs text-center text-text-mute truncate px-1">{item.file.name}</p>
    </div>
  )
}

// Error slot — keeps the grid position stable instead of collapsing it
function ErrorCard({ item }: { item: UploadItem }) {
  const previewUrl = useMemo(() => URL.createObjectURL(item.file), [item.file])
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative rounded-xl overflow-hidden aspect-square bg-surface border border-red-500/40">
        <img src={previewUrl} alt={item.file.name} className="w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-3">
          <XCircle className="w-5 h-5 text-red-400" />
          <span className="text-[11px] font-medium text-red-400 text-center leading-tight">
            {item.error ?? 'Upload failed'}
          </span>
        </div>
      </div>
      <p className="text-xs text-center text-text-mute truncate px-1">{item.file.name}</p>
    </div>
  )
}

// One slot in the unified grid — renders whichever card matches current state
function SessionCard({
  item,
  onDeleted,
}: {
  item: UploadItem
  onDeleted: () => void
}) {
  if (item.status === 'requesting' || item.status === 'uploading' || item.status === 'validating') {
    return <ProcessingCard item={item} />
  }

  if (item.status === 'error') {
    return <ErrorCard item={item} />
  }

  // success + accepted — keep in place
  if (item.status === 'success' && item.result?.status === 'ACCEPTED') {
    return <ImageCard image={item.result} onDeleted={onDeleted} />
  }

  // rejected or duplicate — slot collapses (rejected moves to RejectedGrid via UploadPage)
  return null
}

interface Props {
  items: UploadItem[]
  onItemDeleted: (clientId: string) => void
}

export function SessionGrid({ items, onItemDeleted }: Props) {
  if (items.length === 0) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {items.map((item) => (
        <SessionCard
          key={item.clientId}
          item={item}
          onDeleted={() => onItemDeleted(item.clientId)}
        />
      ))}
    </div>
  )
}
