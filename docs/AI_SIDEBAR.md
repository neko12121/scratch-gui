# AI先生サイドバー

エディターの右側に AI チャットを追加する改造です。

## できること

- プログラミングの質問に、初心者向けにやさしく答える
- 「コードを説明して」「バグを探して」などのワンクリック質問
- 今見ているスプライトのコードを自動で AI に渡す（opcode 形式のテキスト）
- AI が作ったブロックをプレビュー表示し、「エディターに追加」「置き換え」でワークスペースに入れる
  （Ctrl+Z で 1 回で元に戻せます）
- 変数・リストのブロックも作成可能（存在しない変数は自動で作られます）
- サイドバーは「×」で折りたためます（状態は保存されます）

## 使い方

1. AI プロキシを起動（API キーをサーバー側に置く方法・推奨）

   ```bash
   AI_API_KEY=sk-xxxx node ai-proxy/server.mjs
   ```

2. エディターを起動

   ```bash
   npm ci
   npm start
   ```

3. http://localhost:8601/ を開き、右側の「AI先生」に質問する

### プロキシを使わない場合

サイドバーの「設定」から、OpenAI 互換 API のエンドポイント・キー・モデルを直接入力できます。
キーはブラウザの localStorage に保存されるため、自分だけで使う場合に限ってください。

| サービス | エンドポイント例 | モデル例 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| OpenRouter | `https://openrouter.ai/api/v1` | 任意 |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` など |
| Ollama（ローカル・無料） | `http://localhost:11434/v1` | `qwen2.5-coder` など |

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/containers/ai-sidebar.jsx` | 状態管理・AI 呼び出し・ブロック挿入 |
| `src/components/ai-sidebar/ai-sidebar.jsx` | サイドバーの UI |
| `src/components/ai-sidebar/message-content.jsx` | 回答の表示（簡易 Markdown、ブロックカード） |
| `src/components/ai-sidebar/block-preview.jsx` | 読み取り専用の Blockly でブロックをプレビュー |
| `src/lib/ai/ai-client.js` | OpenAI 互換 API クライアント（ストリーミング対応） |
| `src/lib/ai/prompts.js` | システムプロンプト・クイック質問 |
| `src/lib/ai/script-to-text.js` | スプライトのコード → AI 用テキスト |
| `src/lib/ai/json-to-blocks.js` | AI の JSON → scratch-blocks XML → ワークスペース |
| `ai-proxy/server.mjs` | API キーを隠す依存ゼロの Node プロキシ |
| `src/components/gui/gui.jsx` | サイドバーをレイアウトに追加（1 行） |

## AI が出力するブロック形式

````
```scratch-blocks
{
  "mode": "add",
  "scripts": [[
    {"opcode": "event_whenflagclicked"},
    {"opcode": "control_forever", "inputs": {"SUBSTACK": [
      {"opcode": "motion_movesteps", "inputs": {"STEPS": 10}}
    ]}}
  ]]
}
```
````

数値・文字・メニューの初期値（シャドウ）はツールボックス XML から自動でコピーされるので、
AI は opcode と入力名だけ知っていれば OK です。

## カスタマイズのヒント

- 先生の口調やルール: `src/lib/ai/prompts.js` の `SYSTEM_PROMPT`
- クイック質問ボタン: 同じファイルの `QUICK_PROMPTS`
- サイドバーの幅・色: `src/components/ai-sidebar/ai-sidebar.css`
