import type { RejectionReason } from '../types'

interface RejectionMessage {
  label: string
  tooltip: string
}

export const rejectionMessages: Record<RejectionReason, RejectionMessage> = {
  TOO_SMALL: {
    label: 'Image too small',
    tooltip: 'Image must be at least 800×800px and 50KB. Try a higher-resolution photo.',
  },
  INVALID_FORMAT: {
    label: 'Invalid format',
    tooltip: 'Only JPEG, PNG, and HEIC files are accepted.',
  },
  DUPLICATE: {
    label: 'Too similar to another upload',
    tooltip: 'This image is too similar to one you already uploaded. Please use a different photo.',
  },
  BLURRY: {
    label: 'Blurry face detected',
    tooltip: 'We detected a blurry face. Please ensure the face is in focus.',
  },
  FACE_TOO_SMALL: {
    label: 'Face is too far away',
    tooltip: 'The face in this photo is too far from the camera. Try a closer shot or crop the image.',
  },
  MULTIPLE_FACES: {
    label: 'Multiple faces detected',
    tooltip: 'Only photos with a single face are accepted. Please use a solo photo.',
  },
  NO_FACE: {
    label: 'No face detected',
    tooltip: 'No face was detected in this image. Make sure your face is clearly visible.',
  },
}
