import { ActionContext, Context, Plugin, PluginInitParams, PublicAPI, Query, Result, WoxImage } from "@wox-launcher/wox-plugin"
import { DEFAULT_SETTINGS, getMissingConfiguration, normalizeProvider, parseTranslationQuery, PluginSettings, resolveLanguageDirection, translateText, TranslationProvider } from "./translate"

let api: PublicAPI

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
  const showPreviewDetails = (await getSetting(ctx, "show_preview_details", String(DEFAULT_SETTINGS.showPreviewDetails))) === "true"

  return {
    defaultProvider: normalizeProvider(await getSetting(ctx, "default_provider", DEFAULT_SETTINGS.defaultProvider)),
    defaultSourceLanguage: (await getSetting(ctx, "default_source_language", DEFAULT_SETTINGS.defaultSourceLanguage)) as "auto" | "en" | "zh",
    defaultTargetPolicy: "auto_zh_en",
    deeplPlan: (await getSetting(ctx, "deepl_plan", DEFAULT_SETTINGS.deeplPlan)) === "pro" ? "pro" : "free",
    deeplApiKey: await getSetting(ctx, "deepl_api_key", DEFAULT_SETTINGS.deeplApiKey),
    woxAiModel: await getSetting(ctx, "wox_ai_model", DEFAULT_SETTINGS.woxAiModel),
    openaiBaseUrl: await getSetting(ctx, "openai_base_url", DEFAULT_SETTINGS.openaiBaseUrl),
    openaiApiKey: await getSetting(ctx, "openai_api_key", DEFAULT_SETTINGS.openaiApiKey),
    openaiModel: await getSetting(ctx, "openai_model", DEFAULT_SETTINGS.openaiModel),
    requestTimeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_SETTINGS.requestTimeoutMs,
    showPreviewDetails
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
        "- `tr openai hello` uses OpenAI-compatible chat completions."
      ].join("\n"),
      PreviewProperties: {}
    }
  }
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

function buildErrorResult(error: unknown, provider: TranslationProvider): Result {
  const message = error instanceof Error ? error.message : String(error)
  const suffix = provider === "microsoft" ? " The Microsoft no-setup provider uses an unofficial endpoint and may stop working." : ""
  return {
    Title: "Translation failed",
    SubTitle: `${message}${suffix}`,
    Icon: PLUGIN_ICON,
    Score: 100,
    Preview: {
      PreviewType: "markdown",
      PreviewData: `# Translation failed\n\n${message}${suffix}`,
      PreviewProperties: {}
    }
  }
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

export const plugin: Plugin = {
  init: async (ctx: Context, initParams: PluginInitParams) => {
    api = initParams.API
    await api.Log(ctx, "Info", "Wox Translate initialized")
  },

  query: async (ctx: Context, query: Query): Promise<Result[]> => {
    const search = query.Type === "selection" ? query.Selection.Text : query.Search
    const settings = await loadSettings(ctx)
    const parsed = parseTranslationQuery(search, settings.defaultProvider)

    if (parsed.text === "") {
      return [buildHelpResult()]
    }

    const missingConfiguration = getMissingConfiguration(parsed.provider, settings)
    if (missingConfiguration) {
      return [buildConfigurationResult(missingConfiguration, parsed.provider)]
    }

    const direction = resolveLanguageDirection(parsed.text, settings.defaultSourceLanguage)
    try {
      const translation = await translateText(api, ctx, parsed.provider, {
        text: parsed.text,
        direction,
        settings
      })
      const subtitleParts = [`${translation.providerName}`, `${direction.sourceLanguage} -> ${direction.targetLanguage}`, "Enter to copy"]
      if (translation.detectedSourceLanguage) {
        subtitleParts.splice(1, 0, `detected ${translation.detectedSourceLanguage}`)
      }

      return [
        {
          Title: translation.translatedText,
          SubTitle: subtitleParts.join(" | "),
          Icon: PLUGIN_ICON,
          Score: 100,
          Preview: {
            PreviewType: "markdown",
            PreviewData: buildTranslationPreview(
              translation.translatedText,
              parsed.text,
              translation.providerName,
              `${direction.sourceLanguage} -> ${direction.targetLanguage}`,
              settings.showPreviewDetails
            ),
            PreviewProperties: {}
          },
          Tails: [
            {
              Type: "text",
              Text: parsed.forcedProvider ? providerDisplayName(parsed.provider) : "default"
            }
          ],
          Actions: buildResultActions(translation.translatedText, parsed.text, parsed.provider)
        }
      ]
    } catch (error) {
      await api.Log(ctx, "Error", error instanceof Error ? error.stack || error.message : String(error))
      return [buildErrorResult(error, parsed.provider)]
    }
  }
}
