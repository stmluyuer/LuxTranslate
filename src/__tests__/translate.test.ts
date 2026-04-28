import {
  DEFAULT_SETTINGS,
  detectLanguage,
  getMissingConfiguration,
  historyKeyMatches,
  parseHistoryEntries,
  parseProviderList,
  parseProviderTableRows,
  parseTranslationQuery,
  resolveLanguageDirection,
  searchHistoryEntries,
  translateWithCaiyun,
  translateWithDeepL,
  translateWithMicrosoft,
  translateWithClaude,
  translateWithOpenAICompatible,
  translateWithYoudao,
  upsertHistoryEntry
} from "../translate"

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body)
  } as Response
}

function firstFetchCall(fetchMock: jest.Mock): [string, RequestInit] {
  return fetchMock.mock.calls[0] as [string, RequestInit]
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>
}

function caiyunEncrypt(plainText: string): string {
  const normalKey = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=.+-_/"
  const cipherKey = "NOPQRSTUVWXYZABCDEFGHIJKLMnopqrstuvwxyzabcdefghijklm0123456789=.+-_/"
  const map: Record<string, string> = {}
  for (let i = 0; i < normalKey.length; i++) {
    map[normalKey[i]] = cipherKey[i]
  }
  return Buffer.from(plainText, "utf8")
    .toString("base64")
    .split("")
    .map(char => map[char] ?? char)
    .join("")
}

describe("language detection (8 languages)", () => {
  test("detects Chinese via CJK", () => {
    expect(detectLanguage("你好世界")).toBe("zh")
    expect(detectLanguage("今天天气不错")).toBe("zh")
  })

  test("detects Japanese via Kana", () => {
    expect(detectLanguage("こんにちは")).toBe("ja")
    expect(detectLanguage("今日はいい天気ですね")).toBe("ja")
    expect(detectLanguage("私は中国人です")).toBe("ja")
  })

  test("detects Korean via Hangul", () => {
    expect(detectLanguage("안녕하세요")).toBe("ko")
    expect(detectLanguage("감사합니다")).toBe("ko")
  })

  test("detects Russian via Cyrillic", () => {
    expect(detectLanguage("Привет")).toBe("ru")
    expect(detectLanguage("Здравствуйте как дела")).toBe("ru")
  })

  test("detects Arabic via Arabic script", () => {
    expect(detectLanguage("مرحبا")).toBe("ar")
    expect(detectLanguage("كيف حالك")).toBe("ar")
  })

  test("detects German via specific chars", () => {
    expect(detectLanguage("schön und großartig")).toBe("de")
    expect(detectLanguage("für die Prüfung")).toBe("de")
  })

  test("detects French via specific chars", () => {
    expect(detectLanguage("Bonjour ça va")).toBe("fr")
    expect(detectLanguage("très bien merci")).toBe("fr")
  })

  test("detects English as default for Latin text", () => {
    expect(detectLanguage("hello world")).toBe("en")
    expect(detectLanguage("this is a test")).toBe("en")
  })

  test("returns English for empty/symbol text", () => {
    expect(detectLanguage("123")).toBe("en")
    expect(detectLanguage("")).toBe("en")
  })
})

describe("resolveLanguageDirection (8 languages)", () => {
  test("translates non-Wox language to Wox language", () => {
    const dir = resolveLanguageDirection("привет мир", "auto", "zh")
    expect(dir.sourceLanguage).toBe("auto")
    expect(dir.targetLanguage).toBe("zh")
    expect(dir.targetLabel).toBe("Chinese")
  })

  test("translates Wox language to paired language", () => {
    const dir = resolveLanguageDirection("你好世界", "auto", "zh")
    expect(dir.sourceLanguage).toBe("auto")
    expect(dir.targetLanguage).toBe("en")
    expect(dir.targetLabel).toBe("English")
  })

  test("can honor a fixed target through the pair language", () => {
    const dir = resolveLanguageDirection("hello", "zh", "zh", "zh")
    expect(dir.targetLanguage).toBe("zh")
    expect(dir.targetLabel).toBe("Chinese")
  })

  test("uses explicit source language", () => {
    const dir = resolveLanguageDirection("hello", "zh", "en")
    expect(dir.sourceLanguage).toBe("zh")
    expect(dir.targetLanguage).toBe("en")
  })

  test("returns correct Microsoft target codes", () => {
    expect(resolveLanguageDirection("你好", "auto", "zh").microsoftTarget).toBe("en")
    expect(resolveLanguageDirection("hello", "auto", "zh").microsoftTarget).toBe("zh-Hans")
    expect(resolveLanguageDirection("こんにちは", "auto", "zh").microsoftTarget).toBe("zh-Hans")
  })

  test("returns correct DeepL target codes", () => {
    expect(resolveLanguageDirection("안녕", "auto", "zh").deeplTarget).toBe("ZH")
    expect(resolveLanguageDirection("hello", "auto", "ko").deeplTarget).toBe("KO")
  })
})

describe("query parsing", () => {
  test("uses default provider when no provider command is present", () => {
    expect(parseTranslationQuery("hello world", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello world",
      forcedProvider: false
    })
  })

  test("parses provider commands", () => {
    expect(parseTranslationQuery("ms hello", "deepl")).toMatchObject({ provider: "microsoft", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("deepl hello", "microsoft")).toMatchObject({ provider: "deepl", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("ai hello", "microsoft")).toMatchObject({ provider: "microsoft", text: "ai hello", forcedProvider: false })
    expect(parseTranslationQuery("openai hello", "microsoft")).toMatchObject({ provider: "openai", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("claude hello", "microsoft")).toMatchObject({ provider: "claude", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("deepseek hello", "microsoft")).toMatchObject({ provider: "deepseek", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("custom hello", "microsoft")).toMatchObject({ provider: "llm_custom", text: "hello", forcedProvider: true })
  })

  test("parses target language from bare code", () => {
    expect(parseTranslationQuery("zh hello world", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello world",
      targetLanguage: "zh",
      forcedProvider: false
    })
    expect(parseTranslationQuery("en hello", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello",
      targetLanguage: "en"
    })
    expect(parseTranslationQuery("ja hello", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello",
      targetLanguage: "ja"
    })
  })

  test("parses source:target language spec", () => {
    expect(parseTranslationQuery("en:zh hello", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello",
      sourceLanguage: "en",
      targetLanguage: "zh"
    })
    expect(parseTranslationQuery("ja:en こんにちは", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "こんにちは",
      sourceLanguage: "ja",
      targetLanguage: "en"
    })
  })

  test("parses auto:zh and :zh syntax", () => {
    expect(parseTranslationQuery("auto:zh hello", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello",
      targetLanguage: "zh",
      sourceLanguage: undefined
    })
    expect(parseTranslationQuery(":zh hello", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello",
      targetLanguage: "zh"
    })
  })

  test("parses provider + target language combo", () => {
    expect(parseTranslationQuery("ms zh hello", "deepl")).toMatchObject({
      provider: "microsoft",
      text: "hello",
      targetLanguage: "zh",
      forcedProvider: true
    })
    expect(parseTranslationQuery("deepl en:ja hello world", "microsoft")).toMatchObject({
      provider: "deepl",
      text: "hello world",
      sourceLanguage: "en",
      targetLanguage: "ja",
      forcedProvider: true
    })
  })

  test("ignores non-language words as target spec", () => {
    expect(parseTranslationQuery("hello world", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "hello world",
      targetLanguage: undefined
    })
    expect(parseTranslationQuery("xx hello", "microsoft")).toMatchObject({
      provider: "microsoft",
      text: "xx hello",
      targetLanguage: undefined
    })
  })

  test("parses visible provider lists", () => {
    expect(parseProviderList("microsoft,openai,deepseek,openai")).toEqual(["microsoft", "openai", "deepseek"])
    expect(parseProviderList(JSON.stringify(["deepl", "unknown"]))).toEqual(["deepl"])
    expect(parseProviderList("")).toEqual([])
  })

  test("parses provider configuration rows", () => {
    const rows = [{ provider: "microsoft" }, { provider: "openai", apiKey: "openai-key", baseUrl: "https://example.com/v1", model: "model-a" }, { provider: "unknown" }]
    expect(parseProviderTableRows(JSON.stringify(rows))).toHaveLength(2)
    expect(parseProviderTableRows(JSON.stringify(rows))[1]).toMatchObject({ provider: "openai", apiKey: "openai-key", baseUrl: "https://example.com/v1", model: "model-a" })
  })
})

describe("configuration checks", () => {
  test("reports missing provider settings", () => {
    expect(getMissingConfiguration("microsoft", DEFAULT_SETTINGS)).toBeNull()
    expect(getMissingConfiguration("deepl", DEFAULT_SETTINGS)).toContain("DeepL API key")
    expect(getMissingConfiguration("openai", DEFAULT_SETTINGS)).toContain("API key")
  })
})

describe("translation history", () => {
  test("parses, searches, upserts, and matches history entries", () => {
    const direction = resolveLanguageDirection("hello", "auto", "zh")
    const firstEntry = {
      sourceText: "hello",
      translatedText: "你好",
      provider: "microsoft" as const,
      providerName: "Microsoft",
      sourceLanguage: direction.sourceLanguage,
      targetLanguage: direction.targetLanguage,
      timestamp: 1
    }
    const secondEntry = {
      ...firstEntry,
      sourceText: "world",
      translatedText: "世界",
      timestamp: 2
    }

    const entries = upsertHistoryEntry(upsertHistoryEntry([], firstEntry, 10), secondEntry, 1)
    expect(entries).toEqual([secondEntry])
    expect(searchHistoryEntries([firstEntry, secondEntry], "hell")).toEqual([firstEntry])
    expect(parseHistoryEntries(JSON.stringify([firstEntry]))).toEqual([firstEntry])
    expect(historyKeyMatches(firstEntry, "microsoft", "hello", direction)).toBe(true)
  })
})

describe("provider requests", () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
    jest.useRealTimers()
  })

  test("calls Microsoft no-setup endpoint and parses response", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse([
        {
          detectedLanguage: { language: "en" },
          translations: [{ text: "你好" }]
        }
      ])
    )
    global.fetch = fetchMock as typeof fetch

    const result = await translateWithMicrosoft({
      text: "hello",
      direction: resolveLanguageDirection("hello", "auto", "zh"),
      settings: DEFAULT_SETTINGS
    })

    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toContain("api.cognitive.microsofttranslator.com/translate")
    expect(headersOf(init)["X-MT-Signature"]).toContain("MSTranslatorAndroidApp::")
    expect(headersOf(init).Authorization).toBeUndefined()
    expect(init.body).toBe(JSON.stringify([{ Text: "hello" }]))
    expect(result.translatedText).toBe("你好")
    expect(result.detectedSourceLanguage).toBe("en")
  })

  test("passes explicit source language to Microsoft endpoint", async () => {
    const fetchMock = jest.fn(async () =>
      jsonResponse([
        {
          translations: [{ text: "world-translated" }]
        }
      ])
    )
    global.fetch = fetchMock as typeof fetch

    const result = await translateWithMicrosoft({
      text: "world",
      direction: resolveLanguageDirection("world", "en", "zh"),
      settings: DEFAULT_SETTINGS
    })

    const [url] = firstFetchCall(fetchMock)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(url).toContain("from=en")
    expect(result.translatedText).toBe("world-translated")
  })

  test("calls DeepL free endpoint with auth header and target language", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ translations: [{ detected_source_language: "EN", text: "你好" }] }))
    global.fetch = fetchMock as typeof fetch

    const result = await translateWithDeepL({
      text: "hello",
      direction: resolveLanguageDirection("hello", "auto", "zh"),
      settings: { ...DEFAULT_SETTINGS, deeplApiKey: "secret" }
    })

    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toBe("https://api-free.deepl.com/v2/translate")
    expect(headersOf(init).Authorization).toBe("DeepL-Auth-Key secret")
    expect(JSON.parse(init.body as string).target_lang).toBe("ZH")
    expect(result.translatedText).toBe("你好")
  })

  test("calls OpenAI-compatible chat completions endpoint", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ choices: [{ message: { content: "你好" } }] }))
    global.fetch = fetchMock as typeof fetch

    const result = await translateWithOpenAICompatible({
      text: "hello",
      direction: resolveLanguageDirection("hello", "auto", "zh"),
      settings: { ...DEFAULT_SETTINGS, openaiApiKey: "token", openaiBaseUrl: "https://example.com/v1/", openaiModel: "model-a" }
    })

    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toBe("https://example.com/v1/chat/completions")
    expect(headersOf(init).Authorization).toBe("Bearer token")
    expect(JSON.parse(init.body as string).model).toBe("model-a")
    expect(result.translatedText).toBe("你好")
  })

  test("calls Claude messages endpoint", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ content: [{ type: "text", text: "你好" }] }))
    global.fetch = fetchMock as typeof fetch

    const result = await translateWithClaude({
      text: "hello",
      direction: resolveLanguageDirection("hello", "auto", "zh"),
      settings: { ...DEFAULT_SETTINGS, openaiApiKey: "token", openaiBaseUrl: "https://api.anthropic.com/v1/", openaiModel: "claude-test" }
    })

    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toBe("https://api.anthropic.com/v1/messages")
    expect(headersOf(init)["x-api-key"]).toBe("token")
    expect(JSON.parse(init.body as string).model).toBe("claude-test")
    expect(result.translatedText).toBe("你好")
  })

  test("calls Youdao no-setup endpoint", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ translateResult: [[{ tgt: "你好" }]] }))
    global.fetch = fetchMock as typeof fetch

    const result = await translateWithYoudao({
      text: "hello",
      direction: resolveLanguageDirection("hello", "auto", "zh"),
      settings: DEFAULT_SETTINGS
    })

    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toContain("dict.youdao.com/dicttranslate")
    expect(init.method).toBe("POST")
    expect(init.body).toBe("i=hello")
    expect(result.translatedText).toBe("你好")
  })

  test("calls Caiyun no-setup translator endpoint", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 204))
      .mockResolvedValueOnce(jsonResponse({ jwt: "jwt-token" }))
      .mockResolvedValueOnce(jsonResponse({}, 204))
      .mockResolvedValueOnce(jsonResponse({ target: caiyunEncrypt("你好"), rc: 0 }))
    global.fetch = fetchMock as typeof fetch

    const direction = resolveLanguageDirection("hello", "auto", "zh")
    const result = await translateWithCaiyun({
      text: "hello",
      direction,
      settings: DEFAULT_SETTINGS
    })

    const [url, init] = fetchMock.mock.calls[3] as [string, RequestInit]
    expect(url).toBe("https://api.interpreter.caiyunai.com/v1/translator")
    expect(headersOf(init)["X-Authorization"]).toContain("token:")
    expect(headersOf(init)["T-Authorization"]).toBe("jwt-token")
    const body = JSON.parse(init.body as string)
    expect(body.source).toBe("hello")
    expect(body.trans_type).toBe("auto2zh")
    expect(body.detect).toBe(true)
    expect(result.translatedText).toBe("你好")
    expect(result.providerName).toBe("Caiyun")
  })

  test("rejects unsupported Caiyun target languages", async () => {
    global.fetch = jest.fn() as typeof fetch

    await expect(
      translateWithCaiyun({
        text: "hello",
        direction: resolveLanguageDirection("hello", "auto", "ja"),
        settings: DEFAULT_SETTINGS
      })
    ).rejects.toThrow("Caiyun only supports Chinese and English target languages.")
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test("surfaces provider failures", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ error: "bad key" }, 403)) as typeof fetch

    await expect(
      translateWithDeepL({
        text: "hello",
        direction: resolveLanguageDirection("hello", "auto", "zh"),
        settings: { ...DEFAULT_SETTINGS, deeplApiKey: "bad" }
      })
    ).rejects.toThrow("403")
  })
})
