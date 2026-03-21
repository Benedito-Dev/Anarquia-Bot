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
import { CARGOS_ADMIN, CARGOS_GERENCIA, getSemanaAtual, registrarAuditoria } from "../utils/semana";

const PERCENT_VENDEDOR = 0.45;

const BONUS_VENDAS_TIERS = [
  { produtos: 350, bonus: 100000, label: "350 produtos → +100k" },
  { produtos: 200, bonus: 50000, label: "200 produtos → +50k" },
  { produtos: 100, bonus: 20000, label: "100 produtos → +20k" },
];

const CHOICES_PRODUTOS = [
  { name: "C4", value: "c4" },
  { name: "Pager", value: "pager" },
  { name: "Colete", value: "colete" },
  { name: "Ticket de Corrida", value: "ticket de corrida" },
  { name: "Cartao Comum", value: "cartao comum" },
  { name: "Cartao Incomum", value: "cartao incomum" },
  { name: "Cartao Raro", value: "cartao raro" },
  { name: "Cartao Epico", value: "cartao epico" },
  { name: "Cartao Lendario", value: "cartao lendario" },
  { name: "Mochila", value: "mochila" },
  { name: "Algemas", value: "algemas" },
  { name: "Bloqueador de Sinal", value: "bloqueador de sinal" },
  { name: "Attach Unidade", value: "attach unidade" },
  { name: "Attach Kit", value: "attach kit" },
];

export const data = new SlashCommandBuilder()
  .setName("venda")
  .setDescription("Comandos de venda (gerente+)")
  .addSubcommand((sub) =>
    sub
      .setName("registrar")
      .setDescription("Registrar venda de produtos")
      .addStringOption((opt) =>
        opt
          .setName("produto")
          .setDescription("Produto vendido")
          .setRequired(true)
          .addChoices(...CHOICES_PRODUTOS),
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
      .setDescription("Cancelar uma venda por engano (admin)")
      .addIntegerOption((opt) =>
        opt.setName("id").setDescription("ID da venda (ver em /venda historico)").setRequired(true).setMinValue(1),
      )
      .addStringOption((opt) =>
        opt.setName("motivo").setDescription("Motivo do cancelamento").setRequired(true),
      ),
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "registrar") {
    await registrar(interaction);
  } else if (subcommand === "historico") {
    await historico(interaction);
  } else if (subcommand === "cancelar") {
    await cancelar(interaction);
  }
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

  const nomeProduto = interaction.options.getString("produto", true);
  const quantidade = interaction.options.getInteger("quantidade", true);
  const comParceria = interaction.options.getBoolean("parceria", true);

  const produto = db
    .prepare("SELECT * FROM produtos WHERE nome = ?")
    .get(nomeProduto) as { id: number; nome: string; preco_sem_parceria: number; preco_com_parceria: number; fabricavel: number } | undefined;

  if (!produto) {
    await interaction.reply({ content: `Produto **${nomeProduto}** nao encontrado no catalogo.`, ephemeral: true });
    return;
  }

  // Se fabricavel, verificar se tem no estoque ou se tem materiais para produzir na hora
  if (produto.fabricavel) {
    const estoqueAtual = db.prepare("SELECT quantidade FROM estoque WHERE material = ?").get(nomeProduto) as { quantidade: number } | undefined;
    const qtdEstoque = estoqueAtual?.quantidade ?? 0;

    if (qtdEstoque < quantidade) {
      // Tentar produzir na hora com os materiais disponíveis
      const receita = db.prepare("SELECT material, quantidade FROM produto_receita WHERE produto_id = ?").all(produto.id) as Array<{ material: string; quantidade: number }>;
      const faltando: string[] = [];

      for (const item of receita) {
        const mat = db.prepare("SELECT quantidade FROM estoque WHERE material = ?").get(item.material) as { quantidade: number } | undefined;
        const disponivel = mat?.quantidade ?? 0;
        const necessario = item.quantidade * quantidade;
        if (disponivel < necessario) {
          faltando.push(`${item.material}: precisa ${necessario}, tem ${disponivel}`);
        }
      }

      if (faltando.length > 0) {
        await interaction.reply({
          content: `Sem estoque de **${nomeProduto}** e materiais insuficientes para produzir:\n${faltando.map(f => `• ${f}`).join("\n")}`,
          ephemeral: true,
        });
        return;
      }

      // Produzir na hora
      db.transaction(() => {
        for (const item of receita) {
          const necessario = item.quantidade * quantidade;
          db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = ?").run(necessario, item.material);
          db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(
            item.material, -necessario, "producao", `Producao automatica de ${quantidade}x ${nomeProduto}`, discordId,
          );
        }
        db.prepare("INSERT INTO producao_log (membro_discord_id, produto, quantidade_produtos) VALUES (?, ?, ?)").run(discordId, nomeProduto, quantidade);
      })();
    }
  }

  const precoUnitario = comParceria ? produto.preco_com_parceria : produto.preco_sem_parceria;
  const receitaTotal = quantidade * precoUnitario;
  const valorVendedor = Math.round(receitaTotal * PERCENT_VENDEDOR);
  const valorFamilia = Math.round(receitaTotal * 0.30);
  const semana = getSemanaAtual();

  db.transaction(() => {
    if (produto.fabricavel) {
      db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = ?").run(quantidade, nomeProduto);
      db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(nomeProduto, -quantidade, "venda", `Venda por ${membro.nome}`, discordId);
    }
    db.prepare(
      "INSERT INTO vendas (vendedor_discord_id, produto, quantidade_produtos, preco_unitario, com_parceria, receita_total, valor_vendedor, valor_familia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(discordId, nomeProduto, quantidade, precoUnitario, comParceria ? 1 : 0, receitaTotal, valorVendedor, valorFamilia);

    // Registrar divida em vez de creditar caixa diretamente
    const divida = db.prepare("SELECT id, valor_devido FROM dividas WHERE membro_discord_id = ?").get(discordId) as { id: number; valor_devido: number } | undefined;
    if (divida) {
      db.prepare("UPDATE dividas SET valor_devido = valor_devido + ?, atualizado_em = datetime('now') WHERE membro_discord_id = ?").run(valorFamilia, discordId);
    } else {
      db.prepare("INSERT INTO dividas (membro_discord_id, valor_devido) VALUES (?, ?)").run(discordId, valorFamilia);
    }
    db.prepare("INSERT INTO dividas_log (membro_discord_id, tipo, valor, descricao) VALUES (?, ?, ?, ?)").run(
      discordId, "venda", valorFamilia, `Venda de ${quantidade}x ${nomeProduto}`,
    );
  })();

  const totalVendasSemana = db
    .prepare("SELECT COALESCE(SUM(quantidade_produtos), 0) as total FROM vendas WHERE vendedor_discord_id = ? AND criado_em >= date('now', 'weekday 0', '-6 days')")
    .get(discordId) as { total: number };

  const bonusJaRecebidos = db
    .prepare("SELECT valor FROM bonus_log WHERE membro_id = ? AND semana = ? AND tipo = 'venda_volume'")
    .all(membro.id, semana) as Array<{ valor: number }>;
  const valoresJaRecebidos = new Set(bonusJaRecebidos.map((b) => b.valor));

  let bonusNovo = "";
  for (const tier of BONUS_VENDAS_TIERS) {
    if (totalVendasSemana.total >= tier.produtos && !valoresJaRecebidos.has(tier.bonus)) {
      db.prepare("INSERT INTO bonus_log (membro_id, tipo, valor, descricao, semana) VALUES (?, ?, ?, ?, ?)").run(membro.id, "venda_volume", tier.bonus, tier.label, semana);
      bonusNovo += `🎉 **BONUS DESBLOQUEADO:** ${tier.label}\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("Venda Registrada!")
    .setDescription(bonusNovo || null)
    .addFields(
      { name: "Produto", value: nomeProduto, inline: true },
      { name: "Quantidade", value: `${quantidade}`, inline: true },
      { name: "Tipo", value: comParceria ? "Com parceria" : "Sem parceria", inline: true },
      { name: "═══ Distribuicao ═══", value: "\u200b" },
      { name: "Receita total", value: `$${receitaTotal.toLocaleString()}`, inline: true },
      { name: "Vendedor (45%)", value: `$${valorVendedor.toLocaleString()}`, inline: true },
      { name: "A depositar no caixa (30%)", value: `$${valorFamilia.toLocaleString()}`, inline: true },
      { name: "Vendas na semana", value: `${totalVendasSemana.total} unidades`, inline: true },
    )
    .setFooter({ text: `Vendido por ${membro.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

const HISTORICO_VENDAS_POR_PAGINA = 5;

async function historico(interaction: ChatInputCommandInteraction) {
  const total = (db.prepare("SELECT COUNT(*) as total FROM vendas").get() as { total: number }).total;

  if (total === 0) {
    await interaction.reply({ content: "Nenhuma venda registrada ainda.", ephemeral: true });
    return;
  }

  const totalPaginas = Math.ceil(total / HISTORICO_VENDAS_POR_PAGINA);
  let pagina = 0;

  const buildEmbed = (pag: number) => {
    const offset = pag * HISTORICO_VENDAS_POR_PAGINA;
    const vendas = db
      .prepare(
        `SELECT v.id, v.produto, v.quantidade_produtos, v.preco_unitario, v.com_parceria,
          v.receita_total, v.valor_vendedor, v.valor_familia, v.criado_em,
          m.nome as vendedor_nome,
          CASE WHEN vc.id IS NOT NULL THEN 1 ELSE 0 END as cancelada
        FROM vendas v
        LEFT JOIN membros m ON m.discord_id = v.vendedor_discord_id
        LEFT JOIN vendas_canceladas vc ON vc.venda_id = v.id
        ORDER BY v.id DESC LIMIT ? OFFSET ?`,
      )
      .all(HISTORICO_VENDAS_POR_PAGINA, offset) as Array<{
      id: number;
      produto: string;
      quantidade_produtos: number;
      preco_unitario: number;
      com_parceria: number;
      receita_total: number;
      valor_vendedor: number;
      valor_familia: number;
      vendedor_nome: string | null;
      criado_em: string;
      cancelada: number;
    }>;

    let texto = "";
    for (const v of vendas) {
      const tipo = v.com_parceria ? "parceria" : "sem parceria";
      const canceladaLabel = v.cancelada ? " ~~cancelada~~" : "";
      texto += `\`#${v.id}\` 🛒 **${v.quantidade_produtos}x ${v.produto}** (${tipo}) — $${v.receita_total.toLocaleString()} | ${v.vendedor_nome ?? "?"}${canceladaLabel} (${v.criado_em})\n`;
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
      new ButtonBuilder()
        .setCustomId("vendas_anterior")
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(pag === 0),
      new ButtonBuilder()
        .setCustomId("vendas_proximo")
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
    if (btn.customId === "vendas_anterior") pagina = Math.max(0, pagina - 1);
    else pagina = Math.min(totalPaginas - 1, pagina + 1);
    await btn.update({ embeds: [buildEmbed(pagina)], components: [buildRow(pagina)] });
  });

  collector.on("end", async () => {
    await interaction.editReply({ components: [] });
  });
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
    .get(vendaId) as { id: number; vendedor_discord_id: string; produto: string; quantidade_produtos: number; valor_familia: number; fabricavel?: number } | undefined;

  if (!venda) {
    await interaction.reply({ content: `Venda **#${vendaId}** nao encontrada.`, ephemeral: true });
    return;
  }

  const jaCancelada = db.prepare("SELECT id FROM vendas_canceladas WHERE venda_id = ?").get(vendaId);
  if (jaCancelada) {
    await interaction.reply({ content: `Venda **#${vendaId}** ja foi cancelada anteriormente.`, ephemeral: true });
    return;
  }

  const produto = db.prepare("SELECT fabricavel FROM produtos WHERE nome = ?").get(venda.produto) as { fabricavel: number } | undefined;

  db.transaction(() => {
    // Reverter estoque se fabricavel
    if (produto?.fabricavel) {
      db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = ?").run(venda.quantidade_produtos, venda.produto);
      db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(
        venda.produto, venda.quantidade_produtos, "ajuste", `Cancelamento venda #${vendaId}: ${motivo}`, interaction.user.id,
      );
    }
    // Reverter divida do vendedor
    db.prepare("UPDATE dividas SET valor_devido = MAX(0, valor_devido - ?), atualizado_em = datetime('now') WHERE membro_discord_id = ?").run(
      venda.valor_familia, venda.vendedor_discord_id,
    );
    db.prepare("INSERT INTO dividas_log (membro_discord_id, tipo, valor, descricao) VALUES (?, ?, ?, ?)").run(
      venda.vendedor_discord_id, "cancelamento", venda.valor_familia, `Cancelamento venda #${vendaId}`,
    );
    db.prepare("INSERT INTO vendas_canceladas (venda_id, cancelado_por, motivo) VALUES (?, ?, ?)").run(vendaId, interaction.user.id, motivo);
    db.prepare("INSERT INTO auditoria_log (acao, executado_por, alvo, detalhes) VALUES (?, ?, ?, ?)").run(
      "venda_cancelada", interaction.user.id, `venda #${vendaId}`, motivo,
    );
  })();

  const embed = new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle(`Venda #${vendaId} Cancelada`)
    .addFields(
      { name: "Produto", value: venda.produto, inline: true },
      { name: "Quantidade", value: `${venda.quantidade_produtos}`, inline: true },
      { name: "Divida revertida", value: `$${venda.valor_familia.toLocaleString()}`, inline: true },
      { name: "Motivo", value: motivo },
    )
    .setFooter({ text: `Cancelado por ${admin.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
