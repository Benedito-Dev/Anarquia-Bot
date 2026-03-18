import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { getSemanaAtual, getMetaSemanal, getDiaAtual, getCargoLabel, CARGOS_ADMIN, getMetaDinheiroDiaria } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("relatorio")
  .setDescription("Relatorios da organizacao (admin)")
  .addSubcommand((sub) =>
    sub.setName("semana").setDescription("Relatorio completo da semana atual (admin)"),
  )
  .addSubcommand((sub) =>
    sub.setName("dia").setDescription("Relatorio completo do dia atual (admin)"),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode ver o relatorio.", ephemeral: true });
    return;
  }

  if (interaction.options.getSubcommand() === "dia") {
    await dia(interaction);
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
