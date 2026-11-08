// Reader for the precomputed embedding cache: records of [8-byte key][float32 scale][384 x int8].

import { dequantize } from './util.ts'

export const REC = 8 + 4 + 384

export function parseCache(buf: ArrayBuffer): Map<string, Float32Array> {
  const map = new Map<string, Float32Array>()
  const dv = new DataView(buf)
  for (let o = 0; o + REC <= buf.byteLength; o += REC) {
    let key = ''
    for (let i = 0; i < 8; i++) key += dv.getUint8(o + i).toString(16).padStart(2, '0')
    map.set(key, dequantize(new Int8Array(buf, o + 12, 384), dv.getFloat32(o + 8, true)))
  }
  return map
}
