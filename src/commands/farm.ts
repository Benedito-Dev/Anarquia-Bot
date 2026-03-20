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
import { getSemanaAtual, getDiaAtual, getMetaDiaria, getCargoLabel, CARGOS_GERENCIA } from "../utils/semana";
import { membroTemFolga } from "./membro";

const PRECO_SEM_PARCERIA = 8300;
const PRECO_COM_PARCERIA = 6500;
const PRECO_BASE_FARMER = Math.round((PRECO_SEM_PARCERIA + PRECO_COM_PARCERIA) / 2); // Media: 7.400
const PERCENT_FARMER = 0.25;
const COBRES_POR_PRODUTO = 6;
const ALUMINIOS_POR_PRODUTO = 6;

const MATERIAIS_FARM = ["cobres", "aluminios", "lona", "plastico", "algodao", "couro", "chapa_metal", "lixo_eletronico"] as const;

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
      .addStringOption((opt) =>
        opt.setName("passaporte").setDescription("Nome do membro que entregou").setRequired(true).setAutocomplete(true),
      )
      .addIntegerOption((opt) => opt.setName("cobres").setDescription("Quantidade de cobres").setRequired(true).setMinValue(1))
      .addIntegerOption((opt) => opt.setName("aluminios").setDescription("Quantidade de aluminios").setRequired(true).setMinValue(1))
      .addIntegerOption((opt) => opt.setName("lona").setDescription("Quantidade de lona").setMinValue(1))
      .addIntegerOption((opt) => opt.setName("plastico").setDescription("Quantidade de plastico").setMinValue(1))
      .addIntegerOption((opt) => opt.setName("algodao").setDescription("Quantidade de algodao").setMinValue(1))
      .addIntegerOption((opt) => opt.setName("couro").setDescription("Quantidade de couro").setMinValue(1))
      .addIntegerOption((opt) => opt.setName("chapa_metal").setDescription("Quantidade de chapa de metal").setMinValue(1))
      .addIntegerOption((opt) => opt.setName("lixo_eletronico").setDescription("Quantidade de lixo eletronico").setMinValue(1)),
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
  const nomeMembro = interaction.options.getString("passaporte", true);
  const discordId = interaction.user.id;
  const semana = getSemanaAtual();
  const dia = getDiaAtual();

  const registrador = db
    .prepare("SELECT cargo FROM membros WHERE discord_id = ?")
    .get(discordId) as { cargo: string } | undefined;

  if (!registrador || !CARGOS_GERENCIA.includes(registrador.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Lider**, **Sublider** e **Gerente** podem registrar farm.", ephemeral: true });
    return;
  }

  const membro = db
    .prepare("SELECT * FROM membros WHERE passaporte = ? AND ativo = 1")
    .get(nomeMembro) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro) {
    await interaction.reply({ content: `Nenhum membro encontrado com o passaporte **${nomeMembro}**.`, ephemeral: true });
    return;
  }

  const cobres = interaction.options.getInteger("cobres") ?? 0;
  const aluminios = interaction.options.getInteger("aluminios") ?? 0;
  const lona = interaction.options.getInteger("lona") ?? 0;
  const plastico = interaction.options.getInteger("plastico") ?? 0;
  const algodao = interaction.options.getInteger("algodao") ?? 0;
  const couro = interaction.options.getInteger("couro") ?? 0;
  const chapasMetal = interaction.options.getInteger("chapa_metal") ?? 0;
  const lixoEletronico = interaction.options.getInteger("lixo_eletronico") ?? 0;

  if (cobres === 0 && aluminios === 0 && lona === 0 && plastico === 0 && algodao === 0 && couro === 0 && chapasMetal === 0 && lixoEletronico === 0) {
    await interaction.reply({ content: "Informe ao menos um material.", ephemeral: true });
    return;
  }

  // Calcular pagamento baseado em C4 (cobre + aluminio)
  const produtosEquivalentes = Math.min(Math.floor(cobres / COBRES_POR_PRODUTO), Math.floor(aluminios / ALUMINIOS_POR_PRODUTO));
  const receitaBase = produtosEquivalentes * PRECO_BASE_FARMER;
  const pagamentoFarmer = Math.round(receitaBase * PERCENT_FARMER);

  const materaisEntregues: Array<[string, number]> = [
    ["cobres", cobres], ["aluminios", aluminios], ["lona", lona],
    ["plastico", plastico], ["algodao", algodao], ["couro", couro],
    ["chapa de metal", chapasMetal], ["lixo eletronico", lixoEletronico],
  ].filter(([, qtd]) => (qtd as number) > 0) as Array<[string, number]>;

  db.transaction(() => {
    const result = db.prepare(
      "INSERT INTO farm_entregas (membro_id, cobres, aluminios, semana) VALUES (?, ?, ?, ?)",
    ).run(membro.id, cobres, aluminios, semana);

    for (const [mat, qtd] of materaisEntregues) {
      db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = ?").run(qtd, mat);
      db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(mat, qtd, "entrada", `Farm de ${membro.nome}`, discordId);
    }

    if (produtosEquivalentes > 0) {
      db.prepare(
        "INSERT INTO farmer_pagamentos (membro_id, farm_entrega_id, produtos_equivalentes, valor_pago) VALUES (?, ?, ?, ?)",
      ).run(membro.id, result.lastInsertRowid, produtosEquivalentes, pagamentoFarmer);
    }
  })();

  const totalDia = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as total_cobres, COALESCE(SUM(aluminios), 0) as total_aluminios FROM farm_entregas WHERE membro_id = ? AND DATE(criado_em) = ?")
    .get(membro.id, dia) as { total_cobres: number; total_aluminios: number };

  const totalSemana = db
    .prepare("SELECT COALESCE(SUM(cobres), 0) as total_cobres FROM farm_entregas WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total_cobres: number };

  const bonusJaRecebidos = db
    .prepare("SELECT valor FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'farm_produtividade'")
    .all(membro.id, semana) as Array<{ valor: number }>;
  const valoresJaRecebidos = new Set(bonusJaRecebidos.map((b) => b.valor));

  let bonusNovo = "";
  for (const tier of BONUS_TIERS) {
    if (totalSemana.total_cobres >= tier.cobres && !valoresJaRecebidos.has(tier.bonus)) {
      db.prepare("INSERT INTO bonus_log (membro_id, tipo, valor, descricao, semana) VALUES (?, ?, ?, ?, ?)").run(membro.id, "farm_produtividade", tier.bonus, tier.label, semana);
      bonusNovo += `🎉 **BONUS DESBLOQUEADO:** ${tier.label}\n`;
    }
  }

  const meta = getMetaDiaria(membro.cargo);
  const progresso = meta > 0 ? Math.min(100, Math.round((totalDia.total_cobres / meta) * 100)) : 100;
  const barraProgresso = gerarBarra(progresso);

  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const entregaTexto = materaisEntregues.map(([mat, qtd]) => `${qtd} ${mat}`).join(" | ");

  const embed = new EmbedBuilder()
    .setColor(0x00ae86)
    .setTitle("Farm Registrado!")
    .setDescription(bonusNovo || null)
    .addFields(
      { name: "Farmer", value: membro.nome, inline: true },
      { name: "Registrado por", value: `<@${discordId}>`, inline: true },
      { name: "\u200b", value: "\u200b", inline: true },
      { name: "Materiais entregues", value: entregaTexto },
      { name: "Pagamento (base C4, 25%)", value: `$${pagamentoFarmer.toLocaleString()}`, inline: true },
      { name: "Ganhos da semana", value: `$${ganhosSemana.total.toLocaleString()}`, inline: true },
      { name: `Meta diaria (${meta} cobres)`, value: `${barraProgresso} ${progresso}% — ${totalDia.total_cobres}/${meta}` },
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
    await interaction.reply({
      content: "Voce nao esta cadastrado. Peca a um admin para te cadastrar.",
      ephemeral: true,
    });
    return;
  }

  if (membroTemFolga(membro.id, dia)) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x3498db)
          .setTitle(`🏖️ Dia de Folga — ${membro.nome}`)
          .setDescription("Voce esta de folga hoje! Nenhuma meta e exigida.\nBom descanso! 😄")
          .setTimestamp(),
      ],
    });
    return;
  }

  const totalDia = db
    .prepare(
      "SELECT COALESCE(SUM(cobres), 0) as total_cobres, COALESCE(SUM(aluminios), 0) as total_aluminios, COUNT(*) as entregas FROM farm_entregas WHERE membro_id = ? AND DATE(criado_em) = ?",
    )
    .get(membro.id, dia) as { total_cobres: number; total_aluminios: number; entregas: number };

  const meta = getMetaDiaria(membro.cargo);
  const progresso = meta > 0 ? Math.min(100, Math.round((totalDia.total_cobres / meta) * 100)) : 100;
  const barraProgresso = gerarBarra(progresso);
  const falta = Math.max(0, meta - totalDia.total_cobres);
  const lotes = Math.floor(totalDia.total_cobres / 150);

  const ganhosSemana = db
    .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
    .get(membro.id, semana) as { total: number };

  const bonusSemana = db
    .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM bonus_log WHERE membro_id = ? AND semana = ?")
    .get(membro.id, semana) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(progresso >= 100 ? 0x00ae86 : 0xffa500)
    .setTitle(`Meta Diária — ${membro.nome}`)
    .addFields(
      { name: "Cargo", value: getCargoLabel(membro.cargo), inline: true },
      { name: "Entregas hoje", value: `${totalDia.entregas}`, inline: true },
      { name: "Lotes hoje", value: `${lotes}`, inline: true },
      { name: "Cobres hoje", value: `${totalDia.total_cobres} / ${meta}`, inline: true },
      { name: "Aluminios hoje", value: `${totalDia.total_aluminios}`, inline: true },
      { name: "Falta", value: falta > 0 ? `${falta} cobres` : "Meta batida! ✅", inline: true },
      { name: "Progresso diário", value: `${barraProgresso} ${progresso}%` },
      { name: "Ganhos farm", value: `$${ganhosSemana.total.toLocaleString()}`, inline: true },
      { name: "Bonus", value: `$${bonusSemana.total.toLocaleString()}`, inline: true },
      { name: "Total semana", value: `$${(ganhosSemana.total + bonusSemana.total).toLocaleString()}`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

const RANKING_POR_PAGINA = 5;

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
      ORDER BY total_cobres DESC`,
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

  const totalPaginas = Math.ceil(rows.length / RANKING_POR_PAGINA);
  let pagina = 0;

  const buildRankingEmbed = (pag: number) => {
    const medalhas = ["🥇", "🥈", "🥉"];
    const inicio = pag * RANKING_POR_PAGINA;
    const slice = rows.slice(inicio, inicio + RANKING_POR_PAGINA);
    let rankingText = "";

    for (let i = 0; i < slice.length; i++) {
      const row = slice[i];
      const index = inicio + i;
      const medal = medalhas[index] ?? `**${index + 1}.**`;
      const meta = getMetaDiaria(row.cargo);
      const cobresDia = db
        .prepare("SELECT COALESCE(SUM(cobres), 0) as total FROM farm_entregas WHERE membro_id = ? AND DATE(criado_em) = date('now')")
        .get(row.membro_id) as { total: number };
      const status = meta > 0 && cobresDia.total >= meta ? " ✅" : "";
      const ganhos = db
        .prepare("SELECT COALESCE(SUM(valor_pago), 0) as total FROM farmer_pagamentos fp JOIN farm_entregas fe ON fp.farm_entrega_id = fe.id WHERE fp.membro_id = ? AND fe.semana = ?")
        .get(row.membro_id, semana) as { total: number };
      rankingText += `${medal} **${row.nome}** (${getCargoLabel(row.cargo)}) — ${row.total_cobres} cobres | $${ganhos.total.toLocaleString()}${status}\n`;
    }

    return new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle(`Ranking de Farm — Semana ${semana}`)
      .setDescription(rankingText)
      .setFooter({ text: `Pagina ${pag + 1} de ${totalPaginas}` })
      .setTimestamp();
  };

  const buildRow = (pag: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId("ranking_anterior")
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pag === 0),
      new ButtonBuilder()
        .setCustomId("ranking_proximo")
        .setLabel("Próximo ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pag >= totalPaginas - 1),
    );

  const reply = await interaction.reply({
    embeds: [buildRankingEmbed(pagina)],
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
    if (btn.customId === "ranking_anterior") pagina = Math.max(0, pagina - 1);
    else pagina = Math.min(totalPaginas - 1, pagina + 1);
    await btn.update({ embeds: [buildRankingEmbed(pagina)], components: [buildRow(pagina)] });
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
      { name: "💰 Farm (5%)", value: `$${ganhosFarm.total.toLocaleString()}`, inline: true },
      { name: "🎉 Bonus farm", value: `$${bonusFarm.total.toLocaleString()}`, inline: true },
      { name: "🛒 Vendas (50%)", value: `$${ganhoVendas.total.toLocaleString()} (${ganhoVendas.vendas} vendas)`, inline: true },
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
