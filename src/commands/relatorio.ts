import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { getSemanaAtual, getMetaSemanal, getDiaAtual, getCargoLabel, CARGOS_RELATORIO, getMetaDinheiroDiaria } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("relatorio")
  .setDescription("Relatorios da organizacao (admin)")
  .addSubcommand((sub) =>
    sub.setName("semana").setDescription("Relatorio completo da semana atual (admin)"),
  )
  .addSubcommand((sub) =>
    sub.setName("dia").setDescription("Relatorio completo do dia atual (admin)"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("membro")
      .setDescription("Relatorio individual completo de um membro (admin)")
      .addUserOption((opt) =>
        opt.setName("usuario").setDescription("Usuario do Discord").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("comparativo").setDescription("Compara semana atual vs semana anterior (admin)"),
  )
  .addSubcommand((sub) =>
    sub.setName("top").setDescription("Top 3 de farm, dinheiro, vendas e acoes (admin)"),
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
  if (sub === "dia") {
    await dia(interaction);
  } else if (sub === "membro") {
    await relatorioMembro(interaction);
  } else if (sub === "comparativo") {
    await comparativo(interaction);
  } else if (sub === "top") {
    await top(interaction);
  } else {
    await semana(interaction);
  }
}

async function dia(interaction: ChatInputCommandInteraction) {
  const hoje = getDiaAtual();

  // ── FARM ──
  const totalFarm = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as cobres, COALESCE(SUM(aluminios), 0) as aluminios, COUNT(*) as entregas FROM farm_entregas WHERE DATE(criado_em) = ?")
    .get(hoje) as { cobres: number; aluminios: number; entregas: number };

  const rankingFarm = db
    .prepare(`
      SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(f.cobres), 0) as total_cobres
      FROM membros m
      LEFT JOIN farm_entregas f ON f.membro_id = m.id AND DATE(f.criado_em) = ?
      WHERE m.ativo = 1
      GROUP BY m.id
      ORDER BY total_cobres DESC
    `)
    .all(hoje) as Array<{ nome: string; cargo: string; membro_id: number; total_cobres: number }>;

  const medalhas = ["🥇", "🥈", "🥉"];
  let topFarmers = "";
  for (let i = 0; i < Math.min(3, rankingFarm.length); i++) {
    if (rankingFarm[i].total_cobres === 0) break;
    topFarmers += `${medalhas[i]} **${rankingFarm[i].nome}** — ${rankingFarm[i].total_cobres} cobres\n`;
  }

  const metaDiaria = 200;
  let metasBatidas = "";
  let metasPendentes = "";
  for (const r of rankingFarm) {
    const meta = getMetaSemanal(r.cargo);
    if (meta === 0) continue;
    const linha = `${r.nome} (${getCargoLabel(r.cargo)}) — ${r.total_cobres}/${metaDiaria}\n`;
    if (r.total_cobres >= metaDiaria) metasBatidas += `✅ ${linha}`;
    else metasPendentes += `❌ ${linha}`;
  }

  // ── VENDAS ──
  const totalVendas = db
    .prepare("SELECT COALESCE(SUM(quantidade_produtos), 0) as produtos, COALESCE(SUM(receita_total), 0) as receita, COUNT(*) as qtd FROM vendas WHERE DATE(criado_em) = ?")
    .get(hoje) as { produtos: number; receita: number; qtd: number };

  const topVendedores = db
    .prepare(`
      SELECT m.nome, COALESCE(SUM(v.quantidade_produtos), 0) as produtos, COALESCE(SUM(v.valor_vendedor), 0) as ganhos
      FROM membros m
      JOIN vendas v ON v.vendedor_discord_id = m.discord_id
      WHERE DATE(v.criado_em) = ?
      GROUP BY m.discord_id
      ORDER BY produtos DESC
      LIMIT 3
    `)
    .all(hoje) as Array<{ nome: string; produtos: number; ganhos: number }>;

  let topVendasText = "";
  for (let i = 0; i < topVendedores.length; i++) {
    topVendasText += `${medalhas[i] ?? `${i + 1}.`} **${topVendedores[i].nome}** — ${topVendedores[i].produtos} produtos | $${topVendedores[i].ganhos.toLocaleString()}\n`;
  }

  // ── DINHEIRO SUJO ──
  const totalDinheiro = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as entregas FROM dinheiro_entregas WHERE DATE(criado_em) = ?")
    .get(hoje) as { total: number; entregas: number };

  const rankingDinheiro = db
    .prepare(`
      SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(d.valor), 0) as total_valor
      FROM membros m
      LEFT JOIN dinheiro_entregas d ON d.membro_id = m.id AND DATE(d.criado_em) = ?
      WHERE m.ativo = 1 AND m.cargo IN ('iniciante','membro','farmer veterano','gerente')
      GROUP BY m.id
      ORDER BY total_valor DESC
    `)
    .all(hoje) as Array<{ nome: string; cargo: string; membro_id: number; total_valor: number }>;

  let topDinheiro = "";
  for (let i = 0; i < Math.min(3, rankingDinheiro.length); i++) {
    if (rankingDinheiro[i].total_valor === 0) break;
    topDinheiro += `${medalhas[i]} **${rankingDinheiro[i].nome}** — $${rankingDinheiro[i].total_valor.toLocaleString()}\n`;
  }

  const metaDiariaDinheiro = getMetaDinheiroDiaria();
  let dinheiroMetasBatidas = "";
  let dinheiroMetasPendentes = "";
  for (const r of rankingDinheiro) {
    const linha = `${r.nome} (${getCargoLabel(r.cargo)}) — $${r.total_valor.toLocaleString()}/$${metaDiariaDinheiro.toLocaleString()}\n`;
    if (r.total_valor >= metaDiariaDinheiro) dinheiroMetasBatidas += `✅ ${linha}`;
    else dinheiroMetasPendentes += `❌ ${linha}`;
  }

  // ── ACOES ──
  const acoesDia = db
    .prepare("SELECT tipo, porte, valor_total, valor_caixa FROM acoes WHERE DATE(criado_em) = ?")
    .all(hoje) as Array<{ tipo: string; porte: string | null; valor_total: number; valor_caixa: number }>;

  let acoesText = "";
  let totalAcoesCaixa = 0;
  for (const a of acoesDia) {
    const label = a.tipo === "com_dinheiro" ? `Com dinheiro ($${a.valor_total.toLocaleString()})` : `Sem dinheiro — ${a.porte}`;
    acoesText += `⚔️ ${label} | Caixa: $${a.valor_caixa.toLocaleString()}\n`;
    totalAcoesCaixa += a.valor_caixa;
  }

  // ── CAIXA ──
  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`📋 Relatorio Diario — ${hoje}`)
    .addFields(
      {
        name: "🌾 Farm",
        value: `${totalFarm.cobres} cobres | ${totalFarm.aluminios} aluminios | ${totalFarm.entregas} entregas`,
      },
      {
        name: "🏆 Top Farmers",
        value: topFarmers || "Nenhum farm registrado.",
      },
      {
        name: "✅ Metas Farm Batidas",
        value: metasBatidas || "Nenhuma ainda.",
      },
      {
        name: "❌ Metas Farm Pendentes",
        value: metasPendentes || "Todos bateram a meta!",
      },
      {
        name: `🛒 Vendas — ${totalVendas.qtd} vendas | ${totalVendas.produtos} produtos | $${totalVendas.receita.toLocaleString()}`,
        value: topVendasText || "Nenhuma venda registrada.",
      },
      {
        name: `💵 Dinheiro Sujo — $${totalDinheiro.total.toLocaleString()} | ${totalDinheiro.entregas} entregas`,
        value: topDinheiro || "Nenhuma entrega registrada.",
      },
      {
        name: "✅ Metas Dinheiro Batidas",
        value: dinheiroMetasBatidas || "Nenhuma ainda.",
      },
      {
        name: "❌ Metas Dinheiro Pendentes",
        value: dinheiroMetasPendentes || "Todos bateram a meta!",
      },
      {
        name: `⚔️ Acoes (${acoesDia.length}) — Caixa recebeu $${totalAcoesCaixa.toLocaleString()}`,
        value: acoesText || "Nenhuma acao registrada.",
      },
      {
        name: "💰 Saldo Caixa Atual",
        value: `$${caixa.saldo.toLocaleString()}`,
        inline: true,
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function relatorioMembro(interaction: ChatInputCommandInteraction) {
  const usuario = interaction.options.getUser("usuario", true);
  const semanaAtual = getSemanaAtual();
  const hoje = getDiaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(usuario.id) as { id: number; nome: string; cargo: string; passaporte: string | null; criado_em: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `**${usuario.displayName}** nao esta cadastrado.`, ephemeral: true });
    return;
  }

  // Farm
  const farmSemana = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as cobres, COALESCE(SUM(aluminios), 0) as aluminios, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semanaAtual) as { cobres: number; aluminios: number; entregas: number };
  const farmHoje = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as cobres FROM farm_entregas WHERE membro_id = ? AND DATE(criado_em) = ?")
    .get(membro.id, hoje) as { cobres: number };
  const ganhosFarm = db
    .prepare("SELECT COALESCE(SUM(fp.valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semanaAtual) as { total: number };

  // Dinheiro sujo
  const dinheiroSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as entregas FROM dinheiro_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semanaAtual) as { total: number; entregas: number };
  const dinheiroHoje = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM dinheiro_entregas WHERE membro_id = ? AND DATE(criado_em) = ?")
    .get(membro.id, hoje) as { total: number };
  const ganhosDinheiro = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM dinheiro_pagamentos dp JOIN dinheiro_entregas de ON dp.entrega_id = de.id WHERE dp.membro_id = ? AND de.semana = ?")
    .get(membro.id, semanaAtual) as { total: number };

  // Vendas
  const vendasSemana = db
    .prepare("SELECT COALESCE(SUM(valor_vendedor), 0) as ganhos, COALESCE(SUM(quantidade_produtos), 0) as produtos, COUNT(*) as qtd FROM vendas WHERE vendedor_discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(usuario.id) as { ganhos: number; produtos: number; qtd: number };

  // Bonus
  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semanaAtual) as { total: number };

  // Acoes
  const acoesSemana = db
    .prepare("SELECT COUNT(*) as qtd, COALESCE(SUM(valor_recebido), 0) as total FROM acao_participantes WHERE discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(usuario.id) as { qtd: number; total: number };

  // Divida
  const divida = db
    .prepare("SELECT valor_devido FROM dividas WHERE membro_discord_id = ?")
    .get(usuario.id) as { valor_devido: number } | undefined;

  // Advertencias ativas
  const advertencias = (db.prepare("SELECT COUNT(*) as total FROM advertencias WHERE membro_id = ? AND ativa = 1").get(membro.id) as { total: number }).total;

  const metaFarm = getMetaSemanal(membro.cargo);
  const metaDinheiro = 50000;
  const totalGanhos = ganhosFarm.total + ganhosDinheiro.total + vendasSemana.ganhos + bonusSemana.total + acoesSemana.total;

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📊 Relatorio — ${membro.nome}`)
    .addFields(
      { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
      { name: "Passaporte", value: membro.passaporte != null ? String(membro.passaporte) : "N/A", inline: true },
      { name: "Membro desde", value: membro.criado_em.split(" ")[0], inline: true },
      { name: "━━━ Farm ━━━", value: "\u200b" },
      { name: "Hoje", value: `${farmHoje.cobres}/${metaFarm > 0 ? metaFarm : "—"} cobres`, inline: true },
      { name: "Semana", value: `${farmSemana.cobres} cobres | ${farmSemana.entregas} entregas`, inline: true },
      { name: "Ganhos farm", value: `$${ganhosFarm.total.toLocaleString()}`, inline: true },
      { name: "━━━ Dinheiro Sujo ━━━", value: "\u200b" },
      { name: "Hoje", value: `$${dinheiroHoje.total.toLocaleString()}/$${metaDinheiro.toLocaleString()}`, inline: true },
      { name: "Semana", value: `$${dinheiroSemana.total.toLocaleString()} | ${dinheiroSemana.entregas} entregas`, inline: true },
      { name: "Ganhos dinheiro", value: `$${ganhosDinheiro.total.toLocaleString()}`, inline: true },
      { name: "━━━ Vendas / Acoes ━━━", value: "\u200b" },
      { name: "Vendas semana", value: `${vendasSemana.produtos} produtos (${vendasSemana.qtd} vendas) | $${vendasSemana.ganhos.toLocaleString()}`, inline: true },
      { name: "Acoes semana", value: `${acoesSemana.qtd} acoes | $${acoesSemana.total.toLocaleString()}`, inline: true },
      { name: "Bonus semana", value: `$${bonusSemana.total.toLocaleString()}`, inline: true },
      { name: "━━━ Resumo ━━━", value: "\u200b" },
      { name: "💰 Total ganhos semana", value: `**$${totalGanhos.toLocaleString()}**`, inline: true },
      { name: "💳 Divida com caixa", value: `$${(divida?.valor_devido ?? 0).toLocaleString()}`, inline: true },
      { name: "⚠️ Advertencias ativas", value: `${advertencias}/3`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function semana(interaction: ChatInputCommandInteraction) {
  const semanaAtual = getSemanaAtual();

  // ── FARM ──
  const totalFarm = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as cobres, COALESCE(SUM(aluminios), 0) as aluminios, COUNT(*) as entregas FROM farm_entregas WHERE semana = ?")
    .get(semanaAtual) as { cobres: number; aluminios: number; entregas: number };

  const ranking = db
    .prepare(`
      SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(f.cobres), 0) as total_cobres
      FROM membros m
      LEFT JOIN farm_entregas f ON f.membro_id = m.id AND f.semana = ?
      WHERE m.ativo = 1
      GROUP BY m.id
      ORDER BY total_cobres DESC
    `)
    .all(semanaAtual) as Array<{ nome: string; cargo: string; membro_id: number; total_cobres: number }>;

  const medalhas = ["🥇", "🥈", "🥉"];
  let topFarmers = "";
  for (let i = 0; i < Math.min(3, ranking.length); i++) {
    if (ranking[i].total_cobres === 0) break;
    topFarmers += `${medalhas[i]} **${ranking[i].nome}** — ${ranking[i].total_cobres} cobres\n`;
  }

  let metasBatidas = "";
  let metasPendentes = "";
  for (const r of ranking) {
    const meta = getMetaSemanal(r.cargo);
    if (meta === 0) continue;
    const linha = `${r.nome} (${getCargoLabel(r.cargo)}) — ${r.total_cobres}/${meta}\n`;
    if (r.total_cobres >= meta) metasBatidas += `✅ ${linha}`;
    else metasPendentes += `❌ ${linha}`;
  }

  // ── VENDAS ──
  const totalVendas = db
    .prepare("SELECT COALESCE(SUM(quantidade_produtos), 0) as produtos, COALESCE(SUM(receita_total), 0) as receita, COUNT(*) as qtd FROM vendas WHERE criado_em >= date('now', 'weekday 0', '-6 days')")
    .get() as { produtos: number; receita: number; qtd: number };

  const topVendedores = db
    .prepare(`
      SELECT m.nome, COALESCE(SUM(v.quantidade_produtos), 0) as produtos, COALESCE(SUM(v.valor_vendedor), 0) as ganhos
      FROM membros m
      JOIN vendas v ON v.vendedor_discord_id = m.discord_id
      WHERE v.criado_em >= date('now', 'weekday 0', '-6 days')
      GROUP BY m.discord_id
      ORDER BY produtos DESC
      LIMIT 3
    `)
    .all() as Array<{ nome: string; produtos: number; ganhos: number }>;

  let topVendasText = "";
  for (let i = 0; i < topVendedores.length; i++) {
    topVendasText += `${medalhas[i] ?? `${i + 1}.`} **${topVendedores[i].nome}** — ${topVendedores[i].produtos} produtos | $${topVendedores[i].ganhos.toLocaleString()}\n`;
  }

  // ── BONUS ──
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
    const emoji = b.tipo === "venda_volume" ? "🛒" : b.tipo === "dinheiro_produtividade" ? "💵" : "🌾";
    bonusText += `${emoji} ${b.nome} — $${b.valor.toLocaleString()} (${b.descricao ?? b.tipo})\n`;
    totalBonus += b.valor;
  }

  // ── DINHEIRO SUJO ──
  const totalDinheiro = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as entregas FROM dinheiro_entregas WHERE semana = ?")
    .get(semanaAtual) as { total: number; entregas: number };

  const rankingDinheiro = db
    .prepare(`
      SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(d.valor), 0) as total_valor
      FROM membros m
      LEFT JOIN dinheiro_entregas d ON d.membro_id = m.id AND d.semana = ?
      WHERE m.ativo = 1 AND m.cargo IN ('iniciante','membro','farmer veterano','gerente')
      GROUP BY m.id
      ORDER BY total_valor DESC
    `)
    .all(semanaAtual) as Array<{ nome: string; cargo: string; membro_id: number; total_valor: number }>;

  let topDinheiro = "";
  for (let i = 0; i < Math.min(3, rankingDinheiro.length); i++) {
    if (rankingDinheiro[i].total_valor === 0) break;
    topDinheiro += `${medalhas[i]} **${rankingDinheiro[i].nome}** — $${rankingDinheiro[i].total_valor.toLocaleString()}\n`;
  }

  const metaDiariaDinheiro = getMetaDinheiroDiaria();
  let dinheiroMetasBatidas = "";
  let dinheiroMetasPendentes = "";
  for (const r of rankingDinheiro) {
    const totalDia = db
      .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM dinheiro_entregas WHERE membro_id = ? AND DATE(criado_em) = date('now')")
      .get(r.membro_id) as { total: number };
    const linha = `${r.nome} (${getCargoLabel(r.cargo)}) — $${totalDia.total.toLocaleString()}/$${metaDiariaDinheiro.toLocaleString()}\n`;
    if (totalDia.total >= metaDiariaDinheiro) dinheiroMetasBatidas += `✅ ${linha}`;
    else dinheiroMetasPendentes += `❌ ${linha}`;
  }

  // ── ACOES ──
  const acoesSemana = db
    .prepare("SELECT tipo, porte, valor_total, valor_caixa FROM acoes WHERE semana = ?")
    .all(semanaAtual) as Array<{ tipo: string; porte: string | null; valor_total: number; valor_caixa: number }>;

  let acoesText = "";
  let totalAcoesCaixa = 0;
  for (const a of acoesSemana) {
    const label = a.tipo === "com_dinheiro" ? `Com dinheiro ($${a.valor_total.toLocaleString()})` : `Sem dinheiro — ${a.porte}`;
    acoesText += `⚔️ ${label} | Caixa: $${a.valor_caixa.toLocaleString()}\n`;
    totalAcoesCaixa += a.valor_caixa;
  }

  // ── CAIXA ──
  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };
  const pagLideranca = db
    .prepare(`SELECT COALESCE(SUM(ABS(valor)), 0) as total FROM caixa_log WHERE tipo = 'pagamento_lideranca' AND descricao LIKE ?`)
    .get(`%${semanaAtual}%`) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📊 Relatorio Semanal — ${semanaAtual}`)
    .addFields(
      {
        name: "🌾 Farm",
        value: `${totalFarm.cobres} cobres | ${totalFarm.aluminios} aluminios | ${totalFarm.entregas} entregas`,
      },
      {
        name: "🏆 Top Farmers",
        value: topFarmers || "Nenhum farm registrado.",
      },
      {
        name: "✅ Metas Batidas",
        value: metasBatidas || "Nenhuma ainda.",
      },
      {
        name: "❌ Metas Pendentes",
        value: metasPendentes || "Todos bateram a meta!",
      },
      {
        name: `🛒 Vendas — ${totalVendas.qtd} vendas | ${totalVendas.produtos} produtos | $${totalVendas.receita.toLocaleString()}`,
        value: topVendasText || "Nenhuma venda registrada.",
      },
      {
        name: `🎉 Bonus Pagos — $${totalBonus.toLocaleString()}`,
        value: bonusText || "Nenhum bonus pago.",
      },
      {
        name: `💵 Dinheiro Sujo — $${totalDinheiro.total.toLocaleString()} | ${totalDinheiro.entregas} entregas`,
        value: topDinheiro || "Nenhuma entrega registrada.",
      },
      {
        name: "✅ Metas Dinheiro Batidas",
        value: dinheiroMetasBatidas || "Nenhuma ainda.",
      },
      {
        name: "❌ Metas Dinheiro Pendentes",
        value: dinheiroMetasPendentes || "Todos bateram a meta!",
      },
      {
        name: `⚤️ Acoes (${acoesSemana.length}) — Caixa recebeu $${totalAcoesCaixa.toLocaleString()}`,
        value: acoesText || "Nenhuma acao registrada.",
      },
      {
        name: "👑 Pagamento Lideranca",
        value: `$${pagLideranca.total.toLocaleString()}`,
        inline: true,
      },
      {
        name: "💰 Saldo Caixa Atual",
        value: `$${caixa.saldo.toLocaleString()}`,
        inline: true,
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function comparativo(interaction: ChatInputCommandInteraction) {
  const semanaAtual = getSemanaAtual();
  const arquivos = db.prepare("SELECT semana FROM semanas_arquivadas ORDER BY arquivado_em DESC LIMIT 1").get() as { semana: string } | undefined;

  if (!arquivos) {
    await interaction.reply({ content: "Nenhuma semana anterior arquivada para comparar.", ephemeral: true });
    return;
  }

  const semanaAnterior = arquivos.semana;
  const dadosAnteriores = db.prepare("SELECT dados_json FROM semanas_arquivadas WHERE semana = ?").get(semanaAnterior) as { dados_json: string };
  const anterior = JSON.parse(dadosAnteriores.dados_json);

  // Farm
  const farmAtual = db.prepare("SELECT COALESCE(SUM(cobres), 0) as cobres FROM farm_entregas WHERE semana = ?").get(semanaAtual) as { cobres: number };
  const farmAnterior = anterior.farm_entregas.reduce((sum: number, e: any) => sum + e.cobres, 0);
  const farmDiff = farmAtual.cobres - farmAnterior;
  const farmPct = farmAnterior > 0 ? ((farmDiff / farmAnterior) * 100).toFixed(1) : "—";

  // Dinheiro
  const dinheiroAtual = db.prepare("SELECT COALESCE(SUM(valor), 0) as total FROM dinheiro_entregas WHERE semana = ?").get(semanaAtual) as { total: number };
  const dinheiroAnterior = anterior.dinheiro_entregas.reduce((sum: number, e: any) => sum + e.valor, 0);
  const dinheiroDiff = dinheiroAtual.total - dinheiroAnterior;
  const dinheiroPct = dinheiroAnterior > 0 ? ((dinheiroDiff / dinheiroAnterior) * 100).toFixed(1) : "—";

  // Vendas
  const vendasAtual = db.prepare("SELECT COALESCE(SUM(receita_total), 0) as receita FROM vendas WHERE criado_em >= date('now', 'weekday 0', '-6 days')").get() as { receita: number };
  const vendasAnterior = anterior.vendas.reduce((sum: number, v: any) => sum + v.receita_total, 0);
  const vendasDiff = vendasAtual.receita - vendasAnterior;
  const vendasPct = vendasAnterior > 0 ? ((vendasDiff / vendasAnterior) * 100).toFixed(1) : "—";

  // Acoes
  const acoesAtual = db.prepare("SELECT COALESCE(SUM(valor_caixa), 0) as total FROM acoes WHERE semana = ?").get(semanaAtual) as { total: number };
  const acoesAnterior = anterior.acoes.reduce((sum: number, a: any) => sum + a.valor_caixa, 0);
  const acoesDiff = acoesAtual.total - acoesAnterior;
  const acoesPct = acoesAnterior > 0 ? ((acoesDiff / acoesAnterior) * 100).toFixed(1) : "—";

  const embed = new EmbedBuilder()
    .setColor(farmDiff >= 0 && dinheiroDiff >= 0 ? 0x2ecc71 : 0xe67e22)
    .setTitle(`📈 Comparativo — ${semanaAnterior} vs ${semanaAtual}`)
    .addFields(
      {
        name: "🌾 Farm (cobres)",
        value: `**Anterior:** ${farmAnterior.toLocaleString()}\n**Atual:** ${farmAtual.cobres.toLocaleString()}\n**Diferenca:** ${farmDiff >= 0 ? "+" : ""}${farmDiff.toLocaleString()} (${farmPct !== "—" ? (farmDiff >= 0 ? "+" : "") + farmPct + "%" : farmPct})`,
      },
      {
        name: "💵 Dinheiro Sujo",
        value: `**Anterior:** $${dinheiroAnterior.toLocaleString()}\n**Atual:** $${dinheiroAtual.total.toLocaleString()}\n**Diferenca:** ${dinheiroDiff >= 0 ? "+" : ""}$${Math.abs(dinheiroDiff).toLocaleString()} (${dinheiroPct !== "—" ? (dinheiroDiff >= 0 ? "+" : "") + dinheiroPct + "%" : dinheiroPct})`,
      },
      {
        name: "🛒 Vendas (receita)",
        value: `**Anterior:** $${vendasAnterior.toLocaleString()}\n**Atual:** $${vendasAtual.receita.toLocaleString()}\n**Diferenca:** ${vendasDiff >= 0 ? "+" : ""}$${Math.abs(vendasDiff).toLocaleString()} (${vendasPct !== "—" ? (vendasDiff >= 0 ? "+" : "") + vendasPct + "%" : vendasPct})`,
      },
      {
        name: "⚔️ Acoes (caixa)",
        value: `**Anterior:** $${acoesAnterior.toLocaleString()}\n**Atual:** $${acoesAtual.total.toLocaleString()}\n**Diferenca:** ${acoesDiff >= 0 ? "+" : ""}$${Math.abs(acoesDiff).toLocaleString()} (${acoesPct !== "—" ? (acoesDiff >= 0 ? "+" : "") + acoesPct + "%" : acoesPct})`,
      },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function top(interaction: ChatInputCommandInteraction) {
  const semanaAtual = getSemanaAtual();
  const medalhas = ["🥇", "🥈", "🥉"];

  // Top Farm
  const topFarm = db.prepare(`
    SELECT m.nome, COALESCE(SUM(f.cobres), 0) as cobres
    FROM membros m
    JOIN farm_entregas f ON f.membro_id = m.id
    WHERE f.semana = ?
    GROUP BY m.id
    ORDER BY cobres DESC
    LIMIT 3
  `).all(semanaAtual) as Array<{ nome: string; cobres: number }>;

  let farmText = "";
  for (let i = 0; i < topFarm.length; i++) {
    farmText += `${medalhas[i]} **${topFarm[i].nome}** — ${topFarm[i].cobres} cobres\n`;
  }

  // Top Dinheiro
  const topDinheiro = db.prepare(`
    SELECT m.nome, COALESCE(SUM(d.valor), 0) as total
    FROM membros m
    JOIN dinheiro_entregas d ON d.membro_id = m.id
    WHERE d.semana = ?
    GROUP BY m.id
    ORDER BY total DESC
    LIMIT 3
  `).all(semanaAtual) as Array<{ nome: string; total: number }>;

  let dinheiroText = "";
  for (let i = 0; i < topDinheiro.length; i++) {
    dinheiroText += `${medalhas[i]} **${topDinheiro[i].nome}** — $${topDinheiro[i].total.toLocaleString()}\n`;
  }

  // Top Vendas
  const topVendas = db.prepare(`
    SELECT m.nome, COALESCE(SUM(v.quantidade_produtos), 0) as produtos
    FROM membros m
    JOIN vendas v ON v.vendedor_discord_id = m.discord_id
    WHERE v.criado_em >= date('now', 'weekday 0', '-6 days')
    GROUP BY m.discord_id
    ORDER BY produtos DESC
    LIMIT 3
  `).all() as Array<{ nome: string; produtos: number }>;

  let vendasText = "";
  for (let i = 0; i < topVendas.length; i++) {
    vendasText += `${medalhas[i]} **${topVendas[i].nome}** — ${topVendas[i].produtos} produtos\n`;
  }

  // Top Acoes
  const topAcoes = db.prepare(`
    SELECT m.nome, COUNT(*) as qtd
    FROM membros m
    JOIN acao_participantes ap ON ap.discord_id = m.discord_id
    WHERE ap.criado_em >= date('now', 'weekday 0', '-6 days')
    GROUP BY m.discord_id
    ORDER BY qtd DESC
    LIMIT 3
  `).all() as Array<{ nome: string; qtd: number }>;

  let acoesText = "";
  for (let i = 0; i < topAcoes.length; i++) {
    acoesText += `${medalhas[i]} **${topAcoes[i].nome}** — ${topAcoes[i].qtd} acoes\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle(`🏆 Top 3 — ${semanaAtual}`)
    .addFields(
      { name: "🌾 Farm", value: farmText || "Nenhum registro.", inline: true },
      { name: "💵 Dinheiro Sujo", value: dinheiroText || "Nenhum registro.", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "🛒 Vendas", value: vendasText || "Nenhum registro.", inline: true },
      { name: "⚔️ Acoes", value: acoesText || "Nenhum registro.", inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
