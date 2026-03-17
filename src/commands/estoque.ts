import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import db from "../database/db";
import { CARGOS_GERENCIA } from "../utils/semana";

export const data = new SlashCommandBuilder()
  .setName("estoque")
  .setDescription("Comandos de estoque")
  .addSubcommand((sub) =>
    sub.setName("ver").setDescription("Ver estoque atual"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("produzir")
      .setDescription("Transformar materiais em produtos (gerente+)")
      .addIntegerOption((opt) =>
        opt
          .setName("quantidade")
          .setDescription("Quantidade de produtos a fabricar")
          .setRequired(true)
          .setMinValue(1),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName("historico").setDescription("Ultimas movimentacoes do estoque"),
  );

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
  const estoques = db.prepare("SELECT material, quantidade FROM estoque").all() as Array<{
    material: string;
    quantidade: number;
  }>;

  const estoqueMap: Record<string, number> = {};
  for (const e of estoques) {
    estoqueMap[e.material] = e.quantidade;
  }

  const cobres = estoqueMap["cobres"] ?? 0;
  const aluminios = estoqueMap["aluminios"] ?? 0;
  const produtos = estoqueMap["produtos"] ?? 0;

  // Quantos produtos PODEM ser fabricados com o material atual
  const produtosPossiveis = Math.min(Math.floor(cobres / 6), Math.floor(aluminios / 6));

  // Quantos lotes completos de 25 produtos prontos
  const lotesEstoque = Math.floor(produtos / 25);

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle("Estoque da Familia")
    .addFields(
      { name: "Cobres", value: `${cobres}`, inline: true },
      { name: "Aluminios", value: `${aluminios}`, inline: true },
      { name: "Produtos Prontos", value: `${produtos}`, inline: true },
      { name: "Pode produzir", value: `${produtosPossiveis} produtos`, inline: true },
      { name: "Lotes prontos", value: `${lotesEstoque} lotes (${lotesEstoque * 25} produtos)`, inline: true },
    )
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function produzir(interaction: ChatInputCommandInteraction) {
  const discordId = interaction.user.id;

  // Verificar cargo
  const membro = db
    .prepare("SELECT * FROM membros WHERE discord_id = ?")
    .get(discordId) as { id: number; cargo: string; nome: string } | undefined;

  if (!membro || !CARGOS_GERENCIA.includes(membro.cargo.toLowerCase())) {
    await interaction.reply({
      content: "Apenas **Gerente ou superior** pode usar a bancada e fabricar produtos.",
      ephemeral: true,
    });
    return;
  }

  const quantidade = interaction.options.getInteger("quantidade", true);
  const cobresNecessarios = quantidade * 6;
  const aluminiosNecessarios = quantidade * 6;

  // Verificar materiais
  const cobres = db.prepare("SELECT quantidade FROM estoque WHERE material = 'cobres'").get() as { quantidade: number };
  const aluminios = db.prepare("SELECT quantidade FROM estoque WHERE material = 'aluminios'").get() as { quantidade: number };

  if (cobres.quantidade < cobresNecessarios) {
    await interaction.reply({
      content: `Estoque insuficiente. Precisa de ${cobresNecessarios} cobres, tem ${cobres.quantidade}.`,
      ephemeral: true,
    });
    return;
  }

  if (aluminios.quantidade < aluminiosNecessarios) {
    await interaction.reply({
      content: `Estoque insuficiente. Precisa de ${aluminiosNecessarios} aluminios, tem ${aluminios.quantidade}.`,
      ephemeral: true,
    });
    return;
  }

  // Produzir
  const produzirTransaction = db.transaction(() => {
    db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = 'cobres'").run(cobresNecessarios);
    db.prepare("UPDATE estoque SET quantidade = quantidade - ? WHERE material = 'aluminios'").run(aluminiosNecessarios);
    db.prepare("UPDATE estoque SET quantidade = quantidade + ? WHERE material = 'produtos'").run(quantidade);

    // Logs
    db.prepare(
      "INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)",
    ).run("cobres", -cobresNecessarios, "producao", `Producao de ${quantidade} produtos`, discordId);
    db.prepare(
      "INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)",
    ).run("aluminios", -aluminiosNecessarios, "producao", `Producao de ${quantidade} produtos`, discordId);
    db.prepare(
      "INSERT INTO estoque_log (material, quantidade, tipo, descricao, membro_discord_id) VALUES (?, ?, ?, ?, ?)",
    ).run("produtos", quantidade, "producao", `Producao por ${membro.nome}`, discordId);

    // Log de producao
    db.prepare(
      "INSERT INTO producao_log (membro_discord_id, quantidade_produtos, cobres_usados, aluminios_usados) VALUES (?, ?, ?, ?)",
    ).run(discordId, quantidade, cobresNecessarios, aluminiosNecessarios);
  });

  produzirTransaction();

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("Producao Concluida!")
    .addFields(
      { name: "Produtos fabricados", value: `${quantidade}`, inline: true },
      { name: "Cobres usados", value: `${cobresNecessarios}`, inline: true },
      { name: "Aluminios usados", value: `${aluminiosNecessarios}`, inline: true },
    )
    .setFooter({ text: `Fabricado por ${membro.nome}` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}

async function historico(interaction: ChatInputCommandInteraction) {
  const logs = db
    .prepare(
      "SELECT material, quantidade, tipo, descricao, criado_em FROM estoque_log ORDER BY id DESC LIMIT 10",
    )
    .all() as Array<{
    material: string;
    quantidade: number;
    tipo: string;
    descricao: string | null;
    criado_em: string;
  }>;

  if (logs.length === 0) {
    await interaction.reply({ content: "Nenhuma movimentacao registrada ainda.", ephemeral: true });
    return;
  }

  let historicoText = "";
  for (const log of logs) {
    const sinal = log.quantidade > 0 ? "+" : "";
    const emoji = log.tipo === "entrada" ? "📥" : log.tipo === "producao" ? "🔨" : "📤";
    historicoText += `${emoji} **${log.material}** ${sinal}${log.quantidade} — ${log.descricao ?? log.tipo} (${log.criado_em})\n`;
  }

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle("Historico do Estoque (ultimos 10)")
    .setDescription(historicoText)
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
}
