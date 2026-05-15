import path from 'path'
import { fileURLToPath } from 'url'
import * as tf from '@tensorflow/tfjs-node'
import sharp from 'sharp'
// face-api.node.js uses @tensorflow/tfjs-node as its backend
import * as faceapi from '@vladmandic/face-api'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_PATH = path.join(__dirname, '../../node_modules/@vladmandic/face-api/model')
let loaded = false

export async function loadFaceModels(): Promise<void> {
  if (loaded) return
  // TinyFaceDetector: 0.18 MB model vs SsdMobilenetv1's 5.4 MB — 30× smaller, ~5× faster
  await faceapi.nets.tinyFaceDetector.loadFromDisk(MODELS_PATH)
  loaded = true
}

export async function detectFaces(
  buffer: Buffer
): Promise<{ count: number; largestRatio: number }> {
  // Resize to max 640px before decoding — tensor shrinks 10× with no accuracy loss for headshots
  const resized = await sharp(buffer)
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .toBuffer()

  // tf.node.decodeImage handles JPEG/PNG buffers natively — no canvas needed
  const tensor = tf.node.decodeImage(resized, 3) as tf.Tensor3D

  try {
    const detections = (await faceapi
      // @ts-expect-error - faceapi expects HTMLImageElement (browser) but we provide a Tensor (Node)
      .detectAllFaces(tensor as unknown as HTMLImageElement, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.3 }))
      .run()) as faceapi.FaceDetection[]

    if (detections.length === 0) return { count: 0, largestRatio: 0 }

    const imgArea = tensor.shape[0] * tensor.shape[1]
    const largest = detections.reduce((best, d) => {
      const area = d.box.width * d.box.height
      return area > best ? area : best
    }, 0)

    return { count: detections.length, largestRatio: largest / imgArea }
  } finally {
    tensor.dispose()
  }
}
