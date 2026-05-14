import { useMemo, useEffect } from 'react'
import { Loader2, XCircle } from 'lucide-react'
import { ImageCard } from './ImageCard'
import type { UploadItem } from './FileListItem'

// Local preview + spinner — shown while upload/validation is in progress
function ProcessingCard({ item }: { item: UploadItem }) {
  const previewUrl = useMemo(() => URL.createObjectURL(item.file), [item.file])
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])

  const label =
    item.status === 'validating' ? 'Validating…'
    : item.status === 'uploading' ? 'Uploading…'
    : 'Preparing…'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative rounded-xl overflow-hidden aspect-square bg-surface border border-border">
        <img src={previewUrl} alt={item.file.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
          <span className="text-[11px] font-medium text-accent tracking-wide">{label}</span>
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

  // success + real result (not a duplicate which has result=null)
  if (item.status === 'success' && item.result) {
    return <ImageCard image={item.result} onDeleted={onDeleted} />
  }

  // duplicate (result is null) — slot collapses after the 3s auto-remove
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
