# LuxTranslate

[English](README.en.md) | [中文](README.md)

> **Beta Notice**: This plugin is still a test version and has not been fully tested. If you run into a serious bug, I apologize in advance. Please report it through GitHub Issues and I will fix it as soon as I can.

LuxTranslate is a translation plugin for [Wox](https://github.com/Wox-launcher/Wox). It uses the `tr` trigger keyword and detects the default direction automatically: Chinese text is translated to English, while other text is translated to Chinese by default.

## Features

- Quick translation with `tr <text>` and Enter-to-copy result actions.
- Lightweight Chinese/English direction detection.
- Multiple providers displayed in the same query.
- Translation history cache to avoid repeated API calls.
- Optional preview details for source text, provider, and language direction.
- Provider settings grouped by category, with API keys, base URLs, and models configured from editable table rows.

## Providers

LuxTranslate groups providers into three categories:

| Category              | Providers                                                   |
| --------------------- | ----------------------------------------------------------- |
| No-setup translation  | Microsoft, Youdao, Caiyun                                   |
| Large language models | OpenAI, Claude, DeepSeek, custom OpenAI-compatible endpoint |

Notes:

- Microsoft uses the same no-setup signed translator endpoint pattern used by LunaTranslator. It is not an official Azure Translator API contract and may change.
- Youdao uses the signed desktop dictionary translation endpoint for lightweight lookups.
- Caiyun uses the web translator JWT flow used by LunaTranslator for lightweight lookups.
- OpenAI, DeepSeek, and custom LLM providers use the OpenAI-compatible chat completions format.
- Claude uses the Anthropic Messages API format.

## Installation

The repository is prepared for Wox Store packaging. Publish a GitHub release with the generated `.wox` asset before submitting the store entry.

```bash
git clone https://github.com/stmluyuer/LuxTranslate.git
cd LuxTranslate
pnpm install
pnpm build
make package
```

The build output is written to `dist/`. `make package` creates `wox.plugin.luxtranslate.wox` for GitHub Releases and Wox Store download URLs.

## Usage

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `tr hello`          | Use the default provider           |
| `tr 你好`           | Translate to English automatically |
| `tr ms hello`       | Force Microsoft                    |
| `tr youdao hello`   | Force Youdao                       |
| `tr caiyun hello`   | Force Caiyun                       |
| `tr openai hello`   | Force OpenAI                       |
| `tr claude hello`   | Force Claude                       |
| `tr deepseek hello` | Force DeepSeek                     |
| `tr custom hello`   | Force the custom LLM endpoint      |
| `tr history`        | Show recent translation history    |
| `tr history hello`  | Search translation history         |

### Tip

LuxTranslate works well with Wox's built-in quick query feature. Bind a hotkey to `tr {wox:selected_text}` to translate the currently selected text from any app without typing the query manually.

## Configuration

- `Default provider`: provider used by normal `tr <text>` queries.
- `Visible providers`: choose multiple providers to display several results at once.
- `No-setup providers`: manage Microsoft, Youdao, and Caiyun-style providers.
- `Large language model providers`: configure OpenAI-compatible API keys, base URLs, and model names for OpenAI, Claude, DeepSeek, or custom endpoints.
- `History limit`: keeps 10 entries by default.
- `Show source and provider details`: controls whether previews include source text, provider, and direction details.

## Development

```bash
pnpm install
pnpm test
pnpm build
```

Useful scripts:

- `pnpm test`: run Jest tests.
- `pnpm build`: run lint, format, and bundle to `dist/`.
- `pnpm run lint`: run ESLint.

## Screenshots

![Basic translation result](screenshots/query-result.jpg)

![Multiple provider results](screenshots/multi-provider-result.jpg)

![Plugin basic settings](screenshots/settings-basic.jpg)

![Large language model provider settings](screenshots/settings-llm-table.jpg)

![Large language model row editor](screenshots/settings-llm-edit.jpg)

![Quick query tip](screenshots/quick-query-tip.jpg)

## AI Assistance Disclosure

This project was substantially generated, refactored, and tested with assistance from OpenAI Codex 5.5. The author was responsible for requirements, code review, validation, and release decisions.

## License

MIT License. See [LICENSE](LICENSE).
