import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2, Loader2, RefreshCw } from 'lucide-react'
import { api } from '../lib/api'
import { rejectionMessages } from '../lib/rejectionMessages'
import type { Image, ImagesResponse, ImageStatusResponse, ProcessingStatus } from '../types'

const PIPELINE_LABEL: Record<Exclude<ProcessingStatus, 'COMPLETE' | 'FAILED'>, string> = {
  QUEUED: 'Queued…',
  CONVERTING: 'Converting…',
  COMPRESSING: 'Compressing…',
  GENERATING_VARIANTS: 'Generating sizes…',
}

const TERMINAL_STATUSES: ProcessingStatus[] = ['COMPLETE', 'FAILED']

export function ImageCard({ image, onDeleted }: { image: Image; onDeleted?: () => void }) {
  const queryClient = useQueryClient()
  const [imgError, setImgError] = useState(false)
  const [deleted, setDeleted] = useState(false)

  // Poll pipeline status only for ACCEPTED images that haven't reached a terminal state.
  // Stops automatically once status is COMPLETE or FAILED.
  const { data: pipeline } = useQuery({
    queryKey: ['status', image.id],
    queryFn: () => api.getImageStatus(image.id),
    enabled: image.status === 'ACCEPTED',
    refetchInterval: (query) => {
      const status = query.state.data?.processingStatus
      return status && TERMINAL_STATUSES.includes(status) ? false : 2000
    },
    staleTime: 0,
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/api/images/${image.id}`),
    onMutate: () => setDeleted(true),
    onSuccess: () => {
      const drop = (key: unknown[]) =>
        queryClient.setQueryData<ImagesResponse>(key, (old) =>
          old ? { ...old, items: old.items.filter((i) => i.id !== image.id) } : old,
        )
      drop(['images', 'ACCEPTED'])
      drop(['images', 'REJECTED'])
      queryClient.invalidateQueries({ queryKey: ['images'], refetchType: 'none' })
      queryClient.removeQueries({ queryKey: ['status', image.id] })
      toast.success('Image deleted')
      onDeleted?.()
    },
    onError: () => {
      setDeleted(false)
      toast.error('Failed to delete image')
    },
  })

  const retryMutation = useMutation({
    mutationFn: () => api.reprocessImage(image.id),
    onSuccess: () => {
      // Force an immediate refetch so the badge flips back to QUEUED instantly
      queryClient.setQueryData<ImageStatusResponse>(['status', image.id], (old) =>
        old ? { ...old, processingStatus: 'QUEUED', processingError: null } : old,
      )
      queryClient.invalidateQueries({ queryKey: ['status', image.id] })
      toast.success('Reprocessing started')
    },
    onError: (err: Error) => toast.error(err.message || 'Retry failed'),
  })

  if (deleted) return null

  const primaryReason = image.rejectionReasons[0]
  const reasonMsg = primaryReason ? rejectionMessages[primaryReason] : null

  // Once COMPLETE, render the thumbnail variant (small, optimized) instead of the original
  const thumbnail = pipeline?.variants.find((v) => v.type === 'THUMBNAIL')
  const displayUrl = pipeline?.processingStatus === 'COMPLETE' && thumbnail
    ? thumbnail.storageUrl
    : image.publicUrl

  const processingStatus = pipeline?.processingStatus
  const isPipelineActive =
    image.status === 'ACCEPTED' &&
    processingStatus &&
    processingStatus !== 'COMPLETE' &&
    processingStatus !== 'FAILED'
  const isPipelineFailed = image.status === 'ACCEPTED' && processingStatus === 'FAILED'
  const isPipelineComplete = image.status === 'ACCEPTED' && processingStatus === 'COMPLETE'

  // Compression ratio: e.g. 0.62 → "−38%"
  const compressionLabel =
    pipeline?.compressionRatio != null
      ? `−${Math.round((1 - pipeline.compressionRatio) * 100)}%`
      : null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative group rounded-xl overflow-hidden aspect-square bg-surface border border-border">
        {imgError ? (
          <div className="w-full h-full flex items-center justify-center text-text-dim text-xs">
            Preview unavailable
          </div>
        ) : (
          <img
            src={displayUrl}
            alt={image.filename}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        )}

        {/* Pipeline-running overlay */}
        {isPipelineActive && (
          <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
            <span className="text-[11px] font-medium text-white tracking-wide">
              {PIPELINE_LABEL[processingStatus as keyof typeof PIPELINE_LABEL] ?? 'Processing…'}
            </span>
          </div>
        )}

        {/* Pipeline-failed overlay with retry button */}
        {isPipelineFailed && (
          <div className="absolute inset-0 bg-background/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-2 p-3">
            <span className="text-[11px] font-semibold text-red-400">Processing failed</span>
            <p className="text-[10px] text-text-dim text-center leading-tight line-clamp-3">
              {pipeline?.processingError ?? 'Unknown error'}
            </p>
            <button
              onClick={() => retryMutation.mutate()}
              disabled={retryMutation.isPending}
              className="mt-1 px-2.5 py-1 rounded-md bg-background border border-border text-[11px] font-medium text-text hover:border-accent hover:text-accent transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${retryMutation.isPending ? 'animate-spin' : ''}`} />
              Retry
            </button>
          </div>
        )}

        {/* Compression ratio badge — bottom-left, only when COMPLETE */}
        {isPipelineComplete && compressionLabel && (
          <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-background/85 backdrop-blur-[2px] border border-border text-[10px] font-medium text-text-dim">
            {compressionLabel}
          </div>
        )}

        {/* Delete button — always visible */}
        <button
          onClick={() => deleteMutation.mutate()}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-background/80 border border-border flex items-center justify-center text-text-dim hover:text-red-400 hover:border-red-500/40 hover:bg-background transition-colors"
          title="Delete image"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>

        {/* Hover tooltip for rejected images */}
        {reasonMsg && (
          <div className="absolute bottom-0 left-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none">
            <div className="m-2 rounded-lg bg-background/95 border border-border p-3 shadow-lg">
              <p className="text-xs font-semibold text-text mb-0.5">Try again</p>
              <p className="text-xs text-text-dim leading-relaxed">{reasonMsg.tooltip}</p>
            </div>
          </div>
        )}
      </div>

      {/* Caption below card */}
      {reasonMsg && (
        <p className="text-xs text-center text-text-dim underline underline-offset-2 decoration-dashed cursor-help truncate px-1">
          {reasonMsg.label}
        </p>
      )}
    </div>
  )
}
