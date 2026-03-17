import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_GERENCIA } from "../utils/semana";

const CHOICES_FABRICAVEIS = [
  { name: "C4", value: "c4" },
  { name: "Pager", value: "pager" },
  { name: "Colete", value: "colete" },
  { name: "Cartao Comum", value: "cartao comum" },
  { name: "Cartao Incomum", value: "cartao incomum" },
  { name: "Cartao Raro", value: "cartao raro" },
  { name: "Cartao Epico", value: "cartao epico" },
  { name: "Cartao Lendario", value: "cartao lendario" },
  { name: "Mochila", value: "mochila" },
  { name: "Bloqueador de Sinal", value: "bloqueador de sinal" },
  { name: "Attach Unidade", value: "attach unidade" },
  { name: "Attach Kit", value: "attach kit" },
];

export const data = new SlashCommandBuilder()
  .setName("estoque")
  .setDescription("Comandos de estoque")
  .addSubcommand((sub) => sub.setName("ver").setDescription("Ver estoque atual"))
  .addSubcommand((sub) =>
    sub
      .setName("produzir")
      .setDescription("Fabricar produtos (gerente+)")
      .addStringOption((opt) =>
        opt.setName("produto").setDescription("Produto a fabricar").setRequired(true).addChoices(...CHOICES_FABRICAVEIS),
      )
      .addIntegerOption((opt) =>
        opt.setName("quantidade").setDescription("Quantidade a fabricar").setRequired(true).setMinValue(1),
      ),
  )
  .addSubcommand((sub) => sub.setName("historico").setDescription("Ultimas movimentacoes do estoque"));

export async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "ver") {
    await ver(interaction);
  } else if (subcommand === "produzir") {
    await produzir(interaction);
  } else if (subcommand === "historico") {
    await historico(interaction);
  }
}

async function ver(interaction: ChatInputCommandInteraction) {
  const estoques = db.prepare("SELECT material, quantidade FROM estoque ORDER BY material").all() as Array<{
    material: string;
    quantidade: number;
  }>;

  const materiais = estoques.filter((e) => !["cobres", "aluminios"].includes(e.material) && !db.prepare("SELECT id FROM produtos WHERE nome = ?").get(e.material));
  const materiasPrimas = estoques.filter((e) => ["cobres", "aluminios", "lona", "plastico", "algodao", "couro", "chapa de metal", "lixo eletronico"].includes(e.material));
  const produtosProntos = estoques.filter((e) => db.prepare("SELECT id FROM produtos WHERE nome = ?").get(e.material));

  let textoMaterias = materiasPrimas.map((e) => `**${e.material}:** ${e.quantidade}`).join("\n") || "Vazio";
  let textoProdutos = produtosProntos.map((e) => `**${e.material}:** ${e.quantidade}`).join("\n") || "Vazio";

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Estoque da Familia")
    .addFields(
      { name: "🪨 Materias Primas", value: textoMaterias, inline: true },
      { name: "📦 Produtos Prontos", value: textoProdutos, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function produzir(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro || !CARGOS_GERENCIA.includes(membro.cargo.toLowerCase())) {
    await interaction.reply({ content: "Apenas **Gerente ou superior** pode fabricar produtos.", ephemeral: true });
    return;
  }

  const nomeProduto = interaction.options.getString("produto", true);
  const quantidade = interaction.options.getInteger("quantidade", true);

  const produto = db
    .prepare("SELECT * FROM produtos WHERE nome = ? AND fabricavel = 1")
    .get(nomeProduto) as { id: number; nome: string } | undefined;

  if (!produto) {
    await interaction.reply({ content: `Produto **${nomeProduto}** nao e fabricavel.`, ephemeral: true });
    return;
  }

  const receita = db
    .prepare("SELECT material, quantidade FROM produto_receita WHERE produto_id = ?")
    .all(produto.id) as Array<{ material: string; quantidade: number }>;

  // Verificar materiais suficientes
  for (const item of receita) {
    const estoque = db.prepare("SELECT quantidade FROM estoque WHERE material = ?").get(item.material) as { quantidade: number } | undefined;
    const disponivel = estoque?.quantidade ?? 0;
    const necessario = item.quantidade * quantidade;
    if (disponivel < necessario) {
      await interaction.reply({
        content: `Estoque insuficiente de **${item.material}**. Precisa de ${necessario}, tem ${disponivel}.`,
        ephemeral: true,
      });
      return;
    }
  }

  db.transaction(() => {
    for (const item of receita) {
      const necessario = item.quantidade * quantidade;
      db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = ?").run(necessario, item.material);
      db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(item.material, -necessario, "producao", `Producao de ${quantidade}x ${nomeProduto}`, discordId);
    }

    // Adicionar produto pronto ao estoque
    const existeProduto = db.prepare("SELECT id FROM estoque WHERE material = ?").get(nomeProduto);
    if (existeProduto) {
      db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = ?").run(quantidade, nomeProduto);
    } else {
      db.prepare("INSERT INTO estoque (material, quantidade) VALUES (?, ?)").run(nomeProduto, quantidade);
    }
    db.prepare("INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)").run(nomeProduto, quantidade, "producao", `Fabricado por ${membro.nome}`, discordId);
    db.prepare("INSERT INTO producao_log (membro_discord_id, produto, quantidade_produtos) VALUES (?, ?, ?)").run(discordId, nomeProduto, quantidade);
  })();

  const receitaTexto = receita.map((r) => `${r.quantidade * quantidade} ${r.material}`).join(" | ");

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Producao Concluida!")
    .addFields(
      { name: "Produto", value: nomeProduto, inline: true },
      { name: "Quantidade", value: `${quantidade}`, inline: true },
      { name: "Materiais usados", value: receitaTexto },
    )
    .setFooter({ text: `Fabricado por ${membro.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function historico(interaction: ChatInputCommandInteraction) {
  const logs = db
    .prepare("SELECT material, quantidade, tipo, descricao, criado_em FROM estoque_log ORDER BY id DESC LIMIT 15")
    .all() as Array<{ material: string; quantidade: number; tipo: string; descricao: string | null; criado_em: string }>;

  if (logs.length === 0) {
    await interaction.reply({ content: "Nenhuma movimentacao registrada ainda.", ephemeral: true });
    return;
  }

  let texto = "";
  for (const log of logs) {
    const sinal = log.quantidade > 0 ? "+" : "";
    const emoji = log.tipo === "entrada" ? "📥" : log.tipo === "producao" ? "🔨" : "📤";
    texto += `${emoji} **${log.material}** ${sinal}${log.quantidade} — ${log.descricao ?? log.tipo} (${log.criado_em})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("Historico do Estoque (ultimos 15)")
    .setDescription(texto)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
