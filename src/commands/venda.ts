import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_ADMIN, CARGOS_GERENCIA, getSemanaAtual, PERCENT_VENDEDOR, PERCENT_CAIXA_VENDA, registrarAuditoria } from "../utils/semana";

const CHOICES_MUNICOES = [
  { name: "Rifle", value: "rifle" },
  { name: "SMG", value: "smg" },
  { name: "Pistola", value: "pistola" },
  { name: "Doze", value: "doze" },
  { name: "Barret", value: "barret" },
];

export const data = new SlashCommandBuilder()
  .setName("venda")
  .setDescription("Comandos de venda (gerente+)")
  .addSubcommand((sub) =>
    sub
      .setName("registrar")
      .setDescription("Registrar venda de municoes")
      .addStringOption((opt) =>
        opt.setName("tipo").setDescription("Tipo de municao").setRequired(true).addChoices(...CHOICES_MUNICOES),
      )
      .addIntegerOption((opt) =>
        opt.setName("quantidade").setDescription("Quantidade vendida").setRequired(true).setMinValue(1),
      )
      .addBooleanOption((opt) =>
        opt.setName("parceria").setDescription("Venda com parceria?").setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("historico").setDescription("Ultimas vendas"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("cancelar")
      .setDescription("Cancelar uma venda (admin)")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("ID da venda").setRequired(true).setMinValue(1),
      )
      .addStringOption((opt) =>
        opt.setName("motivo").setDescription("Motivo do cancelamento").setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "registrar") await registrar(interaction);
  else if (sub === "historico") await historico(interaction);
  else if (sub === "cancelar") await cancelar(interaction);
}

async function registrar(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro || !CARGOS_GERENCIA.includes(membro.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente ou superior** pode registrar vendas.", ephemeral: true });
    return;
  }

  const tipoMunicao = interaction.options.getString("tipo", true);
  const quantidade = interaction.options.getInteger("quantidade", true);
  const comParceria = interaction.options.getBoolean("parceria", true);
  const semana = getSemanaAtual();

  const produto = db
    .prepare("SELECT * FROM produtos WHERE nome = ?")
    .get(tipoMunicao) as { id: number; nome: string; preco_sem_parceria: number; preco_com_parceria: number } | undefined;

  if (!produto) {
    await interaction.reply({ content: `Municao **${tipoMunicao}** nao encontrada no catalogo.`, ephemeral: true });
    return;
  }

  // Verificar estoque de municoes prontas
  const estoqueMunicao = db.prepare("SELECT quantidade FROM estoque WHERE material = ?").get(tipoMunicao) as { quantidade: number } | undefined;
  const qtdEstoque = estoqueMunicao?.quantidade ?? 0;

  if (qtdEstoque < quantidade) {
    await interaction.reply({
      content: `Estoque insuficiente de **${tipoMunicao}**. Tem ${qtdEstoque}, precisa de ${quantidade}.`,
      ephemeral: true,
    });
    return;
  }

  const precoUnitario = comParceria ? produto.preco_com_parceria : produto.preco_sem_parceria;
  const receitaTotal = quantidade * precoUnitario;
  const valorVendedor = Math.round(receitaTotal * PERCENT_VENDEDOR);
  const valorFamilia = Math.round(receitaTotal * PERCENT_CAIXA_VENDA);

  db.transaction(() => {
    db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = ?").run(quantidade, tipoMunicao);
    db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(tipoMunicao, -quantidade, "venda", `Venda por ${membro.nome}`, discordId);

    db.prepare(
      "INSERT INTO vendas (vendedor_discord_id, tipo_municao, quantidade, preco_unitario, com_parceria, receita_total, valor_vendedor, valor_familia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(discordId, tipoMunicao, quantidade, precoUnitario, comParceria ? 1 : 0, receitaTotal, valorVendedor, valorFamilia);

    // Divida do vendedor com o caixa (60%)
    const divida = db.prepare("SELECT id FROM dividas WHERE membro_discord_id = ?").get(discordId) as { id: number } | undefined;
    if (divida) {
      db.prepare("UPDATE dividas SET valor_devido = valor_devido + ?, atualizado_em = datetime('now') WHERE membro_discord_id = ?").run(valorFamilia, discordId);
    } else {
      db.prepare("INSERT INTO dividas (membro_discord_id, valor_devido) VALUES (?, ?)").run(discordId, valorFamilia);
    }
    db.prepare("INSERT INTO dividas_log (membro_discord_id, tipo, valor, descricao) VALUES (?, ?, ?, ?)").run(discordId, "venda", valorFamilia, `Venda de ${quantidade}x ${tipoMunicao}`);
  })();

  const totalSemana = db
    .prepare("SELECT COALESCE(SUM(quantidade), 0) as total FROM vendas WHERE vendedor_discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(discordId) as { total: number };

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("Venda Registrada!")
    .addFields(
      { name: "Tipo", value: tipoMunicao.toUpperCase(), inline: true },
      { name: "Quantidade", value: `${quantidade}`, inline: true },
      { name: "Parceria", value: comParceria ? "Sim" : "Nao", inline: true },
      { name: "═══ Distribuicao ═══", value: "\u200b" },
      { name: "Receita total", value: `$${receitaTotal.toLocaleString()}`, inline: true },
      { name: "Vendedor (40%)", value: `$${valorVendedor.toLocaleString()}`, inline: true },
      { name: "A depositar (60%)", value: `$${valorFamilia.toLocaleString()}`, inline: true },
      { name: "Vendas na semana", value: `${totalSemana.total} municoes`, inline: true },
    )
    .setFooter({ text: `Vendido por ${membro.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

const HISTORICO_POR_PAGINA = 5;

async function historico(interaction: ChatInputCommandInteraction) {
  const total = (db.prepare("SELECT COUNT(*) as total FROM vendas").get() as { total: number }).total;

  if (total === 0) {
    await interaction.reply({ content: "Nenhuma venda registrada ainda.", ephemeral: true });
    return;
  }

  const totalPaginas = Math.ceil(total / HISTORICO_POR_PAGINA);
  let pagina = 0;

  const buildEmbed = (pag: number) => {
    const offset = pag * HISTORICO_POR_PAGINA;
    const vendas = db
      .prepare(
        `SELECT v.id, v.tipo_municao, v.quantidade, v.preco_unitario, v.com_parceria,
          v.receita_total, v.valor_vendedor, v.valor_familia, v.criado_em,
          m.nome as vendedor_nome,
          CASE WHEN vc.id IS NOT NULL THEN 1 ELSE 0 END as cancelada
        FROM vendas v
        LEFT JOIN membros m ON m.discord_id = v.vendedor_discord_id
        LEFT JOIN vendas_canceladas vc ON vc.venda_id = v.id
        ORDER BY v.id DESC LIMIT ? OFFSET ?`,
      )
      .all(HISTORICO_POR_PAGINA, offset) as Array<{
        id: number; tipo_municao: string; quantidade: number; preco_unitario: number;
        com_parceria: number; receita_total: number; valor_vendedor: number;
        valor_familia: number; vendedor_nome: string | null; criado_em: string; cancelada: number;
      }>;

    let texto = "";
    for (const v of vendas) {
      const tipo = v.com_parceria ? "parceria" : "sem parceria";
      const canceladaLabel = v.cancelada ? " ~~cancelada~~" : "";
      texto += `\`#${v.id}\` 🛒 **${v.quantidade}x ${v.tipo_municao.toUpperCase()}** (${tipo}) — $${v.receita_total.toLocaleString()} | ${v.vendedor_nome ?? "?"}${canceladaLabel} (${v.criado_em})\n`;
    }

    return new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle("Historico de Vendas")
      .setDescription(texto)
      .setFooter({ text: `Pagina ${pag + 1} de ${totalPaginas}` })
      .setTimestamp();
  };

  const buildRow = (pag: number) =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("vendas_anterior").setLabel("◀ Anterior").setStyle(ButtonStyle.Secondary).setDisabled(pag === 0),
      new ButtonBuilder().setCustomId("vendas_proximo").setLabel("Próximo ▶").setStyle(ButtonStyle.Secondary).setDisabled(pag >= totalPaginas - 1),
    );

  const reply = await interaction.reply({ embeds: [buildEmbed(pagina)], components: totalPaginas > 1 ? [buildRow(pagina)] : [], fetchReply: true });
  if (totalPaginas <= 1) return;

  const collector = reply.createMessageComponentCollector({ time: 60000 });
  collector.on("collect", async (btn) => {
    if (btn.user.id !== interaction.user.id) { await btn.reply({ content: "Apenas quem usou o comando pode navegar.", ephemeral: true }); return; }
    if (btn.customId === "vendas_anterior") pagina = Math.max(0, pagina - 1);
    else pagina = Math.min(totalPaginas - 1, pagina + 1);
    await btn.update({ embeds: [buildEmbed(pagina)], components: [buildRow(pagina)] });
  });
  collector.on("end", async () => { await interaction.editReply({ components: [] }); });
}

async function cancelar(interaction: ChatInputCommandInteraction) {
  const admin = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(interaction.user.id) as { cargo: string; nome: string } | undefined;

  if (!admin || !CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Sublider ou Lider** pode cancelar vendas.", ephemeral: true });
    return;
  }

  const vendaId = interaction.options.getInteger("id", true);
  const motivo = interaction.options.getString("motivo", true);

  const venda = db
    .prepare("SELECT * FROM vendas WHERE id = ?")
    .get(vendaId) as { id: number; vendedor_discord_id: string; tipo_municao: string; quantidade: number; valor_familia: number } | undefined;

  if (!venda) {
    await interaction.reply({ content: `Venda **#${vendaId}** nao encontrada.`, ephemeral: true });
    return;
  }

  const jaCancelada = db.prepare("SELECT id FROM vendas_canceladas WHERE venda_id = ?").get(vendaId);
  if (jaCancelada) {
    await interaction.reply({ content: `Venda **#${vendaId}** ja foi cancelada.`, ephemeral: true });
    return;
  }

  db.transaction(() => {
    db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = ?").run(venda.quantidade, venda.tipo_municao);
    db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(venda.tipo_municao, venda.quantidade, "ajuste", `Cancelamento venda #${vendaId}`, interaction.user.id);
    db.prepare("UPDATE dividas SET valor_devido = MAX(0, valor_devido - ?), atualizado_em = datetime('now') WHERE membro_discord_id = ?").run(venda.valor_familia, venda.vendedor_discord_id);
    db.prepare("INSERT INTO dividas_log (membro_discord_id, tipo, valor, descricao) VALUES (?, ?, ?, ?)").run(venda.vendedor_discord_id, "cancelamento", venda.valor_familia, `Cancelamento venda #${vendaId}`);
    db.prepare("INSERT INTO vendas_canceladas (venda_id, cancelado_por, motivo) VALUES (?, ?, ?)").run(vendaId, interaction.user.id, motivo);
    registrarAuditoria("venda_cancelada", interaction.user.id, `venda #${vendaId}`, motivo);
  })();

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`Venda #${vendaId} Cancelada`)
        .addFields(
          { name: "Tipo", value: venda.tipo_municao.toUpperCase(), inline: true },
          { name: "Quantidade", value: `${venda.quantidade}`, inline: true },
          { name: "Divida revertida", value: `$${venda.valor_familia.toLocaleString()}`, inline: true },
          { name: "Motivo", value: motivo },
        )
        .setFooter({ text: `Cancelado por ${admin.nome}` })
        .setTimestamp(),
    ],
  });
}
