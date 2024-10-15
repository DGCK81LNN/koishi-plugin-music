import { Argv, Computed, Context, h, Schema } from "koishi"
import type {} from "koishi-plugin-puppeteer"

import { resolve } from "path"
import { pathToFileURL } from "url"

export const name = "music"

export const inject = ["puppeteer"]

export interface Config {
  evalCommand: "glot" | "eval"
  noise: Computed<boolean>
}

export const Config: Schema<Config> = Schema.object({
  evalCommand: Schema.union(["glot", "eval"])
    .default("glot")
    .description("用于安全执行 js 代码的指令。"),
  noise: Schema.computed(Boolean)
    .default(true)
    .description("是否添加白噪音来尝试规避 QQ 的语音编码杂音问题。"),
})

type MusicContext = {
  note(tone: number, beats: number, temperament?: number): void
  noteJust(ratio: number, beats: number): void
  noteHz(frequency: number, beats: number): void
  rest(beats: number): void
  bpm: Number
  baseFrequency: number
  gain: number
  time: number
} & {
  bpm(v: number): void
  /** @deprecated */
  getTime(): number
  /** @deprecated */
  setTime(v: number): void
}

type CompatibilityBpmFunction = Number & ((v: number) => void)

export interface Note {
  frequency: number
  gain: number
  start: number
  end: number
}

const gutterFunc = (f: ($: MusicContext) => void) => {
  function createCompatibilityBpmFunction(v: number) {
    return new Proxy(
      (v: number) => {
        v = +v
        if (v > 0 && v !== Infinity) bpm = createCompatibilityBpmFunction(v)
      },
      {
        get: (_, p) => (typeof v[p] === "function" ? v[p].bind(v) : v[p]),
      }
    ) as CompatibilityBpmFunction
  }

  let bpm: number | CompatibilityBpmFunction = createCompatibilityBpmFunction(120)
  let baseFrequency = 440
  let gain = 0.5
  let time = 0
  const notes: Note[] = []

  f({
    note(tone, beats, temperament = 12) {
      this.noteHz(baseFrequency * 2 ** (tone / temperament), beats)
    },
    noteJust(ratio, beats) {
      this.noteHz(baseFrequency * ratio, beats)
    },
    noteHz(frequency, beats) {
      notes.push({ start: time, end: (time += (beats / +bpm) * 60), frequency, gain })
    },
    rest(beats) {
      time += (beats / +bpm) * 60
    },
    get bpm() {
      return bpm
    },
    set bpm(v) {
      v = +v
      if (v > 0 && v !== Infinity) bpm = v
    },
    get baseFrequency() {
      return baseFrequency
    },
    set baseFrequency(v) {
      v = +v
      if (v > 0 && v !== Infinity) baseFrequency = v
    },
    get gain() {
      return gain
    },
    set gain(v) {
      v = +v
      if (v > 0 && v !== Infinity) gain = v
    },
    get time() {
      return time
    },
    set time(v) {
      v = +v
      if (Number.isFinite(v)) time = Math.max(0, v)
    },
    getTime() {
      return time
    },
    setTime(v) {
      this.time = v
    },
  } as MusicContext)
  if (!notes.length) return ""
  return JSON.stringify(notes)
}

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define("zh", require("./locales/zh"))

  ctx
    .command("musicjs <code:rawtext>", { strictOptions: true })
    .action(async ({ session }, code) => {
      if (!code) return session.text(".require-code")
      try {
        new Function(code)
      } catch (e) {
        return h.text(String(e))
      }

      let gutteredCode = `(${gutterFunc})(${new Function("$", "with($){" + code + "}")})`
      if (config.evalCommand !== "eval")
        gutteredCode = `process.stdout.write(${gutteredCode})`
      ctx.logger.debug(config.evalCommand, gutteredCode)

      const evalArgv = Argv.parse(config.evalCommand)
      evalArgv.tokens.push({
        content: h.escape(gutteredCode),
        inters: [],
        quoted: true,
        terminator: "",
      })
      const data = h("", await session.execute(evalArgv, true)).toString(true)
      if (!data) session.text(".no-note")
      try {
        ctx.logger.debug(JSON.parse(data))
      } catch {
        return h.text(data)
      }

      const page = await ctx.puppeteer.page()
      await page.goto(pathToFileURL(resolve(__dirname, "../browser/index.html")).href)
      const opt = {
        noise: session.resolve(config.noise),
      }
      const base64 = (await page.evaluate(
        `synth(${data}, ${JSON.stringify(opt)}).then(encodeWav).then(arrayBufferToBase64)`
      )) as string
      page.close().catch(() => {})
      return h.audio("data:audio/wav;base64," + base64)
    })
}
