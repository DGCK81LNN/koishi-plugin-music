const sampleRate = 44100

async function synth(notes, { noise } = {}) {
  const seconds = Math.max(...notes.map(i => i.end))

  const ctx = new OfflineAudioContext(1, seconds * sampleRate, sampleRate)
  const cmp = ctx.createDynamicsCompressor()
  const wav = ctx.createPeriodicWave([0, 0, 0, 0], [0, 1, 1, 1])

  cmp.connect(ctx.destination)

  for (const note of notes) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    osc.setPeriodicWave(wav)
    osc.frequency.value = note.frequency

    osc.connect(gain)
    gain.connect(cmp)

    osc.addEventListener("ended", () => osc.disconnect())
    osc.start(note.start)
    osc.stop(note.end)
    gain.gain.setValueAtTime(note.gain, note.start)
    gain.gain.linearRampToValueAtTime(0, note.end)
  }

  if (noise) {
    // Add some white noise to avoid QQ's voice message encoding issues
    const noiseBuf = ctx.createBuffer(1, Math.min(seconds, 10) * sampleRate, sampleRate)
    for (let data = noiseBuf.getChannelData(0), i = 0; i < data.length; i++)
      data[i] = Math.random() * 2 - 1
    const noiseGain = ctx.createGain()
    noiseGain.gain.value = 0.005
    const noiseSrc = ctx.createBufferSource()
    noiseSrc.buffer = noiseBuf
    noiseSrc.loop = true
    noiseSrc.connect(noiseGain)
    noiseGain.connect(ctx.destination)
    noiseSrc.start(0)
  }

  const buf = await ctx.startRendering()
  return buf.getChannelData(0)
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(samples.length * 2 + 44)
  const view = new DataView(buffer)
  let p = 0
  function writeBytes(bytes) {
    for (let i = 0; i < bytes.length; i++) view.setUint8(p++, bytes.charCodeAt(i))
  }
  function writeInt32(n) {
    view.setInt32(p, n, true)
    p += 4
  }
  function writeInt16(n) {
    view.setInt16(p, n, true)
    p += 2
  }

  writeBytes("RIFF")
  writeInt32(buffer.byteLength - 8) // size of whole container
  writeBytes("WAVEfmt ")
  writeInt32(16) // size of fmt chunk
  writeInt16(1) // encoding format = pcm
  writeInt16(1) // channel count
  writeInt32(sampleRate)
  writeInt32(sampleRate * 2) // bytes per second
  writeInt16(2) // bytes per sample
  writeInt16(16) // sample depth
  writeBytes("data")
  writeInt32(samples.length * 2) // size of data chunk
  for (let i = 0; i < samples.length; i++)
    writeInt16(Math.min(Math.max(samples[i] * 0x7fff, -32768), 32767))

  return buffer
}

// https://gist.github.com/jonleighton/958841
function arrayBufferToBase64(arrayBuffer) {
  var base64    = ''
  var encodings = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  var bytes         = new Uint8Array(arrayBuffer)
  var byteLength    = bytes.byteLength
  var byteRemainder = byteLength % 3
  var mainLength    = byteLength - byteRemainder
  var a, b, c, d
  var chunk
  for (var i = 0; i < mainLength; i = i + 3) {
    chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    a = (chunk & 16515072) >> 18
    b = (chunk & 258048)   >> 12
    c = (chunk & 4032)     >>  6
    d = chunk & 63
    base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d]
  }
  if (byteRemainder == 1) {
    chunk = bytes[mainLength]
    a = (chunk & 252) >> 2
    b = (chunk & 3)   << 4
    base64 += encodings[a] + encodings[b] + '=='
  } else if (byteRemainder == 2) {
    chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1]
    a = (chunk & 64512) >> 10
    b = (chunk & 1008)  >>  4
    c = (chunk & 15)    <<  2
    base64 += encodings[a] + encodings[b] + encodings[c] + '='
  }
  return base64
}
