import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { rejectionMessages } from '../lib/rejectionMessages'
import type { Image } from '../types'

export function ImageCard({ image, onDeleted }: { image: Image; onDeleted?: () => void }) {
  const queryClient = useQueryClient()
  const [imgError, setImgError] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/api/images/${image.id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['images'] })
      toast.success('Image deleted')
      onDeleted?.()
    },
    onError: () => toast.error('Failed to delete image'),
  })

  const primaryReason = image.rejectionReasons[0]
  const reasonMsg = primaryReason ? rejectionMessages[primaryReason] : null

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative group rounded-xl overflow-hidden aspect-square bg-surface border border-border">
        {imgError ? (
          <div className="w-full h-full flex items-center justify-center text-text-dim text-xs">
            Preview unavailable
          </div>
        ) : (
          <img
            src={image.publicUrl}
            alt={image.filename}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        )}

        {/* Delete button — always visible */}
        <button
          onClick={() => deleteMutation.mutate()}
          disabled={deleteMutation.isPending}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-background/80 border border-border flex items-center justify-center text-text-dim hover:text-red-400 hover:border-red-500/40 hover:bg-background transition-colors disabled:opacity-50"
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
