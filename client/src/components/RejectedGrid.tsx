import { AlertTriangle } from 'lucide-react'
import { ImageCard } from './ImageCard'
import type { Image } from '../types'

interface Props {
  images: Image[]
  isLoading: boolean
  acceptedCount: number
}

export function RejectedGrid({ images, isLoading, acceptedCount }: Props) {
  if (isLoading || images.length === 0) return null

  return (
    <div className="space-y-4">
      <div className="pt-2 border-t border-border">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <h2 className="text-base font-semibold text-text">
            Some Photos Didn't Meet Our Guidelines
          </h2>
        </div>
        <p className="text-sm text-text-dim">
          {acceptedCount > 0
            ? `You can move to the next step as you've uploaded ${acceptedCount} good photo${acceptedCount !== 1 ? 's' : ''}. Replacing these is optional.`
            : 'Please re-upload photos that meet the guidelines below.'}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {images.map((img) => (
          <ImageCard key={img.id} image={img} />
        ))}
      </div>
    </div>
  )
}
