import { CheckCircle } from 'lucide-react'
import { ImageCard } from './ImageCard'
import type { Image } from '../types'

interface Props {
  images: Image[]
  sessionImages: Image[]
  onSessionImageDeleted: (imageId: string) => void
  isLoading: boolean
}

export function AcceptedGrid({ images, sessionImages, onSessionImageDeleted, isLoading }: Props) {
  const all = [...sessionImages, ...images]

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="pt-2 border-t border-border">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
            <h2 className="text-base font-semibold text-text">Your Photos</h2>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="aspect-square rounded-xl bg-surface animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (all.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="pt-2 border-t border-border">
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
          <h2 className="text-base font-semibold text-text">Your Photos ({all.length})</h2>
        </div>
        <p className="text-sm text-text-dim">
          These photos meet our guidelines and are ready to process.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {sessionImages.map((img) => (
          <ImageCard key={img.id} image={img} onDeleted={() => onSessionImageDeleted(img.id)} />
        ))}
        {images.map((img) => (
          <ImageCard key={img.id} image={img} />
        ))}
      </div>
    </div>
  )
}
