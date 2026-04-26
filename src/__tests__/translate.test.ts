import {
  DEFAULT_SETTINGS,
  getMissingConfiguration,
  historyKeyMatches,
  parseHistoryEntries,
  parseProviderList,
  parseProviderTableProviders,
  parseTranslationQuery,
  resolveLanguageDirection,
  searchHistoryEntries,
  translateWithDeepL,
  translateWithMicrosoft,
  translateWithOpenAICompatible,
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

describe("query parsing", () => {
  test("uses default provider when no provider command is present", () => {
    expect(parseTranslationQuery("hello world", "microsoft")).toEqual({
      provider: "microsoft",
      text: "hello world",
      forcedProvider: false
    })
  })

  test("parses provider commands", () => {
    expect(parseTranslationQuery("ms hello", "deepl")).toMatchObject({ provider: "microsoft", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("deepl hello", "microsoft")).toMatchObject({ provider: "deepl", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("ai hello", "microsoft")).toMatchObject({ provider: "wox_ai", text: "hello", forcedProvider: true })
    expect(parseTranslationQuery("openai hello", "microsoft")).toMatchObject({ provider: "openai_compatible", text: "hello", forcedProvider: true })
  })

  test("parses visible provider lists", () => {
    expect(parseProviderList("microsoft,openai_compatible,deepl,openai_compatible")).toEqual(["microsoft", "openai_compatible", "deepl"])
    expect(parseProviderList("")).toEqual([])
  })

  test("parses enabled providers from provider table rows", () => {
    expect(
      parseProviderTableProviders(
        JSON.stringify([
          { enabled: false, provider: "microsoft" },
          { enabled: "true", provider: "deepl" },
          { enabled: true, provider: "openai_compatible" },
          { enabled: true, provider: "unknown" }
        ])
      )
    ).toEqual(["deepl", "openai_compatible"])
  })
})

describe("language direction", () => {
  test("translates English and non-Chinese text to Chinese", () => {
    expect(resolveLanguageDirection("hello").targetLanguage).toBe("zh")
    expect(resolveLanguageDirection("bonjour").deeplTarget).toBe("ZH")
  })

  test("translates Chinese text to English", () => {
    const direction = resolveLanguageDirection("你好，世界")
    expect(direction.targetLanguage).toBe("en")
    expect(direction.deeplTarget).toBe("EN-US")
  })
})

describe("configuration checks", () => {
  test("reports missing provider settings", () => {
    expect(getMissingConfiguration("microsoft", DEFAULT_SETTINGS)).toBeNull()
    expect(getMissingConfiguration("deepl", DEFAULT_SETTINGS)).toContain("DeepL API key")
    expect(getMissingConfiguration("openai_compatible", DEFAULT_SETTINGS)).toContain("OpenAI-compatible API key")
  })
})

describe("translation history", () => {
  test("parses, searches, upserts, and matches history entries", () => {
    const direction = resolveLanguageDirection("hello")
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
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "edge-token"
      } as Response)
      .mockResolvedValueOnce(
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
      direction: resolveLanguageDirection("hello"),
      settings: DEFAULT_SETTINGS
    })

    expect(fetchMock.mock.calls[0][0]).toBe("https://edge.microsoft.com/translate/auth")
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toContain("api-edge.cognitive.microsofttranslator.com/translate")
    expect(headersOf(init).Authorization).toBe("Bearer edge-token")
    expect(init.body).toBe(JSON.stringify([{ Text: "hello" }]))
    expect(result.translatedText).toBe("你好")
    expect(result.detectedSourceLanguage).toBe("en")
  })

  test("calls DeepL free endpoint with auth header and target language", async () => {
    const fetchMock = jest.fn(async () => jsonResponse({ translations: [{ detected_source_language: "EN", text: "你好" }] }))
    global.fetch = fetchMock as typeof fetch

    const result = await translateWithDeepL({
      text: "hello",
      direction: resolveLanguageDirection("hello"),
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
      direction: resolveLanguageDirection("hello"),
      settings: { ...DEFAULT_SETTINGS, openaiApiKey: "token", openaiBaseUrl: "https://example.com/v1/", openaiModel: "model-a" }
    })

    const [url, init] = firstFetchCall(fetchMock)
    expect(url).toBe("https://example.com/v1/chat/completions")
    expect(headersOf(init).Authorization).toBe("Bearer token")
    expect(JSON.parse(init.body as string).model).toBe("model-a")
    expect(result.translatedText).toBe("你好")
  })

  test("surfaces provider failures", async () => {
    global.fetch = jest.fn(async () => jsonResponse({ error: "bad key" }, 403)) as typeof fetch

    await expect(
      translateWithDeepL({
        text: "hello",
        direction: resolveLanguageDirection("hello"),
        settings: { ...DEFAULT_SETTINGS, deeplApiKey: "bad" }
      })
    ).rejects.toThrow("403")
  })
})
