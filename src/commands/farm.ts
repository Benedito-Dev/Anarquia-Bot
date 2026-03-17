import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { getSemanaAtual, getMetaSemanal, getCargoLabel } from "../utils/semana";

const PRECO_SEM_PARCERIA = 8300;
const PRECO_COM_PARCERIA = 6500;
const PRECO_BASE_FARMER = Math.round((PRECO_SEM_PARCERIA + PRECO_COM_PARCERIA) / 2); // Media: 7.400
const PERCENT_FARMER = 0.25;
const COBRES_POR_PRODUTO = 6;
const ALUMINIOS_POR_PRODUTO = 6;

// Bonus por produtividade semanal
const BONUS_TIERS = [
  { cobres: 900, bonus: 50000, label: "900 cobres → +50k" },
  { cobres: 600, bonus: 25000, label: "600 cobres → +25k" },
  { cobres: 450, bonus: 10000, label: "450 cobres → +10k" },
];

export const data = new SlashCommandBuilder()
  .setName("farm")
  .setDescription("Comandos de farm")
  .addSubcommand((sub) =>
    sub
      .setName("registrar")
      .setDescription("Registrar entrega de materiais")
      .addIntegerOption((opt) =>
        opt
          .setName("cobres")
          .setDescription("Quantidade de cobres")
          .setRequired(true)
          .setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt
          .setName("aluminios")
          .setDescription("Quantidade de aluminios")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("metas").setDescription("Ver progresso da meta semanal"),
  )
  .addSubcommand((sub) =>
    sub.setName("ranking").setDescription("Ranking de farm da semana"),
  )
  .addSubcommand((sub) =>
    sub.setName("ganhos").setDescription("Ver seus ganhos da semana"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "registrar") {
    await registrar(interaction);
  } else if (subcommand === "metas") {
    await metas(interaction);
  } else if (subcommand === "ranking") {
    await ranking(interaction);
  } else if (subcommand === "ganhos") {
    await ganhos(interaction);
  }
}

async function registrar(interaction: ChatInputCommandInteraction) {
  const cobres = interaction.options.getInteger("cobres", true);
  const aluminios = interaction.options.getInteger("aluminios", true);
  const discordId = interaction.user.id;
  const semana = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({
      content: "Voce nao esta cadastrado na familia. Peca a um admin para te cadastrar com `/membro cadastrar`.",
      ephemeral: true,
    });
    return;
  }

  // Calcular produtos equivalentes e pagamento do farmer
  const produtosEquivalentes = Math.min(
    Math.floor(cobres / COBRES_POR_PRODUTO),
    Math.floor(aluminios / ALUMINIOS_POR_PRODUTO),
  );
  const receitaBase = produtosEquivalentes * PRECO_BASE_FARMER;
  const pagamentoFarmer = Math.round(receitaBase * PERCENT_FARMER);

  // Registrar tudo em transaction
  const registrarTransaction = db.transaction(() => {
    // Registrar entrega
    const result = db.prepare(
      "INSERT INTO farm_entregas (membro_id, cobres, aluminios, semana) VALUES (?, ?, ?, ?)",
    ).run(membro.id, cobres, aluminios, semana);

    // Atualizar estoque
    db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = 'cobres'").run(cobres);
    db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = 'aluminios'").run(aluminios);

    // Log de estoque
    db.prepare(
      "INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)",
    ).run("cobres", cobres, "entrada", `Farm de ${membro.nome}`, discordId);
    db.prepare(
      "INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)",
    ).run("aluminios", aluminios, "entrada", `Farm de ${membro.nome}`, discordId);

    // Registrar pagamento do farmer
    if (produtosEquivalentes > 0) {
      db.prepare(
        "INSERT INTO farmer_pagamentos (membro_id, farm_entrega_id, produtos_equivalentes, valor_pago) VALUES (?, ?, ?, ?)",
      ).run(membro.id, result.lastInsertRowid, produtosEquivalentes, pagamentoFarmer);
    }

    return result.lastInsertRowid;
  });

  registrarTransaction();

  // Verificar bonus semanal
  const totalSemana = db
    .prepare(
      "SELECT COALESCE(SUM(cobres), 0) as total_cobres, COALESCE(SUM(aluminios), 0) as total_aluminios FROM farm_entregas WHERE membro_id = ? AND semana = ?",
    )
    .get(membro.id, semana) as { total_cobres: number; total_aluminios: number };

  // Checar se atingiu novo tier de bonus
  const bonusJaRecebidos = db
    .prepare("SELECT valor FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'farm_produtividade'")
    .all(membro.id, semana) as Array<{ valor: number }>;
  const valoresJaRecebidos = new Set(bonusJaRecebidos.map((b) => b.valor));

  let bonusNovo = "";
  for (const tier of BONUS_TIERS) {
    if (totalSemana.total_cobres >= tier.cobres && !valoresJaRecebidos.has(tier.bonus)) {
      db.prepare(
        "INSERT INTO bonus_log (membro_id, tipo, valor, descricao, semana) VALUES (?, ?, ?, ?, ?)",
      ).run(membro.id, "farm_produtividade", tier.bonus, tier.label, semana);
      bonusNovo += `🎉 **BONUS DESBLOQUEADO:** ${tier.label}\n`;
    }
  }

  const meta = getMetaSemanal(membro.cargo);
  const progresso = meta > 0 ? Math.min(100, Math.round((totalSemana.total_cobres / meta) * 100)) : 100;
  const barraProgresso = gerarBarra(progresso);

  // Ganhos totais da semana
  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle("Farm Registrado!")
    .setDescription(bonusNovo || null)
    .addFields(
      { name: "Entrega", value: `${cobres} cobres | ${aluminios} aluminios`, inline: true },
      { name: "Produtos equivalentes", value: `${produtosEquivalentes}`, inline: true },
      { name: "Seu pagamento", value: `$${pagamentoFarmer.toLocaleString()}`, inline: true },
      { name: "Semana acumulado", value: `${totalSemana.total_cobres} cobres | ${totalSemana.total_aluminios} aluminios`, inline: true },
      { name: "Ganhos da semana", value: `$${ganhosSemana.total.toLocaleString()}`, inline: true },
      { name: `Meta (${meta} cobres)`, value: `${barraProgresso} ${progresso}%` },
    )
    .setFooter({ text: `${membro.nome} | ${getCargoLabel(membro.cargo)}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function metas(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;
  const semana = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({
      content: "Voce nao esta cadastrado. Peca a um admin para te cadastrar.",
      ephemeral: true,
    });
    return;
  }

  const totalSemana = db
    .prepare(
      "SELECT COALESCE(SUM(cobres), 0) as total_cobres, COALESCE(SUM(aluminios), 0) as total_aluminios, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ? AND semana = ?",
    )
    .get(membro.id, semana) as { total_cobres: number; total_aluminios: number; entregas: number };

  const meta = getMetaSemanal(membro.cargo);
  const progresso = meta > 0 ? Math.min(100, Math.round((totalSemana.total_cobres / meta) * 100)) : 100;
  const barraProgresso = gerarBarra(progresso);
  const falta = Math.max(0, meta - totalSemana.total_cobres);
  const lotes = Math.floor(totalSemana.total_cobres / 150);

  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(progresso >= 100 ? 0x00ae86 : 0xffa500)
    .setTitle(`Meta Semanal — ${membro.nome}`)
    .addFields(
      { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
      { name: "Entregas", value: `${totalSemana.entregas}`, inline: true },
      { name: "Lotes completos", value: `${lotes}`, inline: true },
      { name: "Cobres", value: `${totalSemana.total_cobres} / ${meta}`, inline: true },
      { name: "Aluminios", value: `${totalSemana.total_aluminios}`, inline: true },
      { name: "Falta", value: falta > 0 ? `${falta} cobres` : "Meta batida! ✅", inline: true },
      { name: "Progresso", value: `${barraProgresso} ${progresso}%` },
      { name: "Ganhos farm", value: `$${ganhosSemana.total.toLocaleString()}`, inline: true },
      { name: "Bonus", value: `$${bonusSemana.total.toLocaleString()}`, inline: true },
      { name: "Total semana", value: `$${(ganhosSemana.total + bonusSemana.total).toLocaleString()}`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function ranking(interaction: ChatInputCommandInteraction) {
  const semana = getSemanaAtual();

  const rows = db
    .prepare(
      `SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(f.cobres), 0) as total_cobres,
        COALESCE(SUM(f.aluminios), 0) as total_aluminios,
        COUNT(f.id) as entregas
      FROM membros m
      LEFT JOIN farm_entregas f ON f.membro_id = m.id AND f.semana = ?
      WHERE m.ativo = 1
      GROUP BY m.id
      ORDER BY total_cobres DESC
      LIMIT 15`,
    )
    .all(semana) as Array<{
    nome: string;
    cargo: string;
    membro_id: number;
    total_cobres: number;
    total_aluminios: number;
    entregas: number;
  }>;

  if (rows.length === 0) {
    await interaction.reply({ content: "Nenhum membro cadastrado ainda.", ephemeral: true });
    return;
  }

  const medalhas = ["🥇", "🥈", "🥉"];
  let rankingText = "";

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const medal = medalhas[index] ?? `**${index + 1}.**`;
    const meta = getMetaSemanal(row.cargo);
    const status = meta > 0 && row.total_cobres >= meta ? " ✅" : "";

    const ganhos = db
      .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
      .get(row.membro_id, semana) as { total: number };

    rankingText += `${medal} **${row.nome}** (${getCargoLabel(row.cargo)}) — ${row.total_cobres} cobres | $${ganhos.total.toLocaleString()}${status}\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xffd700)
    .setTitle(`Ranking de Farm — Semana ${semana}`)
    .setDescription(rankingText)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function ganhos(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;
  const semana = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: "Voce nao esta cadastrado.", ephemeral: true });
    return;
  }

  const ganhosFarm = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusFarm = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'farm_produtividade'")
    .get(membro.id, semana) as { total: number };

  const ganhoVendas = db
    .prepare("SELECT COALESCE(SUM(valor_vendedor), 0) as total, COUNT(*) as vendas FROM vendas WHERE vendedor_discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(discordId) as { total: number; vendas: number };

  const totalGeral = ganhosFarm.total + bonusFarm.total + ganhoVendas.total;

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`Ganhos da Semana — ${membro.nome}`)
    .addFields(
      { name: "💰 Farm (25%)", value: `$${ganhosFarm.total.toLocaleString()}`, inline: true },
      { name: "🎉 Bonus farm", value: `$${bonusFarm.total.toLocaleString()}`, inline: true },
      { name: "🛒 Vendas (45%)", value: `$${ganhoVendas.total.toLocaleString()} (${ganhoVendas.vendas} vendas)`, inline: true },
      { name: "═══════════", value: "\u200b" },
      { name: "📊 TOTAL SEMANA", value: `**$${totalGeral.toLocaleString()}**`, inline: true },
    )
    .setFooter({ text: getCargoLabel(membro.cargo) })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

function gerarBarra(porcentagem: number): string {
  const total = 10;
  const preenchido = Math.round((porcentagem / 100) * total);
  const vazio = total - preenchido;
  return "🟩".repeat(preenchido) + "⬜".repeat(vazio);
}
