import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { CARGOS_ADMIN, getSemanaAtual } from "../utils/semana";
import db from "../database/db";

export const data = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Configuracoes do bot (admin)")
  .addSubcommand((sub) =>
    sub.setName("saldo").setDescription("Posta mensagem de saldo que se atualiza a cada 10 minutos (admin)"),
  )
  .addSubcommand((sub) =>
    sub.setName("farm").setDescription("Posta a mensagem de abertura de farm no canal atual (admin)"),
  )
  .addSubcommand((sub) =>
    sub.setName("limpar").setDescription("Limpa todos os dados mantendo apenas membros (admin)"),
  )
  .addSubcommand((sub) =>
    sub.setName("reset_semana").setDescription("Arquiva semana atual e reseta dados para nova semana (admin)"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode executar o setup.", ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "limpar") await limpar(interaction, admin.nome);
  else if (sub === "reset_semana") await resetSemana(interaction, admin.nome);
  else if (sub === "saldo") await saldo(interaction);
  else await farm(interaction);
}

async function saldo(interaction: ChatInputCommandInteraction) {
  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };
  const estoque = db.prepare("SELECT material, quantidade FROM estoque ORDER BY material").all() as Array<{ material: string; quantidade: number }>;

  const embed = buildSaldoEmbed(caixa.saldo, estoque);
  const msg = await (interaction.channel as TextChannel).send({ embeds: [embed] });

  db.prepare("INSERT OR REPLACE INTO bot_config (chave, valor) VALUES ('saldo_message_id', ?)").run(msg.id);
  db.prepare("INSERT OR REPLACE INTO bot_config (chave, valor) VALUES ('saldo_channel_id', ?)").run(interaction.channelId);

  await interaction.reply({ content: "Mensagem de saldo postada! Sera atualizada a cada 10 minutos.", ephemeral: true });
}

export function buildSaldoEmbed(saldo: number, estoque: Array<{ material: string; quantidade: number }>): EmbedBuilder {
  const materiais = estoque.filter((e) => ["polvora", "capsula"].includes(e.material));
  const municoes = estoque.filter((e) => !["polvora", "capsula"].includes(e.material));

  const textoMateriais = materiais.map((e) => `**${e.material}:** ${e.quantidade}`).join("\n") || "Vazio";
  const textoMunicoes = municoes.map((e) => `**${e.material.toUpperCase()}:** ${e.quantidade}`).join("\n") || "Vazio";

  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle("💰 Saldo Atual")
    .addFields(
      { name: "Caixa", value: `$${saldo.toLocaleString()}`, inline: false },
      { name: "🧪 Materiais", value: textoMateriais, inline: true },
      { name: "💣 Municoes", value: textoMunicoes, inline: true },
    )
    .setFooter({ text: "Atualizado em" })
    .setTimestamp();
}

async function farm(interaction: ChatInputCommandInteraction) {
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
      "Clique no botao abaixo para abrir seu canal privado de farm.\n\n" +
      "Uma thread privada sera criada entre voce e a lideranca.\n" +
      "Use `/farm registrar` dentro da thread para registrar suas entregas.",
    )
    .setFooter({ text: "Apenas membros cadastrados podem abrir uma thread." });

  await interaction.reply({ content: "Mensagem de farm postada!", ephemeral: true });
  await (interaction.channel as TextChannel).send({ embeds: [embed], components: [row] });
}

async function limpar(interaction: ChatInputCommandInteraction, adminNome: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("confirmar_limpar").setLabel("Confirmar Reset").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("cancelar_limpar").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
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

    if (btn.customId === "confirmar_limpar") {
      db.transaction(() => {
        db.prepare("DELETE FROM farm_entregas").run();
        db.prepare("DELETE FROM farmer_pagamentos").run();
        db.prepare("DELETE FROM estoque_log").run();
        db.prepare("DELETE FROM producao_log").run();
        db.prepare("DELETE FROM vendas").run();
        db.prepare("DELETE FROM vendas_canceladas").run();
        db.prepare("DELETE FROM caixa_log").run();
        db.prepare("DELETE FROM bonus_log").run();
        db.prepare("DELETE FROM acoes").run();
        db.prepare("UPDATE estoque SET quantidade = 0").run();
        db.prepare("UPDATE caixa SET saldo = 0").run();
      })();

      await btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ Dados Limpos")
            .setDescription("Todos os dados foram resetados.\nMembros e advertencias foram mantidos.")
            .setFooter({ text: `Executado por ${adminNome}` })
            .setTimestamp(),
        ],
        components: [],
      });
    } else {
      await btn.update({
        embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle("Operacao Cancelada").setDescription("Nenhum dado foi apagado.").setTimestamp()],
        components: [],
      });
    }
    collector.stop();
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") await interaction.editReply({ components: [] });
  });
}

async function resetSemana(interaction: ChatInputCommandInteraction, adminNome: string) {
  const semana = getSemanaAtual();

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("confirmar_reset_semana").setLabel("Confirmar Reset").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("cancelar_reset_semana").setLabel("Cancelar").setStyle(ButtonStyle.Secondary),
  );

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle("⚠️ Reset de Semana")
    .setDescription(`Isso vai **arquivar** os dados da semana **${semana}** e resetar farm, vendas, estoque e caixa.\nMembros, advertencias e dividas serao mantidos.\n\nTem certeza?`)
    .setTimestamp();

  const reply = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
  const collector = reply.createMessageComponentCollector({ time: 30000 });

  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) {
      await btn.reply({ content: "Apenas quem executou o comando pode confirmar.", ephemeral: true });
      return;
    }

    if (btn.customId === "confirmar_reset_semana") {
      const farmSemana = db.prepare("SELECT COALESCE(SUM(polvora),0) as polvora, COALESCE(SUM(capsula),0) as capsula, COUNT(*) as entregas FROM farm_entregas WHERE semana = ?").get(semana);
      const vendasSemana = db.prepare("SELECT COUNT(*) as qtd, COALESCE(SUM(receita_total),0) as receita FROM vendas WHERE criado_em >= date('now','weekday 0','-6 days')").get();
      const acoesSemana = db.prepare("SELECT COUNT(*) as qtd, COALESCE(SUM(valor_total),0) as total FROM acoes WHERE semana = ?").get(semana);
      const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };
      const bonusTotal = db.prepare("SELECT COALESCE(SUM(valor),0) as total FROM bonus_log WHERE semana = ?").get(semana);

      const dadosJson = JSON.stringify({ semana, farm: farmSemana, vendas: vendasSemana, acoes: acoesSemana, saldoCaixa: caixa.saldo, bonus: bonusTotal });

      db.transaction(() => {
        db.prepare("INSERT INTO semanas_arquivadas (semana, dados_json) VALUES (?, ?)").run(semana, dadosJson);
        db.prepare("DELETE FROM farm_entregas").run();
        db.prepare("DELETE FROM farmer_pagamentos").run();
        db.prepare("DELETE FROM estoque_log").run();
        db.prepare("DELETE FROM producao_log").run();
        db.prepare("DELETE FROM vendas").run();
        db.prepare("DELETE FROM vendas_canceladas").run();
        db.prepare("DELETE FROM caixa_log").run();
        db.prepare("DELETE FROM bonus_log").run();
        db.prepare("DELETE FROM acoes").run();
        db.prepare("UPDATE estoque SET quantidade = 0").run();
        db.prepare("UPDATE caixa SET saldo = 0").run();
        db.prepare("INSERT INTO auditoria_log (acao, executado_por, alvo, detalhes) VALUES (?, ?, ?, ?)").run(
          "reset_semana", interaction.user.id, semana, `Semana arquivada por ${adminNome}`,
        );
      })();

      await btn.update({
        embeds: [
          new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle("✅ Semana Arquivada e Resetada")
            .setDescription(`Semana **${semana}** arquivada com sucesso.\nTodos os dados foram resetados para a nova semana.`)
            .setFooter({ text: `Executado por ${adminNome}` })
            .setTimestamp(),
        ],
        components: [],
      });
    } else {
      await btn.update({
        embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle("Operacao Cancelada").setDescription("Nenhum dado foi alterado.").setTimestamp()],
        components: [],
      });
    }
    collector.stop();
  });

  collector.on("end", async (_, reason) => {
    if (reason === "time") await interaction.editReply({ components: [] });
  });
}
