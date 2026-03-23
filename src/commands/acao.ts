import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
  User,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ADMIN, CARGOS_ACAO, getSemanaAtual } from "../utils/semana";

const PERCENT_PARTICIPANTES = 0.7;
const PAGAMENTO_FIXO: Record<string, number> = {
  pequena: 5000,
  media: 10000,
  grande: 20000,
};

function buildParticipantesOptions(sub: any) {
  for (let i = 1; i <= 12; i++) {
    sub.addUserOption((opt: any) =>
      opt
        .setName(`participante${i}`)
        .setDescription(`Participante ${i}`)
        .setRequired(i === 1),
    );
  }
  return sub;
}

export const data = new SlashCommandBuilder()
  .setName("acao")
  .setDescription("Setor operacional — registrar acoes")
  .addSubcommand((sub) =>
    buildParticipantesOptions(
      sub
        .setName("com_dinheiro")
        .setDescription("Acao que gerou dinheiro (70% participantes / 30% caixa)")
        .addIntegerOption((opt: any) =>
          opt
            .setName("valor_total")
            .setDescription("Valor total gerado na acao")
            .setRequired(true)
            .setMinValue(1),
        ),
    ),
  )
  .addSubcommand((sub) =>
    buildParticipantesOptions(
      sub
        .setName("sem_dinheiro")
        .setDescription("Acao sem dinheiro — pagamento fixo por participante")
        .addStringOption((opt: any) =>
          opt
            .setName("porte")
            .setDescription("Porte da acao")
            .setRequired(true)
            .addChoices(
              { name: "Pequena (5k por pessoa)", value: "pequena" },
              { name: "Media (10k por pessoa)", value: "media" },
              { name: "Grande (20k por pessoa)", value: "grande" },
            ),
        ),
    ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ACAO.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente de Acao ou superior** pode registrar acoes.", ephemeral: true });
    return;
  }

  const participantes: User[] = [];
  for (let i = 1; i <= 12; i++) {
    const user = interaction.options.getUser(`participante${i}`);
    if (user) participantes.push(user);
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "com_dinheiro") {
    await comDinheiro(interaction, participantes, admin.nome);
  } else if (subcommand === "sem_dinheiro") {
    await semDinheiro(interaction, participantes, admin.nome);
  }
}

async function comDinheiro(interaction: ChatInputCommandInteraction, participantes: User[], adminNome: string) {
  const valorTotal = interaction.options.getInteger("valor_total", true);
  const valorParticipantes = Math.round(valorTotal * PERCENT_PARTICIPANTES);
  const valorCaixa = valorTotal - valorParticipantes;
  const valorPorPessoa = Math.round(valorParticipantes / participantes.length);
  const semana = getSemanaAtual();

  db.transaction(() => {
    const acao = db.prepare(
      "INSERT INTO acoes (tipo, porte, valor_total, valor_caixa, registrado_por, semana) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("com_dinheiro", null, valorTotal, valorCaixa, interaction.user.id, semana);

    for (const p of participantes) {
      db.prepare(
        "INSERT INTO acao_participantes (acao_id, discord_id, valor_recebido) VALUES (?, ?, ?)",
      ).run(acao.lastInsertRowid, p.id, valorPorPessoa);
    }

    db.prepare("UPDATE caixa SET saldo = saldo + ?").run(valorCaixa);
    db.prepare(
      "INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)",
    ).run("acao", valorCaixa, `Acao com dinheiro — ${participantes.length} participantes`, interaction.user.id);
  })();

  let lista = "";
  for (const p of participantes) {
    lista += `<@${p.id}> — $${valorPorPessoa.toLocaleString()}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Acao Registrada — Com Dinheiro")
    .addFields(
      { name: "Valor total gerado", value: `$${valorTotal.toLocaleString()}`, inline: true },
      { name: "Participantes (70%)", value: `$${valorParticipantes.toLocaleString()}`, inline: true },
      { name: "Caixa familia (30%)", value: `$${valorCaixa.toLocaleString()}`, inline: true },
      { name: `Valor por pessoa (${participantes.length} participantes)`, value: lista },
    )
    .setFooter({ text: `Registrado por ${adminNome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function semDinheiro(interaction: ChatInputCommandInteraction, participantes: User[], adminNome: string) {
  const porte = interaction.options.getString("porte", true);
  const valorPorPessoa = PAGAMENTO_FIXO[porte];
  const totalNecessario = valorPorPessoa * participantes.length;
  const semana = getSemanaAtual();

  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  if (caixa.saldo < totalNecessario) {
    await interaction.reply({
      content: `Saldo insuficiente. Caixa tem $${caixa.saldo.toLocaleString()}, necessario $${totalNecessario.toLocaleString()}.`,
      ephemeral: true,
    });
    return;
  }

  db.transaction(() => {
    const acao = db.prepare(
      "INSERT INTO acoes (tipo, porte, valor_total, valor_caixa, registrado_por, semana) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("sem_dinheiro", porte, totalNecessario, totalNecessario, interaction.user.id, semana);

    for (const p of participantes) {
      db.prepare(
        "INSERT INTO acao_participantes (acao_id, discord_id, valor_recebido) VALUES (?, ?, ?)",
      ).run(acao.lastInsertRowid, p.id, valorPorPessoa);
    }

    db.prepare("UPDATE caixa SET saldo = saldo - ?").run(totalNecessario);
    db.prepare(
      "INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)",
    ).run("acao_pagamento", -totalNecessario, `Acao ${porte} sem dinheiro — ${participantes.length} participantes`, interaction.user.id);
  })();

  let lista = "";
  for (const p of participantes) {
    lista += `<@${p.id}> — $${valorPorPessoa.toLocaleString()}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`Acao Registrada — ${porte.charAt(0).toUpperCase() + porte.slice(1)} (Sem Dinheiro)`)
    .addFields(
      { name: "Valor por pessoa", value: `$${valorPorPessoa.toLocaleString()}`, inline: true },
      { name: "Total pago pelo caixa", value: `$${totalNecessario.toLocaleString()}`, inline: true },
      { name: "Novo saldo caixa", value: `$${(caixa.saldo - totalNecessario).toLocaleString()}`, inline: true },
      { name: `Participantes (${participantes.length})`, value: lista },
    )
    .setFooter({ text: `Registrado por ${adminNome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
