import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_GERENCIA, getSemanaAtual } from "../utils/semana";

const PERCENT_VENDEDOR = 0.50;

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
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "registrar") {
    await registrar(interaction);
  } else if (subcommand === "historico") {
    await historico(interaction);
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

  // Verificar estoque se for fabricavel
  if (produto.fabricavel) {
    const estoqueAtual = db.prepare("SELECT quantidade FROM estoque WHERE material = ?").get(nomeProduto) as { quantidade: number } | undefined;
    const qtdEstoque = estoqueAtual?.quantidade ?? 0;
    if (qtdEstoque < quantidade) {
      await interaction.reply({
        content: `Estoque insuficiente de **${nomeProduto}**. Tem ${qtdEstoque}, precisa de ${quantidade}.\nUse \`/estoque produzir\` primeiro.`,
        ephemeral: true,
      });
      return;
    }
  }

  const precoUnitario = comParceria ? produto.preco_com_parceria : produto.preco_sem_parceria;
  const receitaTotal = quantidade * precoUnitario;
  const valorVendedor = Math.round(receitaTotal * PERCENT_VENDEDOR);
  const valorFamilia = receitaTotal - valorVendedor;
  const semana = getSemanaAtual();

  db.transaction(() => {
    if (produto.fabricavel) {
      db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = ?").run(quantidade, nomeProduto);
      db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(nomeProduto, -quantidade, "venda", `Venda por ${membro.nome}`, discordId);
    }
    db.prepare(
      "INSERT INTO vendas (vendedor_discord_id, produto, quantidade_produtos, preco_unitario, com_parceria, receita_total, valor_vendedor, valor_familia) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(discordId, nomeProduto, quantidade, precoUnitario, comParceria ? 1 : 0, receitaTotal, valorVendedor, valorFamilia);
    db.prepare("UPDATE caixa SET saldo = saldo + ?").run(valorFamilia);
    db.prepare("INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)").run(
      "venda", valorFamilia, `Venda de ${quantidade}x ${nomeProduto} por ${membro.nome}`, discordId,
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
      { name: "Vendedor (50%)", value: `$${valorVendedor.toLocaleString()}`, inline: true },
      { name: "Caixa familia (50%)", value: `$${valorFamilia.toLocaleString()}`, inline: true },
      { name: "Vendas na semana", value: `${totalVendasSemana.total} unidades`, inline: true },
    )
    .setFooter({ text: `Vendido por ${membro.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function historico(interaction: ChatInputCommandInteraction) {
  const vendas = db
    .prepare(
      `SELECT v.*, m.nome as vendedor_nome
      FROM vendas v
      LEFT JOIN membros m ON m.discord_id = v.vendedor_discord_id
      ORDER BY v.id DESC LIMIT 10`,
    )
    .all() as Array<{
    produto: string;
    quantidade_produtos: number;
    preco_unitario: number;
    com_parceria: number;
    receita_total: number;
    valor_vendedor: number;
    valor_familia: number;
    vendedor_nome: string | null;
    criado_em: string;
  }>;

  if (vendas.length === 0) {
    await interaction.reply({ content: "Nenhuma venda registrada ainda.", ephemeral: true });
    return;
  }

  let texto = "";
  for (const v of vendas) {
    const tipo = v.com_parceria ? "parceria" : "sem parceria";
    texto += `🛒 **${v.quantidade_produtos}x ${v.produto}** (${tipo}) — $${v.receita_total.toLocaleString()} | ${v.vendedor_nome ?? "?"} (${v.criado_em})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("Historico de Vendas (ultimas 10)")
    .setDescription(texto)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
