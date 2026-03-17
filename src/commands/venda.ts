import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_GERENCIA, getSemanaAtual } from "../utils/semana";

const PRECO_SEM_PARCERIA = 8300;
const PRECO_COM_PARCERIA = 6500;
const PERCENT_VENDEDOR = 0.45;

const BONUS_VENDAS_TIERS = [
  { produtos: 350, bonus: 100000, label: "350 produtos → +100k" },
  { produtos: 200, bonus: 50000, label: "200 produtos → +50k" },
  { produtos: 100, bonus: 20000, label: "100 produtos → +20k" },
];

export const data = new SlashCommandBuilder()
  .setName("venda")
  .setDescription("Comandos de venda (gerente+)")
  .addSubcommand((sub) =>
    sub
      .setName("registrar")
      .setDescription("Registrar venda de produtos")
      .addIntegerOption((opt) =>
        opt
          .setName("quantidade")
          .setDescription("Quantidade de produtos vendidos")
          .setRequired(true)
          .setMinValue(1),
      )
      .addBooleanOption((opt) =>
        opt
          .setName("parceria")
          .setDescription("Venda com parceria? (preco menor)")
          .setRequired(true),
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
    await interaction.reply({
      content: "Apenas **Gerente ou superior** pode registrar vendas.",
      ephemeral: true,
    });
    return;
  }

  const quantidade = interaction.options.getInteger("quantidade", true);
  const comParceria = interaction.options.getBoolean("parceria", true);

  const estoqueProdutos = db
    .prepare("SELECT quantidade FROM estoque WHERE material = 'produtos'")
    .get() as { quantidade: number };

  if (estoqueProdutos.quantidade < quantidade) {
    await interaction.reply({
      content: `Estoque insuficiente. Tem ${estoqueProdutos.quantidade} produtos prontos, precisa de ${quantidade}.\nUse \`/estoque produzir\` primeiro.`,
      ephemeral: true,
    });
    return;
  }

  const precoUnitario = comParceria ? PRECO_COM_PARCERIA : PRECO_SEM_PARCERIA;
  const receitaTotal = quantidade * precoUnitario;
  const valorVendedor = Math.round(receitaTotal * PERCENT_VENDEDOR);
  const valorFamilia = receitaTotal - valorVendedor;
  const semana = getSemanaAtual();

  db.transaction(() => {
    db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = 'produtos'").run(quantidade);
    db.prepare(
      "INSERT INTO vendas (vendedor_discord_id, quantidade_produtos, preco_unitario, com_parceria, receita_total, valor_vendedor, valor_familia) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(discordId, quantidade, precoUnitario, comParceria ? 1 : 0, receitaTotal, valorVendedor, valorFamilia);
    db.prepare("UPDATE caixa SET saldo = saldo + ?").run(valorFamilia);
    db.prepare(
      "INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)",
    ).run("venda", valorFamilia, `Venda de ${quantidade} produtos (${comParceria ? "com" : "sem"} parceria) por ${membro.nome}`, discordId);
    db.prepare(
      "INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)",
    ).run("produtos", -quantidade, "venda", `Venda por ${membro.nome}`, discordId);
  })();

  // Verificar bonus de vendas semanal
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
      db.prepare(
        "INSERT INTO bonus_log (membro_id, tipo, valor, descricao, semana) VALUES (?, ?, ?, ?, ?)",
      ).run(membro.id, "venda_volume", tier.bonus, tier.label, semana);
      bonusNovo += `🎉 **BONUS DESBLOQUEADO:** ${tier.label}\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("Venda Registrada!")
    .setDescription(bonusNovo || null)
    .addFields(
      { name: "Produtos vendidos", value: `${quantidade}`, inline: true },
      { name: "Tipo", value: comParceria ? "Com parceria" : "Sem parceria", inline: true },
      { name: "Preco unitario", value: `$${precoUnitario.toLocaleString()}`, inline: true },
      { name: "═══ Distribuicao ═══", value: "\u200b" },
      { name: "Receita total", value: `$${receitaTotal.toLocaleString()}`, inline: true },
      { name: "Vendedor (45%)", value: `$${valorVendedor.toLocaleString()}`, inline: true },
      { name: "Caixa familia", value: `$${valorFamilia.toLocaleString()}`, inline: true },
      { name: "Produtos vendidos na semana", value: `${totalVendasSemana.total}`, inline: true },
    )
    .setFooter({ text: `Vendido por ${membro.nome} | Farmer ja foi pago na entrega do material` })
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
    texto += `🛒 **${v.quantidade_produtos} produtos** (${tipo}) — $${v.receita_total.toLocaleString()} | Vendedor: ${v.vendedor_nome ?? "?"} (${v.criado_em})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle("Historico de Vendas (ultimas 10)")
    .setDescription(texto)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
