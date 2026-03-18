import {
  ActionRowBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import {
  getSemanaAtual,
  getDiaAtual,
  getMetaDinheiroDiaria,
  getCargoLabel,
  CARGOS_GERENCIA,
  BONUS_DINHEIRO_TIERS,
} from "../utils/semana";

const PERCENT_MEMBRO = 0.10;
const RANKING_POR_PAGINA = 5;
const META_CARGOS = ["iniciante", "membro", "farmer veterano", "gerente"];

export const data = new SlashCommandBuilder()
  .setName("dinheiro")
  .setDescription("Comandos de dinheiro sujo")
  .addSubcommand((sub) =>
    sub
      .setName("registrar")
      .setDescription("Registrar entrega de dinheiro sujo (gerencia+)")
      .addStringOption((opt) =>
        opt.setName("passaporte").setDescription("Nome do membro que entregou").setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((opt) =>
        opt.setName("valor").setDescription("Valor entregue em dinheiro sujo").setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("metas").setDescription("Ver progresso da meta diaria de dinheiro sujo"),
  )
  .addSubcommand((sub) =>
    sub.setName("ranking").setDescription("Ranking de dinheiro sujo da semana"),
  )
  .addSubcommand((sub) =>
    sub.setName("ganhos").setDescription("Ver seus ganhos de dinheiro sujo da semana"),
  );

export async function autocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused().toLowerCase();
  const membros = db
    .prepare("SELECT nome, passaporte FROM membros WHERE ativo = 1 ORDER BY nome")
    .all() as Array<{ nome: string; passaporte: string }>;
  const filtered = membros
    .filter((m) => m.nome.toLowerCase().includes(focused))
    .slice(0, 25)
    .map((m) => ({ name: `${m.nome} [${m.passaporte}]`, value: String(m.passaporte) }));
  await interaction.respond(filtered);
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "registrar") await registrar(interaction);
  else if (sub === "metas") await metas(interaction);
  else if (sub === "ranking") await ranking(interaction);
  else if (sub === "ganhos") await ganhos(interaction);
}

async function registrar(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const registrador = db
    .prepare("SELECT cargo FROM membros WHERE discord_id = ?")
    .get(discordId) as { cargo: string } | undefined;

  if (!registrador || !CARGOS_GERENCIA.includes(registrador.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Lider**, **Sublider** e **Gerente** podem registrar dinheiro sujo.", ephemeral: true });
    return;
  }

  const passaporte = interaction.options.getString("passaporte", true);
  const valor = interaction.options.getInteger("valor", true);
  const semana = getSemanaAtual();
  const dia = getDiaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE passaporte = ? AND ativo = 1")
    .get(passaporte) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `Nenhum membro encontrado com o passaporte **${passaporte}**.`, ephemeral: true });
    return;
  }

  const valorPago = Math.round(valor * PERCENT_MEMBRO);

  db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO dinheiro_entregas (membro_id, valor, semana) VALUES (?, ?, ?)",
    ).run(membro.id, valor, semana);

    db.prepare(
      "INSERT INTO dinheiro_pagamentos (membro_id, entrega_id, valor_pago) VALUES (?, ?, ?)",
    ).run(membro.id, result.lastInsertRowid, valorPago);
  })();

  // Bonus semanal
  const totalSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM dinheiro_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusJaRecebidos = db
    .prepare("SELECT valor FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'dinheiro_produtividade'")
    .all(membro.id, semana) as Array<{ valor: number }>;
  const valoresJaRecebidos = new Set(bonusJaRecebidos.map((b) => b.valor));

  let bonusNovo = "";
  for (const tier of BONUS_DINHEIRO_TIERS) {
    if (totalSemana.total >= tier.valor && !valoresJaRecebidos.has(tier.bonus)) {
      db.prepare("INSERT INTO bonus_log (membro_id, tipo, valor, descricao, semana) VALUES (?, ?, ?, ?, ?)").run(
        membro.id, "dinheiro_produtividade", tier.bonus, tier.label, semana,
      );
      bonusNovo += `🎉 **BONUS DESBLOQUEADO:** ${tier.label}\n`;
    }
  }

  // Progresso diario
  const totalDia = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM dinheiro_entregas WHERE membro_id = ? AND DATE(criado_em) = ?")
    .get(membro.id, dia) as { total: number };

  const meta = META_CARGOS.includes(membro.cargo.toLowerCase()) ? getMetaDinheiroDiaria() : 0;
  const progresso = meta > 0 ? Math.min(100, Math.round((totalDia.total / meta) * 100)) : 100;
  const barra = gerarBarra(progresso);

  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM dinheiro_pagamentos dp JOIN dinheiro_entregas de ON dp.entrega_id = de.id WHERE dp.membro_id = ? AND de.semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle("Dinheiro Sujo Registrado!")
    .setDescription(bonusNovo || null)
    .addFields(
      { name: "Membro", value: membro.nome, inline: true },
      { name: "Registrado por", value: `<@${discordId}>`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Valor entregue", value: `$${valor.toLocaleString()}`, inline: true },
      { name: "Pagamento (10%)", value: `$${valorPago.toLocaleString()}`, inline: true },
      { name: "Ganhos da semana", value: `$${ganhosSemana.total.toLocaleString()}`, inline: true },
      { name: `Meta diaria ($${meta.toLocaleString()})`, value: `${barra} ${progresso}% — $${totalDia.total.toLocaleString()}/$${meta.toLocaleString()}` },
    )
    .setFooter({ text: `${membro.nome} | ${getCargoLabel(membro.cargo)}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function metas(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;
  const semana = getSemanaAtual();
  const dia = getDiaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: "Voce nao esta cadastrado. Peca a um admin para te cadastrar.", ephemeral: true });
    return;
  }

  const totalDia = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as entregas FROM dinheiro_entregas WHERE membro_id = ? AND DATE(criado_em) = ?")
    .get(membro.id, dia) as { total: number; entregas: number };

  const meta = META_CARGOS.includes(membro.cargo.toLowerCase()) ? getMetaDinheiroDiaria() : 0;
  const progresso = meta > 0 ? Math.min(100, Math.round((totalDia.total / meta) * 100)) : 100;
  const barra = gerarBarra(progresso);
  const falta = Math.max(0, meta - totalDia.total);

  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM dinheiro_pagamentos dp JOIN dinheiro_entregas de ON dp.entrega_id = de.id WHERE dp.membro_id = ? AND de.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'dinheiro_produtividade'")
    .get(membro.id, semana) as { total: number };

  const totalSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM dinheiro_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(progresso >= 100 ? 0x8e44ad : 0xffa500)
    .setTitle(`Meta Diaria Dinheiro Sujo — ${membro.nome}`)
    .addFields(
      { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
      { name: "Entregas hoje", value: `${totalDia.entregas}`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Valor hoje", value: `$${totalDia.total.toLocaleString()} / $${meta.toLocaleString()}`, inline: true },
      { name: "Falta", value: falta > 0 ? `$${falta.toLocaleString()}` : "Meta batida! ✅", inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Progresso diario", value: `${barra} ${progresso}%` },
      { name: "Total na semana", value: `$${totalSemana.total.toLocaleString()}`, inline: true },
      { name: "Ganhos (10%)", value: `$${ganhosSemana.total.toLocaleString()}`, inline: true },
      { name: "Bonus", value: `$${bonusSemana.total.toLocaleString()}`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function ranking(interaction: ChatInputCommandInteraction) {
  const semana = getSemanaAtual();

  const rows = db
    .prepare(
      `SELECT m.nome, m.cargo, m.id as membro_id,
        COALESCE(SUM(d.valor), 0) as total_valor,
        COUNT(d.id) as entregas
      FROM membros m
      LEFT JOIN dinheiro_entregas d ON d.membro_id = m.id AND d.semana = ?
      WHERE m.ativo = 1
      GROUP BY m.id
      ORDER BY total_valor DESC`,
    )
    .all(semana) as Array<{ nome: string; cargo: string; membro_id: number; total_valor: number; entregas: number }>;

  if (rows.length === 0) {
    await interaction.reply({ content: "Nenhum membro cadastrado ainda.", ephemeral: true });
    return;
  }

  const totalPaginas = Math.ceil(rows.length / RANKING_POR_PAGINA);
  let pagina = 0;

  const buildEmbed = (pag: number) => {
    const medalhas = ["🥇", "🥈", "🥉"];
    const inicio = pag * RANKING_POR_PAGINA;
    const slice = rows.slice(inicio, inicio + RANKING_POR_PAGINA);
    let texto = "";

    for (let i = 0; i < slice.length; i++) {
      const row = slice[i];
      const index = inicio + i;
      const medal = medalhas[index] ?? `**${index + 1}.**`;
      const meta = META_CARGOS.includes(row.cargo.toLowerCase()) ? getMetaDinheiroDiaria() : 0;
      const totalDia = db
        .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM dinheiro_entregas WHERE membro_id = ? AND DATE(criado_em) = date('now')")
        .get(row.membro_id) as { total: number };
      const status = meta > 0 && totalDia.total >= meta ? " ✅" : "";
      const ganhos = db
        .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM dinheiro_pagamentos dp JOIN dinheiro_entregas de ON dp.entrega_id = de.id WHERE dp.membro_id = ? AND de.semana = ?")
        .get(row.membro_id, semana) as { total: number };
      texto += `${medal} **${row.nome}** (${getCargoLabel(row.cargo)}) — $${row.total_valor.toLocaleString()} | ganhos: $${ganhos.total.toLocaleString()}${status}\n`;
    }

    return new EmbedBuilder()
      .setColor(0x8e44ad)
      .setTitle(`Ranking Dinheiro Sujo — Semana ${semana}`)
      .setDescription(texto)
      .setFooter({ text: `Pagina ${pag + 1} de ${totalPaginas}` })
      .setTimestamp();
  };

  const buildRow = (pag: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("dinheiro_anterior")
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pag === 0),
      new ButtonBuilder()
        .setCustomId("dinheiro_proximo")
        .setLabel("Próximo ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pag >= totalPaginas - 1),
    );

  const reply = await interaction.reply({
    embeds: [buildEmbed(pagina)],
    components: totalPaginas > 1 ? [buildRow(pagina)] : [],
    fetchReply: true,
  });

  if (totalPaginas <= 1) return;

  const collector = reply.createMessageComponentCollector({ time: 60000 });

  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) {
      await btn.reply({ content: "Apenas quem usou o comando pode navegar.", ephemeral: true });
      return;
    }
    if (btn.customId === "dinheiro_anterior") pagina = Math.max(0, pagina - 1);
    else pagina = Math.min(totalPaginas - 1, pagina + 1);
    await btn.update({ embeds: [buildEmbed(pagina)], components: [buildRow(pagina)] });
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] });
  });
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

  const totalEntregue = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total, COUNT(*) as entregas FROM dinheiro_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number; entregas: number };

  const ganhosDinheiro = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM dinheiro_pagamentos dp JOIN dinheiro_entregas de ON dp.entrega_id = de.id WHERE dp.membro_id = ? AND de.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusDinheiro = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'dinheiro_produtividade'")
    .get(membro.id, semana) as { total: number };

  const totalGeral = ganhosDinheiro.total + bonusDinheiro.total;

  const embed = new EmbedBuilder()
    .setColor(0x8e44ad)
    .setTitle(`Ganhos Dinheiro Sujo — ${membro.nome}`)
    .addFields(
      { name: "💵 Total entregue", value: `$${totalEntregue.total.toLocaleString()} (${totalEntregue.entregas} entregas)`, inline: true },
      { name: "💰 Ganhos (10%)", value: `$${ganhosDinheiro.total.toLocaleString()}`, inline: true },
      { name: "🎉 Bonus", value: `$${bonusDinheiro.total.toLocaleString()}`, inline: true },
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
  return "🟪".repeat(preenchido) + "⬜".repeat(total - preenchido);
}
