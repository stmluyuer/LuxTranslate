import { AI, Context, PublicAPI } from "@wox-launcher/wox-plugin"

export type TranslationProvider = "microsoft" | "youdao" | "caiyun" | "openai" | "claude" | "deepseek" | "llm_custom" | "wox_ai" | "deepl" | "openai_compatible"

export type LanguageCode = "auto" | "zh" | "en" | "ja" | "ko" | "ru" | "ar" | "fr" | "de"

/** 语言显示名称（用于 LLM prompt 和 UI） */
export const LANGUAGE_LABEL: Record<string, string> = {
  zh: "Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  ru: "Russian",
  ar: "Arabic",
  fr: "French",
  de: "German"
}

/** Microsoft Translator API 语言代码 */
export const LANGUAGE_MICROSOFT: Record<string, string> = {
  zh: "zh-Hans",
  en: "en",
  ja: "ja",
  ko: "ko",
  ru: "ru",
  ar: "ar",
  fr: "fr",
  de: "de"
}

/** DeepL API 语言代码 */
export const LANGUAGE_DEEPL: Record<string, string> = {
  zh: "ZH",
  en: "EN-US",
  ja: "JA",
  ko: "KO",
  ru: "RU",
  ar: "AR",
  fr: "FR",
  de: "DE"
}

export interface PluginSettings {
  defaultProvider: TranslationProvider
  visibleProviders: TranslationProvider[]
  providerRows: ProviderTableRow[]
  defaultSourceLanguage: LanguageCode
  defaultTargetLanguage: LanguageCode
  /** 配对语言：当源 = 系统语言时翻译成此语言，默认英语 */
  pairLanguage: LanguageCode
  /** 系统语言（由插件 init 时探针检测，不需要持久化） */
  systemLanguage?: LanguageCode
  deeplPlan: "free" | "pro"
  deeplApiKey: string
  woxAiModel: string
  openaiBaseUrl: string
  openaiApiKey: string
  openaiModel: string
  requestTimeoutMs: number
  showPreviewDetails: boolean
  historyLimit: number
}

export interface ParsedQuery {
  provider: TranslationProvider
  text: string
  forcedProvider: boolean
}

export interface LanguageDirection {
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  targetLabel: string
  microsoftTarget: string
  deeplTarget: string
}

export interface TranslationRequest {
  text: string
  direction: LanguageDirection
  settings: PluginSettings
}

export interface TranslationResponse {
  translatedText: string
  providerName: string
  detectedSourceLanguage?: string
}

export interface TranslationHistoryEntry {
  sourceText: string
  translatedText: string
  provider: TranslationProvider
  providerName: string
  sourceLanguage: LanguageCode
  targetLanguage: LanguageCode
  detectedSourceLanguage?: string
  timestamp: number
}

export interface ProviderTableRow {
  provider?: string
  name?: string
  note?: string
  deeplPlan?: string
  apiKey?: string
  baseUrl?: string
  model?: string
  aiModel?: string
}

const PROVIDER_ALIASES: Record<string, TranslationProvider> = {
  ms: "microsoft",
  microsoft: "microsoft",
  youdao: "youdao",
  yd: "youdao",
  caiyun: "caiyun",
  cy: "caiyun",
  deepl: "deepl",
  ai: "wox_ai",
  wox_ai: "wox_ai",
  woxai: "wox_ai",
  openai: "openai",
  claude: "claude",
  anthropic: "claude",
  deepseek: "deepseek",
  custom: "llm_custom",
  llm: "llm_custom",
  llm_custom: "llm_custom",
  openai_compatible: "llm_custom"
}

const CAIYUN_DEFAULT_TOKEN = "3975l6lr5pcbvidl6jl2"

let microsoftAuthToken = ""

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultProvider: "microsoft",
  visibleProviders: [],
  providerRows: [],
  defaultSourceLanguage: "auto",
  defaultTargetLanguage: "auto",
  pairLanguage: "en",
  deeplPlan: "free",
  deeplApiKey: "",
  woxAiModel: "",
  openaiBaseUrl: "https://api.openai.com/v1",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  requestTimeoutMs: 10000,
  showPreviewDetails: true,
  historyLimit: 10
}

export function normalizeProvider(value: string): TranslationProvider {
  if (isTranslationProvider(value)) {
    return value
  }
  return DEFAULT_SETTINGS.defaultProvider
}

function isTranslationProvider(value: string): value is TranslationProvider {
  return (
    value === "microsoft" ||
    value === "youdao" ||
    value === "caiyun" ||
    value === "openai" ||
    value === "claude" ||
    value === "deepseek" ||
    value === "llm_custom" ||
    value === "wox_ai" ||
    value === "deepl" ||
    value === "openai_compatible"
  )
}

export function parseProviderList(value: string): TranslationProvider[] {
  const providers: TranslationProvider[] = []

  let rawValues = value.split(",")
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      rawValues = parsed.filter(item => typeof item === "string")
    }
  } catch {
    // Wox commonly stores multi-select values as a comma separated string.
  }

  for (const rawValue of rawValues) {
    const trimmed = rawValue.trim()
    if (trimmed === "") {
      continue
    }
    const provider = normalizeProvider(trimmed)
    if (!providers.includes(provider)) {
      providers.push(provider)
    }
  }
  return providers
}

export function parseProviderTableRows(value: string): ProviderTableRow[] {
  if (value.trim() === "") {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return (parsed as ProviderTableRow[]).filter(row => typeof row === "object" && row !== null && typeof row.provider === "string" && isTranslationProvider(row.provider))
  } catch {
    return []
  }
}

export function parseHistoryEntries(value: string): TranslationHistoryEntry[] {
  if (value.trim() === "") {
    return []
  }

  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed.filter((item): item is TranslationHistoryEntry => {
      if (typeof item !== "object" || item === null) {
        return false
      }
      const candidate = item as Partial<TranslationHistoryEntry>
      return (
        typeof candidate.sourceText === "string" &&
        typeof candidate.translatedText === "string" &&
        typeof candidate.provider === "string" &&
        typeof candidate.providerName === "string" &&
        typeof candidate.sourceLanguage === "string" &&
        typeof candidate.targetLanguage === "string" &&
        typeof candidate.timestamp === "number"
      )
    })
  } catch {
    return []
  }
}

export function historyKeyMatches(entry: TranslationHistoryEntry, provider: TranslationProvider, sourceText: string, direction: LanguageDirection): boolean {
  return entry.provider === provider && entry.sourceText === sourceText && entry.sourceLanguage === direction.sourceLanguage && entry.targetLanguage === direction.targetLanguage
}

function sameHistoryEntry(left: TranslationHistoryEntry, right: TranslationHistoryEntry): boolean {
  return left.provider === right.provider && left.sourceText === right.sourceText && left.sourceLanguage === right.sourceLanguage && left.targetLanguage === right.targetLanguage
}

export function trimHistoryEntries(entries: TranslationHistoryEntry[], historyLimit: number): TranslationHistoryEntry[] {
  return entries.slice(0, Math.max(0, historyLimit))
}

export function upsertHistoryEntry(entries: TranslationHistoryEntry[], entry: TranslationHistoryEntry, historyLimit: number): TranslationHistoryEntry[] {
  const withoutDuplicate = entries.filter(existing => !sameHistoryEntry(existing, entry))
  return trimHistoryEntries(
    [entry, ...withoutDuplicate].sort((left, right) => right.timestamp - left.timestamp),
    historyLimit
  )
}

function normalizeHistorySearchText(text: string): string {
  return text.trim().toLowerCase()
}

export function searchHistoryEntries(entries: TranslationHistoryEntry[], query: string): TranslationHistoryEntry[] {
  const normalizedQuery = normalizeHistorySearchText(query)
  if (normalizedQuery === "") {
    return entries
  }

  return entries.filter(entry => {
    const source = normalizeHistorySearchText(entry.sourceText)
    const translated = normalizeHistorySearchText(entry.translatedText)
    return source.includes(normalizedQuery) || translated.includes(normalizedQuery)
  })
}

export function parseTranslationQuery(search: string, defaultProvider: TranslationProvider): ParsedQuery {
  const trimmed = search.trim()
  if (trimmed === "") {
    return { provider: defaultProvider, text: "", forcedProvider: false }
  }

  const firstSpace = trimmed.search(/\s/)
  const command = firstSpace === -1 ? trimmed.toLowerCase() : trimmed.slice(0, firstSpace).toLowerCase()
  const provider = PROVIDER_ALIASES[command]
  if (!provider) {
    return { provider: defaultProvider, text: trimmed, forcedProvider: false }
  }

  return {
    provider,
    text: firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim(),
    forcedProvider: true
  }
}

type ScriptFamily = "cjk" | "kana" | "hangul" | "cyrillic" | "arabic" | "latin" | null

/** 法语特征字符 */
const FRENCH_SPECIFIC = /[çèêëàâîïôùûœÇÈÊËÀÂÎÏÔÙÛŒ]/

/** 德语特征字符 */
const GERMAN_SPECIFIC = /[ßüöäÜÖÄ]/

function detectScriptFamily(text: string): ScriptFamily {
  let cjk = 0,
    latin = 0,
    cyrillic = 0,
    hangul = 0,
    kana = 0,
    arabic = 0,
    total = 0

  for (const char of text) {
    if (/\s/.test(char)) continue
    const code = char.codePointAt(0)!
    total++
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff)) {
      cjk++
    } else if ((code >= 0x3040 && code <= 0x309f) || (code >= 0x30a0 && code <= 0x30ff)) {
      kana++
    } else if (code >= 0xac00 && code <= 0xd7af) {
      hangul++
    } else if (code >= 0x0400 && code <= 0x04ff) {
      cyrillic++
    } else if ((code >= 0x0600 && code <= 0x06ff) || (code >= 0x0750 && code <= 0x077f) || (code >= 0xfb50 && code <= 0xfdff) || (code >= 0xfe70 && code <= 0xfeff)) {
      arabic++
    } else if ((code >= 0x0041 && code <= 0x005a) || (code >= 0x0061 && code <= 0x007a) || (code >= 0x00c0 && code <= 0x024f)) {
      latin++
    }
  }

  if (total === 0) return null
  if (kana > 0 && (kana + cjk) / total > 0.3) return "kana"
  if (hangul / total > 0.3) return "hangul"
  if (cjk / total > 0.3) return "cjk"
  if (arabic / total > 0.3) return "arabic"
  if (cyrillic / total > 0.3) return "cyrillic"
  if (latin / total > 0.5) return "latin"
  return null
}

/** 检测文本的 8 大语言 */
export function detectLanguage(text: string): LanguageCode {
  const script = detectScriptFamily(text)

  if (script === "kana") return "ja"
  if (script === "hangul") return "ko"
  if (script === "cjk") return "zh"
  if (script === "arabic") return "ar"
  if (script === "cyrillic") return "ru"

  if (script === "latin") {
    if (GERMAN_SPECIFIC.test(text)) return "de"
    if (FRENCH_SPECIFIC.test(text)) return "fr"
    return "en"
  }

  return "en"
}

export function resolveLanguageDirection(text: string, sourceLanguage: LanguageCode = "auto", systemLanguage: LanguageCode = "en", pairLanguage: LanguageCode = "en"): LanguageDirection {
  const detected = detectLanguage(text)
  const source = sourceLanguage === "auto" ? detected : sourceLanguage

  // 智能目标：源 != 系统语言 → 系统语言（看懂外语）；源 == 系统语言 → 配对语言（互译）
  const target = source === systemLanguage ? pairLanguage : systemLanguage

  return {
    sourceLanguage: sourceLanguage === "auto" ? "auto" : source,
    targetLanguage: target,
    targetLabel: LANGUAGE_LABEL[target] || "English",
    microsoftTarget: LANGUAGE_MICROSOFT[target] || target,
    deeplTarget: LANGUAGE_DEEPL[target] || target.toUpperCase()
  }
}

export function getMissingConfiguration(provider: TranslationProvider, settings: PluginSettings): string | null {
  if (provider === "deepl" && settings.deeplApiKey.trim() === "") {
    return "DeepL API key is required for DeepL translation."
  }
  if (["openai", "claude", "deepseek", "llm_custom", "openai_compatible"].includes(provider) && settings.openaiApiKey.trim() === "") {
    return "API key is required for this large language model provider."
  }
  if (["openai", "claude", "deepseek", "llm_custom", "openai_compatible"].includes(provider) && settings.openaiModel.trim() === "") {
    return "Model is required for this large language model provider."
  }
  return null
}

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function parseJsonResponse(response: Response, providerName: string): Promise<unknown> {
  const bodyText = await response.text()
  if (!response.ok) {
    throw new Error(`${providerName} request failed with ${response.status}: ${bodyText}`)
  }
  try {
    return JSON.parse(bodyText) as unknown
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${providerName} returned invalid JSON: ${message}`)
  }
}

function requireString(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(errorMessage)
  }
  return value
}

export async function translateWithMicrosoft(request: TranslationRequest): Promise<TranslationResponse> {
  if (microsoftAuthToken === "") {
    const tokenResponse = await fetchWithTimeout(
      "https://edge.microsoft.com/translate/auth",
      {
        method: "GET",
        headers: {
          Accept: "text/plain"
        }
      },
      request.settings.requestTimeoutMs
    )
    microsoftAuthToken = requireString(await tokenResponse.text(), "Microsoft auth endpoint returned an empty token.")
    if (!tokenResponse.ok) {
      throw new Error(`Microsoft auth request failed with ${tokenResponse.status}: ${microsoftAuthToken}`)
    }
  }

  const url = `https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&to=${encodeURIComponent(request.direction.microsoftTarget)}`
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${microsoftAuthToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify([{ Text: request.text }])
    },
    request.settings.requestTimeoutMs
  )
  const json = (await parseJsonResponse(response, "Microsoft")) as Array<{
    detectedLanguage?: { language?: string }
    translations?: Array<{ text?: string }>
  }>
  const translatedText = requireString(json[0]?.translations?.[0]?.text, "Microsoft returned an empty translation.")

  return {
    translatedText,
    providerName: "Microsoft",
    detectedSourceLanguage: json[0]?.detectedLanguage?.language
  }
}

export async function translateWithDeepL(request: TranslationRequest): Promise<TranslationResponse> {
  const endpoint = request.settings.deeplPlan === "pro" ? "https://api.deepl.com/v2/translate" : "https://api-free.deepl.com/v2/translate"
  const body: Record<string, unknown> = {
    text: [request.text],
    target_lang: request.direction.deeplTarget
  }
  if (request.direction.sourceLanguage !== "auto") {
    body.source_lang = request.direction.sourceLanguage.toUpperCase()
  }

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${request.settings.deeplApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    },
    request.settings.requestTimeoutMs
  )
  const json = (await parseJsonResponse(response, "DeepL")) as {
    translations?: Array<{ detected_source_language?: string; text?: string }>
  }
  const translatedText = requireString(json.translations?.[0]?.text, "DeepL returned an empty translation.")

  return {
    translatedText,
    providerName: "DeepL",
    detectedSourceLanguage: json.translations?.[0]?.detected_source_language
  }
}

export async function translateWithYoudao(request: TranslationRequest): Promise<TranslationResponse> {
  const response = await fetchWithTimeout(
    `https://dict.youdao.com/jsonapi_s?doctype=json&jsonversion=4&q=${encodeURIComponent(request.text)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    },
    request.settings.requestTimeoutMs
  )
  const json = (await parseJsonResponse(response, "Youdao")) as {
    fanyi?: { tran?: string }
    ec?: { word?: Array<{ trs?: Array<{ tr?: Array<{ l?: { i?: string[] } }> }> }> }
  }
  const dictionaryText = json.ec?.word?.[0]?.trs?.[0]?.tr?.[0]?.l?.i?.join("; ")
  const translatedText = requireString(json.fanyi?.tran || dictionaryText, "Youdao returned an empty translation.")

  return {
    translatedText,
    providerName: "Youdao"
  }
}

function caiyunTranslationType(direction: LanguageDirection): string {
  // 彩云只支持中英双向
  if (direction.sourceLanguage === "zh") return "zh2en"
  if (direction.sourceLanguage === "en") return "en2zh"
  return direction.targetLanguage === "zh" ? "auto2zh" : "auto2en"
}

export async function translateWithCaiyun(request: TranslationRequest): Promise<TranslationResponse> {
  const transType = caiyunTranslationType(request.direction)
  const response = await fetchWithTimeout(
    "https://api.interpreter.caiyunai.com/v1/translator",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Authorization": `token ${CAIYUN_DEFAULT_TOKEN}`
      },
      body: JSON.stringify({
        source: [request.text],
        trans_type: transType,
        detect: transType.startsWith("auto"),
        media: "text"
      })
    },
    request.settings.requestTimeoutMs
  )
  const json = (await parseJsonResponse(response, "Caiyun")) as {
    target?: string[]
    rc?: number
  }
  const translatedText = requireString(json.target?.[0], "Caiyun returned an empty translation.")

  return {
    translatedText,
    providerName: "Caiyun"
  }
}

function buildTranslationPrompt(text: string, targetLabel: string): AI.Conversation[] {
  const now = Date.now()
  return [
    {
      Role: "system",
      Text: `Translate the user's text into ${targetLabel}. Return only the translation. Preserve code blocks, URLs, numbers, and proper nouns when appropriate. Do not add explanations.`,
      Timestamp: now
    },
    {
      Role: "user",
      Text: text,
      Timestamp: now
    }
  ]
}

export async function translateWithWoxAI(api: PublicAPI, ctx: Context, request: TranslationRequest): Promise<TranslationResponse> {
  let finalText = ""
  await Promise.race([
    api.LLMStream(ctx, buildTranslationPrompt(request.text, request.direction.targetLabel), data => {
      if (data.Status === "error") {
        throw new Error(data.Data)
      }
      if (data.Data.trim() !== "") {
        finalText = data.Data
      }
    }),
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Wox AI translation timed out.")), request.settings.requestTimeoutMs)
    })
  ])

  return {
    translatedText: requireString(finalText, "Wox AI returned an empty translation."),
    providerName: request.settings.woxAiModel.trim() === "" ? "Wox AI" : `Wox AI (${request.settings.woxAiModel})`
  }
}

export async function translateWithOpenAICompatible(request: TranslationRequest, providerName = "OpenAI compatible"): Promise<TranslationResponse> {
  const baseUrl = request.settings.openaiBaseUrl.replace(/\/+$/, "")
  const response = await fetchWithTimeout(
    `${baseUrl}/chat/completions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.settings.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.settings.openaiModel,
        messages: buildTranslationPrompt(request.text, request.direction.targetLabel).map(conversation => ({
          role: conversation.Role,
          content: conversation.Text
        })),
        temperature: 0.1
      })
    },
    request.settings.requestTimeoutMs
  )
  const json = (await parseJsonResponse(response, providerName)) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const translatedText = requireString(json.choices?.[0]?.message?.content, `${providerName} provider returned an empty translation.`)

  return {
    translatedText,
    providerName
  }
}

export async function translateWithClaude(request: TranslationRequest): Promise<TranslationResponse> {
  const baseUrl = request.settings.openaiBaseUrl.replace(/\/+$/, "")
  const conversations = buildTranslationPrompt(request.text, request.direction.targetLabel)
  const response = await fetchWithTimeout(
    `${baseUrl}/messages`,
    {
      method: "POST",
      headers: {
        "x-api-key": request.settings.openaiApiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.settings.openaiModel,
        system: conversations[0].Text,
        messages: [{ role: "user", content: conversations[1].Text }],
        max_tokens: 2048,
        temperature: 0.1
      })
    },
    request.settings.requestTimeoutMs
  )
  const json = (await parseJsonResponse(response, "Claude")) as {
    content?: Array<{ type?: string; text?: string }>
  }
  const translatedText = requireString(
    json.content
      ?.filter(item => item.type === "text" && typeof item.text === "string")
      .map(item => item.text)
      .join("")
      .trim(),
    "Claude provider returned an empty translation."
  )

  return {
    translatedText,
    providerName: "Claude"
  }
}

export async function translateText(api: PublicAPI, ctx: Context, provider: TranslationProvider, request: TranslationRequest): Promise<TranslationResponse> {
  if (provider === "microsoft") {
    return translateWithMicrosoft(request)
  }
  if (provider === "youdao") {
    return translateWithYoudao(request)
  }
  if (provider === "caiyun") {
    return translateWithCaiyun(request)
  }
  if (provider === "deepl") {
    return translateWithDeepL(request)
  }
  if (provider === "wox_ai") {
    return translateWithWoxAI(api, ctx, request)
  }
  if (provider === "claude") {
    return translateWithClaude(request)
  }
  if (provider === "openai") {
    return translateWithOpenAICompatible(request, "OpenAI")
  }
  if (provider === "deepseek") {
    return translateWithOpenAICompatible(request, "DeepSeek")
  }
  return translateWithOpenAICompatible(request)
}
