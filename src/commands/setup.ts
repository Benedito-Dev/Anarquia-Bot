import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { CARGOS_ADMIN } from "../utils/semana";
import db from "../database/db";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configuracoes do bot (admin)")
  .addSubcommand((sub) =>
    sub
      .setName("farm")
      .setDescription("Posta a mensagem fixa de abertura de farm no canal atual (admin)"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("limpar_farm")
      .setDescription("Limpa todos os dados de farm/vendas/caixa mantendo apenas membros (admin)"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode executar o setup.", ephemeral: true });
    return;
  }

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "limpar_farm") {
    await limparFarm(interaction);
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("abrir_farm")
      .setLabel("🌾 Abrir Farm")
      .setStyle(ButtonStyle.Success),
  );

  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle("🌾 Canal de Farm")
    .setDescription(
      "Clique no botão abaixo para abrir seu canal privado de farm.\n\n" +
      "Uma thread privada sera criada entre voce e a lideranca.\n" +
      "Use `/farm registrar` dentro da thread para registrar suas entregas.",
    )
    .setFooter({ text: "Apenas membros cadastrados podem abrir uma thread." });

  await interaction.reply({ content: "Mensagem de farm postada!", ephemeral: true });
  await (interaction.channel as TextChannel).send({ embeds: [embed], components: [row] });
}

async function limparFarm(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode limpar os dados.", ephemeral: true });
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("confirmar_limpar_farm")
      .setLabel("Confirmar Reset")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("cancelar_limpar_farm")
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("⚠️ Confirmacao Necessaria")
    .setDescription("Isso vai apagar **todos** os dados de farm, vendas, estoque e caixa.\nMembros e advertencias serao mantidos.\n\nTem certeza?")
    .setTimestamp();

  const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });

  const collector = reply.createMessageComponentCollector({ time: 30000 });

  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) {
      await btn.reply({ content: "Apenas quem executou o comando pode confirmar.", ephemeral: true });
      return;
    }

    if (btn.customId === "confirmar_limpar_farm") {
      db.transaction(() => {
        db.prepare("DELETE FROM farm_entregas").run();
        db.prepare("DELETE FROM farmer_pagamentos").run();
        db.prepare("DELETE FROM estoque_log").run();
        db.prepare("DELETE FROM producao_log").run();
        db.prepare("DELETE FROM vendas").run();
        db.prepare("DELETE FROM caixa_log").run();
        db.prepare("DELETE FROM bonus_log").run();
        db.prepare("DELETE FROM acoes").run();
        db.prepare("DELETE FROM acao_participantes").run();
        db.prepare("UPDATE estoque SET quantidade = 0").run();
        db.prepare("UPDATE caixa SET saldo = 0").run();
      })();

      await btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ Dados Limpos")
            .setDescription("Todos os dados de farm, vendas, estoque e caixa foram resetados.\nMembros e advertencias foram mantidos.")
            .setFooter({ text: `Executado por ${admin.nome}` })
            .setTimestamp(),
        ],
        components: [],
      });
    } else {
      await btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x95a5a6)
            .setTitle("Operacao Cancelada")
            .setDescription("Nenhum dado foi apagado.")
            .setTimestamp(),
        ],
        components: [],
      });
    }
    collector.stop();
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") {
      await interaction.editReply({ components: [] });
    }
  });
}
