import { ActionContext, Context, Plugin, PluginInitParams, PublicAPI, Query, Result, WoxImage } from "@wox-launcher/wox-plugin"
import {
  DEFAULT_SETTINGS,
  getMissingConfiguration,
  historyKeyMatches,
  normalizeProvider,
  parseHistoryEntries,
  parseProviderList,
  parseTranslationQuery,
  PluginSettings,
  resolveLanguageDirection,
  searchHistoryEntries,
  translateText,
  TranslationHistoryEntry,
  TranslationProvider,
  upsertHistoryEntry
} from "./translate"

let api: PublicAPI

const HISTORY_SETTING_KEY = "translation_history"

const PLUGIN_ICON: WoxImage = {
  ImageType: "relative",
  ImageData: "images/app.svg"
}

async function getSetting(ctx: Context, key: string, fallback: string): Promise<string> {
  try {
    const value = await api.GetSetting(ctx, key)
    return value.trim() === "" ? fallback : value.trim()
  } catch {
    return fallback
  }
}

async function loadSettings(ctx: Context): Promise<PluginSettings> {
  const timeoutRaw = await getSetting(ctx, "request_timeout_ms", String(DEFAULT_SETTINGS.requestTimeoutMs))
  const timeoutMs = Number.parseInt(timeoutRaw, 10)
  const historyLimitRaw = await getSetting(ctx, "history_limit", String(DEFAULT_SETTINGS.historyLimit))
  const historyLimit = Number.parseInt(historyLimitRaw, 10)
  const showPreviewDetails = (await getSetting(ctx, "show_preview_details", String(DEFAULT_SETTINGS.showPreviewDetails))) === "true"

  return {
    defaultProvider: normalizeProvider(await getSetting(ctx, "default_provider", DEFAULT_SETTINGS.defaultProvider)),
    visibleProviders: parseProviderList(await getSetting(ctx, "visible_providers", DEFAULT_SETTINGS.visibleProviders.join(","))),
    defaultSourceLanguage: (await getSetting(ctx, "default_source_language", DEFAULT_SETTINGS.defaultSourceLanguage)) as "auto" | "en" | "zh",
    defaultTargetPolicy: "auto_zh_en",
    deeplPlan: (await getSetting(ctx, "deepl_plan", DEFAULT_SETTINGS.deeplPlan)) === "pro" ? "pro" : "free",
    deeplApiKey: await getSetting(ctx, "deepl_api_key", DEFAULT_SETTINGS.deeplApiKey),
    woxAiModel: await getSetting(ctx, "wox_ai_model", DEFAULT_SETTINGS.woxAiModel),
    openaiBaseUrl: await getSetting(ctx, "openai_base_url", DEFAULT_SETTINGS.openaiBaseUrl),
    openaiApiKey: await getSetting(ctx, "openai_api_key", DEFAULT_SETTINGS.openaiApiKey),
    openaiModel: await getSetting(ctx, "openai_model", DEFAULT_SETTINGS.openaiModel),
    requestTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_SETTINGS.requestTimeoutMs,
    showPreviewDetails,
    historyLimit: Number.isFinite(historyLimit) && historyLimit >= 0 ? historyLimit : DEFAULT_SETTINGS.historyLimit
  }
}

function providerCommand(provider: TranslationProvider): string {
  if (provider === "microsoft") return "ms"
  if (provider === "wox_ai") return "ai"
  if (provider === "openai_compatible") return "openai"
  return "deepl"
}

function providerDisplayName(provider: TranslationProvider): string {
  if (provider === "microsoft") return "Microsoft"
  if (provider === "deepl") return "DeepL"
  if (provider === "wox_ai") return "Wox AI"
  return "OpenAI compatible"
}

function buildHelpResult(): Result {
  return {
    Title: "Translate text",
    SubTitle: "Type tr hello, tr 你好, tr deepl hello, tr ai hello, or tr openai hello",
    Icon: PLUGIN_ICON,
    Score: 100,
    Preview: {
      PreviewType: "markdown",
      PreviewData: [
        "# Wox Translate",
        "",
        "- `tr hello` uses your default provider.",
        "- `tr ms hello` uses Microsoft.",
        "- `tr deepl hello` uses DeepL.",
        "- `tr ai hello` uses Wox AI.",
        "- `tr openai hello` uses OpenAI-compatible chat completions.",
        "- `tr history` shows recent translations.",
        "- `tr history hello` searches translation history."
      ].join("\n"),
      PreviewProperties: {}
    }
  }
}

async function loadHistory(ctx: Context): Promise<TranslationHistoryEntry[]> {
  return parseHistoryEntries(await getSetting(ctx, HISTORY_SETTING_KEY, "[]"))
}

async function saveHistory(ctx: Context, entries: TranslationHistoryEntry[]): Promise<void> {
  await api.SaveSetting(ctx, HISTORY_SETTING_KEY, JSON.stringify(entries), false)
}

function buildConfigurationResult(message: string, provider: TranslationProvider): Result {
  return {
    Title: `${providerDisplayName(provider)} needs configuration`,
    SubTitle: message,
    Icon: PLUGIN_ICON,
    Score: 100,
    Preview: {
      PreviewType: "markdown",
      PreviewData: `# Configuration required\n\n${message}\n\nOpen Wox plugin settings and update Wox Translate.`,
      PreviewProperties: {}
    }
  }
}

function errorMessageForProvider(error: unknown, provider: TranslationProvider): string {
  const message = error instanceof Error ? error.message : String(error)
  const suffix = provider === "microsoft" ? " The Microsoft no-setup provider uses an unofficial endpoint and may stop working." : ""
  return `${message}${suffix}`
}

function buildResultActions(translatedText: string, sourceText: string, provider: TranslationProvider): Result["Actions"] {
  const actions: Result["Actions"] = [
    {
      Name: "Copy translation",
      IsDefault: true,
      Action: async (ctx: Context) => {
        await api.Copy(ctx, { type: "text", text: translatedText })
      }
    },
    {
      Name: "Copy source text",
      Action: async (ctx: Context) => {
        await api.Copy(ctx, { type: "text", text: sourceText })
      }
    }
  ]

  for (const alternate of ["microsoft", "deepl", "wox_ai", "openai_compatible"] as TranslationProvider[]) {
    if (alternate === provider) {
      continue
    }
    actions.push({
      Name: `Retry with ${providerDisplayName(alternate)}`,
      ContextData: { provider: alternate },
      Action: async (ctx: Context, actionContext: ActionContext) => {
        const nextProvider = (actionContext.ContextData.provider || alternate) as TranslationProvider
        await api.ChangeQuery(ctx, {
          QueryType: "input",
          QueryText: `tr ${providerCommand(nextProvider)} ${sourceText}`
        })
      }
    })
  }

  return actions
}

function buildTranslationPreview(translatedText: string, sourceText: string, providerName: string, direction: string, showDetails: boolean): string {
  if (!showDetails) {
    return `# ${translatedText}`
  }

  return [`# ${translatedText}`, "", "## Source", sourceText, "", "## Details", `- Provider: ${providerName}`, `- Direction: ${direction}`].join("\n")
}

async function translateProviderResult(ctx: Context, provider: TranslationProvider, sourceText: string, settings: PluginSettings, score: number, includeProviderInTitle: boolean): Promise<Result> {
  const missingConfiguration = getMissingConfiguration(provider, settings)
  if (missingConfiguration) {
    return buildConfigurationResult(missingConfiguration, provider)
  }

  const direction = resolveLanguageDirection(sourceText, settings.defaultSourceLanguage)
  const history = await loadHistory(ctx)
  const historyEntry = history.find(entry => historyKeyMatches(entry, provider, sourceText, direction))
  if (historyEntry) {
    return buildTranslationResult(historyEntry, sourceText, settings, score, includeProviderInTitle, true)
  }

  try {
    const translation = await translateText(api, ctx, provider, {
      text: sourceText,
      direction,
      settings
    })
    const entry: TranslationHistoryEntry = {
      sourceText,
      translatedText: translation.translatedText,
      provider,
      providerName: translation.providerName,
      sourceLanguage: direction.sourceLanguage,
      targetLanguage: direction.targetLanguage,
      detectedSourceLanguage: translation.detectedSourceLanguage,
      timestamp: Date.now()
    }
    await saveHistory(ctx, upsertHistoryEntry(history, entry, settings.historyLimit))
    return buildTranslationResult(entry, sourceText, settings, score, includeProviderInTitle, false)
  } catch (error) {
    await api.Log(ctx, "Error", error instanceof Error ? error.stack || error.message : String(error))
    return {
      Title: `${providerDisplayName(provider)}: Translation failed`,
      SubTitle: errorMessageForProvider(error, provider),
      Icon: PLUGIN_ICON,
      Score: score,
      Preview: {
        PreviewType: "markdown",
        PreviewData: `# ${providerDisplayName(provider)} translation failed\n\n${errorMessageForProvider(error, provider)}`,
        PreviewProperties: {}
      }
    }
  }
}

function buildTranslationResult(entry: TranslationHistoryEntry, sourceText: string, settings: PluginSettings, score: number, includeProviderInTitle: boolean, fromHistory: boolean): Result {
  const subtitleParts = [`Source: ${sourceText}`, `${entry.sourceLanguage} -> ${entry.targetLanguage}`, "Enter to copy"]
  if (entry.detectedSourceLanguage) {
    subtitleParts.splice(1, 0, `detected ${entry.detectedSourceLanguage}`)
  }
  if (fromHistory) {
    subtitleParts.splice(1, 0, "history")
  }

  return {
    Title: includeProviderInTitle ? `${entry.providerName}: ${entry.translatedText}` : entry.translatedText,
    SubTitle: subtitleParts.join(" | "),
    Icon: PLUGIN_ICON,
    Score: score,
    Preview: {
      PreviewType: "markdown",
      PreviewData: buildTranslationPreview(entry.translatedText, sourceText, entry.providerName, `${entry.sourceLanguage} -> ${entry.targetLanguage}`, settings.showPreviewDetails),
      PreviewProperties: {}
    },
    Tails: [
      {
        Type: "text",
        Text: fromHistory ? "history" : providerDisplayName(entry.provider)
      }
    ],
    Actions: buildResultActions(entry.translatedText, sourceText, entry.provider)
  }
}

async function buildHistoryResults(ctx: Context, searchText: string, settings: PluginSettings): Promise<Result[]> {
  const entries = searchHistoryEntries(await loadHistory(ctx), searchText)
  if (entries.length === 0) {
    return [
      {
        Title: "No translation history",
        SubTitle: searchText.trim() === "" ? "Translate something first." : `No history matched: ${searchText}`,
        Icon: PLUGIN_ICON,
        Score: 100
      }
    ]
  }

  return entries.map((entry, index) => buildTranslationResult(entry, entry.sourceText, settings, 100 - index, true, true))
}

function parseHistoryQuery(search: string): string | null {
  const trimmed = search.trim()
  const match = /^(history|his)(?:\s+(.*))?$/i.exec(trimmed)
  if (!match) {
    return null
  }
  return match[2]?.trim() ?? ""
}

export const plugin: Plugin = {
  init: async (ctx: Context, initParams: PluginInitParams) => {
    api = initParams.API
    await api.Log(ctx, "Info", "Wox Translate initialized")
  },

  query: async (ctx: Context, query: Query): Promise<Result[]> => {
    const search = query.Type === "selection" ? query.Selection.Text : query.Search
    const settings = await loadSettings(ctx)
    const historySearch = parseHistoryQuery(search)
    if (historySearch !== null) {
      return buildHistoryResults(ctx, historySearch, settings)
    }
    const parsed = parseTranslationQuery(search, settings.defaultProvider)

    if (parsed.text === "") {
      return [buildHelpResult()]
    }

    const providers = parsed.forcedProvider || settings.visibleProviders.length === 0 ? [parsed.provider] : settings.visibleProviders
    return Promise.all(providers.map((provider, index) => translateProviderResult(ctx, provider, parsed.text, settings, 100 - index, providers.length > 1)))
  }
}
