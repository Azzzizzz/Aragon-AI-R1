import { useMemo, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import type { UploadItem } from './FileListItem'

const STATUS_LABEL: Partial<Record<UploadItem['status'], string>> = {
  requesting: 'Preparing…',
  uploading:  'Uploading…',
  validating: 'Validating…',
}

function ProcessingCard({ item }: { item: UploadItem }) {
  const previewUrl = useMemo(() => URL.createObjectURL(item.file), [item.file])
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl])

  const label = STATUS_LABEL[item.status] ?? 'Processing…'

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative group rounded-xl overflow-hidden aspect-square bg-surface border border-border">
        <img
          src={previewUrl}
          alt={item.file.name}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
          <span className="text-[11px] font-medium text-accent tracking-wide">{label}</span>
        </div>
      </div>
      <p className="text-xs text-center text-text-mute truncate px-1">{item.file.name}</p>
    </div>
  )
}

interface Props {
  items: UploadItem[]
}

export function ProcessingGrid({ items }: Props) {
  if (items.length === 0) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
        <h2 className="text-base font-semibold text-text">Processing</h2>
        <span className="text-sm text-text-dim">({items.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {items.map((item) => (
          <ProcessingCard key={item.clientId} item={item} />
        ))}
      </div>
    </div>
  )
}
