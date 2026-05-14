import { ImageCard } from './ImageCard'
import type { Image } from '../types'

interface Props {
  images: Image[]
  isLoading: boolean
}

export function AcceptedGrid({ images, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="aspect-square rounded-xl bg-surface animate-pulse" />
        ))}
      </div>
    )
  }

  if (images.length === 0) return null

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {images.map((img) => (
        <ImageCard key={img.id} image={img} />
      ))}
    </div>
  )
}
