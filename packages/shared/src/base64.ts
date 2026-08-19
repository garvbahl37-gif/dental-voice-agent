/**
 * Base64 for PCM, in both runtimes.
 *
 * Live carries audio as base64 in JSON. The session code that does that
 * conversion runs on the server for a phone call and in the browser for a web
 * call, and `Buffer` only exists in one of them — which is the whole reason the
 * session could not be shared before. `atob`/`btoa` are global in browsers and
 * in Node since v16, so this works unchanged in both.
 */

export function pcmToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.length * 2)
  // Chunked: one spread of a multi-megabyte array overflows the call stack.
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToPcm(b64: string): Int16Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  // Copy into an aligned buffer: Int16Array needs a 2-byte-aligned offset and
  // an odd-length payload would otherwise throw rather than drop a byte.
  const usable = bytes.length - (bytes.length % 2)
  const out = new Int16Array(usable / 2)
  new Uint8Array(out.buffer).set(bytes.subarray(0, usable))
  return out
}
