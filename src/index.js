import "dotenv/config";
import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder
} from "discord.js";
import {
  AccountNotLinkedError,
  createStudyStore,
  getGoalForDate,
  normalizeEmail,
  normalizeWeeklyGoals
} from "./storage.js";
import { getDateKey, msUntilNextClockTime, parseClockTime } from "./time.js";

const config = readConfig();
const store = createStudyStore(config);
const EMBED_COLORS = {
  record: 0x2ecc71,
  progress: 0x3498db,
  goal: 0xf1c40f,
  morning: 0xffb84d,
  noon: 0x1abc9c,
  evening: 0x8e44ad,
  ranking: 0xe67e22,
  account: 0x5865f2,
  quality: 0x9b59b6
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once(Events.ClientReady, async (readyClient) => {
  await store.load();
  await registerCommands();
  scheduleDailyReports();
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) {
    return;
  }

  if (config.studyChannelId && message.channelId !== config.studyChannelId) {
    return;
  }

  const minutes = parseMinutesMessage(message.content);
  if (minutes === null) {
    return;
  }

  try {
    const dateKey = getDateKey(new Date(), config.timeZone);
    const entry = await store.addEntry({
      userId: message.author.id,
      username: message.author.username,
      minutes,
      dateKey,
      channelId: message.channelId,
      messageId: message.id,
      source: "message"
    });

    const total = await store.getUserDayTotal(message.author.id, dateKey);
    const goal = await store.getUserGoal(message.author.id, dateKey, config.defaultWeeklyGoalMinutes);
    await message.react("✅").catch(() => {});
    await message.reply({
      embeds: [
        buildRecordEmbed({
          username: entry.googleEmail || entry.username,
          minutes,
          total,
          goal,
          dateKey
        })
      ],
      allowedMentions: { repliedUser: false }
    });
  } catch (error) {
    if (error instanceof AccountNotLinkedError) {
      await message.reply({
        embeds: [buildAccountRequiredEmbed()],
        allowedMentions: { repliedUser: false }
      });
      return;
    }
    throw error;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === "record") {
      await handleRecordCommand(interaction);
    } else if (interaction.commandName === "account") {
      await handleAccountCommand(interaction);
    } else if (interaction.commandName === "progress") {
      await handleProgressCommand(interaction);
    } else if (interaction.commandName === "goal") {
      await handleGoalCommand(interaction);
    } else if (interaction.commandName === "quality") {
      await handleQualityCommand(interaction);
    } else if (interaction.commandName === "summary") {
      await handleSummaryCommand(interaction);
    } else if (interaction.commandName === "ranking") {
      await handleRankingCommand(interaction);
    }
  } catch (error) {
    console.error(error);
    const response =
      error instanceof AccountNotLinkedError
        ? { embeds: [buildAccountRequiredEmbed()], ephemeral: true }
        : { content: "処理中にエラーが発生しました。", ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(response);
    } else {
      await interaction.reply(response);
    }
  }
});

async function handleRecordCommand(interaction) {
  const minutes = interaction.options.getInteger("minutes", true);
  const dateKey = getDateKey(new Date(), config.timeZone);
  const entry = await store.addEntry({
    userId: interaction.user.id,
    username: interaction.user.username,
    minutes,
    dateKey,
    channelId: interaction.channelId,
    messageId: null,
    source: "slash-command"
  });

  const total = await store.getUserDayTotal(interaction.user.id, dateKey);
  const goal = await store.getUserGoal(interaction.user.id, dateKey, config.defaultWeeklyGoalMinutes);
  await interaction.reply({
    embeds: [
      buildRecordEmbed({
        username: entry.googleEmail || entry.username,
        minutes,
        total,
        goal,
        dateKey
      })
    ]
  });
}

async function handleAccountCommand(interaction) {
  const identifier = normalizeEmail(interaction.options.getString("identifier", true));
  const email = identifier;
  if (!isValidEmail(email)) {
    await interaction.reply({
      content: "Googleアカウントはメールアドレスで指定してください。",
      ephemeral: true
    });
    return;
  }

  await store.linkDiscordAccount(interaction.user.id, interaction.user.username, email);
  await interaction.reply({
    embeds: [buildAccountLinkedEmbed(email)],
    ephemeral: true
  });
}

async function handleProgressCommand(interaction) {
  const dateKey = getDateKey(new Date(), config.timeZone);
  const total = await store.getUserDayTotal(interaction.user.id, dateKey);
  const goal = await store.getUserGoal(interaction.user.id, dateKey, config.defaultWeeklyGoalMinutes);
  const trend = await store.getUserTrend(interaction.user.id, dateKey, 7);
  const outcomeTrend = await store.getOutcomeTrend(dateKey, 7, interaction.user.id);
  await interaction.reply({
    embeds: [
      buildProgressEmbed({
        username: interaction.user.username,
        total,
        goal,
        trend,
        outcomeTrend,
        dateKey
      })
    ],
    ephemeral: true
  });
}

async function handleGoalCommand(interaction) {
  const weekday = interaction.options.getInteger("weekday", true);
  const minutes = interaction.options.getInteger("minutes", true);
  await store.setWeeklyGoal(interaction.user.id, interaction.user.username, weekday, minutes);
  await interaction.reply({
    embeds: [buildGoalEmbed(interaction.user.username, weekday, minutes)],
    ephemeral: true
  });
}

async function handleQualityCommand(interaction) {
  const score = interaction.options.getInteger("score", true);
  const note = interaction.options.getString("note") || null;
  const dateKey = getDateKey(new Date(), config.timeZone);
  await store.addQualityRating({
    userId: interaction.user.id,
    username: interaction.user.username,
    score,
    note,
    dateKey,
    source: "slash-command"
  });
  const outcomeTrend = await store.getOutcomeTrend(dateKey, 1, interaction.user.id);
  await interaction.reply({
    embeds: [buildQualityEmbed(score, note, outcomeTrend[0])],
    ephemeral: true
  });
}

async function handleSummaryCommand(interaction) {
  const days = interaction.options.getInteger("days") || 7;
  const dateKey = getDateKey(new Date(), config.timeZone);
  const trend = await store.getUserTrend(interaction.user.id, dateKey, days);
  const outcomeTrend = await store.getOutcomeTrend(dateKey, days, interaction.user.id);
  const total = trend.reduce((sum, day) => sum + day.minutes, 0);
  await interaction.reply({
    embeds: [
      buildSummaryEmbed({
        username: interaction.user.username,
        total,
        trend,
        outcomeTrend,
        days,
        dateKey
      })
    ],
    ephemeral: true
  });
}

async function handleRankingCommand(interaction) {
  const days = interaction.options.getInteger("days") || 7;
  const dateKey = getDateKey(new Date(), config.timeZone);
  const ranking = (await store.getRanking(dateKey, days)).slice(0, 10);

  await interaction.reply({
    embeds: [buildRankingEmbed(ranking, days, dateKey)]
  });
}

function scheduleDailyReports() {
  scheduleReport("morning", config.morningReportTime, sendMorningReport);
  scheduleReport("noon", config.noonReportTime, sendNoonReport);
  scheduleReport("evening", config.eveningReportTime, sendEveningReport);
}

function scheduleReport(name, clockTime, task) {
  const scheduleNext = () => {
    const waitMs = msUntilNextClockTime(clockTime, config.timeZone);
    setTimeout(async () => {
      try {
        await task();
      } catch (error) {
        console.error(`Failed to send ${name} report`, error);
      } finally {
        scheduleNext();
      }
    }, waitMs);
  };

  scheduleNext();
}

async function sendMorningReport() {
  const channel = await getReportChannel();
  const dateKey = getDateKey(new Date(), config.timeZone);
  await channel.send({
    embeds: [buildMorningReportEmbed(dateKey, getGoalForDate(dateKey, config.defaultWeeklyGoalMinutes))]
  });
}

async function sendNoonReport() {
  const channel = await getReportChannel();
  const dateKey = getDateKey(new Date(), config.timeZone);
  const total = await store.getDayTotal(dateKey);
  const ranking = (await store.getRanking(dateKey, 1)).slice(0, 5);
  await channel.send({
    embeds: [buildNoonReportEmbed({ dateKey, total, ranking })]
  });
}

async function sendEveningReport() {
  const channel = await getReportChannel();
  const dateKey = getDateKey(new Date(), config.timeZone);
  const total = await store.getDayTotal(dateKey);
  const trend = await store.getTrend(dateKey, 14);
  const outcomeTrend = await store.getOutcomeTrend(dateKey, 14);
  const ranking = (await store.getRanking(dateKey, 1)).slice(0, 10);

  await channel.send({
    embeds: [buildEveningReportEmbed({ dateKey, total, trend, outcomeTrend, ranking })]
  });
}

async function getReportChannel() {
  const channelId = config.reportChannelId || config.studyChannelId;
  if (!channelId) {
    throw new Error("REPORT_CHANNEL_ID or STUDY_CHANNEL_ID is required for reports.");
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`Report channel ${channelId} is not a guild text channel.`);
  }

  return channel;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("account")
      .setDescription("DiscordアカウントをGoogleメールアドレスに紐づけます")
      .addStringOption((option) =>
        option
          .setName("identifier")
          .setDescription("Googleアカウントのメールアドレス")
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("record")
      .setDescription("勉強時間を記録します")
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("記録する勉強分数")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1440)
      ),
    new SlashCommandBuilder().setName("progress").setDescription("今日の目標と進捗を表示します"),
    new SlashCommandBuilder()
      .setName("goal")
      .setDescription("曜日ごとの目標勉強分数を設定します")
      .addIntegerOption((option) =>
        option
          .setName("weekday")
          .setDescription("目標を設定する曜日")
          .setRequired(true)
          .addChoices(
            { name: "日曜日", value: 0 },
            { name: "月曜日", value: 1 },
            { name: "火曜日", value: 2 },
            { name: "水曜日", value: 3 },
            { name: "木曜日", value: 4 },
            { name: "金曜日", value: 5 },
            { name: "土曜日", value: 6 }
          )
      )
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("目標勉強分数")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1440)
      ),
    new SlashCommandBuilder()
      .setName("quality")
      .setDescription("今日の勉強の質を1〜5で評価します")
      .addIntegerOption((option) =>
        option
          .setName("score")
          .setDescription("勉強の質。1が低く、5が高い評価です")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(5)
      )
      .addStringOption((option) =>
        option
          .setName("note")
          .setDescription("任意メモ")
          .setRequired(false)
          .setMaxLength(200)
      ),
    new SlashCommandBuilder()
      .setName("summary")
      .setDescription("自分の勉強時間の推移を表示します")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("表示する日数")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(30)
      ),
    new SlashCommandBuilder()
      .setName("ranking")
      .setDescription("サーバー内の勉強時間ランキングを表示します")
      .addIntegerOption((option) =>
        option
          .setName("days")
          .setDescription("集計する日数")
          .setRequired(false)
          .setMinValue(1)
          .setMaxValue(30)
      )
  ].map((command) => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  if (config.guildId) {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands
    });
    return;
  }

  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
}

function parseMinutesMessage(content) {
  const match = /^\s*(\d{1,4})\s*$/.exec(content);
  if (!match) {
    return null;
  }

  const minutes = Number(match[1]);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
    return null;
  }

  return minutes;
}

function buildRecordEmbed({ username, minutes, total, goal, dateKey }) {
  const remaining = Math.max(goal - total, 0);
  return baseEmbed(EMBED_COLORS.record)
    .setTitle("勉強時間を記録しました")
    .setDescription(`${username}さんの記録を保存しました。`)
    .addFields(
      { name: "今回", value: formatMinutes(minutes), inline: true },
      { name: "今日の合計", value: formatMinutes(total), inline: true },
      { name: "目標まで", value: remaining === 0 ? "達成済み" : formatMinutes(remaining), inline: true },
      { name: "進捗", value: `${progressBar(total, goal)} ${formatPercent(total, goal)}` },
      { name: "日付", value: dateKey, inline: true }
    );
}

function buildProgressEmbed({ username, total, goal, trend, outcomeTrend, dateKey }) {
  const remaining = Math.max(goal - total, 0);
  const todayOutcome = outcomeTrend.at(-1);
  return baseEmbed(EMBED_COLORS.progress)
    .setTitle("今日の進捗")
    .setDescription(`${username}さんの現在の状況です。`)
    .addFields(
      { name: "今日の合計", value: formatMinutes(total), inline: true },
      { name: "目標", value: formatMinutes(goal), inline: true },
      { name: "残り", value: remaining === 0 ? "達成済み" : formatMinutes(remaining), inline: true },
      { name: "達成率", value: `${progressBar(total, goal)} ${formatPercent(total, goal)}` },
      { name: "直近7日の推移", value: codeBlock(formatTrend(trend)) },
      {
        name: "今日の成果指数",
        value: `${todayOutcome?.outcomeIndex || 0} / 質平均 ${formatQuality(todayOutcome?.qualityAverage)}`,
        inline: true
      },
      { name: "日付", value: dateKey, inline: true }
    );
}

function buildGoalEmbed(username, weekday, minutes) {
  return baseEmbed(EMBED_COLORS.goal)
    .setTitle("目標を更新しました")
    .setDescription(`${username}さんの${formatWeekday(weekday)}の目標を ${formatMinutes(minutes)} に設定しました。`)
    .addFields(
      { name: "曜日", value: formatWeekday(weekday), inline: true },
      { name: "新しい目標", value: formatMinutes(minutes), inline: true }
    );
}

function buildQualityEmbed(score, note, outcome) {
  return baseEmbed(EMBED_COLORS.quality)
    .setTitle("勉強の質を記録しました")
    .setDescription(note ? `メモ: ${note}` : "今日の評価を保存しました。")
    .addFields(
      { name: "評価", value: `${score} / 5`, inline: true },
      { name: "今日の成果指数", value: String(outcome?.outcomeIndex || 0), inline: true },
      { name: "今日の質平均", value: formatQuality(outcome?.qualityAverage), inline: true }
    );
}

function buildSummaryEmbed({ username, total, trend, outcomeTrend, days, dateKey }) {
  const average = Math.round(total / days);
  const outcomeTotal = outcomeTrend.reduce((sum, day) => sum + day.outcomeIndex, 0);
  return baseEmbed(EMBED_COLORS.progress)
    .setTitle(`直近${days}日のサマリー`)
    .setDescription(`${username}さんの勉強時間の推移です。`)
    .addFields(
      { name: "合計", value: formatMinutes(total), inline: true },
      { name: "1日平均", value: formatMinutes(average), inline: true },
      { name: "集計終了日", value: dateKey, inline: true },
      { name: "成果指数合計", value: String(outcomeTotal), inline: true },
      { name: "勉強時間の推移", value: codeBlock(formatTrend(trend)) },
      { name: "成果指数の推移", value: codeBlock(formatOutcomeTrend(outcomeTrend)) }
    );
}

function buildRankingEmbed(ranking, days, dateKey) {
  const title = days === 1 ? "今日のランキング" : `直近${days}日のランキング`;
  return baseEmbed(EMBED_COLORS.ranking)
    .setTitle(title)
    .setDescription(formatRanking(ranking, days))
    .addFields({ name: "集計終了日", value: dateKey, inline: true });
}

function buildMorningReportEmbed(dateKey, defaultGoalMinutes) {
  return baseEmbed(EMBED_COLORS.morning)
    .setTitle("今日の目標")
    .setDescription("今日の勉強を始める準備ができました。")
    .addFields(
      { name: "日付", value: dateKey, inline: true },
      { name: "今日の標準目標", value: formatMinutes(defaultGoalMinutes), inline: true },
      { name: "使えるコマンド", value: "`/account` でGoogleメール紐づけ、`/goal` で曜日目標、`/quality` で質評価" }
    );
}

function buildNoonReportEmbed({ dateKey, total, ranking }) {
  return baseEmbed(EMBED_COLORS.noon)
    .setTitle("昼の進捗レポート")
    .setDescription("今日のここまでの記録です。")
    .addFields(
      { name: "日付", value: dateKey, inline: true },
      { name: "全体合計", value: formatMinutes(total), inline: true },
      { name: "今日のランキング", value: formatRanking(ranking, 1) }
    );
}

function buildEveningReportEmbed({ dateKey, total, trend, outcomeTrend, ranking }) {
  const outcomeTotal = outcomeTrend.reduce((sum, day) => sum + day.outcomeIndex, 0);
  return baseEmbed(EMBED_COLORS.evening)
    .setTitle("夜の勉強レポート")
    .setDescription("今日の勉強時間と最近の推移です。")
    .addFields(
      { name: "日付", value: dateKey, inline: true },
      { name: "今日の全体合計", value: formatMinutes(total), inline: true },
      { name: "直近14日の成果指数合計", value: String(outcomeTotal), inline: true },
      { name: "今日のランキング", value: formatRanking(ranking, 1) },
      { name: "直近14日の勉強時間", value: codeBlock(formatTrend(trend)) },
      { name: "直近14日の成果指数", value: codeBlock(formatOutcomeTrend(outcomeTrend)) }
    );
}

function buildAccountRequiredEmbed() {
  return baseEmbed(EMBED_COLORS.account)
    .setTitle("Googleアカウントの紐づけが必要です")
    .setDescription("Discordから記録する前に `/account identifier:<Googleメールアドレス>` を実行してください。")
    .addFields({ name: "例", value: "`/account identifier:you@example.com`" });
}

function buildAccountLinkedEmbed(email) {
  return baseEmbed(EMBED_COLORS.account)
    .setTitle("アカウントを紐づけました")
    .setDescription(`今後のDiscord記録は ${email} のGoogleアカウントの記録として保存します。`);
}

function baseEmbed(color) {
  return new EmbedBuilder().setColor(color).setTimestamp().setFooter({ text: "Study Recorder" });
}

function formatMinutes(minutes) {
  return `${minutes}分`;
}

function formatPercent(total, goal) {
  const percent = Math.min(Math.floor((total / goal) * 100), 999);
  return `${percent}%`;
}

function progressBar(total, goal) {
  const width = 12;
  const filled = Math.min(width, Math.round((total / goal) * width));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function formatTrend(trend) {
  if (trend.length === 0) {
    return "記録はまだありません。";
  }

  const max = Math.max(...trend.map((day) => day.minutes), 1);
  return trend
    .map((day) => {
      const width = Math.round((day.minutes / max) * 12);
      const bar = "#".repeat(width).padEnd(12, "-");
      return `${day.date} | ${bar} | ${day.minutes}分`;
    })
    .join("\n");
}

function formatOutcomeTrend(trend) {
  if (trend.length === 0) {
    return "記録はまだありません。";
  }

  const max = Math.max(...trend.map((day) => day.outcomeIndex), 1);
  return trend
    .map((day) => {
      const width = Math.round((day.outcomeIndex / max) * 12);
      const bar = "#".repeat(width).padEnd(12, "-");
      return `${day.date} | ${bar} | ${day.outcomeIndex}`;
    })
    .join("\n");
}

function formatRanking(ranking, days) {
  if (ranking.length === 0) {
    return `直近${days}日の記録はまだありません。`;
  }

  return ranking.map((item, index) => `${index + 1}. ${item.username}: ${item.minutes}分`).join("\n");
}

function codeBlock(value) {
  const maxCodeLength = 1016;
  const body =
    value.length > maxCodeLength ? `${value.slice(0, maxCodeLength - 3).trimEnd()}...` : value;
  return `\`\`\`\n${body}\n\`\`\``;
}

function formatQuality(value) {
  return value ? `${value.toFixed(1)} / 5` : "未評価";
}

function formatWeekday(weekday) {
  return ["日曜日", "月曜日", "火曜日", "水曜日", "木曜日", "金曜日", "土曜日"][weekday] || "不明";
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function readConfig() {
  const required = ["DISCORD_TOKEN", "CLIENT_ID"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  return {
    discordToken: process.env.DISCORD_TOKEN,
    clientId: process.env.CLIENT_ID,
    guildId: process.env.GUILD_ID || null,
    studyChannelId: process.env.STUDY_CHANNEL_ID || null,
    reportChannelId: process.env.REPORT_CHANNEL_ID || null,
    timeZone: process.env.TIME_ZONE || "Asia/Tokyo",
    defaultGoalMinutes: Number(process.env.DAILY_GOAL_MINUTES || 120),
    morningReportTime: parseClockTime(process.env.MORNING_REPORT_TIME, "08:00"),
    noonReportTime: parseClockTime(process.env.NOON_REPORT_TIME, "12:00"),
    eveningReportTime: parseClockTime(process.env.EVENING_REPORT_TIME, "21:00"),
    dataFile: process.env.DATA_FILE || "./data/study-records.json",
    storageDriver:
      process.env.STORAGE_DRIVER ||
      (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "file"),
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null
  };
}

await client.login(config.discordToken);
