# Study Recorder Discord Bot

Discord の指定チャンネルに送られた勉強分数を記録し、毎日の目標・進捗・推移を通知する Bot です。

## 機能

- 指定チャンネルで `25` のように数字だけを送信すると、その分数を記録
- JSON ファイルに永続保存
- 朝: 当日の目標分数を通知
- 昼: 当日の進捗を通知
- 夜: 当日の合計と直近14日の推移を通知
- 通知とスラッシュコマンドの結果を Embed で見やすく表示
- スラッシュコマンドで随時記録・目標設定・進捗確認

## セットアップ

1. Discord Developer Portal で Bot を作成します。
2. Bot の `MESSAGE CONTENT INTENT` を有効にします。
3. `.env.example` を `.env` にコピーして値を設定します。
4. 依存関係をインストールして起動します。

```bash
npm install
npm start
```

## 必要な環境変数

```env
DISCORD_TOKEN=your_discord_bot_token
CLIENT_ID=your_discord_application_client_id
GUILD_ID=your_discord_server_id
STUDY_CHANNEL_ID=your_study_log_channel_id
REPORT_CHANNEL_ID=your_report_channel_id
TIME_ZONE=Asia/Tokyo
DAILY_GOAL_MINUTES=120
MORNING_REPORT_TIME=08:00
NOON_REPORT_TIME=12:00
EVENING_REPORT_TIME=21:00
DATA_FILE=./data/study-records.json
```

`GUILD_ID` は任意ですが、開発中は設定するとスラッシュコマンドの反映が早くなります。未設定の場合はグローバルコマンドとして登録され、反映に時間がかかることがあります。

## スラッシュコマンド

- `/record minutes:25`  
  勉強時間を記録します。
- `/progress`  
  今日の自分の目標・進捗・直近7日の推移を表示します。
- `/goal minutes:120`  
  自分の毎日の目標勉強分数を設定します。
- `/summary days:14`  
  自分の指定日数分の推移を表示します。
- `/ranking days:7`  
  サーバー内の指定日数分のランキングを表示します。

## Bot 招待時に必要な権限

OAuth2 URL Generator で以下を選んで招待してください。

- Scopes: `bot`, `applications.commands`
- Bot Permissions:
  - View Channels
  - Send Messages
  - Embed Links
  - Read Message History
  - Add Reactions
  - Use Slash Commands

## データ保存形式

デフォルトでは `./data/study-records.json` に保存します。バックアップしたい場合はこのファイルをコピーしてください。

## GitHub Pages ダッシュボード

`docs/` 配下に GitHub Pages 用の静的ダッシュボードを用意しています。

- `docs/index.html`
- `docs/styles.css`
- `docs/app.js`

GitHub Pages で公開する場合は、GitHub リポジトリの `Settings > Pages` で以下を選びます。

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

現在のダッシュボードは GitHub Pages だけで動くように、ブラウザの `localStorage` に保存します。JSON のインポート・エクスポートもできます。

ただし、GitHub Pages は静的ホスティングなので、全ユーザーで共有する勉強記録を安全に保存するサーバー機能はありません。Discord Bot と Web ダッシュボードで同じデータを扱うには、次のような無料枠のある保存先に切り替えるのが現実的です。

### 無料で使いやすいデータ保存先

1. Supabase
   - PostgreSQL を無料枠で使えます。
   - GitHub Pages から Supabase の公開 anon key で読み書きできます。
   - Row Level Security を設定すれば、ユーザーごとの読み書きを制御できます。
   - Discord Bot 側も同じ Supabase に保存すれば、Bot と Web の記録を共有できます。
   - この用途では最もおすすめです。

2. Firebase Firestore
   - Google アカウントで始めやすく、Web SDK が充実しています。
   - GitHub Pages から直接読み書きできます。
   - Authentication と Security Rules で権限管理できます。
   - 無料枠内に収まりやすいですが、ルール設定を誤ると公開書き込みになりやすい点に注意が必要です。

3. Cloudflare Workers + D1
   - Workers で API を作り、D1 に SQLite 形式で保存できます。
   - GitHub Pages から API を呼び出し、Discord Bot も同じ API を使えます。
   - 無料枠があります。
   - 自分で API と認証を設計する必要があるため、Supabase/Firebase より実装量は増えます。

4. Google Sheets + Google Apps Script
   - スプレッドシートをデータベース代わりにできます。
   - Apps Script を Web API として公開すれば GitHub Pages から記録できます。
   - 小規模・個人利用なら簡単です。
   - 認証や不正投稿対策をきちんと作る場合は工夫が必要です。

5. GitHub Actions + repository dispatch
   - GitHub を保存先にして JSON を更新する方式です。
   - 追加サーバーなしでできますが、ブラウザに GitHub token を置くのは危険です。
   - 公開ダッシュボードから直接書き込む用途には基本的に非推奨です。

推奨構成は `GitHub Pages + Supabase` です。次の段階では、現在の JSON 保存を Supabase 保存に差し替え、Discord Bot とダッシュボードが同じ `study_entries` テーブルを読む構成にできます。
