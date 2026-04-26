import { AI, Context, PublicAPI } from "@wox-launcher/wox-plugin"

export type TranslationProvider = "microsoft" | "deepl" | "wox_ai" | "openai_compatible"

export interface PluginSettings {
  defaultProvider: TranslationProvider
  visibleProviders: TranslationProvider[]
  providerRows: ProviderTableRow[]
  defaultSourceLanguage: "auto" | "en" | "zh"
  defaultTargetPolicy: "auto_zh_en"
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
  sourceLanguage: "auto" | "en" | "zh"
  targetLanguage: "en" | "zh"
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
  sourceLanguage: "auto" | "en" | "zh"
  targetLanguage: "en" | "zh"
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
  deepl: "deepl",
  ai: "wox_ai",
  wox_ai: "wox_ai",
  woxai: "wox_ai",
  openai: "openai_compatible",
  openai_compatible: "openai_compatible"
}

let microsoftAuthToken = ""

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultProvider: "microsoft",
  visibleProviders: [],
  providerRows: [],
  defaultSourceLanguage: "auto",
  defaultTargetPolicy: "auto_zh_en",
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
  if (value === "deepl" || value === "wox_ai" || value === "openai_compatible" || value === "microsoft") {
    return value
  }
  return DEFAULT_SETTINGS.defaultProvider
}

function isTranslationProvider(value: string): value is TranslationProvider {
  return value === "microsoft" || value === "deepl" || value === "wox_ai" || value === "openai_compatible"
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

export function hasSignificantChineseText(text: string): boolean {
  let cjk = 0
  let total = 0

  for (const char of text) {
    if (/\s/.test(char)) {
      continue
    }
    const code = char.codePointAt(0)
    if (code === undefined) {
      continue
    }
    if ((code >= 0x21 && code <= 0x40) || (code >= 0x5b && code <= 0x60) || (code >= 0x7b && code <= 0x7e) || (code >= 0xff00 && code <= 0xffef)) {
      continue
    }
    total++
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf) || (code >= 0xf900 && code <= 0xfaff)) {
      cjk++
    }
  }

  return total > 0 && cjk / total > 0.2
}

export function resolveLanguageDirection(text: string, sourceLanguage: "auto" | "en" | "zh" = "auto"): LanguageDirection {
  const source = sourceLanguage === "auto" ? (hasSignificantChineseText(text) ? "zh" : "en") : sourceLanguage
  if (source === "zh") {
    return {
      sourceLanguage: sourceLanguage === "auto" ? "auto" : "zh",
      targetLanguage: "en",
      targetLabel: "English",
      microsoftTarget: "en",
      deeplTarget: "EN-US"
    }
  }

  return {
    sourceLanguage: sourceLanguage === "auto" ? "auto" : "en",
    targetLanguage: "zh",
    targetLabel: "Chinese",
    microsoftTarget: "zh-Hans",
    deeplTarget: "ZH"
  }
}

export function getMissingConfiguration(provider: TranslationProvider, settings: PluginSettings): string | null {
  if (provider === "deepl" && settings.deeplApiKey.trim() === "") {
    return "DeepL API key is required for DeepL translation."
  }
  if (provider === "openai_compatible" && settings.openaiApiKey.trim() === "") {
    return "OpenAI-compatible API key is required for OpenAI-compatible translation."
  }
  if (provider === "openai_compatible" && settings.openaiModel.trim() === "") {
    return "OpenAI-compatible model is required."
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

export async function translateWithOpenAICompatible(request: TranslationRequest): Promise<TranslationResponse> {
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
  const json = (await parseJsonResponse(response, "OpenAI-compatible")) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const translatedText = requireString(json.choices?.[0]?.message?.content, "OpenAI-compatible provider returned an empty translation.")

  return {
    translatedText,
    providerName: "OpenAI compatible"
  }
}

export async function translateText(api: PublicAPI, ctx: Context, provider: TranslationProvider, request: TranslationRequest): Promise<TranslationResponse> {
  if (provider === "microsoft") {
    return translateWithMicrosoft(request)
  }
  if (provider === "deepl") {
    return translateWithDeepL(request)
  }
  if (provider === "wox_ai") {
    return translateWithWoxAI(api, ctx, request)
  }
  return translateWithOpenAICompatible(request)
}
