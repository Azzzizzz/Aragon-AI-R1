import path from 'path'
import { fileURLToPath } from 'url'
import * as tf from '@tensorflow/tfjs-node'
// face-api.node.js uses @tensorflow/tfjs-node as its backend
import * as faceapi from '@vladmandic/face-api'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_PATH = path.join(__dirname, '../../node_modules/@vladmandic/face-api/model')
let loaded = false

export async function loadFaceModels(): Promise<void> {
  if (loaded) return
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODELS_PATH)
  loaded = true
}

export async function detectFaces(
  buffer: Buffer
): Promise<{ count: number; largestRatio: number }> {
  // tf.node.decodeImage handles JPEG/PNG buffers natively — no canvas needed
  const tensor = tf.node.decodeImage(buffer, 3) as tf.Tensor3D

  try {
    const detections = await faceapi
      .detectAllFaces(tensor as unknown as HTMLImageElement, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .run()

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
