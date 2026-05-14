export type RejectionReason =
  | 'TOO_SMALL'
  | 'INVALID_FORMAT'
  | 'DUPLICATE'
  | 'BLURRY'
  | 'FACE_TOO_SMALL'
  | 'MULTIPLE_FACES'
  | 'NO_FACE'

export type ImageStatus = 'ACCEPTED' | 'REJECTED'

export interface Image {
  id: string
  filename: string
  storagePath: string
  publicUrl: string
  status: ImageStatus
  rejectionReasons: RejectionReason[]
  fileSize: number
  width: number
  height: number
  mimeType: string
  pHash: string | null
  createdAt: string
  updatedAt: string
}

export interface ImagesResponse {
  items: Image[]
  nextCursor: string | null
}
