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
import { StudyStore } from "./storage.js";
import { getDateKey, msUntilNextClockTime, parseClockTime } from "./time.js";

const config = readConfig();
const store = new StudyStore(config.dataFile);
const EMBED_COLORS = {
  record: 0x2ecc71,
  progress: 0x3498db,
  goal: 0xf1c40f,
  morning: 0xffb84d,
  noon: 0x1abc9c,
  evening: 0x8e44ad,
  ranking: 0xe67e22
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

  const dateKey = getDateKey(new Date(), config.timeZone);
  await store.addEntry({
    userId: message.author.id,
    username: message.author.username,
    minutes,
    dateKey,
    channelId: message.channelId,
    messageId: message.id,
    source: "message"
  });

  const total = store.getUserDayTotal(message.author.id, dateKey);
  const goal = store.getUserGoal(message.author.id, config.defaultGoalMinutes);
  await message.react("✅").catch(() => {});
  await message.reply({
    embeds: [
      buildRecordEmbed({
        username: message.author.username,
        minutes,
        total,
        goal,
        dateKey
      })
    ],
    allowedMentions: { repliedUser: false }
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  try {
    if (interaction.commandName === "record") {
      await handleRecordCommand(interaction);
    } else if (interaction.commandName === "progress") {
      await handleProgressCommand(interaction);
    } else if (interaction.commandName === "goal") {
      await handleGoalCommand(interaction);
    } else if (interaction.commandName === "summary") {
      await handleSummaryCommand(interaction);
    } else if (interaction.commandName === "ranking") {
      await handleRankingCommand(interaction);
    }
  } catch (error) {
    console.error(error);
    const response = { content: "処理中にエラーが発生しました。", ephemeral: true };
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
  await store.addEntry({
    userId: interaction.user.id,
    username: interaction.user.username,
    minutes,
    dateKey,
    channelId: interaction.channelId,
    messageId: null,
    source: "slash-command"
  });

  const total = store.getUserDayTotal(interaction.user.id, dateKey);
  const goal = store.getUserGoal(interaction.user.id, config.defaultGoalMinutes);
  await interaction.reply({
    embeds: [
      buildRecordEmbed({
        username: interaction.user.username,
        minutes,
        total,
        goal,
        dateKey
      })
    ]
  });
}

async function handleProgressCommand(interaction) {
  const dateKey = getDateKey(new Date(), config.timeZone);
  const total = store.getUserDayTotal(interaction.user.id, dateKey);
  const goal = store.getUserGoal(interaction.user.id, config.defaultGoalMinutes);
  const trend = store.getUserTrend(interaction.user.id, dateKey, 7);
  await interaction.reply({
    embeds: [
      buildProgressEmbed({
        username: interaction.user.username,
        total,
        goal,
        trend,
        dateKey
      })
    ],
    ephemeral: true
  });
}

async function handleGoalCommand(interaction) {
  const minutes = interaction.options.getInteger("minutes", true);
  await store.setGoal(interaction.user.id, interaction.user.username, minutes);
  await interaction.reply({
    embeds: [buildGoalEmbed(interaction.user.username, minutes)],
    ephemeral: true
  });
}

async function handleSummaryCommand(interaction) {
  const days = interaction.options.getInteger("days") || 7;
  const dateKey = getDateKey(new Date(), config.timeZone);
  const trend = store.getUserTrend(interaction.user.id, dateKey, days);
  const total = trend.reduce((sum, day) => sum + day.minutes, 0);
  await interaction.reply({
    embeds: [
      buildSummaryEmbed({
        username: interaction.user.username,
        total,
        trend,
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
  const ranking = store.getRanking(dateKey, days).slice(0, 10);

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
    embeds: [buildMorningReportEmbed(dateKey, config.defaultGoalMinutes)]
  });
}

async function sendNoonReport() {
  const channel = await getReportChannel();
  const dateKey = getDateKey(new Date(), config.timeZone);
  const total = store.getDayTotal(dateKey);
  const ranking = store.getRanking(dateKey, 1).slice(0, 5);
  await channel.send({
    embeds: [buildNoonReportEmbed({ dateKey, total, ranking })]
  });
}

async function sendEveningReport() {
  const channel = await getReportChannel();
  const dateKey = getDateKey(new Date(), config.timeZone);
  const total = store.getDayTotal(dateKey);
  const trend = store.getTrend(dateKey, 14);
  const ranking = store.getRanking(dateKey, 1).slice(0, 10);

  await channel.send({
    embeds: [buildEveningReportEmbed({ dateKey, total, trend, ranking })]
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
      .setDescription("毎日の目標勉強分数を設定します")
      .addIntegerOption((option) =>
        option
          .setName("minutes")
          .setDescription("目標勉強分数")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(1440)
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

function buildProgressEmbed({ username, total, goal, trend, dateKey }) {
  const remaining = Math.max(goal - total, 0);
  return baseEmbed(EMBED_COLORS.progress)
    .setTitle("今日の進捗")
    .setDescription(`${username}さんの現在の状況です。`)
    .addFields(
      { name: "今日の合計", value: formatMinutes(total), inline: true },
      { name: "目標", value: formatMinutes(goal), inline: true },
      { name: "残り", value: remaining === 0 ? "達成済み" : formatMinutes(remaining), inline: true },
      { name: "達成率", value: `${progressBar(total, goal)} ${formatPercent(total, goal)}` },
      { name: "直近7日の推移", value: codeBlock(formatTrend(trend)) },
      { name: "日付", value: dateKey, inline: true }
    );
}

function buildGoalEmbed(username, minutes) {
  return baseEmbed(EMBED_COLORS.goal)
    .setTitle("目標を更新しました")
    .setDescription(`${username}さんの毎日の目標を ${formatMinutes(minutes)} に設定しました。`)
    .addFields({ name: "新しい目標", value: formatMinutes(minutes), inline: true });
}

function buildSummaryEmbed({ username, total, trend, days, dateKey }) {
  const average = Math.round(total / days);
  return baseEmbed(EMBED_COLORS.progress)
    .setTitle(`直近${days}日のサマリー`)
    .setDescription(`${username}さんの勉強時間の推移です。`)
    .addFields(
      { name: "合計", value: formatMinutes(total), inline: true },
      { name: "1日平均", value: formatMinutes(average), inline: true },
      { name: "集計終了日", value: dateKey, inline: true },
      { name: "推移", value: codeBlock(formatTrend(trend)) }
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
      { name: "標準目標", value: formatMinutes(defaultGoalMinutes), inline: true },
      { name: "使えるコマンド", value: "`/goal` で個人目標を変更、`/progress` で進捗確認" }
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

function buildEveningReportEmbed({ dateKey, total, trend, ranking }) {
  return baseEmbed(EMBED_COLORS.evening)
    .setTitle("夜の勉強レポート")
    .setDescription("今日の勉強時間と最近の推移です。")
    .addFields(
      { name: "日付", value: dateKey, inline: true },
      { name: "今日の全体合計", value: formatMinutes(total), inline: true },
      { name: "今日のランキング", value: formatRanking(ranking, 1) },
      { name: "直近14日の推移", value: codeBlock(formatTrend(trend)) }
    );
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
    dataFile: process.env.DATA_FILE || "./data/study-records.json"
  };
}

await client.login(config.discordToken);
