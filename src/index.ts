import { Client, Collection, GatewayIntentBits, REST, Routes, ChannelType, ThreadAutoArchiveDuration } from "discord.js";
import dotenv from "dotenv";
import { initDatabase } from "./database/db";
import db from "./database/db";
import * as farmCommand from "./commands/farm";
import * as estoqueCommand from "./commands/estoque";
import * as membroCommand from "./commands/membro";
import * as vendaCommand from "./commands/venda";
import * as caixaCommand from "./commands/caixa";
import * as relatorioCommand from "./commands/relatorio";
import * as acaoCommand from "./commands/acao";
import * as advertenciaCommand from "./commands/advertencia";
import * as setupCommand from "./commands/setup";
import * as dinheiroCommand from "./commands/dinheiro";
import * as dividaCommand from "./commands/divida";
import * as graficoCommand from "./commands/grafico";
import * as guiaCommand from "./commands/guia";

dotenv.config();

const TOKEN = process.env.DISCORD_TOKEN!;
const GUILD_ID = process.env.GUILD_ID!;

if (!TOKEN) {
  console.error("DISCORD_TOKEN nao encontrado no .env");
  process.exit(1);
}

if (!GUILD_ID) {
  console.error("GUILD_ID nao encontrado no .env");
  process.exit(1);
}

initDatabase();
console.log("Banco de dados inicializado.");

const commands = [farmCommand, estoqueCommand, membroCommand, vendaCommand, caixaCommand, relatorioCommand, acaoCommand, advertenciaCommand, setupCommand, dinheiroCommand, dividaCommand, graficoCommand, guiaCommand];
const commandMap = new Collection<string, { execute: (interaction: any) => Promise<void> }>();

for (const cmd of commands) {
  commandMap.set(cmd.data.name, cmd);
}

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    console.log("Registrando slash commands...");
    const clientId = Buffer.from(TOKEN.split(".")[0], "base64").toString();
    await rest.put(Routes.applicationGuildCommands(clientId, GUILD_ID), {
      body: commands.map((cmd) => cmd.data.toJSON()),
    });
    console.log(`${commands.length} slash commands registrados!`);
  } catch (error) {
    console.error("Erro ao registrar commands:", error);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

let botReady = false;

client.once("ready", () => {
  console.log(`Bot online como ${client.user?.tag}`);
  botReady = true;
});

client.on("interactionCreate", async (interaction) => {
  if (!botReady) return;

  // Handler de autocomplete
  if (interaction.isAutocomplete()) {
    const command = commandMap.get(interaction.commandName) as any;
    if (command?.autocomplete) {
      try { await command.autocomplete(interaction); } catch { /* ignora */ }
    }
    return;
  }

  // Handler do botao abrir_farm
  if (interaction.isButton() && interaction.customId === "abrir_farm") {
    await interaction.deferReply({ ephemeral: true });

    const membro = db
      .prepare("SELECT * FROM membros WHERE discord_id = ? AND ativo = 1")
      .get(interaction.user.id) as { id: number; nome: string } | undefined;

    if (!membro) {
      await interaction.editReply({ content: "Voce nao esta cadastrado na familia. Peca a um admin para te cadastrar." });
      return;
    }

    const channel = interaction.channel;
    if (!channel || channel.type !== ChannelType.GuildText) {
      await interaction.editReply({ content: "Este botao so funciona em canais de texto." });
      return;
    }

    // Verificar se ja existe thread ativa para esse membro
    const threadExistente = channel.threads.cache.find(
      (t) => t.name === `farm-${membro.nome}` && !t.archived,
    );

    if (threadExistente) {
      await interaction.editReply({ content: `Voce ja tem uma thread ativa: ${threadExistente}` });
      return;
    }

    // Criar thread privada
    const thread = await channel.threads.create({
      name: `farm-${membro.nome}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      type: ChannelType.PrivateThread,
      reason: `Farm de ${membro.nome}`,
    });

    // Adicionar o membro
    await thread.members.add(interaction.user.id);

    // Adicionar lideranca
    const lideranca = db
      .prepare("SELECT discord_id FROM membros WHERE ativo = 1 AND (cargo = 'lider' OR cargo = 'sublider')")
      .all() as Array<{ discord_id: string }>;

    for (const l of lideranca) {
      await thread.members.add(l.discord_id);
    }

    await thread.send({
      content: `Ola <@${interaction.user.id}>! Esta e sua thread privada de farm.\nUse \`/farm registrar\` para registrar suas entregas.\nA lideranca foi adicionada automaticamente.`,
    });

    await interaction.editReply({ content: `Sua thread foi criada: ${thread}` });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erro no comando ${interaction.commandName}:`, error);
    try {
      const msg = { content: "Ocorreu um erro ao executar este comando." };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ ...msg, ephemeral: true });
      } else {
        await interaction.reply({ ...msg, ephemeral: true });
      }
    } catch {
      // Ignora
    }
  }
});

registerCommands().then(() => {
  client.login(TOKEN);
});
