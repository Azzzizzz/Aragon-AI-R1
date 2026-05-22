export type RejectionReason =
  | 'TOO_SMALL'
  | 'INVALID_FORMAT'
  | 'DUPLICATE'
  | 'BLURRY'
  | 'FACE_TOO_SMALL'
  | 'MULTIPLE_FACES'
  | 'NO_FACE'

export type ImageStatus = 'PENDING_UPLOAD' | 'ACCEPTED' | 'REJECTED'

export type ProcessingStatus =
  | 'QUEUED'
  | 'CONVERTING'
  | 'COMPRESSING'
  | 'GENERATING_VARIANTS'
  | 'COMPLETE'
  | 'FAILED'

export type VariantType = 'THUMBNAIL' | 'MOBILE' | 'TABLET' | 'WEB' | 'FULL'

export interface ImageVariant {
  type: VariantType
  storageUrl: string
  width: number
  height: number
  fileSize: number
}

export interface ImageStatusResponse {
  status: ImageStatus
  rejectionReasons: RejectionReason[]
  processingStatus: ProcessingStatus | null
  processingError: string | null
  compressionRatio: number | null
  compressedSize: number | null
  variants: ImageVariant[]
}

export interface Image {
  id: string
  filename: string
  publicUrl: string
  status: ImageStatus
  rejectionReasons: RejectionReason[]
  fileSize: number
  width: number
  height: number
  mimeType: string
  createdAt: string
  // present on POST response, omitted from GET select
  storagePath?: string
  pHash?: string | null
  updatedAt?: string
}

export interface ImagesResponse {
  items: Image[]
  nextCursor: string | null
}
