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
  getMetaSemanal,
  getCargoLabel,
  temMeta,
  calcularBonusFds,
  BONUS_FDS_TIERS,
  PERCENT_FARMER,
  CARGOS_GERENCIA,
} from "../utils/semana";
import { membroTemFolga } from "./membro";

const MUNICOES_POR_PRODUCAO = 170;
const RANKING_POR_PAGINA = 5;

export const data = new SlashCommandBuilder()
  .setName("farm")
  .setDescription("Comandos de farm")
  .addSubcommand((sub) =>
    sub
      .setName("registrar")
      .setDescription("Registrar entrega de materiais (gerencia+)")
      .addStringOption((opt) =>
        opt.setName("passaporte").setDescription("Passaporte do membro").setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((opt) =>
        opt.setName("polvora").setDescription("Quantidade de polvora").setRequired(true).setMinValue(1),
      )
      .addIntegerOption((opt) =>
        opt.setName("capsula").setDescription("Quantidade de capsula").setRequired(true).setMinValue(1),
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
  )
  .addSubcommand((sub) =>
    sub
      .setName("bonus_fds")
      .setDescription("Registrar bonus de fim de semana (gerencia+)")
      .addStringOption((opt) =>
        opt.setName("passaporte").setDescription("Passaporte do membro").setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((opt) =>
        opt.setName("polvora").setDescription("Quantidade de polvora entregue no FDS").setRequired(true).setMinValue(1),
      ),
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
  else if (sub === "bonus_fds") await bonusFds(interaction);
}

async function registrar(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const registrador = db
    .prepare("SELECT cargo FROM membros WHERE discord_id = ?")
    .get(discordId) as { cargo: string } | undefined;

  if (!registrador || !CARGOS_GERENCIA.includes(registrador.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente ou superior** pode registrar farm.", ephemeral: true });
    return;
  }

  const passaporte = interaction.options.getString("passaporte", true);
  const polvora = interaction.options.getInteger("polvora", true);
  const capsula = interaction.options.getInteger("capsula", true);
  const semana = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE passaporte = ? AND ativo = 1")
    .get(passaporte) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `Nenhum membro com passaporte **${passaporte}**.`, ephemeral: true });
    return;
  }

  // Calcular pagamento: baseado no menor entre polvora/capsula (limitante de producao)
  // Cada producao consome ~170-225 de cada material e gera 170 municoes
  // Pagamento = producoes possiveis * preco_medio * PERCENT_FARMER
  const precoMedioMunicao = 1000; // valor medio entre os tipos
  const producoesEquivalentes = Math.floor(Math.min(polvora, capsula) / 175); // media dos custos
  const valorPago = Math.round(producoesEquivalentes * MUNICOES_POR_PRODUCAO * precoMedioMunicao * PERCENT_FARMER);

  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };
  if (valorPago > 0 && caixa.saldo < valorPago) {
    await interaction.reply({ content: `Saldo insuficiente no caixa. Tem $${caixa.saldo.toLocaleString()}, necessario $${valorPago.toLocaleString()}.`, ephemeral: true });
    return;
  }

  db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO farm_entregas (membro_id, polvora, capsula, semana) VALUES (?, ?, ?, ?)",
    ).run(membro.id, polvora, capsula, semana);

    db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = 'polvora'").run(polvora);
    db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = 'capsula'").run(capsula);
    db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run("polvora", polvora, "entrada", `Farm de ${membro.nome}`, discordId);
    db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run("capsula", capsula, "entrada", `Farm de ${membro.nome}`, discordId);

    if (valorPago > 0) {
      db.prepare("INSERT INTO farmer_pagamentos (membro_id, farm_entrega_id, valor_pago) VALUES (?, ?, ?)").run(membro.id, result.lastInsertRowid, valorPago);
      db.prepare("UPDATE caixa SET saldo = saldo - ?").run(valorPago);
      db.prepare("INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)").run("pagamento_farmer", -valorPago, `Pagamento farm — ${membro.nome}`, discordId);
    }
  })();

  const totalSemana = db
    .prepare("SELECT COALESCE(SUM(polvora), 0) as polvora, COALESCE(SUM(capsula), 0) as capsula FROM farm_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { polvora: number; capsula: number };

  const meta = getMetaSemanal(membro.cargo);
  const progressoPolvora = meta.polvora > 0 ? Math.min(100, Math.round((totalSemana.polvora / meta.polvora) * 100)) : 100;
  const barra = gerarBarra(progressoPolvora);

  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle("Farm Registrado!")
    .addFields(
      { name: "Farmer", value: membro.nome, inline: true },
      { name: "Registrado por", value: `<@${discordId}>`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Polvora", value: `${polvora}`, inline: true },
      { name: "Capsula", value: `${capsula}`, inline: true },
      { name: "Pagamento (25%)", value: valorPago > 0 ? `$${valorPago.toLocaleString()}` : "Sem pagamento", inline: true },
      { name: `Meta semanal (${meta.polvora} polvora)`, value: `${barra} ${progressoPolvora}% — ${totalSemana.polvora}/${meta.polvora}` },
      { name: "Ganhos da semana", value: `$${ganhosSemana.total.toLocaleString()}`, inline: true },
    )
    .setFooter({ text: `${membro.nome} | ${getCargoLabel(membro.cargo)}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function bonusFds(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const registrador = db
    .prepare("SELECT cargo FROM membros WHERE discord_id = ?")
    .get(discordId) as { cargo: string } | undefined;

  if (!registrador || !CARGOS_GERENCIA.includes(registrador.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente ou superior** pode registrar bonus FDS.", ephemeral: true });
    return;
  }

  const passaporte = interaction.options.getString("passaporte", true);
  const polvora = interaction.options.getInteger("polvora", true);
  const semana = getSemanaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE passaporte = ? AND ativo = 1")
    .get(passaporte) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `Nenhum membro com passaporte **${passaporte}**.`, ephemeral: true });
    return;
  }

  const bonusJaRecebido = db
    .prepare("SELECT id FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'farm_fds'")
    .get(membro.id, semana);

  if (bonusJaRecebido) {
    await interaction.reply({ content: `**${membro.nome}** ja recebeu bonus FDS essa semana.`, ephemeral: true });
    return;
  }

  const valorBonus = calcularBonusFds(polvora);
  if (valorBonus === 0) {
    await interaction.reply({ content: `Quantidade insuficiente para bonus FDS. Minimo: ${BONUS_FDS_TIERS[BONUS_FDS_TIERS.length - 1].minPolvora} polvora.`, ephemeral: true });
    return;
  }

  const tier = BONUS_FDS_TIERS.find((t) => polvora >= t.minPolvora)!;

  const caixa = db.prepare("SELECT saldo FROM caixa LIMIT 1").get() as { saldo: number };
  if (caixa.saldo < valorBonus) {
    await interaction.reply({ content: `Saldo insuficiente no caixa para pagar o bonus.`, ephemeral: true });
    return;
  }

  db.transaction(() => {
    db.prepare("INSERT INTO bonus_log (membro_id, tipo, valor, descricao, semana) VALUES (?, ?, ?, ?, ?)").run(membro.id, "farm_fds", valorBonus, tier.label, semana);
    db.prepare("UPDATE caixa SET saldo = saldo - ?").run(valorBonus);
    db.prepare("INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)").run("bonus_fds", -valorBonus, `Bonus FDS — ${membro.nome} (${polvora} polvora)`, discordId);
  })();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle("🎉 Bonus FDS Registrado!")
        .addFields(
          { name: "Membro", value: membro.nome, inline: true },
          { name: "Polvora entregue", value: `${polvora}`, inline: true },
          { name: "Bonus", value: `$${valorBonus.toLocaleString()}`, inline: true },
          { name: "Tier", value: tier.label },
        )
        .setFooter({ text: `Registrado por ${interaction.user.displayName}` })
        .setTimestamp(),
    ],
  });
}

async function metas(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;
  const semana = getSemanaAtual();
  const dia = getDiaAtual();

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: "Voce nao esta cadastrado.", ephemeral: true });
    return;
  }

  if (membroTemFolga(membro.id, dia)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`🏖️ Dia de Folga — ${membro.nome}`)
          .setDescription("Voce esta de folga hoje! Nenhuma meta e exigida.")
          .setTimestamp(),
      ],
    });
    return;
  }

  const totalSemana = db
    .prepare("SELECT COALESCE(SUM(polvora), 0) as polvora, COALESCE(SUM(capsula), 0) as capsula, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { polvora: number; capsula: number; entregas: number };

  const meta = getMetaSemanal(membro.cargo);
  const progressoPolvora = meta.polvora > 0 ? Math.min(100, Math.round((totalSemana.polvora / meta.polvora) * 100)) : 100;
  const progressoCapsula = meta.capsula > 0 ? Math.min(100, Math.round((totalSemana.capsula / meta.capsula) * 100)) : 100;

  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(progressoPolvora >= 100 && progressoCapsula >= 100 ? 0x00ae86 : 0xffa500)
    .setTitle(`Meta Semanal — ${membro.nome}`)
    .addFields(
      { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
      { name: "Entregas", value: `${totalSemana.entregas}`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Polvora", value: `${gerarBarra(progressoPolvora)} ${progressoPolvora}%\n${totalSemana.polvora}/${meta.polvora}` },
      { name: "Capsula", value: `${gerarBarra(progressoCapsula)} ${progressoCapsula}%\n${totalSemana.capsula}/${meta.capsula}` },
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
        COALESCE(SUM(f.polvora), 0) as total_polvora,
        COALESCE(SUM(f.capsula), 0) as total_capsula,
        COUNT(f.id) as entregas
      FROM membros m
      LEFT JOIN farm_entregas f ON f.membro_id = m.id AND f.semana = ?
      WHERE m.ativo = 1
      GROUP BY m.id
      ORDER BY total_polvora DESC`,
    )
    .all(semana) as Array<{ nome: string; cargo: string; membro_id: number; total_polvora: number; total_capsula: number; entregas: number }>;

  if (rows.length === 0) {
    await interaction.reply({ content: "Nenhum membro cadastrado.", ephemeral: true });
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
      const meta = getMetaSemanal(row.cargo);
      const status = temMeta(row.cargo) && row.total_polvora >= meta.polvora && row.total_capsula >= meta.capsula ? " ✅" : "";
      texto += `${medal} **${row.nome}** (${getCargoLabel(row.cargo)}) — ${row.total_polvora} polvora | ${row.total_capsula} capsula${status}\n`;
    }

    return new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`Ranking de Farm — Semana ${semana}`)
      .setDescription(texto)
      .setFooter({ text: `Pagina ${pag + 1} de ${totalPaginas}` })
      .setTimestamp();
  };

  const buildRow = (pag: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("farm_anterior").setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(pag === 0),
      new ButtonBuilder().setCustomId("farm_proximo").setLabel("Próximo ▶").setStyle(ButtonStyle.Secondary).setDisabled(pag >= totalPaginas - 1),
    );

  const reply = await interaction.reply({ embeds: [buildEmbed(pagina)], components: totalPaginas > 1 ? [buildRow(pagina)] : [], fetchReply: true });
  if (totalPaginas <= 1) return;

  const collector = reply.createMessageComponentCollector({ time: 60000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) { await btn.reply({ content: "Apenas quem usou o comando pode navegar.", ephemeral: true }); return; }
    if (btn.customId === "farm_anterior") pagina = Math.max(0, pagina - 1);
    else pagina = Math.min(totalPaginas - 1, pagina + 1);
    await btn.update({ embeds: [buildEmbed(pagina)], components: [buildRow(pagina)] });
  });
  collector.on("end", async () => { await interaction.editReply({ components: [] }); });
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
    .prepare("SELECT COALESCE(SUM(polvora), 0) as polvora, COALESCE(SUM(capsula), 0) as capsula, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { polvora: number; capsula: number; entregas: number };

  const ganhosFarm = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle(`Ganhos da Semana — ${membro.nome}`)
    .addFields(
      { name: "🌾 Entregas", value: `${totalEntregue.entregas}x | ${totalEntregue.polvora} polvora | ${totalEntregue.capsula} capsula`, inline: false },
      { name: "💰 Ganhos farm (25%)", value: `$${ganhosFarm.total.toLocaleString()}`, inline: true },
      { name: "🎉 Bonus", value: `$${bonusSemana.total.toLocaleString()}`, inline: true },
      { name: "═══════════", value: "\u200b" },
      { name: "📊 TOTAL SEMANA", value: `**$${(ganhosFarm.total + bonusSemana.total).toLocaleString()}**`, inline: true },
    )
    .setFooter({ text: getCargoLabel(membro.cargo) })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

function gerarBarra(porcentagem: number): string {
  const total = 10;
  const preenchido = Math.round((porcentagem / 100) * total);
  return "🟩".repeat(preenchido) + "⬜".repeat(total - preenchido);
}
