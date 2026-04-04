import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { getSemanaAtual, getDiaAtual, getMetaSemanal, getCargoLabel, temMeta, CARGOS_RELATORIO } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("relatorio")
  .setDescription("Relatorios da organizacao (gerente de farm+)")
  .addSubcommand((sub) =>
    sub.setName("semana").setDescription("Relatorio completo da semana atual"),
  )
  .addSubcommand((sub) =>
    sub.setName("dia").setDescription("Relatorio completo do dia atual"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("membro")
      .setDescription("Relatorio individual de um membro")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("top").setDescription("Top 3 de farm, vendas e acoes"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_RELATORIO.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente de Farm ou superior** pode ver o relatorio.", ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  if (sub === "dia") await dia(interaction);
  else if (sub === "membro") await relatorioMembro(interaction);
  else if (sub === "top") await top(interaction);
  else await semana(interaction);
}

async function semana(interaction: ChatInputCommandInteraction) {
  const semanaAtual = getSemanaAtual();
  const medalhas = ["🥇", "🥈", "🥉"];

  // Farm
  const totalFarm = db
    .prepare("SELECT COALESCE(SUM(polvora), 0) as polvora, COALESCE(SUM(capsula), 0) as capsula, COUNT(*) as entregas FROM farm_entregas WHERE semana = ?")
    .get(semanaAtual) as { polvora: number; capsula: number; entregas: number };

  const rankingFarm = db
    .prepare(`
      SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(f.polvora), 0) as total_polvora,
        COALESCE(SUM(f.capsula), 0) as total_capsula
      FROM membros m
      LEFT JOIN farm_entregas f ON f.membro_id = m.id AND f.semana = ?
      WHERE m.ativo = 1
      GROUP BY m.id
      ORDER BY total_polvora DESC
    `)
    .all(semanaAtual) as Array<{ nome: string; cargo: string; membro_id: number; total_polvora: number; total_capsula: number }>;

  let topFarmers = "";
  for (let i = 0; i < Math.min(3, rankingFarm.length); i++) {
    if (rankingFarm[i].total_polvora === 0) break;
    topFarmers += `${medalhas[i]} **${rankingFarm[i].nome}** — ${rankingFarm[i].total_polvora} polvora | ${rankingFarm[i].total_capsula} capsula\n`;
  }

  let metasBatidas = "";
  let metasPendentes = "";
  for (const r of rankingFarm) {
    if (!temMeta(r.cargo)) continue;
    const meta = getMetaSemanal(r.cargo);
    const bateu = r.total_polvora >= meta.polvora && r.total_capsula >= meta.capsula;
    const linha = `${r.nome} (${getCargoLabel(r.cargo)}) — ${r.total_polvora}/${meta.polvora} polvora | ${r.total_capsula}/${meta.capsula} capsula\n`;
    if (bateu) metasBatidas += `✅ ${linha}`;
    else metasPendentes += `❌ ${linha}`;
  }

  // Vendas
  const totalVendas = db
    .prepare("SELECT COALESCE(SUM(quantidade), 0) as qtd_municoes, COALESCE(SUM(receita_total), 0) as receita, COUNT(*) as vendas FROM vendas WHERE criado_em >= date('now', 'weekday 0', '-6 days')")
    .get() as { qtd_municoes: number; receita: number; vendas: number };

  const topVendedores = db
    .prepare(`
      SELECT m.nome, COALESCE(SUM(v.quantidade), 0) as municoes, COALESCE(SUM(v.valor_vendedor), 0) as ganhos
      FROM membros m
      JOIN vendas v ON v.vendedor_discord_id = m.discord_id
      WHERE v.criado_em >= date('now', 'weekday 0', '-6 days')
      GROUP BY m.discord_id
      ORDER BY municoes DESC
      LIMIT 3
    `)
    .all() as Array<{ nome: string; municoes: number; ganhos: number }>;

  let topVendasText = "";
  for (let i = 0; i < topVendedores.length; i++) {
    topVendasText += `${medalhas[i] ?? `${i + 1}.`} **${topVendedores[i].nome}** — ${topVendedores[i].municoes} municoes | $${topVendedores[i].ganhos.toLocaleString()}\n`;
  }

  // Estoque
  const estoque = db
    .prepare("SELECT material, quantidade FROM estoque ORDER BY material")
    .all() as Array<{ material: string; quantidade: number }>;
  const estoqueText = estoque.map((e) => `**${e.material}:** ${e.quantidade}`).join(" | ") || "Vazio";

  // Bonus
  const bonusSemana = db
    .prepare(`
      SELECT m.nome, b.valor, b.descricao, b.tipo
      FROM bonus_log b
      JOIN membros m ON m.id = b.membro_id
      WHERE b.semana = ?
      ORDER BY b.valor DESC
    `)
    .all(semanaAtual) as Array<{ nome: string; valor: number; descricao: string | null; tipo: string }>;

  let bonusText = "";
  let totalBonus = 0;
  for (const b of bonusSemana) {
    const emoji = b.tipo === "farm_fds" ? "🎉" : "🌾";
    bonusText += `${emoji} ${b.nome} — $${b.valor.toLocaleString()} (${b.descricao ?? b.tipo})\n`;
    totalBonus += b.valor;
  }

  // Acoes
  const acoesSemana = db
    .prepare("SELECT valor_total, valor_caixa, quantidade_membros, valor_por_membro FROM acoes WHERE semana = ?")
    .all(semanaAtual) as Array<{ valor_total: number; valor_caixa: number; quantidade_membros: number; valor_por_membro: number }>;

  let acoesText = "";
  let totalAcoesCaixa = 0;
  for (const a of acoesSemana) {
    acoesText += `⚔️ $${a.valor_total.toLocaleString()} — ${a.quantidade_membros} membros | $${a.valor_por_membro.toLocaleString()}/pessoa | Caixa: $${a.valor_caixa.toLocaleString()}\n`;
    totalAcoesCaixa += a.valor_caixa;
  }

  // Caixa
  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📊 Relatorio Semanal — ${semanaAtual}`)
        .addFields(
          { name: "🌾 Farm", value: `${totalFarm.polvora} polvora | ${totalFarm.capsula} capsula | ${totalFarm.entregas} entregas` },
          { name: "🏆 Top Farmers", value: topFarmers || "Nenhum farm registrado." },
          { name: "✅ Metas Batidas", value: metasBatidas || "Nenhuma ainda." },
          { name: "❌ Metas Pendentes", value: metasPendentes || "Todos bateram a meta!" },
          { name: `🛒 Vendas — ${totalVendas.vendas} vendas | ${totalVendas.qtd_municoes} municoes | $${totalVendas.receita.toLocaleString()}`, value: topVendasText || "Nenhuma venda registrada." },
          { name: `🎉 Bonus — $${totalBonus.toLocaleString()}`, value: bonusText || "Nenhum bonus pago." },
          { name: `⚔️ Acoes (${acoesSemana.length}) — Caixa recebeu $${totalAcoesCaixa.toLocaleString()}`, value: acoesText || "Nenhuma acao registrada." },
          { name: "📦 Estoque atual", value: estoqueText },
          { name: "💰 Saldo Caixa", value: `$${caixa.saldo.toLocaleString()}`, inline: true },
        )
        .setTimestamp(),
    ],
  });
}

async function dia(interaction: ChatInputCommandInteraction) {
  const hoje = getDiaAtual();
  const medalhas = ["🥇", "🥈", "🥉"];

  // Farm
  const totalFarm = db
    .prepare("SELECT COALESCE(SUM(polvora), 0) as polvora, COALESCE(SUM(capsula), 0) as capsula, COUNT(*) as entregas FROM farm_entregas WHERE DATE(criado_em) = ?")
    .get(hoje) as { polvora: number; capsula: number; entregas: number };

  const rankingFarm = db
    .prepare(`
      SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(f.polvora), 0) as total_polvora,
        COALESCE(SUM(f.capsula), 0) as total_capsula
      FROM membros m
      LEFT JOIN farm_entregas f ON f.membro_id = m.id AND DATE(f.criado_em) = ?
      WHERE m.ativo = 1
      GROUP BY m.id
      ORDER BY total_polvora DESC
    `)
    .all(hoje) as Array<{ nome: string; cargo: string; membro_id: number; total_polvora: number; total_capsula: number }>;

  let topFarmers = "";
  for (let i = 0; i < Math.min(3, rankingFarm.length); i++) {
    if (rankingFarm[i].total_polvora === 0) break;
    topFarmers += `${medalhas[i]} **${rankingFarm[i].nome}** — ${rankingFarm[i].total_polvora} polvora\n`;
  }

  // Vendas
  const totalVendas = db
    .prepare("SELECT COALESCE(SUM(quantidade), 0) as municoes, COALESCE(SUM(receita_total), 0) as receita, COUNT(*) as vendas FROM vendas WHERE DATE(criado_em) = ?")
    .get(hoje) as { municoes: number; receita: number; vendas: number };

  const topVendedores = db
    .prepare(`
      SELECT m.nome, COALESCE(SUM(v.quantidade), 0) as municoes
      FROM membros m
      JOIN vendas v ON v.vendedor_discord_id = m.discord_id
      WHERE DATE(v.criado_em) = ?
      GROUP BY m.discord_id
      ORDER BY municoes DESC
      LIMIT 3
    `)
    .all(hoje) as Array<{ nome: string; municoes: number }>;

  let topVendasText = "";
  for (let i = 0; i < topVendedores.length; i++) {
    topVendasText += `${medalhas[i] ?? `${i + 1}.`} **${topVendedores[i].nome}** — ${topVendedores[i].municoes} municoes\n`;
  }

  // Acoes
  const acoesDia = db
    .prepare("SELECT valor_total, valor_caixa, quantidade_membros FROM acoes WHERE DATE(criado_em) = ?")
    .all(hoje) as Array<{ valor_total: number; valor_caixa: number; quantidade_membros: number }>;

  let acoesText = "";
  let totalAcoesCaixa = 0;
  for (const a of acoesDia) {
    acoesText += `⚔️ $${a.valor_total.toLocaleString()} — ${a.quantidade_membros} membros | Caixa: $${a.valor_caixa.toLocaleString()}\n`;
    totalAcoesCaixa += a.valor_caixa;
  }

  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle(`📋 Relatorio Diario — ${hoje}`)
        .addFields(
          { name: "🌾 Farm", value: `${totalFarm.polvora} polvora | ${totalFarm.capsula} capsula | ${totalFarm.entregas} entregas` },
          { name: "🏆 Top Farmers", value: topFarmers || "Nenhum farm registrado." },
          { name: `🛒 Vendas — ${totalVendas.vendas} vendas | ${totalVendas.municoes} municoes | $${totalVendas.receita.toLocaleString()}`, value: topVendasText || "Nenhuma venda registrada." },
          { name: `⚔️ Acoes (${acoesDia.length}) — Caixa recebeu $${totalAcoesCaixa.toLocaleString()}`, value: acoesText || "Nenhuma acao registrada." },
          { name: "💰 Saldo Caixa", value: `$${caixa.saldo.toLocaleString()}`, inline: true },
        )
        .setTimestamp(),
    ],
  });
}

async function relatorioMembro(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const semanaAtual = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string; cargo: string; passaporte: string | null; criado_em: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  const farmSemana = db
    .prepare("SELECT COALESCE(SUM(polvora), 0) as polvora, COALESCE(SUM(capsula), 0) as capsula, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semanaAtual) as { polvora: number; capsula: number; entregas: number };

  const ganhosFarm = db
    .prepare("SELECT COALESCE(SUM(fp.valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semanaAtual) as { total: number };

  const vendasSemana = db
    .prepare("SELECT COALESCE(SUM(valor_vendedor), 0) as ganhos, COALESCE(SUM(quantidade), 0) as municoes, COUNT(*) as qtd FROM vendas WHERE vendedor_discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(usuario.id) as { ganhos: number; municoes: number; qtd: number };

  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semanaAtual) as { total: number };

  const divida = db
    .prepare("SELECT valor_devido FROM dividas WHERE membro_discord_id = ?")
    .get(usuario.id) as { valor_devido: number } | undefined;

  const advertencias = (db.prepare("SELECT COUNT(*) as total FROM advertencias WHERE membro_id = ? AND ativa = 1").get(membro.id) as { total: number }).total;

  const meta = getMetaSemanal(membro.cargo);
  const totalGanhos = ganhosFarm.total + vendasSemana.ganhos + bonusSemana.total;

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle(`📊 Relatorio — ${membro.nome}`)
        .addFields(
          { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
          { name: "Passaporte", value: membro.passaporte != null ? String(membro.passaporte) : "N/A", inline: true },
          { name: "Membro desde", value: membro.criado_em.split(" ")[0], inline: true },
          { name: "━━━ Farm ━━━", value: "\u200b" },
          { name: "Polvora", value: `${farmSemana.polvora}/${temMeta(membro.cargo) ? meta.polvora : "—"}`, inline: true },
          { name: "Capsula", value: `${farmSemana.capsula}/${temMeta(membro.cargo) ? meta.capsula : "—"}`, inline: true },
          { name: "Entregas", value: `${farmSemana.entregas}`, inline: true },
          { name: "━━━ Vendas ━━━", value: "\u200b" },
          { name: "Municoes vendidas", value: `${vendasSemana.municoes} (${vendasSemana.qtd} vendas)`, inline: true },
          { name: "Ganhos vendas", value: `$${vendasSemana.ganhos.toLocaleString()}`, inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: "━━━ Resumo ━━━", value: "\u200b" },
          { name: "💰 Ganhos farm", value: `$${ganhosFarm.total.toLocaleString()}`, inline: true },
          { name: "🎉 Bonus", value: `$${bonusSemana.total.toLocaleString()}`, inline: true },
          { name: "📊 Total semana", value: `**$${totalGanhos.toLocaleString()}**`, inline: true },
          { name: "💳 Divida com caixa", value: `$${(divida?.valor_devido ?? 0).toLocaleString()}`, inline: true },
          { name: "⚠️ Advertencias ativas", value: `${advertencias}/3`, inline: true },
        )
        .setTimestamp(),
    ],
  });
}

async function top(interaction: ChatInputCommandInteraction) {
  const semanaAtual = getSemanaAtual();
  const medalhas = ["🥇", "🥈", "🥉"];

  const topFarm = db.prepare(`
    SELECT m.nome, COALESCE(SUM(f.polvora), 0) as polvora
    FROM membros m
    JOIN farm_entregas f ON f.membro_id = m.id
    WHERE f.semana = ?
    GROUP BY m.id
    ORDER BY polvora DESC
    LIMIT 3
  `).all(semanaAtual) as Array<{ nome: string; polvora: number }>;

  const topVendas = db.prepare(`
    SELECT m.nome, COALESCE(SUM(v.quantidade), 0) as municoes
    FROM membros m
    JOIN vendas v ON v.vendedor_discord_id = m.discord_id
    WHERE v.criado_em >= date('now', 'weekday 0', '-6 days')
    GROUP BY m.discord_id
    ORDER BY municoes DESC
    LIMIT 3
  `).all() as Array<{ nome: string; municoes: number }>;

  const topAcoes = db.prepare(`
    SELECT registrado_por, COUNT(*) as qtd, SUM(valor_total) as total
    FROM acoes
    WHERE semana = ?
    GROUP BY registrado_por
    ORDER BY total DESC
    LIMIT 3
  `).all(semanaAtual) as Array<{ registrado_por: string; qtd: number; total: number }>;

  let farmText = topFarm.map((r, i) => `${medalhas[i]} **${r.nome}** — ${r.polvora} polvora`).join("\n") || "Nenhum registro.";
  let vendasText = topVendas.map((r, i) => `${medalhas[i]} **${r.nome}** — ${r.municoes} municoes`).join("\n") || "Nenhum registro.";
  let acoesText = topAcoes.map((r, i) => `${medalhas[i]} <@${r.registrado_por}> — ${r.qtd} acoes | $${r.total.toLocaleString()}`).join("\n") || "Nenhum registro.";

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle(`🏆 Top 3 — ${semanaAtual}`)
        .addFields(
          { name: "🌾 Farm", value: farmText, inline: true },
          { name: "🛒 Vendas", value: vendasText, inline: true },
          { name: "⚔️ Acoes", value: acoesText, inline: false },
        )
        .setTimestamp(),
    ],
  });
}
