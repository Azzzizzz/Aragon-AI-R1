import { useMemo, useEffect } from 'react'
import { XCircle, Loader2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
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


interface Props {
  items: UploadItem[]
}

export function SessionGrid({ items }: Props) {
  const inProgress = items.filter(
    (i) => i.status === 'requesting' || i.status === 'uploading' || i.status === 'validating'
  ).length

  return (
    <div className="space-y-4">
      <div className="pt-2 border-t border-border">
        <div className="flex items-center gap-2 mb-1">
          {inProgress > 0 ? (
            <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400 shrink-0" />
          )}
          <h2 className="text-base font-semibold text-text">
            {inProgress > 0 ? 'Uploading Photos' : 'Upload Errors'}
          </h2>
        </div>
        <p className="text-sm text-text-dim">
          {inProgress > 0
            ? `Processing ${inProgress} photo${inProgress !== 1 ? 's' : ''}…`
            : 'These photos failed to upload. Please try again.'}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <AnimatePresence mode="popLayout">
          {items.map((item) => {
            const isProcessing = item.status === 'requesting' || item.status === 'uploading' || item.status === 'validating'
            const isError = item.status === 'error'
            if (!isProcessing && !isError) return null
            return (
              <motion.div key={item.clientId} initial={{ opacity: 0, scale: 0.88 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.88 }} transition={{ duration: 0.2, ease: 'easeOut' }} layout>
                {isProcessing ? <ProcessingCard item={item} /> : <ErrorCard item={item} />}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
